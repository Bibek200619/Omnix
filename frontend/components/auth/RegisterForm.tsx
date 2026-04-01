"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, UserRound, UserPlus } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

function safeRedirectPath() {
  if (typeof window === "undefined") return "/chat";
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  if (!redirect || !redirect.startsWith("/") || redirect.startsWith("//")) {
    return "/chat";
  }
  return redirect;
}

function authLink(path: string) {
  if (typeof window === "undefined") return path;
  const redirect = new URLSearchParams(window.location.search).get("redirect");
  return redirect ? `${path}?redirect=${encodeURIComponent(redirect)}` : path;
}

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
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: name || undefined,
          },
        },
      });

      if (signUpError) {
        setError(signUpError.message || "Registration failed. Please try again.");
        setLoading(false);
        return;
      }

      if (data.session) {
        await refreshSession();
        router.replace(safeRedirectPath());
        router.refresh();
        return;
      }

      setError(
        "Supabase did not return a session after registration. For development, disable email confirmation and OTP in Supabase Auth settings so password sign-up signs in immediately.",
      );
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
      <Input
        id="name"
        name="name"
        label="Name"
        type="text"
        autoComplete="name"
        placeholder="Alex Morgan"
        icon={<UserRound className="h-4 w-4" />}
        disabled={loading || !isConfigured}
      />
      <Input
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        icon={<Mail className="h-4 w-4" />}
        disabled={loading || !isConfigured}
      />
      <Input
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="Create a secure password"
        required
        minLength={8}
        icon={<Lock className="h-4 w-4" />}
        hint="Use at least 8 characters."
        disabled={loading || !isConfigured}
      />
      <LoadingButton
        type="submit"
        className="w-full"
        isLoading={loading}
        loadingText="Creating account"
        disabled={!isConfigured}
        leftIcon={<UserPlus className="h-4 w-4" />}
      >
        Create account
      </LoadingButton>
      <p className="text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link href={authLink("/login")} className="font-medium text-cyan-200 hover:text-cyan-100">
          Login
        </Link>
      </p>
    </form>
  );
}
