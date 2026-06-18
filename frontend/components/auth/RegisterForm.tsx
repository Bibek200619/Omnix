"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  AUTH_ICONS,
  AuthIcon,
  AuthInput,
} from "@/components/auth/OmnixAuthVisuals";
import { apiClient } from "@/lib/api";
import { authLink, redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { supabase } from "@/lib/supabase";

export function RegisterForm() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ handle?: string; email?: string; password?: string }>({});

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const handle = String(formData.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const nextFieldErrors: { handle?: string; email?: string; password?: string } = {};

    if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) {
      nextFieldErrors.handle = "Use 3-30 lowercase letters, numbers, hyphens, or underscores.";
    }
    if (!email) {
      nextFieldErrors.email = "Enter your email address.";
    }
    if (!password) {
      nextFieldErrors.password = "Create a password.";
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
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name || undefined,
            username: handle,
          },
        },
      });

      if (signUpError) {
        logClientError("Registration failed", signUpError);
        setError("Unable to create account. Check the details and try again.");
        setFieldErrors({
          email: "Check this email address or sign in instead.",
        });
        setLoading(false);
        return;
      }

      if (data.session) {
        await refreshSession();
        await apiClient.patch("/profile", {
          display_name: name || undefined,
          username: handle,
        });
        await refreshSession();
        router.replace(redirectFromWindow());
        return;
      }

      setError(
        "Supabase did not return a session after registration. For development, disable email confirmation and OTP in Supabase Auth settings so password sign-up signs in immediately.",
      );
      setLoading(false);
    } catch (err) {
      logClientError("Unexpected registration failure", err);
      setError("Unable to create account. Check your connection and try again.");
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
        <Alert variant="error" title="Unable to create account">
          {error}
        </Alert>
      )}
      <OAuthButtons disabled={loading || !isConfigured} mode="register" onError={setError} />
      <div className="relative">
        <div className="absolute inset-0 flex items-center" aria-hidden="true">
          <div className="auth-divider-line h-px w-full" />
        </div>
        <div className="relative flex justify-center">
          <span className="auth-divider-label px-3 text-xs">
            or create with email
          </span>
        </div>
      </div>
      <AuthInput
        id="name"
        name="name"
        label="Name"
        type="text"
        autoComplete="name"
        placeholder="Alex Morgan"
        icon={<AuthIcon d={AUTH_ICONS.user} size={16} stroke="currentColor" sw={1.8} />}
        disabled={loading || !isConfigured}
      />
      <AuthInput
        id="handle"
        name="handle"
        label="Omnix handle"
        type="text"
        autoComplete="username"
        placeholder="alex-morgan"
        required
        minLength={3}
        maxLength={30}
        icon={<AuthIcon d={AUTH_ICONS.at} size={16} stroke="currentColor" sw={1.8} />}
        hint="Unique ID for workspace invites. Lowercase letters, numbers, hyphens, and underscores."
        disabled={loading || !isConfigured}
        error={fieldErrors.handle}
      />
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
        autoComplete="new-password"
        placeholder="Create a secure password"
        required
        minLength={8}
        icon={<AuthIcon d={AUTH_ICONS.lock} size={16} stroke="currentColor" sw={1.8} />}
        hint="Use at least 8 characters."
        disabled={loading || !isConfigured}
        error={fieldErrors.password}
      />
      <div
        className="auth-info-note auth-info-note-strong rounded-2xl p-3 text-xs leading-5"
      >
        Your Omnix handle is the identity teammates use for workspace invites
        and shared research.
      </div>
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[var(--omnix-cyan)] py-3.5 text-sm font-black text-[var(--omnix-color-061020)] shadow-[0_0_32px_var(--omnix-rgba-0-255-255-0-3)] hover:-translate-y-0.5 hover:bg-[var(--omnix-cyan)] hover:shadow-[0_0_50px_var(--omnix-rgba-0-255-255-0-55)]"
        isLoading={loading}
        loadingText="Creating account"
        disabled={!isConfigured}
        leftIcon={<AuthIcon d={AUTH_ICONS.user} size={16} stroke="var(--omnix-color-061020)" sw={2.1} />}
        rightIcon={<AuthIcon d={AUTH_ICONS.arrow} size={16} stroke="var(--omnix-color-061020)" sw={2.5} />}
      >
        Create account
      </LoadingButton>
      <p className="auth-text-faint text-center text-xs">
        Already have an account?{" "}
        <Link
          href={authLink("/login")}
          className="auth-text-cyan font-semibold transition hover:opacity-80"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
