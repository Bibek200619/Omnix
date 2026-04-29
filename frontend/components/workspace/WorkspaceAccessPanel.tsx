"use client";

import { useMemo, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Clock3,
  Crown,
  Loader2,
  MoreHorizontal,
  Shield,
  ShieldCheck,
  UserRound,
  UserPlus,
  Users,
  XCircle,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useWorkspace } from "@/lib/workspace-context";
import {
  getWorkspaceInviteId,
  type WorkspaceMember,
  type WorkspaceRole,
} from "@/lib/workspace-types";
import {
  isWorkspaceFounderRole,
  workspaceRoleAvatarClass,
  workspaceRoleBadgeClass,
  workspaceRoleLabel,
} from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";
import { WorkspaceInviteModal } from "./WorkspaceInviteModal";
import { WorkspaceAssignmentModal } from "./WorkspaceAssignmentModal";
import { WorkspaceMemberStack, workspaceMemberName } from "./WorkspaceMemberStack";

type ConfirmAction =
  | { type: "role"; member: WorkspaceMember; role: WorkspaceRole }
  | { type: "remove"; member: WorkspaceMember };

function memberEmailLabel(member: WorkspaceMember) {
  return member.email || member.user_id;
}

const inviteStatusOrder = {
  pending: 0,
  accepted: 1,
  declined: 2,
  revoked: 3,
};

function inviteStatusMeta(status: string) {
  switch (status) {
    case "accepted":
      return {
        label: "Accepted",
        icon: CheckCircle2,
        className: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
      };
    case "declined":
      return {
        label: "Declined",
        icon: XCircle,
        className: "border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)]",
      };
    case "revoked":
      return {
        label: "Revoked",
        icon: Ban,
        className: "border-rose-300/20 bg-rose-400/10 text-rose-100",
      };
    default:
      return {
        label: "Pending",
        icon: Clock3,
        className: "border-amber-300/25 bg-amber-300/10 text-amber-100",
      };
  }
}

