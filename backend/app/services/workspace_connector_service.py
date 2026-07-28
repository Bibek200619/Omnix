from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
import ipaddress
import logging
import re
import socket
import uuid
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from fastapi import HTTPException, status

try:
    from bs4 import BeautifulSoup
except ModuleNotFoundError:
    BeautifulSoup = None

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
from ..services.workspace_access_service import (
    can_manage_workspace_resource,
    require_workspace_access,
)
from ..services.workspace_common import WorkspaceAccess
from ..services.workspace_permissions import OrganizationalAccessAuthority

logger = logging.getLogger(__name__)

CONNECTOR_COLUMNS = (
    "id,workspace_id,user_id,connector_type,display_name,status,config,last_error,"
    "job_id,source_file_id,last_synced_at,created_at,updated_at"
)
CONNECTOR_LOCATOR_COLUMNS = "id,workspace_id"
JOB_COLUMNS = "id,type,status,payload,progress,attempts,error,result,created_at,started_at,completed_at"
MAX_CONFIG_TEXT = 2000
MAX_NOTE_TEXT = 4000
MAX_LINK_BYTES = 2 * 1024 * 1024
MAX_LINK_TEXT_CHARS = 250_000
REDIRECT_LIMIT = 4
SECRET_KEYS = {"password", "pass", "secret", "token", "api_key", "access_token", "refresh_token"}
BLOCKED_HOSTNAMES = {"localhost", "metadata.google.internal", "metadata.google.com"}


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


class _HTMLTextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self._title_depth = 0
        self.title_parts: list[str] = []
        self.text_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self._skip_depth += 1
        if tag == "title":
            self._title_depth += 1
        if tag in {"br", "p", "div", "section", "article", "li", "tr", "h1", "h2", "h3"}:
            self.text_parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title" and self._title_depth:
            self._title_depth -= 1
        if tag in {"p", "div", "section", "article", "li", "tr", "h1", "h2", "h3"}:
            self.text_parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._skip_depth:
            return
        if self._title_depth:
            self.title_parts.append(data)
        self.text_parts.append(data)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Internal server error",
    )


def _connector_not_found() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="Connector not found.",
    )


def _connector_scope_filters(access: WorkspaceAccess, connector_id: Any) -> dict[str, str]:
    return {
        "id": str(connector_id),
        "workspace_id": access.workspace_id,
    }


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


def _parse_allowed_http_url(url: str):
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return None

    try:
        parsed.port
    except ValueError:
        return None

    if parsed.username or parsed.password:
        return None

    host = (parsed.hostname or "").strip().lower()
    if not host or host in BLOCKED_HOSTNAMES or host == "0.0.0.0" or host.endswith((".local", ".localhost")):
        return None

    return parsed


def _is_public_ip_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped

    return bool(ip.is_global) and not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


def _is_safe_http_url(url: str) -> bool:
    parsed = _parse_allowed_http_url(url)
    if parsed is None:
        return False

    host = (parsed.hostname or "").strip().lower()
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return True

    return _is_public_ip_address(ip)


def _resolve_host_addresses(host: str, port: int) -> list[str]:
    results = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    addresses: list[str] = []
    for result in results:
        sockaddr = result[4]
        if sockaddr:
            addresses.append(str(sockaddr[0]))
    return addresses


async def _is_public_http_url(url: str) -> bool:
    parsed = _parse_allowed_http_url(url)
    if parsed is None:
        return False

    host = (parsed.hostname or "").strip().lower()
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            addresses = await asyncio.to_thread(_resolve_host_addresses, host, port)
        except OSError:
            return False
        if not addresses:
            return False

        for address in addresses:
            try:
                resolved_ip = ipaddress.ip_address(address)
            except ValueError:
                return False
            if not _is_public_ip_address(resolved_ip):
                return False
        return True

    return _is_public_ip_address(ip)


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


async def _insert_setup_job(
    connector: dict[str, Any],
    user_id: str,
    access: WorkspaceAccess,
) -> dict[str, Any]:
    record = {
        "id": str(uuid.uuid4()),
        "type": "connector_setup_request",
        "status": "queued",
        "payload": {
            "connector_id": str(connector["id"]),
            "workspace_id": access.workspace_id,
            "user_id": user_id,
            "connector_type": connector["connector_type"],
        },
        "progress": 0,
        "attempts": 0,
    }
    return await insert_one_trusted("jobs", record)


async def _job_for_connector(row: dict[str, Any]) -> dict[str, Any] | None:
    job_id = row.get("job_id")
    workspace_id = row.get("workspace_id")
    if not job_id or not workspace_id:
        return None
    try:
        return await select_one_trusted(
            "jobs",
            JOB_COLUMNS,
            {"id": str(job_id), "payload->>workspace_id": str(workspace_id)},
        )
    except SupabaseServiceError:
        logger.exception("Failed to load connector job %s.", job_id)
        return None


