"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { apiClient } from "@/lib/api";
import { safeRedirectPath } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";
import type { UserProfile } from "@/lib/profile-context";

type CallbackState = "loading" | "success" | "error";

function friendlyCallbackError(message?: string | null) {
  const normalized = (message || "").trim();
  if (!normalized) {
    return "Omnix could not complete this OAuth sign-in. Please try again.";
  }
  if (/access_denied|cancel/i.test(normalized)) {
    return "OAuth sign-in was cancelled before Omnix could finish authentication.";
  }
  if (/redirect/i.test(normalized)) {
    return "OAuth returned to an unexpected redirect URL. Check the Supabase redirect configuration.";
  }
  return "Omnix could not complete this OAuth sign-in. Please try again.";
}

function oauthDisplayName(user: User) {
  const metadata = user.user_metadata ?? {};
  const name = metadata.full_name || metadata.name || metadata.user_name || metadata.preferred_username;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function oauthAvatarUrl(user: User) {
  const metadata = user.user_metadata ?? {};
  const avatarUrl = metadata.avatar_url || metadata.picture;
  return typeof avatarUrl === "string" && avatarUrl.trim() ? avatarUrl.trim() : null;
}

async function ensureOAuthProfile(user: User | null | undefined) {
  try {
    const profile = await apiClient.get<UserProfile>("/profile");
    if (!user) return;

    const updates: { display_name?: string; avatar_url?: string } = {};
    const displayName = oauthDisplayName(user);
    const avatarUrl = oauthAvatarUrl(user);

    if (!profile.display_name && displayName) {
      updates.display_name = displayName;
    }
    if (!profile.avatar_url && avatarUrl) {
      updates.avatar_url = avatarUrl;
    }

    if (Object.keys(updates).length > 0) {
      await apiClient.patch("/profile", updates);
    }
  } catch (err) {
    console.warn("OAuth session restored, but profile initialization did not complete yet.", err);
  }
}

export function OAuthCallbackClient() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const [state, setState] = useState<CallbackState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/dashboard");
  const [retryNonce, setRetryNonce] = useState(0);
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    async function completeOAuth() {
      if (!supabase || !isConfigured) {
        setState("error");
        setError(authError ?? "Supabase authentication is not configured.");
        return;
      }

      const currentUrl = new URL(window.location.href);
      const next = safeRedirectPath(currentUrl.searchParams.get("next"));
      setNextPath(next);

      const providerError =
        currentUrl.searchParams.get("error_description") ||
        currentUrl.searchParams.get("error");
      if (providerError) {
        setState("error");
        setError(friendlyCallbackError(providerError));
        return;
      }

      try {
        const code = currentUrl.searchParams.get("code");
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            throw exchangeError;
          }
        }

        const { session, error: sessionError } = await refreshSession();
        if (sessionError) {
          throw sessionError;
        }

        let activeSession = session;
        if (!activeSession) {
          const { data, error: fallbackSessionError } = await supabase.auth.getSession();
          if (fallbackSessionError) {
            throw fallbackSessionError;
          }
          if (!data.session) {
            throw new Error("OAuth completed but no Supabase session was restored.");
          }
          activeSession = data.session;
        }

        await ensureOAuthProfile(activeSession.user);
        try {
          await apiClient.post("/email/welcome");
        } catch (emailErr) {
          logClientError("Welcome email request failed", emailErr);
        }
        setState("success");

        window.setTimeout(() => {
          router.replace(next);
        }, 450);
      } catch (err) {
        logClientError("OAuth callback failed", err);
        setState("error");
        setError(friendlyCallbackError(null));
      }
    }

    void completeOAuth();
  }, [authError, isConfigured, refreshSession, retryNonce, router]);

  function retryCallback() {
    processedRef.current = false;
    setState("loading");
    setError(null);
    setRetryNonce((value) => value + 1);
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[var(--omnix-color-061020)] px-4 py-10 text-white">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(var(--omnix-rgba-34-211-238-0-035)_1px,transparent_1px),linear-gradient(90deg,var(--omnix-rgba-34-211-238-0-035)_1px,transparent_1px)] bg-[size:56px_56px]"
      />
      <section className="relative z-10 w-full max-w-md rounded-lg border border-cyan-300/14 bg-[var(--omnix-color-07111f)]/94 p-6 shadow-[0_44px_140px_var(--omnix-rgba-0-0-0-0-58),0_0_90px_var(--omnix-rgba-34-211-238-0-09)] backdrop-blur-xl">
        <Link href="/" className="inline-flex items-center gap-3" aria-label="Omnix home">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
            <OmnixMark size={27} />
          </span>
          <span className="text-base font-semibold tracking-[-0.045em] text-white">
            Omnix
          </span>
        </Link>

        <div className="mt-8 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200">
          {state === "error" ? (
            <AlertCircle className="h-6 w-6 text-rose-200" />
          ) : state === "success" ? (
            <CheckCircle2 className="h-6 w-6 text-emerald-200" />
          ) : (
            <Loader2 className="h-6 w-6 animate-spin" />
          )}
        </div>

        <h1 className="mt-5 text-2xl font-black tracking-normal">
          {state === "error"
            ? "OAuth sign-in needs attention"
            : state === "success"
            ? "Session restored"
            : "Completing secure sign-in"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {state === "error"
            ? "The OAuth provider returned control to Omnix, but the session could not be completed."
            : state === "success"
            ? "Your Omnix session is ready. Redirecting you back to the workspace."
            : "Omnix is restoring your Supabase session and preparing your workspace profile."}
        </p>

        {state === "error" ? (
          <Alert variant="error" title="Unable to complete OAuth" className="mt-5">
            {error}
          </Alert>
        ) : (
          <div className="mt-5 flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.035] p-3 text-xs leading-5 text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" />
            Omnix keeps OAuth sessions in Supabase and initializes your workspace profile server-side.
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          {state === "error" ? (
            <>
              <Button type="button" className="flex-1" onClick={() => router.replace("/login")}>
                Return to sign in
              </Button>
              <Button type="button" variant="secondary" className="flex-1" onClick={retryCallback}>
                Retry callback
              </Button>
            </>
          ) : (
            <Button type="button" className="w-full" isLoading={state === "loading"} onClick={() => router.replace(nextPath)}>
              {state === "success" ? "Continue to Omnix" : "Restoring session"}
            </Button>
          )}
        </div>
      </section>
    </main>
  );
}
