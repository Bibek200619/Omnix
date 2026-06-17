"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Check,
  Crown,
  Edit3,
  Loader2,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Tag,
  User,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { FloatingMenuLayer } from "@/components/ui/FloatingMenuLayer";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { Portal } from "@/components/ui/Portal";
import { PageTitle } from "@/components/ui/Typography";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/workspace-types";

type MemberLabels = Record<string, string>;
type MemberAction = "role" | "remove";

const labelPresets = ["engineer", "design team", "product", "ops", "all"];
const managedRoleOptions: Array<{ value: WorkspaceRole; label: string; description: string; icon: LucideIcon }> = [
  {
    value: "co_owner",
    label: "Operational Lead",
    description: "Can manage workspace access according to backend authority.",
    icon: ShieldCheck,
  },
  {
    value: "team_lead",
    label: "Team Lead",
    description: "Can coordinate scoped collaboration where permitted.",
    icon: UserCheck,
  },
  {
    value: "member",
    label: "Workspace Member",
    description: "Standard workspace collaboration access.",
    icon: User,
  },
];

function labelStorageKey(workspaceId?: string | null) {
  return `omnix.memberLabels.${workspaceId ?? "global"}`;
}

function memberKey(member: WorkspaceMember) {
  return member.user_id || member.email || member.handle || "member";
}

function memberName(member: WorkspaceMember) {
  return member.full_name || member.email || member.handle || "Workspace member";
}

function displayRole(role?: string | null) {
  if (role === "co_owner") return "Co-founder";
  return workspaceRoleLabel(role);
}

function roleIcon(role?: string | null) {
  if (role === "founder" || role === "owner") return Crown;
  if (role === "co_owner") return Shield;
  if (role === "admin") return UserCheck;
  return User;
}

function isManageCapableRole(role?: WorkspaceRole | string | null) {
  return role === "founder" || role === "owner" || role === "super_founder" || role === "co_owner" || role === "sub_leader" || role === "team_lead";
}

function isRoleManagementCapableRole(role?: WorkspaceRole | string | null) {
  return role === "founder" || role === "owner" || role === "super_founder";
}

function isStandardMemberRole(role?: WorkspaceRole | string | null) {
  return role === "member" || role === "sub_member";
}

function isProtectedFounder(member: WorkspaceMember) {
  return isWorkspaceFounderRole(member.role);
}

function roleOptionForWorkspace(role: WorkspaceRole, isSubspace?: boolean): WorkspaceRole {
  if (role === "co_owner" && isSubspace) return "sub_leader";
  if (role === "member" && isSubspace) return "sub_member";
  return role;
}

function availableRoleOptions(isSubspace?: boolean) {
  return managedRoleOptions.map((option) => ({
    ...option,
    value: roleOptionForWorkspace(option.value, isSubspace),
  }));
}

