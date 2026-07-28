from __future__ import annotations

from fastapi import HTTPException
import pytest

from app.schemas.chat import WorkspaceRead, WorkspaceTreeRead
from app.services import workspace_access_service, workspace_service


def test_workspace_response_models_accept_team_lead_roles() -> None:
    workspace = WorkspaceRead.model_validate(
        {
            "id": "sub-1",
            "user_id": "owner-1",
            "name": "Design Team",
            "current_user_role": "team_lead",
        }
    )
    assert workspace.current_user_role == "team_lead"

    hierarchy = WorkspaceTreeRead.model_validate(
        {
            "id": "super-1",
            "user_id": "owner-1",
            "name": "Omnix HQ",
            "current_user_role": "founder",
            "subspaces": [
                {
                    "id": "sub-1",
                    "user_id": "owner-1",
                    "name": "Design Team",
                    "current_user_role": "team_lead",
                }
            ],
        }
    )
    assert hierarchy.subspaces[0].current_user_role == "team_lead"


@pytest.mark.asyncio
async def test_workspace_access_falls_back_to_hierarchy_workspace_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_column_calls: list[str] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspaces":
            workspace_column_calls.append(columns)
            if columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS:
                return {
                    "id": "workspace-1",
                    "user_id": "owner-1",
                    "parent_workspace_id": None,
                    "workspace_type": "super_workspace",
                    "is_global": False,
                }
            if columns == workspace_service.WORKSPACE_COLUMNS:
                raise workspace_service.SupabaseServiceError("Internal server error")
            assert columns == workspace_service.HIERARCHY_WORKSPACE_COLUMNS
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "name": "Legacy workspace",
                "description": None,
                "parent_workspace_id": None,
                "workspace_type": "super_workspace",
                "is_global": False,
                "created_at": "2026-06-03T10:00:00+00:00",
                "updated_at": "2026-06-03T10:00:00+00:00",
            }
        if table == "workspace_members":
            assert filters == {"workspace_id": "workspace-1", "user_id": "member-1"}
            return {"workspace_id": "workspace-1", "user_id": "member-1", "role": "member"}
        raise AssertionError(table)

    monkeypatch.setattr(workspace_access_service, "select_one_trusted", fake_select_one_trusted)

    access = await workspace_service.resolve_workspace_access("workspace-1", "member-1")

    assert workspace_column_calls == [
        workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
        workspace_service.WORKSPACE_COLUMNS,
        workspace_service.HIERARCHY_WORKSPACE_COLUMNS,
    ]
    assert access is not None
    assert access.workspace["workspace_type"] == "super_workspace"
    assert access.role == "member"


@pytest.mark.asyncio
async def test_workspace_access_falls_back_to_baseline_workspace_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_column_calls: list[str] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspaces":
            workspace_column_calls.append(columns)
            if columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS:
                raise workspace_service.SupabaseServiceError("Internal server error")
            if columns == workspace_access_service.LEGACY_WORKSPACE_ACCESS_LOCATOR_COLUMNS:
                return {
                    "id": "workspace-1",
                    "user_id": "owner-1",
                }
            if columns != workspace_service.LEGACY_WORKSPACE_COLUMNS:
                raise workspace_service.SupabaseServiceError("Internal server error")
            return {
                "id": "workspace-1",
                "user_id": "owner-1",
                "name": "Baseline workspace",
                "description": None,
                "created_at": "2026-06-03T10:00:00+00:00",
                "updated_at": "2026-06-03T10:00:00+00:00",
            }
        if table == "workspace_members":
            return {"workspace_id": "workspace-1", "user_id": "member-1", "role": "member"}
        raise AssertionError(table)

    monkeypatch.setattr(workspace_access_service, "select_one_trusted", fake_select_one_trusted)

    access = await workspace_service.resolve_workspace_access("workspace-1", "member-1")

    assert workspace_column_calls == [
        workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
        workspace_access_service.LEGACY_WORKSPACE_ACCESS_LOCATOR_COLUMNS,
        workspace_service.WORKSPACE_COLUMNS,
        workspace_service.HIERARCHY_WORKSPACE_COLUMNS,
        workspace_service.LEGACY_WORKSPACE_COLUMNS,
    ]
    assert access is not None
    assert access.workspace["workspace_type"] == "super_workspace"
    assert access.role == "member"


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
    assert inserted_workspaces[0]["workspace_focus"] == "general"
    assert inserted_workspaces[0]["ai_specialization"] == "general"
    assert inserted_workspaces[0]["parent_workspace_id"] is None
    assert inserted_workspaces[1]["name"] == "Global"
    assert inserted_workspaces[1]["workspace_type"] == "global_workspace"
    assert inserted_workspaces[1]["workspace_focus"] == "general"
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
    async def fake_require_workspace_management_access(workspace_id: str, user_id: str):
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

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_service.create_subspace_for_user(
            user_id="owner-1",
            parent_workspace_id="workspace-1",
            name="Design Team",
        )

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "Subspaces can only be created under a super workspace."


@pytest.mark.asyncio
async def test_subspace_access_requires_explicit_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    workspace_column_calls: list[str] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspaces":
            workspace_column_calls.append(columns)
            assert columns == workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS
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

    monkeypatch.setattr(workspace_access_service, "select_one_trusted", fake_select_one_trusted)

    access = await workspace_service.resolve_workspace_access("sub-1", "member-1")

    # Access should be None because implicit inheritance is removed for private subspaces
    assert access is None
    assert workspace_column_calls == [
        workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
        workspace_access_service.WORKSPACE_ACCESS_LOCATOR_COLUMNS,
    ]

@pytest.mark.asyncio
async def test_global_subspace_access_inherits_parent_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspaces" and filters == {"id": "sub-1"}:
            return {
                "id": "sub-1",
                "user_id": "owner-1",
                "name": "Global Team",
                "workspace_type": "global_workspace",
                "parent_workspace_id": "super-1",
                "is_global": True,
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

    monkeypatch.setattr(workspace_access_service, "select_one_trusted", fake_select_one_trusted)

    access = await workspace_service.resolve_workspace_access("sub-1", "member-1")

    assert access is not None
    assert access.workspace_id == "sub-1"
    assert access.membership_workspace_id == "super-1"
    assert access.role == "member"


@pytest.mark.asyncio
async def test_nested_subspace_creation_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_require_workspace_management_access(workspace_id: str, user_id: str):
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

    monkeypatch.setattr(workspace_service, "require_workspace_management_access", fake_require_workspace_management_access)

    with pytest.raises(HTTPException) as exc_info:
        await workspace_service.create_subspace_for_user(
            user_id="owner-1",
            parent_workspace_id="sub-1",
            name="Nested Team",
        )

    assert exc_info.value.status_code == 400
