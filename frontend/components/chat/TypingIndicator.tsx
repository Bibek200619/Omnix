"use client";

import { motion } from "framer-motion";

export function TypingIndicator({ label = "Omnix is thinking" }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="flex w-fit items-center gap-2 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-4 py-3 shadow-[var(--omnix-glow-xs)] backdrop-blur-xl"
    >
      <span className="text-xs font-medium text-[var(--omnix-text-3)]">{label}</span>
      {[0, 1, 2].map((item) => (
        <span
          key={item}
          className="h-1.5 w-1.5 animate-bounce rounded-full bg-cyan-200 shadow-[0_0_8px_rgba(0,255,255,0.7)]"
          style={{ animationDelay: `${item * 110}ms` }}
        />
      ))}
    </motion.div>
  );
}
