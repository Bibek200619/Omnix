"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, FileText, LogOut, Save, ShieldCheck, User } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const router = useRouter();
  const { signOut, user } = useAuth();
  const [saved, setSaved] = useState(false);
  const [emailUpdates, setEmailUpdates] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const displayName =
    (user?.user_metadata?.name as string | undefined) ??
    (user?.user_metadata?.full_name as string | undefined) ??
    "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  }

  async function handleSignOut() {
    setSigningOut(true);

    const { error } = await signOut();

    if (error) {
      console.error("Unable to sign out", error);
      setSigningOut(false);
      return;
    }

    router.replace("/login");
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[1fr_0.72fr]">
      <form
        onSubmit={handleSubmit}
        className="rounded-lg border border-white/10 bg-white/[0.04] p-5 sm:p-6"
      >
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Profile</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              These fields are ready to map to the Supabase profile table.
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Input
            id="name"
            label="Display name"
            defaultValue={displayName}
            placeholder="Your name"
          />
          <Input
            id="email"
            label="Email"
            type="email"
            defaultValue={user?.email ?? ""}
            placeholder="you@company.com"
          />
        </div>

        <div className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4">
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span className="flex min-w-0 items-center gap-3">
              <Bell className="h-5 w-5 shrink-0 text-amber-200" />
              <span>
                <span className="block text-sm font-medium text-white">
                  Email product updates
                </span>
                <span className="block text-sm text-slate-500">
                  Receive account and workspace notifications.
                </span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={emailUpdates}
              onChange={(event) => setEmailUpdates(event.target.checked)}
              className="h-5 w-5 rounded border-white/20 bg-white/[0.05] text-cyan-300 focus:ring-cyan-300"
            />
          </label>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="submit"
            leftIcon={<Save className="h-4 w-4" />}
            variant={saved ? "secondary" : "primary"}
          >
            {saved ? "Saved" : "Save changes"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            leftIcon={<LogOut className="h-4 w-4" />}
            isLoading={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out" : "Sign out"}
          </Button>
        </div>
      </form>

      <aside className="space-y-4">
        <div className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-200" />
            <h2 className="font-semibold text-white">Security</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Your active Supabase session is used for protected routes and API
            authorization.
          </p>
        </div>

        <Link
          href="/settings/terms"
          className="block rounded-lg border border-white/10 bg-white/[0.04] p-5 transition hover:border-cyan-300/30 hover:bg-white/[0.07]"
        >
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-cyan-200" />
            <h2 className="font-semibold text-white">Terms page</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            Review the placeholder terms and policy route inside the app shell.
          </p>
        </Link>
      </aside>
    </section>
  );
}
