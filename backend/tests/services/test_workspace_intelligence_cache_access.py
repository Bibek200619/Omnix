from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routers import workspaces
from app.services import workspace_access_service as access_service
from app.services import workspace_intelligence_service as intelligence
from app.services import workspace_service
from app.services.supabase_service import SupabaseServiceError


@pytest.fixture
def authoritative_profile(monkeypatch):
    state = SimpleNamespace(
        workspace={
            "id": "workspace-1",
            "user_id": "owner-1",
            "name": "Private release",
            "workspace_type": "workspace",
            "is_global": False,
            "parent_workspace_id": None,
        },
        joined=True,
        deleted=False,
        access_error=False,
        visible=[],
        now=100.0,
    )
    monkeypatch.setattr(intelligence, "_intelligence_profile_cache", {})
    monkeypatch.setattr(intelligence.time, "perf_counter", lambda: state.now)
    monkeypatch.setattr(
        intelligence,
        "require_workspace_access",
        access_service.require_workspace_access,
    )

    async def select_one(table, columns, filters):
        if state.access_error:
            raise SupabaseServiceError("private-db-credential")
        if table == "workspaces":
            if filters["id"] == "parent-1":
                return {
                    "id": "parent-1",
                    "user_id": "owner-1",
                    "workspace_type": "super_workspace",
                    "is_global": False,
                    "parent_workspace_id": None,
                }
            return None if state.deleted else deepcopy(state.workspace)
        assert table == "workspace_members"
        if not state.joined:
            return None
        return {
            "workspace_id": filters["workspace_id"],
            "user_id": filters["user_id"],
            "role": "member",
        }

    lookups = AsyncMock(side_effect=select_one)
    monkeypatch.setattr(access_service, "select_one_trusted", lookups)
    visible = AsyncMock(side_effect=lambda user_id: deepcopy(state.visible))
    monkeypatch.setattr(workspace_service, "list_user_workspaces", visible)

    async def select_sources(table, columns, *, filters, **kwargs):
        if table == "files":
            return [
                {
                    "id": f"file-{wid}",
                    "file_name": f"Private source {wid}",
                    "workspace_id": wid,
                }
                for wid in filters["workspace_id"]
            ]
        if table == "workspace_initiatives":
            return [
                {
                    "id": f"initiative-{wid}",
                    "title": f"Private initiative {wid}",
                    "status": "active",
                }
                for wid in filters["workspace_id"]
            ]
        return []

    reads = AsyncMock(side_effect=select_sources)
    monkeypatch.setattr(intelligence, "select_all_trusted", reads)
    monkeypatch.setattr(
        intelligence, "list_workspace_members", AsyncMock(return_value=[])
    )
    return SimpleNamespace(state=state, reads=reads, lookups=lookups, visible=visible)


async def get_profile(user_id="member-1"):
    return await workspaces.get_workspace_intelligence("workspace-1", {"sub": user_id})


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "change,code", [("revoke", 404), ("delete", 404), ("outage", 500)]
)
async def test_warmed_api_cache_does_not_bypass_real_authorization(
    authoritative_profile, change, code
):
    profile = await get_profile()
    assert profile["connected_sources"][0]["name"] == "Private source workspace-1"
    read_count = authoritative_profile.reads.await_count
    lookup_count = authoritative_profile.lookups.await_count
    if change == "revoke":
        authoritative_profile.state.joined = False
    elif change == "delete":
        authoritative_profile.state.deleted = True
    else:
        authoritative_profile.state.access_error = True
    with pytest.raises(HTTPException) as exc:
        await get_profile()
    assert exc.value.status_code == code
    assert "private-db-credential" not in str(exc.value.detail)
    assert authoritative_profile.lookups.await_count > lookup_count
    assert authoritative_profile.reads.await_count == read_count


@pytest.mark.asyncio
async def test_valid_cache_reuses_sources_but_rechecks_access(authoritative_profile):
    first = await get_profile()
    before = authoritative_profile.lookups.await_count
    second = await get_profile()
    assert first == second
    assert authoritative_profile.reads.await_count == 4
    assert authoritative_profile.lookups.await_count > before


