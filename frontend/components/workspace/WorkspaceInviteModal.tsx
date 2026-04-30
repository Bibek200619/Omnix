"use client";

import { FormEvent, useEffect, useState } from "react";
import { Mail, ShieldCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { WorkspaceRole } from "@/lib/workspace-types";
import { workspaceRoleBadgeClass } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";

type WorkspaceInviteModalProps = {
  open: boolean;
  workspaceName: string;
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  allowRoleSelection?: boolean;
  onSubmit: (target: string, role: WorkspaceRole) => Promise<void>;
};

export function WorkspaceInviteModal({
  open,
  workspaceName,
  loading = false,
  error = null,
  allowRoleSelection = false,
  onClose,
  onSubmit,
}: WorkspaceInviteModalProps) {
  const [target, setTarget] = useState("");
  const [role, setRole] = useState<WorkspaceRole>("member");
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTarget("");
      setRole("member");
      setLocalError(null);
    }
  }, [open]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedTarget = target.trim().toLowerCase();
    if (!normalizedTarget) {
      setLocalError("Enter an email address or Omnix handle.");
      return;
    }

    setLocalError(null);
    await onSubmit(normalizedTarget, role);
    setTarget("");
  }

  if (!open) {
    return null;
  }

  return (
    <div className="omnix-modal-backdrop fixed inset-0 z-[150] flex items-center justify-center p-4 backdrop-blur-md">
      <div className="omnix-modal-card relative flex max-h-[90dvh] w-full max-w-md flex-col p-5">
        <div className="relative z-10 flex shrink-0 items-start justify-between gap-4">
          <div>
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
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
            className="h-9 w-9 shrink-0"
            aria-label="Close invite modal"
            title="Close invite modal"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="relative z-10 mt-5 flex-1 overflow-y-auto pr-1">
          <div className="space-y-4 pb-1">
            <Input
              id="invite-email"
              label="Email or handle"
              type="text"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="teammate@company.com or @alex"
              icon={<Mail className="h-4 w-4" />}
              disabled={loading}
              autoFocus
            />

            {allowRoleSelection ? (
              <div>
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300">
                  <ShieldCheck className="h-4 w-4 text-amber-200" />
                  Visibility scope
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(["member", "co_owner"] as WorkspaceRole[]).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setRole(option)}
                      disabled={loading}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-left text-sm transition",
                        role === option
                          ? workspaceRoleBadgeClass(option)
                          : "border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-slate-300 hover:bg-[var(--omnix-surface-hover)]",
                      )}
                    >
                      {option === "co_owner" ? "Co-owner" : "Member"}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {localError || error ? (
              <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                {localError || error}
              </div>
            ) : null}
          </div>
        </form>

        <div className="relative z-10 mt-5 flex shrink-0 items-center justify-end gap-2 pt-2 pb-safe">
          <Button type="button" variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" leftIcon={<UserPlus className="h-4 w-4" />} isLoading={loading} onClick={() => {
            // Manual trigger because form might not be parent of buttons if we re-arrange
            // but here it is still.
          }}>
            Assign Scope
          </Button>
        </div>
      </div>
    </div>
  );
}
