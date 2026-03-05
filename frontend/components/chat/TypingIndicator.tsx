"use client";

import { motion } from "framer-motion";
import { Bot } from "lucide-react";

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-300 text-stone-950">
        <Bot className="h-5 w-5" aria-hidden="true" />
      </span>
      <div className="rounded-lg border border-white/10 bg-white/[0.065] px-4 py-3">
        <div className="flex items-center gap-2" aria-label="AI is typing">
          <span className="text-sm leading-6 text-stone-300">AI is typing...</span>
          <span className="flex items-center gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((dot) => (
              <motion.span
                key={dot}
                className="h-2 w-2 rounded-full bg-stone-400"
                animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                transition={{
                  duration: 0.8,
                  repeat: Infinity,
                  delay: dot * 0.12,
                  ease: "easeInOut"
                }}
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
