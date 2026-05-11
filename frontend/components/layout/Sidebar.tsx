"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
    AlertCircle,
    AlertTriangle,
    BarChart2,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    ClipboardCheck,
    Compass,
    Edit3,
    FileText,
    Globe2,
    LayoutDashboard,
    Layers3,
    Loader2,
    MessageSquare,
    MessageSquarePlus,
    MessagesSquare,
    Network,
    PanelLeftClose,
    Plus,
    Search,
    Settings,
    Sparkles,
    Trash2,
    UserPlus,
    Users,
    X,
} from "lucide-react";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { Button } from "@/components/ui/Button";
import { FloatingMenuLayer } from "@/components/ui/FloatingMenuLayer";
import { ClientTime } from "@/components/ui/ClientTime";
import { Input } from "@/components/ui/Input";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useProfile } from "@/lib/profile-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import { PendingWorkspaceInvites } from "@/components/workspace/PendingWorkspaceInvites";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import type { Workspace, WorkspaceRole } from "@/lib/workspace-types";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/conversations", label: "Conversations", icon: MessagesSquare },
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
  { href: "/initiatives", label: "Initiatives", icon: Compass },
  { href: "/workspace", label: "Workspaces", icon: Layers3 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/sources", label: "Sources", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function workspaceTypeLabel(workspace?: Workspace | null) {
  if (!workspace) return null;
  if (workspace.is_global) return "Global";
  if (workspace.workspace_type === "super_workspace" || workspace.workspace_type === "super") return "Super";
  if (workspace.workspace_type === "subworkspace" || workspace.workspace_type === "sub" || workspace.workspace_type === "global_workspace") return "Team";
  return null;
}

function WorkspaceTypeBadge({ workspace }: { workspace?: Workspace | null }) {
  const label = workspaceTypeLabel(workspace);
  if (!label) return null;

  return (
    <span
      className={cn(
        "shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.08em]",
        label === "Super" && "border-indigo-300/20 bg-indigo-400/10 text-indigo-200",
        label === "Global" && "border-amber-300/25 bg-amber-400/10 text-amber-200",
        label === "Team" && "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
      )}
    >
      {label}
    </span>
  );
}

function workspaceIcon(workspace: Workspace) {
  if (workspace.is_global) return Globe2;
  if (workspace.workspace_type === "super_workspace") return Layers3;
  return Users;
}

