from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import logging
import re
from typing import Any

from fastapi import HTTPException, status

from .supabase_service import (
    SupabaseServiceError,
    delete_one_trusted,
    insert_one_trusted,
    select_all_trusted,
    select_one_trusted,
    update_one_trusted,
)
from .workspace_access_service import require_workspace_access
from .workspace_collaboration_service import log_workspace_activity
from .workspace_common import utc_now_iso
from .decision_candidate_service import log_candidate_metrics
from .workspace_conversation_service import MESSAGE_COLUMNS, _require_channel_access
from .workspace_membership_service import get_profiles
from .workspace_mention_service import (
    mention_metadata_for_sources,
    prepare_mentions_for_workspace,
    sync_mentions_for_source,
)

DECISION_COLUMNS = (
    "id,workspace_id,title,description,decision_reason,status,source_type,source_id,source_message_id,"
    "source_channel_id,source_evidence,initiative_id,client_nonce,created_by,created_at,updated_at"
)
TASK_PREVIEW_COLUMNS = "id,title,status,owner_user_id"
INITIATIVE_PREVIEW_COLUMNS = "id,title,status,momentum_state"
DECISION_STATUSES = ("proposed", "accepted", "rejected", "superseded")
DECISION_SOURCE_TYPES = {"conversation", "conversation_message", "document"}
EVIDENCE_KINDS = {"conversation_message", "document_chunk"}
MAX_EVIDENCE_ITEMS = 5
MAX_EVIDENCE_QUOTE_CHARS = 420
_SHA256_RE = re.compile(r"^[a-f0-9]{64}$")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _DecisionCreationOutcome:
    decision: dict[str, Any]
    created_now: bool


def _database_error() -> HTTPException:
    return HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


def _not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Decision not found.")


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip()
    return cleaned or None


def _is_client_nonce_unique_violation(exc: SupabaseServiceError) -> bool:
    root_error = exc.__cause__ or exc
    code = str(getattr(root_error, "code", ""))
    message = str(root_error).lower()
    return code == "23505" and (
        "ux_workspace_decisions_client_nonce" in message
        or "client_nonce" in message
    )


