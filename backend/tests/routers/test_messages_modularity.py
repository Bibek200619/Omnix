from __future__ import annotations

from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
MESSAGES_ROUTER = BACKEND_ROOT / "app" / "routers" / "messages.py"
PAYLOAD_SERVICE = BACKEND_ROOT / "app" / "services" / "message_payload_service.py"
RETRIEVAL_SERVICE = BACKEND_ROOT / "app" / "services" / "message_retrieval_service.py"


def test_messages_router_delegates_payload_and_retrieval_helpers() -> None:
    router = MESSAGES_ROUTER.read_text(encoding="utf-8")
    payload_service = PAYLOAD_SERVICE.read_text(encoding="utf-8")
    retrieval_service = RETRIEVAL_SERVICE.read_text(encoding="utf-8")

    assert "from ..services import message_payload_service, message_retrieval_service" in router
    assert "message_payload_service.update_assistant_message" in router
    assert "message_retrieval_service.retrieve_prompt_context" in router
    assert "async def retrieve_prompt_context" in retrieval_service
    assert "async def update_assistant_message" in payload_service
    assert "async def persist_assistant_payload" in payload_service


def test_messages_router_stays_below_reviewable_size_threshold() -> None:
    router_lines = MESSAGES_ROUTER.read_text(encoding="utf-8").splitlines()
    payload_lines = PAYLOAD_SERVICE.read_text(encoding="utf-8").splitlines()
    retrieval_lines = RETRIEVAL_SERVICE.read_text(encoding="utf-8").splitlines()

    assert len(router_lines) <= 1_000
    assert len(payload_lines) <= 300
    assert len(retrieval_lines) <= 500
