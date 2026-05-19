"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  Edit3,
  FileText,
  History,
  LayoutDashboard,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
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
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "AI Chat", icon: MessageSquare },
  { href: "/files", label: "Sources", icon: FileText },
  { href: "/history", label: "History", icon: History },
  { href: "/settings/team", label: "Team", icon: Users },
  { href: "/settings/profile", label: "Settings", icon: Settings },
];

function WorkspaceSelector() {
  const {
    workspaces,
    loading,
    activeWorkspaceId,
    activeWorkspace,
    pendingInvites,
    setActiveWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    inviteToActiveWorkspace,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
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

  const active = activeWorkspace || workspaces.find((w) => w.id === activeWorkspaceId) || null;

  async function handleCreate() {
    if (!newWorkspaceName.trim() || creatingWorkspace) return;
    try {
      setCreatingWorkspace(true);
      setCreateError(null);
      const created = await createWorkspace({ name: newWorkspaceName.trim() });
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center justify-between gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-[11px] py-[9px] text-left transition duration-200 hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)]"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-[9px]">
          <div className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] border border-cyan-300/35 bg-cyan-300/15 text-[11px] font-bold text-[var(--omnix-cyan)] shadow-[0_0_8px_rgba(0,255,255,0.2)]">
            {active ? active.name.charAt(0).toUpperCase() : "M"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium leading-tight text-[var(--omnix-text)]">{active ? active.name : "No workspace selected"}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
              <span>{workspaceRoleLabel(active?.current_user_role)} Plan</span>
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
            <div className="max-h-64 overflow-y-auto py-1">
              {loading ? (
                <div className="px-3 py-3 text-xs text-slate-500">Loading workspaces…</div>
              ) : workspaces.length === 0 ? (
                <div className="px-3 py-4 text-sm text-slate-400">No workspaces yet</div>
              ) : (
                <AnimatePresence mode="popLayout">
                  {workspaces.map((ws, index) => (
                    <motion.button
                      key={ws.id}
                      layout
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.12, delay: index * 0.02 }}
                      onClick={() => {
                        setActiveWorkspace(ws.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "relative flex w-full items-center gap-2 px-[11px] py-2 text-left transition",
                        ws.id === activeWorkspaceId
                          ? "bg-cyan-300/[0.06]"
                          : "hover:bg-[var(--omnix-surface)]",
                      )}
                    >
                      {ws.id === activeWorkspaceId ? (
                        <span className="absolute left-0 h-5 w-0.5 rounded-full bg-cyan-300 shadow-[var(--omnix-glow-sm)]" />
                      ) : null}
                      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[5px] border border-cyan-300/30 bg-cyan-300/15 text-[10px] font-semibold text-cyan-100">{ws.name.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-white">{ws.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
                          <span>{ws.member_count} {ws.member_count === 1 ? "member" : "members"}</span>
                          <span className="h-1 w-1 rounded-full bg-white/15" />
                          <span className={cn("rounded-full border px-1.5 py-0.5", workspaceRoleBadgeClass(ws.current_user_role))}>
                            {workspaceRoleLabel(ws.current_user_role)}
                          </span>
                        </div>
                        {ws.description && <div className="mt-0.5 truncate text-[10px] text-[var(--omnix-text-3)]">{ws.description}</div>}
                      </div>
                      <WorkspaceMemberStack members={ws.members_preview} totalCount={ws.member_count} className="hidden sm:flex" />
                      {ws.id === activeWorkspaceId && (
                        <Check className="h-4 w-4 shrink-0 text-cyan-300" />
                      )}
                    </motion.button>
                  ))}
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
                {isWorkspaceFounderRole(active?.current_user_role) ? (
                  <>
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
                      placeholder="Workspace name"
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
                        {creatingWorkspace ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            Creating
                          </>
                        ) : (
                          "Create"
                        )}
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
                    New workspace
                  </button>
                )}
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
          {renameOpen ? (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-[var(--omnix-border-2)] bg-[#07131f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.48),var(--omnix-glow-xs)]">
                <div className="flex items-start justify-between gap-4">
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
                  className="mt-5 space-y-4"
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
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl border border-rose-400/25 bg-[#07131f] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5),0_0_24px_rgba(244,63,94,0.14)]">
                <div className="flex items-start justify-between gap-4">
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

                <div className="mt-5 space-y-4">
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
          "fixed inset-y-0 left-0 z-50 flex w-[var(--omnix-sidebar-w)] flex-col border-r border-[var(--omnix-border)] bg-[rgba(5,12,23,0.98)] backdrop-blur-2xl transition-transform duration-200 ease-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:-translate-x-full" : "lg:translate-x-0",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[radial-gradient(ellipse_at_50%_-10%,rgba(0,255,255,0.09)_0%,transparent_70%)]" />
        <div className="relative flex h-auto items-start justify-between border-b border-[var(--omnix-border)] px-[18px] pb-3.5 pt-[18px]">
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <Link
                href="/chat"
                onClick={onClose}
                className="flex items-center gap-2.5"
              >
                <OmnixMark size={34} />
                <div>
                  <span className="omnix-display block text-base font-bold uppercase leading-tight tracking-[0.06em] text-white">OMNIX</span>
                  <span className="text-[10px] leading-tight tracking-[0.05em] text-[var(--omnix-text-3)]">AI Workspace</span>
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

        <nav className="relative flex-1 space-y-1 px-2.5 py-3">
          <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">Navigation</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/settings/profile"
                ? pathname.startsWith("/settings") && !pathname.startsWith("/settings/team")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "relative mb-px flex items-center gap-2.5 rounded-[var(--omnix-radius-sm)] border px-2.5 py-2 text-[13px] transition duration-150",
                  isActive
                    ? "border-cyan-300/20 bg-cyan-300/[0.08] font-medium text-white shadow-[var(--omnix-glow-xs)]"
                    : "border-transparent font-normal text-[var(--omnix-text-2)] hover:bg-[var(--omnix-surface)] hover:text-white",
                )}
              >
                {isActive ? <span className="omnix-active-rail" /> : null}
                <Icon className={cn("h-[18px] w-[18px]", isActive ? "text-[var(--omnix-cyan)]" : "text-[var(--omnix-text-3)]")} />
                {item.label}
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

        <div className="relative border-t border-[var(--omnix-border)] p-2.5">
          <Link
            href="/settings/profile"
            onClick={onClose}
            className="flex items-center gap-2 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-2 transition duration-200 hover:border-[var(--omnix-border-2)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)]"
          >
            <ProfileAvatar
              name={displayName}
              email={displayEmail}
              handle={displayHandle}
              avatarUrl={profile?.avatar_url}
              className="h-8 w-8 border-cyan-300/30 bg-cyan-300/12 text-xs text-cyan-50 shadow-[var(--omnix-glow-xs)]"
            />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{displayName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--omnix-green)] shadow-[0_0_6px_var(--omnix-green)]" />
                {displayHandle ? `@${displayHandle}` : "Online"}
              </div>
            </div>
            <span className="text-[var(--omnix-text-3)]">...</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
