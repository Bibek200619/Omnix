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
  Globe2,
  History,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
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
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { Input } from "@/components/ui/Input";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";
import { PendingWorkspaceInvites } from "@/components/workspace/PendingWorkspaceInvites";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { WorkspaceInviteModal } from "@/components/workspace/WorkspaceInviteModal";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/history", label: "History", icon: History },
  { href: "/settings/workspace", label: "Settings", icon: Settings },
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
        className="group flex w-full items-center justify-between gap-2 rounded-lg border border-white/12 bg-white/[0.055] px-2.5 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.045),0_10px_28px_rgba(0,0,0,0.18)] transition hover:border-cyan-300/30 hover:bg-white/[0.08]"
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-300/10 text-xs font-semibold text-cyan-100">
            {active ? active.name.charAt(0).toUpperCase() : "M"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-white">{active ? active.name : "No workspace selected"}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
              <span>{workspaceRoleLabel(active?.current_user_role)}</span>
              {active ? (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/20" />
                  <span>{active.member_count} {active.member_count === 1 ? "member" : "members"}</span>
                  <span className="h-1 w-1 rounded-full bg-white/20" />
                  <span className="inline-flex items-center gap-1">
                    {active.is_shared ? <Users className="h-3 w-3" /> : <Globe2 className="h-3 w-3" />}
                    {active.is_shared ? "Shared" : "Solo"}
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
          <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform duration-200 group-hover:text-slate-300", open && "rotate-180")} />
        </div>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute left-0 top-full z-50 mt-2 w-full overflow-hidden rounded-lg border border-white/10 bg-[#05070b]/98 shadow-[0_18px_60px_rgba(0,0,0,0.55)] ring-1 ring-black/30 backdrop-blur-xl"
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
                        "relative flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition",
                        ws.id === activeWorkspaceId
                          ? "bg-cyan-300/10"
                          : "hover:bg-white/[0.06]",
                      )}
                    >
                      {ws.id === activeWorkspaceId ? (
                        <span className="absolute left-0 h-5 w-0.5 rounded-full bg-cyan-300" />
                      ) : null}
                      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.045] text-[11px] font-semibold text-white">{ws.name.charAt(0).toUpperCase()}</div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-white">{ws.name}</div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-slate-500">
                          <span>{ws.member_count} {ws.member_count === 1 ? "member" : "members"}</span>
                          <span className="h-1 w-1 rounded-full bg-white/15" />
                          <span className={cn("rounded-full border px-1.5 py-0.5", workspaceRoleBadgeClass(ws.current_user_role))}>
                            {workspaceRoleLabel(ws.current_user_role)}
                          </span>
                        </div>
                        {ws.description && <div className="mt-0.5 truncate text-[11px] text-slate-500">{ws.description}</div>}
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

            <div className="border-t border-white/8 p-2.5">
              <div className="space-y-2">
                {active?.current_user_role === "owner" ? (
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
                    className="flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-white/12 bg-white/[0.035] px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-cyan-300/30 hover:bg-cyan-300/10 hover:text-cyan-100"
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
            allowRoleSelection={active.current_user_role === "owner"}
            onClose={() => setInviteOpen(false)}
            onSubmit={handleInvite}
          />
          {renameOpen ? (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-lg border border-white/10 bg-[#071017] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200">
                      <Edit3 className="h-4 w-4" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold text-white">Rename workspace</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
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
              <div className="w-full max-w-md rounded-lg border border-rose-400/25 bg-[#071017] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-rose-300/30 bg-rose-400/10 text-rose-100">
                      <AlertTriangle className="h-4 w-4" />
                    </div>
                    <h2 className="mt-4 text-lg font-semibold text-white">Delete workspace</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
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

export function Sidebar({ isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
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

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;

    return conversations.filter((conversation) => {
      const title = conversation.title || "Untitled conversation";
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
    setDraftTitle(title || "Untitled conversation");
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
          "fixed inset-y-0 left-0 z-50 flex w-[17rem] flex-col border-r border-white/10 bg-[#080a0f]/98 shadow-[24px_0_80px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform duration-200 ease-out",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:-translate-x-full" : "lg:translate-x-0",
        )}
      >
        <div className="flex h-auto items-start justify-between border-b border-white/10 px-4 py-3">
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <Link
                href="/chat"
                onClick={onClose}
                className="flex items-center gap-2"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
                  <Sparkles className="h-4 w-4" />
                </span>
                <div>
                  <span className="block text-sm font-semibold text-white leading-tight">Omnix</span>
                  <span className="text-xs text-slate-500 leading-tight">AI workspace</span>
                </div>
              </Link>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="hidden h-8 w-8 lg:inline-flex"
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
                  className="h-8 w-8 lg:hidden"
                  aria-label="Close navigation"
                  title="Close navigation"
                  onClick={onClose}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                  Workspace
                </p>
              </div>
              <WorkspaceSelector />
            </div>
            <PendingWorkspaceInvites compact maxVisible={2} />
          </div>
        </div>

        <nav className="space-y-1 border-b border-white/10 px-2.5 py-3">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href.startsWith("/settings")
                ? pathname.startsWith("/settings")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-sm font-medium transition",
                  isActive
                    ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                    : "border-transparent text-slate-400 hover:bg-white/[0.05] hover:text-white",
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <section className="flex min-h-0 flex-1 flex-col px-2.5 py-3">
          <div className="mb-2.5 flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">
              Recent chats
            </p>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
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
            className="mb-3 h-9 rounded-md"
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
                  className="shimmer rounded-md border border-white/10 bg-white/[0.04] p-3"
                >
                  <div className="h-3 w-4/5 rounded-full bg-white/10" />
                  <div className="mt-3 h-2.5 w-3/5 rounded-full bg-white/10" />
                </div>
              ))}
            </div>
          ) : filteredConversations.length ? (
            <div className="scrollbar-thin min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
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
                        "group rounded-md border px-2.5 py-2 transition",
                        isActive
                          ? "border-cyan-300/35 bg-cyan-300/10"
                          : "border-transparent hover:border-white/10 hover:bg-white/[0.05]",
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
                                <p className="min-w-0 truncate text-sm font-medium text-white">
                                  {conversation.title || "Untitled conversation"}
                                </p>
                              </div>
                            </button>
                            <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[11px] text-slate-500">
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
                              <p className="line-clamp-2 text-xs leading-5 text-slate-500">
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
            <div className="rounded-md border border-dashed border-white/10 bg-white/[0.03] p-4 text-center">
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

        <div className="border-t border-white/10 px-3 py-3">
          <div className="rounded-md border border-white/8 bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              <p className="text-xs font-semibold text-white">Synced</p>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-slate-400">
              Conversations stay synced across devices.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
