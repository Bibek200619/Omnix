from __future__ import annotations

from io import BytesIO
from typing import Any

import pytest
from starlette.datastructures import Headers, UploadFile
from starlette.requests import Request

from app.jobs import queue
from app.routers import messages, upload
from app.services import chat_service, decision_candidate_service as candidates, document_context_service
from app.services.chat_service import AIGeneration, AIMessage, ProviderManager
from app.services.query_classifier import SearchDecision


DOCUMENT_TEXT = """# Platform Decision Memo

Decision: Adopt vector search-backed RAG for uploaded architecture notes.
Rationale: The platform needs reliable source-grounded answers during large workspace conversations.
Operational note: immediate document chunks keep chat responsive while the ingestion worker creates embeddings.
"""


def _workspace_request(workspace_id: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/upload",
            "headers": [(b"x-omnix-workspace", workspace_id.encode("utf-8"))],
        }
    )


def _matches_filters(row: dict[str, Any], filters: dict[str, Any]) -> bool:
    for key, expected in filters.items():
        value = row.get(key)
        if isinstance(expected, list):
            if value not in expected:
                return False
            continue
        if value != expected:
            return False
    return True


@pytest.mark.asyncio
async def test_file_upload_ingestion_rag_chat_and_decision_extraction(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    user_id = "user-platform"
    workspace_id = "workspace-platform"
    state: dict[str, list[dict[str, Any]]] = {
        "files": [],
        "documents": [],
        "jobs": [],
        "activities": [],
    }
    generation_prompts: list[str] = []

    async def fake_require_workspace_access(workspace_id_arg: str, user_id_arg: str):
        assert workspace_id_arg == workspace_id
        assert user_id_arg == user_id
        return {"workspace": {"id": workspace_id_arg}, "role": "founder"}

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "files"
        row = {
            "id": "file-platform",
            "created_at": "2026-06-18T00:00:00+00:00",
            **payload,
        }
        state["files"].append(row)
        return row

    async def fake_update_one(table: str, filters: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any] | None:
        rows = state[table]
        for row in rows:
            if _matches_filters(row, filters):
                row.update(payload)
                return row
        return None

    async def fake_insert_many(table: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assert table == "documents"
        state["documents"].extend(payloads)
        return payloads

    async def fake_delete_many_trusted(table: str, filters: dict[str, Any]) -> None:
        assert table == "documents"
        state["documents"] = [row for row in state["documents"] if not _matches_filters(row, filters)]

    async def fake_select_all_trusted(
        table: str,
        columns: str,
        filters: dict[str, Any],
        **kwargs: Any,
    ) -> list[dict[str, Any]]:
        del columns, kwargs
        return [row for row in state[table] if _matches_filters(row, filters)]

    async def fake_select_file(table: str, columns: str, filters: dict[str, Any]) -> dict[str, Any] | None:
        del columns
        assert table == "files"
        for row in state["files"]:
            if _matches_filters(row, filters):
                return row
        return None

    async def fake_load_chunks(file_ids: list[str], **kwargs: Any) -> list[dict[str, Any]]:
        assert kwargs["workspace_id"] == workspace_id
        return [row for row in state["documents"] if row.get("file_id") in file_ids]

    async def fake_log_activity(**kwargs: Any) -> None:
        state["activities"].append(kwargs)

    async def fake_enqueue_job(payload: dict[str, Any]) -> str:
        state["jobs"].append(payload)
        return "job-platform"

    async def fake_web_supplements(*args: Any, **kwargs: Any):
        del args, kwargs
        return (
            [],
            [],
            SearchDecision(
                requested_mode="workspace",
                effective_mode="workspace",
                needs_web=False,
                confidence=1.0,
                reasons=["integration_test"],
            ),
            {"enabled": False},
        )

    class PromptAwareProvider:
        name = "ollama"

        async def generate(self, prompt: str, context=None, **kwargs: Any) -> AIGeneration:
            del context, kwargs
            generation_prompts.append(prompt)
            if "Extract likely decision candidates" in prompt:
                assert "Adopt vector search-backed RAG" in prompt
                return AIGeneration(
                    content=(
                        '{"candidates":[{"title":"Adopt vector search-backed RAG",'
                        '"reason":"The memo explicitly records this as the platform decision.",'
                        '"confidence":"high","supporting_evidence":["Decision: Adopt vector search-backed RAG for uploaded architecture notes."]}]}'
                    ),
                    model="phi3:mini",
                    provider="ollama",
                )

            assert "DOCUMENT CONTEXT:" in prompt
            assert "Adopt vector search-backed RAG" in prompt
            return AIGeneration(
                content="The uploaded memo says to adopt vector search-backed RAG for architecture notes.",
                model="phi3:mini",
                provider="ollama",
                usage={"prompt_tokens": 128, "completion_tokens": 18},
            )

    monkeypatch.setattr(upload, "UPLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(upload, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(upload, "insert_one", fake_insert_one)
    monkeypatch.setattr(upload, "update_one", fake_update_one)
    monkeypatch.setattr(upload, "log_workspace_activity", fake_log_activity)
    monkeypatch.setattr(queue, "enqueue_job", fake_enqueue_job)
    monkeypatch.setattr(document_context_service, "insert_many", fake_insert_many)
    monkeypatch.setattr(document_context_service, "delete_many_trusted", fake_delete_many_trusted)
    monkeypatch.setattr(document_context_service, "select_all_trusted", fake_select_all_trusted)
    monkeypatch.setattr(messages, "_build_web_supplements", fake_web_supplements)
    monkeypatch.setattr(candidates, "require_workspace_access", fake_require_workspace_access)
    monkeypatch.setattr(candidates, "select_one_trusted", fake_select_file)
    monkeypatch.setattr(candidates, "_load_document_chunks", fake_load_chunks)
    monkeypatch.setattr(candidates, "log_workspace_activity", fake_log_activity)

    manager = ProviderManager(
        providers={"ollama": PromptAwareProvider()},
        provider_order=["ollama"],
        request_timeout=1.0,
    )
    monkeypatch.setattr(chat_service, "get_chat_service", lambda: manager)

    upload_file = UploadFile(
        BytesIO(DOCUMENT_TEXT.encode("utf-8")),
        filename="platform-decision.md",
        headers=Headers({"content-type": "text/markdown"}),
    )
    uploaded = await upload.upload_file(
        _workspace_request(workspace_id),
        file=upload_file,
        conversation_id=None,
        current_user={"sub": user_id},
    )

    assert uploaded["id"] == "file-platform"
    assert uploaded["processing_status"] == "queued"
    assert uploaded["processing_job_id"] == "job-platform"
    assert uploaded["metadata"]["processing_status"] == "queued"
    assert not state["documents"]
    assert state["jobs"] == [
        {
            "type": "ingest_file",
            "file_id": "file-platform",
            "user_id": user_id,
            "workspace_id": workspace_id,
            "_queue": "omnix:jobs",
        }
    ]

    stored_chunks = await document_context_service.store_extracted_text_chunks(
        file_id=uploaded["id"],
        user_id=user_id,
        text=DOCUMENT_TEXT,
        workspace_id=workspace_id,
        replace_existing=True,
    )
    state["files"][0]["processing_status"] = "searchable"
    state["files"][0]["metadata"].update(
        {
            "processing_status": "searchable",
            "text_chunk_count": stored_chunks.chunk_count,
            "text_chunks_truncated": stored_chunks.truncated,
        }
    )

    assert state["documents"]

    prompt, sources, retrieval_debug = await messages._retrieve_prompt_context(
        "In the uploaded document, what decision was made about vector search?",
        user_id,
        "conversation-platform",
        workspace_id,
        attachment_ids=[uploaded["id"]],
        search_mode="workspace",
        intelligence_profile={
            "workspace_id": workspace_id,
            "workspace_name": "Platform",
            "scope_workspace_ids": [workspace_id],
        },
    )

    assert "DOCUMENT CONTEXT:" in prompt
    assert "Adopt vector search-backed RAG" in prompt
    assert sources
    assert retrieval_debug["strategy"] == "uploaded_document"

    generation = await chat_service.generate_ai_response(
        prompt,
        context=[AIMessage(role="user", content="Prior workspace question")],
        max_tokens=160,
    )

    assert generation.provider == "ollama"
    assert "vector search-backed RAG" in generation.content

    candidate_result = await candidates.document_decision_candidates(
        workspace_id=workspace_id,
        file_id=uploaded["id"],
        user_id=user_id,
    )

    assert candidate_result["candidate_count"] == 1
    assert candidate_result["candidates"][0]["title"] == "Adopt vector search-backed RAG"
    assert any("Extract likely decision candidates" in prompt for prompt in generation_prompts)
    assert any(activity["event_type"] == "decision_candidates.generated" for activity in state["activities"])
