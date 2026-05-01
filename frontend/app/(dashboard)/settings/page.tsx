"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Bell, FileText, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export default function SettingsPage() {
  const router = useRouter();
  const [name, setName] = React.useState("Omnix User");
  const [email, setEmail] = React.useState("you@company.com");
  const [emailDigest, setEmailDigest] = React.useState(true);
  const [saved, setSaved] = React.useState(false);

  const handleSave = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1800);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-200/80">Profile</p>
            <h2 className="mt-2 text-2xl font-semibold text-white">Account settings</h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">
              Keep this surface simple now, then connect it to Supabase profile metadata later.
            </p>
          </div>
          <div className="flex h-14 w-14 items-center justify-center rounded-md bg-amber-200 text-stone-950">
            <UserRound className="h-7 w-7" aria-hidden="true" />
          </div>
        </div>

        <form onSubmit={handleSave} className="mt-7 grid gap-5 md:grid-cols-2">
          <Input label="Display name" value={name} onChange={(event) => setName(event.target.value)} required />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-[#0d0d0b]/60 p-4 md:col-span-2">
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-300/14 text-teal-100">
                <Bell className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-sm font-medium text-white">Email digest</span>
                <span className="block text-sm text-stone-400">Receive a summary of chat activity.</span>
              </span>
            </span>
            <input
              type="checkbox"
              checked={emailDigest}
              onChange={(event) => setEmailDigest(event.target.checked)}
              className="h-5 w-5 accent-teal-300"
            />
          </label>
          <div className="flex flex-col gap-3 sm:flex-row md:col-span-2">
            <Button type="submit">
              <Save className="h-4 w-4" aria-hidden="true" />
              {saved ? "Saved" : "Save changes"}
            </Button>
            <Button type="button" variant="secondary" onClick={() => router.push("/settings/terms")}>
              <FileText className="h-4 w-4" aria-hidden="true" />
              Terms page
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-lg border border-white/10 bg-white/[0.045] p-5 sm:p-6">
        <h3 className="text-lg font-semibold text-white">Integration notes</h3>
        <p className="mt-2 text-sm leading-6 text-stone-400">
          The settings page uses controlled fields and local save feedback. Replace the save handler with Supabase
          profile updates when auth is connected.
        </p>
      </section>
    </div>
  );
}
