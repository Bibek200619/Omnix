"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mail, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

type WorkspaceInviteModalProps = {
  open: boolean;
  workspaceName: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (email: string) => Promise<void>;
};

export function WorkspaceInviteModal({
  open,
  workspaceName,
  loading = false,
  error = null,
  onClose,
  onSubmit,
}: WorkspaceInviteModalProps) {
  const [email, setEmail] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setLocalError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setLocalError("Enter an email address.");
      return;
    }

    setLocalError(null);
    await onSubmit(normalizedEmail);
    setEmail("");
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#071017] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
              <UserPlus className="h-4 w-4" />
            </div>
            <h2 className="mt-4 text-lg font-semibold text-white">Invite teammate</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              Add a collaborator to <span className="text-slate-200">{workspaceName}</span>.
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9"
            aria-label="Close invite modal"
            title="Close invite modal"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <Input
            id="invite-email"
            label="Email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@company.com"
            icon={<Mail className="h-4 w-4" />}
            disabled={loading}
            autoFocus
          />

          {localError || error ? (
            <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
              {localError || error}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={<UserPlus className="h-4 w-4" />} isLoading={loading}>
              Invite
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
