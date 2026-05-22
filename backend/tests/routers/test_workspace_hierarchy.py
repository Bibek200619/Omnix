from __future__ import annotations

from fastapi import HTTPException
import pytest

from app.services import workspace_service


@pytest.mark.asyncio
async def test_super_workspace_creation_auto_creates_global_space(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_workspaces: list[dict[str, object]] = []
    inserted_memberships: list[dict[str, object]] = []

    async def fake_select_all_trusted(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspaces"
        assert filters == {"parent_workspace_id": "super-1", "is_global": True}
        return []

    async def fake_insert_one(table: str, payload: dict[str, object]):
        if table == "workspaces":
            next_id = "super-1" if payload["workspace_type"] == "super_workspace" else "global-1"
            row = {"id": next_id, "created_at": "2026-05-20T00:00:00+00:00", **payload}
            inserted_workspaces.append(row)
            return row
        if table == "workspace_members":
            inserted_memberships.append(payload)
            return {"id": "membership-1", **payload}
        raise AssertionError(table)

    monkeypatch.setattr(workspace_service, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(workspace_service, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspace_service, "utc_now_iso", lambda: "2026-05-20T00:00:00+00:00")

    workspace = await workspace_service.create_workspace_for_user(
        user_id="owner-1",
        name="Omnix HQ",
        workspace_type="super_workspace",
    )

    assert workspace["id"] == "super-1"
    assert inserted_workspaces[0]["workspace_type"] == "super_workspace"
    assert inserted_workspaces[0]["parent_workspace_id"] is None
    assert inserted_workspaces[1]["name"] == "Global"
    assert inserted_workspaces[1]["workspace_type"] == "global_workspace"
    assert inserted_workspaces[1]["parent_workspace_id"] == "super-1"
    assert inserted_workspaces[1]["is_global"] is True
    assert inserted_memberships == [
        {
            "workspace_id": "super-1",
            "user_id": "owner-1",
            "role": "owner",
            "created_at": "2026-05-20T00:00:00+00:00",
            "updated_at": "2026-05-20T00:00:00+00:00",
        }
    ]


@pytest.mark.asyncio
async def test_subspace_creation_rejects_non_super_parent(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_owner(workspace_id: str, user_id: str):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": user_id,
                "name": "Legacy",
                "workspace_type": "workspace",
                "parent_workspace_id": None,
                "is_global": False,
            },
            role="founder",
        )

    monkeypatch.setattr(workspace_service, "require_workspace_owner", fake_require_workspace_owner)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_service.create_subspace_for_user(
            user_id="owner-1",
            parent_workspace_id="workspace-1",
            name="Design Team",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Subspaces can only be created under a super workspace."


@pytest.mark.asyncio
async def test_subspace_access_inherits_parent_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspaces" and filters == {"id": "sub-1"}:
            return {
                "id": "sub-1",
                "user_id": "owner-1",
                "name": "Design Team",
                "workspace_type": "subworkspace",
                "parent_workspace_id": "super-1",
                "is_global": False,
            }
        if table == "workspaces" and filters == {"id": "super-1"}:
            return {
                "id": "super-1",
                "user_id": "owner-1",
                "name": "Omnix HQ",
                "workspace_type": "super_workspace",
                "parent_workspace_id": None,
                "is_global": False,
            }
        if table == "workspace_members" and filters == {"workspace_id": "sub-1", "user_id": "member-1"}:
            return None
        if table == "workspace_members" and filters == {"workspace_id": "super-1", "user_id": "member-1"}:
            return {"workspace_id": "super-1", "user_id": "member-1", "role": "member"}
        raise AssertionError((table, filters))

    monkeypatch.setattr(workspace_service, "select_one_trusted", fake_select_one_trusted)

    access = await workspace_service.resolve_workspace_access("sub-1", "member-1")

    assert access is not None
    assert access.workspace_id == "sub-1"
    assert access.membership_workspace_id == "super-1"
    assert access.role == "member"


@pytest.mark.asyncio
async def test_nested_subspace_creation_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_owner(workspace_id: str, user_id: str):
        return workspace_service.WorkspaceAccess(
            workspace={
                "id": workspace_id,
                "user_id": user_id,
                "name": "Design Team",
                "workspace_type": "subworkspace",
                "parent_workspace_id": "super-1",
                "is_global": False,
            },
            role="founder",
        )

    monkeypatch.setattr(workspace_service, "require_workspace_owner", fake_require_workspace_owner)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_service.create_subspace_for_user(
            user_id="owner-1",
            parent_workspace_id="sub-1",
            name="Nested Team",
        )

    assert exc_info.value.status_code == 400
