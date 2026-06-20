from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"
API_CLIENT = FRONTEND_ROOT / "lib/api.ts"
ERRORS = FRONTEND_ROOT / "lib/errors.ts"


def test_api_client_recovers_401_without_global_signout() -> None:
    source = API_CLIENT.read_text(encoding="utf-8")

    assert ".auth.signOut(" not in source
    assert "refreshSession()" in source
    assert "fetchWithAuthRecovery" in source
    assert "if (retryResponse.status !== 401)" in source


def test_api_errors_redact_sensitive_payloads_in_production_logs() -> None:
    api_source = API_CLIENT.read_text(encoding="utf-8")
    error_source = ERRORS.read_text(encoding="utf-8")

    assert "includeSensitive" in api_source
    assert "sensitiveFieldsRedacted" in api_source
    assert 'process.env.NODE_ENV !== "production"' in error_source
    assert "Client error redacted in production logs." in error_source
    assert "apiError.toJSON({ includeSensitive: false })" in error_source
    assert "responsePayload: diagnostics.responsePayload ?? apiError?.responsePayload" in error_source
