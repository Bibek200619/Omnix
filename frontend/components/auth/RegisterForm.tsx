"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail, UserPlus } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";

export function RegisterForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    window.setTimeout(() => {
      setLoading(false);
      router.push("/verify");
    }, 500);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        placeholder="you@company.com"
        required
        icon={<Mail className="h-4 w-4" />}
      />
      <Input
        id="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        placeholder="Create a secure password"
        required
        minLength={8}
        icon={<Lock className="h-4 w-4" />}
        hint="Use at least 8 characters."
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
