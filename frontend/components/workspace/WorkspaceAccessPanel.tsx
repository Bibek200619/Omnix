"use client";

import { useMemo, useState } from "react";
import { Clock3, ShieldCheck, UserPlus, Users } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { useWorkspace } from "@/lib/workspace-context";
import type { WorkspaceMember } from "@/lib/workspace-types";
import { PendingWorkspaceInvites } from "./PendingWorkspaceInvites";
import { WorkspaceInviteModal } from "./WorkspaceInviteModal";
import { WorkspaceMemberStack, workspaceMemberName } from "./WorkspaceMemberStack";

function memberEmailLabel(member: WorkspaceMember) {
  return member.email || member.user_id;
}

export function WorkspaceAccessPanel() {
  const {
    activeWorkspace,
    activeMembers,
    activeInvites,
    membersLoading,
    invitesLoading,
    inviteToActiveWorkspace,
    removeWorkspaceMember,
    revokeInvite,
  } = useWorkspace();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const workspaceMembers = useMemo(
    () => activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [],
    [activeMembers, activeWorkspace],
  );
  const outgoingPendingInvites = useMemo(
    () => activeInvites.filter((invite) => invite.status === "pending"),
    [activeInvites],
  );

  async function handleInvite(email: string) {
    try {
      setInviteLoading(true);
      setInviteError(null);
      await inviteToActiveWorkspace(email);
      setInviteOpen(false);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to invite teammate.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveMember(userId: string) {
    try {
      setBusyKey(`member:${userId}`);
      setActionError(null);
      await removeWorkspaceMember(userId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to remove member.");
    } finally {
      setBusyKey(null);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    try {
      setBusyKey(`invite:${inviteId}`);
      setActionError(null);
      await revokeInvite(inviteId);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to revoke invite.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-4">
      <PendingWorkspaceInvites showEmpty />

      <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <Users className="h-5 w-5 text-cyan-200" />
              <div>
                <h2 className="font-semibold text-white">Workspace access</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Manage the collaborators and invite flow for the active workspace.
                </p>
              </div>
            </div>
            {activeWorkspace ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
                <div>
                  <div className="text-sm font-medium text-white">{activeWorkspace.name}</div>
                  <div className="mt-1 text-xs text-slate-400">
                    {activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"} • {activeWorkspace.current_user_role === "owner" ? "Owner" : "Member"}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
          {activeWorkspace?.current_user_role === "owner" ? (
            <Button
              type="button"
              variant="secondary"
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Invite teammate
            </Button>
          ) : null}
        </div>

        {actionError ? (
          <Alert className="mt-4" variant="error" title="Workspace action failed">
            {actionError}
          </Alert>
        ) : null}

        {!activeWorkspace ? (
          <div className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
            Select a workspace to manage collaborators.
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-[1.3fr_0.9fr]">
            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                <ShieldCheck className="h-4 w-4 text-emerald-200" />
                Members
              </div>
              <div className="space-y-3">
                {membersLoading ? (
                  <p className="text-sm text-slate-400">Loading members...</p>
                ) : (
                  workspaceMembers.map((member) => {
                    const removable = activeWorkspace.current_user_role === "owner" && member.role !== "owner";
                    return (
                      <div
                        key={member.user_id}
                        className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-[#0d1720] text-sm font-semibold text-slate-200">
                            {member.avatar_label}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-white">{workspaceMemberName(member)}</div>
                            <div className="mt-1 text-xs text-slate-400">{memberEmailLabel(member)}</div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-xs text-slate-300">
                            {member.role === "owner" ? "Owner" : "Member"}
                          </span>
                          {removable ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveMember(member.user_id)}
                              isLoading={busyKey === `member:${member.user_id}`}
                            >
                              Remove
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center gap-2 text-sm font-medium text-white">
                <Clock3 className="h-4 w-4 text-amber-200" />
                Pending invites
              </div>
              <div className="space-y-3">
                {activeWorkspace.current_user_role !== "owner" ? (
                  <p className="text-sm text-slate-400">Only workspace owners can manage outgoing invites.</p>
                ) : invitesLoading ? (
                  <p className="text-sm text-slate-400">Loading invites...</p>
                ) : outgoingPendingInvites.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                    No pending invites.
                  </div>
                ) : (
                  outgoingPendingInvites.map((invite) => (
                    <div key={invite.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-sm font-medium text-white">{invite.email}</div>
                      <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-400">
                        <span>{invite.status}</span>
                        <ClientTime value={invite.created_at} fallback="Recently" format="date" />
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-3"
                        onClick={() => handleRevokeInvite(invite.id)}
                        isLoading={busyKey === `invite:${invite.id}`}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {activeWorkspace ? (
        <WorkspaceInviteModal
          open={inviteOpen}
          workspaceName={activeWorkspace.name}
          loading={inviteLoading}
          error={inviteError}
          onClose={() => setInviteOpen(false)}
          onSubmit={handleInvite}
        />
      ) : null}
    </section>
  );
}
