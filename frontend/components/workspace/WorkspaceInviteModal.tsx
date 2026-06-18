"use client";

import { FormEvent, useEffect, useId, useState } from "react";
import { Mail, ShieldCheck, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
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
  const formId = useId();
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

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Invite teammate"
      className="max-w-md p-4 sm:p-5"
      footerClassName="mt-5 border-t-0 p-0 pt-2"
      footer={(
        <>
          <Button type="button" variant="ghost" className="flex-1 sm:flex-none" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button type="submit" form={formId} className="flex-1 sm:flex-none" leftIcon={<UserPlus className="h-4 w-4" />} isLoading={loading}>
            Assign Scope
          </Button>
        </>
      )}
    >
      <Modal.Header className="border-b-0 p-0">
        <div>
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
            <UserPlus className="h-4 w-4" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">Invite teammate</h2>
          <p className="mt-1 text-sm leading-6 text-slate-400">
            Add a collaborator to <span className="text-slate-200">{workspaceName}</span>.
          </p>
        </div>
        <button
          type="button"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white/10 hover:text-white"
          aria-label="Close invite modal"
          title="Close invite modal"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </Modal.Header>

      <Modal.Body className="mt-5 p-0 pr-1">
        <form id={formId} onSubmit={handleSubmit}>
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
      </Modal.Body>
    </Modal>
  );
}
