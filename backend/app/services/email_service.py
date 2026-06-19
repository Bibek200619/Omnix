import os
from dataclasses import dataclass
from html import escape
from urllib.parse import quote

import resend
from dotenv import load_dotenv

from ..settings import get_settings

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")


@dataclass(frozen=True)
class EmailDeliveryResult:
    status: str
    provider_id: str | None = None
    error: str | None = None


def _provider_id(response: object) -> str | None:
    if isinstance(response, dict):
        value = response.get("id")
    else:
        value = getattr(response, "id", None)
    return str(value) if value else None


async def send_welcome_email(email: str, name: str):
    try:
        resend.Emails.send(
            {
                "from": os.getenv(
                    "EMAIL_FROM",
                    "Omnix <noreply@omni-x.co.in>",
                ),
                "to": [email],
                "subject": "Welcome to Omnix 🚀",
                "html": f"""
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
                    <h1>Welcome to Omnix, {name}! 🚀</h1>

                    <p>Your account has been successfully created.</p>

                    <p>
                        Omnix is your AI-native workspace where teams,
                        knowledge, collaboration, and intelligence come together.
                    </p>

                    <p>
                        You can now create workspaces, collaborate with teammates,
                        and work alongside AI.
                    </p>

                    <br>

                    <p>We're excited to have you onboard.</p>

                    <p>
                        <strong>— The Omnix Team</strong>
                    </p>
                </div>
                """,
            }
        )

        return True

    except Exception as e:
        print(f"Welcome email failed: {e}")
        return False


async def send_workspace_invite_email(
    *,
    to_email: str,
    workspace_name: str,
    inviter_label: str,
    invite_id: str,
) -> EmailDeliveryResult:
    settings = get_settings()
    api_key = settings.RESEND_API_KEY or os.getenv("RESEND_API_KEY")
    if not api_key:
        return EmailDeliveryResult(
            status="skipped",
            error="RESEND_API_KEY is not configured",
        )

    resend.api_key = api_key
    app_url = settings.OMNIX_APP_URL.rstrip("/") or "http://localhost:3000"
    invite_url = f"{app_url}/invite?invite={quote(invite_id)}"
    subject_workspace_name = workspace_name or "Omnix workspace"
    subject_inviter_label = inviter_label or "A teammate"
    safe_workspace_name = escape(workspace_name or "Omnix workspace")
    safe_inviter_label = escape(inviter_label or "A teammate")
    safe_invite_url = escape(invite_url, quote=True)

    try:
        response = resend.Emails.send(
            {
                "from": settings.RESEND_FROM_EMAIL,
                "to": [to_email],
                "subject": f"{subject_inviter_label} invited you to {subject_workspace_name}",
                "html": f"""
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;">
                    <h1>You're invited to {safe_workspace_name}</h1>

                    <p>{safe_inviter_label} invited you to join this Omnix workspace.</p>

                    <p>
                        <a href="{safe_invite_url}"
                           style="display:inline-block;background:#0f172a;color:#ffffff;
                                  padding:12px 18px;border-radius:8px;text-decoration:none;">
                            Accept invitation
                        </a>
                    </p>

                    <p>If the button does not work, open this link:</p>
                    <p><a href="{safe_invite_url}">{safe_invite_url}</a></p>
                </div>
                """,
            }
        )
        return EmailDeliveryResult(status="sent", provider_id=_provider_id(response))
    except Exception as exc:
        print(f"Workspace invite email failed: {exc}")
        return EmailDeliveryResult(status="failed", error=str(exc))
