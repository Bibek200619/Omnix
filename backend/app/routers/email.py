from __future__ import annotations

import logging

from fastapi import APIRouter, status

from ..schemas.email import WelcomeEmailRequest
from ..services.email_service import send_welcome_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["email"])


@router.post("/welcome", status_code=status.HTTP_200_OK)
@router.post("/welcome/", status_code=status.HTTP_200_OK, include_in_schema=False)
async def welcome_email(payload: WelcomeEmailRequest) -> dict[str, bool]:
    """Send a welcome email after successful registration.

    Email delivery failures are logged but never surface as HTTP errors so
    the signup flow is never blocked.
    """
    try:
        await send_welcome_email(payload.email, payload.name)
        return {"sent": True}
    except Exception:
        logger.exception("Failed to send welcome email to %s", payload.email)
        return {"sent": False}
