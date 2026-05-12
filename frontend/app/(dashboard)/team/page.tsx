"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Crown, Edit3, Mail, Plus, Search, Shield, Tag, User, UserCheck, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { WorkspaceMember, WorkspaceRole } from "@/lib/workspace-types";

type MemberLabels = Record<string, string>;

const labelPresets = ["engineer", "design team", "product", "ops", "all"];

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

export default function TeamPage() {
  const {
    activeWorkspace,
    activeMembers,
    activeInvites,
    inviteToActiveWorkspace,
  } = useWorkspace();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("All");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [labels, setLabels] = useState<MemberLabels>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");

  const members = useMemo(() => {
    return activeMembers.length ? activeMembers : activeWorkspace?.members_preview ?? [];
  }, [activeMembers, activeWorkspace]);

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
  const pendingInviteCount = activeInvites.filter((invite) => invite.status === "pending").length;

  async function handleInvite(target: string, role: WorkspaceRole) {
    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to invite teammate");
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
              <h1 className="omnix-page-title omnix-gradient-text">{activeWorkspace?.name ?? "Workspace"} team</h1>
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

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-[220px]">
            <Search className="absolute left-[11px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search members or labels..."
              className="omnix-input h-10 w-full rounded-[var(--omnix-radius-sm)] py-2 pl-8 pr-3 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-[11px] font-semibold transition",
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
          {filteredMembers.length ? filteredMembers.map((member) => {
            const key = memberKey(member);
            const RoleIcon = roleIcon(member.role);
            const name = memberName(member);
            const customLabel = labels[key];
            const isEditing = editingKey === key;
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
                      <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", workspaceRoleBadgeClass(member.role))}>
                        <RoleIcon className="h-3 w-3" />
                        {displayRole(member.role)}
                      </span>
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
                            className="rounded-full border border-[var(--omnix-border)] bg-black/15 px-2 py-1 text-[10px] text-[var(--omnix-text-3)] transition hover:text-white"
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
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 text-xs font-semibold text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-border-active)] hover:text-white"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Label
                  </button>
                </div>
              </article>
            );
          }) : (
            <div className="p-10 text-center">
              <Users className="mx-auto h-9 w-9 text-cyan-200/35" />
              <p className="mt-3 font-semibold text-white">{members.length === 0 ? "No team members loaded yet" : "No members match this filter"}</p>
              <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--omnix-text-3)]">
                {members.length === 0
                  ? "Workspace membership will appear here after the backend returns members for this workspace."
                  : "Try another search term, role filter, or secondary label."}
              </p>
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
    </section>
  );
}
