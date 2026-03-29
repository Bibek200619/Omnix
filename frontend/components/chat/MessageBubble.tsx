"use client";

import { useState } from "react";
import { Bot, Check, Copy, RotateCcw, User, FileText, ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Message } from "@/components/chat/types";
import { MarkdownRenderer } from "@/components/chat/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";

type MessageBubbleProps = {
  message: Message;
  onRetry?: (message: Message) => void;
  onRegenerate?: (assistantMessageId: string) => void;
};

export function MessageBubble({ message, onRetry, onRegenerate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [gaveFeedback, setGaveFeedback] = useState<null | "up" | "down">(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);

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

  function giveFeedback(type: "up" | "down") {
    setGaveFeedback(type);
  }

  function attachmentName(file: NonNullable<Message["attachments"]>[number]) {
    return file.file_name || file.filename || "Uploaded document";
  }

  function attachmentSize(file: NonNullable<Message["attachments"]>[number]) {
    if (!file.size_bytes) return "Document";
    if (file.size_bytes < 1024 * 1024) {
      return `${Math.max(1, Math.round(file.size_bytes / 1024))} KB`;
    }
    return `${(file.size_bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  async function downloadAttachment(file: NonNullable<Message["attachments"]>[number]) {
    if (!file.id || downloadingAttachmentId) return;

    try {
      setDownloadingAttachmentId(file.id);
      const response = await apiClient.request(`/files/${file.id}/download`, {
        method: "GET",
      });
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = attachmentName(file);
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download attachment", err);
    } finally {
      setDownloadingAttachmentId(null);
    }
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

        {isUser && message.attachments && message.attachments.length > 0 ? (
          <div className="mt-3 flex flex-col gap-2">
            {message.attachments.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => downloadAttachment(file)}
                className="flex min-w-0 items-center gap-2 rounded-lg border border-emerald-200/20 bg-black/15 px-3 py-2 text-left text-emerald-50 transition hover:border-emerald-200/35 hover:bg-black/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200/60"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-200/20 bg-emerald-200/10">
                  <FileText className="h-4 w-4 text-emerald-100" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{attachmentName(file)}</span>
                  <span className="block text-xs text-emerald-100/60">
                    {downloadingAttachmentId === file.id ? "Opening..." : attachmentSize(file)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Citations block */}
        {!isUser && message.sources && message.sources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-white/10">
             <p className="text-xs font-medium text-slate-400 mb-3 flex items-center gap-2">
               <FileText className="w-3.5 h-3.5" />
               Retrieved Sources ({message.sources.length})
             </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {message.sources.map((s: Record<string, string>, i: number) => {
                const sourceId = s.id || String(i);
                const isExpanded = expandedSource === sourceId;
                
                // Extract score if it exists in the excerpt like [Score: 4.5]
                let scoreText = "";
                let cleanExcerpt = s.excerpt || "";
                const scoreMatch = cleanExcerpt.match(/\[Score:\s*([0-9.]+)\]/);
                if (scoreMatch) {
                  scoreText = scoreMatch[1];
                  cleanExcerpt = cleanExcerpt.replace(scoreMatch[0], "").trim();
                }

                return (
                  <div key={sourceId} className="flex flex-col rounded-lg border border-white/10 bg-white/[0.02] overflow-hidden transition-colors hover:bg-white/[0.04]">
                    <button
                      type="button"
                      onClick={() => setExpandedSource(isExpanded ? null : sourceId)}
                      className="flex items-center justify-between p-2.5 text-left focus:outline-none"
                    >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-3.5 h-3.5 shrink-0 text-cyan-400/70" />
                          <span className="truncate text-xs font-medium text-slate-200">{s.title || 'Unknown Source'}</span>
                          {typeof s.chunk_index === 'number' && (
                            <span className="ml-2 px-1.5 py-0.5 rounded bg-white/[0.02] text-slate-300 text-[10px] border border-white/6">
                              #{s.chunk_index}
                            </span>
                          )}
                        </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {scoreText && (
                          <span className="px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-300 text-[10px] font-medium border border-cyan-500/20">
                            {scoreText}
                          </span>
                        )}
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400" />}
                      </div>
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="px-3 pb-3"
                        >
                          <div className="pt-2 mt-1 border-t border-white/5">
                            <p className="text-[11px] leading-relaxed text-slate-400 italic">
                              &ldquo;{cleanExcerpt}&rdquo;
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
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
      </div>
    </motion.div>
  );
}
