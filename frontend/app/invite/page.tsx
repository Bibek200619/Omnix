"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import type { Workspace } from "@/lib/workspace-types";

function getInviteId() {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("invite") || "";
}

function redirectParam(inviteId: string) {
  return encodeURIComponent(`/invite?invite=${inviteId}`);
}

export default function InvitePage() {
  const router = useRouter();
  const { isConfigured, loading, session } = useAuth();
  const [inviteId, setInviteId] = useState("");
  const [accepting, setAccepting] = useState(false);
  const [acceptedWorkspace, setAcceptedWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setInviteId(getInviteId());
  }, []);

  const authRedirect = useMemo(() => {
    return inviteId ? redirectParam(inviteId) : encodeURIComponent("/chat");
  }, [inviteId]);

  useEffect(() => {
    if (!inviteId || loading || !session || accepting || acceptedWorkspace) {
      return;
    }

    async function acceptInvite() {
      try {
        setAccepting(true);
        setError(null);
        const workspace = await apiClient.post<Workspace>(`/workspace-invites/${inviteId}/accept`);
        setAcceptedWorkspace(workspace);
        window.setTimeout(() => {
          router.replace("/chat");
        }, 700);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unable to accept this invitation.");
      } finally {
        setAccepting(false);
      }
    }

    void acceptInvite();
  }, [acceptedWorkspace, accepting, inviteId, loading, router, session]);

  return (
    <main className="omnix-app-bg relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 text-white">
      <section className="relative z-[1] w-full max-w-lg rounded-2xl border border-[var(--omnix-border-2)] bg-[rgba(6,16,32,0.94)] p-6 shadow-[0_40px_120px_rgba(0,0,0,0.58),var(--omnix-glow-xs)] backdrop-blur-2xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-[var(--omnix-glow-xs)]">
          {acceptedWorkspace ? <Check className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
        </div>
        <h1 className="omnix-display mt-5 text-2xl font-semibold tracking-tight">
          {acceptedWorkspace ? "Workspace joined" : "Workspace invitation"}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
          {acceptedWorkspace
            ? `You now have access to ${acceptedWorkspace.name}.`
            : "Sign in with the invited email address to accept this workspace invitation."}
        </p>

        {!inviteId ? (
          <Alert variant="error" title="Invite link is missing" className="mt-5">
            This invitation link does not include an invite id.
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="error" title="Unable to accept invite" className="mt-5">
            {error}
          </Alert>
        ) : null}

        {loading || accepting ? (
          <div className="mt-6 flex items-center gap-3 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 py-3 text-sm text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
            {loading ? "Checking session..." : "Accepting invitation..."}
          </div>
        ) : null}

        {!loading && !session && inviteId ? (
          <div className="mt-6 space-y-3">
            <div className="rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
                <p className="text-sm leading-6 text-slate-300">
                  Omnix verifies that your signed-in email matches the invite before adding you to the workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link
                href={`/login?redirect=${authRedirect}`}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-cyan-300/40 bg-cyan-300 px-4 text-sm font-medium text-slate-950 shadow-glow transition hover:bg-cyan-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Sign in to accept
              </Link>
              <Link
                href={`/register?redirect=${authRedirect}`}
                className="inline-flex h-10 flex-1 items-center justify-center rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 text-sm font-medium text-white transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                Create account
              </Link>
            </div>
          </div>
        ) : null}

        {acceptedWorkspace ? (
          <div className="mt-6">
            <Button type="button" className="w-full" onClick={() => router.replace("/chat")}>
              Continue to Omnix
            </Button>
          </div>
        ) : null}

        {!isConfigured ? (
          <Alert variant="warning" title="Authentication setup required" className="mt-5">
            Supabase authentication is not configured for this environment.
          </Alert>
        ) : null}
      </section>
    </main>
  );
}
