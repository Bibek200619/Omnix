"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);

    window.setTimeout(() => {
      setLoading(false);
      router.push("/chat");
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
        autoComplete="current-password"
        placeholder="Enter your password"
        required
        minLength={8}
        icon={<Lock className="h-4 w-4" />}
      />
      <LoadingButton type="submit" className="w-full" isLoading={loading}>
        Login
      </LoadingButton>
      <p className="text-center text-sm text-slate-400">
        New to Omnix?{" "}
        <Link href="/register" className="font-medium text-cyan-200 hover:text-cyan-100">
          Register
        </Link>
      </p>
    </form>
  );
}
