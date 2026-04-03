"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Bell, Check, ChevronDown, Loader2, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/lib/workspace-context";
import { getWorkspaceInviteId, type WorkspaceInvite } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

function inviteWorkspaceName(invite: WorkspaceInvite) {
  return invite.workspace_name || "Workspace invite";
}

function inviteSender(invite: WorkspaceInvite) {
  return invite.inviter_name || invite.inviter_email || "A teammate";
}

function avatarLabel(invite: WorkspaceInvite) {
  return inviteSender(invite).trim().charAt(0).toUpperCase() || "O";
}

type InviteActionState = {
  busyInviteId: string | null;
  error: string | null;
};

function InviteActionButtons({
  invite,
  compact = false,
  onSettled,
}: {
  invite: WorkspaceInvite;
  compact?: boolean;
  onSettled?: () => void;
}) {
  const { acceptInvite, declineInvite } = useWorkspace();
  const [state, setState] = useState<InviteActionState>({
    busyInviteId: null,
    error: null,
  });

  async function run(action: "accept" | "decline") {
    const inviteId = getWorkspaceInviteId(invite);
    try {
      setState({ busyInviteId: `${inviteId}:${action}`, error: null });
      if (action === "accept") {
        await acceptInvite(inviteId);
      } else {
        await declineInvite(inviteId);
      }
      onSettled?.();
    } catch (err) {
      setState({
        busyInviteId: null,
        error: err instanceof Error ? err.message : "Invite action failed.",
      });
      return;
    }

    setState({ busyInviteId: null, error: null });
  }

  const inviteId = getWorkspaceInviteId(invite);
  const acceptBusy = state.busyInviteId === `${inviteId}:accept`;
  const declineBusy = state.busyInviteId === `${inviteId}:decline`;
  const disabled = Boolean(state.busyInviteId);

  return (
    <div className={cn("flex flex-wrap items-center gap-2", compact && "justify-end")}>
      <Button
        type="button"
        size="sm"
        leftIcon={acceptBusy ? undefined : <Check className="h-3.5 w-3.5" />}
        isLoading={acceptBusy}
        disabled={disabled}
        onClick={() => run("accept")}
        className={compact ? "h-8 px-2.5 text-xs" : undefined}
      >
        Accept
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        leftIcon={declineBusy ? undefined : <X className="h-3.5 w-3.5" />}
        isLoading={declineBusy}
        disabled={disabled}
        onClick={() => run("decline")}
        className={compact ? "h-8 px-2.5 text-xs" : undefined}
      >
        Decline
      </Button>
      {state.error ? (
        <p className="basis-full text-xs leading-5 text-rose-100">{state.error}</p>
      ) : null}
    </div>
  );
}

export function InviteNotificationBar() {
  const { pendingInvites, pendingInvitesLoading } = useWorkspace();
  const [dismissedInviteIds, setDismissedInviteIds] = useState<Set<string>>(
    () => new Set(),
  );

  const visibleInvites = useMemo(
    () => pendingInvites.filter((invite) => !dismissedInviteIds.has(getWorkspaceInviteId(invite))),
    [dismissedInviteIds, pendingInvites],
  );
  const invite = visibleInvites[0];

  useEffect(() => {
    setDismissedInviteIds((current) => {
      const liveIds = new Set(pendingInvites.map((item) => getWorkspaceInviteId(item)));
      const next = new Set([...current].filter((id) => liveIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [pendingInvites]);

  return (
    <AnimatePresence initial={false}>
      {invite ? (
        <motion.div
          key={getWorkspaceInviteId(invite)}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="border-b border-cyan-300/20 bg-[#061018] shadow-[0_16px_40px_rgba(0,0,0,0.26)]"
        >
          <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <div className="flex min-w-0 items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
                {pendingInvitesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-6 text-white">
                  You were invited to <span className="text-cyan-100">{inviteWorkspaceName(invite)}</span>
                </p>
                <p className="text-xs leading-5 text-slate-400">
                  by {inviteSender(invite)}
                  {visibleInvites.length > 1 ? ` · ${visibleInvites.length - 1} more pending` : ""}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 sm:justify-end">
              <InviteActionButtons invite={invite} compact />
              <button
                type="button"
                aria-label="Dismiss invite notification"
                title="Dismiss"
                onClick={() => {
                  setDismissedInviteIds((current) => new Set(current).add(getWorkspaceInviteId(invite)));
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.06] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function InviteNotificationBell() {
  const { pendingInvites, pendingInvitesLoading, refreshPendingInvites } = useWorkspace();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={panelRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Workspace invite notifications"
        title="Invite notifications"
        onClick={() => {
          setOpen((current) => !current);
          void refreshPendingInvites();
        }}
        className="relative"
      >
        {pendingInvitesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
        {pendingInvites.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border border-[#071017] bg-cyan-300 px-1 text-[11px] font-bold text-slate-950">
            {pendingInvites.length > 9 ? "9+" : pendingInvites.length}
          </span>
        ) : null}
      </Button>

      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute right-0 top-full z-[100] mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-white/12 bg-[#05070b] shadow-[0_24px_70px_rgba(0,0,0,0.65)] ring-1 ring-black/40"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-4 py-3">
              <div>
                <p className="text-sm font-semibold text-white">Invitations</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {pendingInvites.length ? `${pendingInvites.length} pending` : "No pending invites"}
                </p>
              </div>
              <ChevronDown className={cn("h-4 w-4 text-slate-500 transition", open && "rotate-180")} />
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-2">
              {pendingInvites.length ? (
                <div className="space-y-2">
                  {pendingInvites.map((invite) => (
                    <div
                      key={getWorkspaceInviteId(invite)}
                      className="rounded-lg border border-white/8 bg-white/[0.035] p-3 transition hover:border-white/14 hover:bg-white/[0.055]"
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/10 text-sm font-semibold text-cyan-100">
                          {avatarLabel(invite)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white">
                            {inviteWorkspaceName(invite)}
                          </p>
                          <p className="mt-1 text-xs leading-5 text-slate-400">
                            Invited by {inviteSender(invite)} · Role: {invite.role}
                          </p>
                        </div>
                      </div>
                      <div className="mt-3">
                        <InviteActionButtons invite={invite} compact onSettled={() => setOpen(false)} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center px-5 py-8 text-center">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-slate-400">
                    <UserPlus className="h-4 w-4" />
                  </div>
                  <p className="mt-3 text-sm font-medium text-white">You are all caught up</p>
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Workspace invitations will appear here automatically.
                  </p>
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
