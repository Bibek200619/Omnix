"use client";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export function TypingIndicator() {
  const dotVariants = {
    initial: { y: 0 },
    animate: { y: -4 }
  };

  const transition = {
    duration: 0.5,
    repeat: Infinity,
    repeatType: "reverse" as const
  };

  return (
    <div className="flex gap-4 w-full max-w-4xl mx-auto py-6 flex-row items-start">
      <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-1 shadow-lg bg-gradient-to-br from-blue-500 to-blue-700">
        <Sparkles className="w-4 h-4 text-white" />
      </div>
      
      <div className="flex flex-col">
        <div className="text-xs text-gray-500 mb-1.5 font-medium px-1 uppercase tracking-wider">
          Omnix
        </div>
        <div className="px-5 py-4 rounded-2xl bg-white/5 border border-white/10 rounded-tl-sm flex items-center gap-1.5 min-h-[44px]">
          <motion.div
            variants={dotVariants}
            initial="initial"
            animate="animate"
            transition={{ ...transition, delay: 0 }}
            className="w-1.5 h-1.5 bg-blue-400 rounded-full"
          />
          <motion.div
            variants={dotVariants}
            initial="initial"
            animate="animate"
            transition={{ ...transition, delay: 0.15 }}
            className="w-1.5 h-1.5 bg-blue-400 rounded-full"
          />
          <motion.div
            variants={dotVariants}
            initial="initial"
            animate="animate"
            transition={{ ...transition, delay: 0.3 }}
            className="w-1.5 h-1.5 bg-blue-400 rounded-full"
          />
        </div>
      </div>
    </div>
  );
}
