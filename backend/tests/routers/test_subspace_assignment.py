from __future__ import annotations

from fastapi import HTTPException
import pytest

from app.services import workspace_service

@pytest.mark.asyncio
async def test_list_potential_subspace_members(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    user_id = "founder-1"
    parent_workspace_id = "super-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "founder-1",
                "parent_workspace_id": parent_workspace_id,
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="founder"
        )
        
    async def fake_select_all_trusted(table, columns, filters, **kwargs):
        if table == "workspace_members" and filters.get("workspace_id") == parent_workspace_id:
            return [
                {"user_id": "member-1", "role": "member"},
                {"user_id": "member-2", "role": "member"},
            ]
        if table == "workspace_members" and filters.get("workspace_id") == workspace_id:
            return [{"user_id": "member-1", "role": "member"}]
        return []

    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspaces" and filters.get("id") == parent_workspace_id:
            return {"id": parent_workspace_id, "user_id": "founder-1"}
        return None
        
    async def fake_get_profiles(user_ids):
        return {uid: {"email": f"{uid}@example.com"} for uid in user_ids}

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspace_service, "get_profiles", fake_get_profiles)

    # Execute
    potentials = await workspace_service.list_potential_subspace_members(workspace_id, user_id)
    
    # Verify: member-1 is already in sub-1, so only member-2 and founder-1 (parent owner) should be potential
    user_ids = {p["user_id"] for p in potentials}
    assert "member-2" in user_ids
    assert "founder-1" in user_ids
    assert "member-1" not in user_ids

@pytest.mark.asyncio
async def test_assign_member_to_subspace_success(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    target_user_id = "member-2"
    actor_user_id = "founder-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "founder-1",
                "parent_workspace_id": "super-1",
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="founder"
        )
        
    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspace_members" and filters.get("workspace_id") == "super-1":
            return {"user_id": target_user_id} # Found in org
        if table == "workspace_members" and filters.get("workspace_id") == workspace_id:
            return None # Not already in sub
        return None

    inserted = []
    async def fake_insert_one(table, payload):
        inserted.append(payload)
        return payload

    async def fake_get_profiles(user_ids):
        return {uid: {} for uid in user_ids}

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspace_service, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspace_service, "get_profiles", fake_get_profiles)

    # Execute
    result = await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "member", actor_user_id)
    
    # Verify
    assert result["user_id"] == target_user_id
    assert len(inserted) == 1
    assert inserted[0]["workspace_id"] == workspace_id
    assert inserted[0]["user_id"] == target_user_id

@pytest.mark.asyncio
async def test_assign_member_to_subspace_unauthorized(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup: actor is only a member
    async def fake_require_workspace_management_access(wid, uid):
        raise HTTPException(status_code=403, detail="Forbidden")

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)

    # Execute & Verify
    with pytest.raises(HTTPException) as exc:
        await workspace_service.assign_member_to_subspace("sub-1", "member-2", "member", "member-1")
    assert exc.value.status_code == 403

@pytest.mark.asyncio
async def test_assign_member_to_subspace_duplicate(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    target_user_id = "member-1"
    actor_user_id = "founder-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "founder-1",
                "parent_workspace_id": "super-1",
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="founder"
        )
        
    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspace_members" and filters.get("workspace_id") == "super-1":
            return {"user_id": target_user_id}
        if table == "workspace_members" and filters.get("workspace_id") == workspace_id:
            return {"user_id": target_user_id} # ALREADY IN SUB
        return None

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)

    # Execute & Verify
    with pytest.raises(HTTPException) as exc:
        await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "member", actor_user_id)
    assert exc.value.status_code == 400
    assert "already a member" in exc.value.detail

@pytest.mark.asyncio
async def test_assign_member_to_subspace_escalation_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup: actor is a team_lead, trying to assign a co_owner (escalation)
    workspace_id = "sub-1"
    target_user_id = "member-2"
    actor_user_id = "team-lead-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "founder-1",
                "parent_workspace_id": "super-1",
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="team_lead"
        )
        
    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspace_members" and filters.get("workspace_id") == "super-1":
            return {"user_id": target_user_id}
        return None

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)

    # Execute & Verify: team_lead cannot assign co_owner
    with pytest.raises(HTTPException) as exc:
        await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "co_owner", actor_user_id)
    assert exc.value.status_code == 403
    assert "leadership roles" in exc.value.detail

