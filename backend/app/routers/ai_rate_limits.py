from __future__ import annotations

from fastapi import HTTPException, status

from ..services.distributed_rate_limit import RateLimitExceeded, RateLimitUnavailable, enforce_rate_limit

EXPENSIVE_AI_RATE_LIMIT_REQUESTS = 5
EXPENSIVE_AI_RATE_LIMIT_WINDOW_SECONDS = 60.0


async def enforce_expensive_ai_rate_limit(
    *,
    user_id: str,
    workspace_id: str | None,
    endpoint: str,
) -> None:
    try:
        await enforce_rate_limit(
            user_id=user_id,
            workspace_id=workspace_id,
            endpoint=endpoint,
            limit=EXPENSIVE_AI_RATE_LIMIT_REQUESTS,
            window_seconds=EXPENSIVE_AI_RATE_LIMIT_WINDOW_SECONDS,
        )
    except RateLimitExceeded as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please try again later.",
            headers={"Retry-After": str(max(1, int(exc.retry_after_seconds)))},
        ) from exc
    except RateLimitUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="AI rate limiting is temporarily unavailable.",
        ) from exc
