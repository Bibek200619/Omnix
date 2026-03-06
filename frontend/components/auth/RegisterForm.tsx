"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

export function RegisterForm() {
  const router = useRouter();
  const { refreshSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        setError(signUpError.message || "Registration failed. Please try again.");
        setLoading(false);
        return;
      }

      if (data.session) {
        await refreshSession();
        router.replace("/chat");
        return;
      }

      router.replace("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
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
        disabled={loading}
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
        disabled={loading}
      />
      <LoadingButton
        type="submit"
        className="w-full"
        isLoading={loading}
        leftIcon={<UserPlus className="h-4 w-4" />}
      >
        Register
      </LoadingButton>
      <p className="text-center text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-cyan-200 hover:text-cyan-100">
          Login
        </Link>
      </p>
    </form>
  );
}
