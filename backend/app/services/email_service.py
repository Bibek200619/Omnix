import os
from dataclasses import dataclass
from html import escape
from importlib import import_module
from types import ModuleType
from urllib.parse import quote

from dotenv import load_dotenv

from ..settings import get_settings

load_dotenv()

_resend_client: ModuleType | None = None
_resend_import_failed = False


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


def _get_resend_client(api_key: str | None) -> ModuleType | None:
    global _resend_client, _resend_import_failed

    if not api_key or _resend_import_failed:
        return None

    if _resend_client is None:
        try:
            _resend_client = import_module("resend")
        except ModuleNotFoundError:
            _resend_import_failed = True
            return None

    _resend_client.api_key = api_key
    return _resend_client


async def send_welcome_email(email: str, name: str):
    settings = get_settings()
    client = _get_resend_client(settings.RESEND_API_KEY or os.getenv("RESEND_API_KEY"))
    if client is None:
        return False

    app_url = settings.OMNIX_APP_URL.rstrip("/") or "http://localhost:3000"
    safe_name = escape(name.strip()) if isinstance(name, str) and name.strip() else ""
    greeting = f"Congratulations, {safe_name}!" if safe_name else "Congratulations!"
    safe_app_url = escape(app_url, quote=True)

    try:
        client.Emails.send(
            {
                "from": os.getenv(
                    "EMAIL_FROM",
                    "Omnix <noreply@omni-x.co.in>",
                ),
                "to": [email],
                "subject": "Welcome to Omnix - your workspace is ready",
                "text": (
                    f"{greeting} Your Omnix account is ready. "
                    "Create a workspace, invite teammates, upload knowledge, and start working with AI. "
                    f"Open Omnix: {app_url}"
                ),
                "html": f"""
                <div style="margin:0;background:#061020;padding:32px 16px;font-family:Arial,Helvetica,sans-serif;color:#e5f8ff;">
                  <div style="max-width:640px;margin:0 auto;overflow:hidden;border:1px solid rgba(0,255,255,0.22);border-radius:24px;background:linear-gradient(180deg,#0b1b30 0%,#071221 100%);box-shadow:0 28px 90px rgba(0,0,0,0.42);">
                    <div style="padding:28px 28px 12px;background:radial-gradient(circle at 20% 0%,rgba(0,255,255,0.24),transparent 34%),radial-gradient(circle at 100% 20%,rgba(51,102,255,0.22),transparent 32%);">
                      <div style="display:inline-block;border:1px solid rgba(0,255,255,0.3);border-radius:999px;background:rgba(0,255,255,0.08);padding:7px 12px;color:#74f7ff;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">
                        Omnix account active
                      </div>
                      <h1 style="margin:22px 0 10px;color:#ffffff;font-size:32px;line-height:1.12;letter-spacing:-0.02em;">
                        {greeting}
                      </h1>
                      <p style="margin:0;max-width:520px;color:#b8c7d9;font-size:16px;line-height:1.65;">
                        Your AI-native workspace is ready for documents, teammates, decisions, and focused execution.
                      </p>
                    </div>

                    <div style="padding:12px 28px 30px;">
                      <div style="margin:16px 0 24px;border:1px solid rgba(255,255,255,0.08);border-radius:18px;background:rgba(255,255,255,0.04);padding:18px;">
                        <div style="display:grid;gap:12px;">
                          <p style="margin:0;color:#eafcff;font-size:15px;line-height:1.6;">
                            Start by creating your first workspace, inviting the people who need context, and uploading the knowledge Omnix should reason over.
                          </p>
                          <p style="margin:0;color:#8fa4ba;font-size:14px;line-height:1.6;">
                            Omnix keeps work scoped to the right workspace so conversations, sources, and team access stay organized from day one.
                          </p>
                        </div>
                      </div>

                      <a href="{safe_app_url}"
                         style="display:inline-block;border-radius:14px;background:#00ffff;color:#061020;padding:14px 22px;text-decoration:none;font-size:14px;font-weight:800;box-shadow:0 0 32px rgba(0,255,255,0.35);">
                        Open Omnix
                      </a>

                      <p style="margin:22px 0 0;color:#7f91a8;font-size:12px;line-height:1.6;">
                        If the button does not work, open this link:
                        <br>
                        <a href="{safe_app_url}" style="color:#74f7ff;text-decoration:none;">{safe_app_url}</a>
                      </p>

                      <p style="margin:26px 0 0;color:#b8c7d9;font-size:14px;line-height:1.6;">
                        Welcome aboard,<br>
                        <strong style="color:#ffffff;">The Omnix Team</strong>
                      </p>
                    </div>
                  </div>
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

    client = _get_resend_client(api_key)
    if client is None:
        return EmailDeliveryResult(
            status="skipped",
            error="Resend package is not installed",
        )

    app_url = settings.OMNIX_APP_URL.rstrip("/") or "http://localhost:3000"
    invite_url = f"{app_url}/invite?invite={quote(invite_id)}"
    subject_workspace_name = workspace_name or "Omnix workspace"
    subject_inviter_label = inviter_label or "A teammate"
    safe_workspace_name = escape(workspace_name or "Omnix workspace")
    safe_inviter_label = escape(inviter_label or "A teammate")
    safe_invite_url = escape(invite_url, quote=True)

    try:
        response = client.Emails.send(
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
