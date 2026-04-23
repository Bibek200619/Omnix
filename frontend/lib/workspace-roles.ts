import type { WorkspaceRole } from "@/lib/workspace-types";

export function workspaceRoleLabel(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "super_founder":
    case "founder":
    case "owner":
      return "Org Founder";
    case "sub_leader":
    case "co_owner":
      return "Operational Lead";
    case "sub_member":
    case "member":
      return "Workspace Member";
    default:
      return "Workspace Member";
  }
}

export function workspaceRoleBadgeClass(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "super_founder":
    case "founder":
    case "owner":
      return "border-purple-300/25 bg-purple-400/10 text-purple-200 shadow-[var(--omnix-glow-xs)]";
    case "sub_leader":
    case "co_owner":
      return "border-amber-300/25 bg-amber-400/10 text-amber-200 shadow-[var(--omnix-glow-xs)]";
    case "sub_member":
    case "member":
      return "border-cyan-300/20 bg-cyan-400/5 text-cyan-100";
    default:
      return "border-slate-300/20 bg-white/[0.05] text-slate-300";
  }
}

export function workspaceRoleAvatarClass(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "super_founder":
    case "founder":
    case "owner":
      return "border-purple-300/35 bg-purple-400/15 text-purple-100";
    case "sub_leader":
    case "co_owner":
      return "border-amber-300/35 bg-amber-400/15 text-amber-100";
    case "sub_member":
    case "member":
      return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
    default:
      return "border-white/15 bg-white/[0.06] text-slate-200";
  }
}

export function isWorkspaceFounderRole(role?: WorkspaceRole | string | null) {
  return role === "super_founder" || role === "founder" || role === "owner";
}

export function initialsFromText(value?: string | null) {
  const normalized = (value || "").trim();
  if (!normalized) return "U";

  const parts = normalized
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) return normalized[0]?.toUpperCase() || "U";
  return parts.map((part) => part[0]?.toUpperCase()).join("") || "U";
}
