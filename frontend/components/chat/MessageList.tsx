"use client";

import { useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import type { Message } from "@/components/chat/types";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
};

export function MessageList({ messages, loading }: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  if (messages.length === 0) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">
          Start a conversation
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          Ask about documents, retrieval quality, or how your RAG backend should
          respond.
        </p>
      </div>
    );
  }

  return (
    <div className="scrollbar-thin flex min-h-[420px] flex-1 flex-col gap-5 overflow-y-auto rounded-lg border border-white/10 bg-[#080a0f] p-4 sm:p-5">
      {messages.map((message) => (
        <MessageBubble key={message.id} message={message} />
      ))}
      {loading ? (
        <div className="flex gap-3">
          <div className="mt-1 h-9 w-9 shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10" />
          <TypingIndicator />
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}
