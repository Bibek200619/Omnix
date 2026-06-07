from __future__ import annotations

import pytest

from backend.app.routers import messages


@pytest.mark.asyncio
async def test_retrieval_blocks_document_prompt_during_processing(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_uploaded_context(*args, **kwargs):
        return None

    async def fake_unavailable_documents(*args, **kwargs):
        return [
            {
                "id": "file-1",
                "file_name": "scan.pdf",
                "extraction_status": "processing",
                "extraction_failure_reason": None,
            }
        ]

    async def fail_has_documents(*args, **kwargs):
        raise AssertionError("retrieval should stop before hybrid document lookup")

    monkeypatch.setattr(messages, "build_uploaded_document_context", fake_uploaded_context)
    monkeypatch.setattr(messages, "find_unavailable_uploaded_documents", fake_unavailable_documents)
    monkeypatch.setattr(messages, "_has_retrievable_documents", fail_has_documents)

    prompt, sources, debug = await messages._retrieve_prompt_context(
        "Summarize this PDF",
        "user-1",
        "conversation-1",
        "workspace-1",
        [],
        "workspace",
        {"scope_workspace_ids": ["workspace-1"]},
    )

    assert sources == []
    assert debug["strategy"] == "document_unavailable"
    assert prompt == "I cannot summarize scan.pdf yet because text extraction has not completed."
    assert debug["diagnostics"]["unavailable_documents"][0]["extraction_status"] == "processing"