function roleIcon(role: WorkspaceMember["role"]) {
  if (isWorkspaceFounderRole(role)) return Crown;
  if (role === "co_owner") return ShieldCheck;
  return UserRound;
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
    updateWorkspaceMemberRole,
    assignWorkspaceMember,
  } = useWorkspace();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [openMemberMenu, setOpenMemberMenu] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);

  const workspaceMembers = useMemo(
    () => (activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? []),
    [activeMembers, activeWorkspace],
  );
  const outgoingInvites = useMemo(
    () =>
      [...activeInvites].sort((a, b) => {
        const statusDelta = inviteStatusOrder[a.status] - inviteStatusOrder[b.status];
        if (statusDelta !== 0) return statusDelta;
        return (
          (Date.parse(b.updated_at || b.created_at || "") || 0) -
          (Date.parse(a.updated_at || a.created_at || "") || 0)
        );
      }),
    [activeInvites],
  );
  const activeRole = activeWorkspace?.current_user_role;
  const isSubspace = activeWorkspace?.workspace_type === "subworkspace" || activeWorkspace?.parent_workspace_id;
  const canManageRoles = isWorkspaceFounderRole(activeRole);
  const canAssign = canManageRoles || activeRole === "sub_leader" || activeRole === "co_owner";

  async function handleInvite(target: string, role: WorkspaceRole) {
    try {
      setInviteLoading(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to invite teammate.");
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleAssign(userId: string, role: WorkspaceRole) {
    return await assignWorkspaceMember({ user_id: userId, role });
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

  async function handleConfirmAction() {
    if (!confirmAction) return;

    const { member } = confirmAction;
    const actionKey =
      confirmAction.type === "role"
        ? `role:${member.user_id}:${confirmAction.role}`
        : `member:${member.user_id}`;

    try {
      setBusyKey(actionKey);
      setActionError(null);
      if (confirmAction.type === "role") {
        await updateWorkspaceMemberRole(member.user_id, confirmAction.role);
      } else {
        await removeWorkspaceMember(member.user_id);
      }
      setConfirmAction(null);
      setOpenMemberMenu(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to update team member.");
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="space-y-6">
      <div className="omnix-cinematic-card p-5 sm:p-6">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-[var(--omnix-cyan)] opacity-10 blur-[80px]" />
        <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="relative z-10 min-w-0">
            <div className="flex items-center gap-5">
              <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-[var(--omnix-grad-primary)] text-white shadow-[var(--omnix-glow-md)]">
                <Users className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="omnix-display text-2xl font-semibold text-white">
                  {isSubspace ? "Operational Scope" : "Team Members"}
                </h2>
                <p className="mt-1 text-sm text-[var(--omnix-text-2)]">
                  {isSubspace 
                    ? "Manage assigned organizational members for this workspace scope."
                    : "Manage workspace access, ownership level, and collaborator visibility."}
                </p>
              </div>
            </div>
            {activeWorkspace ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
                <span className="rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-1 text-xs font-medium text-[var(--omnix-text-2)]">
                  {activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}
                </span>
                <span className={cn("rounded-full border px-3 py-1 text-xs font-semibold", workspaceRoleBadgeClass(activeWorkspace.current_user_role))}>
                  Your role: {workspaceRoleLabel(activeWorkspace.current_user_role)}
                </span>
              </div>
            ) : null}
          </div>
          {canAssign ? (
            <Button
              type="button"
              variant="secondary"
              leftIcon={<UserPlus className="h-4 w-4" />}
              onClick={() => {
                if (isSubspace) {
                  setAssignOpen(true);
                } else {
                  setInviteError(null);
                  setInviteOpen(true);
                }
              }}
              className="rounded-full border-[var(--omnix-border)] bg-[var(--omnix-surface)] hover:bg-[var(--omnix-surface-hover)]"
            >
              {isSubspace ? "Assign member" : "Invite teammate"}
            </Button>
          ) : null}
        </div>

        {actionError ? (
          <Alert className="mt-4" variant="error" title="Team action failed">
            {actionError}
          </Alert>
        ) : null}

        {!activeWorkspace ? (
          <div className="mt-5 rounded-lg border border-dashed border-[var(--omnix-border)] px-4 py-5 text-sm text-[var(--omnix-text-2)]">
            Awaiting assignment to collaborative spaces.
          </div>
        ) : (
          <div className="relative z-10 mt-6 overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-[rgba(6,8,16,0.6)] backdrop-blur-xl">
            {membersLoading ? (
              <div className="grid gap-2.5 p-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="shimmer h-16 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)]" />
                ))}
              </div>
            ) : workspaceMembers.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] text-slate-600">
                  <UserRound className="h-8 w-8" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {isSubspace ? "No operational members assigned yet" : "No members found"}
                  </h3>
                  <p className="mt-1 max-w-[280px] text-xs leading-relaxed text-slate-500">
                    {isSubspace 
                      ? "Assign organizational collaborators into this workspace scope to begin."
                      : "Start building your team by inviting teammates to this workspace."}
                  </p>
                  {canAssign && (
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="mt-4 text-[var(--omnix-cyan)] hover:bg-[var(--omnix-cyan)]/10"
                      onClick={() => isSubspace ? setAssignOpen(true) : setInviteOpen(true)}
                    >
                      {isSubspace ? "Assign first member" : "Invite first teammate"}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              workspaceMembers.map((member) => {
                const RoleIcon = roleIcon(member.role);
                const isFounder = isWorkspaceFounderRole(member.role);
                const canActOnMember =
                  !isFounder &&
                  (canManageRoles || (activeRole === "co_owner" && member.role === "member"));

                return (
                  <div
                    key={member.user_id}
                    className="group relative flex flex-col gap-3 border-b border-[var(--omnix-border)] px-4 py-4 transition hover:bg-[var(--omnix-surface)] sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <ProfileAvatar
                        name={workspaceMemberName(member)}
                        email={member.email}
                        handle={member.handle}
                        avatarUrl={member.avatar_url}
                        className={cn("h-10 w-10 text-sm", workspaceRoleAvatarClass(member.role))}
                      />
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <div className="truncate text-sm font-semibold text-white">{workspaceMemberName(member)}</div>
                          <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", workspaceRoleBadgeClass(member.role))}>
                            <RoleIcon className="h-3 w-3" />
                            {workspaceRoleLabel(member.role)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {member.handle ? `@${member.handle} · ` : ""}
                          {memberEmailLabel(member)}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <div className="text-xs text-slate-500">
                        Joined <ClientTime value={member.created_at} fallback="recently" />
                      </div>
                      {canActOnMember ? (
                        <div className="relative">
                          <button
                            type="button"
                            aria-haspopup="menu"
                            aria-expanded={openMemberMenu === member.user_id}
                            aria-label={`Open actions for ${workspaceMemberName(member)}`}
                            onClick={() =>
                              setOpenMemberMenu((current) =>
                                current === member.user_id ? null : member.user_id,
                              )
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-slate-300 transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                          >
                            <MoreHorizontal className="h-4 w-4" />
                          </button>

                          {openMemberMenu === member.user_id ? (
                            <div
                              role="menu"
                              className="absolute right-0 top-full z-40 mt-2 w-44 overflow-hidden rounded-lg border border-[var(--omnix-border-2)] bg-[#07131f] p-1.5 shadow-[0_18px_54px_rgba(0,0,0,0.58),var(--omnix-glow-xs)] ring-1 ring-black/40"
                            >
                              {canManageRoles && member.role !== "co_owner" ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => setConfirmAction({ type: "role", member, role: "co_owner" })}
                                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-amber-100 transition hover:bg-amber-300/10"
                                >
                                  <Shield className="h-4 w-4" />
                                  Make co-owner
                                </button>
                              ) : null}
                              {canManageRoles && member.role !== "member" ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => setConfirmAction({ type: "role", member, role: "member" })}
                                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-sky-100 transition hover:bg-sky-300/10"
                                >
                                  <UserRound className="h-4 w-4" />
                                  Make member
                                </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => setConfirmAction({ type: "remove", member })}
                                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-rose-100 transition hover:bg-rose-400/10"
                              >
                                <Ban className="h-4 w-4" />
                                Remove
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      <div className="omnix-cinematic-card p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Clock3 className="h-4 w-4 text-amber-200" />
              Invitations
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Pending and recent invite activity stays here after the team roster.
            </p>
          </div>
          {canManageRoles ? (
            <Button type="button" variant="ghost" size="sm" leftIcon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>
              Invite
            </Button>
          ) : null}
        </div>

        <div className="relative z-10 mt-4 space-y-2.5">
          {!activeWorkspace ? (
              <div className="rounded-lg border border-dashed border-[var(--omnix-border)] px-4 py-5 text-sm text-[var(--omnix-text-3)]">
              Your workspace access will appear here.
            </div>
          ) : !isWorkspaceFounderRole(activeWorkspace.current_user_role) ? (
              <div className="rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 py-4 text-sm text-[var(--omnix-text-2)]">
              Visibility scope is restricted to operational leaders.
            </div>
          ) : invitesLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading access requests
            </div>
          ) : outgoingInvites.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--omnix-border)] px-4 py-5 text-sm text-[var(--omnix-text-3)]">
              No pending access requests.
            </div>
          ) : (
            outgoingInvites.map((invite) => {
              const inviteId = getWorkspaceInviteId(invite);
              const status = inviteStatusMeta(invite.status);
              const StatusIcon = status.icon;

              return (
                <div key={inviteId} className="flex flex-col gap-3 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3.5 py-3 transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)] sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-white">{invite.email}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      Sent <ClientTime value={invite.created_at} fallback="recently" format="date" /> · {workspaceRoleLabel(invite.role)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium ${status.className}`}>
                      <StatusIcon className="h-3 w-3" />
                      {status.label}
                    </span>
                    {invite.status === "pending" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2.5 text-xs text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
                        onClick={() => handleRevokeInvite(inviteId)}
                        isLoading={busyKey === `invite:${inviteId}`}
                      >
                        Revoke
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {activeWorkspace ? (
        <WorkspaceInviteModal
          open={inviteOpen}
          workspaceName={activeWorkspace.name}
          loading={inviteLoading}
          error={inviteError}
          allowRoleSelection={canManageRoles}
          onClose={() => setInviteOpen(false)}
          onSubmit={handleInvite}
        />
      ) : null}

      {activeWorkspace ? (
        <WorkspaceAssignmentModal
          open={assignOpen}
          workspaceId={activeWorkspace.id}
          workspaceName={activeWorkspace.name}
          currentUserRole={activeWorkspace.current_user_role}
          onClose={() => setAssignOpen(false)}
          onAssign={handleAssign}
        />
      ) : null}

      {confirmAction ? (
        <div className="omnix-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center px-4">
          <div className="omnix-modal-card w-full max-w-md p-5">
            <div className="relative z-10 flex items-start gap-3">
              <ProfileAvatar
                name={workspaceMemberName(confirmAction.member)}
                email={confirmAction.member.email}
                handle={confirmAction.member.handle}
                avatarUrl={confirmAction.member.avatar_url}
                className={cn("h-10 w-10", workspaceRoleAvatarClass(confirmAction.member.role))}
              />
              <div>
                <h3 className="text-base font-semibold text-white">
                  {confirmAction.type === "remove" ? "Remove team member?" : "Change workspace role?"}
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {confirmAction.type === "remove"
                    ? `${workspaceMemberName(confirmAction.member)} will lose access to this workspace.`
                    : `${workspaceMemberName(confirmAction.member)} will become ${workspaceRoleLabel(confirmAction.role).toLowerCase()}.`}
                </p>
              </div>
            </div>

            <div className="relative z-10 mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setConfirmAction(null)} disabled={Boolean(busyKey)}>
                Cancel
              </Button>
              <Button
                type="button"
                variant={confirmAction.type === "remove" ? "danger" : "primary"}
                isLoading={Boolean(busyKey)}
                onClick={handleConfirmAction}
              >
                {confirmAction.type === "remove" ? "Remove member" : "Update role"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
