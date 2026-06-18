from __future__ import annotations

from collections.abc import Awaitable, Callable
from functools import lru_cache
import logging
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError, PyJWKClientError
from starlette.concurrency import run_in_threadpool
from supabase_auth.errors import AuthApiError, AuthError, AuthInvalidJwtError, AuthRetryableError

from .config import get_settings
from ..db.supabase_client import get_supabase_auth_client

AUTH_EXEMPT_PATHS = {
    "/health",
    "/health/live",
    "/health/ready",
    "/docs",
    "/docs/oauth2-redirect",
    "/integrations/google_drive/callback",
    "/openapi.json",
    "/redoc",
}
AUTH_EXEMPT_PREFIXES: tuple[str, ...] = ()
ALLOWED_JWT_ALGORITHMS = {"RS256", "ES256"}
SUPABASE_LEGACY_JWT_ALGORITHMS = {"HS256"}
REQUIRED_JWT_CLAIMS = ("iss", "aud", "exp", "iat", "sub", "role")
EXPECTED_AUDIENCE = "authenticated"

bearer_scheme = HTTPBearer(auto_error=False)
logger = logging.getLogger(__name__)


@lru_cache
def get_jwk_client() -> PyJWKClient:
    settings = get_settings()
    return PyJWKClient(settings.jwks_url, cache_keys=True, cache_jwk_set=True)


def _unauthorized_exception(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _unauthorized_response(detail: str) -> JSONResponse:
    return _error_response(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def _auth_service_exception(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=detail,
    )


def _error_response(
    status_code: int,
    detail: str,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"detail": detail},
        headers=headers,
    )


def _is_exempt_path(path: str) -> bool:
    # Normalize trailing slashes so auth does not block FastAPI's built-in redirects.
    normalized_path = path.rstrip("/") or "/"
    return normalized_path in AUTH_EXEMPT_PATHS or any(
        normalized_path.startswith(prefix)
        for prefix in AUTH_EXEMPT_PREFIXES
    )


def _extract_bearer_token(request: Request) -> str | None:
    authorization = request.headers.get("Authorization")
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def _expected_issuer() -> str:
    settings = get_settings()
    return f"{settings.supabase_base_url}/auth/v1"


def _decode_unverified_payload(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            options={
                "verify_signature": False,
                "verify_aud": False,
                "verify_iss": False,
                "verify_exp": False,
                "verify_iat": False,
            },
        )
    except InvalidTokenError as exc:
        raise _unauthorized_exception("Invalid authentication token.") from exc
    if not isinstance(payload, dict):
        raise _unauthorized_exception("Invalid authentication token.")
    return payload


def _validate_payload_claims(payload: dict[str, Any]) -> dict[str, Any]:
    # Require a subject claim because backend ownership is derived strictly from `sub`.
    if not isinstance(payload, dict) or not isinstance(payload.get("sub"), str) or not payload["sub"].strip():
        raise _unauthorized_exception("Authentication token is missing the subject claim.")

    # Require the standard authenticated user role and reject anon/service tokens.
    if payload.get("role") != EXPECTED_AUDIENCE:
        raise _unauthorized_exception("Authentication token has an invalid role.")

    # Require the audience to target authenticated users even if the claim is serialized as a list.
    audience = payload.get("aud")
    if isinstance(audience, str):
        audience_values = {audience}
    elif isinstance(audience, list):
        audience_values = {value for value in audience if isinstance(value, str)}
    else:
        audience_values = set()
    if EXPECTED_AUDIENCE not in audience_values:
        raise _unauthorized_exception("Authentication token has an invalid audience.")

    # Require the issuer to match this project's Supabase Auth endpoint.
    if payload.get("iss") != _expected_issuer():
        raise _unauthorized_exception("Authentication token has an invalid issuer.")

    return payload


def _verify_with_supabase_auth(token: str) -> dict[str, Any]:
    # Fall back to Supabase Auth because legacy projects can issue HS256 access tokens without JWKS keys.
    try:
        user_response = get_supabase_auth_client().auth.get_user(token)
    except (AuthInvalidJwtError, AuthApiError) as exc:
        if getattr(exc, "status", status.HTTP_401_UNAUTHORIZED) in {
            status.HTTP_400_BAD_REQUEST,
            status.HTTP_401_UNAUTHORIZED,
            status.HTTP_403_FORBIDDEN,
        }:
            raise _unauthorized_exception("Invalid authentication token.") from exc
        logger.exception("Supabase auth rejected token verification unexpectedly.")
        raise _auth_service_exception("Authentication service is unavailable.") from exc
    except (AuthRetryableError, AuthError) as exc:
        logger.exception("Supabase auth verification failed.")
        raise _auth_service_exception("Authentication service is unavailable.") from exc
    except Exception as exc:
        logger.exception("Unexpected Supabase auth verification failure.")
        raise _auth_service_exception("Authentication service is unavailable.") from exc

    user = getattr(user_response, "user", None)
    if user is None or not getattr(user, "id", None):
        raise _unauthorized_exception("Invalid authentication token.")

    payload = _decode_unverified_payload(token)
    if payload.get("sub") != user.id:
        raise _unauthorized_exception("Authentication token subject does not match the verified user.")

    if not payload.get("role") and getattr(user, "role", None):
        payload["role"] = user.role
    if not payload.get("aud") and getattr(user, "aud", None):
        payload["aud"] = user.aud

    return _validate_payload_claims(payload)


def verify_supabase_jwt(token: str) -> dict[str, Any]:
    # Ensure the token looks like a JWT before attempting header parsing or signature verification.
    if not isinstance(token, str) or token.count(".") != 2:
        raise _unauthorized_exception("Invalid authentication token.")

    try:
        header = jwt.get_unverified_header(token)
    except InvalidTokenError as exc:
        raise _unauthorized_exception("Invalid authentication token.") from exc

    if not isinstance(header, dict):
        raise _unauthorized_exception("Invalid authentication token.")

    algorithm = header.get("alg")
    if algorithm in ALLOWED_JWT_ALGORITHMS:
        try:
            signing_key = get_jwk_client().get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=[algorithm],
                audience=EXPECTED_AUDIENCE,
                issuer=_expected_issuer(),
                options={"require": list(REQUIRED_JWT_CLAIMS)},
            )
            return _validate_payload_claims(payload)
        except ExpiredSignatureError as exc:
            raise _unauthorized_exception("Authentication token has expired.") from exc
        except (InvalidTokenError, PyJWKClientError, ValueError):
            return _verify_with_supabase_auth(token)

    if algorithm in SUPABASE_LEGACY_JWT_ALGORITHMS:
        return _verify_with_supabase_auth(token)

    raise _unauthorized_exception("Unsupported authentication token algorithm.")


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    user = getattr(request.state, "user", None)
    if isinstance(user, dict) and user.get("sub"):
        return user

    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized_exception("Missing authentication token.")

    payload = await run_in_threadpool(verify_supabase_jwt, credentials.credentials)
    request.state.user = payload
    return payload


async def auth_context_middleware(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    request.state.user = None

    if request.method == "OPTIONS" or _is_exempt_path(request.url.path):
        return await call_next(request)

    token = _extract_bearer_token(request)
    if token is None:
        return _unauthorized_response("Missing authentication token.")

    try:
        request.state.user = await run_in_threadpool(verify_supabase_jwt, token)
    except HTTPException as exc:
        # Preserve the original auth failure code so upstream auth outages do not masquerade as bad tokens.
        return _error_response(exc.status_code, str(exc.detail), exc.headers)

    return await call_next(request)
