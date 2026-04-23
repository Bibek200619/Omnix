from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from ..services.supabase_service import select_all_trusted
from .workspace_service import (
    list_subspaces_for_super_workspace,
    list_workspace_members,
    normalize_ai_specialization,
    normalize_intelligence_preferences,
    normalize_workspace_record,
    require_workspace_access,
)

FILE_COLUMNS = "id,file_name,file_type,workspace_id,metadata,created_at"
CONVERSATION_COLUMNS = "id,title,workspace_id,last_message_at,updated_at,created_at"
DOMAIN_RE = re.compile(r"[A-Za-z][A-Za-z0-9+#-]{2,}")


def _text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _source_payload(row: dict[str, Any]) -> dict[str, Any]:
    metadata = row.get("metadata") if isinstance(row.get("metadata"), Mapping) else {}
    return {
        "id": str(row.get("id") or ""),
        "name": row.get("file_name") or "Workspace source",
        "type": row.get("file_type") or metadata.get("source_type") or "document",
        "workspace_id": str(row.get("workspace_id") or ""),
        "created_at": row.get("created_at"),
    }


def _domain_candidates(workspace: dict[str, Any], files: list[dict[str, Any]]) -> list[str]:
    text_blocks = [
        workspace.get("description") or "",
        workspace.get("expertise_area") or "",
        workspace.get("ai_specialization") or "",
    ]
    text_blocks.extend(str(file.get("file_name") or "") for file in files)
    text_blocks.extend(str(file.get("file_type") or "") for file in files)

    stopwords = {
        "workspace",
        "document",
        "documents",
        "source",
        "sources",
        "application",
        "plain",
        "markdown",
        "octet",
        "stream",
        "uploaded",
        "team",
        "global",
        "general",
    }
    counts: dict[str, int] = {}
    for block in text_blocks:
        for token in DOMAIN_RE.findall(block):
            normalized = token.strip("-_").lower()
            if len(normalized) < 3 or normalized in stopwords:
                continue
            counts[normalized] = counts.get(normalized, 0) + 1

    return [
        token
        for token, _ in sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:8]
    ]


def _insights(
    workspace: dict[str, Any],
    *,
    source_count: int,
    conversation_count: int,
    member_count: int,
    domains: list[str],
) -> list[str]:
    insights: list[str] = []
    if source_count:
        insights.append(f"{source_count} connected source{'s' if source_count != 1 else ''} shape this workspace context.")
    else:
        insights.append("No knowledge sources are connected yet.")
    if domains:
        insights.append(f"Active knowledge domains: {', '.join(domains[:4])}.")
    if conversation_count:
        insights.append(f"{conversation_count} AI conversation{'s' if conversation_count != 1 else ''} are scoped to this workspace.")
    if workspace.get("is_global"):
        insights.append("Global intelligence can draw from the parent workspace and sibling subspaces.")
    elif member_count > 1:
        insights.append("Collaborative memory is shared with workspace members.")
    return insights[:4]


def _summary(workspace: dict[str, Any], domains: list[str], source_count: int) -> str:
    name = workspace.get("name") or "This workspace"
    specialization = normalize_ai_specialization(workspace.get("ai_specialization"))
    expertise = _text(workspace.get("expertise_area"))
    if expertise:
        return f"{name} specializes in {expertise}. AI mode is {specialization}; {source_count} source(s) are active."
    if domains:
        return f"{name} is currently oriented around {', '.join(domains[:4])}. AI mode is {specialization}; {source_count} source(s) are active."
    return f"{name} is using {specialization} mode with workspace-scoped memory."


async def workspace_retrieval_scope_ids(
    workspace: dict[str, Any],
    user_id: str,
) -> list[str]:
    """
    ARCHITECTURE NOTE (Shared Organizational Memory):
    This function defines the 'Knowledge Hub' logic for Omnix. 
    Global workspaces act as bridges between disparate teams, while Isolated 
    workspaces maintain strict privacy boundaries. 
    
    Future agents will utilize these scope IDs to navigate the organizational 
    intelligence graph safely.
    """
    normalized = normalize_workspace_record(workspace)
    workspace_id = str(normalized["id"])
    preferences = normalized.get("intelligence_preferences") or {}
    source_perms = preferences.get("source_permissions")

    # If organization-wide access is enabled, we could return all accessible workspaces.
    # For now, we strictly follow the hierarchy.
    if source_perms == "organization":
        # Placeholder for future global cross-team discovery
        pass

    if not normalized.get("is_global") and preferences.get("retrieval_scope") != "global":
        return [workspace_id]

    parent_id = str(normalized.get("parent_workspace_id") or "")
    if not parent_id:
        return [workspace_id]

    subspaces = await list_subspaces_for_super_workspace(parent_id, user_id)
    ids = [parent_id]
    ids.extend(str(subspace["id"]) for subspace in subspaces if subspace.get("id"))
    
    # Ensure the requested workspace is always included even if it's not in the subspace list (race condition safety)
    if workspace_id not in ids:
        ids.append(workspace_id)
        
    return list(dict.fromkeys(ids))