function WorkspaceSelector({ onWorkspaceSelect }: { onWorkspaceSelect?: () => void }) {
  const {
    workspaces,
    loading,
    error: workspaceError,
    activeWorkspaceId,
    activeWorkspace,
    activeRootWorkspace,
    pendingInvites,
    subspaceLoadingByParentId,
    subspaceErrorByParentId,
    setActiveWorkspace,
    refreshWorkspaces,
    refreshWorkspaceSubspaces,
    createWorkspace,
    createSubspace,
    renameWorkspace,
    deleteWorkspace,
    inviteToActiveWorkspace,
  } = useWorkspace();
  const { presence, statusForWorkspace, realtimeStatus } = useWorkspaceCollaboration();
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const selectorMenuRef = useRef<HTMLDivElement | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCreateSubspaceModal, setShowCreateSubspaceModal] = useState(false);
  const [newSubspaceName, setNewSubspaceName] = useState("");
  const [creatingSubspace, setCreatingSubspace] = useState(false);
  const [createSubspaceError, setCreateSubspaceError] = useState<string | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());

  const [showManageActions, setShowManageActions] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const active = activeWorkspace;
  const activeSuperWorkspace =
    activeRootWorkspace?.workspace_type === "super_workspace" ? activeRootWorkspace : null;
  const canCreateSubspace = Boolean(
    activeSuperWorkspace && isWorkspaceFounderRole(activeSuperWorkspace.current_user_role),
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!selectorRef.current?.contains(target) && !selectorMenuRef.current?.contains(target)) {
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

  useEffect(() => {
    if (!activeRootWorkspace?.id || (activeRootWorkspace.workspace_type !== "super" && activeRootWorkspace.workspace_type !== "super_workspace")) {
      return;
    }

    setExpandedWorkspaceIds((current) => {
      if (current.has(activeRootWorkspace.id)) {
        return current;
      }
      const next = new Set(current);
      next.add(activeRootWorkspace.id);
      return next;
    });
  }, [activeRootWorkspace?.id, activeRootWorkspace?.workspace_type]);

  function isExpanded(workspaceId: string) {
    return expandedWorkspaceIds.has(workspaceId);
  }

  function toggleExpanded(workspace: Workspace) {
    const shouldRefresh = !expandedWorkspaceIds.has(workspace.id) && workspace.workspace_type === "super_workspace";
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspace.id)) {
        next.delete(workspace.id);
      } else {
        next.add(workspace.id);
      }
      return next;
    });
    if (shouldRefresh) {
      void refreshWorkspaceSubspaces(workspace.id);
    }
  }

  async function handleCreate() {
    if (!newWorkspaceName.trim() || creatingWorkspace) return;
    try {
      setCreatingWorkspace(true);
      setCreateError(null);
      const created = await createWorkspace({ name: newWorkspaceName.trim(), workspace_type: "super_workspace" });
      setActiveWorkspace(created.id);
      setNewWorkspaceName("");
      setShowCreateForm(false);
      setOpen(false);
      onWorkspaceSelect?.();
    } catch (err) {
      console.error("Failed to create workspace", err);
      setCreateError(err instanceof Error ? err.message : "Unable to create workspace");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function handleCreateSubspace() {
    if (!activeSuperWorkspace || !newSubspaceName.trim() || creatingSubspace) return;
    try {
      setCreatingSubspace(true);
      setCreateSubspaceError(null);
      const created = await createSubspace(activeSuperWorkspace.id, { name: newSubspaceName.trim() });
      setExpandedWorkspaceIds((current) => {
        const next = new Set(current);
        next.add(activeSuperWorkspace.id);
        return next;
      });
      setActiveWorkspace(created.id);
      setNewSubspaceName("");
      setShowCreateSubspaceModal(false);
      setOpen(false);
      onWorkspaceSelect?.();
    } catch (err) {
      console.error("Failed to create subspace", err);
      setCreateSubspaceError(err instanceof Error ? err.message : "Unable to create subspace");
    } finally {
      setCreatingSubspace(false);
    }
  }

  function handleCancelSubspace() {
    setShowCreateSubspaceModal(false);
    setNewSubspaceName("");
    setCreateSubspaceError(null);
  }

  function handleCancel() {
    setShowCreateForm(false);
    setNewWorkspaceName("");
    setCreateError(null);
  }

  async function handleInvite(target: string, role: WorkspaceRole) {
    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
      setOpen(false);
      onWorkspaceSelect?.();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Unable to invite teammate");
    } finally {
      setInviting(false);
    }
  }

  function openRenameWorkspace() {
    if (!active) return;
    setRenameDraft(active.name);
    setRenameError(null);
    setRenameOpen(true);
  }

  async function handleRenameWorkspace() {
    if (!active || !renameDraft.trim() || renaming) return;

    try {
      setRenaming(true);
      setRenameError(null);
      await renameWorkspace(active.id, { name: renameDraft.trim() });
      setRenameOpen(false);
      setOpen(false);
      onWorkspaceSelect?.();
    } catch (err) {
      setRenameError(err instanceof Error ? err.message : "Unable to rename workspace");
    } finally {
      setRenaming(false);
    }
  }

  function openDeleteWorkspace() {
    if (!active) return;
    setDeleteConfirmText("");
    setDeleteError(null);
    setDeleteOpen(true);
  }

  async function handleDeleteWorkspace() {
    if (!active || deleting || deleteConfirmText !== active.name) return;

    try {
      setDeleting(true);
      setDeleteError(null);
      await deleteWorkspace(active.id);
      setDeleteOpen(false);
      setOpen(false);
      onWorkspaceSelect?.();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unable to delete workspace");
    } finally {
      setDeleting(false);
    }
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspace(workspaceId);
    setOpen(false);
    onWorkspaceSelect?.();
  }

  function renderSubspaceRow(subspace: Workspace, index: number) {
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
        onClick={() => selectWorkspace(subspace.id)}
        className={cn(
          "relative my-0.5 flex min-h-[42px] w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left transition-all duration-300 sm:min-h-9",
          isActive
            ? "bg-cyan-300/[0.08] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
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
              {health !== "quiet" && (
                <span className={cn(
                  "h-1.5 w-1.5 rounded-full animate-pulse",
                  health === "alive" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" : "bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]"
                )} />
              )}
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

  function renderWorkspaceTree(workspace: Workspace, index: number) {
    const Icon = workspaceIcon(workspace);
    const expanded = isExpanded(workspace.id);
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
            <button
              type="button"
              onClick={() => toggleExpanded(workspace)}
              className="flex h-12 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--omnix-text-3)] transition hover:bg-white/5 hover:text-white"
              aria-label={expanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
              title={expanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform duration-300", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="h-12 w-7 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => selectWorkspace(workspace.id)}
            className={cn(
              "relative flex min-h-[48px] min-w-0 flex-1 items-center gap-2.5 rounded-[9px] px-3 py-2 text-left transition-all duration-300",
              isActive
                ? "bg-cyan-300/[0.1] shadow-[var(--omnix-glow-xs),inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "hover:bg-white/[0.04]",
              isActive && aiState === "active" && "omnix-intel-glow"
            )}
          >
            {isActive ? (
              <span className="absolute left-0 h-6 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" />
            ) : null}
            
            <div className="relative shrink-0">
              <span className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md border transition-all duration-300",
                isActive ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-200" : "border-white/10 bg-white/5 text-white/40"
              )}>
                <Icon className="h-3.5 w-3.5" />
              </span>
              {health !== "quiet" && (
                <span className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full border border-slate-900 omnix-streaming-dot",
                  health === "alive" ? "bg-emerald-500" : "bg-cyan-500"
                )} />
              )}
            </div>

            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center justify-between gap-1.5">
                <span className={cn("truncate text-[13px] font-bold tracking-tight", isActive ? "text-white" : "text-white/80")}>
                  {workspace.name}
                </span>
                <div className="flex items-center gap-1.5">
                   {aiState === "active" && <Sparkles className="h-3 w-3 text-purple-400 animate-pulse" />}
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
                <span className={cn("px-1.5 py-0.5 rounded border border-white/5", workspaceRoleBadgeClass(workspace.current_user_role))}>
                  {workspaceRoleLabel(workspace.current_user_role)}
                </span>
              </span>
            </span>
          </button>
        </div>

        <AnimatePresence initial={false}>
          {hasHierarchy && expanded ? (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.14 }}
              className="ml-[30px] border-l border-[var(--omnix-border)] pl-2"
            >
              {subspaces.length > 0 ? (
                subspaces.map((subspace, subspaceIndex) => renderSubspaceRow(subspace, subspaceIndex))
              ) : subspacesLoading ? (
                <div className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[var(--omnix-text-3)]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading subspaces
                </div>
              ) : subspacesError ? (
                <button
                  type="button"
                  onClick={() => void refreshWorkspaceSubspaces(workspace.id)}
                  className="my-1 flex w-full items-center gap-2 rounded-[7px] border border-rose-400/20 bg-rose-400/10 px-2.5 py-2 text-left text-[11px] text-rose-100"
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

  const canManageActive = isWorkspaceFounderRole(active?.current_user_role);
  const ActiveWorkspaceIcon = active ? workspaceIcon(active) : Layers3;

  return (
    <div ref={selectorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-3 text-left transition duration-200 hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)] sm:px-[11px] sm:py-[9px]",
          realtimeStatus === "connected" && "border-cyan-300/20"
        )}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-[9px]">
          <div className="relative shrink-0">
            <div className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border transition-all duration-300 sm:h-8 sm:w-8",
              open ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-200" : "border-white/10 bg-white/5 text-white/40"
            )}>
              <ActiveWorkspaceIcon className="h-4.5 w-4.5 sm:h-4 sm:w-4" />
            </div>
            {realtimeStatus === "connected" && (
              <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#060a14] bg-[var(--omnix-green)] opacity-80" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold tracking-tight text-white sm:text-[13px]">
                {active ? active.name : "No workspace selected"}
              </span>
              <WorkspaceTypeBadge workspace={active} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--omnix-text-3)]">
               <span className={cn("px-1.5 py-0.5 rounded border border-white/5", workspaceRoleBadgeClass(active?.current_user_role))}>
                  {active ? workspaceRoleLabel(active.current_user_role) : "Workspace"}
               </span>
               {active && (
                 <>
                   <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
                   <span className={cn(realtimeStatus === "connected" && "text-cyan-300/80")}>
                    {presence?.active_count ?? statusForWorkspace(active.id)?.active_count ?? 0} active
                   </span>
                 </>
               )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {pendingInvites.length > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/10 px-1.5 text-[10px] font-semibold text-cyan-100">
              {pendingInvites.length}
            </span>
          ) : null}
          <ChevronDown className={cn("h-3 w-3 text-[var(--omnix-text-3)] transition-transform duration-200 group-hover:text-cyan-100", open && "rotate-180")} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <FloatingMenuLayer anchorRef={selectorRef} contentRef={selectorMenuRef} placement="bottom-start" width="anchor" minWidth={248} offset={6} zIndex={145}>
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="omnix-floating-card w-full overflow-hidden"
          >
            <div className="omnix-scrollbar overflow-y-auto py-1" style={{ maxHeight: "min(22rem, var(--omnix-floating-max-h))" }}>
              {workspaceError ? (
                <div className="m-2 rounded-md border border-rose-400/25 bg-rose-400/10 p-2 text-xs text-rose-100">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">Workspace hierarchy could not be loaded.</span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mt-2 h-7 w-full text-xs"
                    onClick={() => void refreshWorkspaces({ force: true })}
                  >
                    Retry
                  </Button>
                </div>
              ) : null}

              {loading ? (
                <div className="flex items-center gap-2 px-3 py-3 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading workspaces
                </div>
              ) : workspaces.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-400">No workspaces yet</div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {workspaces.map((workspace, index) => renderWorkspaceTree(workspace, index))}
                </AnimatePresence>
              )}
            </div>

            <div className="border-t border-white/5 bg-black/10 p-2">
              <div className="space-y-1">
                {showManageActions ? (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    className="space-y-2 pb-2"
                  >
                    {createError && (
                      <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">
                         {createError}
                      </div>
                    )}
                    
                    {canManageActive && (
                      <div className="grid grid-cols-2 gap-1.5 px-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 justify-start text-[9px] uppercase tracking-wider text-white/40 hover:text-white"
                          leftIcon={<Edit3 className="h-3 w-3" />}
                          onClick={openRenameWorkspace}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 justify-start text-[9px] uppercase tracking-wider text-rose-400/50 hover:text-rose-400"
                          leftIcon={<Trash2 className="h-3 w-3" />}
                          onClick={openDeleteWorkspace}
                        >
                          Delete
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="col-span-2 h-8 justify-start text-[9px] uppercase tracking-wider text-white/40 hover:text-white"
                          leftIcon={<UserPlus className="h-3 w-3" />}
                          onClick={() => {
                            setInviteError(null);
                            setInviteOpen(true);
                          }}
                        >
                          Manage Members
                        </Button>
                      </div>
                    )}
                    
                    <div className="px-1 space-y-1">
                      {showCreateForm ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            handleCreate();
                          }}
                          className="space-y-1.5"
                        >
                          <Input
                            value={newWorkspaceName}
                            onChange={(e) => {
                              setNewWorkspaceName(e.target.value);
                              setCreateError(null);
                            }}
                            placeholder="Workspace name"
                            autoFocus
                            disabled={creatingWorkspace}
                            className="h-7 text-[11px] rounded-md"
                          />
                          <div className="flex gap-1.5">
                            <Button
                              type="submit"
                              size="sm"
                              disabled={!newWorkspaceName.trim() || creatingWorkspace}
                              className="h-7 flex-1 text-[10px]"
                            >
                              {creatingWorkspace ? "..." : "Create"}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={handleCancel}
                              disabled={creatingWorkspace}
                              className="h-7 flex-1 text-[10px]"
                            >
                              Cancel
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setShowCreateForm(true)}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[9px] font-medium uppercase tracking-wider text-cyan-400/60 transition hover:bg-cyan-400/10 hover:text-cyan-400"
                        >
                          <Plus className="h-3 w-3" /> New Workspace
                        </button>
                      )}
                      {canCreateSubspace && (
                        <button
                          type="button"
                          onClick={() => {
                            setCreateSubspaceError(null);
                            setShowCreateSubspaceModal(true);
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[9px] font-medium uppercase tracking-wider text-emerald-400/60 transition hover:bg-emerald-400/10 hover:text-emerald-400"
                        >
                          <Plus className="h-3 w-3" /> New Subspace
                        </button>
                      )}
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => setShowManageActions(false)}
                      className="w-full py-1 text-[8px] font-bold uppercase tracking-[0.2em] text-white/10 hover:text-white/20 transition-colors"
                    >
                      Close Settings
                    </button>
                  </motion.div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowManageActions(true)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg py-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 transition hover:bg-white/5 hover:text-white/40"
                  >
                    <Settings className="h-3 w-3" /> Workspace Management
                  </button>
                )}
              </div>
            </div>
          </motion.div>
          </FloatingMenuLayer>
        )}
      </AnimatePresence>
      {active ? (
        <>
          <WorkspaceInviteModal
            open={inviteOpen}
            workspaceName={active.name}
            loading={inviting}
            error={inviteError}
            allowRoleSelection={isWorkspaceFounderRole(active.current_user_role)}
            onClose={() => setInviteOpen(false)}
            onSubmit={handleInvite}
          />
          {showCreateSubspaceModal && activeSuperWorkspace ? (
            <div className="omnix-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
              <div className="omnix-modal-card w-full max-w-md p-5">
                <div className="relative z-10 flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-emerald-100 shadow-[var(--omnix-glow-xs)]">
                      <Users className="h-4 w-4" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold text-white">Create team subspace</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                      Add a team space under <span className="font-medium text-slate-200">{activeSuperWorkspace.name}</span>.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Close create subspace modal"
                    title="Close create subspace modal"
                    onClick={handleCancelSubspace}
                    disabled={creatingSubspace}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <form
                  className="relative z-10 mt-5 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleCreateSubspace();
                  }}
                >
                  <Input
                    id="workspace-subspace-create"
                    label="Subspace name"
                    value={newSubspaceName}
                    onChange={(event) => {
                      setNewSubspaceName(event.target.value);
                      setCreateSubspaceError(null);
                    }}
                    placeholder="Design Team"
                    disabled={creatingSubspace}
                    autoFocus
                  />

                  {createSubspaceError ? (
                    <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                      {createSubspaceError}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={handleCancelSubspace} disabled={creatingSubspace}>
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      leftIcon={<Plus className="h-4 w-4" />}
                      isLoading={creatingSubspace}
                      disabled={!newSubspaceName.trim()}
                    >
                      Create
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
          {renameOpen ? (
            <div className="omnix-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
              <div className="omnix-modal-card w-full max-w-md p-5">
                <div className="relative z-10 flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
                      <Edit3 className="h-4 w-4" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold text-white">Rename workspace</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                      Update the visible name for this workspace.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Close rename modal"
                    title="Close rename modal"
                    onClick={() => setRenameOpen(false)}
                    disabled={renaming}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <form
                  className="relative z-10 mt-5 space-y-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    handleRenameWorkspace();
                  }}
                >
                  <Input
                    id="workspace-rename"
                    label="Workspace name"
                    value={renameDraft}
                    onChange={(event) => {
                      setRenameDraft(event.target.value);
                      setRenameError(null);
                    }}
                    disabled={renaming}
                    autoFocus
                  />

                  {renameError ? (
                    <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                      {renameError}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setRenameOpen(false)} disabled={renaming}>
                      Cancel
                    </Button>
                    <Button type="submit" leftIcon={<Check className="h-4 w-4" />} isLoading={renaming} disabled={!renameDraft.trim()}>
                      Save
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          ) : null}
          {deleteOpen ? (
            <div className="omnix-modal-backdrop fixed inset-0 z-[90] flex items-center justify-center px-4">
              <div className="omnix-modal-card w-full max-w-md border-rose-400/25 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_24px_rgba(244,63,94,0.14)]">
                <div className="relative z-10 flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-rose-300/30 bg-rose-400/10 text-rose-100">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold text-white">Delete workspace</h2>
                    <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                      This removes <span className="font-medium text-slate-200">{active.name}</span> from the workspace list and clears it from the active session.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Close delete modal"
                    title="Close delete modal"
                    onClick={() => setDeleteOpen(false)}
                    disabled={deleting}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>

                <div className="relative z-10 mt-5 space-y-4">
                  <Input
                    id="workspace-delete-confirm"
                    label={`Type "${active.name}" to confirm`}
                    value={deleteConfirmText}
                    onChange={(event) => {
                      setDeleteConfirmText(event.target.value);
                      setDeleteError(null);
                    }}
                    disabled={deleting}
                    autoFocus
                  />

                  {deleteError ? (
                    <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                      {deleteError}
                    </div>
                  ) : null}

                  <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleting}>
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      leftIcon={<Trash2 className="h-4 w-4" />}
                      isLoading={deleting}
                      disabled={deleteConfirmText !== active.name}
                      onClick={handleDeleteWorkspace}
                    >
                      Delete workspace
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type SidebarProps = {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
};

function profileDisplayName(userEmail?: string | null, metadata?: Record<string, unknown>, profileName?: string | null) {
  if (profileName?.trim()) return profileName.trim();
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return userEmail || "Omnix user";
}

function WorkspaceHierarchyMini({ onClose }: { onClose: () => void }) {
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
              <span
                className="absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2 bg-white/5"
              />
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full opacity-60"
                style={{ background: space.color }}
              />
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

export function Sidebar({ isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile();
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const {
    activeConversationId,
    archiveConversation,
    conversations,
    error,
    loading,
    renameConversation,
    refreshConversations,
    setActiveConversation,
  } = useConversationHistory();
  const displayName = profileDisplayName(user?.email, user?.user_metadata, profile?.display_name);
  const displayEmail = profile?.email || user?.email || "";
  const displayHandle = profile?.username || profile?.handle || null;

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;

    return conversations.filter((conversation) => {
      const title = conversation.title || "Omnix conversation";
      const preview = conversation.preview || "";
      return `${title} ${preview}`.toLowerCase().includes(normalized);
    });
  }, [conversations, query]);

  function openConversation(conversationId: string) {
    setActiveConversation(conversationId);
    router.push(`/chat?conversation=${conversationId}`);
    onClose();
  }

  function startNewChat() {
    setActiveConversation(null);
    router.push("/chat");
    onClose();
  }

  function startRename(conversationId: string, title?: string | null) {
    setEditingId(conversationId);
    setDraftTitle(title || "Omnix conversation");
    setActionError(null);
  }

  async function saveRename(conversationId: string) {
    try {
      setBusyId(conversationId);
      setActionError(null);
      await renameConversation(conversationId, draftTitle);
      setEditingId(null);
      setDraftTitle("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to rename chat.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteConversation(conversationId: string) {
    try {
      setBusyId(conversationId);
      setActionError(null);
      await archiveConversation(conversationId);
      if (activeConversationId === conversationId) {
        router.push("/chat");
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Unable to delete chat.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[var(--omnix-sidebar-w)] flex-col overflow-hidden border-r border-[var(--omnix-border)] bg-[linear-gradient(180deg,rgba(5,12,23,0.98),rgba(4,10,20,0.985))] shadow-[24px_0_120px_rgba(0,0,0,0.6),4px_0_40px_rgba(0,255,255,0.05)] backdrop-blur-[28px] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:-translate-x-full" : "lg:translate-x-0",
        )}
      >
        {/* Top ambient glow */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[radial-gradient(ellipse_at_50%_-10%,rgba(0,255,255,0.11)_0%,transparent_70%)]" />
        {/* Grid overlay */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.025] [background-image:linear-gradient(rgba(0,255,255,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.55)_1px,transparent_1px)] [background-size:64px_64px] [animation:auth-grid_22s_linear_infinite]" />
        {/* Right edge glow */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(0,255,255,0.15),rgba(0,255,255,0.08),transparent)]" />
        <div className="relative flex h-auto items-start justify-between border-b border-[var(--omnix-border)] px-[18px] pb-3.5 pt-[18px]">
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <Link
                href="/dashboard"
                onClick={onClose}
                className="flex items-center gap-2.5 group/logo"
              >
                <div className="omnix-logo-glow">
                  <OmnixMark size={34} />
                </div>
                <div>
                  <span className="omnix-display block text-lg font-semibold leading-tight tracking-[-0.045em] text-white">Omnix</span>
                  <span className="text-[10px] leading-tight tracking-[0.05em] text-[var(--omnix-cyan)] opacity-60">AI Workspace</span>
                </div>
              </Link>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-[26px] w-[26px] rounded-[7px] border border-[var(--omnix-border)] bg-transparent text-[var(--omnix-text-3)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white lg:inline-flex"
                  aria-label="Collapse workspace sidebar"
                  title="Collapse workspace sidebar"
                  onClick={onToggleCollapse}
                >
                  <PanelLeftClose className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-[26px] w-[26px] rounded-[7px] border border-[var(--omnix-border)] bg-transparent text-[var(--omnix-text-3)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white lg:hidden"
                  aria-label="Close navigation"
                  title="Close navigation"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
                  Workspace
                </p>
              </div>
              <WorkspaceSelector onWorkspaceSelect={onClose} />
            </div>
            <PendingWorkspaceInvites compact maxVisible={2} />
          </div>
        </div>

        <div className="hidden">
          <WorkspaceHierarchyMini onClose={onClose} />
        </div>

        <nav className="omnix-scrollbar relative min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
          <div className="mb-2 flex items-center gap-2 px-2">
            <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.12),transparent)]" />
            <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Navigation</p>
            <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.12),transparent)]" />
          </div>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/settings"
                ? pathname.startsWith("/settings")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "omnix-sidebar-link group/nav relative mb-px flex items-center gap-2.5 rounded-[var(--omnix-radius-sm)] border px-2.5 py-[9px] text-[13px] transition duration-150",
                  isActive
                    ? "border-cyan-300/20 bg-[radial-gradient(ellipse_at_0%_50%,rgba(0,255,255,0.1),transparent_60%),rgba(0,255,255,0.06)] font-semibold text-white shadow-[var(--omnix-glow-xs),inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-transparent font-normal text-[var(--omnix-text-2)] hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)] hover:text-white hover:shadow-[var(--omnix-glow-xs)]",
                )}
              >
                {isActive ? <span className="omnix-active-rail" /> : null}
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-all duration-150",
                    isActive
                      ? "text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_rgba(0,255,255,0.7)]"
                      : "text-[var(--omnix-text-3)] group-hover/nav:text-[var(--omnix-text-2)]",
                  )}
                />
                <span className={cn(isActive && "text-white")}>{item.label}</span>
                {isActive && (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--omnix-cyan)] shadow-[0_0_6px_rgba(0,255,255,0.9)]" />
                )}
              </Link>
            );
          })}
        </nav>

        <section className="hidden">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">
              Recent chats
            </p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)]"
              aria-label="New chat"
              title="New chat"
              onClick={startNewChat}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>

          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search"
            aria-label="Search recent chats"
            icon={<Search className="h-4 w-4" />}
            className="omnix-input mb-3 h-9 rounded-full bg-[var(--omnix-surface)]"
            disabled={loading || Boolean(error)}
          />

          {actionError ? (
            <div className="mb-3 rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-xs leading-5 text-rose-100">
              {actionError}
            </div>
          ) : null}

          {error ? (
            <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 p-3 text-sm text-rose-100">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p className="leading-5">History could not be loaded.</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="mt-3 w-full"
                onClick={() => void refreshConversations()}
              >
                Retry
              </Button>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="shimmer rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-3"
                >
                  <div className="h-3 w-4/5 rounded-full bg-[var(--omnix-surface-hover)]" />
                  <div className="mt-3 h-2.5 w-3/5 rounded-full bg-[var(--omnix-surface-hover)]" />
                </div>
              ))}
            </div>
          ) : filteredConversations.length ? (
            <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
                {filteredConversations.map((conversation) => {
                  const isActive =
                    pathname.startsWith("/chat") &&
                    activeConversationId === conversation.id;
                  const isEditing = editingId === conversation.id;
                  const isBusy = busyId === conversation.id;
                  const timestamp =
                    conversation.latest_message_at ??
                    conversation.last_message_at ??
                    conversation.updated_at ??
                    conversation.created_at;

                  return (
                    <motion.div
                      key={conversation.id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: 0.16, ease: "easeOut" }}
                      className={cn(
                        "group rounded-lg border px-2.5 py-2 transition",
                        isActive
                          ? "border-cyan-300/25 bg-cyan-300/10 shadow-[var(--omnix-glow-xs)]"
                          : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
                      )}
                    >
                      {isEditing ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveRename(conversation.id);
                          }}
                        >
                          <input
                            value={draftTitle}
                            onChange={(event) => setDraftTitle(event.target.value)}
                            autoFocus
                            className="h-8 min-w-0 flex-1 rounded-md border border-cyan-300/30 bg-black/30 px-2 text-xs font-medium text-white outline-none focus:ring-2 focus:ring-cyan-300/20"
                          />
                          <Button
                            type="submit"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={isBusy}
                            aria-label="Save title"
                            title="Save title"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            disabled={isBusy}
                            onClick={() => setEditingId(null)}
                            aria-label="Cancel rename"
                            title="Cancel rename"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </form>
                      ) : (
                        <>
                          <div className="flex items-start justify-between gap-2">
                            <button
                              type="button"
                              onClick={() => openConversation(conversation.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <div className="flex min-w-0 items-center gap-2">
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 shrink-0 rounded-full",
                                    isActive ? "bg-cyan-200" : "bg-white/20",
                                  )}
                                />
                                <p className="min-w-0 truncate text-xs font-medium text-white">
                                  {conversation.title || "Omnix conversation"}
                                </p>
                              </div>
                            </button>
                            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] text-[var(--omnix-text-3)]">
                              <Clock className="h-3 w-3" />
                              <ClientTime value={timestamp} fallback="Recently" />
                            </span>
                          </div>
                          <div className="mt-1 flex items-end gap-2">
                            <button
                              type="button"
                              onClick={() => openConversation(conversation.id)}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="line-clamp-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
                                {conversation.preview || "No messages yet"}
                              </p>
                            </button>
                            <div className="flex shrink-0 items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                disabled={isBusy}
                                onClick={() => startRename(conversation.id, conversation.title)}
                                aria-label="Rename chat"
                                title="Rename chat"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
                                disabled={isBusy}
                                onClick={() => deleteConversation(conversation.id)}
                                aria-label="Delete chat"
                                title="Delete chat"
                              >
                                {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          </div>
                        </>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4 text-center">
              <MessageSquare className="mx-auto h-5 w-5 text-cyan-200" />
              <p className="mt-3 text-sm font-medium text-white">
                {query ? "No matches" : "No conversations yet"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {query
                  ? "Try a different search term."
                  : "Start a chat and it will appear here automatically."}
              </p>
            </div>
          )}
        </section>

        <div className="relative border-t border-[rgba(0,255,255,0.07)] p-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)]">
          {/* Top beam on profile section */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.2),transparent)]" />
          <Link
            href="/settings/profile"
            onClick={onClose}
            className="group/profile flex items-center gap-2.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.03)] px-2.5 py-2.5 transition duration-200 hover:border-[rgba(0,255,255,0.2)] hover:bg-[rgba(0,255,255,0.06)] hover:shadow-[var(--omnix-glow-xs)]"
          >
            <div className="relative shrink-0">
              <ProfileAvatar
                name={displayName}
                email={displayEmail}
                handle={displayHandle}
                avatarUrl={profile?.avatar_url}
                className="h-8 w-8 border-cyan-300/35 bg-cyan-300/12 text-xs text-cyan-50 shadow-[0_0_12px_rgba(0,255,255,0.25)]"
              />
              {/* Pulsing online dot */}
              <span className="omnix-online-dot absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-[2px] border-[rgba(5,12,23,0.98)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{displayName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
                <span className="font-medium text-[var(--omnix-green)]">{displayHandle ? `@${displayHandle}` : "Online"}</span>
              </div>
            </div>
            <span className="text-[var(--omnix-text-3)] opacity-40 transition group-hover/profile:opacity-70">›</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
