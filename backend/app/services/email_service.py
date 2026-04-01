from __future__ import annotations

from dataclasses import dataclass
import html
import logging
from urllib.parse import urlencode

import httpx

from ..core.config import get_settings

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class EmailDeliveryResult:
    status: str
    provider_id: str | None = None
    detail: str | None = None


def _app_url() -> str:
    return get_settings().OMNIX_APP_URL.rstrip("/") or "http://localhost:3000"


def build_invite_accept_url(invite_id: str) -> str:
    return f"{_app_url()}/invite?{urlencode({'invite': invite_id})}"


def _invite_email_html(
    *,
    workspace_name: str,
    inviter_label: str,
    accept_url: str,
) -> str:
    safe_workspace = html.escape(workspace_name)
    safe_inviter = html.escape(inviter_label)
    safe_accept_url = html.escape(accept_url, quote=True)

    return f"""\
<!doctype html>
<html>
  <head>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <title>You were invited to Omnix</title>
  </head>
  <body style="margin:0;background:#05070b;color:#e5e7eb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#05070b;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#071017;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 18px;border-bottom:1px solid rgba(255,255,255,.08);">
                <div style="font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#67e8f9;font-weight:700;">Omnix</div>
                <h1 style="margin:16px 0 0;font-size:26px;line-height:1.22;color:#ffffff;">You were invited to join a workspace</h1>
                <p style="margin:12px 0 0;font-size:15px;line-height:1.6;color:#94a3b8;">{safe_inviter} invited you to collaborate in <strong style="color:#e2e8f0;">{safe_workspace}</strong>.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:26px 28px 30px;">
                <div style="border:1px solid rgba(103,232,249,.22);background:rgba(8,145,178,.12);border-radius:14px;padding:16px;margin-bottom:24px;">
                  <div style="font-size:13px;color:#bae6fd;margin-bottom:6px;">Workspace</div>
                  <div style="font-size:18px;font-weight:700;color:#ffffff;">{safe_workspace}</div>
                </div>
                <a href="{safe_accept_url}" style="display:inline-block;background:#67e8f9;color:#071017;text-decoration:none;font-weight:800;border-radius:12px;padding:13px 18px;font-size:14px;">Join Workspace</a>
                <p style="margin:22px 0 0;font-size:13px;line-height:1.6;color:#64748b;">If you are not signed in yet, Omnix will ask you to log in or create an account before accepting the invitation.</p>
              </td>
            </tr>
          </table>
          <p style="margin:18px 0 0;font-size:12px;color:#475569;">This invitation was sent by Omnix.</p>
        </td>
      </tr>
    </table>
  </body>
</html>
"""


def _invite_email_text(
    *,
    workspace_name: str,
    inviter_label: str,
    accept_url: str,
) -> str:
    return (
        f"{inviter_label} invited you to join {workspace_name} on Omnix.\n\n"
        f"Join workspace: {accept_url}\n\n"
        "If you are not signed in yet, Omnix will ask you to log in or create an account first."
    )


async def send_workspace_invite_email(
    *,
    to_email: str,
    workspace_name: str,
    inviter_label: str,
    invite_id: str,
) -> EmailDeliveryResult:
    settings = get_settings()
    api_key = settings.RESEND_API_KEY
    accept_url = build_invite_accept_url(invite_id)

    if not api_key:
        logger.info(
            "Skipping workspace invite email because RESEND_API_KEY is not configured | invite_id=%s | to=%s",
            invite_id,
            to_email,
        )
        return EmailDeliveryResult(status="skipped", detail="RESEND_API_KEY is not configured")

    payload = {
        "from": settings.RESEND_FROM_EMAIL,
        "to": [to_email],
        "subject": "You were invited to join Omnix Workspace",
        "html": _invite_email_html(
            workspace_name=workspace_name,
            inviter_label=inviter_label,
            accept_url=accept_url,
        ),
        "text": _invite_email_text(
            workspace_name=workspace_name,
            inviter_label=inviter_label,
            accept_url=accept_url,
        ),
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Resend rejected workspace invite email | invite_id=%s | status=%s | body=%s",
            invite_id,
            exc.response.status_code,
            exc.response.text[:500],
        )
        return EmailDeliveryResult(status="failed", detail=f"Resend HTTP {exc.response.status_code}")
    except Exception as exc:
        logger.exception("Failed to send workspace invite email | invite_id=%s", invite_id)
        return EmailDeliveryResult(status="failed", detail=str(exc))

    provider_id = str(data.get("id") or "") or None
    logger.info("Workspace invite email sent | invite_id=%s | provider_id=%s", invite_id, provider_id)
    return EmailDeliveryResult(status="sent", provider_id=provider_id)
