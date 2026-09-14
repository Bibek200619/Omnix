"use client";

import { FormEvent, useEffect, useState } from "react";
import { Phone, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { logClientError } from "@/lib/errors";
import { useProfile } from "@/lib/profile-context";

export function PhoneNumberPrompt() {
  const { loading, profile, updateProfile } = useProfile();
  const [open, setOpen] = useState(false);
  const [phoneDraft, setPhoneDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || dismissed || !profile) return;
    setOpen(!profile.phone_number);
  }, [dismissed, loading, profile]);

  async function savePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phoneNumber = phoneDraft.trim().replace(/[\s().-]+/g, "");
    if (!/^\+?[1-9]\d{6,19}$/.test(phoneNumber)) {
      setError("Use 7-20 digits, with + allowed at the start.");
      return;
    }

    try {
      setSaving(true);
      setError(null);
      await updateProfile({ phone_number: phoneNumber });
      setOpen(false);
    } catch (err) {
      logClientError("Failed to save phone number prompt", err, { endpoint: "/profile" });
      setError("Unable to save phone number. Check the number and try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/65 px-4 py-6">
      <form
        onSubmit={savePhone}
        className="w-full max-w-md rounded-2xl border border-cyan-300/20 bg-[var(--omnix-rgba-8-16-30-0-95)] p-5 text-white shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Register phone number</h2>
              <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                Add a phone number to finish your account profile.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-lg p-1.5 text-[var(--omnix-text-3)] transition hover:bg-white/10 hover:text-white"
            onClick={() => {
              setDismissed(true);
              setOpen(false);
            }}
            aria-label="Dismiss phone number prompt"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <Input
            label="Phone number"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phoneDraft}
            onChange={(event) => {
              setPhoneDraft(event.target.value);
              setError(null);
            }}
            placeholder="+1 555 123 4567"
            disabled={saving}
            autoFocus
            error={error ?? undefined}
          />
          {error ? (
            <Alert variant="error" title="Phone number required">
              {error}
            </Alert>
          ) : null}
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setDismissed(true);
              setOpen(false);
            }}
          >
            Later
          </Button>
          <Button type="submit" className="omnix-primary-action" disabled={!phoneDraft.trim()} isLoading={saving}>
            {saving ? "Saving" : "Save phone number"}
          </Button>
        </div>
      </form>
    </div>
  );
}
