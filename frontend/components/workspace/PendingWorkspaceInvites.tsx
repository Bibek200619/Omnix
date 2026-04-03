"use client";

import { useMemo, useState } from "react";
import { Check, Clock3, Mail, X } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { useWorkspace } from "@/lib/workspace-context";
import { getWorkspaceInviteId } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

type PendingWorkspaceInvitesProps = {
  compact?: boolean;
  showEmpty?: boolean;
  maxVisible?: number;
  className?: string;
};

function inviterLabel(inviterName?: string | null, inviterEmail?: string | null) {
  return inviterName || inviterEmail || "a teammate";
}

export function PendingWorkspaceInvites({
  compact = false,
  showEmpty = false,
  maxVisible,
  className,
}: PendingWorkspaceInvitesProps) {
  const {
    pendingInvites,
    pendingInvitesLoading,
    acceptInvite,
    declineInvite,
  } = useWorkspace();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visibleInvites = useMemo(
    () => (maxVisible ? pendingInvites.slice(0, maxVisible) : pendingInvites),
    [maxVisible, pendingInvites],
  );
  const hiddenCount = Math.max(pendingInvites.length - visibleInvites.length, 0);

  async function handleAccept(inviteId: string) {
    try {
      setBusyKey(`accept:${inviteId}`);
      setActionError(null);
      setMessage(null);
      const workspace = await acceptInvite(inviteId);
      setMessage(`Joined ${workspace.name}.`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to accept invite.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleDecline(inviteId: string) {
    try {
      setBusyKey(`decline:${inviteId}`);
      setActionError(null);
      setMessage(null);
      await declineInvite(inviteId);
      setMessage("Invite declined.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to decline invite.");
    } finally {
      setBusyKey(null);
    }
  }

  if (!pendingInvitesLoading && pendingInvites.length === 0 && !showEmpty) {
    return null;
  }

  return (
    <section
      className={cn(
        "rounded-lg border border-white/10 bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]",
        compact ? "p-3" : "p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
            <Mail className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h2 className={cn("font-semibold text-white", compact ? "text-sm" : "text-base")}>
              Workspace Invites
            </h2>
            <p className={cn("text-slate-500", compact ? "text-[11px]" : "text-xs")}>
              {pendingInvitesLoading
                ? "Checking invites"
                : `${pendingInvites.length} pending`}
            </p>
          </div>
        </div>
        {pendingInvites.length > 0 ? (
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-0.5 text-[11px] font-medium text-cyan-100">
            {pendingInvites.length}
          </span>
        ) : null}
      </div>

      {message ? (
        <Alert className="mt-3" variant="success" title="Done">
          {message}
        </Alert>
      ) : null}

      {actionError ? (
        <Alert className="mt-3" variant="error" title="Invite action failed">
          {actionError}
        </Alert>
      ) : null}

      <div className={cn("mt-3", compact ? "space-y-2" : "space-y-3")}>
        {pendingInvitesLoading ? (
          [0, 1].map((item) => (
            <div
              key={item}
              className="shimmer rounded-lg border border-white/10 bg-white/[0.04] p-3"
            >
              <div className="h-3 w-3/4 rounded-full bg-white/10" />
              <div className="mt-2 h-2.5 w-1/2 rounded-full bg-white/10" />
            </div>
          ))
        ) : visibleInvites.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 px-3 py-4 text-sm text-slate-500">
            No pending invites.
          </div>
        ) : (
          visibleInvites.map((invite) => {
            const inviteId = getWorkspaceInviteId(invite);
            const acceptBusy = busyKey === `accept:${inviteId}`;
            const declineBusy = busyKey === `decline:${inviteId}`;

            return (
              <article
                key={inviteId}
                className={cn(
                  "rounded-lg border border-white/10 bg-[#09131b]/80 transition hover:border-cyan-300/25 hover:bg-white/[0.045]",
                  compact ? "p-3" : "p-4",
                )}
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.05] text-sm font-semibold text-cyan-100">
                    {(invite.workspace_name || "W").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate text-sm font-semibold text-white">
                      {invite.workspace_name || "Workspace invite"}
                    </h3>
                    <p className="mt-1 truncate text-xs text-slate-400">
                      Invited by {inviterLabel(invite.inviter_name, invite.inviter_email)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-slate-300">
                        Role: Member
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock3 className="h-3 w-3" />
                        <ClientTime value={invite.created_at} fallback="Recently" format="date" />
                      </span>
                    </div>
                  </div>
                </div>
                <div className={cn("mt-3 flex items-center gap-2", compact ? "justify-stretch" : "justify-end")}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={compact ? "flex-1" : undefined}
                    leftIcon={<X className="h-3.5 w-3.5" />}
                    onClick={() => handleDecline(inviteId)}
                    isLoading={declineBusy}
                    disabled={acceptBusy}
                  >
                    Decline
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    className={compact ? "flex-1" : undefined}
                    leftIcon={<Check className="h-3.5 w-3.5" />}
                    onClick={() => handleAccept(inviteId)}
                    isLoading={acceptBusy}
                    disabled={declineBusy}
                  >
                    Accept
                  </Button>
                </div>
              </article>
            );
          })
        )}
      </div>

      {hiddenCount > 0 ? (
        <p className="mt-2 text-center text-[11px] text-slate-500">
          +{hiddenCount} more in Settings
        </p>
      ) : null}
    </section>
  );
}
