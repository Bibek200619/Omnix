from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.schemas.connectors import ConnectorCreate
from app.services.document_context_service import StoredDocumentChunks
from app.services import workspace_connector_service as connectors
from app.services.supabase_service import SupabaseServiceError
from app.services.workspace_service import WorkspaceAccess


def _access(workspace_id: str = "workspace-1") -> WorkspaceAccess:
    return WorkspaceAccess(
        workspace={
            "id": workspace_id,
            "user_id": "owner-1",
            "name": "Ops",
            "workspace_type": "super_workspace",
            "parent_workspace_id": None,
            "is_global": False,
        },
        role="member",
    )


@pytest.mark.asyncio
async def test_repository_connector_persists_real_setup_job(monkeypatch: pytest.MonkeyPatch) -> None:
    inserted: dict[str, object] = {}
    updated: dict[str, object] = {}
    created_job: dict[str, object] = {}

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        assert workspace_id == "workspace-1"
        assert user_id == "user-1"
        return _access(workspace_id)

    async def fake_insert_one(table: str, payload: dict[str, object]) -> dict[str, object]:
        assert table == "workspace_connectors"
        inserted.update(payload)
        return {"id": "connector-1", "created_at": "2026-06-01T00:00:00+00:00", **payload}

    async def fake_insert_one_trusted(table: str, payload: dict[str, object]) -> dict[str, object]:
        assert table == "jobs"
        assert payload["type"] == "connector_setup_request"
        created_job.update(payload)
        return dict(payload)

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "workspace_connectors"
        assert filters == {"id": "connector-1"}
        updated.update(payload)
        return {"id": "connector-1", **inserted, **payload}

    async def fake_job(*args, **kwargs):
        return {"id": "job-1", "type": "connector_setup_request", "status": "queued"}

    monkeypatch.setattr(connectors, "require_workspace_access", fake_access)
    monkeypatch.setattr(connectors, "insert_one", fake_insert_one)
    monkeypatch.setattr(connectors, "insert_one_trusted", fake_insert_one_trusted)
    monkeypatch.setattr(connectors, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(connectors, "_job_for_connector", fake_job)

    result = await connectors.create_workspace_connector(
        ConnectorCreate(
            workspace_id="workspace-1",
            connector_type="file_repository",
            display_name="Runbooks",
            config={"repository": "https://github.com/acme/runbooks", "auth_mode": "none"},
        ),
        "user-1",
        None,
    )

    assert inserted["status"] == "request_submitted"
    assert inserted["config"] == {"repository": "https://github.com/acme/runbooks", "auth_mode": "none"}
    assert updated["job_id"] == created_job["id"]
    assert result["job"]["status"] == "queued"


@pytest.mark.asyncio
async def test_knowledge_link_success_creates_retrievable_file(monkeypatch: pytest.MonkeyPatch) -> None:
    file_payload: dict[str, object] = {}
    chunk_payload: dict[str, object] = {}
    connector_update: dict[str, object] = {}

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return _access(workspace_id)

    async def fake_fetch(url: str) -> connectors.LinkFetchResult:
        return connectors.LinkFetchResult(
            ok=True,
            url=url,
            title="Policy",
            content_type="text/html",
            text="Policy body Omnix can retrieve.",
        )

    async def fake_insert_one(table: str, payload: dict[str, object]) -> dict[str, object]:
        if table == "workspace_connectors":
            return {"id": "connector-1", "created_at": "2026-06-01T00:00:00+00:00", **payload}
        if table == "files":
            file_payload.update(payload)
            return {"id": "file-1", **payload}
        raise AssertionError(table)

    async def fake_store_chunks(**kwargs):
        chunk_payload.update(kwargs)
        return StoredDocumentChunks(chunk_count=1, chunk_ids=["chunk-1"])

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "workspace_connectors"
        connector_update.update(payload)
        return {
            "id": "connector-1",
            "workspace_id": "workspace-1",
            "user_id": "user-1",
            "connector_type": "knowledge_link",
            "display_name": "Policy",
            "created_at": "2026-06-01T00:00:00+00:00",
            **payload,
        }

    async def fake_activity(**kwargs):
        return None

    async def fake_job(row):
        return None

    monkeypatch.setattr(connectors, "require_workspace_access", fake_access)
    monkeypatch.setattr(connectors, "fetch_knowledge_link", fake_fetch)
    monkeypatch.setattr(connectors, "insert_one", fake_insert_one)
    monkeypatch.setattr(connectors, "store_extracted_text_chunks", fake_store_chunks)
    monkeypatch.setattr(connectors, "update_one_trusted", fake_update_one_trusted)
    monkeypatch.setattr(connectors, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(connectors, "_job_for_connector", fake_job)

    result = await connectors.create_workspace_connector(
        ConnectorCreate(
            workspace_id="workspace-1",
            connector_type="knowledge_link",
            display_name="Policy",
            config={"url": "https://example.com/policy"},
        ),
        "user-1",
        None,
    )

    assert file_payload["workspace_id"] == "workspace-1"
    assert file_payload["metadata"]["source"] == "knowledge_link"
    assert chunk_payload["file_id"] == "file-1"
    assert chunk_payload["text"] == "Policy body Omnix can retrieve."
    assert connector_update["status"] == "connected"
    assert result["source_file_id"] == "file-1"


@pytest.mark.asyncio
async def test_database_connector_requires_connection_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return _access(workspace_id)

    monkeypatch.setattr(connectors, "require_workspace_access", fake_access)

    with pytest.raises(HTTPException) as exc_info:
        await connectors.create_workspace_connector(
            ConnectorCreate(
                workspace_id="workspace-1",
                connector_type="external_database",
                config={"engine": "postgres", "host": "db.internal"},
            ),
            "user-1",
            None,
        )

    assert exc_info.value.status_code == 400


def test_private_knowledge_urls_are_not_fetchable() -> None:
    assert connectors._is_safe_http_url("https://example.com/docs") is True
    assert connectors._is_safe_http_url("http://localhost:8080/docs") is False
    assert connectors._is_safe_http_url("http://127.0.0.1/docs") is False


def test_html_link_parser_falls_back_when_bs4_is_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(connectors, "BeautifulSoup", None)
    response = connectors.httpx.Response(
        200,
        headers={"content-type": "text/html; charset=utf-8"},
        content=b"<html><head><title>Policy</title><script>ignore()</script></head><body><h1>Policy</h1><p>Readable body.</p></body></html>",
        request=connectors.httpx.Request("GET", "https://example.com/policy"),
    )

    result = connectors._parse_link_response(response, "https://example.com/policy")

    assert result.ok is True
    assert result.title == "Policy"
    assert "Readable body." in result.text
    assert "ignore()" not in result.text


@pytest.mark.asyncio
async def test_connector_serialization_survives_missing_job_preview(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_select_one(*args, **kwargs):
        raise SupabaseServiceError("jobs table unavailable")

    monkeypatch.setattr(connectors, "select_one_trusted", fake_select_one)

    result = await connectors._serialize_connector(
        {
            "id": "connector-1",
            "workspace_id": "workspace-1",
            "user_id": "user-1",
            "connector_type": "file_repository",
            "display_name": "Runbooks",
            "status": "request_submitted",
            "config": {"repository": "https://example.com/repo", "access_token": "secret"},
            "job_id": "job-1",
        }
    )

    assert result["job"] is None
    assert "access_token" not in result["config"]
