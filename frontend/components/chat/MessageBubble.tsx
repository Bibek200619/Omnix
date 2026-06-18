"use client";

import type { CSSProperties } from "react";
import { memo, useState } from "react";
import { Check, Copy, RotateCcw, FileText, ChevronDown, ChevronUp, ExternalLink, Globe2, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Message } from "@/components/chat/types";
import { MarkdownRenderer, StreamingTextRenderer } from "@/components/chat/MarkdownRenderer";
import { Button } from "@/components/ui/Button";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { cn } from "@/lib/utils";
import { apiClient } from "@/lib/api";
import {
  workspaceRoleAvatarClass,
  workspaceRoleBadgeClass,
  workspaceRoleLabel,
} from "@/lib/workspace-roles";

type MessageBubbleProps = {
  message: Message;
  onRetry?: (message: Message) => void;
  onRegenerate?: (assistantMessageId: string) => void;
};

export const MessageBubble = memo(function MessageBubble({ message, onRetry, onRegenerate }: MessageBubbleProps) {
  const [copied, setCopied] = useState(false);
  const [gaveFeedback, setGaveFeedback] = useState<null | "up" | "down">(null);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = useState<string | null>(null);

  const isUser = message.role === "user";
  const isOwn = isUser && (message.isOwn ?? true);
  const isOtherHuman = isUser && !isOwn;
  const failed = message.status === "failed";
  const sending = message.status === "sending" || message.status === "streaming";
  const activelyStreaming = !isUser && (message.isStreaming || message.status === "streaming");
  const senderName = message.senderName || (isUser ? (isOwn ? "You" : "Teammate") : "Omnix AI");
  const senderRole = message.senderRole || (isUser ? "member" : "assistant");
  const sources = message.sources ?? [];
  const senderRoleKey = String(senderRole);
  const roleColor =
    senderRoleKey === "owner" || senderRoleKey === "founder" || senderRoleKey === "super_founder"
      ? "var(--role-founder)"
      : senderRoleKey === "co_owner" || senderRoleKey === "sub_leader"
      ? "var(--role-coowner)"
      : "var(--role-member)";

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

  function sourceDomain(source: NonNullable<Message["sources"]>[number]) {
    if (source.domain) return source.domain;
    if (!source.url) return source.type === "web" ? "Web" : "Workspace";
    try {
      return new URL(source.url).hostname.replace(/^www\./, "");
    } catch {
      return "Web";
    }
  }

  function sourceExcerpt(source: NonNullable<Message["sources"]>[number]) {
    return source.snippet || source.excerpt || source.chunk_preview || "";
  }

  function safeUrl(url?: string) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }

  function sourceBadgeLabel() {
    if (message.sourceMode === "web") return "Web context";
    if (message.sourceMode === "hybrid") return "Hybrid context";
    if (message.sourceMode === "workspace") return "Workspace context";
    return message.webSearchUsed ? "Hybrid context" : "Workspace context";
  }

  return (
    <motion.div
      layout={!activelyStreaming}
      initial={{ opacity: 0, y: 10, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.99 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className={cn(
        "group flex w-full items-start gap-2 sm:gap-3",
        isOwn ? "flex-row-reverse" : "flex-row",
      )}
    >
      {isUser ? (
        <ProfileAvatar
          name={senderName}
          email={message.senderEmail}
          handle={message.senderHandle}
          avatarUrl={message.senderAvatarUrl}
          className={cn("mt-1 h-8 w-8 text-xs shadow-[inset_0_1px_0_var(--omnix-rgba-rgba-255-255-255-0-05)] sm:h-9 sm:w-9", workspaceRoleAvatarClass(senderRole))}
        />
      ) : (
        <div
          className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-cyan-300/20 bg-[linear-gradient(135deg,var(--omnix-rgba-rgba-0-255-255-0-1),var(--omnix-rgba-rgba-0-100-255-0-15))] text-cyan-100 shadow-[inset_0_1px_0_var(--omnix-rgba-rgba-255-255-255-0-05)] sm:h-9 sm:w-9 sm:rounded-[12px]"
          title={senderName}
        >
          <Sparkles className="h-4 w-4 drop-shadow-sm opacity-80" />
        </div>
      )}
      <div
        className={cn(
          "group/content relative min-w-0 transition",
          isOwn
            ? "max-w-[calc(100%_-_2.5rem)] sm:max-w-[680px]"
            : "max-w-[calc(100%_-_2.5rem)] sm:max-w-[78%]",
          failed
            ? "overflow-hidden rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-rose-50"
          : isUser
            ? "omnix-human-card px-3 py-3 text-[var(--omnix-text-2)] shadow-sm sm:px-4"
            : "omnix-ai-card px-3.5 py-3.5 text-slate-100 sm:px-5 sm:py-[18px]",
          sending && "opacity-80",
        )}
        style={isUser ? ({ "--role-color": roleColor } as CSSProperties) : undefined}
      >
        <div className="relative z-10 mb-2 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "min-w-0 truncate text-[13px] font-medium",
              isOwn ? "text-cyan-50" : isOtherHuman ? "text-sky-50" : "text-cyan-100",
            )}
          >
            {senderName}
          </span>
          {!isUser ? (
            <span className="h-[5px] w-[5px] rounded-full bg-[var(--omnix-cyan)] opacity-70" />
          ) : null}
          {isUser ? (
            <span className="h-[5px] w-[5px] rounded-full opacity-60" style={{ background: roleColor }} />
          ) : null}
          
          <div
            className={cn(
              "flex min-w-0 items-center gap-2 transition-opacity duration-300",
              isOtherHuman
                ? "opacity-100"
                : "opacity-0 group-hover/content:opacity-100 group-focus-within/content:opacity-100",
            )}
          >
            {isUser && message.senderHandle ? (
              <span className="truncate text-[10px] font-medium text-slate-400/80">@{message.senderHandle}</span>
            ) : null}
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.08em]",
                isUser
                  ? workspaceRoleBadgeClass(senderRole)
                  : "border-cyan-300/10 bg-white/5 text-white/30",
              )}
            >
              {isUser ? workspaceRoleLabel(senderRole) : "Omnix"}
            </span>
          </div>
        </div>

        {isUser ? (
          <p className="relative z-10 whitespace-pre-wrap break-words text-sm font-light leading-[1.65] text-[var(--omnix-text)]">{message.content}</p>
        ) : activelyStreaming ? (
          <div className="relative z-10 break-words"><StreamingTextRenderer content={message.content} compact /></div>
        ) : (
          <div className="relative z-10 break-words"><MarkdownRenderer content={message.content} compact /></div>
        )}

        {isUser && message.attachments && message.attachments.length > 0 ? (
          <div className="relative z-10 mt-3 flex flex-col gap-2">
            {message.attachments.map((file) => (
              <button
                key={file.id}
                type="button"
                onClick={() => downloadAttachment(file)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-lg border bg-black/15 px-3 py-2 text-left transition hover:bg-black/25 focus:outline-none focus-visible:ring-2",
                  isOwn
                    ? "border-emerald-200/20 text-emerald-50 hover:border-emerald-200/35 focus-visible:ring-emerald-200/60"
                    : "border-sky-200/20 text-sky-50 hover:border-sky-200/35 focus-visible:ring-sky-200/60",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border",
                    isOwn
                      ? "border-emerald-200/20 bg-emerald-200/10"
                      : "border-sky-200/20 bg-sky-200/10",
                  )}
                >
                  <FileText className={cn("h-4 w-4", isOwn ? "text-emerald-100" : "text-sky-100")} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{attachmentName(file)}</span>
                  <span className={cn("block text-xs", isOwn ? "text-emerald-100/60" : "text-sky-100/60")}>
                    {downloadingAttachmentId === file.id ? "Opening..." : attachmentSize(file)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {!isUser && activelyStreaming && sources.length > 0 ? (
          <div className="relative z-10 mt-4 border-t border-white/5 pt-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/5 bg-white/[0.03] px-2.5 py-1 text-[10px] font-medium text-white/20">
              <Globe2 className="h-3 w-3 opacity-40" />
              Intelligence context ready
            </p>
          </div>
        ) : null}

        {!isUser && !activelyStreaming && sources.length > 0 ? (
          <div className="relative z-10 mt-4 border-t border-white/5 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-wider text-white/20">
                <Globe2 className="h-3 w-3 opacity-40" />
                Context
              </p>
              <span className="rounded-full border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[9px] font-medium text-white/30 uppercase tracking-tight">
                {sourceBadgeLabel()}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {sources.map((source, index) => {
                const sourceId = source.id || source.url || String(index);
                const isExpanded = expandedSource === sourceId;
                const url = safeUrl(source.url);
                const excerpt = sourceExcerpt(source);
                const domain = sourceDomain(source);
                const isWeb = source.type === "web" || Boolean(url);
                const label = source.label || `S${index + 1}`;

                return (
                  <div
                    key={sourceId}
                    className="omnix-source-card"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedSource(isExpanded ? null : sourceId)}
                      className="flex w-full items-start justify-between gap-3 p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                    >
                      <div className="flex min-w-0 gap-2">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/10">
                          {source.favicon_url && isWeb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={source.favicon_url} alt="" className="h-4 w-4 rounded-sm" />
                          ) : isWeb ? (
                            <Globe2 className="h-3.5 w-3.5 text-cyan-200" />
                          ) : (
                            <FileText className="h-3.5 w-3.5 text-emerald-200" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="shrink-0 rounded border border-cyan-300/20 bg-cyan-300/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-100">
                              {label}
                            </span>
                            <span className="truncate text-xs font-semibold text-slate-100">
                              {source.title || domain || "Source"}
                            </span>
                          </span>
                          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-3)]">
                            <span className="truncate">{domain}</span>
                            {source.published_date ? <span>{source.published_date}</span> : null}
                          </span>
                        </span>
                      </div>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 transition hover:bg-cyan-300/10 hover:text-cyan-100"
                            aria-label={`Open ${source.title || domain}`}
                            title="Open source"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                        )}
                      </span>
                    </button>
                    <AnimatePresence>
                      {isExpanded && excerpt ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2, ease: "easeOut" }}
                          className="px-3 pb-3"
                        >
                          <p className="border-t border-[var(--omnix-border)] pt-2 text-[11px] leading-5 text-[var(--omnix-text-2)]">
                            {excerpt}
                          </p>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div
          className={cn(
            "relative z-10 mt-3 flex items-center justify-between gap-2",
            isOwn && "flex-row-reverse",
          )}
        >
          <p
            className={cn(
              "text-[11px]",
              failed
                ? "text-rose-100/70"
                : isOwn
                ? "text-cyan-100/55"
                : isOtherHuman
                ? "text-sky-100/55"
                : "text-[var(--omnix-text-3)]",
            )}
          >
            {sending ? (message.status === "streaming" ? "Thinking…" : "Sending...") : message.timestamp}
          </p>

          <div className="flex items-center gap-1.5">
            {!sending && message.content ? (
              <button
                type="button"
                onClick={copyMessage}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                  isOwn && "text-emerald-100/50 hover:text-emerald-50",
                  isOtherHuman && "text-sky-100/50 hover:text-sky-50",
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
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>

                <button
                  type="button"
                  onClick={() => giveFeedback("up")}
                  title="Helpful"
                  aria-label="Helpful"
                  className={cn(
                    "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
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
                    "inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
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
});
