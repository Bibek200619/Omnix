from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
import ipaddress
import logging
import re
import uuid
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from fastapi import HTTPException, status

from ..schemas.connectors import ConnectorCreate, ConnectorStatus
from ..services.document_context_service import store_extracted_text_chunks
from ..services.supabase_service import (
    SupabaseServiceError,
    delete_many_trusted,
    insert_one,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from ..services.workspace_collaboration_service import log_workspace_activity
from ..services.workspace_permissions import OrganizationalAccessAuthority
from ..services.workspace_service import (
    WorkspaceAccess,
    can_manage_workspace_resource,
    require_workspace_access,
)

logger = logging.getLogger(__name__)

CONNECTOR_COLUMNS = (
    "id,workspace_id,user_id,connector_type,display_name,status,config,last_error,"
    "job_id,source_file_id,last_synced_at,created_at,updated_at"
)
JOB_COLUMNS = "id,type,status,payload,progress,attempts,error,result,created_at,started_at,completed_at"
MAX_CONFIG_TEXT = 2000
MAX_NOTE_TEXT = 4000
MAX_LINK_BYTES = 2 * 1024 * 1024
MAX_LINK_TEXT_CHARS = 250_000
REDIRECT_LIMIT = 4
SECRET_KEYS = {"password", "pass", "secret", "token", "api_key", "access_token", "refresh_token"}


@dataclass(slots=True)
class LinkFetchResult:
    ok: bool
    url: str
    status_code: int | None = None
    title: str | None = None
    content_type: str | None = None
    text: str = ""
    error: str | None = None
    auth_required: bool = False


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _clean_text(value: Any, *, max_chars: int = MAX_CONFIG_TEXT) -> str | None:
    if value is None:
        return None
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", str(value))
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars] if text else None


def _clean_multiline(value: Any, *, max_chars: int = MAX_NOTE_TEXT) -> str | None:
    if value is None:
        return None
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", str(value))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text[:max_chars] if text else None


def _public_config(config: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(config, dict):
        return {}

    redacted: dict[str, Any] = {}
    for key, value in config.items():
        normalized_key = key.lower()
        if normalized_key in SECRET_KEYS:
            continue
        if isinstance(value, dict):
            redacted[key] = _public_config(value)
        elif isinstance(value, list):
            redacted[key] = value[:20]
        else:
            redacted[key] = value
    return redacted


def _is_safe_http_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return False

    host = (parsed.hostname or "").strip().lower()
    if not host or host in {"localhost", "0.0.0.0"} or host.endswith(".local"):
        return False

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True

    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _require_http_url(value: Any, *, field_name: str) -> str:
    url = _clean_text(value, max_chars=2048)
    if not url or not _is_safe_http_url(url):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{field_name} must be a public http or https URL.",
        )
    return url


def _hostname_label(url: str) -> str:
    host = urlparse(url).hostname or "Knowledge link"
    return host.removeprefix("www.")


def _normalize_knowledge_config(raw: dict[str, Any]) -> tuple[dict[str, Any], str]:
    url = _require_http_url(raw.get("url"), field_name="Knowledge link")
    notes = _clean_multiline(raw.get("notes"))
    title = _clean_text(raw.get("title"), max_chars=160)
    config = {"url": url}
    if notes:
        config["notes"] = notes
    if title:
        config["title"] = title
    return config, title or _hostname_label(url)


