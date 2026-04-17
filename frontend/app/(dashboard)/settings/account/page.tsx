"use client";

import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";

export default function AccountSettingsPage() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    const { error: signOutError } = await signOut();
    if (signOutError) {
      setError(signOutError.message || "Unable to sign out.");
      setSigningOut(false);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  return (
    <SettingsShell
      title="Account"
      description="Review the authenticated browser session and account identity details."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <h3 className="font-semibold text-white">Active session</h3>
              <p className="mt-1 text-sm text-[var(--omnix-text-2)]">Supabase session is active in this browser.</p>
            </div>
          </div>
          <div className="relative z-10 mt-5 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--omnix-border)] bg-black/15 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Signed in as</p>
              <p className="mt-2 break-all text-sm text-slate-200">{user?.email}</p>
            </div>
            <div className="rounded-lg border border-[var(--omnix-border)] bg-black/15 p-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Auth user ID</p>
              <p className="mt-2 break-all font-mono text-xs text-slate-300">{user?.id}</p>
            </div>
          </div>
          {error ? (
            <Alert className="mt-5" variant="error" title="Unable to sign out">
              {error}
            </Alert>
          ) : null}
        </section>

        <aside className="omnix-cinematic-card p-5">
          <div className="relative z-10">
          <KeyRound className="h-5 w-5 text-cyan-200" />
          <h3 className="mt-3 font-semibold text-white">Session control</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
            Signing out clears the local session and returns this browser to login.
          </p>
          <Button
            type="button"
            variant="danger"
            className="mt-5 w-full"
            leftIcon={<LogOut className="h-4 w-4" />}
            isLoading={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out" : "Sign out"}
          </Button>
          </div>
        </aside>
      </div>
    </SettingsShell>
  );
}
