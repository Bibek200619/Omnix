"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
  Edit3,
  FileText,
  Globe2,
  LayoutDashboard,
  Layers3,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Network,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { Input } from "@/components/ui/Input";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useProfile } from "@/lib/profile-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import { PendingWorkspaceInvites } from "@/components/workspace/PendingWorkspaceInvites";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import type { Workspace } from "@/lib/workspace-types";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/workspace", label: "Workspaces", icon: Layers3 },
  { href: "/team", label: "Team", icon: Users },
  { href: "/sources", label: "Sources", icon: FileText },
  { href: "/analytics", label: "Analytics", icon: BarChart2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

function workspaceTypeLabel(workspace?: Workspace | null) {
  if (!workspace) return null;
  if (workspace.is_global) return "Global";
  if (workspace.workspace_type === "super") return "Super";
  if (workspace.workspace_type === "sub") return "Team";
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
  if (workspace.workspace_type === "super") return Layers3;
  return Users;
}

function WorkspaceSelector() {
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
  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showCreateSubspaceModal, setShowCreateSubspaceModal] = useState(false);
  const [newSubspaceName, setNewSubspaceName] = useState("");
  const [creatingSubspace, setCreatingSubspace] = useState(false);
  const [createSubspaceError, setCreateSubspaceError] = useState<string | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());

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
    activeRootWorkspace?.workspace_type === "super" ? activeRootWorkspace : null;
  const canCreateSubspace = Boolean(
    activeSuperWorkspace && isWorkspaceFounderRole(activeSuperWorkspace.current_user_role),
  );

  useEffect(() => {
    if (!activeRootWorkspace?.id || activeRootWorkspace.workspace_type !== "super") {
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
    const shouldRefresh = !expandedWorkspaceIds.has(workspace.id) && workspace.workspace_type === "super";
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
      const created = await createWorkspace({ name: newWorkspaceName.trim(), workspace_type: "super" });
      setActiveWorkspace(created.id);
      setNewWorkspaceName("");
      setShowCreateForm(false);
      setOpen(false);
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

  async function handleInvite(target: string, role: "co_owner" | "member") {
    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
      setOpen(false);
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
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Unable to delete workspace");
    } finally {
      setDeleting(false);
    }
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspace(workspaceId);
    setOpen(false);
  }

  function renderSubspaceRow(subspace: Workspace, index: number) {
    const Icon = workspaceIcon(subspace);
    const isActive = subspace.id === activeWorkspaceId;

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
          "relative my-0.5 flex min-h-9 w-full items-center gap-2 rounded-[7px] px-2.5 py-1.5 text-left transition",
          isActive
            ? "bg-cyan-300/[0.08] text-white"
            : "text-[var(--omnix-text-2)] hover:bg-[var(--omnix-surface)] hover:text-white",
        )}
      >
        {isActive ? (
          <span className="absolute left-0 h-5 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" />
        ) : null}
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border",
            subspace.is_global
              ? "border-amber-300/25 bg-amber-400/10 text-amber-200"
              : "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-xs", isActive && "font-medium text-cyan-200")}>
              {subspace.name}
            </span>
            <WorkspaceTypeBadge workspace={subspace} />
          </span>
        </span>
        {isActive ? <Check className="h-3.5 w-3.5 shrink-0 text-cyan-300" /> : null}
      </motion.button>
    );
  }

  function renderWorkspaceTree(workspace: Workspace, index: number) {
    const Icon = workspaceIcon(workspace);
    const expanded = isExpanded(workspace.id);
    const isActive = workspace.id === activeWorkspaceId;
    const hasHierarchy = workspace.workspace_type === "super";
    const subspaces = workspace.subspaces ?? [];
    const subspacesLoading = Boolean(subspaceLoadingByParentId[workspace.id]);
    const subspacesError = subspaceErrorByParentId[workspace.id];

    return (
      <motion.div
        key={workspace.id}
        layout
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.12, delay: index * 0.02 }}
      >
        <div className="flex items-stretch gap-1 px-1">
          {hasHierarchy ? (
            <button
              type="button"
              onClick={() => toggleExpanded(workspace)}
              className="flex h-10 w-7 shrink-0 items-center justify-center rounded-[7px] text-[var(--omnix-text-3)] transition hover:bg-[var(--omnix-surface)] hover:text-white"
              aria-label={expanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
              title={expanded ? `Collapse ${workspace.name}` : `Expand ${workspace.name}`}
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
            </button>
          ) : (
            <span className="h-10 w-7 shrink-0" />
          )}

          <button
            type="button"
            onClick={() => selectWorkspace(workspace.id)}
            className={cn(
              "relative flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2.5 py-2 text-left transition",
              isActive
                ? "bg-cyan-300/[0.08]"
                : "hover:bg-[var(--omnix-surface)]",
            )}
          >
            {isActive ? (
              <span className="absolute left-0 h-5 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" />
            ) : null}
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-cyan-300/30 bg-cyan-300/15 text-cyan-100">
              <Icon className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-white">
                <span className="truncate">{workspace.name}</span>
                <WorkspaceTypeBadge workspace={workspace} />
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
                <span>{workspace.member_count} {workspace.member_count === 1 ? "member" : "members"}</span>
                <span className="h-1 w-1 rounded-full bg-white/15" />
                <span className={cn("rounded-full border px-1.5 py-0.5", workspaceRoleBadgeClass(workspace.current_user_role))}>
                  {workspaceRoleLabel(workspace.current_user_role)}
                </span>
              </span>
            </span>
            {isActive ? <Check className="h-4 w-4 shrink-0 text-cyan-300" /> : null}
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
  const canEditActiveWorkspace = canManageActive && !active?.is_global;
  const ActiveWorkspaceIcon = active ? workspaceIcon(active) : Layers3;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-between gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-[11px] py-[9px] text-left transition duration-200 hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)]"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-[9px]">
          <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] border border-cyan-300/35 bg-cyan-300/15 text-[var(--omnix-cyan)] shadow-[0_0_8px_rgba(0,255,255,0.2)]">
            <ActiveWorkspaceIcon className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium leading-tight text-[var(--omnix-text)]">
              <span className="truncate">{active ? active.name : "No workspace selected"}</span>
              <WorkspaceTypeBadge workspace={active} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
              <span>{active ? workspaceRoleLabel(active.current_user_role) : "Workspace hierarchy"}</span>
              {active ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-cyan-200/20" />
                  <span>{active.member_count} {active.member_count === 1 ? "member" : "members"}</span>
                </>
              ) : null}
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
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="omnix-floating-card absolute left-0 top-full z-50 mt-1 w-full overflow-hidden"
          >
            <div className="max-h-[22rem] overflow-y-auto py-1">
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

            {createError && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="border-t border-white/6 px-3 py-2"
              >
                <div className="rounded-md border border-rose-400/25 bg-rose-400/10 p-2 text-xs text-rose-100">
                  {createError}
                </div>
              </motion.div>
            )}

            <div className="border-t border-[var(--omnix-border)] p-[5px]">
              <div className="space-y-2">
                {canManageActive ? (
                  <>
                    {canEditActiveWorkspace ? (
                      <div className="grid grid-cols-2 gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full justify-start"
                          leftIcon={<Edit3 className="h-3.5 w-3.5" />}
                          onClick={openRenameWorkspace}
                        >
                          Rename
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          className="w-full justify-start"
                          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                          onClick={openDeleteWorkspace}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full justify-start"
                      leftIcon={<UserPlus className="h-3.5 w-3.5" />}
                      onClick={() => {
                        setInviteError(null);
                        setInviteOpen(true);
                      }}
                    >
                      Invite teammate
                    </Button>
                  </>
                ) : null}

                {showCreateForm ? (
                  <motion.form
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.16 }}
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleCreate();
                    }}
                    className="space-y-2"
                  >
                    <Input
                      value={newWorkspaceName}
                      onChange={(e) => {
                        setNewWorkspaceName(e.target.value);
                        setCreateError(null);
                      }}
                      placeholder="Super workspace name"
                      autoFocus
                      disabled={creatingWorkspace}
                      className="h-9 rounded-md"
                    />
                    <div className="flex gap-2">
                      <Button
                        type="submit"
                        size="sm"
                        disabled={!newWorkspaceName.trim() || creatingWorkspace}
                        className="flex-1"
                      >
                        {creatingWorkspace ? "Creating" : "Create"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={handleCancel}
                        disabled={creatingWorkspace}
                        className="flex-1"
                      >
                        Cancel
                      </Button>
                    </div>
                  </motion.form>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCreateForm(true)}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-[var(--omnix-border-2)] bg-transparent px-2 py-1.5 text-[11px] font-medium text-[var(--omnix-text-3)] transition hover:bg-[var(--omnix-surface)] hover:text-[var(--omnix-cyan)]"
                  >
                    <Plus className="h-4 w-4" />
                    New super workspace
                  </button>
                )}

                {canCreateSubspace ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCreateSubspaceError(null);
                      setShowCreateSubspaceModal(true);
                    }}
                    className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-[11px] font-medium text-emerald-300/85 transition hover:bg-emerald-500/10 hover:text-emerald-200"
                  >
                    <Plus className="h-4 w-4" />
                    New team subspace
                  </button>
                ) : null}
              </div>
            </div>
          </motion.div>
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
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
          Hierarchy
        </p>
        <button
          type="button"
          onClick={() => {
            router.push("/workspace");
            onClose();
          }}
          className="text-[10px] font-semibold text-[var(--omnix-cyan)] transition hover:text-white"
        >
          Manage
        </button>
      </div>
      <div className="omnix-tree-card px-2.5 py-2.5">
        <button
          type="button"
          onClick={() => {
            router.push("/workspace");
            onClose();
          }}
          className="relative z-10 flex w-full items-center gap-2 rounded-[8px] border border-cyan-300/18 bg-cyan-300/[0.055] px-2 py-2 text-left shadow-[var(--omnix-glow-xs)] transition hover:bg-cyan-300/[0.08]"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-cyan-300/30 bg-cyan-300/12 text-[11px] font-bold text-[var(--omnix-cyan)]">
            {(activeWorkspace?.name || "O").charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-semibold text-white">
              {activeWorkspace?.name || "No workspace"}
            </span>
            <span className={cn("mt-0.5 inline-flex rounded-full border px-1.5 py-px text-[9px] font-semibold", workspaceRoleBadgeClass(activeWorkspace?.current_user_role))}>
              {workspaceRoleLabel(activeWorkspace?.current_user_role)}
            </span>
          </span>
          <Network className="h-3.5 w-3.5 text-[var(--omnix-text-3)]" />
        </button>
        <div className="relative z-10 ml-5 mt-2 border-l border-cyan-300/15 pl-3">
          {spaces.map((space) => (
            <button
              key={space.label}
              type="button"
              onClick={() => {
                router.push(space.label === "Knowledge" ? "/sources" : space.label === "Team" ? "/team" : "/workspace");
                onClose();
              }}
              className="group relative mb-1.5 flex w-full items-center gap-2 rounded-[7px] border border-transparent px-2 py-1.5 text-left transition hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]"
            >
              <span
                className="absolute -left-[13px] top-1/2 h-px w-3 -translate-y-1/2"
                style={{ background: "rgba(0,255,255,0.16)" }}
              />
              <span
                className="h-2 w-2 shrink-0 rounded-full shadow-[0_0_8px_currentColor]"
                style={{ background: space.color, color: space.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[11px] font-medium text-[var(--omnix-text-2)] group-hover:text-white">
                  {space.label}
                </span>
                <span className="block truncate text-[10px] text-[var(--omnix-text-3)]">
                  {space.meta}
                </span>
              </span>
              {space.count ? (
                <span className="rounded-full border border-white/8 bg-white/[0.035] px-1.5 py-px text-[9px] text-[var(--omnix-text-3)]">
                  {space.count}
                </span>
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
          "fixed inset-y-0 left-0 z-50 flex w-[var(--omnix-sidebar-w)] flex-col overflow-hidden border-r border-[var(--omnix-border)] bg-[linear-gradient(180deg,rgba(5,12,23,0.99),rgba(4,10,20,0.998))] shadow-[20px_0_100px_rgba(0,0,0,0.5),4px_0_30px_rgba(0,255,255,0.04)] backdrop-blur-2xl transition-transform duration-200 ease-out",
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
                  <span className="omnix-display block text-base font-bold uppercase leading-tight tracking-[0.06em] text-white drop-shadow-[0_0_12px_rgba(0,255,255,0.45)]">OMNIX</span>
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
              <WorkspaceSelector />
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

        <div className="relative border-t border-[rgba(0,255,255,0.07)] p-2.5">
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
