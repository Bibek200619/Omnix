"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Mail, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Alert } from "@/components/ui/Alert";
import { OAuthButtons } from "@/components/auth/OAuthButtons";
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
    <form onSubmit={handleSubmit} className="space-y-5">
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
          <div className="h-px w-full bg-white/10" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-[#07111f] px-3 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            or continue with email
          </span>
        </div>
      </div>
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
        className="h-12 rounded-lg border-white/10 bg-white/[0.045]"
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
        className="h-12 rounded-lg border-white/10 bg-white/[0.045]"
      />
      <LoadingButton
        type="submit"
        size="lg"
        className="w-full font-black"
        isLoading={loading}
        loadingText="Signing in"
        disabled={!isConfigured}
        rightIcon={<ArrowRight className="h-4 w-4" />}
      >
        Sign in to workspace
      </LoadingButton>
      <div className="flex items-start gap-3 rounded-lg border border-white/[0.07] bg-white/[0.035] p-3 text-xs leading-5 text-slate-500">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-200" aria-hidden="true" />
        Your session keeps workspace research, files, and team history tied to
        your account.
      </div>
      <p className="text-center text-sm text-slate-400">
        New to Omnix?{" "}
        <Link
          href={authLink("/register")}
          className="font-semibold text-cyan-200 transition hover:text-cyan-100"
        >
          Create an account
        </Link>
      </p>
    </form>
  );
}
