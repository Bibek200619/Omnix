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

