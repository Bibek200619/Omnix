"use client";

import * as React from "react";
import { Database, FileText, ShieldCheck } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type { ChatMessage } from "@/components/chat/MessageBubble";
import { sendMessage as sendChatMessage } from "@/lib/api";

const starterMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Hi, I’m Omnix. Ask a question and I’ll answer using the connected backend.",
    timestamp: "Now"
  }
];

const suggestions = [
  { icon: FileText, label: "Summarize the latest uploaded policy" },
  { icon: Database, label: "Find context for customer onboarding" },
  { icon: ShieldCheck, label: "Check whether an answer is grounded" }
];

function createMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    timestamp: new Intl.DateTimeFormat("en", {
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date())
  };
}

export function ChatInterface() {
  const [messages, setMessages] = React.useState<ChatMessage[]>(starterMessages);
  const [loading, setLoading] = React.useState(false);

  const sendMessage = async (content: string) => {
    const message = content.trim();

    if (!message || loading) {
      return;
    }

    setMessages((current) => [...current, createMessage("user", message)]);
    setLoading(true);

    try {
      const data = await sendChatMessage(message);

      setMessages((current) => [...current, createMessage("assistant", data.response)]);
    } catch (error) {
      console.error("Failed to send chat message:", error);
      setMessages((current) => [
        ...current,
        createMessage("assistant", "Sorry, I couldn’t reach the AI service. Please try again in a moment.")
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="flex h-[calc(100vh-7.5rem)] min-h-[36rem] flex-col overflow-hidden rounded-lg border border-white/10 bg-[#11110f] shadow-2xl shadow-black/25">
      <div className="border-b border-white/10 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Knowledge chat</h2>
            <p className="mt-1 text-sm text-stone-400">Backend-connected chat with grounded responses.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {suggestions.map((suggestion) => {
              const Icon = suggestion.icon;

              return (
                <button
                  key={suggestion.label}
                  type="button"
                  onClick={() => sendMessage(suggestion.label)}
                  disabled={loading}
                  className="flex min-h-10 items-center gap-2 rounded-md border border-white/10 bg-white/[0.045] px-3 text-left text-xs font-medium text-stone-300 transition hover:border-teal-200/35 hover:bg-white/[0.075] disabled:pointer-events-none disabled:opacity-55"
                >
                  <Icon className="h-4 w-4 shrink-0 text-teal-200" aria-hidden="true" />
                  <span>{suggestion.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <MessageList messages={messages} loading={loading} />
      <ChatInput onSend={sendMessage} loading={loading} />
    </section>
  );
}
