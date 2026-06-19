"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Alert } from "@/components/ui/Alert";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  AUTH_ICONS,
  AuthIcon,
  AuthInput,
} from "@/components/auth/OmnixAuthVisuals";
import { authLink, redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";

export function LoginForm() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const nextFieldErrors: { email?: string; password?: string } = {};

    if (!email) {
      nextFieldErrors.email = "Enter your email address.";
    }
    if (!password) {
      nextFieldErrors.password = "Enter your password.";
    } else if (password.length < 8) {
      nextFieldErrors.password = "Use at least 8 characters.";
    }

    setError(null);
    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0) {
      setError("Check the highlighted fields and try again.");
      return;
    }

    setLoading(true);

    try {
      const { data, error: signInError } =
        await supabase.auth.signInWithPassword({ email, password });

      if (signInError) {
        logClientError("Sign in failed", signInError);
        setError("Unable to sign in. Check your email and password, then try again.");
        setFieldErrors({
          email: "Check this email address.",
          password: "Check this password.",
        });
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
    } catch (err) {
      logClientError("Unexpected sign in failure", err);
      setError("Unable to sign in. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4 sm:gap-5">
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
          <div className="auth-divider-line h-px w-full" />
        </div>
        <div className="relative flex justify-center">
          <span className="auth-divider-label px-3 text-xs">
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
        error={fieldErrors.email}
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
        error={fieldErrors.password}
      />
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[var(--omnix-cyan)] py-3.5 text-sm font-black text-[var(--omnix-color-061020)] shadow-[0_0_32px_var(--omnix-rgba-0-255-255-0-3)] hover:-translate-y-0.5 hover:bg-[var(--omnix-cyan)] hover:shadow-[0_0_50px_var(--omnix-rgba-0-255-255-0-55)]"
        isLoading={loading}
        loadingText="Signing in"
        disabled={!isConfigured}
        rightIcon={<AuthIcon d={AUTH_ICONS.arrow} size={16} stroke="var(--omnix-color-061020)" sw={2.5} />}
      >
        Sign in to workspace
      </LoadingButton>
      <div
        className="auth-info-note flex items-start gap-3 rounded-2xl p-3 text-xs leading-5"
      >
        <span className="auth-text-cyan mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full">
          <AuthIcon d={AUTH_ICONS.check} size={10} stroke="currentColor" sw={2.5} />
        </span>
        Your session keeps workspace research, files, and team history tied to
        your account.
      </div>
      <p className="auth-text-faint text-center text-xs">
        New to Omnix?{" "}
        <Link
          href={authLink("/register")}
          className="auth-text-cyan font-semibold transition hover:opacity-80"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
