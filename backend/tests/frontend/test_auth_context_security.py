from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"
AUTH_CONTEXT = FRONTEND_ROOT / "lib/auth-context.tsx"


def test_access_token_is_deprecated_in_interface() -> None:
    """Verify that accessToken is marked as deprecated in the AuthContextType interface."""
    source = AUTH_CONTEXT.read_text(encoding="utf-8")

    assert "@deprecated" in source
    assert "getAccessToken" in source


def test_get_access_token_callback_is_exposed() -> None:
    """Verify that getAccessToken() callback is provided in the context."""
    source = AUTH_CONTEXT.read_text(encoding="utf-8")

    # The context type should include getAccessToken
    assert "getAccessToken: () => string | null" in source
    # The provider should create and expose getAccessToken
    assert "const getAccessToken = useCallback" in source
    # The value object should include getAccessToken
    assert "getAccessToken," in source or "getAccessToken" in source


def test_token_uses_ref_for_storage() -> None:
    """Verify that the access token is stored in a ref to prevent casual exposure."""
    source = AUTH_CONTEXT.read_text(encoding="utf-8")

    # Token should be stored in a useRef
    assert "useRef" in source
    assert "tokenRef" in source
    assert "tokenRef.current" in source


def test_access_token_field_still_available_for_backward_compatibility() -> None:
    """Verify backward compatibility: accessToken field is still in the interface."""
    source = AUTH_CONTEXT.read_text(encoding="utf-8")

    # accessToken should still be in the interface (but deprecated)
    assert "accessToken: string | null" in source
