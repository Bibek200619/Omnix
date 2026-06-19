import pytest
from fastapi import status, HTTPException
from app.routers.workspaces import remove_workspace_member

@pytest.fixture(autouse=True)
def mock_db_services(monkeypatch):
    # Mock require_workspace_access
    async def mock_require_access(wid, uid):
        # Default behavior, can be overridden in specific tests if needed
        return type("Access", (), {
            "workspace": {"id": wid, "workspace_type": "workspace", "parent_workspace_id": None, "user_id": "founder-1"},
            "role": "founder",
            "membership_workspace": {"id": wid}
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)

    # Mock select_one_trusted
    async def mock_select_one(table, columns, filters):
        if table == "workspace_members":
            if isinstance(filters.get("workspace_id"), list):
                return None
            return {"workspace_id": filters.get("workspace_id"), "user_id": filters.get("user_id"), "role": "member"}
        return None
    monkeypatch.setattr("app.routers.workspaces.select_one_trusted", mock_select_one)

    # Mock select_all_trusted
    async def mock_select_all(table, columns, filters, **kwargs):
        return []
    monkeypatch.setattr("app.routers.workspaces.select_all_trusted", mock_select_all)

    # Mock delete_many_trusted
    async def mock_delete_many(table, filters):
        return []
    monkeypatch.setattr("app.routers.workspaces.delete_many_trusted", mock_delete_many)

    # Mock leave_workspace_presence
    async def mock_leave_presence(workspace_id, user_id):
        pass
    monkeypatch.setattr("app.routers.workspaces.leave_workspace_presence", mock_leave_presence)

    async def mock_invalidate_presence_cache(workspace_id):
        pass
    monkeypatch.setattr("app.routers.workspaces.invalidate_workspace_presence_cache", mock_invalidate_presence_cache)

    # Mock log_workspace_activity
    async def mock_log_activity(**kwargs):
        return {}
    monkeypatch.setattr("app.routers.workspaces.log_workspace_activity", mock_log_activity)

    async def mock_emit_authority_revocation(**kwargs):
        return None
    monkeypatch.setattr("app.services.realtime_service.emit_authority_revocation", mock_emit_authority_revocation)

    # Mock is_super_workspace/is_subspace if needed, though they are usually safe
    # But for tests, we might want to control them
    monkeypatch.setattr("app.routers.workspaces.is_super_workspace", lambda w: w.get("workspace_type") == "super_workspace")

@pytest.mark.asyncio
async def test_remove_member_from_subspace_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    parent_workspace_id = "super-1"
    member_user_id = "user-2"
    actor_user_id = "founder-1"

    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {
                "id": wid,
                "workspace_type": "subworkspace",
                "parent_workspace_id": parent_workspace_id,
                "is_global": False,
                "user_id": "sub-founder-1",
            },
            "workspace_id": wid,
            "role": "founder",
            "membership_workspace": {"id": parent_workspace_id, "user_id": actor_user_id},
            "membership_workspace_id": parent_workspace_id,
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)
    
    deleted_workspaces = []
    async def mock_delete_many(table, filters):
        if table == "workspace_members":
            wids = filters["workspace_id"]
            if isinstance(wids, list):
                deleted_workspaces.extend(wids)
            else:
                deleted_workspaces.append(wids)
        return []
    monkeypatch.setattr("app.routers.workspaces.delete_many_trusted", mock_delete_many)
    
    presence_cleaned = []
    async def mock_leave_presence(workspace_id, user_id):
        presence_cleaned.append(workspace_id)
    monkeypatch.setattr("app.routers.workspaces.leave_workspace_presence", mock_leave_presence)
    
    # Execute
    await remove_workspace_member(workspace_id, member_user_id, current_user={"id": actor_user_id})
    
    # Verify
    assert deleted_workspaces == [workspace_id]
    assert presence_cleaned == [workspace_id]

@pytest.mark.asyncio
async def test_remove_member_from_global_workspace_rejects_inherited_parent_removal(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_id = "global-1"
    parent_workspace_id = "super-1"
    member_user_id = "user-2"
    actor_user_id = "founder-1"
    delete_called = False

    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {
                "id": wid,
                "workspace_type": "global_workspace",
                "parent_workspace_id": parent_workspace_id,
                "is_global": True,
                "user_id": actor_user_id,
            },
            "workspace_id": wid,
            "role": "founder",
            "membership_workspace": {"id": parent_workspace_id, "user_id": actor_user_id},
            "membership_workspace_id": parent_workspace_id,
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)

    async def mock_delete_many(table, filters):
        nonlocal delete_called
        delete_called = True
        return []
    monkeypatch.setattr("app.routers.workspaces.delete_many_trusted", mock_delete_many)

    with pytest.raises(HTTPException) as exc:
        await remove_workspace_member(workspace_id, member_user_id, current_user={"id": actor_user_id})

    assert exc.value.status_code == status.HTTP_400_BAD_REQUEST
    assert "inherited from the parent organization" in exc.value.detail
    assert delete_called is False

