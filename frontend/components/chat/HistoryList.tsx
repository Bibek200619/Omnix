"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  Clock,
  Edit3,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { ClientTime } from "@/components/ui/ClientTime";
import { Input } from "@/components/ui/Input";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { logClientError } from "@/lib/errors";
import { cn } from "@/lib/utils";

export function HistoryList() {
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

  const chats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((chat) => {
      const title = chat.title || "Omnix conversation";
      const preview = chat.preview || "";
      return `${title} ${preview}`.toLowerCase().includes(normalized);
    });
  }, [query, conversations]);

  function openChat(conversationId: string) {
    setActiveConversation(conversationId);
    router.push(`/chat?conversation=${conversationId}`);
  }

  function startRename(chatId: string, title?: string | null) {
    setEditingId(chatId);
    setDraftTitle(title || "Omnix conversation");
    setActionError(null);
  }

  async function saveRename(chatId: string) {
    const nextTitle = draftTitle.trim();
    if (!nextTitle) {
      setActionError("Conversation title cannot be empty.");
      return;
    }

    try {
      setBusyId(chatId);
      setActionError(null);
      await renameConversation(chatId, nextTitle);
      setEditingId(null);
      setDraftTitle("");
    } catch (err) {
      logClientError("Failed to rename chat", err, { endpoint: `/conversations/${chatId}` });
      setActionError("Unable to rename chat.");
    } finally {
      setBusyId(null);
    }
  }

  async function deleteChat(chatId: string) {
    try {
      setBusyId(chatId);
      setActionError(null);
      await archiveConversation(chatId);
      if (activeConversationId === chatId) {
        router.push("/chat");
      }
    } catch (err) {
      logClientError("Failed to delete chat", err, { endpoint: `/conversations/${chatId}` });
      setActionError("Unable to delete chat.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max max-w-5xl space-y-5">
      <div className="omnix-page-hero">
        <div>
          <h1 className="omnix-page-title flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-[var(--omnix-cyan)]" />
            Conversation History
          </h1>
          <p className="omnix-page-subtitle">
            Search saved threads, rename useful sessions, and reopen team knowledge exactly where it left off.
          </p>
        </div>
        <Button
          type="button"
          className="omnix-primary-action"
          onClick={() => {
            setActiveConversation(null);
            router.push("/chat");
          }}
          disabled={loading}
          leftIcon={<MessageSquarePlus className="h-4 w-4" />}
        >
          New chat
        </Button>
      </div>

      <div className="omnix-glass-band p-3">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chat history"
          aria-label="Search chat history"
          icon={<Search className="h-4 w-4" />}
          className="relative z-10"
          disabled={loading}
        />
      </div>

      {error ? (
        <OmnixErrorState
          title="Conversation history is unavailable"
          message={error}
          onRetry={() => void refreshConversations({ force: true })}
          isRetrying={loading}
        />
      ) : null}

      {actionError ? (
        <Alert variant="error" title="History action failed">
          {actionError}
        </Alert>
      ) : null}

      {loading ? (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((item) => (
            <div
              key={item}
              className="shimmer rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="h-4 w-48 rounded-full bg-[var(--omnix-surface-hover)]" />
                <div className="h-3 w-20 rounded-full bg-[var(--omnix-surface-hover)]" />
              </div>
              <div className="mt-4 h-3 w-2/3 rounded-full bg-[var(--omnix-surface-hover)]" />
            </div>
          ))}
        </div>
      ) : chats.length > 0 ? (
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
            {chats.map((chat) => {
              const isActive = activeConversationId === chat.id;
              const isEditing = editingId === chat.id;
              const isBusy = busyId === chat.id;
              const timestamp =
                chat.latest_message_at ||
                chat.last_message_at ||
                chat.updated_at ||
                chat.created_at;

              return (
                <motion.article
                  key={chat.id}
                  layout
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className={cn(
                    "group relative overflow-hidden rounded-xl border p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)]",
                    isActive
                      ? "border-cyan-300/35 bg-cyan-300/10 shadow-[var(--omnix-glow-xs)]"
                      : "border-[var(--omnix-border)] bg-[var(--omnix-surface)]",
                  )}
                >
                  <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-[var(--omnix-cyan)] opacity-0 blur-3xl transition-opacity group-hover:opacity-15" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    {isEditing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-2"
                        onSubmit={(event) => {
                          event.preventDefault();
                          saveRename(chat.id);
                        }}
                      >
                        <input
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          autoFocus
                          className="h-10 min-w-0 flex-1 rounded-lg border border-cyan-300/30 bg-black/30 px-3 text-sm font-medium text-white outline-none focus:ring-2 focus:ring-cyan-300/20"
                        />
                        <Button
                          type="submit"
                          size="icon"
                          variant="secondary"
                          className="h-9 w-9"
                          disabled={isBusy}
                          aria-label="Save title"
                          title="Save title"
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          disabled={isBusy}
                          onClick={() => setEditingId(null)}
                          aria-label="Cancel rename"
                          title="Cancel rename"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        onClick={() => openChat(chat.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              isActive ? "bg-cyan-200" : "bg-white/20",
                            )}
                          />
                          <MessageSquareText className="h-4 w-4 text-cyan-200" />
                          <h2 className="truncate text-base font-semibold text-white">
                            {chat.title || "Omnix conversation"}
                          </h2>
                        </div>
                        {isActive ? (
                          <p className="mt-2 text-xs font-medium uppercase tracking-[0.16em] text-cyan-200/75">
                            Active
                          </p>
                        ) : null}
                      </button>
                    )}
                    <div className="flex shrink-0 items-center gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        <ClientTime
                          value={timestamp}
                          fallback="Recently"
                          format="date"
                        />
                      </div>
                      {!isEditing ? (
                        <div className="flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => startRename(chat.id, chat.title)}
                            disabled={isBusy}
                            aria-label="Rename chat"
                            title="Rename chat"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
                            onClick={() => deleteChat(chat.id)}
                            disabled={isBusy}
                            aria-label="Delete chat"
                            title="Delete chat"
                          >
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openChat(chat.id)}
                    className="mt-4 block w-full border-t border-[var(--omnix-border)] pt-3 text-left"
                    disabled={isEditing}
                  >
                    <p className="line-clamp-2 text-sm leading-6 text-slate-400">
                      {chat.preview || "No messages yet"}
                    </p>
                    <span className="text-sm font-medium text-cyan-200 opacity-70 transition group-hover:opacity-100">
                      Open chat
                    </span>
                  </button>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      ) : (
        <div className="omnix-cinematic-card flex min-h-[360px] flex-col items-center justify-center border-dashed p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-xs)]">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">
            {query ? "No matching conversations" : "No conversations yet"}
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
            {query
              ? "Adjust the search term or open a new chat."
              : "Your saved conversations will appear here after the API stores the first thread."}
          </p>
          <Button
            type="button"
            className="mt-5"
            onClick={() => {
              setActiveConversation(null);
              router.push("/chat");
            }}
          >
            Start chat
          </Button>
        </div>
      )}
      </div>
    </section>
  );
}
