"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";

type ChatInputProps = {
  onSend: (message: string) => void;
  loading: boolean;
};

export function ChatInput({ onSend, loading }: ChatInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <motion.div
      animate={{
        borderColor: focused ? "rgba(103, 232, 249, 0.36)" : "rgba(255,255,255,0.1)",
        boxShadow: focused
          ? "0 18px 70px rgba(34, 211, 238, 0.12)"
          : "0 12px 38px rgba(0, 0, 0, 0.22)",
      }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="rounded-lg border bg-white/[0.045] p-2 shadow-soft"
    >
      <div className="flex items-end gap-2">
        <div className="mb-2 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-cyan-200 sm:flex">
          <Sparkles className="h-4 w-4" />
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Ask Omnix..."
          disabled={loading}
          className="max-h-40 min-h-11 flex-1 resize-none rounded-lg border border-transparent bg-transparent px-3 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:bg-white/[0.035] disabled:cursor-not-allowed disabled:opacity-70"
        />
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          title="Send message"
          isLoading={loading}
          disabled={!value.trim()}
          onClick={submit}
          className="mb-0.5"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}