def _normalize_repository_config(raw: dict[str, Any]) -> tuple[dict[str, Any], str, ConnectorStatus]:
    repository = _clean_text(raw.get("repository") or raw.get("repository_url") or raw.get("repository_path"), max_chars=1024)
    if not repository:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Repository URL or repository path is required.",
        )

    branch = _clean_text(raw.get("branch"), max_chars=120)
    auth_mode = (_clean_text(raw.get("auth_mode"), max_chars=80) or "none").lower()
    if auth_mode not in {"none", "token_reference", "ssh_key_reference", "needs_setup"}:
        auth_mode = "needs_setup"
    credential_reference = _clean_text(raw.get("credential_reference"), max_chars=240)
    notes = _clean_multiline(raw.get("notes"))

    config: dict[str, Any] = {
        "repository": repository,
        "auth_mode": auth_mode,
    }
    if branch:
        config["branch"] = branch
    if credential_reference:
        config["credential_reference"] = credential_reference
    if notes:
        config["notes"] = notes

    status_value: ConnectorStatus = "needs_authentication" if auth_mode != "none" and not credential_reference else "request_submitted"
    return config, repository.rsplit("/", 1)[-1] or "File repository", status_value


def _drive_provider(url: str) -> str:
    host = (urlparse(url).hostname or "").lower()
    if "drive.google.com" in host or "docs.google.com" in host:
        return "google_drive"
    if "sharepoint.com" in host:
        return "sharepoint"
    if "onedrive" in host or "1drv.ms" in host:
        return "onedrive"
    return "shared_drive"


def _normalize_drive_config(raw: dict[str, Any]) -> tuple[dict[str, Any], str, ConnectorStatus]:
    url = _require_http_url(raw.get("url") or raw.get("drive_url"), field_name="Drive link")
    notes = _clean_multiline(raw.get("notes"))
    provider = _clean_text(raw.get("provider"), max_chars=80) or _drive_provider(url)
    config: dict[str, Any] = {"url": url, "provider": provider}
    if notes:
        config["notes"] = notes

    status_value: ConnectorStatus = "needs_authentication" if provider == "google_drive" else "request_submitted"
    return config, f"{provider.replace('_', ' ').title()} folder", status_value


def _normalize_database_config(raw: dict[str, Any]) -> tuple[dict[str, Any], str, ConnectorStatus]:
    engine = (_clean_text(raw.get("engine"), max_chars=80) or "postgres").lower()
    if engine not in {"postgres", "mysql", "mssql", "snowflake", "bigquery", "redshift", "other"}:
        engine = "other"
    host = _clean_text(raw.get("host"), max_chars=255)
    database_name = _clean_text(raw.get("database") or raw.get("database_name"), max_chars=160)
    if not host or not database_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Database host and database name are required.",
        )

    port = _clean_text(raw.get("port"), max_chars=10)
    schema = _clean_text(raw.get("schema"), max_chars=160)
    auth_mode = (_clean_text(raw.get("auth_mode"), max_chars=80) or "credential_reference").lower()
    if auth_mode not in {"credential_reference", "iam", "oauth", "network_allowlist", "needs_setup"}:
        auth_mode = "needs_setup"
    credential_reference = _clean_text(raw.get("credential_reference"), max_chars=240)
    notes = _clean_multiline(raw.get("notes"))

    config: dict[str, Any] = {
        "engine": engine,
        "host": host,
        "database": database_name,
        "auth_mode": auth_mode,
    }
    if port:
        config["port"] = port
    if schema:
        config["schema"] = schema
    if credential_reference:
        config["credential_reference"] = credential_reference
    if notes:
        config["notes"] = notes

    status_value: ConnectorStatus = "request_submitted" if credential_reference or auth_mode in {"iam", "oauth", "network_allowlist"} else "needs_authentication"
    return config, f"{engine.upper()} {database_name}", status_value


def _normalize_connector_payload(payload: ConnectorCreate) -> tuple[dict[str, Any], str, ConnectorStatus]:
    raw_config = payload.config if isinstance(payload.config, dict) else {}
    connector_type = payload.connector_type
    if connector_type == "knowledge_link":
        config, fallback_name = _normalize_knowledge_config(raw_config)
        status_value: ConnectorStatus = "connecting"
    elif connector_type == "file_repository":
        config, fallback_name, status_value = _normalize_repository_config(raw_config)
    elif connector_type == "company_drive":
        config, fallback_name, status_value = _normalize_drive_config(raw_config)
    else:
        config, fallback_name, status_value = _normalize_database_config(raw_config)

    display_name = _clean_text(payload.display_name, max_chars=160) or fallback_name
    return config, display_name, status_value


