"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { FloatingMenuLayer } from "@/components/ui/FloatingMenuLayer";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";
import { logClientError } from "@/lib/errors";
import { useFocusTrap } from "@/lib/use-focus-trap";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceMembership } from "@/lib/workspace-membership-context";
import { useWorkspaceTree } from "@/lib/workspace-tree-context";
import { cn } from "@/lib/utils";
import { isWorkspaceFounderRole, workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { Workspace, WorkspaceRole } from "@/lib/workspace-types";
import { SidebarModals, WorkspaceManagementActions } from "./SidebarModals";
import { WorkspaceTypeBadge, workspaceIcon } from "./WorkspaceHierarchyMini";
import { WorkspaceListState } from "./WorkspaceTreeNode";

type WorkspaceSelectorProps = {
  onWorkspaceSelect?: () => void;
};

export function WorkspaceSelector({ onWorkspaceSelect }: WorkspaceSelectorProps) {
  const {
    workspaces,
    loading,
    error: workspaceError,
    activeWorkspace,
    activeRootWorkspace,
    setActiveWorkspace,
    refreshWorkspaces,
    createWorkspace,
    createSubspace,
    renameWorkspace,
    deleteWorkspace,
  } = useWorkspaceTree();
  const { pendingInvites, inviteToActiveWorkspace } = useWorkspaceMembership();
  const { presence, statusForWorkspace, realtimeStatus } = useWorkspaceCollaboration();
  const [open, setOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement | null>(null);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(() => new Set());
  const [showManageActions, setShowManageActions] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [showCreateSubspaceModal, setShowCreateSubspaceModal] = useState(false);
  const [newSubspaceName, setNewSubspaceName] = useState("");
  const [creatingSubspace, setCreatingSubspace] = useState(false);
  const [createSubspaceError, setCreateSubspaceError] = useState<string | null>(null);
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
  const workspaceModalOpen = showCreateSubspaceModal || inviteOpen || renameOpen || deleteOpen;
  const selectorMenuRef = useFocusTrap<HTMLDivElement>(open && !workspaceModalOpen);

  const active = activeWorkspace;
  const activeSuperWorkspace =
    activeRootWorkspace?.workspace_type === "super_workspace" || activeRootWorkspace?.workspace_type === "super"
      ? activeRootWorkspace
      : null;
  const canCreateSubspace = Boolean(activeSuperWorkspace && isWorkspaceFounderRole(activeSuperWorkspace.current_user_role));
  const canManageActive = isWorkspaceFounderRole(active?.current_user_role);
  const ActiveWorkspaceIcon = active ? workspaceIcon(active) : Check;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!selectorRef.current?.contains(target) && !selectorMenuRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, selectorMenuRef]);

  useEffect(() => {
    if (!activeRootWorkspace?.id || (activeRootWorkspace.workspace_type !== "super" && activeRootWorkspace.workspace_type !== "super_workspace")) return;

    setExpandedWorkspaceIds((current) => {
      if (current.has(activeRootWorkspace.id)) return current;
      const next = new Set(current);
      next.add(activeRootWorkspace.id);
      return next;
    });
  }, [activeRootWorkspace?.id, activeRootWorkspace?.workspace_type]);

  function finishWorkspaceAction() {
    setOpen(false);
    onWorkspaceSelect?.();
  }

  function selectWorkspace(workspaceId: string) {
    setActiveWorkspace(workspaceId);
    finishWorkspaceAction();
  }

  function toggleExpanded(workspace: Workspace) {
    setExpandedWorkspaceIds((current) => {
      const next = new Set(current);
      if (next.has(workspace.id)) next.delete(workspace.id);
      else next.add(workspace.id);
      return next;
    });
  }

  async function handleCreateWorkspace() {
    if (!newWorkspaceName.trim() || creatingWorkspace) return;
    try {
      setCreatingWorkspace(true);
      setCreateError(null);
      const created = await createWorkspace({ name: newWorkspaceName.trim(), workspace_type: "super_workspace" });
      setActiveWorkspace(created.id);
      setNewWorkspaceName("");
      setShowCreateForm(false);
      finishWorkspaceAction();
    } catch (err) {
      logClientError("Failed to create workspace", err, { endpoint: "/workspaces" });
      setCreateError("Unable to create workspace. Check your connection and try again.");
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
      setExpandedWorkspaceIds((current) => new Set(current).add(activeSuperWorkspace.id));
      setActiveWorkspace(created.id);
      setNewSubspaceName("");
      setShowCreateSubspaceModal(false);
      finishWorkspaceAction();
    } catch (err) {
      logClientError("Failed to create subspace", err);
      setCreateSubspaceError("Unable to create subspace. Check your connection and try again.");
    } finally {
      setCreatingSubspace(false);
    }
  }

  async function handleInvite(target: string, role: WorkspaceRole) {
    try {
      setInviting(true);
      setInviteError(null);
      await inviteToActiveWorkspace(target, role);
      setInviteOpen(false);
      finishWorkspaceAction();
    } catch (err) {
      logClientError("Failed to invite teammate", err);
      setInviteError("Unable to invite teammate. Check the email address and try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRenameWorkspace() {
    if (!active || !renameDraft.trim() || renaming) return;
    try {
      setRenaming(true);
      setRenameError(null);
      await renameWorkspace(active.id, { name: renameDraft.trim() });
      setRenameOpen(false);
      finishWorkspaceAction();
    } catch (err) {
      logClientError("Failed to rename workspace", err, { endpoint: `/workspaces/${active.id}` });
      setRenameError("Unable to rename workspace. Your session may have expired; refresh and try again.");
    } finally {
      setRenaming(false);
    }
  }

  async function handleDeleteWorkspace() {
    if (!active || deleting || deleteConfirmText !== active.name) return;
    try {
      setDeleting(true);
      setDeleteError(null);
      await deleteWorkspace(active.id);
      setDeleteOpen(false);
      finishWorkspaceAction();
    } catch (err) {
      logClientError("Failed to delete workspace", err, { endpoint: `/workspaces/${active.id}` });
      setDeleteError("Unable to delete workspace. Your session may have expired; refresh and try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div ref={selectorRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 py-3 text-left transition duration-200 hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)] sm:px-[11px] sm:py-[9px]",
          realtimeStatus === "connected" && "border-cyan-300/20",
        )}
        aria-expanded={open}
        aria-label={active ? `Switch workspace. Current workspace: ${active.name}` : "Switch workspace"}
      >
        <div className="flex min-w-0 items-center gap-3 sm:gap-[9px]">
          <div className="relative shrink-0">
            <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg border transition-all duration-300 sm:h-8 sm:w-8", open ? "border-cyan-300/40 bg-cyan-300/20 text-cyan-200" : "border-white/10 bg-white/5 text-white/40")}>
              <ActiveWorkspaceIcon className="h-4.5 w-4.5 sm:h-4 sm:w-4" />
            </div>
            {realtimeStatus === "connected" ? <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--omnix-color-060a14)] bg-[var(--omnix-green)] opacity-80" /> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-bold tracking-tight text-white sm:text-[13px]">
                {active ? active.name : "No workspace selected"}
              </span>
              <WorkspaceTypeBadge workspace={active} />
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--omnix-text-3)]">
              <Badge variant="role" className={cn("!rounded border-white/5 px-1.5 py-0.5 !text-[10px]", workspaceRoleBadgeClass(active?.current_user_role))}>
                {active ? workspaceRoleLabel(active.current_user_role) : "Workspace"}
              </Badge>
              {active ? (
                <>
                  <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
                  <span className={cn(realtimeStatus === "connected" && "text-cyan-300/80")}>
                    {presence?.active_count ?? statusForWorkspace(active.id)?.active_count ?? 0} active
                  </span>
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

      {open ? (
        <FloatingMenuLayer anchorRef={selectorRef} contentRef={selectorMenuRef} placement="bottom-start" width="anchor" minWidth={248} offset={6} zIndex={145}>
          <div className="omnix-floating-card omnix-shell-popover-enter w-full overflow-hidden">
            <div className="omnix-scrollbar overflow-y-auto py-1" style={{ maxHeight: "min(22rem, var(--omnix-floating-max-h))" }}>
              <WorkspaceListState
                loading={loading}
                error={workspaceError}
                workspaces={workspaces}
                expandedWorkspaceIds={expandedWorkspaceIds}
                onRetry={() => void refreshWorkspaces({ force: true })}
                onToggleExpanded={toggleExpanded}
                onSelectWorkspace={selectWorkspace}
              />
            </div>
            <WorkspaceManagementActions
              canManageActive={canManageActive} canCreateSubspace={canCreateSubspace}
              showManageActions={showManageActions} showCreateForm={showCreateForm}
              createError={createError} creatingWorkspace={creatingWorkspace} newWorkspaceName={newWorkspaceName}
              onNewWorkspaceNameChange={(value) => { setNewWorkspaceName(value); setCreateError(null); }}
              onCreateWorkspace={handleCreateWorkspace}
              onCancelCreate={() => { setShowCreateForm(false); setNewWorkspaceName(""); setCreateError(null); }}
              onOpenCreate={() => setShowCreateForm(true)}
              onOpenSubspace={() => { setCreateSubspaceError(null); setShowCreateSubspaceModal(true); }}
              onOpenRename={() => { if (!active) return; setRenameDraft(active.name); setRenameError(null); setRenameOpen(true); }}
              onOpenDelete={() => { setDeleteConfirmText(""); setDeleteError(null); setDeleteOpen(true); }}
              onOpenInvite={() => { setInviteError(null); setInviteOpen(true); }}
              onShowManageActionsChange={setShowManageActions}
            />
          </div>
        </FloatingMenuLayer>
      ) : null}

      {active ? (
        <>
          <WorkspaceInviteModal open={inviteOpen} workspaceName={active.name} loading={inviting} error={inviteError} allowRoleSelection={isWorkspaceFounderRole(active.current_user_role)} onClose={() => setInviteOpen(false)} onSubmit={handleInvite} />
          <SidebarModals
            active={active} activeSuperWorkspace={activeSuperWorkspace}
            createOpen={showCreateSubspaceModal} creatingSubspace={creatingSubspace}
            createSubspaceError={createSubspaceError} newSubspaceName={newSubspaceName}
            onNewSubspaceNameChange={(value) => { setNewSubspaceName(value); setCreateSubspaceError(null); }}
            onCloseCreate={() => { setShowCreateSubspaceModal(false); setNewSubspaceName(""); setCreateSubspaceError(null); }}
            onCreateSubspace={handleCreateSubspace}
            renameOpen={renameOpen} renaming={renaming} renameError={renameError} renameDraft={renameDraft}
            onRenameDraftChange={(value) => { setRenameDraft(value); setRenameError(null); }}
            onCloseRename={() => setRenameOpen(false)} onRenameWorkspace={handleRenameWorkspace}
            deleteOpen={deleteOpen} deleting={deleting} deleteError={deleteError} deleteConfirmText={deleteConfirmText}
            onDeleteConfirmTextChange={(value) => { setDeleteConfirmText(value); setDeleteError(null); }}
            onCloseDelete={() => setDeleteOpen(false)} onDeleteWorkspace={handleDeleteWorkspace}
          />
        </>
      ) : null}
    </div>
  );
}
