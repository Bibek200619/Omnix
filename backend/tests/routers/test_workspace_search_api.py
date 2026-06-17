from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app as production_app
from app.routers import workspace_search


def _search_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[workspace_search.get_current_user] = lambda: current_user or {
        "sub": "user-1",
        "email": "alex@example.com",
    }
    app.include_router(workspace_search.router)
    return TestClient(app)


def test_workspace_search_route_is_registered_on_production_app() -> None:
    client = TestClient(production_app)

    response = client.get("/workspaces/workspace-1/search?q=launch")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authentication token."


def test_workspace_search_route_returns_grouped_results(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_search_workspace(*, workspace_id: str, user_id: str, query: str, scope: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id, "query": query, "scope": scope})
        return {
            "conversations": [],
            "tasks": [
                {
                    "id": "task-1",
                    "workspace_id": workspace_id,
                    "type": "task",
                    "title": "Fix mobile navigation",
                    "preview": "Small viewport overflow",
                    "url": "/tasks?id=task-1",
                }
            ],
            "initiatives": [],
            "decisions": [],
        }

    monkeypatch.setattr(workspace_search, "search_workspace", fake_search_workspace)
    client = _search_client()

    response = client.get("/workspaces/workspace-1/search?q=mobile&scope=organization")

    assert response.status_code == 200
    assert captured == {
        "workspace_id": "workspace-1",
        "user_id": "user-1",
        "query": "mobile",
        "scope": "organization",
    }
    assert response.json()["tasks"][0]["title"] == "Fix mobile navigation"
