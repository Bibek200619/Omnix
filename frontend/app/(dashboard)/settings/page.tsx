"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BadgeCheck,
  Bell,
  FileText,
  KeyRound,
  LogOut,
  Mail,
  Monitor,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  User,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Toggle } from "@/components/ui/Toggle";
import { WorkspaceAccessPanel } from "@/components/workspace/WorkspaceAccessPanel";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/lib/supabase";

export default function SettingsPage() {
  const router = useRouter();
  const { authError, isConfigured, refreshSession, signOut, user } = useAuth();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [compactMode, setCompactMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const userInitial =
    (displayName || email || "O").trim().charAt(0).toUpperCase() || "O";

  useEffect(() => {
    setDisplayName(
      (user?.user_metadata?.full_name as string | undefined) ??
        (user?.user_metadata?.name as string | undefined) ??
        "",
    );
    setEmail(user?.email ?? "");
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setEmailUpdates(window.localStorage.getItem("omnix.emailUpdates") !== "false");
    setCompactMode(window.localStorage.getItem("omnix.compactMode") === "true");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) {
      setError(authError ?? "Authentication is not configured.");
      return;
    }

    setSaving(true);
    setSaved(null);
    setError(null);

    try {
      const payload: {
        email?: string;
        data: {
          full_name: string;
        };
      } = {
        data: {
          full_name: displayName.trim(),
        },
      };

      if (email.trim() && email.trim() !== user?.email) {
        payload.email = email.trim();
      }

      const { error: updateError } = await supabase.auth.updateUser(payload);

      if (updateError) {
        setError(updateError.message || "Unable to save profile changes.");
        return;
      }

      window.localStorage.setItem("omnix.emailUpdates", String(emailUpdates));
      window.localStorage.setItem("omnix.compactMode", String(compactMode));
      await refreshSession();
      setSaved(
        payload.email
          ? "Profile saved. Supabase may ask you to confirm the new email address."
          : "Profile and preferences saved.",
      );
      window.setTimeout(() => setSaved(null), 2600);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save settings.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);

    const { error } = await signOut();

    if (error) {
      console.error("Unable to sign out", error);
      setError(error.message || "Unable to sign out.");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
        <form
          onSubmit={handleSubmit}
          className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:p-6"
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-lg font-semibold text-cyan-100 shadow-glow">
                {userInitial}
              </div>
              <div>
                <h2 className="text-xl font-semibold text-white">Profile</h2>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  Manage the identity attached to your authenticated Omnix workspace.
                </p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1.5 text-xs font-medium text-emerald-100">
              <BadgeCheck className="h-3.5 w-3.5" />
              Authenticated
            </div>
          </div>

          {!isConfigured ? (
            <Alert className="mt-6" variant="warning" title="Authentication is not configured">
              {authError}
            </Alert>
          ) : null}
          {error ? (
            <Alert className="mt-6" variant="error" title="Unable to save settings">
              {error}
            </Alert>
          ) : null}
          {saved ? (
            <Alert className="mt-6" variant="success" title="Saved">
              {saved}
            </Alert>
          ) : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <Input
              id="name"
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Your name"
              disabled={saving || !isConfigured}
              icon={<User className="h-4 w-4" />}
            />
            <Input
              id="email"
              label="Email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@company.com"
              disabled={saving || !isConfigured}
              icon={<Mail className="h-4 w-4" />}
            />
          </div>

          <div className="mt-7">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
              <SlidersHorizontal className="h-4 w-4 text-amber-200" />
              Preferences
            </div>
            <div className="grid gap-3">
              <Toggle
                label="Workspace emails"
                description="Receive account activity and conversation export notifications."
                checked={emailUpdates}
                onChange={(event) => setEmailUpdates(event.target.checked)}
                disabled={saving}
              />
              <Toggle
                label="Compact conversation list"
                description="Keep history rows dense on smaller screens."
                checked={compactMode}
                onChange={(event) => setCompactMode(event.target.checked)}
                disabled={saving}
              />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              type="submit"
              leftIcon={<Save className="h-4 w-4" />}
              variant={saved ? "secondary" : "primary"}
              isLoading={saving}
              disabled={!isConfigured}
            >
              {saving ? "Saving" : saved ? "Saved" : "Save changes"}
            </Button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-5 w-5 text-emerald-200" />
              <h2 className="font-semibold text-white">Account</h2>
            </div>
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <p className="text-slate-500">Signed in as</p>
                <p className="mt-1 break-all text-slate-200">{user?.email}</p>
              </div>
              <div>
                <p className="text-slate-500">User ID</p>
                <p className="mt-1 break-all text-slate-300">{user?.id}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <KeyRound className="h-4 w-4 text-cyan-200" />
                <p className="text-sm font-medium text-white">Session</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Supabase persists this browser session across refreshes.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
              <div className="flex items-center gap-3">
                <Monitor className="h-4 w-4 text-amber-200" />
                <p className="text-sm font-medium text-white">Interface</p>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Preferences are stored locally for this device.
              </p>
            </div>
          </div>

          <Link
            href="/settings/terms"
            className="block rounded-lg border border-white/10 bg-white/[0.04] p-5 transition hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.07]"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-cyan-200" />
              <h2 className="font-semibold text-white">Terms page</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Review the product terms, account responsibilities, and data policy.
            </p>
          </Link>

          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-amber-200" />
              <h2 className="font-semibold text-white">Session</h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Signing out clears the local Supabase session and returns this browser
              to the login screen.
            </p>
            <Button
              type="button"
              variant="danger"
              className="mt-4 w-full"
              leftIcon={<LogOut className="h-4 w-4" />}
              isLoading={signingOut}
              onClick={handleSignOut}
            >
              {signingOut ? "Signing out" : "Sign out"}
            </Button>
          </div>
        </aside>
      </section>

      <WorkspaceAccessPanel />
    </div>
  );
}
