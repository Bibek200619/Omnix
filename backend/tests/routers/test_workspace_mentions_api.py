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
