"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Alert } from "@/components/ui/Alert";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  AUTH_C,
  AUTH_ICONS,
  AuthIcon,
  AuthInput,
} from "@/components/auth/OmnixAuthVisuals";
import { authLink, redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        setError(
          signInError.message ||
            "Sign in failed. Check your email and password, then try again.",
        );
        setLoading(false);
        return;
      }

      if (!data.session) {
        setError("Login succeeded but Supabase did not return a session.");
        setLoading(false);
        return;
      }

      await refreshSession();
      router.replace(redirectFromWindow());
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      {!isConfigured ? (
        <Alert variant="warning" title="Authentication is not configured">
          {authError}
        </Alert>
      ) : null}
      {error && (
        <Alert variant="error" title="Unable to sign in">
          {error}
        </Alert>
      )}
      <OAuthButtons disabled={loading || !isConfigured} mode="login" onError={setError} />
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="h-px w-full" style={{ background: AUTH_C.border }} />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#061020] px-3 text-xs" style={{ color: AUTH_C.faint }}>
            or continue with email
          </span>
        </div>
      </div>
      <AuthInput
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        icon={<AuthIcon d={AUTH_ICONS.mail} size={16} stroke="currentColor" sw={1.8} />}
        disabled={loading || !isConfigured}
      />
      <AuthInput
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        minLength={8}
        icon={<AuthIcon d={AUTH_ICONS.lock} size={16} stroke="currentColor" sw={1.8} />}
        disabled={loading || !isConfigured}
      />
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[#00FFFF] py-3.5 text-sm font-black text-[#061020] shadow-[0_0_32px_rgba(0,255,255,0.3)] hover:-translate-y-0.5 hover:bg-[#00FFFF] hover:shadow-[0_0_50px_rgba(0,255,255,0.55)]"
        isLoading={loading}
        loadingText="Signing in"
        disabled={!isConfigured}
        rightIcon={<AuthIcon d={AUTH_ICONS.arrow} size={16} stroke={AUTH_C.navyDark} sw={2.5} />}
      >
        Sign in to workspace
      </LoadingButton>
      <div
        className="flex items-start gap-3 rounded-2xl p-3 text-xs leading-5"
        style={{ background: "rgba(0,255,255,0.04)", border: "1px solid rgba(0,255,255,0.12)", color: AUTH_C.faint }}
      >
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full" style={{ color: AUTH_C.cyan }}>
          <AuthIcon d={AUTH_ICONS.check} size={10} stroke="currentColor" sw={2.5} />
        </span>
        Your session keeps workspace research, files, and team history tied to
        your account.
      </div>
      <p className="text-center text-xs" style={{ color: AUTH_C.faint }}>
        New to Omnix?{" "}
        <Link
          href={authLink("/register")}
          className="font-semibold transition hover:opacity-80"
          style={{ color: AUTH_C.cyan }}
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
