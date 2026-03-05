"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, MessageSquareText, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { mockChats } from "@/lib/mock-data";

export function HistoryList() {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const chats = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return mockChats;
    return mockChats.filter((chat) =>
      `${chat.title} ${chat.excerpt}`.toLowerCase().includes(normalized),
    );
  }, [query]);

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
        />
        <Button type="button" onClick={() => router.push("/chat")}>
          New chat
        </Button>
      </div>

      {chats.length > 0 ? (
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
                      {chat.title}
                    </h2>
                  </div>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    {chat.excerpt}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500">
                  <Clock className="h-3.5 w-3.5" />
                  {chat.updatedAt}
                </div>
              </div>
              <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                <span className="text-xs text-slate-500">
                  {chat.messageCount} messages
                </span>
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