function MemberActionsMenu({
  busy,
  canRemove,
  canUpdateRole,
  member,
  open,
  onSelect,
  onToggle,
}: {
  busy: boolean;
  canRemove: boolean;
  canUpdateRole: boolean;
  member: WorkspaceMember;
  open: boolean;
  onSelect: (action: MemberAction) => void;
  onToggle: () => void;
}) {
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        onToggle();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onToggle();
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onToggle, open]);

  function select(action: MemberAction) {
    onSelect(action);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Open actions for ${memberName(member)}`}
        disabled={busy}
        onClick={onToggle}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--omnix-border)] bg-black/15 text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>

      {open ? (
        <FloatingMenuLayer anchorRef={triggerRef} contentRef={menuRef} placement="bottom-end" width={232} zIndex={145}>
          <div
            role="menu"
            aria-label={`Actions for ${memberName(member)}`}
            className="omnix-floating-card w-full overflow-hidden p-1 ring-1 ring-black/40"
          >
            {canUpdateRole ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => select("role")}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-200 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              >
                <ShieldCheck className="h-4 w-4 text-cyan-100" />
                <span>Update Role</span>
              </button>
            ) : null}
            {canRemove ? (
              <button
                type="button"
                role="menuitem"
                onClick={() => select("remove")}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-rose-100 transition hover:bg-rose-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/60"
              >
                <Ban className="h-4 w-4" />
                <span>Remove From Workspace</span>
              </button>
            ) : null}
          </div>
        </FloatingMenuLayer>
      ) : null}
    </div>
  );
}

export default function TeamPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TeamPageContent />
    </Suspense>
  );
}

function TeamPageContent() {
  const {
    activeWorkspace,
    activeMembers,
    activeInvites,
    membersError,
    membersLoading,
    refreshActiveWorkspaceData,
    refreshWorkspaces,
    inviteToActiveWorkspace,
    removeWorkspaceMember,
    updateWorkspaceMemberRole,
  } = useWorkspace();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [labels, setLabels] = useState<MemberLabels>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [openMemberMenu, setOpenMemberMenu] = useState<string | null>(null);
  const [roleMember, setRoleMember] = useState<WorkspaceMember | null>(null);
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole | null>(null);
  const [removeMember, setRemoveMember] = useState<WorkspaceMember | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);

  const members = useMemo(() => {
    return activeMembers.length ? activeMembers : activeWorkspace?.members_preview ?? [];
  }, [activeMembers, activeWorkspace]);
  const isSubspace = activeWorkspace?.workspace_type === "subworkspace" || Boolean(activeWorkspace?.parent_workspace_id);
  const roleOptions = useMemo(() => availableRoleOptions(Boolean(isSubspace)), [isSubspace]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(labelStorageKey(activeWorkspace?.id));
      const parsed = raw ? JSON.parse(raw) : {};
      setLabels(parsed && typeof parsed === "object" ? parsed : {});
    } catch {
      setLabels({});
    }
  }, [activeWorkspace?.id]);

  function saveLabels(nextLabels: MemberLabels) {
    setLabels(nextLabels);
    try {
      window.localStorage.setItem(labelStorageKey(activeWorkspace?.id), JSON.stringify(nextLabels));
    } catch {
      // Labels are optional local metadata until backend support exists.
    }
  }

  const filters = ["All", "Founder", "Co-founder", "Member"];
  const filteredMembers = members.filter((member) => {
    const role = displayRole(member.role);
    const customLabel = labels[memberKey(member)] ?? "";
    const needle = `${memberName(member)} ${member.email ?? ""} ${member.handle ?? ""} ${customLabel}`.toLowerCase();
    return (filter === "All" || role === filter) && needle.includes(search.toLowerCase());
  });
  const canInvite = isWorkspaceFounderRole(activeWorkspace?.current_user_role);
  const canManageMembers = isManageCapableRole(activeWorkspace?.current_user_role);
  const canManageRoles = isRoleManagementCapableRole(activeWorkspace?.current_user_role);
  const pendingInviteCount = activeInvites.filter((invite) => invite.status === "pending").length;

  async function handleInvite(target: string, role: WorkspaceRole) {
    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
    } catch (err) {
      logClientError("Failed to invite teammate", err);
      setInviteError("Unable to invite teammate.");
    } finally {
      setInviting(false);
    }
  }

  function startEdit(member: WorkspaceMember) {
    const key = memberKey(member);
    setEditingKey(key);
    setLabelDraft(labels[key] ?? "");
  }

  function commitLabel(member: WorkspaceMember, value = labelDraft) {
    const key = memberKey(member);
    const normalized = value.trim().slice(0, 32);
    const next = { ...labels };
    if (normalized) next[key] = normalized;
    else delete next[key];
    saveLabels(next);
    setEditingKey(null);
    setLabelDraft("");
  }

  function isEligibleManagementTarget(member: WorkspaceMember) {
    if (!activeWorkspace || !canManageMembers) return false;
    if (!member.user_id || member.user_id === user?.id) return false;
    return !isProtectedFounder(member);
  }

  function canUpdateMemberRole(member: WorkspaceMember) {
    return isEligibleManagementTarget(member) && canManageRoles;
  }

  function canRemoveWorkspaceMember(member: WorkspaceMember) {
    if (!isEligibleManagementTarget(member)) return false;
    if (activeWorkspace?.workspace_type === "super_workspace" && !activeWorkspace.parent_workspace_id) {
      return isWorkspaceFounderRole(activeWorkspace.current_user_role);
    }
    if (canManageRoles) return true;
    return isStandardMemberRole(member.role);
  }

  function openRoleEditor(member: WorkspaceMember) {
    setOpenMemberMenu(null);
    setMemberActionError(null);
    setRoleMember(member);
    setSelectedRole(member.role);
  }

  function openRemoveConfirmation(member: WorkspaceMember) {
    setOpenMemberMenu(null);
    setMemberActionError(null);
    setRemoveMember(member);
  }

  async function reconcileTeamState() {
    await Promise.all([
      refreshActiveWorkspaceData({ force: true, silent: true }),
      refreshWorkspaces({ force: true, silent: true }),
    ]);
  }

  async function handleUpdateRole() {
    if (!roleMember || !selectedRole) return;
    const actionKey = `role:${roleMember.user_id}`;

    try {
      setBusyAction(actionKey);
      setMemberActionError(null);
      await updateWorkspaceMemberRole(roleMember.user_id, selectedRole);
      await reconcileTeamState();
      setRoleMember(null);
      setSelectedRole(null);
    } catch (err) {
      logClientError("Failed to update member role", err);
      setMemberActionError("Unable to update member role.");
      await reconcileTeamState();
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemoveMember() {
    if (!removeMember) return;
    const actionKey = `remove:${removeMember.user_id}`;

    try {
      setBusyAction(actionKey);
      setMemberActionError(null);
      await removeWorkspaceMember(removeMember.user_id);
      await reconcileTeamState();
      setRemoveMember(null);
    } catch (err) {
      logClientError("Failed to remove member", err);
      setMemberActionError("Unable to remove member.");
      await reconcileTeamState();
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-5">
        <div className="relative overflow-hidden rounded-[18px] border border-[rgba(0,255,255,0.12)] bg-[linear-gradient(145deg,rgba(0,255,255,0.06),rgba(155,92,255,0.035)_45%,rgba(0,0,0,0.18))] p-4 shadow-[0_28px_100px_rgba(0,0,0,0.34)] sm:rounded-[26px] sm:p-6">
          <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-cyan-300/10 blur-[85px]" />
          <div className="relative z-10 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100">
                <Users className="h-3.5 w-3.5" />
                Team management
              </p>
              <PageTitle className="omnix-gradient-text">{activeWorkspace?.name ?? "Workspace"} team</PageTitle>
              <p className="omnix-page-subtitle">
                Primary workspace roles stay authoritative. Secondary labels help organize members by function.
              </p>
            </div>
            <Button
              type="button"
              className="w-full md:w-auto"
              leftIcon={<Plus className="h-4 w-4" />}
              disabled={!canInvite}
              onClick={() => {
                setInviteError(null);
                setInviteOpen(true);
              }}
            >
              Invite member
            </Button>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Members", value: activeWorkspace?.member_count ?? members.length, color: "#00FFFF" },
            { label: "Your role", value: displayRole(activeWorkspace?.current_user_role), color: "#00e87a" },
            { label: "Pending invites", value: pendingInviteCount || "Clear", color: "#9b5cff" },
          ].map((item) => (
            <div key={item.label} className="rounded-xl border border-[rgba(0,255,255,0.08)] bg-[rgba(0,255,255,0.03)] px-4 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{item.label}</div>
              <div className="omnix-display mt-2 text-xl font-bold text-white" style={{ color: item.color }}>{item.value}</div>
            </div>
          ))}
        </div>

        {membersError ? (
          <OmnixErrorState
            title="Team members are unavailable"
            message={membersError}
            onRetry={() => void refreshActiveWorkspaceData({ force: true })}
            isRetrying={membersLoading}
          />
        ) : null}

        {memberActionError ? (
          <OmnixErrorState
            compact
            title="Team action needs attention"
            message={memberActionError}
            onDismiss={() => setMemberActionError(null)}
          />
        ) : null}

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-[220px]">
            <Search className="absolute left-[11px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search members or labels..."
              className="omnix-input h-11 w-full rounded-[var(--omnix-radius-sm)] py-2 pl-8 pr-3 text-sm sm:h-10"
            />
          </div>
          <div className="omnix-scrollbar -mx-1 flex w-[calc(100%+0.5rem)] gap-1 overflow-x-auto px-1 pb-1 sm:mx-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={cn(
                  "min-h-10 shrink-0 rounded-full border px-3.5 py-2 text-[11px] font-semibold transition active:scale-[0.98]",
                  filter === item
                    ? "border-cyan-300/35 bg-cyan-300/10 text-cyan-100 shadow-[var(--omnix-glow-xs)]"
                    : "border-[var(--omnix-border)] bg-black/10 text-[var(--omnix-text-3)] hover:text-white",
                )}
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-[var(--omnix-radius)] border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)]">
          {membersError && members.length === 0 ? null : filteredMembers.length ? filteredMembers.map((member) => {
            const key = memberKey(member);
            const RoleIcon = roleIcon(member.role);
            const name = memberName(member);
            const customLabel = labels[key];
            const isEditing = editingKey === key;
            const canUpdateRole = canUpdateMemberRole(member);
            const canRemove = canRemoveWorkspaceMember(member);
            const canShowActions = canUpdateRole || canRemove;
            const memberBusy = busyAction === `role:${member.user_id}` || busyAction === `remove:${member.user_id}`;
            return (
              <article key={key} className="group grid gap-4 border-b border-[var(--omnix-border)] px-4 py-4 transition hover:bg-[var(--omnix-surface)] lg:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <ProfileAvatar
                    name={name}
                    email={member.email}
                    handle={member.handle}
                    avatarUrl={member.avatar_url}
                    className="h-11 w-11 border-cyan-300/25 bg-cyan-300/10 text-sm"
                  />
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h2 className="truncate text-sm font-semibold text-white">{name}</h2>
                      <Badge variant="role" className={cn("gap-1 px-2 py-0.5 !text-[11px]", workspaceRoleBadgeClass(member.role))}>
                        <RoleIcon className="h-3 w-3" />
                        {displayRole(member.role)}
                      </Badge>
                    </div>
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-[var(--omnix-text-3)]">
                      <Mail className="h-3 w-3 shrink-0" />
                      <span className="truncate">{member.email || member.handle || "No contact set"}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                  <div className="min-w-0 flex-1 sm:max-w-[16rem]">
                    {isEditing ? (
                      <div className="flex gap-1.5">
                        <input
                          value={labelDraft}
                          onChange={(event) => setLabelDraft(event.target.value)}
                          className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-3 text-xs"
                          placeholder="engineer, product, ops..."
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() => commitLabel(member)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
                          aria-label="Save label"
                          title="Save label"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingKey(null)}
                          className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--omnix-border)] bg-black/15 text-[var(--omnix-text-2)]"
                          aria-label="Cancel label edit"
                          title="Cancel label edit"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {customLabel ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300/15 bg-cyan-300/8 px-2.5 py-1 text-[11px] text-cyan-100">
                            <Tag className="h-3 w-3" />
                            {customLabel}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--omnix-text-3)]">No secondary label</span>
                        )}
                        {labelPresets.slice(0, 3).map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => commitLabel(member, preset)}
                            className="min-h-8 rounded-full border border-[var(--omnix-border)] bg-black/15 px-2.5 py-1 text-[10px] text-[var(--omnix-text-3)] transition hover:text-white active:scale-[0.98]"
                          >
                            {preset}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => startEdit(member)}
                    className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 text-xs font-semibold text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-border-active)] hover:text-white active:scale-[0.98] sm:h-9 sm:min-h-0"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Label
                  </button>
                  {canShowActions ? (
                    <MemberActionsMenu
                      busy={memberBusy}
                      canRemove={canRemove}
                      canUpdateRole={canUpdateRole}
                      member={member}
                      open={openMemberMenu === key}
                      onSelect={(action) => {
                        if (action === "role") openRoleEditor(member);
                        if (action === "remove") openRemoveConfirmation(member);
                      }}
                      onToggle={() => setOpenMemberMenu((current) => (current === key ? null : key))}
                    />
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <div className="p-6 text-center sm:p-10">
              <Users className="mx-auto h-9 w-9 text-cyan-200/35" />
              <p className="mt-3 font-semibold text-white">{members.length === 0 ? "No team members loaded yet" : "No members match this filter"}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--omnix-text-3)]">
                {members.length === 0
                  ? "Invite a teammate to make workspace roles, labels, and access actions visible here."
                  : "Try another search term, role filter, or secondary label."}
              </p>
              {members.length === 0 && canInvite ? (
                <Button
                  type="button"
                  size="sm"
                  className="mt-4 min-h-10"
                  leftIcon={<Plus className="h-3.5 w-3.5" />}
                  onClick={() => {
                    setInviteError(null);
                    setInviteOpen(true);
                  }}
                >
                  Invite first teammate
                </Button>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <WorkspaceInviteModal
        open={inviteOpen}
        workspaceName={activeWorkspace?.name ?? "Workspace"}
        loading={inviting}
        error={inviteError}
        allowRoleSelection={canInvite}
        onClose={() => setInviteOpen(false)}
        onSubmit={handleInvite}
      />

      {roleMember ? (
        <Portal>
          <div className="omnix-modal-backdrop fixed inset-0 z-[120] flex items-end justify-center px-3 py-3 sm:items-center sm:px-4">
            <div className="omnix-modal-card max-h-[calc(100dvh-1.5rem)] w-full max-w-lg overflow-y-auto p-5 sm:p-6">
              <div className="relative z-10 flex items-start gap-3">
                <ProfileAvatar
                  name={memberName(roleMember)}
                  email={roleMember.email}
                  handle={roleMember.handle}
                  avatarUrl={roleMember.avatar_url}
                  className="h-10 w-10 border-cyan-300/25 bg-cyan-300/10 text-sm"
                />
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-white">Update Role</h3>
                  <p className="mt-1 truncate text-sm text-[var(--omnix-text-2)]">{memberName(roleMember)}</p>
                </div>
              </div>

              <div className="relative z-10 mt-5 space-y-2">
                {roleOptions.map((option) => {
                  const Icon = option.icon;
                  const active = selectedRole === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setSelectedRole(option.value)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl border px-3 py-3 text-left transition",
                        active
                          ? "border-cyan-300/35 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                          : "border-[var(--omnix-border)] bg-white/[0.03] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-white/[0.05]",
                      )}
                    >
                      <span className={cn("mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", active ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-white/10 bg-black/15 text-[var(--omnix-text-3)]")}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{option.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--omnix-text-3)]">{option.description}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="relative z-10 mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={Boolean(busyAction)}
                  onClick={() => {
                    setRoleMember(null);
                    setSelectedRole(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="omnix-primary-action"
                  disabled={!selectedRole || selectedRole === roleMember.role}
                  isLoading={busyAction === `role:${roleMember.user_id}`}
                  onClick={handleUpdateRole}
                >
                  Update Role
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}

      {removeMember ? (
        <Portal>
          <div className="omnix-modal-backdrop fixed inset-0 z-[120] flex items-end justify-center px-3 py-3 sm:items-center sm:px-4">
            <div className="omnix-modal-card max-h-[calc(100dvh-1.5rem)] w-full max-w-md overflow-y-auto p-5 sm:p-6">
              <div className="relative z-10">
                <h3 className="text-base font-semibold text-white">Remove Member</h3>
                <p className="mt-3 text-sm leading-6 text-[var(--omnix-text-2)]">
                  Remove this member from the workspace?
                </p>
                <p className="mt-4 text-sm leading-6 text-[var(--omnix-text-2)]">
                  They will immediately lose access to:
                </p>
                <ul className="mt-3 space-y-2 text-sm text-[var(--omnix-text-2)]">
                  {["Conversations", "Tasks", "Initiatives", "Workspace collaboration"].map((item) => (
                    <li key={item} className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300/80" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="relative z-10 mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={Boolean(busyAction)}
                  onClick={() => setRemoveMember(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  isLoading={busyAction === `remove:${removeMember.user_id}`}
                  onClick={handleRemoveMember}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </Portal>
      ) : null}
    </section>
  );
}
