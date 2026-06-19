from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, status

from ..core.security import get_current_user
from ..services.email_service import send_welcome_email
from ..services.profile_service import claim_welcome_email_delivery, reset_welcome_email_delivery_claim

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/email", tags=["email"])


@router.post("/welcome", status_code=status.HTTP_200_OK)
@router.post("/welcome/", status_code=status.HTTP_200_OK, include_in_schema=False)
async def welcome_email(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, bool]:
    """Send a welcome email after successful registration.

    Email delivery failures are logged but never surface as HTTP errors so
    the signup flow is never blocked.
    """
    try:
        claim = await claim_welcome_email_delivery(current_user)
        if not claim.should_send:
            return {"sent": False}

        sent = await send_welcome_email(claim.email, claim.name)
        if not sent:
            await reset_welcome_email_delivery_claim(claim.user_id)
        return {"sent": bool(sent)}
    except Exception:
        logger.exception("Failed to send welcome email.")
        return {"sent": False}
