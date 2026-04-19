"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import { Crown, Mail, MoreHorizontal, Plus, Search, Shield, User, UserCheck } from "lucide-react";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import { useWorkspace } from "@/lib/workspace-context";
import { initialsFromText, isWorkspaceFounderRole, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { WorkspaceMember } from "@/lib/workspace-types";

const statusColors = {
  online: "#00e87a",
  away: "#ffb800",
  offline: "rgba(255,255,255,0.2)",
};

function roleColor(role?: string | null) {
  if (role === "founder" || role === "owner") return "var(--role-founder)";
  if (role === "co_owner") return "var(--role-coowner)";
  if (role === "admin") return "var(--role-admin)";
  return "var(--role-member)";
}

function roleIcon(role?: string | null) {
  if (role === "founder" || role === "owner") return Crown;
  if (role === "co_owner") return Shield;
  if (role === "admin") return UserCheck;
  return User;
}

function memberName(member: WorkspaceMember) {
  return member.full_name || member.email || member.handle || "Workspace member";
}

function joinedLabel(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(date);
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

  const members = useMemo(() => {
    const source = activeMembers.length ? activeMembers : activeWorkspace?.members_preview ?? [];
    if (source.length) return source;
    return [
      {
        workspace_id: activeWorkspace?.id ?? "local",
        user_id: "current-user",
        role: activeWorkspace?.current_user_role ?? "founder",
        email: null,
        full_name: "You",
        handle: null,
        avatar_label: "Y",
      },
    ] satisfies WorkspaceMember[];
  }, [activeMembers, activeWorkspace]);

  const filters = ["All", "Founder", "Co-owner", "Member"];
  const filteredMembers = members.filter((member) => {
    const role = workspaceRoleLabel(member.role);
    const needle = `${memberName(member)} ${member.email ?? ""} ${member.handle ?? ""}`.toLowerCase();
    return (filter === "All" || role === filter) && needle.includes(search.toLowerCase());
  });
  const canInvite = isWorkspaceFounderRole(activeWorkspace?.current_user_role);

  async function handleInvite(target: string, role: "co_owner" | "member") {
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

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-[18px]">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Total Members", value: activeWorkspace?.member_count ?? members.length, color: "#00FFFF" },
            { label: "Online Now", value: Math.max(1, Math.min(members.length, 4)), color: "#00e87a" },
            { label: "Pending Invites", value: activeInvites.filter((invite) => invite.status === "pending").length || "Clear", color: "#9b5cff" },
          ].map((item, index) => (
            <div
              key={item.label}
              className="flex items-center gap-3 rounded-[var(--omnix-radius-sm)] border border-[rgba(0,255,255,0.08)] bg-[rgba(0,255,255,0.03)] px-[18px] py-3.5 transition hover:shadow-[0_0_16px_rgba(0,255,255,0.08)]"
              style={{ "--stat-color": item.color } as CSSProperties}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background: item.color,
                  boxShadow: `0 0 10px ${item.color}80`,
                  animation: index === 1 ? "omnix-dot-pulse 2s ease-in-out infinite" : undefined,
                }}
              />
              <span className="text-xs text-white/45">{item.label}</span>
              <span className="omnix-display ml-auto text-xl font-extrabold text-white">{item.value}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-[11px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-white/25" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search members..."
              className="omnix-input h-9 w-full rounded-[var(--omnix-radius-sm)] py-2 pl-8 pr-3 text-xs"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                className="rounded-full border px-3 py-1.5 text-[11px] font-semibold transition"
                style={{
                  background: filter === item ? "rgba(0,255,255,0.1)" : "rgba(0,255,255,0.03)",
                  borderColor: filter === item ? "rgba(0,255,255,0.3)" : "rgba(0,255,255,0.08)",
                  color: filter === item ? "var(--omnix-cyan)" : "rgba(255,255,255,0.35)",
                  boxShadow: filter === item ? "var(--omnix-glow-xs)" : "none",
                }}
              >
                {item}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setInviteError(null);
              setInviteOpen(true);
            }}
            disabled={!canInvite}
            className="inline-flex h-9 items-center gap-1.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-cyan)] bg-transparent px-4 text-xs font-bold text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] transition hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)] disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-3.5 w-3.5" />
            Invite Member
          </button>
        </div>

        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          {filteredMembers.map((member, index) => {
            const color = roleColor(member.role);
            const RoleIcon = roleIcon(member.role);
            const displayName = memberName(member);
            const status: keyof typeof statusColors = index < 3 ? "online" : index === 3 ? "away" : "offline";

            return (
              <article
                key={member.user_id || `${member.email}-${index}`}
                className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.08)] bg-[rgba(0,255,255,0.03)] p-5 transition hover:-translate-y-0.5 hover:bg-[rgba(0,255,255,0.05)] hover:shadow-[0_0_30px_rgba(0,255,255,0.1),0_4px_20px_rgba(0,0,0,0.3)]"
                style={{ animation: `omnix-card-enter 0.35s ease ${index * 45}ms both` }}
              >
                <div
                  className="absolute inset-x-[20%] top-0 h-px"
                  style={{ background: `linear-gradient(90deg, transparent, ${color}50, transparent)` }}
                />
                <button
                  type="button"
                  className="absolute right-3.5 top-3.5 rounded-md p-1 text-white/20 transition hover:bg-white/[0.06] hover:text-white/50"
                  aria-label="Member options"
                  title="Member options"
                >
                  <MoreHorizontal className="h-[15px] w-[15px]" />
                </button>

                <div className="mb-3.5 flex items-center gap-[13px]">
                  <div className="relative shrink-0">
                    <div
                      className="flex h-[50px] w-[50px] items-center justify-center rounded-full border-2 text-xl font-extrabold text-white"
                      style={{
                        background: `linear-gradient(135deg, ${color} 0%, ${color}70 100%)`,
                        borderColor: `${color}50`,
                        boxShadow: `0 0 20px ${color}30`,
                      }}
                    >
                      {member.avatar_label || initialsFromText(displayName)}
                    </div>
                    <span
                      className="absolute bottom-px right-px h-3 w-3 rounded-full border-2 border-[#050c17]"
                      style={{
                        background: statusColors[status],
                        boxShadow: status === "online" ? "0 0 6px rgba(0,232,122,0.8)" : "none",
                        animation: status === "online" ? "omnix-dot-pulse 2s ease-in-out infinite" : undefined,
                      }}
                    />
                  </div>
                  <div className="min-w-0">
                    <h2 className="omnix-display truncate text-[15px] font-bold text-white">{displayName}</h2>
                    <div className="mt-1 flex items-center gap-1.5">
                      <RoleIcon className="h-[11px] w-[11px]" style={{ color }} />
                      <span className="text-[11px] font-bold tracking-[0.02em]" style={{ color }}>
                        {workspaceRoleLabel(member.role)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[10px] text-white/30">{activeWorkspace?.name ?? "Workspace"}</p>
                  </div>
                </div>

                <div className="mb-3.5 flex items-center gap-1.5 truncate text-[11px] text-white/35">
                  <Mail className="h-[11px] w-[11px] shrink-0" />
                  <span className="truncate">{member.email || member.handle || "No contact set"}</span>
                </div>

                <div className="flex gap-2">
                  <div className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-center">
                    <div className="omnix-display text-[15px] font-bold text-white">{(2841 - index * 237).toLocaleString()}</div>
                    <div className="text-[10px] text-white/30">Queries</div>
                  </div>
                  <div className="flex-1 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2 text-center">
                    <div className="omnix-display text-[13px] font-bold text-white">{joinedLabel(member.created_at)}</div>
                    <div className="text-[10px] text-white/30">Joined</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        {filteredMembers.length === 0 ? (
          <div className="rounded-[var(--omnix-radius)] border border-dashed border-[var(--omnix-border)] bg-[rgba(0,255,255,0.02)] p-8 text-center text-sm text-[var(--omnix-text-2)]">
            No members match this filter.
          </div>
        ) : null}
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