async def build_workspace_intelligence_profile(
    workspace_id: str,
    user_id: str,
) -> dict[str, Any]:
    access = await require_workspace_access(workspace_id, user_id)
    workspace = normalize_workspace_record(access.workspace)
    scope_ids = await workspace_retrieval_scope_ids(workspace, user_id)

    files = await select_all_trusted(
        "files",
        FILE_COLUMNS,
        filters={"workspace_id": scope_ids},
        order_by="created_at",
        desc=True,
        limit=50,
    )
    scoped_files = [
        row for row in files if str(row.get("workspace_id") or "") in set(scope_ids)
    ]

    conversations = await select_all_trusted(
        "conversations",
        CONVERSATION_COLUMNS,
        filters={"workspace_id": scope_ids},
        order_by="updated_at",
        desc=True,
        limit=20,
    )
    scoped_conversations = [
        row for row in conversations if str(row.get("workspace_id") or "") in set(scope_ids)
    ]

    members = await list_workspace_members(workspace)
    domains = _domain_candidates(workspace, scoped_files)
    preferences = normalize_intelligence_preferences(
        workspace.get("intelligence_preferences"),
        is_global=bool(workspace.get("is_global")),
    )

    retrieval_scope = "global" if workspace.get("is_global") or preferences.get("retrieval_scope") == "global" else "workspace"
    profile = {
        "workspace_id": str(workspace["id"]),
        "workspace_name": str(workspace.get("name") or "Workspace"),
        "workspace_type": workspace.get("workspace_type") or "super_workspace",
        "is_global": bool(workspace.get("is_global")),
        "parent_workspace_id": workspace.get("parent_workspace_id"),
        "description": workspace.get("description"),
        "expertise_area": workspace.get("expertise_area"),
        "ai_specialization": normalize_ai_specialization(workspace.get("ai_specialization")),
        "ai_instructions": workspace.get("ai_instructions"),
        "intelligence_preferences": preferences,
        "source_count": len(scoped_files),
        "conversation_count": len(scoped_conversations),
        "member_count": len(members),
        "active_domains": domains,
        "connected_sources": [_source_payload(row) for row in scoped_files[:8]],
        "retrieval_scope": retrieval_scope,
        "scope_workspace_ids": scope_ids,
    }
    profile["context_summary"] = _summary(workspace, domains, len(scoped_files))
    profile["recent_insights"] = _insights(
        workspace,
        source_count=len(scoped_files),
        conversation_count=len(scoped_conversations),
        member_count=len(members),
        domains=domains,
    )
    return profile


def workspace_intelligence_system_prompt(profile: dict[str, Any] | None) -> str:
    if not profile:
        return ""
    preferences = profile.get("intelligence_preferences")
    if isinstance(preferences, Mapping) and preferences.get("memory_enabled") is False:
        return ""

    lines = [
        "WORKSPACE INTELLIGENCE PROFILE:",
        f"- Active workspace: {profile.get('workspace_name')} ({profile.get('workspace_type')})",
        f"- AI specialization mode: {profile.get('ai_specialization') or 'general'}",
        f"- Retrieval scope: {profile.get('retrieval_scope') or 'workspace'}",
        f"- Context summary: {profile.get('context_summary')}",
    ]
    if profile.get("description"):
        lines.append(f"- Workspace description: {profile['description']}")
    if profile.get("expertise_area"):
        lines.append(f"- Expertise area: {profile['expertise_area']}")
    if profile.get("active_domains"):
        lines.append(f"- Active knowledge domains: {', '.join(profile['active_domains'][:8])}")
    if profile.get("source_count") is not None:
        lines.append(f"- Connected sources in scope: {profile.get('source_count')}")
    if profile.get("ai_instructions"):
        lines.append(f"- Workspace instructions: {profile['ai_instructions']}")

    lines.extend(
        [
            "",
            "Use this profile to adapt terminology, assumptions, and collaboration style.",
            "Prefer workspace-scoped knowledge and cite retrieved sources when available.",
            "If the profile or sources do not contain the answer, say what is missing before using general knowledge.",
        ]
    )
    return "\n".join(line for line in lines if line is not None)
