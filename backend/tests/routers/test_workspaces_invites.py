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
    assert "invited_by_user_id" not in inserted_payloads[0]
    assert response["invited_by_user_id"] == "user-id-1"


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
