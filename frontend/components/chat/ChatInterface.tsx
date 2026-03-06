"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Database, FileSearch, ShieldCheck } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type { Message } from "@/components/chat/types";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";

function nowLabel() {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
}

export function ChatInterface() {
  const params = useSearchParams();
  const { session } = useAuth();
  const conversationId = params.get("conversation");
  
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Welcome to Omnix. Ask me anything about your documents.",
      timestamp: nowLabel(),
    },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConversation, setCurrentConversation] = useState<string | null>(conversationId);

  // Load conversation if specified
  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
    }
  }, [conversationId]);

  async function loadConversation(convId: string) {
    try {
      const messages = await apiClient.get<Message[]>(
        `/messages/conversations/${convId}/messages`
      );
      setMessages(messages);
      setCurrentConversation(convId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    }
  }

  async function handleSend(content: string) {
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: nowLabel(),
    };

    setMessages((current) => [...current, userMessage]);
    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post<{
        conversation_id: string;
        user_message_id: string;
        assistant_message_id: string;
        response: string;
      }>("/messages/chat", {
        message: content,
        conversation_id: currentConversation || undefined,
        title: !currentConversation ? "New conversation" : undefined,
      });

      setCurrentConversation(response.conversation_id);

      const assistantMessage: Message = {
        id: response.assistant_message_id,
        role: "assistant",
        content: response.response,
        timestamp: nowLabel(),
      };

      setMessages((current) => [...current, assistantMessage]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
      // Remove the user message on error
      setMessages((current) => current.slice(0, -1));
    } finally {
      setLoading(false);
    }
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
            value: session ? "Authenticated" : "Not authenticated",
            color: "text-emerald-200",
          },
          {
            icon: FileSearch,
            label: "Context",
            value: currentConversation ? "Active conversation" : "New conversation",
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
      {error && (
        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <MessageList messages={messages} loading={loading} />
        <ChatInput onSend={handleSend} loading={loading} />
      </div>
    </section>
  );
}
