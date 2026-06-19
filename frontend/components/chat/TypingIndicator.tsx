"use client";

import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";

export function TypingIndicator({ label }: { label?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -2 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className="flex w-fit items-center gap-2.5 rounded-full border border-white/5 bg-white/[0.02] px-3.5 py-1.5 backdrop-blur-md"
    >
      <div className="relative">
        <Sparkles className="h-3 w-3 text-cyan-400/60" />
        <div className="absolute inset-0 animate-pulse bg-cyan-400/10 blur-sm rounded-full" />
      </div>
      
      {label && (
        <span className="text-[10px] font-medium uppercase tracking-wider text-white/40">
          {label}
        </span>
      )}

      <div className="flex gap-1">
        {[0, 1, 2].map((item) => (
          <motion.span
            key={item}
            animate={{ opacity: [0.2, 0.6, 0.2] }}
            transition={{ 
              duration: 2, 
              repeat: Infinity, 
              delay: item * 0.4,
              ease: "easeInOut" 
            }}
            className="h-1 w-1 rounded-full bg-cyan-200/50"
          />
        ))}
      </div>
    </motion.div>
  );
}
