from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app as production_app
from app.routers import workspace_mentions


def _mentions_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[workspace_mentions.get_current_user] = lambda: current_user or {
        "sub": "user-2",
        "email": "bibek@example.com",
    }
    app.include_router(workspace_mentions.router)
    return TestClient(app)


import pytest
from app.services.workspace_service import WorkspaceAccess

@pytest.fixture(autouse=True)
def _mock_workspace_access(monkeypatch):
    async def allow_access(*args, **kwargs):
        return WorkspaceAccess(workspace={"id": "ws-1", "user_id": "user-2"}, role="member")
    monkeypatch.setattr(workspace_mentions, "require_workspace_access", allow_access)

def test_workspace_mentions_route_is_registered_on_production_app() -> None:
    client = TestClient(production_app)

    response = client.get("/workspaces/workspace-1/mentions")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authentication token."


def test_workspace_mentions_route_returns_user_mentions(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_list_mentions_for_user(*, workspace_id: str, user_id: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id})
        return [
            {
                "id": "mention-1",
                "workspace_id": workspace_id,
                "mentioned_user_id": user_id,
                "mentioned_by_user_id": "user-1",
                "source_type": "task",
                "source_id": "task-1",
                "created_at": "2026-06-03T10:00:00+00:00",
                "read_at": None,
                "mentioned_by_name": "Alex",
                "mentioned_by_email": "alex@example.com",
                "mentioned_by_avatar_label": "A",
                "mentioned_user_name": "Bibek",
                "source_title": "Fix mobile navigation",
                "source_preview": "Check mention picker at 320px.",
                "source_url": "/tasks?id=task-1",
            }
        ]

    monkeypatch.setattr(workspace_mentions, "list_mentions_for_user", fake_list_mentions_for_user)
    client = _mentions_client()

    response = client.get("/workspaces/workspace-1/mentions")

    assert response.status_code == 200
    assert captured == {"workspace_id": "workspace-1", "user_id": "user-2"}
    assert response.json()[0]["source_title"] == "Fix mobile navigation"


def test_workspace_mentions_unread_count_returns_count(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_count_unread_mentions_for_user(*, workspace_id: str, user_id: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id})
        return {"unread_count": 3}

    monkeypatch.setattr(workspace_mentions, "count_unread_mentions_for_user", fake_count_unread_mentions_for_user)
    client = _mentions_client()

    response = client.get("/workspaces/workspace-1/mentions/unread-count")

    assert response.status_code == 200
    assert captured == {"workspace_id": "workspace-1", "user_id": "user-2"}
    assert response.json() == {"unread_count": 3}


def test_mark_workspace_mention_read_scopes_to_current_user(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_mark_mention_read(*, workspace_id: str, user_id: str, mention_id: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id, "mention_id": mention_id})
        return {"mention_id": mention_id, "read_at": "2026-06-03T10:30:00+00:00"}

    monkeypatch.setattr(workspace_mentions, "mark_mention_read", fake_mark_mention_read)
    client = _mentions_client()

    response = client.patch("/workspaces/workspace-1/mentions/mention-1/read")

    assert response.status_code == 200
    assert captured == {"workspace_id": "workspace-1", "user_id": "user-2", "mention_id": "mention-1"}
    assert response.json()["mention_id"] == "mention-1"


def test_mark_all_workspace_mentions_read_scopes_to_current_user(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_mark_all_mentions_read(*, workspace_id: str, user_id: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id})
        return {"updated_count": 2, "read_at": "2026-06-03T10:30:00+00:00"}

    monkeypatch.setattr(workspace_mentions, "mark_all_mentions_read", fake_mark_all_mentions_read)
    client = _mentions_client()

    response = client.patch("/workspaces/workspace-1/mentions/read-all")

    assert response.status_code == 200
    assert captured == {"workspace_id": "workspace-1", "user_id": "user-2"}
    assert response.json()["updated_count"] == 2
