from __future__ import annotations

from typing import Any

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import app as production_app
from app.routers import analytics


def _analytics_client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    app.dependency_overrides[analytics.get_current_user] = lambda: current_user or {
        "sub": "user-1",
        "email": "alex@example.com",
    }
    app.include_router(analytics.router)
    return TestClient(app)


def test_workspace_analytics_route_is_registered_on_production_app() -> None:
    client = TestClient(production_app)

    response = client.get("/workspaces/workspace-1/analytics")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing authentication token."


def test_workspace_analytics_route_returns_metrics(monkeypatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_get_workspace_analytics(*, workspace_id: str, user_id: str):
        captured.update({"workspace_id": workspace_id, "user_id": user_id})
        return {
            "message_count": 2,
            "active_members": 1,
            "files_uploaded": 3,
            "tasks_created": 4,
            "decisions_recorded": 5,
            "ai_conversations": 6,
            "activity_by_day": [{"date": "2026-06-17", "count": 2}],
        }

    monkeypatch.setattr(analytics, "get_workspace_analytics", fake_get_workspace_analytics)
    client = _analytics_client()

    response = client.get("/workspaces/workspace-1/analytics")

    assert response.status_code == 200
    assert captured == {"workspace_id": "workspace-1", "user_id": "user-1"}
    assert response.json()["activity_by_day"] == [{"date": "2026-06-17", "count": 2}]
