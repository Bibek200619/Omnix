from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.core.security import get_current_user
from app.routers import artifacts
from app.services.workspace_common import WorkspaceAccess


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


def test_personal_artifact_list_excludes_workspace_rows(monkeypatch: pytest.MonkeyPatch) -> None:
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

    monkeypatch.setattr(artifacts, "require_active_workspace_access", no_active_workspace)
    monkeypatch.setattr(artifacts, "select_all_trusted", fake_select_all)
    client = _client({"sub": "user-1", "role": "authenticated"})

    response = client.get("/artifacts")

    assert response.status_code == 200
    assert captured["table"] == "artifacts"
    assert captured["filters"] == {
        "user_id": "user-1",
        "workspace_id": {"is": None},
    }


@pytest.mark.parametrize(
    ("path", "hydration_columns"),
    [
        ("/artifacts/artifact-1", artifacts.ARTIFACT_READ_COLUMNS),
        ("/artifacts/artifact-1/export", artifacts.ARTIFACT_EXPORT_COLUMNS),
    ],
)
def test_artifact_content_hydrates_only_after_workspace_capability(
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    hydration_columns: str,
) -> None:
    events: list[tuple[str, object]] = []
    hydrated = {
        "id": "artifact-1",
        "workspace_id": "ws-1",
        "user_id": "owner-1",
        "title": "Private plan",
        "type": "markdown",
        "content": "sensitive workspace content",
        "created_at": None,
        "updated_at": None,
        "pinned": False,
        "metadata": {},
    }

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "artifacts"
        events.append(("select", (columns, filters)))
        if columns == artifacts.ARTIFACT_LOCATOR_COLUMNS:
            return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1"}
        assert columns == hydration_columns
        return hydrated

    async def member_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        events.append(("authorize", (workspace_id, user_id)))
        return WorkspaceAccess(
            workspace={"id": workspace_id, "user_id": "owner-1", "workspace_type": "workspace"},
            role="member",
        )

    monkeypatch.setattr(artifacts, "select_one_trusted", fake_select)
    monkeypatch.setattr(artifacts, "require_workspace_access", member_access)
    client = _client({"sub": "member-1", "role": "authenticated"})

    response = client.get(path)

    assert response.status_code == 200
    assert "sensitive workspace content" in response.text
    assert events == [
        (
            "select",
            (artifacts.ARTIFACT_LOCATOR_COLUMNS, {"id": "artifact-1"}),
        ),
        ("authorize", ("ws-1", "member-1")),
        (
            "select",
            (
                hydration_columns,
                {"id": "artifact-1", "workspace_id": "ws-1"},
            ),
        ),
    ]


def test_artifact_content_is_not_hydrated_when_workspace_access_is_denied(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    selections: list[tuple[str, dict[str, Any]]] = []

    async def fake_select(
        table: str,
        columns: str,
        filters: dict[str, Any],
    ) -> dict[str, Any]:
        assert table == "artifacts"
        selections.append((columns, filters))
        if columns != artifacts.ARTIFACT_LOCATOR_COLUMNS:
            raise AssertionError("Artifact content must not be loaded before authorization.")
        return {"id": "artifact-1", "workspace_id": "ws-1", "user_id": "owner-1"}

    async def deny_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        raise HTTPException(status_code=403, detail="Workspace access denied.")

    monkeypatch.setattr(artifacts, "select_one_trusted", fake_select)
    monkeypatch.setattr(artifacts, "require_workspace_access", deny_access)
    client = _client({"sub": "outsider-1", "role": "authenticated"})

    response = client.get("/artifacts/artifact-1")

    assert response.status_code == 404
    assert response.json() == {"detail": "Artifact not found"}
    assert selections == [
        (artifacts.ARTIFACT_LOCATOR_COLUMNS, {"id": "artifact-1"}),
    ]


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
