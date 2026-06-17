from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.routers import workspaces
from app.schemas.chat import WorkspaceIntelligenceUpdate


@pytest.mark.asyncio
async def test_update_workspace_intelligence_invalidates_profile_cache(monkeypatch: pytest.MonkeyPatch) -> None:
    invalidated: list[str] = []
    workspace = {
        "id": "workspace-1",
        "user_id": "user-1",
        "name": "Engineering",
        "workspace_type": "super_workspace",
        "workspace_focus": "general",
        "ai_specialization": "general",
        "intelligence_preferences": {},
        "is_global": False,
    }

    async def allow_management(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace=workspace, role="founder")

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]):
        return {**workspace, **payload}

    async def fake_log(*args, **kwargs):
        return None

    async def fake_profile(workspace_id: str, user_id: str):
        return {
            "workspace_id": workspace_id,
            "workspace_name": "Engineering",
            "workspace_type": "super_workspace",
            "workspace_focus": "engineering",
            "ai_specialization": "engineering",
            "intelligence_preferences": {},
            "source_count": 0,
            "conversation_count": 0,
            "member_count": 1,
            "active_domains": [],
            "connected_sources": [],
            "retrieval_scope": "workspace",
            "scope_workspace_ids": [workspace_id],
            "active_initiatives": [],
            "unresolved_continuity": [],
            "context_summary": "Updated.",
            "recent_insights": [],
        }

    async def fake_invalidate(workspace_id: str, user_id: str | None = None, *, publish: bool = True):
        invalidated.append(workspace_id)

    monkeypatch.setattr(workspaces, "require_workspace_management_access", allow_management)
    monkeypatch.setattr(workspaces, "update_one_trusted", fake_update)
    monkeypatch.setattr(workspaces, "log_workspace_activity", fake_log)
    monkeypatch.setattr(workspaces, "build_workspace_intelligence_profile", fake_profile)
    monkeypatch.setattr(workspaces, "invalidate_workspace_intelligence_cache", fake_invalidate, raising=False)

    await workspaces.update_workspace_intelligence(
        "workspace-1",
        WorkspaceIntelligenceUpdate(workspace_focus="engineering", ai_instructions="Use RFC language."),
        current_user={"sub": "user-1"},
    )

    assert invalidated == ["workspace-1"]
