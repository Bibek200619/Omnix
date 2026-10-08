# Resend key recovery

The production key reported by Resend was exposed in a historical version of `backend/.env.example`. Resend's notification says it automatically revoked that key. Current `main` already has an empty `RESEND_API_KEY` template; deleting a value in a later commit does not erase its historical blob.

## Restore email on Render

1. In [Resend API keys](https://resend.com/api-keys), create a replacement with **Sending access**, restricted to the verified sender domain where possible. Check the revoked key's request history for unexpected sends. Never reuse the revoked value.
2. In [omnix-backend Environment](https://dashboard.render.com/web/srv-dapeo24ja7ms73b2sku0/env), replace `RESEND_API_KEY` with the new value using the dashboard's secret input. Keep it out of GitHub, issues, screenshots, logs, and frontend `NEXT_PUBLIC_*` variables.
3. Confirm `EMAIL_FROM` for welcome emails and `RESEND_FROM_EMAIL` for workspace invitations use a verified Resend domain. These are separate settings in the current application.
4. Save and deploy the environment change. Record deployment status and commit without recording the credential. A local ignored `backend/.env` containing the revoked key also needs replacement for local email tests.
5. Send one controlled welcome/invitation test to an operator-owned address. Confirm the application's result and the provider's delivery event. Provider acceptance alone does not prove delivery. Record a sanitized provider message ID and outcome; do not mark email recovery complete without this evidence.

The repository Blueprint declares `RESEND_API_KEY` with `sync: false`; secrets are supplied by the operator. The existing service is managed directly in Render, so a Blueprint edit is not proof of its live environment. The API's liveness endpoint does not verify email credentials or delivery.

## Prevent another commit

Keep private `.env` files ignored and leave `RESEND_API_KEY` empty in templates. Before committing, run:

```sh
python3 -m unittest scripts.secret_guard_test
python3 scripts/secret_guard.py --staged
```

The staged check reads the Git index, so an unstaged cleanup cannot conceal a staged key. The GitHub `Secret guard` workflow runs on pull requests and pushes. It checks Resend-shaped credentials and tracked private env files; it is not a comprehensive detector for every provider. Retain GitHub secret scanning/push protection and GitGuardian checks. CI detects a leaked push after upload; use the local staged check before pushing.

## Historical exposure

Keep the original key revoked permanently. GitHub recommends revoking/rotating credentials first and notes that this may sufficiently mitigate the exposure. Rewriting shared history changes commit hashes and disrupts open PRs, clones, and signatures; it also cannot remove other people's copies. A full history purge requires a separately coordinated rewrite of affected branches/tags and potentially GitHub cached-reference cleanup. Do not force-push `main` as part of the normal recovery PR.

References: [Resend leaked API keys](https://resend.com/docs/knowledge-base/how-to-handle-a-leaked-api-key), [Resend API key management](https://resend.com/docs/dashboard/api-keys/introduction), [GitHub sensitive-data removal](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository).
