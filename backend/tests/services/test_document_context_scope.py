from __future__ import annotations

from typing import Any

import pytest

from app.services import document_context_service as docs


@pytest.mark.asyncio
async def test_store_extracted_chunks_replaces_only_workspace_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    deletes: list[dict[str, Any]] = []
    inserts: list[dict[str, Any]] = []

    async def fake_delete(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        deletes.append(filters)
        return []

    async def fake_insert(table: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        inserts.extend(payloads)
        return payloads

    monkeypatch.setattr(docs, "delete_many_trusted", fake_delete)
    monkeypatch.setattr(docs, "insert_many", fake_insert)

    result = await docs.store_extracted_text_chunks(
        file_id="file-1",
        user_id="user-1",
        workspace_id="workspace-1",
        text="alpha beta gamma " * 200,
        replace_existing=True,
    )

    assert result.chunk_count > 0
    assert deletes == [{"file_id": "file-1", "workspace_id": "workspace-1"}]
    assert {payload["workspace_id"] for payload in inserts} == {"workspace-1"}


@pytest.mark.asyncio
async def test_store_extracted_chunks_replaces_only_personal_scope(monkeypatch: pytest.MonkeyPatch) -> None:
    deletes: list[dict[str, Any]] = []

    async def fake_delete(table: str, filters: dict[str, Any]) -> list[dict[str, Any]]:
        deletes.append(filters)
        return []

    async def fake_insert(table: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return payloads

    monkeypatch.setattr(docs, "delete_many_trusted", fake_delete)
    monkeypatch.setattr(docs, "insert_many", fake_insert)

    await docs.store_extracted_text_chunks(
        file_id="file-1",
        user_id="user-1",
        workspace_id=None,
        text="alpha beta gamma " * 200,
        replace_existing=True,
    )

    assert deletes == [{"file_id": "file-1", "user_id": "user-1", "workspace_id": {"is": None}}]


@pytest.mark.asyncio
async def test_load_document_chunks_supports_bounded_ordered_windows(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, Any] = {}

    async def fake_select_all(table: str, columns: str, filters: dict[str, Any], **kwargs: Any) -> list[dict[str, Any]]:
        captured.update({"table": table, "filters": filters, **kwargs})
        return [{"id": "chunk-41", "workspace_id": "workspace-1", "chunk_index": 40}]

    monkeypatch.setattr(docs, "select_all_trusted", fake_select_all)

    result = await docs._load_document_chunks(
        ["file-1"],
        user_id="user-1",
        workspace_id="workspace-1",
        limit=41,
        offset=40,
        order_by="chunk_index",
    )

    assert result == [{"id": "chunk-41", "workspace_id": "workspace-1", "chunk_index": 40}]
    assert captured == {
        "table": "documents",
        "filters": {"file_id": ["file-1"], "workspace_id": ["workspace-1"]},
        "order_by": "chunk_index",
        "limit": 41,
        "offset": 40,
    }
