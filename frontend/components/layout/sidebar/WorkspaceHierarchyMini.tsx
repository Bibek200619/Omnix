"use client";

import { useRouter } from "next/navigation";
import { Globe2, Layers3, Network, Users } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { workspaceRoleLabel } from "@/lib/workspace-roles";
import type { Workspace } from "@/lib/workspace-types";

export function workspaceTypeLabel(workspace?: Workspace | null) {
  if (!workspace) return null;
  if (workspace.is_global) return "Global";
  if (workspace.workspace_type === "super_workspace" || workspace.workspace_type === "super") return "Super";
  if (workspace.workspace_type === "subworkspace" || workspace.workspace_type === "sub" || workspace.workspace_type === "global_workspace") return "Team";
  return null;
}

export function WorkspaceTypeBadge({ workspace }: { workspace?: Workspace | null }) {
  const label = workspaceTypeLabel(workspace);
  if (!label) return null;

  return (
    <Badge
      variant="role"
      className={cn(
        "shrink-0 !rounded px-1.5 py-0.5 !text-[8px] uppercase tracking-[0.08em]",
        label === "Super" && "border-indigo-300/20 bg-indigo-400/10 text-indigo-200",
        label === "Global" && "border-amber-300/25 bg-amber-400/10 text-amber-200",
        label === "Team" && "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
      )}
    >
      {label}
    </Badge>
  );
}

export function workspaceIcon(workspace: Workspace) {
  if (workspace.is_global) return Globe2;
  if (workspace.workspace_type === "super_workspace") return Layers3;
  return Users;
}

export function SidebarHealthDot({ health }: { health?: string | null }) {
  if (!health || health === "quiet") return null;

  return (
    <span
      className={cn(
        "h-1.5 w-1.5 rounded-full animate-pulse",
        health === "alive"
          ? "bg-emerald-400 shadow-[0_0_8px_var(--omnix-rgba-52-211-153-0-8)]"
          : "bg-cyan-400 shadow-[0_0_6px_var(--omnix-rgba-34-211-238-0-6)]",
      )}
    />
  );
}

export function WorkspaceHierarchyMini({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { activeWorkspace, activeMembers } = useWorkspace();
  const members = activeMembers.length || activeWorkspace?.member_count || 0;
  const spaces = [
    {
      label: "Global",
      meta: activeWorkspace?.is_shared ? "Shared context" : "Primary context",
      color: "var(--omnix-cyan)",
      count: activeWorkspace ? "Root" : null,
    },
    {
      label: "Team",
      meta: `${members} ${members === 1 ? "collaborator" : "collaborators"}`,
      color: "var(--omnix-amber)",
      count: String(members),
    },
    {
      label: "Knowledge",
      meta: "Sources and files",
      color: "var(--omnix-green)",
      count: null,
    },
  ];

  return (
    <div className="px-2.5 pb-3">
      <div className="mb-2 flex items-center justify-between px-2">
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-white/20">
          Orientation
        </p>
      </div>
      <div className="omnix-tree-card px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => {
            router.push("/workspace");
            onClose();
          }}
          className="relative z-10 flex w-full items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2 py-2 text-left transition hover:bg-white/[0.05]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-cyan-400/20 bg-cyan-400/5 text-[10px] font-bold text-cyan-300/80">
            {(activeWorkspace?.name || "O").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] font-medium text-white/90">
              {activeWorkspace?.name || "Global Context"}
            </span>
            <span className={cn("mt-0.5 inline-flex rounded-full border border-white/5 bg-white/5 px-1.5 py-px text-[8px] font-medium text-white/40")}>
              {workspaceRoleLabel(activeWorkspace?.current_user_role)}
            </span>
          </span>
          <Network className="h-3 w-3 text-white/10" />
        </button>
        <div className="relative z-10 ml-5 mt-2 border-l border-white/5 pl-3">
          {spaces.map((space) => (
            <button
              key={space.label}
              type="button"
              onClick={() => {
                router.push(space.label === "Knowledge" ? "/sources" : space.label === "Team" ? "/team" : "/workspace");
                onClose();
              }}
              className="group relative mb-1.5 flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition hover:bg-white/[0.04]"
            >
              <span className="absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2 bg-white/5" />
              <span className="h-1.5 w-1.5 shrink-0 rounded-full opacity-60" style={{ background: space.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-medium text-white/40 group-hover:text-white/70">
                  {space.label}
                </span>
              </span>
              {space.count ? (
                <span className="text-[9px] font-medium text-white/10">{space.count}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
