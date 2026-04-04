import type { WorkspaceRole } from "@/lib/workspace-types";

export function workspaceRoleLabel(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "owner":
      return "Founder";
    case "co_owner":
      return "Co-owner";
    case "member":
      return "Member";
    default:
      return "Member";
  }
}

export function workspaceRoleBadgeClass(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "owner":
      return "border-rose-300/30 bg-rose-400/12 text-rose-100";
    case "co_owner":
      return "border-amber-300/35 bg-amber-300/12 text-amber-100";
    case "member":
      return "border-sky-300/30 bg-sky-300/12 text-sky-100";
    default:
      return "border-slate-300/20 bg-white/[0.05] text-slate-300";
  }
}

export function workspaceRoleAvatarClass(role?: WorkspaceRole | string | null) {
  switch (role) {
    case "owner":
      return "border-rose-300/35 bg-rose-400/15 text-rose-100";
    case "co_owner":
      return "border-amber-300/35 bg-amber-300/15 text-amber-100";
    case "member":
      return "border-sky-300/35 bg-sky-300/15 text-sky-100";
    default:
      return "border-white/15 bg-white/[0.06] text-slate-200";
  }
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