async def _require_sources_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
    access = await require_workspace_access(workspace_id, user_id)
    workspace_type = access.workspace.get("workspace_type") or "workspace"
    if not OrganizationalAccessAuthority.can_access_sources(access.role, workspace_type):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to access workspace sources.",
        )
    return access


async def _insert_setup_job(connector: dict[str, Any], user_id: str) -> dict[str, Any]:
    record = {
        "id": str(uuid.uuid4()),
        "type": "connector_setup_request",
        "status": "queued",
        "payload": {
            "connector_id": str(connector["id"]),
            "workspace_id": str(connector["workspace_id"]),
            "user_id": user_id,
            "connector_type": connector["connector_type"],
        },
        "progress": 0,
        "attempts": 0,
    }
    return await insert_one_trusted("jobs", record)


async def _job_for_connector(row: dict[str, Any]) -> dict[str, Any] | None:
    job_id = row.get("job_id")
    if not job_id:
        return None
    try:
        return await select_one_trusted("jobs", JOB_COLUMNS, {"id": str(job_id)})
    except SupabaseServiceError:
        logger.exception("Failed to load connector job %s.", job_id)
        return None


async def _serialize_connector(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["config"] = _public_config(payload.get("config"))
    payload["job"] = await _job_for_connector(row)
    return payload


async def list_workspace_connectors(workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await _require_sources_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_connectors",
            CONNECTOR_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="created_at",
            desc=True,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return [await _serialize_connector(row) for row in rows]


async def get_workspace_connector(connector_id: str, user_id: str) -> tuple[dict[str, Any], WorkspaceAccess]:
    try:
        connector = await select_one_trusted("workspace_connectors", CONNECTOR_COLUMNS, {"id": connector_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if connector is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connector not found.")

    access = await _require_sources_access(str(connector["workspace_id"]), user_id)
    return connector, access


async def create_workspace_connector(payload: ConnectorCreate, user_id: str, active_workspace_id: str | None) -> dict[str, Any]:
    workspace_id = payload.workspace_id or active_workspace_id
    if not workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace scope is required.")

    await _require_sources_access(workspace_id, user_id)
    config, display_name, status_value = _normalize_connector_payload(payload)

    connector_payload = {
        "workspace_id": workspace_id,
        "user_id": user_id,
        "connector_type": payload.connector_type,
        "display_name": display_name,
        "status": status_value,
        "config": config,
        "last_error": None,
        "updated_at": _utc_now_iso(),
    }

    try:
        connector = await insert_one("workspace_connectors", connector_payload)
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if payload.connector_type == "knowledge_link":
        return await _activate_knowledge_link(connector, user_id)

    try:
        job = await _insert_setup_job(connector, user_id)
        connector = await update_one_trusted(
            "workspace_connectors",
            {"id": connector["id"]},
            {"job_id": job.get("id"), "updated_at": _utc_now_iso()},
        ) or connector
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await _serialize_connector(connector)


async def retry_workspace_connector(connector_id: str, user_id: str) -> dict[str, Any]:
    connector, _ = await get_workspace_connector(connector_id, user_id)

    if connector["connector_type"] == "knowledge_link":
        try:
            updated = await update_one_trusted(
                "workspace_connectors",
                {"id": connector_id},
                {"status": "connecting", "last_error": None, "updated_at": _utc_now_iso()},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        return await _activate_knowledge_link(updated or connector, user_id)

    config, _, status_value = _normalize_connector_payload(
        ConnectorCreate(
            workspace_id=str(connector["workspace_id"]),
            connector_type=connector["connector_type"],
            display_name=connector["display_name"],
            config=connector.get("config") or {},
        )
    )
    try:
        connector = await update_one_trusted(
            "workspace_connectors",
            {"id": connector_id},
            {
                "status": status_value,
                "config": config,
                "last_error": None,
                "updated_at": _utc_now_iso(),
            },
        ) or connector
        job = await _insert_setup_job(connector, user_id)
        connector = await update_one_trusted(
            "workspace_connectors",
            {"id": connector_id},
            {"job_id": job.get("id"), "updated_at": _utc_now_iso()},
        ) or connector
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await _serialize_connector(connector)


async def delete_workspace_connector(connector_id: str, user_id: str) -> None:
    connector, access = await get_workspace_connector(connector_id, user_id)
    if not can_manage_workspace_resource(str(connector.get("user_id") or ""), access, user_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the connector owner or workspace owner can remove this connector.",
        )

    source_file_id = connector.get("source_file_id")
    try:
        if source_file_id:
            await delete_many_trusted("documents", {"file_id": source_file_id})
            await delete_many_trusted("files", {"id": source_file_id})
        await delete_many_trusted("workspace_connectors", {"id": connector_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=str(connector["workspace_id"]),
        actor_user_id=user_id,
        event_type="workspace.source_removed",
        summary=f"{connector.get('display_name') or 'A connector'} was removed from workspace sources.",
        metadata={"connector_id": connector_id, "connector_type": connector.get("connector_type")},
    )


async def _activate_knowledge_link(connector: dict[str, Any], user_id: str) -> dict[str, Any]:
    config = connector.get("config") or {}
    url = str(config.get("url") or "")
    fetch_result = await fetch_knowledge_link(url)

    if not fetch_result.ok:
        status_value: ConnectorStatus = "needs_authentication" if fetch_result.auth_required else "request_submitted"
        last_error = fetch_result.error or "The link could not be reached from Omnix infrastructure."
        try:
            job = await _insert_setup_job(connector, user_id)
            connector = await update_one_trusted(
                "workspace_connectors",
                {"id": connector["id"]},
                {
                    "status": status_value,
                    "last_error": last_error,
                    "job_id": job.get("id"),
                    "updated_at": _utc_now_iso(),
                },
            ) or connector
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        return await _serialize_connector(connector)

    file_name = _clean_text(connector.get("display_name"), max_chars=160) or fetch_result.title or _hostname_label(url)
    metadata = {
        "source": "knowledge_link",
        "source_type": "knowledge_link",
        "connector_id": str(connector["id"]),
        "url": fetch_result.url,
        "title": fetch_result.title,
        "extracted_text_preview": fetch_result.text[:2000],
    }
    try:
        if connector.get("source_file_id"):
            await delete_many_trusted("documents", {"file_id": connector["source_file_id"]})
            await delete_many_trusted("files", {"id": connector["source_file_id"]})
        file_row = await insert_one(
            "files",
            {
                "user_id": user_id,
                "workspace_id": connector["workspace_id"],
                "file_name": file_name,
                "file_type": fetch_result.content_type or "text/html",
                "size_bytes": len(fetch_result.text.encode("utf-8")),
                "metadata": metadata,
            },
        )
        stored_chunks = await store_extracted_text_chunks(
            file_id=str(file_row["id"]),
            user_id=user_id,
            text=fetch_result.text,
            workspace_id=str(connector["workspace_id"]),
            replace_existing=True,
        )
        next_config = {
            **dict(config),
            "url": fetch_result.url,
            "title": fetch_result.title or config.get("title"),
            "domain": _hostname_label(fetch_result.url),
            "text_chunk_count": stored_chunks.chunk_count,
            "text_chunks_truncated": stored_chunks.truncated,
        }
        connector = await update_one_trusted(
            "workspace_connectors",
            {"id": connector["id"]},
            {
                "status": "connected",
                "config": next_config,
                "last_error": None,
                "source_file_id": file_row.get("id"),
                "last_synced_at": _utc_now_iso(),
                "updated_at": _utc_now_iso(),
            },
        ) or connector
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    except Exception as exc:
        logger.exception("Knowledge link activation failed for connector %s.", connector.get("id"))
        try:
            connector = await update_one_trusted(
                "workspace_connectors",
                {"id": connector["id"]},
                {
                    "status": "failed",
                    "last_error": str(exc)[:500],
                    "updated_at": _utc_now_iso(),
                },
            ) or connector
        except SupabaseServiceError as db_exc:
            raise _database_error() from db_exc
        return await _serialize_connector(connector)

    await log_workspace_activity(
        workspace_id=str(connector["workspace_id"]),
        actor_user_id=user_id,
        event_type="workspace.source_connected",
        summary=f"{file_name} was connected as a knowledge link.",
        metadata={"connector_id": str(connector["id"]), "url": fetch_result.url},
    )

    return await _serialize_connector(connector)


async def fetch_knowledge_link(url: str) -> LinkFetchResult:
    if not _is_safe_http_url(url):
        return LinkFetchResult(ok=False, url=url, error="The URL is not allowed for server-side retrieval.")

    current_url = url
    timeout = httpx.Timeout(12.0, connect=4.0)
    headers = {"User-Agent": "OmnixKnowledgeConnector/1.0"}

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            for _ in range(REDIRECT_LIMIT + 1):
                response = await client.get(current_url, headers=headers)
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get("location")
                    if not location:
                        break
                    next_url = urljoin(current_url, location)
                    if not _is_safe_http_url(next_url):
                        return LinkFetchResult(ok=False, url=current_url, error="The link redirects to an unsupported or private URL.")
                    current_url = next_url
                    continue
                return _parse_link_response(response, current_url)
    except httpx.TimeoutException:
        return LinkFetchResult(ok=False, url=current_url, error="The link timed out while Omnix tried to read it.")
    except httpx.TransportError:
        return LinkFetchResult(ok=False, url=current_url, error="The link could not be reached from Omnix infrastructure.")

    return LinkFetchResult(ok=False, url=current_url, error="The link redirected too many times.")


def _parse_link_response(response: httpx.Response, url: str) -> LinkFetchResult:
    status_code = response.status_code
    content_type = (response.headers.get("content-type") or "").split(";", 1)[0].strip().lower() or None
    if status_code in {401, 403}:
        return LinkFetchResult(
            ok=False,
            url=url,
            status_code=status_code,
            content_type=content_type,
            error="The link requires authentication before Omnix can ingest it.",
            auth_required=True,
        )
    if status_code >= 400:
        return LinkFetchResult(
            ok=False,
            url=url,
            status_code=status_code,
            content_type=content_type,
            error=f"The link returned HTTP {status_code}.",
        )

    raw = response.content[:MAX_LINK_BYTES]
    if not raw:
        return LinkFetchResult(ok=False, url=url, status_code=status_code, content_type=content_type, error="The link returned no readable content.")

    decoded = raw.decode(response.encoding or "utf-8", errors="ignore")
    title: str | None = None
    if content_type and ("html" in content_type or "xml" in content_type):
        soup = BeautifulSoup(decoded, "html.parser")
        for element in soup(["script", "style", "noscript", "svg"]):
            element.decompose()
        if soup.title and soup.title.string:
            title = _clean_text(soup.title.string, max_chars=160)
        text = soup.get_text("\n")
    else:
        text = decoded

    normalized = _clean_link_text(text)
    if not normalized:
        return LinkFetchResult(ok=False, url=url, status_code=status_code, content_type=content_type, error="The link did not contain readable text.")

    return LinkFetchResult(
        ok=True,
        url=str(response.url),
        status_code=status_code,
        title=title,
        content_type=content_type,
        text=normalized,
    )


def _clean_link_text(value: str) -> str:
    text = unescape(value or "")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    normalized = "\n".join(line for line in lines if line)
    return normalized[:MAX_LINK_TEXT_CHARS]
