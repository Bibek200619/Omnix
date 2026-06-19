from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from app.services import email_service


@pytest.mark.asyncio
async def test_send_welcome_email_uses_branded_html_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    client = SimpleNamespace(Emails=SimpleNamespace(send=MagicMock(return_value={"id": "email_123"})))

    monkeypatch.setattr(
        email_service,
        "get_settings",
        lambda: SimpleNamespace(
            RESEND_API_KEY="test-api-key",
            OMNIX_APP_URL="https://app.omnix.test/",
        ),
    )
    monkeypatch.setattr(email_service, "_get_resend_client", lambda api_key: client)
    monkeypatch.setenv("EMAIL_FROM", "Omnix <welcome@omnix.test>")

    sent = await email_service.send_welcome_email("new.user@example.com", "Ada <Lead>")

    assert sent is True
    client.Emails.send.assert_called_once()
    payload = client.Emails.send.call_args.args[0]
    assert payload["from"] == "Omnix <welcome@omnix.test>"
    assert payload["to"] == ["new.user@example.com"]
    assert payload["subject"] == "Welcome to Omnix - your workspace is ready"
    assert "Open Omnix" in payload["html"]
    assert "Omnix account active" in payload["html"]
    assert "Ada &lt;Lead&gt;" in payload["html"]
    assert "Ada <Lead>" not in payload["html"]
    assert "https://app.omnix.test" in payload["text"]
    assert "Create a workspace" in payload["text"]
