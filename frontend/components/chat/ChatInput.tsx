"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Database, FileText, Globe2, Layers3, Plus, Send, Sparkles, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import type { MessageAttachment, SearchMode } from "@/components/chat/types";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (message: string) => void;
  loading: boolean;
  conversationId?: string;
  attachments?: MessageAttachment[];
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  onUploadSuccess?: (file: MessageAttachment) => void;
  onRemoveAttachment?: (fileId: string) => void;
};

const searchModes: Array<{
  value: SearchMode;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "auto", label: "Auto", icon: Sparkles },
  { value: "workspace", label: "Workspace", icon: Database },
  { value: "web", label: "Web", icon: Globe2 },
  { value: "hybrid", label: "Hybrid", icon: Layers3 },
];

function attachmentName(file: MessageAttachment) {
  return file.file_name || file.filename || "Uploaded document";
}

function formatBytes(size?: number) {
  if (!size) return "Ready";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({
  onSend,
  loading,
  conversationId,
  attachments = [],
  searchMode,
  onSearchModeChange,
  onUploadSuccess,
  onRemoveAttachment,
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
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

  function handleUploadSuccess(file: MessageAttachment) {
    console.debug("[upload] composer received successful upload", { fileId: file.id, conversationId });
    onUploadSuccess?.(file);
  }

  function handleUploadComplete(result: { hasSuccess: boolean }) {
    console.debug("[upload] composer upload batch complete", { conversationId, hasSuccess: result.hasSuccess });
    if (result.hasSuccess) {
      setUploadOpen(false);
    }
  }

  return (
    <motion.div
      animate={{
        borderColor: focused ? "rgba(0, 255, 255, 0.45)" : "rgba(0,255,255,0.12)",
        boxShadow: focused
          ? "0 0 0 3px rgba(0,255,255,0.08), var(--omnix-glow-sm), 0 18px 70px rgba(0,0,0,0.28)"
          : "0 12px 38px rgba(0, 0, 0, 0.26)",
      }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      className="z-20 mx-auto w-full max-w-[860px] overflow-hidden rounded-[15px] border bg-[rgba(8,16,30,0.88)] shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-[20px]"
    >
      {attachments.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-2">
          {attachments.map((file) => (
            <div
              key={file.id}
              className="group/file inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2.5 py-2 text-xs text-cyan-50 sm:max-w-[260px]"
            >
              <FileText className="h-4 w-4 shrink-0 text-cyan-200" />
              <div className="min-w-0">
                <p className="truncate font-medium">{attachmentName(file)}</p>
                <p className="text-[11px] text-cyan-100/60">{formatBytes(file.size_bytes)}</p>
              </div>
              <button
                type="button"
                className="ml-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-cyan-100/55 transition hover:bg-cyan-300/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                aria-label={`Remove ${attachmentName(file)}`}
                title="Remove attachment"
                onClick={() => onRemoveAttachment?.(file.id)}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {uploadOpen ? (
        <div className="mb-2 rounded-lg border border-[var(--omnix-border)] bg-black/20 p-2">
          <UploadDropzone
            compact
            conversationId={conversationId}
            onUploadSuccess={handleUploadSuccess}
            onUploadComplete={handleUploadComplete}
          />
        </div>
      ) : null}

      <div className="mx-3 mb-2 mt-3 flex flex-wrap items-center gap-1 rounded-lg border border-[var(--omnix-border)] bg-black/20 p-1">
        <span className="hidden px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)] sm:inline">
          AI Mode
        </span>
        {searchModes.map((mode) => {
          const Icon = mode.icon;
          const active = searchMode === mode.value;
          return (
            <button
              key={mode.value}
              type="button"
              onClick={() => onSearchModeChange(mode.value)}
              className={cn(
                "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
                active
                  ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50 shadow-[var(--omnix-glow-xs)]"
                  : "border-transparent text-[var(--omnix-text-3)] hover:bg-[var(--omnix-surface)] hover:text-slate-100",
              )}
              aria-pressed={active}
              title={`${mode.label} search mode`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{mode.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2 border-t border-[var(--omnix-border)] bg-[rgba(0,0,0,0.2)] px-3 py-2.5 transition focus-within:bg-[var(--omnix-surface)]">
        <Button
          type="button"
          variant={uploadOpen ? "secondary" : "ghost"}
          size="icon"
          aria-label={uploadOpen ? "Hide document upload" : "Attach document"}
          title={uploadOpen ? "Hide document upload" : "Attach document"}
          onClick={() => setUploadOpen((current) => !current)}
          className={cn("h-10 w-10 rounded-lg border border-transparent text-[var(--omnix-text-3)] hover:bg-[var(--omnix-surface)] hover:text-white", uploadOpen && "border-cyan-300/25 bg-cyan-300/10 text-cyan-100")}
        >
          <Plus className={cn("h-4 w-4 transition-transform", uploadOpen && "rotate-45")} />
        </Button>
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
          className="max-h-40 min-h-10 flex-1 resize-none border border-transparent bg-transparent px-2 py-2.5 text-sm leading-6 text-white outline-none transition placeholder:text-[var(--omnix-text-3)] disabled:cursor-not-allowed disabled:opacity-70 sm:px-3"
        />
        <Button
          type="button"
          size="icon"
          aria-label="Send message"
          title="Send message"
          isLoading={loading}
          disabled={!value.trim()}
          onClick={submit}
          className="h-[30px] w-[30px] rounded-lg bg-[var(--omnix-grad-primary)] text-[#050c17] shadow-[var(--omnix-glow-sm)] hover:shadow-[var(--omnix-glow-md)] disabled:bg-[var(--omnix-surface)] disabled:text-[var(--omnix-text-3)] disabled:shadow-none"
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </motion.div>
  );
}
