"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/Input";
import { LoadingButton } from "@/components/ui/LoadingButton";

export function RegisterForm() {
  const router = useRouter();
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    await new Promise((resolve) => setTimeout(resolve, 450));
    router.push("/verify");
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@company.com"
        autoComplete="email"
        required
      />
      <Input
        label="Password"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        placeholder="Create a strong password"
        autoComplete="new-password"
        minLength={8}
        required
      />
      <LoadingButton type="submit" fullWidth loading={loading} loadingText="Creating account">
        Register
      </LoadingButton>
      <p className="text-center text-sm text-stone-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-teal-200 hover:text-teal-100">
          Login
        </Link>
      </p>
    </form>
  );
}
