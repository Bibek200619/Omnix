from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.routers import workspaces
from app.schemas.chat import WorkspaceInviteCreate


def _invite_payload(email: str = "teammate@example.com") -> WorkspaceInviteCreate:
    return WorkspaceInviteCreate(email=email)


def _patch_successful_invite_dependencies(
    monkeypatch: pytest.MonkeyPatch,
    inserted_payloads: list[dict[str, object]],
    expected_user_id: str,
) -> None:
    async def fake_require_workspace_owner(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == expected_user_id
        return SimpleNamespace(workspace={"id": workspace_id, "user_id": expected_user_id})

    async def fake_list_workspace_members(workspace: dict[str, object]):
        assert workspace["id"] == "workspace-1"
        return []

    async def fake_select_one_trusted(*args, **kwargs):
        return None

    async def fake_insert_one_trusted(table: str, payload: dict[str, object]):
        assert table == "workspace_invites"
        inserted_payloads.append(payload)
        return {
            "id": "invite-1",
            **payload,
            "accepted_by_user_id": None,
            "accepted_at": None,
        }

    async def fake_hydrate_invites(invites: list[dict[str, object]]):
        return invites

    monkeypatch.setattr(workspaces, "require_workspace_owner", fake_require_workspace_owner)
    monkeypatch.setattr(workspaces, "list_workspace_members", fake_list_workspace_members)
    monkeypatch.setattr(workspaces, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspaces, "insert_one_trusted", fake_insert_one_trusted)
    monkeypatch.setattr(workspaces, "hydrate_invites", fake_hydrate_invites)
    monkeypatch.setattr(workspaces, "utc_now_iso", lambda: "2026-05-16T00:00:00+00:00")


@pytest.mark.asyncio
async def test_invite_succeeds_when_current_user_has_id(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_payloads: list[dict[str, object]] = []
    _patch_successful_invite_dependencies(monkeypatch, inserted_payloads, "user-id-1")

    response = await workspaces.invite_workspace_member(
        "workspace-1",
        _invite_payload("Teammate@Example.com"),
        current_user={"id": "user-id-1", "email": "owner@example.com"},
    )

    assert inserted_payloads[0]["invited_by"] == "user-id-1"
    assert inserted_payloads[0]["email"] == "teammate@example.com"
    assert response["invited_by"] == "user-id-1"


@pytest.mark.asyncio
async def test_invite_succeeds_when_current_user_has_sub(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_payloads: list[dict[str, object]] = []
    _patch_successful_invite_dependencies(monkeypatch, inserted_payloads, "user-sub-1")

    await workspaces.invite_workspace_member(
        "workspace-1",
        _invite_payload(),
        current_user=SimpleNamespace(sub="user-sub-1", email="owner@example.com"),
    )

    assert inserted_payloads[0]["invited_by"] == "user-sub-1"


@pytest.mark.asyncio
async def test_invite_returns_401_when_current_user_id_cannot_be_resolved() -> None:
    with pytest.raises(HTTPException) as exc_info:
        await workspaces.invite_workspace_member(
            "workspace-1",
            _invite_payload(),
            current_user={"email": "owner@example.com"},
        )

    assert exc_info.value.status_code == 401
    assert exc_info.value.detail == "Unable to resolve authenticated user"


@pytest.mark.asyncio
async def test_top_level_pending_invites_uses_authenticated_email(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    async def fake_list_pending_invites_for_email(email: str):
        calls.append(email)
        return [
            {
                "id": "invite-1",
                "workspace_id": "workspace-1",
                "invite_id": "invite-1",
                "workspace_name": "Omnix Team Workspace",
                "email": email,
                "role": "member",
                "status": "pending",
                "invited_by": "owner-1",
                "inviter_name": "Bibek",
                "inviter_email": "bibek@example.com",
                "created_at": "2026-05-16T00:00:00+00:00",
                "updated_at": "2026-05-16T00:00:00+00:00",
                "accepted_by_user_id": None,
                "accepted_at": None,
            }
        ]

    monkeypatch.setattr(workspaces, "list_pending_invites_for_email", fake_list_pending_invites_for_email)

    response = await workspaces.list_authenticated_workspace_invites(
        current_user={"sub": "user-1", "email": "Invitee@Example.com"},
    )

    assert calls == ["invitee@example.com"]
    assert response[0]["workspace_name"] == "Omnix Team Workspace"


@pytest.mark.asyncio
async def test_accept_invite_creates_membership_and_marks_invite_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_memberships: list[dict[str, object]] = []
    updates: list[dict[str, object]] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspace_invites":
            return {
                "id": "invite-1",
                "workspace_id": "workspace-1",
                "email": "invitee@example.com",
                "role": "member",
                "status": "pending",
                "invited_by": "owner-1",
            }
        if table == "workspaces":
            return {"id": "workspace-1", "user_id": "owner-1", "name": "Omnix Team"}
        return None

    async def fake_resolve_workspace_access(workspace_id: str, user_id: str):
        assert workspace_id == "workspace-1"
        assert user_id == "user-2"
        return None

    async def fake_insert_one(table: str, payload: dict[str, object]):
        assert table == "workspace_members"
        inserted_memberships.append(payload)
        return payload

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "workspace_invites"
        updates.append(payload)
        return {"id": filters["id"], **payload}

    async def fake_enriched_workspace_for_user(workspace_id: str, user_id: str):
        return {
            "id": workspace_id,
            "user_id": "owner-1",
            "name": "Omnix Team",
            "current_user_role": "member",
            "member_count": 2,
            "is_shared": True,
            "members_preview": [],
        }

    monkeypatch.setattr(workspaces, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspaces, "resolve_workspace_access", fake_resolve_workspace_access)
    monkeypatch.setattr(workspaces, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspaces, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(workspaces, "_enriched_workspace_for_user", fake_enriched_workspace_for_user)
    monkeypatch.setattr(workspaces, "utc_now_iso", lambda: "2026-05-16T00:00:00+00:00")

    response = await workspaces.accept_authenticated_workspace_invite(
        "invite-1",
        current_user={"sub": "user-2", "email": "Invitee@Example.com"},
    )

    assert inserted_memberships == [
        {
            "workspace_id": "workspace-1",
            "user_id": "user-2",
            "role": "member",
            "created_at": "2026-05-16T00:00:00+00:00",
            "updated_at": "2026-05-16T00:00:00+00:00",
        }
    ]
    assert updates[0]["status"] == "accepted"
    assert updates[0]["accepted_by_user_id"] == "user-2"
    assert response["id"] == "workspace-1"


@pytest.mark.asyncio
async def test_accept_invite_does_not_create_duplicate_membership(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted_memberships: list[dict[str, object]] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspace_invites":
            return {
                "id": "invite-1",
                "workspace_id": "workspace-1",
                "email": "invitee@example.com",
                "role": "member",
                "status": "pending",
                "invited_by": "owner-1",
            }
        if table == "workspaces":
            return {"id": "workspace-1", "user_id": "owner-1", "name": "Omnix Team"}
        return None

    async def fake_resolve_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id}, role="member", is_owner=False)

    async def fake_insert_one(table: str, payload: dict[str, object]):
        inserted_memberships.append(payload)
        return payload

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        return {"id": filters["id"], **payload}

    async def fake_enriched_workspace_for_user(workspace_id: str, user_id: str):
        return {
            "id": workspace_id,
            "user_id": "owner-1",
            "name": "Omnix Team",
            "current_user_role": "member",
            "member_count": 2,
            "is_shared": True,
            "members_preview": [],
        }

    monkeypatch.setattr(workspaces, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspaces, "resolve_workspace_access", fake_resolve_workspace_access)
    monkeypatch.setattr(workspaces, "insert_one", fake_insert_one)
    monkeypatch.setattr(workspaces, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(workspaces, "_enriched_workspace_for_user", fake_enriched_workspace_for_user)
    monkeypatch.setattr(workspaces, "utc_now_iso", lambda: "2026-05-16T00:00:00+00:00")

    await workspaces.accept_authenticated_workspace_invite(
        "invite-1",
        current_user={"sub": "user-2", "email": "invitee@example.com"},
    )

    assert inserted_memberships == []


@pytest.mark.asyncio
async def test_accept_invite_tolerates_missing_accepted_at_column(monkeypatch: pytest.MonkeyPatch) -> None:
    updates: list[dict[str, object]] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        if table == "workspace_invites":
            return {
                "id": "invite-1",
                "workspace_id": "workspace-1",
                "email": "invitee@example.com",
                "role": "member",
                "status": "pending",
                "invited_by": "owner-1",
            }
        if table == "workspaces":
            return {"id": "workspace-1", "user_id": "owner-1", "name": "Omnix Team"}
        return None

    async def fake_resolve_workspace_access(workspace_id: str, user_id: str):
        return SimpleNamespace(workspace={"id": workspace_id}, role="member", is_owner=False)

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        updates.append(payload)
        if "accepted_at" in payload:
            try:
                raise RuntimeError("Could not find the 'accepted_at' column of 'workspace_invites' in the schema cache")
            except RuntimeError as exc:
                raise workspaces.SupabaseServiceError("Internal server error") from exc
        return {"id": filters["id"], **payload}

    async def fake_enriched_workspace_for_user(workspace_id: str, user_id: str):
        return {
            "id": workspace_id,
            "user_id": "owner-1",
            "name": "Omnix Team",
            "current_user_role": "member",
            "member_count": 2,
            "is_shared": True,
            "members_preview": [],
        }

    monkeypatch.setattr(workspaces, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspaces, "resolve_workspace_access", fake_resolve_workspace_access)
    monkeypatch.setattr(workspaces, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(workspaces, "_enriched_workspace_for_user", fake_enriched_workspace_for_user)
    monkeypatch.setattr(workspaces, "utc_now_iso", lambda: "2026-05-16T00:00:00+00:00")

    response = await workspaces.accept_authenticated_workspace_invite(
        "invite-1",
        current_user={"sub": "user-2", "email": "invitee@example.com"},
    )

    assert "accepted_at" in updates[0]
    assert updates[1] == {
        "status": "accepted",
        "accepted_by_user_id": "user-2",
        "updated_at": "2026-05-16T00:00:00+00:00",
    }
    assert response["id"] == "workspace-1"


@pytest.mark.asyncio
async def test_decline_invite_marks_invite_declined(monkeypatch: pytest.MonkeyPatch) -> None:
    updates: list[dict[str, object]] = []

    async def fake_select_one_trusted(table: str, columns: str, filters: dict[str, object]):
        return {
            "id": "invite-1",
            "workspace_id": "workspace-1",
            "email": "invitee@example.com",
            "role": "member",
            "status": "pending",
            "invited_by": "owner-1",
        }

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        updates.append(payload)
        return {
            "id": filters["id"],
            "workspace_id": "workspace-1",
            "email": "invitee@example.com",
            "role": "member",
            "invited_by": "owner-1",
            **payload,
        }

    async def fake_hydrate_invites(invites: list[dict[str, object]]):
        return [{**invites[0], "invite_id": str(invites[0]["id"]), "invited_by": "owner-1"}]

    monkeypatch.setattr(workspaces, "select_one_trusted", fake_select_one_trusted)
    monkeypatch.setattr(workspaces, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(workspaces, "hydrate_invites", fake_hydrate_invites)
    monkeypatch.setattr(workspaces, "utc_now_iso", lambda: "2026-05-16T00:00:00+00:00")

    response = await workspaces.decline_authenticated_workspace_invite(
        "invite-1",
        current_user={"sub": "user-2", "email": "invitee@example.com"},
    )

    assert updates == [{"status": "declined", "updated_at": "2026-05-16T00:00:00+00:00"}]
    assert response["status"] == "declined"
