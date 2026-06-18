"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
import {
  AUTH_C,
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const handle = String(formData.get("handle") ?? "").trim().replace(/^@/, "").toLowerCase();
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle)) {
      setError("Choose a handle with 3-30 lowercase letters, numbers, hyphens, or underscores.");
      setLoading(false);
      return;
    }

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
      setError("Unable to create account.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:gap-5">
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
          <div className="h-px w-full" style={{ background: AUTH_C.border }} />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[var(--omnix-color-061020)] px-3 text-xs" style={{ color: AUTH_C.faint }}>
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
      />
      <div
        className="rounded-2xl p-3 text-xs leading-5"
        style={{ background: "var(--omnix-rgba-rgba-0-255-255-0-04)", border: "1px solid var(--omnix-rgba-rgba-0-255-255-0-14)", color: AUTH_C.faint }}
      >
        Your Omnix handle is the identity teammates use for workspace invites
        and shared research.
      </div>
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full rounded-xl border-0 bg-[var(--omnix-color-00ffff)] py-3.5 text-sm font-black text-[var(--omnix-color-061020)] shadow-[0_0_32px_var(--omnix-rgba-rgba-0-255-255-0-3)] hover:-translate-y-0.5 hover:bg-[var(--omnix-color-00ffff)] hover:shadow-[0_0_50px_var(--omnix-rgba-rgba-0-255-255-0-55)]"
        isLoading={loading}
        loadingText="Creating account"
        disabled={!isConfigured}
        leftIcon={<AuthIcon d={AUTH_ICONS.user} size={16} stroke={AUTH_C.navyDark} sw={2.1} />}
        rightIcon={<AuthIcon d={AUTH_ICONS.arrow} size={16} stroke={AUTH_C.navyDark} sw={2.5} />}
      >
        Create account
      </LoadingButton>
      <p className="text-center text-xs" style={{ color: AUTH_C.faint }}>
        Already have an account?{" "}
        <Link
          href={authLink("/login")}
          className="font-semibold transition hover:opacity-80"
          style={{ color: AUTH_C.cyan }}
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
