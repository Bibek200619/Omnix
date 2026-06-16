from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import yaml
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_audit_stabilization_contracts_work_together(monkeypatch: pytest.MonkeyPatch, caplog) -> None:
    from app.core import deployment, security
    from app.integrations import google_drive as google_drive_tokens
    from app.jobs import worker
    from app.routers import admin, google_drive, messages

    prod_settings = SimpleNamespace(
        ENV="prod",
        DEV_MODE=False,
        OMNIX_PUBLIC_API_DOCS=None,
        OMNIX_CORS_ALLOWED_ORIGINS="https://app.omni-x.co.in",
        OMNIX_APP_URL="http://localhost:3000",
        OMNIX_ADMIN_USER_IDS="",
    )

    assert deployment.public_api_docs_enabled(prod_settings) is False
    assert deployment.cors_allowed_origins(prod_settings) == ["https://app.omni-x.co.in"]
    assert deployment.cors_allow_credentials(["https://app.omni-x.co.in"]) is True
    incomplete_prod_settings = SimpleNamespace(
        **{
            **prod_settings.__dict__,
            "OMNIX_CORS_ALLOWED_ORIGINS": "",
            "OMNIX_APP_URL": "http://localhost:3000",
        }
    )
    assert deployment.cors_allowed_origins(incomplete_prod_settings) == deployment.DEFAULT_PRODUCTION_CORS_ORIGINS

    monkeypatch.setattr(security, "public_api_docs_enabled", lambda: False)
    assert security._is_exempt_path("/docs") is False
    assert security._is_exempt_path("/health/live") is True
    assert security._is_exempt_path("/integrations/google_drive/callback") is True

    with pytest.raises(HTTPException) as admin_exc:
        await admin.require_admin_user({"sub": "user-1", "role": "authenticated"})
    assert admin_exc.value.status_code == 403
    monkeypatch.setenv("OMNIX_ADMIN_USER_IDS", "admin-1")
    admin_user = {"sub": "admin-1", "role": "authenticated"}
    assert await admin.require_admin_user(admin_user) is admin_user

    monkeypatch.setenv("GOOGLE_OAUTH_STATE_SECRET", "state-secret")
    state = google_drive._sign_oauth_state("admin-1", "workspace-1")
    assert google_drive._verify_oauth_state(state) == ("admin-1", "workspace-1")
    with pytest.raises(HTTPException):
        google_drive._verify_oauth_state(f"{state}x")

    monkeypatch.setenv("OMNIX_TOKEN_ENCRYPTION_KEY", "token-secret")
    encrypted = google_drive_tokens._encrypt_token_value("drive-access-token")
    assert encrypted != "drive-access-token"
    token_row = await google_drive_tokens.ensure_valid_token(
        {
            "id": "token-row-1",
            "access_token": encrypted,
            "refresh_token": google_drive_tokens._encrypt_token_value("drive-refresh-token"),
            "expires_at": int(google_drive_tokens.time.time()) + 3600,
        }
    )
    assert token_row["access_token"] == "drive-access-token"

    secret = "SECRET_DOCUMENT_CONTEXT"
    caplog.set_level(logging.INFO, logger=messages.logger.name)
    messages._log_ollama_prompt_debug(
        conversation_id="conversation-1",
        prompt=f"DOCUMENT CONTEXT:\n{secret}",
        retrieval_debug={
            "strategy": "hybrid",
            "retrieved_chunks_count": 1,
            "first_chunk_preview": secret,
            "diagnostics": {"document_context_count": 1},
        },
    )
    assert secret not in caplog.text
    assert "prompt_preview" not in caplog.text

    fake_redis = AsyncMock()
    fake_redis.brpop = AsyncMock(return_value=None)
    recovered_job = {"id": "job-1", "status": "processing", "attempts": 1}

    async def fake_recover_db_job():
        return recovered_job

    monkeypatch.setattr(worker, "_recover_db_job", fake_recover_db_job)
    job_id, leased_job = await worker._next_job(fake_redis, "omnix:jobs")
    assert job_id == "job-1"
    assert leased_job == recovered_job

    compose_path = Path(__file__).resolve().parents[2] / "docker-compose.prod.yml"
    compose = yaml.safe_load(compose_path.read_text())
    assert "omnix_uploads:/app/uploads" in compose["services"]["backend"]["volumes"]
    assert "omnix_uploads:/app/uploads" in compose["services"]["ingestion-worker"]["volumes"]
