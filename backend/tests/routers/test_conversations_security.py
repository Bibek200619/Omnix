from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import conversations
from app.services.workspace_common import WorkspaceAccess


def _client(current_user: dict[str, Any]) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(conversations.router)
    return TestClient(app, raise_server_exceptions=False)


def _workspace_access(workspace_id: str = "workspace-1") -> WorkspaceAccess:
    return WorkspaceAccess(
        workspace={
            "id": workspace_id,
            "user_id": "owner-1",
            "workspace_type": "workspace",
        },
        role="member",
    )


def _conversation_row() -> dict[str, Any]:
    return {
        "id": "conversation-1",
        "user_id": "user-1",
        "workspace_id": "workspace-1",
        "title": "Private workspace plan",
        "is_archived": False,
        "created_at": None,
        "updated_at": None,
        "last_message_at": None,
    }


def test_workspace_conversation_hydrates_only_after_authorization(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    events: list[tuple[str, object]] = []
    hydrated = _conversation_row()

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "conversations"
        events.append(("select", (columns, filters)))
        if columns == conversations.CONVERSATION_LOCATOR_COLUMNS:
            return {
                "id": "conversation-1",
                "user_id": "user-1",
                "workspace_id": "workspace-1",
            }
        assert columns == conversations.CONVERSATION_COLUMNS
        return hydrated

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        events.append(("authorize", (workspace_id, user_id)))
        return _workspace_access(workspace_id)

    monkeypatch.setattr(conversations, "select_one_trusted", fake_select)
    monkeypatch.setattr(conversations, "require_workspace_access", fake_access)
    client = _client({"sub": "user-1", "role": "authenticated"})

    response = client.get("/conversations/conversation-1")

    assert response.status_code == 200
    assert response.json()["title"] == "Private workspace plan"
    assert events == [
        (
            "select",
            (
                conversations.CONVERSATION_LOCATOR_COLUMNS,
                {"id": "conversation-1"},
            ),
        ),
        ("authorize", ("workspace-1", "user-1")),
        (
            "select",
            (
                conversations.CONVERSATION_COLUMNS,
                {
                    "id": "conversation-1",
                    "workspace_id": "workspace-1",
                },
            ),
        ),
    ]


def test_denied_workspace_conversation_does_not_hydrate_title(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selections: list[tuple[str, dict[str, Any]]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "conversations"
        selections.append((columns, filters))
        if columns != conversations.CONVERSATION_LOCATOR_COLUMNS:
            raise AssertionError("Conversation hydration must follow authorization.")
        return {
            "id": "conversation-1",
            "user_id": "owner-1",
            "workspace_id": "workspace-1",
        }

    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=403, detail="Workspace access denied.")

    monkeypatch.setattr(conversations, "select_one_trusted", fake_select)
    monkeypatch.setattr(conversations, "require_workspace_access", deny_access)
    client = _client({"sub": "outsider-1", "role": "authenticated"})

    response = client.get("/conversations/conversation-1")

    assert response.status_code == 404
    assert response.json() == {"detail": "Conversation not found."}
    assert selections == [
        (
            conversations.CONVERSATION_LOCATOR_COLUMNS,
            {"id": "conversation-1"},
        ),
    ]


def test_workspace_conversation_update_uses_authorized_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    update_filters: list[dict[str, Any]] = []
    hydrated = _conversation_row()

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        if columns == conversations.CONVERSATION_LOCATOR_COLUMNS:
            return {
                "id": "conversation-1",
                "user_id": "user-1",
                "workspace_id": "workspace-1",
            }
        return hydrated

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return _workspace_access(workspace_id)

    async def fake_update(
        table: str,
        filters: dict[str, Any],
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "conversations"
        update_filters.append(filters)
        return {**hydrated, **payload}

    monkeypatch.setattr(conversations, "select_one_trusted", fake_select)
    monkeypatch.setattr(conversations, "require_workspace_access", fake_access)
    monkeypatch.setattr(conversations, "update_one_trusted", fake_update)
    monkeypatch.setattr(
        conversations,
        "utc_now_iso",
        lambda: "2026-07-28T00:00:00+00:00",
    )
    client = _client({"sub": "user-1", "role": "authenticated"})

    response = client.patch(
        "/conversations/conversation-1",
        json={"title": "Updated plan"},
    )

    assert response.status_code == 200
    assert update_filters == [
        {
            "id": "conversation-1",
            "workspace_id": "workspace-1",
        },
    ]


def test_personal_conversation_list_excludes_workspace_rows(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    async def no_active_workspace(request: Any, user_id: str) -> None:
        assert user_id == "user-1"
        return None

    async def fake_select_all(
        table: str,
        columns: str,
        filters: dict[str, Any],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        captured.update(
            {
                "table": table,
                "columns": columns,
                "filters": filters,
                "kwargs": kwargs,
            }
        )
        return []

    monkeypatch.setattr(
        conversations,
        "require_active_workspace_access",
        no_active_workspace,
    )
    monkeypatch.setattr(conversations, "select_all", fake_select_all)
    client = _client({"sub": "user-1", "role": "authenticated"})

    response = client.get("/conversations")

    assert response.status_code == 200
    assert captured["table"] == "conversations"
    assert captured["filters"] == {
        "user_id": "user-1",
        "workspace_id": {"is": None},
    }