def make_global(state):
    state.workspace.update(
        is_global=True, workspace_type="global_space", parent_workspace_id="parent-1"
    )
    state.visible = [
        deepcopy(state.workspace),
        {"id": "sibling-1", "parent_workspace_id": "parent-1"},
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("change", ["remove", "add"])
async def test_cached_global_profile_uses_current_authorized_scope(
    authoritative_profile, change
):
    state = authoritative_profile.state
    make_global(state)
    await get_profile()
    if change == "remove":
        state.visible = [deepcopy(state.workspace)]
    else:
        state.visible.append({"id": "sibling-2", "parent_workspace_id": "parent-1"})
    profile = await get_profile()
    expected = (
        ["workspace-1"]
        if change == "remove"
        else ["workspace-1", "sibling-1", "sibling-2"]
    )
    assert profile["scope_workspace_ids"] == expected
    assert {source["workspace_id"] for source in profile["connected_sources"]} == set(
        expected
    )
    assert len(profile["active_initiatives"]) == len(expected)
    assert authoritative_profile.reads.await_count == 8
    assert authoritative_profile.visible.await_count == 2


@pytest.mark.asyncio
async def test_scope_lookup_outage_does_not_fall_back_to_cached_global_ids(
    authoritative_profile,
):
    make_global(authoritative_profile.state)
    await get_profile()
    authoritative_profile.visible.side_effect = HTTPException(
        500, "Database unavailable."
    )
    with pytest.raises(HTTPException) as exc:
        await get_profile()
    assert exc.value.status_code == 500
    assert authoritative_profile.reads.await_count == 4


@pytest.mark.asyncio
async def test_global_to_isolated_change_discards_cached_sibling_context(
    authoritative_profile,
):
    state = authoritative_profile.state
    make_global(state)
    await get_profile()
    state.workspace.update(
        is_global=False,
        workspace_type="subspace",
        intelligence_preferences={"retrieval_scope": "workspace"},
    )
    result = await get_profile()
    assert result["scope_workspace_ids"] == ["workspace-1"]
    assert result["retrieval_scope"] == "workspace"
    assert result["source_count"] == 1
    assert authoritative_profile.reads.await_count == 8


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "field,value",
    [
        ("ai_instructions", "Use updated workspace policy"),
        ("name", "Renamed release"),
        ("workspace_focus", "research"),
        (
            "intelligence_preferences",
            {"retrieval_scope": "workspace", "custom_setting": "new"},
        ),
    ],
)
async def test_workspace_edits_invalidate_cached_policy(
    authoritative_profile, field, value
):
    await get_profile()
    authoritative_profile.state.workspace[field] = value
    result = await get_profile()
    assert authoritative_profile.reads.await_count == 8
    if field in ("name", "ai_instructions"):
        assert result["workspace_name" if field == "name" else field] == value


@pytest.mark.asyncio
async def test_returned_profile_mutation_cannot_poison_later_cache_hits(
    authoritative_profile,
):
    first = await get_profile()
    first["scope_workspace_ids"].append("foreign-workspace")
    first["connected_sources"][0]["name"] = "poisoned"
    first["active_initiatives"][0]["title"] = "poisoned"
    second = await get_profile()
    assert second["scope_workspace_ids"] == ["workspace-1"]
    assert second["connected_sources"][0]["name"] == "Private source workspace-1"
    assert second["active_initiatives"][0]["title"] == "Private initiative workspace-1"
    assert authoritative_profile.reads.await_count == 4
    second["scope_workspace_ids"].append("foreign-workspace")
    third = await get_profile()
    assert third["scope_workspace_ids"] == ["workspace-1"]


@pytest.mark.asyncio
async def test_cache_expires_and_does_not_cross_user_boundary(authoritative_profile):
    await get_profile()
    authoritative_profile.state.now += intelligence.INTELLIGENCE_CACHE_TTL
    await get_profile()
    assert authoritative_profile.reads.await_count == 8
    await get_profile("member-2")
    assert authoritative_profile.reads.await_count == 12