async def _serialize_connector(row: dict[str, Any]) -> dict[str, Any]:
    payload = dict(row)
    payload["config"] = _public_config(payload.get("config"))
    payload["job"] = await _job_for_connector(row)
    return payload


async def _delete_connector_source_file(
    connector: dict[str, Any],
    access: WorkspaceAccess,
) -> None:
    source_file_id = connector.get("source_file_id")
    if not source_file_id:
        return

    source_file_filter = str(source_file_id)
    await delete_many_trusted(
        "documents",
        {"file_id": source_file_filter, "workspace_id": access.workspace_id},
    )
    await delete_many_trusted(
        "files",
        {"id": source_file_filter, "workspace_id": access.workspace_id},
    )


async def list_workspace_connectors(workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    access = await _require_sources_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_connectors",
            CONNECTOR_COLUMNS,
            filters={"workspace_id": access.workspace_id},
            order_by="created_at",
            desc=True,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return [await _serialize_connector(row) for row in rows]


async def get_workspace_connector(connector_id: str, user_id: str) -> tuple[dict[str, Any], WorkspaceAccess]:
    try:
        locator = await select_one_trusted(
            "workspace_connectors",
            CONNECTOR_LOCATOR_COLUMNS,
            {"id": connector_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if locator is None or not locator.get("workspace_id"):
        raise _connector_not_found()

    try:
        access = await _require_sources_access(str(locator["workspace_id"]), user_id)
    except HTTPException as exc:
        if exc.status_code in {status.HTTP_403_FORBIDDEN, status.HTTP_404_NOT_FOUND}:
            raise _connector_not_found() from exc
        raise

    try:
        connector = await select_one_trusted(
            "workspace_connectors",
            CONNECTOR_COLUMNS,
            _connector_scope_filters(access, connector_id),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if connector is None:
        raise _connector_not_found()

    return connector, access


async def create_workspace_connector(payload: ConnectorCreate, user_id: str, active_workspace_id: str | None) -> dict[str, Any]:
    workspace_id = payload.workspace_id or active_workspace_id
    if not workspace_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Workspace scope is required.")

    access = await _require_sources_access(workspace_id, user_id)
    config, display_name, status_value = _normalize_connector_payload(payload)

    connector_payload = {
        "workspace_id": access.workspace_id,
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
        return await _activate_knowledge_link(connector, user_id, access)

    try:
        job = await _insert_setup_job(connector, user_id, access)
        connector = await update_one_trusted(
            "workspace_connectors",
            _connector_scope_filters(access, connector["id"]),
            {"job_id": job.get("id"), "updated_at": _utc_now_iso()},
        ) or connector
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await _serialize_connector(connector)


async def retry_workspace_connector(connector_id: str, user_id: str) -> dict[str, Any]:
    connector, access = await get_workspace_connector(connector_id, user_id)

    if connector["connector_type"] == "knowledge_link":
        try:
            updated = await update_one_trusted(
                "workspace_connectors",
                _connector_scope_filters(access, connector_id),
                {"status": "connecting", "last_error": None, "updated_at": _utc_now_iso()},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        return await _activate_knowledge_link(updated or connector, user_id, access)

    config, _, status_value = _normalize_connector_payload(
        ConnectorCreate(
            workspace_id=access.workspace_id,
            connector_type=connector["connector_type"],
            display_name=connector["display_name"],
            config=connector.get("config") or {},
        )
    )
    try:
        connector = await update_one_trusted(
            "workspace_connectors",
            _connector_scope_filters(access, connector_id),
            {
                "status": status_value,
                "config": config,
                "last_error": None,
                "updated_at": _utc_now_iso(),
            },
        ) or connector
        job = await _insert_setup_job(connector, user_id, access)
        connector = await update_one_trusted(
            "workspace_connectors",
            _connector_scope_filters(access, connector_id),
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

    try:
        await _delete_connector_source_file(connector, access)
        await delete_many_trusted(
            "workspace_connectors",
            _connector_scope_filters(access, connector_id),
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    await log_workspace_activity(
        workspace_id=access.workspace_id,
        actor_user_id=user_id,
        event_type="workspace.source_removed",
        summary=f"{connector.get('display_name') or 'A connector'} was removed from workspace sources.",
        metadata={"connector_id": connector_id, "connector_type": connector.get("connector_type")},
    )


async def _activate_knowledge_link(
    connector: dict[str, Any],
    user_id: str,
    access: WorkspaceAccess,
) -> dict[str, Any]:
    config = connector.get("config") or {}
    url = str(config.get("url") or "")
    fetch_result = await fetch_knowledge_link(url)

    if not fetch_result.ok:
        status_value: ConnectorStatus = "needs_authentication" if fetch_result.auth_required else "request_submitted"
        last_error = fetch_result.error or "The link could not be reached from Omnix infrastructure."
        try:
            job = await _insert_setup_job(connector, user_id, access)
            connector = await update_one_trusted(
                "workspace_connectors",
                _connector_scope_filters(access, connector["id"]),
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
        await _delete_connector_source_file(connector, access)
        file_row = await insert_one(
            "files",
            {
                "user_id": user_id,
                "workspace_id": access.workspace_id,
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
            workspace_id=access.workspace_id,
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
            _connector_scope_filters(access, connector["id"]),
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
                _connector_scope_filters(access, connector["id"]),
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
        workspace_id=access.workspace_id,
        actor_user_id=user_id,
        event_type="workspace.source_connected",
        summary=f"{file_name} was connected as a knowledge link.",
        metadata={"connector_id": str(connector["id"]), "url": fetch_result.url},
    )

    return await _serialize_connector(connector)


async def fetch_knowledge_link(url: str) -> LinkFetchResult:
    if not await _is_public_http_url(url):
        return LinkFetchResult(ok=False, url=url, error="The URL is not allowed for server-side retrieval.")

    current_url = url
    timeout = httpx.Timeout(12.0, connect=4.0)
    headers = {"User-Agent": "OmnixKnowledgeConnector/1.0"}

    try:
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=False) as client:
            for _ in range(REDIRECT_LIMIT + 1):
                if not await _is_public_http_url(current_url):
                    return LinkFetchResult(ok=False, url=current_url, error="The URL is not allowed for server-side retrieval.")

                async with client.stream("GET", current_url, headers=headers) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            break
                        next_url = urljoin(current_url, location)
                        if not await _is_public_http_url(next_url):
                            return LinkFetchResult(ok=False, url=current_url, error="The link redirects to an unsupported or private URL.")
                        current_url = next_url
                        continue
                    return await _parse_link_response_stream(response, current_url)
    except httpx.TimeoutException:
        return LinkFetchResult(ok=False, url=current_url, error="The link timed out while Omnix tried to read it.")
    except httpx.TransportError:
        return LinkFetchResult(ok=False, url=current_url, error="The link could not be reached from Omnix infrastructure.")

    return LinkFetchResult(ok=False, url=current_url, error="The link redirected too many times.")


async def _parse_link_response_stream(response: httpx.Response, url: str) -> LinkFetchResult:
    content_length = response.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_LINK_BYTES:
                return LinkFetchResult(
                    ok=False,
                    url=url,
                    status_code=response.status_code,
                    content_type=(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower() or None,
                    error="The link is too large for Omnix to ingest safely.",
                )
        except ValueError:
            pass

    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_LINK_BYTES:
            return LinkFetchResult(
                ok=False,
                url=url,
                status_code=response.status_code,
                content_type=(response.headers.get("content-type") or "").split(";", 1)[0].strip().lower() or None,
                error="The link is too large for Omnix to ingest safely.",
            )
        chunks.append(chunk)

    return _parse_link_response_bytes(response, url, b"".join(chunks))


def _parse_link_response_bytes(response: httpx.Response, url: str, raw: bytes) -> LinkFetchResult:
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

    if not raw:
        return LinkFetchResult(ok=False, url=url, status_code=status_code, content_type=content_type, error="The link returned no readable content.")

    decoded = raw.decode(response.encoding or "utf-8", errors="ignore")
    title: str | None = None
    if content_type and ("html" in content_type or "xml" in content_type):
        title, text = _extract_html_text(decoded)
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


def _extract_html_text(decoded: str) -> tuple[str | None, str]:
    if BeautifulSoup is not None:
        soup = BeautifulSoup(decoded, "html.parser")
        for element in soup(["script", "style", "noscript", "svg"]):
            element.decompose()
        title = _clean_text(soup.title.string, max_chars=160) if soup.title and soup.title.string else None
        return title, soup.get_text("\n")

    parser = _HTMLTextExtractor()
    parser.feed(decoded)
    parser.close()
    title = _clean_text(" ".join(parser.title_parts), max_chars=160)
    return title, "\n".join(parser.text_parts)


def _clean_link_text(value: str) -> str:
    text = unescape(value or "")
    lines = [re.sub(r"\s+", " ", line).strip() for line in text.splitlines()]
    normalized = "\n".join(line for line in lines if line)
    return normalized[:MAX_LINK_TEXT_CHARS]