@pytest.mark.asyncio
async def test_remove_member_from_super_workspace_cascades(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    super_workspace_id = "super-1"
    subspace_id = "sub-1"
    member_user_id = "user-2"
    actor_user_id = "founder-1"
    
    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {"id": wid, "workspace_type": "super_workspace", "parent_workspace_id": None, "user_id": "founder-1"},
            "role": "founder",
            "membership_workspace": {"id": wid}
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)
    
    async def mock_select_all(table, columns, filters, **kwargs):
        if table == "workspaces":
            return [{"id": subspace_id}]
        return []
    monkeypatch.setattr("app.routers.workspaces.select_all_trusted", mock_select_all)
    
    deleted_workspaces = []
    async def mock_delete_many(table, filters):
        if table == "workspace_members":
            wids = filters["workspace_id"]
            if isinstance(wids, list):
                deleted_workspaces.extend(wids)
            else:
                deleted_workspaces.append(wids)
        return []
    monkeypatch.setattr("app.routers.workspaces.delete_many_trusted", mock_delete_many)
    
    presence_cleaned = []
    async def mock_leave_presence(workspace_id, user_id):
        presence_cleaned.append(workspace_id)
    monkeypatch.setattr("app.routers.workspaces.leave_workspace_presence", mock_leave_presence)
    
    # Execute
    await remove_workspace_member(super_workspace_id, member_user_id, current_user={"id": actor_user_id})
    
    # Verify
    assert set(deleted_workspaces) == {super_workspace_id, subspace_id}
    assert set(presence_cleaned) == {super_workspace_id, subspace_id}

@pytest.mark.asyncio
async def test_remove_member_permission_denied_for_non_founder_in_super(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup: actor is co_owner of super workspace
    super_workspace_id = "super-1"
    member_user_id = "user-2"
    actor_user_id = "co-owner-1"
    
    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {"id": wid, "workspace_type": "super_workspace", "parent_workspace_id": None, "user_id": "founder-1"},
            "role": "co_owner",
            "membership_workspace": {"id": wid}
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)
    
    # Execute & Verify
    with pytest.raises(HTTPException) as exc:
        await remove_workspace_member(super_workspace_id, member_user_id, current_user={"id": actor_user_id})
    
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Only the organization founder" in exc.value.detail

@pytest.mark.asyncio
async def test_team_lead_can_remove_member_from_subspace(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup: actor is team_lead of subspace
    workspace_id = "sub-1"
    member_user_id = "user-2"
    actor_user_id = "lead-1"
    
    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {"id": wid, "workspace_type": "subworkspace", "parent_workspace_id": "super-1", "user_id": "founder-1"},
            "role": "team_lead",
            "membership_workspace": {"id": wid}
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)
    
    # Execute
    await remove_workspace_member(workspace_id, member_user_id, current_user={"id": actor_user_id})
    
    # Verify (success if no exception)

@pytest.mark.asyncio
async def test_team_lead_cannot_remove_another_team_lead(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup: actor is team_lead, target is also team_lead
    workspace_id = "sub-1"
    member_user_id = "user-2"
    actor_user_id = "lead-1"
    
    async def mock_require_access(wid, uid):
        return type("Access", (), {
            "workspace": {"id": wid, "workspace_type": "subworkspace", "parent_workspace_id": "super-1", "user_id": "founder-1"},
            "role": "team_lead",
            "membership_workspace": {"id": wid}
        })
    monkeypatch.setattr("app.routers.workspaces.require_workspace_access", mock_require_access)
    
    async def mock_select_one(table, columns, filters):
        if table == "workspace_members":
            return {"workspace_id": workspace_id, "user_id": member_user_id, "role": "team_lead"}
        return None
    monkeypatch.setattr("app.routers.workspaces.select_one_trusted", mock_select_one)
    
    # Execute & Verify
    with pytest.raises(HTTPException) as exc:
        await remove_workspace_member(workspace_id, member_user_id, current_user={"id": actor_user_id})
    
    assert exc.value.status_code == status.HTTP_403_FORBIDDEN
    assert "Team leads can remove members only" in exc.value.detail
