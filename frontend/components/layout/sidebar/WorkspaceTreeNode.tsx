"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { Workspace } from "@/lib/workspace-types";
import { SidebarHealthDot, WorkspaceTypeBadge, workspaceIcon } from "./WorkspaceHierarchyMini";

type WorkspaceTreeNodeProps = {
  workspace: Workspace;
  index: number;
  isExpanded: boolean;
  onToggleExpanded: (workspace: Workspace) => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

type SubspaceRowProps = {
  subspace: Workspace;
  index: number;
  onSelectWorkspace: (workspaceId: string) => void;
};

function SubspaceRow({ subspace, index, onSelectWorkspace }: SubspaceRowProps) {
  const { activeWorkspaceId } = useWorkspaceTree();
  const { statusForWorkspace } = useWorkspaceCollaboration();
  const Icon = workspaceIcon(subspace);
  const isActive = subspace.id === activeWorkspaceId;
  const liveStatus = statusForWorkspace(subspace.id);
  const health = liveStatus?.health || "quiet";

  return (
    <motion.button
      key={subspace.id}
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, delay: index * 0.015 }}
      type="button"
      onClick={() => onSelectWorkspace(subspace.id)}
      aria-label={`Switch to ${subspace.name}`}
      className={cn(
        "relative my-0.5 flex min-h-[44px] w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left transition-all duration-300 sm:min-h-[44px]",
        isActive
          ? "bg-cyan-300/[0.08] text-white shadow-[inset_0_1px_0_var(--omnix-rgba-255-255-255-0-04)]"
          : "text-[var(--omnix-text-2)] hover:bg-[var(--omnix-surface)] hover:text-white",
      )}
    >
      {isActive ? (
        <span className="absolute left-0 h-5 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" />
      ) : null}
      <span
        className={cn(
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border transition-all duration-500",
          isActive
            ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-200"
            : subspace.is_global
              ? "border-amber-300/25 bg-amber-400/10 text-amber-200"
              : "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className={cn("truncate text-[11px] font-bold tracking-tight", isActive ? "text-cyan-200" : "text-white/80")}>
            {subspace.name}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <SidebarHealthDot health={health} />
            <WorkspaceTypeBadge workspace={subspace} />
          </div>
        </span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-tight text-white/30">
          <span className={cn(liveStatus?.active_count && "text-emerald-400/80")}>
            {liveStatus?.active_count ?? 0} active
          </span>
          <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
          <span>{liveStatus?.source_count ?? 0} sources</span>
        </span>
      </span>
    </motion.button>
  );
}

export function WorkspaceTreeNode({
  workspace,
  index,
  isExpanded,
  onToggleExpanded,
  onSelectWorkspace,
}: WorkspaceTreeNodeProps) {
  const {
    activeWorkspaceId,
    refreshWorkspaceSubspaces,
    subspaceLoadingByParentId,
    subspaceErrorByParentId,
  } = useWorkspaceTree();
  const { statusForWorkspace } = useWorkspaceCollaboration();
  const Icon = workspaceIcon(workspace);
  const isActive = workspace.id === activeWorkspaceId;
  const hasHierarchy = workspace.workspace_type === "super_workspace";
  const subspaces = workspace.subspaces ?? [];
  const subspacesLoading = Boolean(subspaceLoadingByParentId[workspace.id]);
  const subspacesError = subspaceErrorByParentId[workspace.id];
  const liveStatus = statusForWorkspace(workspace.id);
  const health = liveStatus?.health || "quiet";
  const aiState = liveStatus?.ai_status || "ready";

  return (
    <motion.div
      key={workspace.id}
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.12, delay: index * 0.02 }}
    >
      <div className="group/workspace flex items-stretch gap-1 px-1">
        {hasHierarchy ? (
          <Tooltip content={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}>
            <button
              type="button"
              onClick={() => onToggleExpanded(workspace)}
              className="flex h-12 w-10 min-w-[44px] shrink-0 items-center justify-center rounded-[7px] text-[var(--omnix-text-3)] transition hover:bg-white/5 hover:text-white"
              aria-label={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
              title={isExpanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-300", isExpanded && "rotate-90")} />
            </button>
          </Tooltip>
        ) : (
          <span className="h-12 w-10 min-w-[44px] shrink-0" />
        )}

        <button
          type="button"
          onClick={() => onSelectWorkspace(workspace.id)}
          aria-label={`Switch to ${workspace.name}`}
          className={cn(
            "relative flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 rounded-[9px] px-3 py-2 text-left transition-all duration-300",
            isActive
              ? "bg-cyan-300/[0.1] shadow-[var(--omnix-glow-xs),inset_0_1px_0_var(--omnix-rgba-255-255-255-0-06)]"
              : "hover:bg-white/[0.04]",
            isActive && aiState === "active" && "omnix-intel-glow",
          )}
        >
          {isActive ? <span className="absolute left-0 h-6 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" /> : null}
          <div className="relative shrink-0">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md border transition-all duration-300",
                isActive ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-200" : "border-white/10 bg-white/5 text-white/40",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            {health !== "quiet" ? (
              <span
                className={cn(
                  "omnix-streaming-dot absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900",
                  health === "alive" ? "bg-emerald-500" : "bg-cyan-500",
                )}
              />
            ) : null}
          </div>

          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center justify-between gap-1.5">
              <span className={cn("truncate text-[13px] font-bold tracking-tight", isActive ? "text-white" : "text-white/80")}>
                {workspace.name}
              </span>
              <div className="flex items-center gap-1.5">
                {aiState === "active" ? <Sparkles className="h-3 w-3 animate-pulse text-purple-400" /> : null}
                <WorkspaceTypeBadge workspace={workspace} />
              </div>
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.05em] text-white/30">
              <span className={cn(liveStatus?.active_count && "text-emerald-400/80")}>
                {liveStatus?.active_count ?? 0} pulse
              </span>
              <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
              <span>{liveStatus?.source_count ?? 0} logic</span>
              <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
              <Badge variant="role" className={cn("!rounded border-white/5 px-1.5 py-0.5 !text-[9px]", workspaceRoleBadgeClass(workspace.current_user_role))}>
                {workspaceRoleLabel(workspace.current_user_role)}
              </Badge>
            </span>
          </span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {hasHierarchy && isExpanded ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.14 }}
            className="ml-[30px] border-l border-[var(--omnix-border)] pl-2"
          >
            {subspaces.length > 0 ? (
              subspaces.map((subspace, subspaceIndex) => (
                <SubspaceRow key={subspace.id} subspace={subspace} index={subspaceIndex} onSelectWorkspace={onSelectWorkspace} />
              ))
            ) : subspacesLoading ? (
              <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[var(--omnix-text-3)]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading subspaces
              </div>
            ) : subspacesError ? (
              <button
                type="button"
                onClick={() => void refreshWorkspaceSubspaces(workspace.id)}
                className="my-1 flex min-h-[44px] w-full items-center gap-2 rounded-[7px] border border-rose-400/20 bg-rose-400/10 px-2.5 py-2 text-left text-[11px] text-rose-100"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">Subspaces could not be loaded. Retry</span>
              </button>
            ) : (
              <div className="px-2.5 py-2 text-[11px] text-[var(--omnix-text-3)]">No subspaces yet</div>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}

type WorkspaceListStateProps = {
  loading: boolean;
  error: string | null;
  workspaces: Workspace[];
  expandedWorkspaceIds: Set<string>;
  onRetry: () => void;
  onToggleExpanded: (workspace: Workspace) => void;
  onSelectWorkspace: (workspaceId: string) => void;
};

export function WorkspaceListState({
  loading,
  error,
  workspaces,
  expandedWorkspaceIds,
  onRetry,
  onToggleExpanded,
  onSelectWorkspace,
}: WorkspaceListStateProps) {
  if (error) {
    return (
      <div className="m-2 rounded-md border border-rose-400/25 bg-rose-400/10 p-2 text-xs text-rose-100">
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1">Workspace hierarchy could not be loaded.</span>
        </div>
        <Button type="button" variant="ghost" size="sm" className="mt-2 min-h-[44px] w-full text-xs" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Loading workspaces
      </div>
    );
  }

  if (workspaces.length === 0) return <div className="px-3 py-4 text-sm text-slate-400">No workspaces yet</div>;

  return (
    <AnimatePresence mode="popLayout">
      {workspaces.map((workspace, index) => (
        <WorkspaceTreeNode
          key={workspace.id}
          workspace={workspace}
          index={index}
          isExpanded={expandedWorkspaceIds.has(workspace.id)}
          onToggleExpanded={onToggleExpanded}
          onSelectWorkspace={onSelectWorkspace}
        />
      ))}
    </AnimatePresence>
  );
}
