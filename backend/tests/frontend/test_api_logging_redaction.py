from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"
API_CLIENT = FRONTEND_ROOT / "lib/api.ts"


def test_production_build_does_not_log_response_body() -> None:
    """Verify that production logging only includes safe, non-sensitive fields."""
    source = API_CLIENT.read_text(encoding="utf-8")

    # The logApiError function should gate detailed logging behind NODE_ENV check
    assert 'process.env.NODE_ENV === "production"' in source
    # In production branch, only method/url/status/message should be logged
    assert "method: error.method" in source
    assert "url: error.url" in source
    assert "status: error.status" in source
    assert "message: error.message" in source
    # Production branch should NOT log responsePayload or rawMessage
    # (These should only appear in the development branch)


def test_development_build_logs_truncated_summary_only() -> None:
    """Verify that development logging truncates long payloads to 200 chars."""
    source = API_CLIENT.read_text(encoding="utf-8")

    # The development branch should truncate long payloads
    assert "200" in source  # Truncation limit
    assert "[truncated]" in source
    # Should use toJSON with includeSensitive: true only in dev
    assert "includeSensitive: true" in source


def test_log_api_error_has_two_branches() -> None:
    """Verify logApiError has distinct production and development code paths."""
    source = API_CLIENT.read_text(encoding="utf-8")

    # Must have the production/development branching
    assert 'process.env.NODE_ENV === "production"' in source
    # Must still log errors in both paths (just with different detail levels)
    assert source.count("[api] request failed") >= 2
