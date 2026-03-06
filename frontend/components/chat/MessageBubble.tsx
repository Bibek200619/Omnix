"use client";

import { useState } from "react";
import { Bot, Check, Copy, RotateCcw, User } from "lucide-react";
import { motion } from "framer-motion";
import type { Message } from "@/components/chat/types";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type MessageBubbleProps = {
  message: Message;
  onRetry?: (message: Message) => void;
  onRegenerate?: (assistantMessageId: string) => void;
};

export function MessageBubble({ message, onRetry, onRegenerate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [gaveFeedback, setGaveFeedback] = useState<null | "up" | "down">(null);

  const isUser = message.role === "user";
  const Icon = isUser ? User : Bot;
  const failed = message.status === "failed";
  const sending = message.status === "sending" || message.status === "streaming";

  async function copyMessage() {
    if (!navigator.clipboard || !message.content) return;

    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  function handleRegenerate() {
    if (message.role !== "assistant" || !onRegenerate) return;
    onRegenerate(message.id);
  }

  function toggleSources() {
    setSourcesOpen((s) => !s);
  }

  function giveFeedback(type: "up" | "down") {
    setGaveFeedback(type);
    // ideally send to analytics/feedback endpoint; currently only UI
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.99 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={cn("group flex gap-3", isUser && "flex-row-reverse")}
    >
      <div
        className={cn(
          "mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
          isUser
            ? "border-emerald-300/30 bg-emerald-300/10 text-emerald-200"
            : "border-cyan-300/30 bg-cyan-300/10 text-cyan-200",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div
        className={cn(
          "max-w-[88%] rounded-lg border px-4 py-3 shadow-soft transition sm:max-w-[74%]",
          failed
            ? "border-rose-400/30 bg-rose-400/10 text-rose-50"
            : isUser
            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-50"
            : "border-white/10 bg-white/[0.055] text-slate-100",
          sending && "opacity-80",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-6">{message.content}</p>
        ) : (
          <MarkdownRenderer content={message.content} compact />
        )}

        <div className="mt-2 flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-[11px]",
              failed
                ? "text-rose-100/70"
                : isUser
                ? "text-emerald-100/55"
                : "text-slate-500",
            )}
          >
            {sending ? (message.status === "streaming" ? "Thinking…" : "Sending...") : message.timestamp}
          </p>

          <div className="flex items-center gap-1">
            {/* toolbar: copy always, regenerate + feedback for assistant */}
            {!sending && message.content ? (
              <button
                type="button"
                onClick={copyMessage}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                  isUser && "text-emerald-100/50 hover:text-emerald-50",
                )}
                aria-label="Copy message"
                title="Copy message"
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            ) : null}

            {message.role === "assistant" ? (
              <>
                <button
                  type="button"
                  onClick={handleRegenerate}
                  title="Regenerate"
                  aria-label="Regenerate"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.06]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => giveFeedback("up")}
                  title="Helpful"
                  aria-label="Helpful"
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.06]",
                    gaveFeedback === "up" && "bg-emerald-400/10 text-emerald-200",
                  )}
                >
                  <Check className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => giveFeedback("down")}
                  title="Not helpful"
                  aria-label="Not helpful"
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.06]",
                    gaveFeedback === "down" && "bg-rose-400/10 text-rose-200",
                  )}
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M12 2v18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>

                {message.sources && message.sources.length ? (
                  <button
                    type="button"
                    onClick={toggleSources}
                    title="Sources"
                    aria-label="Sources"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-white/[0.06]"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 12h18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  </button>
                ) : null}
              </>
            ) : null}

            {failed && isUser && onRetry ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="ml-2"
                leftIcon={<RotateCcw className="h-3.5 w-3.5" />}
                onClick={() => onRetry(message)}
              >
                Retry
              </Button>
            ) : null}
          </div>
        </div>

        {message.sources && message.sources.length ? (
          <div className={cn("mt-3 transition-all", sourcesOpen ? "max-h-96" : "max-h-0 overflow-hidden")}>
            <div className="rounded-md border border-white/6 bg-white/[0.02] p-3 text-xs text-slate-400">
              <p className="mb-2 text-[11px] font-medium text-slate-300">Sources</p>
              <div className="space-y-2">
                {message.sources.map((s, i) => (
                  <a
                    key={s.id ?? i}
                    href={(s as any).url || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-sm p-2 hover:bg-white/[0.03]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-white truncate">{(s as any).title ?? (s as any).url ?? 'Source'}</p>
                      <span className="text-[11px] text-slate-400">{(s as any).id ?? ''}</span>
                    </div>
                    {(s as any).excerpt ? (
                      <p className="mt-1 text-[12px] text-slate-400 line-clamp-2">{(s as any).excerpt}</p>
                    ) : null}
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
