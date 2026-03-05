"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MessageSquareText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { chatHistory, type ChatPreview } from "@/lib/mock-data";

export function HistoryList() {
  const router = useRouter();
  const [chats, setChats] = React.useState<ChatPreview[]>(chatHistory);

  if (chats.length === 0) {
    return (
      <section className="flex min-h-[28rem] flex-col items-center justify-center rounded-lg border border-dashed border-white/15 bg-white/[0.035] px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-md bg-teal-300 text-stone-950">
          <MessageSquareText className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-5 text-xl font-semibold text-white">No chat history yet</h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-stone-400">
          Start a new chat and your conversations will appear here once the backend history endpoint is connected.
        </p>
        <Button className="mt-6" onClick={() => router.push("/chat")}>
          Start a chat
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Recent chats</h2>
          <p className="mt-1 text-sm text-stone-400">Open any conversation to continue from chat.</p>
        </div>
        <Button variant="secondary" onClick={() => setChats([])}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          Clear
        </Button>
      </div>

      <div className="grid gap-3">
        {chats.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => router.push(`/chat?conversation=${chat.id}`)}
            className="group rounded-lg border border-white/10 bg-white/[0.045] p-4 text-left transition hover:border-teal-200/35 hover:bg-white/[0.075]"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-white group-hover:text-teal-100">
                  {chat.title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-400">{chat.summary}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3 text-xs text-stone-500 sm:flex-col sm:items-end sm:gap-1">
                <span>{chat.updatedAt}</span>
                <span>{chat.messageCount} messages</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