@pytest.mark.asyncio
async def test_private_subspace_member_listing_is_scoped(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    parent_workspace_id = "super-1"
    
    async def fake_select_all_trusted(table, columns, filters, **kwargs):
        if table == "workspace_members" and filters.get("workspace_id") == workspace_id:
            return [{"user_id": "assigned-member", "role": "member"}]
        if table == "workspace_members" and filters.get("workspace_id") == parent_workspace_id:
            return [{"user_id": "org-member", "role": "member"}]
        return []

    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspaces" and filters.get("id") == workspace_id:
            return {
                "id": workspace_id, 
                "user_id": "founder-1", 
                "workspace_type": "subworkspace", 
                "parent_workspace_id": parent_workspace_id,
                "is_global": False
            }
        if table == "workspaces" and filters.get("id") == parent_workspace_id:
            return {
                "id": parent_workspace_id, 
                "user_id": "founder-1", 
                "workspace_type": "super_workspace",
                "is_global": False
            }
        return None

    async def fake_get_profiles(user_ids):
        return {uid: {} for uid in user_ids}

    monkeypatch.setattr(workspace_service, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspace_service, "get_profiles", fake_get_profiles)

    # Execute
    members = await workspace_service.list_workspace_members({
        "id": workspace_id,
        "user_id": "founder-1",
        "workspace_type": "subworkspace",
        "parent_workspace_id": parent_workspace_id,
        "is_global": False
    })
    
    # Verify: Should only contain 'assigned-member' (and founder), but NOT 'org-member'
    user_ids = {m["user_id"] for m in members}
    assert "assigned-member" in user_ids
    assert "founder-1" in user_ids
    assert "org-member" not in user_ids

@pytest.mark.asyncio
async def test_assign_member_to_subspace_team_lead_and_sub_member(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    parent_workspace_id = "super-1"
    target_user_id = "member-2"
    actor_user_id = "founder-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": actor_user_id,
                "parent_workspace_id": parent_workspace_id,
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="founder"
        )
        
    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspace_members" and filters.get("workspace_id") == parent_workspace_id:
            return {"user_id": target_user_id}
        return None

    inserted = []
    async def fake_insert_one(table, payload):
        inserted.append(payload)
        return payload

    async def fake_get_profiles(user_ids):
        return {uid: {} for uid in user_ids}

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspace_service, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspace_service, "get_profiles", fake_get_profiles)

    # 1. Founder assigning team_lead
    await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "team_lead", actor_user_id)
    assert inserted[0]["role"] == "team_lead"
    
    # 2. Founder assigning sub_member (normalized to member)
    inserted.clear()
    await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "sub_member", actor_user_id)
    assert inserted[0]["role"] == "member"

@pytest.mark.asyncio
async def test_team_lead_assignment_authority(monkeypatch: pytest.MonkeyPatch) -> None:
    # Setup
    workspace_id = "sub-1"
    parent_workspace_id = "super-1"
    target_user_id = "member-2"
    actor_user_id = "team-lead-1"
    
    async def fake_require_workspace_management_access(wid, uid):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": "founder-1",
                "parent_workspace_id": parent_workspace_id,
                "workspace_type": "subworkspace",
                "is_global": False
            },
            role="team_lead"
        )
        
    async def fake_select_one_trusted(table, columns, filters):
        if table == "workspace_members" and filters.get("workspace_id") == parent_workspace_id:
            return {"user_id": target_user_id}
        return None

    inserted = []
    async def fake_insert_one(table, payload):
        inserted.append(payload)
        return payload

    async def fake_get_profiles(user_ids):
        return {uid: {} for uid in user_ids}

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)
    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspace_service, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspace_service, "get_profiles", fake_get_profiles)

    # 1. Team lead assigning sub_member (Success)
    await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "sub_member", actor_user_id)
    assert inserted[0]["role"] == "member"

    # 2. Team lead attempting leader escalation (Rejected)
    with pytest.raises(HTTPException) as exc:
        await workspace_service.assign_member_to_subspace(workspace_id, target_user_id, "team_lead", actor_user_id)
    assert exc.value.status_code == 403
