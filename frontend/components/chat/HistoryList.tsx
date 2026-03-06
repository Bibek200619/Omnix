"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, MessageSquareText, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api";

interface Conversation {
  id: string;
  title?: string;
  created_at?: string;
  updated_at?: string;
}

export function HistoryList() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadConversations();
  }, []);

  async function loadConversations() {
    try {
      setLoading(true);
      const data = await apiClient.get<Conversation[]>("/conversations");
      setConversations(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
      setConversations([]);
    } finally {
      setLoading(false);
    }
  }

  const chats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return conversations;
    return conversations.filter((chat) =>
      (chat.title || "").toLowerCase().includes(normalized),
    );
  }, [query, conversations]);

  function formatDate(dateString?: string) {
    if (!dateString) return "Recently";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search chat history"
          aria-label="Search chat history"
          icon={<Search className="h-4 w-4" />}
          className="sm:w-80"
          disabled={loading}
        />
        <Button type="button" onClick={() => router.push("/chat")} disabled={loading}>
          New chat
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex min-h-[360px] flex-col items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-cyan-300 border-t-transparent" />
          <p className="mt-4 text-sm text-slate-400">Loading conversations...</p>
        </div>
      ) : chats.length > 0 ? (
        <div className="grid gap-3">
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => router.push(`/chat?conversation=${chat.id}`)}
              className="group rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-cyan-300/30 hover:bg-white/[0.07]"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <MessageSquareText className="h-4 w-4 text-cyan-200" />
                    <h2 className="truncate text-base font-semibold text-white">
                      {chat.title || "Untitled conversation"}
                    </h2>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  {formatDate(chat.updated_at || chat.created_at)}
                </div>
              </div>
              <div className="mt-4 border-t border-white/10 pt-3">
                <span className="text-sm font-medium text-cyan-200 opacity-0 transition group-hover:opacity-100">
                  Open chat
                </span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-white">
            No chats found
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
            Try a different search or start a new conversation.
          </p>
          <Button
            type="button"
            className="mt-5"
            onClick={() => router.push("/chat")}
          >
            Start chat
          </Button>
        </div>
      )}
    </section>
  );
}
