"use client";

import { motion } from "framer-motion";
import { Bot, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

type MessageBubbleProps = {
  message: ChatMessage;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser ? (
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-300 text-stone-950">
          <Bot className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
      <div className={cn("max-w-[min(82%,42rem)]", isUser && "flex flex-col items-end")}>
        <div
          className={cn(
            "rounded-lg px-4 py-3 text-sm leading-6 shadow-lg",
            isUser
              ? "bg-teal-300 text-stone-950 shadow-teal-950/20"
              : "border border-white/10 bg-white/[0.065] text-stone-100 shadow-black/20"
          )}
        >
          {message.content}
        </div>
        <span className="mt-1 block text-xs text-stone-500">{message.timestamp}</span>
      </div>
      {isUser ? (
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-amber-200 text-stone-950">
          <UserRound className="h-5 w-5" aria-hidden="true" />
        </span>
      ) : null}
    </motion.div>
  );
}