async def _decision_by_client_nonce(
    *, workspace_id: str, user_id: str, client_nonce: str
) -> dict[str, Any] | None:
    try:
        return await select_one_trusted(
            "workspace_decisions",
            DECISION_COLUMNS,
            {
                "workspace_id": workspace_id,
                "created_by": user_id,
                "client_nonce": client_nonce,
            },
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc


def _title_from_text(content: Any) -> str:
    normalized = " ".join(str(content or "").split())
    if not normalized:
        return "Recorded decision"
    return normalized if len(normalized) <= 110 else f"{normalized[:107].rstrip()}..."


async def _hydrate_decisions(rows: list[dict[str, Any]], expand_links: bool = False) -> list[dict[str, Any]]:
    mentions_by_source: dict[str, list[dict[str, Any]]] = {}
    workspace_ids = sorted({str(row.get("workspace_id")) for row in rows if row.get("workspace_id")})
    for workspace_id in workspace_ids:
        source_ids = [str(row.get("id")) for row in rows if str(row.get("workspace_id") or "") == workspace_id and row.get("id")]
        mentions_by_source.update(
            await mention_metadata_for_sources(
                workspace_id=workspace_id,
                source_type="decision",
                source_ids=source_ids,
            )
        )
    creator_ids = sorted({str(row.get("created_by")) for row in rows if row.get("created_by")})
    profiles = await get_profiles(creator_ids)
    hydrated: list[dict[str, Any]] = []
    for row in rows:
        creator = profiles.get(str(row.get("created_by") or ""), {})
        item = {
            **row,
            "creator_name": creator.get("full_name") or creator.get("handle") or creator.get("email"),
            "creator_email": creator.get("email"),
            "creator_avatar_label": creator.get("avatar_label"),
            "mentions": mentions_by_source.get(str(row.get("id")), []),
            "linked_tasks": [],
            "initiative": None,
        }

        if expand_links:
            workspace_id = row.get("workspace_id")
            # Fetch linked tasks
            try:
                link_filters: dict[str, Any] = {"decision_id": row["id"]}
                if workspace_id:
                    link_filters["workspace_id"] = workspace_id
                task_links = await select_all_trusted(
                    "workspace_decision_tasks",
                    "task_id",
                    link_filters,
                )
                if task_links:
                    task_ids = [str(tl["task_id"]) for tl in task_links]
                    task_filters: dict[str, Any] = {"id": task_ids}
                    if workspace_id:
                        task_filters["workspace_id"] = workspace_id
                    tasks = await select_all_trusted(
                        "workspace_tasks",
                        TASK_PREVIEW_COLUMNS,
                        task_filters,
                    )
                    item["linked_tasks"] = tasks
            except SupabaseServiceError:
                logger.warning("Decision linked task hydration failed | decision_id=%s", row.get("id"), exc_info=True)

            # Fetch initiative
            if row.get("initiative_id"):
                try:
                    initiative_filters: dict[str, Any] = {"id": row["initiative_id"]}
                    if workspace_id:
                        initiative_filters["workspace_id"] = workspace_id
                    initiative = await select_one_trusted(
                        "workspace_initiatives",
                        INITIATIVE_PREVIEW_COLUMNS,
                        initiative_filters,
                    )
                    item["initiative"] = initiative
                except SupabaseServiceError:
                    logger.warning("Decision initiative hydration failed | decision_id=%s", row.get("id"), exc_info=True)

        hydrated.append(item)
    return hydrated


def _normalize_status(value: Any) -> str:
    decision_status = str(value or "accepted")
    if decision_status not in DECISION_STATUSES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported decision status.")
    return decision_status


def _normalize_source_type(value: Any) -> str | None:
    source_type = _clean_text(value)
    if source_type is None:
        return None
    if source_type not in DECISION_SOURCE_TYPES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported decision source type.")
    return source_type


def _evidence_identifier(value: Any, *, field: str) -> str:
    identifier = _clean_text(value)
    if not identifier or len(identifier) > 160:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Candidate evidence {field} is invalid.")
    return identifier


def _evidence_integer(value: Any, *, field: str) -> int:
    if isinstance(value, bool):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Candidate evidence {field} is invalid.")
    try:
        integer = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Candidate evidence {field} is invalid.") from exc
    if integer < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Candidate evidence {field} is invalid.")
    return integer


def _evidence_page(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    try:
        page = int(value)
    except (TypeError, ValueError):
        return None
    return page if page > 0 else None


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _stale_evidence() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Candidate evidence is stale. Scan the source again before recording this decision.",
    )


async def _validated_candidate_evidence(
    *,
    workspace_id: str,
    resolved_source_type: str | None,
    resolved_source_id: str | None,
    evidence_values: Any,
) -> list[dict[str, Any]]:
    """Reload and canonicalize every candidate anchor before persisting it.

    The browser only supplies a claim. The workspace-scoped source row is the
    authority for the source IDs, quote span, source revision hash, page, and
    chunk index that are written to a decision.
    """

    if resolved_source_type not in {"conversation", "document"} or not resolved_source_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate evidence requires a conversation or document source.",
        )
    if not isinstance(evidence_values, list) or not evidence_values or len(evidence_values) > MAX_EVIDENCE_ITEMS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Candidate evidence must include between one and five source references.",
        )

    canonical: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int, int]] = set()
    for raw_evidence in evidence_values:
        if not isinstance(raw_evidence, Mapping):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence is invalid.")
        kind = _clean_text(raw_evidence.get("kind"))
        if kind not in EVIDENCE_KINDS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence kind is invalid.")
        quote = raw_evidence.get("quote")
        if not isinstance(quote, str) or not quote.strip() or len(quote) > MAX_EVIDENCE_QUOTE_CHARS:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence quote is invalid.")
        supplied_hash = str(raw_evidence.get("source_content_hash") or "")
        if not _SHA256_RE.fullmatch(supplied_hash):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence revision is invalid.")
        char_start = _evidence_integer(raw_evidence.get("char_start"), field="start offset")
        char_end = _evidence_integer(raw_evidence.get("char_end"), field="end offset")
        if char_end <= char_start:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence range is invalid.")

        if resolved_source_type == "conversation":
            if kind != "conversation_message":
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence does not match its conversation source.")
            channel_id = _evidence_identifier(raw_evidence.get("channel_id"), field="channel identifier")
            message_id = _evidence_identifier(raw_evidence.get("message_id"), field="message identifier")
            if channel_id != resolved_source_id:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence is not in the selected conversation.")
            try:
                source_row = await select_one_trusted(
                    "workspace_channel_messages",
                    "id,workspace_id,channel_id,content,updated_at",
                    {"id": message_id, "workspace_id": workspace_id, "channel_id": channel_id},
                )
            except SupabaseServiceError as exc:
                raise _database_error() from exc
            if source_row is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence message is not in this workspace.")
            content = str(source_row.get("content") or "")
            current_hash = _content_hash(content)
            if current_hash != supplied_hash:
                raise _stale_evidence()
            if char_end > len(content) or content[char_start:char_end] != quote:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence quote does not match its source.")
            key = (kind, message_id, char_start, char_end)
            if key in seen:
                continue
            seen.add(key)
            canonical.append(
                {
                    "kind": kind,
                    "channel_id": channel_id,
                    "message_id": message_id,
                    "char_start": char_start,
                    "char_end": char_end,
                    "quote": quote,
                    "quote_sha256": _content_hash(quote),
                    "source_content_hash": current_hash,
                    "source_updated_at": source_row.get("updated_at"),
                }
            )
            continue

        if kind != "document_chunk":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence does not match its document source.")
        file_id = _evidence_identifier(raw_evidence.get("file_id"), field="file identifier")
        chunk_id = _evidence_identifier(raw_evidence.get("chunk_id"), field="chunk identifier")
        chunk_index = _evidence_integer(raw_evidence.get("chunk_index"), field="chunk index")
        if file_id != resolved_source_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence is not in the selected document.")
        try:
            source_row = await select_one_trusted(
                "documents",
                "id,file_id,workspace_id,content,chunk_index,metadata,updated_at",
                {"id": chunk_id, "file_id": file_id, "workspace_id": workspace_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if source_row is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence document chunk is not in this workspace.")
        actual_chunk_index = _evidence_integer(source_row.get("chunk_index"), field="chunk index")
        if actual_chunk_index != chunk_index:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence chunk does not match its source.")
        content = str(source_row.get("content") or "")
        current_hash = _content_hash(content)
        if current_hash != supplied_hash:
            raise _stale_evidence()
        if char_end > len(content) or content[char_start:char_end] != quote:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence quote does not match its source.")
        key = (kind, chunk_id, char_start, char_end)
        if key in seen:
            continue
        seen.add(key)
        metadata = source_row.get("metadata") if isinstance(source_row.get("metadata"), Mapping) else {}
        evidence = {
            "kind": kind,
            "file_id": file_id,
            "chunk_id": chunk_id,
            "chunk_index": actual_chunk_index,
            "char_start": char_start,
            "char_end": char_end,
            "quote": quote,
            "quote_sha256": _content_hash(quote),
            "source_content_hash": current_hash,
            "source_updated_at": source_row.get("updated_at"),
        }
        page = _evidence_page(metadata.get("page"))
        if page is not None:
            evidence["page"] = page
        canonical.append(evidence)

    if not canonical:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Candidate evidence is invalid.")
    return canonical


async def _resolve_source_reference(
    *,
    workspace_id: str,
    user_id: str,
    source_type: Any,
    source_id: Any,
    source_channel_id: str | None,
    source_message_id: str | None,
) -> tuple[str | None, str | None, str | None, str | None]:
    resolved_type = _normalize_source_type(source_type)
    resolved_id = _clean_text(source_id)
    resolved_channel_id = _clean_text(source_channel_id)
    resolved_message_id = _clean_text(source_message_id)

    if resolved_id and len(resolved_id) > 160:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision source identifier is too long.")
    if resolved_type and not resolved_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision source identifier is required.")
    if resolved_id and not resolved_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision source type is required.")

    if resolved_type is None:
        if resolved_message_id:
            resolved_type = "conversation_message"
            resolved_id = resolved_message_id
        elif resolved_channel_id:
            resolved_type = "conversation"
            resolved_id = resolved_channel_id

    if resolved_type is None:
        return None, None, resolved_channel_id, resolved_message_id

    if resolved_type == "conversation":
        await _require_channel_access(workspace_id=workspace_id, channel_id=str(resolved_id), user_id=user_id)
        return resolved_type, resolved_id, resolved_id, resolved_message_id

    if resolved_type == "conversation_message":
        if not resolved_channel_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Conversation message decision sources require a source channel.",
            )
        try:
            message = await select_one_trusted(
                "workspace_channel_messages",
                "id",
                {"id": resolved_id, "workspace_id": workspace_id, "channel_id": resolved_channel_id},
            )
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if message is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision source message is not in this workspace.")
        return resolved_type, resolved_id, resolved_channel_id, resolved_id

    try:
        file_row = await select_one_trusted("files", "id", {"id": resolved_id, "workspace_id": workspace_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if file_row is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision source document is not in this workspace.")
    return resolved_type, resolved_id, resolved_channel_id, resolved_message_id


async def validate_candidate_metric_source(
    *,
    workspace_id: str,
    user_id: str,
    source_type: str,
    source_id: str,
) -> None:
    """Do not record candidate activity for a source outside the active workspace."""

    await _resolve_source_reference(
        workspace_id=workspace_id,
        user_id=user_id,
        source_type=source_type,
        source_id=source_id,
        source_channel_id=None,
        source_message_id=None,
    )


async def list_decisions(*, workspace_id: str, user_id: str) -> list[dict[str, Any]]:
    await require_workspace_access(workspace_id, user_id)
    try:
        rows = await select_all_trusted(
            "workspace_decisions",
            DECISION_COLUMNS,
            filters={"workspace_id": workspace_id},
            order_by="updated_at",
            desc=True,
            limit=300,
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    return await _hydrate_decisions(rows)


async def require_decision(*, workspace_id: str, decision_id: str, user_id: str) -> dict[str, Any]:
    await require_workspace_access(workspace_id, user_id)
    try:
        row = await select_one_trusted(
            "workspace_decisions",
            DECISION_COLUMNS,
            {"id": decision_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if row is None:
        raise _not_found()
    return row


async def get_decision(*, workspace_id: str, decision_id: str, user_id: str) -> dict[str, Any]:
    row = await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    return (await _hydrate_decisions([row], expand_links=True))[0]


async def update_decision_status(
    *,
    workspace_id: str,
    decision_id: str,
    user_id: str,
    status: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    timestamp = utc_now_iso()
    try:
        updated = await update_one_trusted(
            "workspace_decisions",
            {"id": decision_id, "workspace_id": workspace_id},
            {"status": _normalize_status(status), "updated_at": timestamp},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if updated is None:
        raise _not_found()

    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="decision.status_updated",
        summary=f"Decision status updated to {status}: {updated.get('title')}.",
        metadata={"decision_id": decision_id, "status": status},
    )
    return (await _hydrate_decisions([updated], expand_links=True))[0]


async def link_task_to_decision(
    *,
    workspace_id: str,
    decision_id: str,
    task_id: str,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    # Verify task exists in workspace
    try:
        task = await select_one_trusted("workspace_tasks", "id", {"id": task_id, "workspace_id": workspace_id})
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if not task:
        raise HTTPException(status_code=404, detail="Task not found in this workspace.")

    try:
        await insert_one_trusted(
            "workspace_decision_tasks",
            {"decision_id": decision_id, "task_id": task_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        # Check if already linked (Pkey violation)
        if "duplicate key" not in str(exc).lower():
            raise _database_error() from exc

    return await get_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)


async def unlink_task_from_decision(
    *,
    workspace_id: str,
    decision_id: str,
    task_id: str,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)
    try:
        await delete_one_trusted(
            "workspace_decision_tasks",
            {"decision_id": decision_id, "task_id": task_id, "workspace_id": workspace_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    return await get_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)


async def link_initiative_to_decision(
    *,
    workspace_id: str,
    decision_id: str,
    initiative_id: str | None,
    user_id: str,
) -> dict[str, Any]:
    await require_decision(workspace_id=workspace_id, decision_id=decision_id, user_id=user_id)

    if initiative_id:
        # Verify initiative exists
        try:
            init = await select_one_trusted("workspace_initiatives", "id", {"id": initiative_id, "workspace_id": workspace_id})
        except SupabaseServiceError as exc:
            raise _database_error() from exc
        if not init:
            raise HTTPException(status_code=404, detail="Initiative not found in this workspace.")

    timestamp = utc_now_iso()
    try:
        updated = await update_one_trusted(
            "workspace_decisions",
            {"id": decision_id, "workspace_id": workspace_id},
            {"initiative_id": initiative_id, "updated_at": timestamp},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc

    if updated is None:
        raise _not_found()

    return (await _hydrate_decisions([updated], expand_links=True))[0]


async def _create_decision_with_outcome(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    origin: str = "manual",
    source_type: str | None = None,
    source_id: str | None = None,
    source_channel_id: str | None = None,
    source_message_id: str | None = None,
    require_verified_evidence: bool = False,
) -> _DecisionCreationOutcome:
    access = await require_workspace_access(workspace_id, user_id)
    client_nonce = _clean_text(payload.get("client_nonce"))
    if client_nonce:
        existing = await _decision_by_client_nonce(
            workspace_id=workspace_id,
            user_id=user_id,
            client_nonce=client_nonce,
        )
        if existing is not None:
            return _DecisionCreationOutcome(
                decision=(await _hydrate_decisions([existing]))[0],
                created_now=False,
            )
    if origin == "decision_candidate" and not require_verified_evidence:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Decision candidates must include verified source evidence.",
        )
    title = _clean_text(payload.get("title"))
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision title cannot be empty.")
    resolved_source_type, resolved_source_id, resolved_source_channel_id, resolved_source_message_id = await _resolve_source_reference(
        workspace_id=workspace_id,
        user_id=user_id,
        source_type=source_type if source_type is not None else payload.get("source_type"),
        source_id=source_id if source_id is not None else payload.get("source_id"),
        source_channel_id=source_channel_id,
        source_message_id=source_message_id,
    )
    decision_reason = _clean_text(payload.get("decision_reason"))
    if not decision_reason and not (resolved_source_type and resolved_source_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Decision rationale or source evidence is required.",
        )
    source_evidence: list[dict[str, Any]] = []
    if require_verified_evidence:
        source_evidence = await _validated_candidate_evidence(
            workspace_id=workspace_id,
            resolved_source_type=resolved_source_type,
            resolved_source_id=resolved_source_id,
            evidence_values=payload.get("source_evidence"),
        )
    mentions = await prepare_mentions_for_workspace(
        workspace=access.workspace,
        mentions=payload.get("mentions"),
    )

    timestamp = utc_now_iso()
    record = {
        "workspace_id": workspace_id,
        "title": title,
        "description": _clean_text(payload.get("description")),
        "decision_reason": decision_reason,
        "status": _normalize_status(payload.get("status")),
        "source_type": resolved_source_type,
        "source_id": resolved_source_id,
        "source_message_id": resolved_source_message_id,
        "source_channel_id": resolved_source_channel_id,
        "source_evidence": source_evidence,
        "client_nonce": client_nonce,
        "created_by": user_id,
        "updated_at": timestamp,
    }
    try:
        created = await insert_one_trusted("workspace_decisions", record)
    except SupabaseServiceError as exc:
        if client_nonce and _is_client_nonce_unique_violation(exc):
            existing = await _decision_by_client_nonce(
                workspace_id=workspace_id,
                user_id=user_id,
                client_nonce=client_nonce,
            )
            if existing is not None:
                return _DecisionCreationOutcome(
                    decision=(await _hydrate_decisions([existing]))[0],
                    created_now=False,
                )
        raise _database_error() from exc
    await sync_mentions_for_source(
        workspace_id=workspace_id,
        mentioned_by_user_id=user_id,
        source_type="decision",
        source_id=str(created["id"]),
        mentions=mentions,
    )
    await log_workspace_activity(
        workspace_id=workspace_id,
        actor_user_id=user_id,
        event_type="decision.created",
        summary=f"Decision recorded: {title}.",
        metadata={
            "decision_id": created.get("id"),
            "status": record["status"],
            "origin": origin,
            "source_type": resolved_source_type,
            "source_id": resolved_source_id,
            "source_channel_id": resolved_source_channel_id,
            "source_message_id": resolved_source_message_id,
        },
    )
    return _DecisionCreationOutcome(
        decision=(await _hydrate_decisions([created]))[0],
        created_now=True,
    )


async def create_decision(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
    origin: str = "manual",
    source_type: str | None = None,
    source_id: str | None = None,
    source_channel_id: str | None = None,
    source_message_id: str | None = None,
    require_verified_evidence: bool = False,
) -> dict[str, Any]:
    outcome = await _create_decision_with_outcome(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
        origin=origin,
        source_type=source_type,
        source_id=source_id,
        source_channel_id=source_channel_id,
        source_message_id=source_message_id,
        require_verified_evidence=require_verified_evidence,
    )
    return outcome.decision


async def create_decision_from_candidate(
    *,
    workspace_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    """Create a decision only after source evidence has been revalidated."""

    outcome = await _create_decision_with_outcome(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=payload,
        origin="decision_candidate",
        source_type=_clean_text(payload.get("source_type")),
        source_id=_clean_text(payload.get("source_id")),
        require_verified_evidence=True,
    )
    if outcome.created_now:
        try:
            await log_candidate_metrics(
                workspace_id=workspace_id,
                user_id=user_id,
                source_type=str(payload.get("source_type")),
                source_id=str(payload.get("source_id")),
                action="accept",
                candidate_id=_clean_text(payload.get("candidate_id")),
            )
        except Exception:
            logger.warning("Decision candidate acceptance metric could not be recorded.", exc_info=True)
    return outcome.decision


async def create_decision_from_message(
    *,
    workspace_id: str,
    channel_id: str,
    message_id: str,
    user_id: str,
    payload: Mapping[str, Any],
) -> dict[str, Any]:
    await _require_channel_access(
        workspace_id=workspace_id,
        channel_id=channel_id,
        user_id=user_id,
    )
    try:
        message = await select_one_trusted(
            "workspace_channel_messages",
            MESSAGE_COLUMNS,
            {"id": message_id, "workspace_id": workspace_id, "channel_id": channel_id},
        )
    except SupabaseServiceError as exc:
        raise _database_error() from exc
    if message is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation message not found.")

    source_content = str(message.get("content") or "")
    decision_payload = {
        **payload,
        "title": _clean_text(payload.get("title")) or _title_from_text(source_content),
        "description": _clean_text(payload.get("description")) or source_content,
    }
    return await create_decision(
        workspace_id=workspace_id,
        user_id=user_id,
        payload=decision_payload,
        origin="conversation_message",
        source_type="conversation_message",
        source_id=message_id,
        source_channel_id=channel_id,
        source_message_id=message_id,
    )
