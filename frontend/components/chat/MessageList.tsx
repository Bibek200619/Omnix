"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, MessageSquare, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import type { Message } from "@/components/chat/types";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
  loadingConversation?: boolean;
  onRetry?: (message: Message) => void;
  onPromptSelect?: (prompt: string) => void;
  onRegenerate?: (assistantMessageId: string) => void;
};

const suggestedPrompts = [
  "Summarize the onboarding notes in plain English.",
  "Turn this customer question into a source-backed answer.",
  "Create a concise implementation checklist.",
];

function ConversationSkeleton() {
  return (
    <div className="flex min-h-[420px] flex-1 flex-col gap-4 rounded-lg border border-white/10 bg-[#080a0f]/95 p-4 sm:p-5">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={`shimmer rounded-lg border border-white/10 bg-white/[0.04] p-4 ${
            item === 1 ? "ml-auto w-[74%]" : "w-[82%] sm:w-[62%]"
          }`}
        >
          <div className="h-3 w-24 rounded-full bg-white/10" />
          <div className="mt-4 h-2.5 w-full rounded-full bg-white/10" />
          <div className="mt-2 h-2.5 w-2/3 rounded-full bg-white/10" />
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
  onPromptSelect,
  onRegenerate,
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
        className="flex min-h-[420px] flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-8"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-glow">
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-white">
          Ask Omnix anything your workspace should know
        </h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">
          Start from a document, a customer question, or a knowledge gap. Omnix
          will save the thread and return a backend response.
        </p>
        <div className="mt-6 grid w-full max-w-2xl gap-2 sm:grid-cols-3">
          {suggestedPrompts.map((prompt, index) => (
            <Button
              key={prompt}
              type="button"
              variant="secondary"
              className="h-auto min-h-20 whitespace-normal px-3 py-3 text-left text-sm leading-5 hover:-translate-y-0.5"
              leftIcon={
                index === 0 ? (
                  <FileText className="h-4 w-4 shrink-0" />
                ) : (
                  <Sparkles className="h-4 w-4 shrink-0" />
                )
              }
              onClick={() => onPromptSelect?.(prompt)}
            >
              {prompt}
            </Button>
          ))}
        </div>
      </motion.div>
    );
  }

  return (
    <div className="scrollbar-thin flex min-h-[420px] flex-1 flex-col gap-5 overflow-y-auto rounded-lg border border-white/10 bg-[#080a0f]/95 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] sm:p-5">
      <AnimatePresence initial={false}>
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} onRetry={onRetry} onRegenerate={onRegenerate} />
        ))}
        {loading ? (
          <motion.div
            key="typing"
            layout
            className="flex gap-3"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mt-1 h-9 w-9 shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10" />
            <TypingIndicator />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div ref={endRef} />
    </div>
  );
}
