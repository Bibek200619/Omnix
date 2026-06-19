import os
import resend
from dotenv import load_dotenv

load_dotenv()

resend.api_key = os.getenv("RESEND_API_KEY")


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