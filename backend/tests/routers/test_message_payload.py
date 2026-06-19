from __future__ import annotations

import pytest

from app.routers import messages


def test_with_sources_payload_reads_persisted_payload_sources() -> None:
    message = {
        "id": "message-1",
        "payload": {
            "mode": "web",
            "web_search_used": True,
            "sources": [{"label": "W1", "type": "web", "title": "Live result"}],
            "citations": ["W1"],
        },
        "metadata": {"sources": [{"label": "S1", "type": "workspace"}]},
    }

    result = messages._with_sources_payload(message)

    assert result["sources"] == [{"label": "W1", "type": "web", "title": "Live result"}]


def test_compact_payload_sources_drop_raw_metadata() -> None:
    sources = [
        {
            "label": "W1",
            "type": "web",
            "title": "Example",
            "url": "https://example.com/news",
            "domain": "example.com",
            "metadata": {"raw_tavily_payload": {"large": "do-not-store"}},
            "chunk_preview": "A concise live snippet.",
            "score": 0.87,
        }
    ]

    compact = messages._compact_sources_for_payload(sources)

    assert compact == [
        {
            "label": "W1",
            "type": "web",
            "title": "Example",
            "url": "https://example.com/news",
            "domain": "example.com",
            "snippet": "A concise live snippet.",
            "excerpt": "A concise live snippet.",
            "score": 0.87,
        }
    ]


@pytest.mark.asyncio
async def test_update_assistant_message_persists_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    captured_payload: dict[str, object] = {}

    async def fake_update_one(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "messages"
        assert filters == {"id": "assistant-1", "user_id": "user-1"}
        captured_payload.update(payload)
        return {"id": "assistant-1", **payload}

    monkeypatch.setattr(messages, "update_one", fake_update_one)

    updated = await messages._update_assistant_message(
        assistant_message_id="assistant-1",
        user_id="user-1",
        content="Answer with sources.",
        status_value="completed",
        sources=[
            {
                "label": "W1",
                "type": "web",
                "title": "Live result",
                "url": "https://example.com",
                "excerpt": "Current information.",
            }
        ],
        search_mode="web",
        retrieval_debug={
            "diagnostics": {
                "web_search": {
                    "decision": {
                        "effective_mode": "web",
                    }
                }
            }
        },
    )

    assert updated is not None
    assert captured_payload["content"] == "Answer with sources."
    assert captured_payload["status"] == "completed"
    assert "metadata" not in captured_payload
    assert captured_payload["payload"] == {
        "mode": "web",
        "web_search_used": True,
        "sources": [
            {
                "label": "W1",
                "type": "web",
                "title": "Live result",
                "url": "https://example.com",
                "snippet": "Current information.",
                "excerpt": "Current information.",
            }
        ],
        "citations": ["W1"],
    }


@pytest.mark.asyncio
async def test_persist_assistant_payload_updates_payload_immediately(monkeypatch: pytest.MonkeyPatch) -> None:
    updates: list[dict[str, object]] = []

    async def fake_update_one_trusted(table: str, filters: dict[str, object], payload: dict[str, object]):
        assert table == "messages"
        assert filters == {"id": "assistant-1", "user_id": "user-1"}
        updates.append(payload)
        return {"id": "assistant-1", **payload}

    monkeypatch.setattr(messages, "update_one_trusted", fake_update_one_trusted)

    updated = await messages._persist_assistant_payload(
        assistant_message_id="assistant-1",
        user_id="user-1",
        sources=[
            {
                "label": "W1",
                "type": "web",
                "title": "Live result",
                "url": "https://example.com",
                "snippet": "Current information.",
            }
        ],
        search_mode="web",
        retrieval_debug=None,
        stage="stream_retrieved",
    )

    assert updated is not None
    assert updates == [
        {
            "payload": {
                "mode": "web",
                "web_search_used": True,
                "sources": [
                    {
                        "label": "W1",
                        "type": "web",
                        "title": "Live result",
                        "url": "https://example.com",
                        "snippet": "Current information.",
                        "excerpt": "Current information.",
                    }
                ],
                "citations": ["W1"],
            }
        }
    ]
