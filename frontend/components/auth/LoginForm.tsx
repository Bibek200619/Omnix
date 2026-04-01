"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Alert } from "@/components/ui/Alert";
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
      router.replace(safeRedirectPath());
      router.refresh();
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
        <Alert variant="error" title="Unable to sign in">
          {error}
        </Alert>
      )}
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
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        minLength={8}
        icon={<Lock className="h-4 w-4" />}
        disabled={loading || !isConfigured}
      />
      <LoadingButton
        type="submit"
        className="w-full"
        isLoading={loading}
        loadingText="Signing in"
        disabled={!isConfigured}
      >
        Sign in
      </LoadingButton>
      <p className="text-center text-sm text-slate-400">
        New to Omnix?{" "}
        <Link href={authLink("/register")} className="font-medium text-cyan-200 hover:text-cyan-100">
          Register
        </Link>
      </p>
    </form>
  );
}
