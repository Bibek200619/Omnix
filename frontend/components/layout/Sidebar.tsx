"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Clock,
  Edit3,
  FileText,
  History,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { Input } from "@/components/ui/Input";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

type SidebarProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function Sidebar({ isOpen, onClose }: SidebarProps) {
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
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/10 bg-[#080a0f]/98 shadow-[24px_0_80px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-transform duration-200 lg:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-white/10 px-5">
          <Link
            href="/chat"
            onClick={onClose}
            className="flex items-center gap-3"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
              <Sparkles className="h-5 w-5" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">
                Omnix
              </span>
              <span className="block text-xs text-slate-500">
                AI workspace
              </span>
            </span>
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Close navigation"
            title="Close navigation"
            onClick={onClose}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg border px-3 py-2.5 text-sm font-medium transition",
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

        <section className="flex min-h-0 flex-1 flex-col border-t border-white/10 px-3 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
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
            className="mb-3 h-10"
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
                onClick={refreshConversations}
              >
                Retry
              </Button>
            </div>
          ) : loading ? (
            <div className="space-y-2">
              {[0, 1, 2].map((item) => (
                <div
                  key={item}
                  className="shimmer rounded-lg border border-white/10 bg-white/[0.04] p-3"
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
                        "group rounded-lg border px-3 py-2.5 transition",
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
            <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-center">
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

        <div className="border-t border-white/10 p-4">
          <div className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-300" />
              <p className="text-sm font-medium text-white">Persistent history</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Conversations are loaded from the authenticated API session.
            </p>
          </div>
        </div>
      </aside>
    </>
  );
}
