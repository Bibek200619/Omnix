"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Check, Edit3, Plus, Settings, Trash2, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Tooltip } from "@/components/ui/Tooltip";
import type { Workspace } from "@/lib/workspace-types";

type SidebarModalsProps = {
  active: Workspace;
  activeSuperWorkspace: Workspace | null;
  createOpen: boolean;
  creatingSubspace: boolean;
  createSubspaceError: string | null;
  newSubspaceName: string;
  onNewSubspaceNameChange: (value: string) => void;
  onCloseCreate: () => void;
  onCreateSubspace: () => void;
  renameOpen: boolean;
  renaming: boolean;
  renameError: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCloseRename: () => void;
  onRenameWorkspace: () => void;
  deleteOpen: boolean;
  deleting: boolean;
  deleteError: string | null;
  deleteConfirmText: string;
  onDeleteConfirmTextChange: (value: string) => void;
  onCloseDelete: () => void;
  onDeleteWorkspace: () => void;
};

export function SidebarModals({
  active,
  activeSuperWorkspace,
  createOpen,
  creatingSubspace,
  createSubspaceError,
  newSubspaceName,
  onNewSubspaceNameChange,
  onCloseCreate,
  onCreateSubspace,
  renameOpen,
  renaming,
  renameError,
  renameDraft,
  onRenameDraftChange,
  onCloseRename,
  onRenameWorkspace,
  deleteOpen,
  deleting,
  deleteError,
  deleteConfirmText,
  onDeleteConfirmTextChange,
  onCloseDelete,
  onDeleteWorkspace,
}: SidebarModalsProps) {
  return (
    <>
      {activeSuperWorkspace ? (
        <Modal
          isOpen={createOpen}
          onClose={onCloseCreate}
          title="Create team subspace"
          description={`Add a team space under ${activeSuperWorkspace.name}.`}
          closeDisabled={creatingSubspace}
          className="max-w-md p-5"
        >
          <WorkspaceModalHeader
            title="Create team subspace"
            description={<>Add a team space under <span className="font-medium text-slate-200">{activeSuperWorkspace.name}</span>.</>}
            icon={<Users className="h-4 w-4" />}
            tone="emerald"
            closeLabel="Close create subspace modal"
            onClose={onCloseCreate}
            disabled={creatingSubspace}
          />
          <form
            className="relative z-10 mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              onCreateSubspace();
            }}
          >
            <Input
              id="workspace-subspace-create"
              label="Subspace name"
              value={newSubspaceName}
              onChange={(event) => onNewSubspaceNameChange(event.target.value)}
              placeholder="Design Team"
              disabled={creatingSubspace}
              autoFocus
            />
            {createSubspaceError ? <ModalError>{createSubspaceError}</ModalError> : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCloseCreate} disabled={creatingSubspace}>
                Cancel
              </Button>
              <Button type="submit" leftIcon={<Plus className="h-4 w-4" />} isLoading={creatingSubspace} disabled={!newSubspaceName.trim()}>
                Create
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      <Modal
        isOpen={renameOpen}
        onClose={onCloseRename}
        title="Rename workspace"
        description="Update the visible name for this workspace."
        closeDisabled={renaming}
        className="max-w-md p-5"
      >
        <WorkspaceModalHeader
          title="Rename workspace"
          description="Update the visible name for this workspace."
          icon={<Edit3 className="h-4 w-4" />}
          tone="cyan"
          closeLabel="Close rename modal"
          onClose={onCloseRename}
          disabled={renaming}
        />
        <form
          className="relative z-10 mt-5 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onRenameWorkspace();
          }}
        >
          <Input
            id="workspace-rename"
            label="Workspace name"
            value={renameDraft}
            onChange={(event) => onRenameDraftChange(event.target.value)}
            disabled={renaming}
            autoFocus
          />
          {renameError ? <ModalError>{renameError}</ModalError> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCloseRename} disabled={renaming}>
              Cancel
            </Button>
            <Button type="submit" leftIcon={<Check className="h-4 w-4" />} isLoading={renaming} disabled={!renameDraft.trim()}>
              Save
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={deleteOpen}
        onClose={onCloseDelete}
        title="Delete workspace"
        description={`Permanently remove ${active.name} from the workspace list and active session.`}
        role="alertdialog"
        closeDisabled={deleting}
        className="max-w-md border-rose-400/25 p-5 shadow-[0_24px_80px_var(--omnix-rgba-0-0-0-0-5),0_0_24px_var(--omnix-rgba-244-63-94-0-14)]"
      >
        <WorkspaceModalHeader
          title="Delete workspace"
          description={<>This removes <span className="font-medium text-slate-200">{active.name}</span> from the workspace list and clears it from the active session.</>}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone="rose"
          closeLabel="Close delete modal"
          onClose={onCloseDelete}
          disabled={deleting}
        />
        <div className="relative z-10 mt-5 space-y-4">
          <Input
            id="workspace-delete-confirm"
            label={`Type "${active.name}" to confirm`}
            value={deleteConfirmText}
            onChange={(event) => onDeleteConfirmTextChange(event.target.value)}
            disabled={deleting}
            autoFocus
          />
          {deleteError ? <ModalError>{deleteError}</ModalError> : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCloseDelete} disabled={deleting}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              leftIcon={<Trash2 className="h-4 w-4" />}
              isLoading={deleting}
              disabled={deleteConfirmText !== active.name}
              onClick={onDeleteWorkspace}
            >
              Delete workspace
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

