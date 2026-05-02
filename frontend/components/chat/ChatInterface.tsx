"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Database, FileSearch, ShieldCheck } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type { Message } from "@/components/chat/types";
import { mockChats, starterMessages } from "@/lib/mock-data";

function nowLabel() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function ChatInterface() {
  const params = useSearchParams();
  const conversationId = params.get("conversation");
  const activeChat = useMemo(
    () => mockChats.find((chat) => chat.id === conversationId),
    [conversationId],
  );
  const [messages, setMessages] = useState<Message[]>(
    activeChat?.messages ?? starterMessages,
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMessages(activeChat?.messages ?? starterMessages);
  }, [activeChat]);

  function handleSend(content: string) {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: nowLabel(),
    };

    setMessages((current) => [...current, userMessage]);
    setLoading(true);

    window.setTimeout(() => {
      const response: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        timestamp: nowLabel(),
        content:
          "I would send this to the FastAPI RAG endpoint next. For now, the frontend keeps the interaction local so the UX is ready before backend wiring.",
      };
      setMessages((current) => [...current, response]);
      setLoading(false);
    }, 700);
  }

  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            icon: Database,
            label: "RAG source",
            value: "Vector retrieval ready",
            color: "text-cyan-200",
          },
          {
            icon: ShieldCheck,
            label: "Auth state",
            value: "Supabase handoff",
            color: "text-emerald-200",
          },
          {
            icon: FileSearch,
            label: "Context",
            value: activeChat ? activeChat.title : "New conversation",
            color: "text-amber-200",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${item.color}`} />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="truncate text-sm font-medium text-white">
                    {item.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <MessageList messages={messages} loading={loading} />
        <ChatInput onSend={handleSend} loading={loading} />
      </div>
    </section>
  );
}
