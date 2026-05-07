"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import type { Message } from "@/components/chat/types";
import type { WorkspacePresenceMember } from "@/lib/workspace-types";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
  loadingConversation?: boolean;
  onRetry?: (message: Message) => void;
  onRegenerate?: (assistantMessageId: string) => void;
  typingMembers?: WorkspacePresenceMember[];
};

function ConversationSkeleton() {
  return (
    <div className="omnix-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={`shimmer rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4 shadow-[var(--omnix-glow-xs)] ${
            item === 1 ? "ml-auto w-[74%]" : "w-[82%] sm:w-[62%]"
          }`}
        >
          <div className="h-3 w-24 rounded-full bg-[var(--omnix-surface-hover)]" />
          <div className="mt-4 h-2.5 w-full rounded-full bg-[var(--omnix-surface-hover)]" />
          <div className="mt-2 h-2.5 w-2/3 rounded-full bg-[var(--omnix-surface-hover)]" />
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  loadingConversation = false,
  onRetry,
  onRegenerate,
  typingMembers = [],
}: MessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [messages, loading]);

  if (loadingConversation) {
    return <ConversationSkeleton />;
  }

  if (messages.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-10 text-center sm:p-8"
      >
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-md)]">
          <span className="absolute inset-0 rounded-xl bg-cyan-300/10 blur-xl" />
          <span className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,rgba(0,255,255,0.2),transparent_70%)] opacity-70 [animation:auth-drift_12s_ease-in-out_infinite]" />
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="omnix-display mt-5 text-xl font-semibold text-white">
          Ask Omnix anything your workspace should know
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--omnix-text-2)]">
          Start from a document, a customer question, or a knowledge gap. Omnix
          will save the thread and return a backend response.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="omnix-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 pb-36 sm:gap-7 sm:px-7 lg:px-9">
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onRetry={onRetry} onRegenerate={onRegenerate} />
        ))}
        {typingMembers.length ? (
          <motion.div
            key="collaborator-typing"
            layout
            className="flex w-full items-start gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-xs font-bold text-emerald-100 shadow-[0_0_18px_rgba(0,232,122,0.16)]">
              {typingMembers[0]?.avatar_label || "U"}
            </div>
            <TypingIndicator
              label={
                typingMembers.length === 1
                  ? `${typingMembers[0]?.full_name || typingMembers[0]?.email || "A teammate"} is typing`
                  : `${typingMembers.length} teammates are typing`
              }
            />
          </motion.div>
        ) : null}
        {loading ? (
          <motion.div
            key="typing"
            layout
            className="flex w-full items-start gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mt-1 h-9 w-9 shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10 shadow-[var(--omnix-glow-xs)]" />
            <TypingIndicator />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}
