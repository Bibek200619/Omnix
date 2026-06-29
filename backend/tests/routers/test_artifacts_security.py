from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import artifacts
from app.services.workspace_service import WorkspaceAccess


def _client(current_user: dict[str, Any] | None = None) -> TestClient:
    app = FastAPI()
    if current_user is not None:
        app.dependency_overrides[get_current_user] = lambda: current_user
    app.include_router(artifacts.router)
    return TestClient(app, raise_server_exceptions=False)


def test_create_artifact_rejects_unverified_workspace_header(monkeypatch: pytest.MonkeyPatch) -> None:
    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=404, detail="Workspace not found.")

    async def fail_insert(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("artifact insert must not run without workspace access")

    class FailPipeline:
        async def ingest_text(self, *args: Any, **kwargs: Any) -> None:
            raise AssertionError("RAG ingestion must not run without workspace access")

    monkeypatch.setattr(artifacts, "require_workspace_access", deny_access)
    monkeypatch.setattr(artifacts, "insert_one", fail_insert)
    monkeypatch.setattr(artifacts, "RAGIngestionPipeline", lambda *args, **kwargs: FailPipeline())
    client = _client({"sub": "outsider", "role": "authenticated"})

    response = client.post(
        "/artifacts",
        headers={"X-Omnix-Workspace": "ws-1"},
        json={"title": "Injected", "type": "note", "content": "polluted context"},
    )

    assert response.status_code == 404


def test_workspace_artifact_update_requires_creator_or_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1"}

    async def member_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return WorkspaceAccess(
            workspace={"id": workspace_id, "user_id": "founder-1", "workspace_type": "workspace"},
            role="member",
        )

    async def fail_update(*args: Any, **kwargs: Any) -> dict[str, Any]:
        raise AssertionError("generic workspace members must not update shared artifacts")

    monkeypatch.setattr(artifacts, "select_one_trusted", fake_select)
    monkeypatch.setattr(artifacts, "require_workspace_access", member_access)
    monkeypatch.setattr(artifacts, "update_one_trusted", fail_update)
    client = _client({"sub": "member-1", "role": "authenticated"})

    response = client.patch("/artifacts/artifact-1", json={"title": "Changed"})

    assert response.status_code == 403


def test_workspace_artifact_update_uses_tenant_scope_for_manager(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1"}

    async def manager_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return WorkspaceAccess(
            workspace={"id": workspace_id, "user_id": "manager-1", "workspace_type": "workspace"},
            role="founder",
        )

    async def fake_update(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1", **payload}

    monkeypatch.setattr(artifacts, "select_one_trusted", fake_select)
    monkeypatch.setattr(artifacts, "require_workspace_access", manager_access)
    monkeypatch.setattr(artifacts, "update_one_trusted", fake_update)
    client = _client({"sub": "manager-1", "role": "authenticated"})

    response = client.patch("/artifacts/artifact-1", json={"title": "Changed"})

    assert response.status_code == 200
    assert captured == {
        "table": "artifacts",
        "filters": {"id": "artifact-1", "workspace_id": "ws-1"},
        "payload": {"title": "Changed"},
    }


def test_delete_artifact_removes_document_chunks_with_tenant_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    deleted: list[tuple[str, dict[str, Any]]] = []

    async def fake_select(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any]:
        return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1"}

    async def owner_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return WorkspaceAccess(
            workspace={"id": workspace_id, "user_id": "owner-1", "workspace_type": "workspace"},
            role="founder",
        )

    async def fake_delete(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        deleted.append((table, filters))
        return [{"id": "deleted"}]

    monkeypatch.setattr(artifacts, "select_one_trusted", fake_select)
    monkeypatch.setattr(artifacts, "require_workspace_access", owner_access)
    monkeypatch.setattr(artifacts, "delete_many_trusted", fake_delete)
    client = _client({"sub": "owner-1", "role": "authenticated"})

    response = client.delete("/artifacts/artifact-1")

    assert response.status_code == 204
    assert deleted == [
        ("documents", {"file_id": "artifact-1", "workspace_id": "ws-1"}),
        ("artifacts", {"id": "artifact-1", "workspace_id": "ws-1"}),
    ]