type WorkspaceManagementActionsProps = {
  canManageActive: boolean;
  canCreateSubspace: boolean;
  showManageActions: boolean;
  showCreateForm: boolean;
  createError: string | null;
  creatingWorkspace: boolean;
  newWorkspaceName: string;
  onNewWorkspaceNameChange: (value: string) => void;
  onCreateWorkspace: () => void;
  onCancelCreate: () => void;
  onOpenCreate: () => void;
  onOpenSubspace: () => void;
  onOpenRename: () => void;
  onOpenDelete: () => void;
  onOpenInvite: () => void;
  onShowManageActionsChange: (value: boolean) => void;
};

export function WorkspaceManagementActions({
  canManageActive,
  canCreateSubspace,
  showManageActions,
  showCreateForm,
  createError,
  creatingWorkspace,
  newWorkspaceName,
  onNewWorkspaceNameChange,
  onCreateWorkspace,
  onCancelCreate,
  onOpenCreate,
  onOpenSubspace,
  onOpenRename,
  onOpenDelete,
  onOpenInvite,
  onShowManageActionsChange,
}: WorkspaceManagementActionsProps) {
  return (
    <div className="border-t border-white/5 bg-black/10 p-2">
      {showManageActions ? (
        <div className="omnix-shell-expand-enter space-y-2 pb-2">
          {createError ? (
            <div className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-200">{createError}</div>
          ) : null}

          {canManageActive ? (
            <div className="grid grid-cols-2 gap-1.5 px-1">
              <Button type="button" variant="ghost" size="sm" className="h-11 justify-start text-[9px] uppercase tracking-wider text-white/40 hover:text-white" leftIcon={<Edit3 className="h-3 w-3" />} onClick={onOpenRename}>
                Rename
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-11 justify-start text-[9px] uppercase tracking-wider text-rose-400/50 hover:text-rose-400" leftIcon={<Trash2 className="h-3 w-3" />} onClick={onOpenDelete}>
                Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" className="col-span-2 h-11 justify-start text-[9px] uppercase tracking-wider text-white/40 hover:text-white" leftIcon={<UserPlus className="h-3 w-3" />} onClick={onOpenInvite}>
                Manage Members
              </Button>
            </div>
          ) : null}

          <div className="space-y-1 px-1">
            {showCreateForm ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  onCreateWorkspace();
                }}
                className="space-y-1.5"
              >
                <Input value={newWorkspaceName} onChange={(event) => onNewWorkspaceNameChange(event.target.value)} placeholder="Workspace name" autoFocus disabled={creatingWorkspace} className="h-7 rounded-md text-[11px]" />
                <div className="flex gap-1.5">
                  <Button type="submit" size="sm" disabled={!newWorkspaceName.trim() || creatingWorkspace} className="h-11 flex-1 text-[10px]">
                    {creatingWorkspace ? "..." : "Create"}
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={onCancelCreate} disabled={creatingWorkspace} className="h-11 flex-1 text-[10px]">
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={onOpenCreate} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-[9px] font-medium uppercase tracking-wider text-cyan-400/60 transition hover:bg-cyan-400/10 hover:text-cyan-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
                <Plus className="h-3 w-3" /> New Workspace
              </button>
            )}
            {canCreateSubspace ? (
              <button type="button" onClick={onOpenSubspace} className="flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-[9px] font-medium uppercase tracking-wider text-emerald-400/60 transition hover:bg-emerald-400/10 hover:text-emerald-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
                <Plus className="h-3 w-3" /> New Subspace
              </button>
            ) : null}
          </div>

          <button type="button" onClick={() => onShowManageActionsChange(false)} className="min-h-11 w-full rounded-md px-3 text-[8px] font-bold uppercase tracking-[0.2em] text-white/10 transition-colors hover:bg-white/5 hover:text-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
            Close Settings
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => onShowManageActionsChange(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-[9px] font-bold uppercase tracking-[0.2em] text-white/20 transition hover:bg-white/5 hover:text-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
          <Settings className="h-3 w-3" /> Workspace Management
        </button>
      )}
    </div>
  );
}

function WorkspaceModalHeader({
  title,
  description,
  icon,
  tone,
  closeLabel,
  onClose,
  disabled,
}: {
  title: string;
  description: ReactNode;
  icon: ReactNode;
  tone: "cyan" | "emerald" | "rose";
  closeLabel: string;
  onClose: () => void;
  disabled: boolean;
}) {
  const toneClass =
    tone === "emerald"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
      : tone === "rose"
        ? "border-rose-300/30 bg-rose-400/10 text-rose-100"
        : "border-cyan-300/25 bg-cyan-300/10 text-cyan-200";

  return (
    <div className="relative z-10 flex items-start justify-between gap-4">
      <div>
        <div className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border shadow-[var(--omnix-glow-xs)] ${toneClass}`}>
          {icon}
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">{description}</p>
      </div>
      <Tooltip content={closeLabel}>
        <Button
          type="button"
          variant="ghost"
          size={"icon"}
          className="h-11 w-11"
          aria-label={closeLabel}
          title={closeLabel}
          onClick={onClose}
          disabled={disabled}
        >
          <X className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
  );
}

function ModalError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
      {children}
    </div>
  );
}
