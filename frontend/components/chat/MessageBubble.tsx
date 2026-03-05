"use client";

import { Bot, User } from "lucide-react";
import { motion } from "framer-motion";
import type { Message } from "@/components/chat/types";
import { cn } from "@/lib/utils";

type MessageBubbleProps = {
  message: Message;
};

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === "user";
  const Icon = isUser ? User : Bot;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn("flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
          isUser
            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
            : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div
        className={cn(
          "max-w-[78%] rounded-lg border px-4 py-3 shadow-soft sm:max-w-[68%]",
          isUser
            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
            : "border-white/10 bg-white/[0.05] text-slate-100",
        )}
      >
        <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        <p
          className={cn(
            "mt-2 text-[11px]",
            isUser ? "text-emerald-100/55" : "text-slate-500",
          )}
        >
          {message.timestamp}
        </p>
      </div>
    </motion.div>
  );
}
