"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  BadgeCheck,
  ClipboardCheck,
  Database,
  FileText,
  Globe2,
  Layers3,
  Lightbulb,
  Paperclip,
  SearchCheck,
  Send,
  ShieldAlert,
  Square,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { UploadDropzone } from "@/components/upload/UploadDropzone";
import type { MessageAttachment, SearchMode } from "@/components/chat/types";
import { logger } from "@/lib/logger";
import { useRecoverableTextDraft } from "@/lib/recoverable-draft";
import { cn } from "@/lib/utils";

type ChatInputProps = {
  onSend: (message: string) => void;
  loading: boolean;
  onCancel?: () => void;
  conversationId?: string;
  attachments?: MessageAttachment[];
  searchMode: SearchMode;
  onSearchModeChange: (mode: SearchMode) => void;
  onUploadSuccess?: (file: MessageAttachment) => void;
  onRemoveAttachment?: (fileId: string) => void;
  onTypingChange?: (isTyping: boolean) => void;
  draftStorageKey?: string | null;
};

const searchModes: Array<{
  value: SearchMode;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "auto", label: "Auto", icon: Sparkles },
  { value: "workspace", label: "Workspace", icon: Database },
  { value: "web", label: "Web", icon: Globe2 },
  { value: "hybrid", label: "Synthesis", icon: Layers3 },
];

type SlashCommand = {
  id: string;
  command: string;
  title: string;
  description: string;
  icon: LucideIcon;
  prompt?: string;
  searchMode?: SearchMode;
  openUpload?: boolean;
};

const slashCommands: SlashCommand[] = [
  {
    id: "summarize",
    command: "/summarize",
    title: "Summarize Workspace",
    description: "Create a concise summary from the active workspace context.",
    icon: Sparkles,
    prompt: "Summarize this workspace context.",
    searchMode: "workspace",
  },
  {
    id: "ideas",
    command: "/ideas",
    title: "Suggest Ideas",
    description: "Generate useful directions, improvements, or next moves.",
    icon: Lightbulb,
    prompt: "Suggest ideas for this workspace.",
    searchMode: "auto",
  },
  {
    id: "tasks",
    command: "/tasks",
    title: "Draft Tasks",
    description: "Turn the current context into actionable tasks.",
    icon: ClipboardCheck,
    prompt: "Turn this workspace context into a clear task list with owners, next steps, and risks.",
    searchMode: "workspace",
  },
  {
    id: "decisions",
    command: "/decisions",
    title: "Extract Decisions",
    description: "Find decisions, rationale, and unresolved questions.",
    icon: BadgeCheck,
    prompt: "Extract the decisions, rationale, and open questions from this workspace context.",
    searchMode: "workspace",
  },
  {
    id: "blockers",
    command: "/blockers",
    title: "Find Blockers",
    description: "Identify risks, blockers, and missing information.",
    icon: ShieldAlert,
    prompt: "Identify blockers, risks, and missing information in this workspace context.",
    searchMode: "workspace",
  },
  {
    id: "workspace",
    command: "/workspace",
    title: "Use Workspace Search",
    description: "Answer from uploaded files and workspace memory.",
    icon: Database,
    searchMode: "workspace",
  },
  {
    id: "web",
    command: "/web",
    title: "Use Web Search",
    description: "Search the web for current external information.",
    icon: Globe2,
    searchMode: "web",
  },
  {
    id: "hybrid",
    command: "/hybrid",
    title: "Use Synthesis Search",
    description: "Blend workspace context with external web results.",
    icon: SearchCheck,
    searchMode: "hybrid",
  },
  {
    id: "attach",
    command: "/attach",
    title: "Attach Document",
    description: "Open the document uploader for this conversation.",
    icon: Paperclip,
    openUpload: true,
  },
];

function attachmentName(file: MessageAttachment) {
  return file.file_name || file.filename || "Uploaded document";
}

function formatBytes(size?: number) {
  if (!size) return "Size pending";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatInput({
  onSend,
  loading,
  onCancel,
  conversationId,
  attachments = [],
  searchMode,
  onSearchModeChange,
  onUploadSuccess,
  onRemoveAttachment,
  onTypingChange,
  draftStorageKey = null,
}: ChatInputProps) {
  const [value, setValue, clearValue] = useRecoverableTextDraft(draftStorageKey);
  const [focused, setFocused] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false);
  const [activeCommandIndex, setActiveCommandIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const slashQuery = value.startsWith("/") ? value.slice(1).trim().toLowerCase() : "";
  const slashMenuOpen = focused && value.startsWith("/") && !loading && !slashMenuDismissed;
  const filteredSlashCommands = useMemo(() => {
    if (!slashQuery) return slashCommands;
    return slashCommands.filter((command) =>
      `${command.command} ${command.title} ${command.description}`.toLowerCase().includes(slashQuery),
    );
  }, [slashQuery]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    setActiveCommandIndex(0);
  }, [slashQuery, slashMenuOpen]);

  function focusComposer() {
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function updateValue(nextValue: string) {
    setValue(nextValue);
    onTypingChange?.(Boolean(nextValue.trim()));
  }

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSend(trimmed);
    onTypingChange?.(false);
    clearValue();
  }

  function handleUploadSuccess(file: MessageAttachment) {
    logger.debug("[upload] composer received successful upload", { fileId: file.id, conversationId });
    onUploadSuccess?.(file);
  }

  function handleUploadComplete(result: { hasSuccess: boolean }) {
    logger.debug("[upload] composer upload batch complete", { conversationId, hasSuccess: result.hasSuccess });
    if (result.hasSuccess) {
      setUploadOpen(false);
    }
  }

  function runSlashCommand(command: SlashCommand) {
    if (command.searchMode) {
      onSearchModeChange(command.searchMode);
    }
    if (command.openUpload) {
      setUploadOpen(true);
    }
    updateValue(command.prompt ?? "");
    setSlashMenuDismissed(true);
    focusComposer();
  }

  return (
    <div className="relative mx-auto w-full max-w-[860px]">
      {slashMenuOpen ? (
        <div
          className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-lg border border-cyan-300/18 bg-[var(--omnix-rgba-8-16-30-0-96)] shadow-[0_20px_70px_var(--omnix-rgba-0-0-0-0-38)] backdrop-blur-[22px]"
          role="listbox"
          aria-label="Slash commands"
        >
          <div className="flex items-center justify-between gap-3 border-b border-[var(--omnix-border)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/70">Commands</p>
            <p className="hidden text-[10px] text-[var(--omnix-text-3)] sm:block">Enter to select</p>
          </div>
          <div className="max-h-[18rem] overflow-y-auto p-1.5">
            {filteredSlashCommands.length > 0 ? (
              filteredSlashCommands.map((command, index) => {
                const Icon = command.icon;
                const active = index === activeCommandIndex;
                return (
                  <button
                    key={command.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      runSlashCommand(command);
                    }}
                    onMouseEnter={() => setActiveCommandIndex(index)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-3 rounded-md px-2.5 py-2 text-left transition focus:outline-none",
                      active
                        ? "bg-cyan-300/10 text-white"
                        : "text-[var(--omnix-text-2)] hover:bg-white/[0.04] hover:text-white",
                    )}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-cyan-300/14 bg-cyan-300/[0.06] text-cyan-100">
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{command.title}</span>
                        <span className="shrink-0 rounded border border-white/8 bg-white/[0.035] px-1.5 py-0.5 font-mono text-[10px] text-cyan-100/70">
                          {command.command}
                        </span>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--omnix-text-3)]">{command.description}</span>
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="px-3 py-4 text-sm text-[var(--omnix-text-3)]">No commands match this shortcut.</div>
            )}
          </div>
        </div>
      ) : null}
      {!slashMenuOpen ? (
        <div className="absolute -top-9 left-0 flex items-center gap-1.5">
          {["Suggest ideas", "Summarize"].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                if (!value.trim()) {
                  updateValue(label === "Summarize" ? "Summarize this workspace context." : "Suggest ideas for this workspace.");
                }
              }}
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-white/5 bg-white/[0.02] px-3 text-[10px] font-medium uppercase tracking-wider text-white/40 transition hover:border-white/10 hover:bg-white/[0.04] hover:text-white"
            >
              <Sparkles className="h-2.5 w-2.5 text-cyan-400/40" />
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <motion.div
        animate={{
          borderColor: focused ? "var(--omnix-rgba-0-255-255-0-45)" : "var(--omnix-rgba-0-255-255-0-12)",
          boxShadow: focused
            ? "0 0 0 3px var(--omnix-rgba-0-255-255-0-08), var(--omnix-glow-sm), 0 18px 70px var(--omnix-rgba-0-0-0-0-28)"
            : "0 12px 38px var(--omnix-rgba-0-0-0-0-26)",
        }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="relative z-20 w-full overflow-hidden rounded-[15px] border bg-[var(--omnix-rgba-8-16-30-0-9)] shadow-[0_18px_70px_var(--omnix-rgba-0-0-0-0-34)] backdrop-blur-[22px]"
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--omnix-rgba-0-255-255-0-68),transparent)]" />
        <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-[radial-gradient(circle,var(--omnix-rgba-0-255-255-0-16),transparent_70%)] blur-2xl" />
        {attachments.length > 0 ? (
          <div className="m-3 mb-0 flex flex-wrap gap-2 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-2">
            {attachments.map((file) => (
              <div
                key={file.id}
                className="group/file inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-2 py-1.5 text-xs text-cyan-50 sm:max-w-[260px] sm:py-2"
              >
                <FileText className="h-4 w-4 shrink-0 text-cyan-200" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{attachmentName(file)}</p>
                  <p className="text-[10px] text-cyan-100/60 sm:text-[11px]">{formatBytes(file.size_bytes)}</p>
                </div>
                <button
                  type="button"
                  className="ml-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-cyan-100/55 transition hover:bg-cyan-300/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
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
          <div className="m-3 mb-0 rounded-lg border border-[var(--omnix-border)] bg-black/20 p-2">
            <UploadDropzone
              compact
              conversationId={conversationId}
              onUploadSuccess={handleUploadSuccess}
              onUploadComplete={handleUploadComplete}
            />
          </div>
        ) : null}

        <Textarea
          ref={textareaRef}
          aria-label="Message composer"
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            setSlashMenuDismissed(false);
            setValue(nextValue);
            onTypingChange?.(Boolean(nextValue.trim()));
          }}
          onFocus={() => {
            setFocused(true);
            if (value.trim()) onTypingChange?.(true);
          }}
          onBlur={() => {
            setFocused(false);
            onTypingChange?.(false);
          }}
          onKeyDown={(event) => {
            if (slashMenuOpen) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveCommandIndex((index) =>
                  filteredSlashCommands.length === 0 ? 0 : (index + 1) % filteredSlashCommands.length,
                );
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveCommandIndex((index) =>
                  filteredSlashCommands.length === 0
                    ? 0
                    : (index - 1 + filteredSlashCommands.length) % filteredSlashCommands.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                if (filteredSlashCommands[activeCommandIndex]) {
                  runSlashCommand(filteredSlashCommands[activeCommandIndex]);
                }
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setSlashMenuDismissed(true);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder="Type a message or '/' for commands..."
          disabled={loading}
          className="block max-h-40 !min-h-[54px] resize-none !rounded-none !border-transparent !bg-transparent px-[15px] py-[13px] text-sm leading-[1.6] text-white !shadow-none outline-none transition placeholder:text-[var(--omnix-text-3)] hover:!border-transparent focus:!border-transparent focus:!bg-transparent focus:!ring-0 disabled:cursor-not-allowed disabled:opacity-70 sm:text-base"
        />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-0-0-0-2)] px-2.5 py-2.5 transition focus-within:bg-[var(--omnix-surface)] sm:px-3">
          <div className="omnix-scrollbar flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5 min-[420px]:flex-wrap min-[420px]:overflow-visible min-[420px]:pb-0">
            <Button
              type="button"
              variant={uploadOpen ? "secondary" : "ghost"}
              size={"icon"}
              aria-label={uploadOpen ? "Hide document upload" : "Attach document"}
              title={uploadOpen ? "Hide document upload" : "Attach document"}
              onClick={() => setUploadOpen((current) => !current)}
              className={cn("h-11 w-11 rounded-[7px] border border-transparent text-[var(--omnix-text-3)] hover:bg-[var(--omnix-surface)] hover:text-white", uploadOpen && "border-cyan-300/25 bg-cyan-300/10 text-cyan-100")}
            >
              <Paperclip className={cn("h-4 w-4 transition-transform sm:h-3.5 sm:w-3.5", uploadOpen && "rotate-45")} />
            </Button>
            <div className="mx-1 h-3.5 w-px bg-[var(--omnix-border)]" />
            {searchModes.map((mode) => {
              const Icon = mode.icon;
              const active = searchMode === mode.value;
              return (
                <button
                  key={mode.value}
                  type="button"
                  onClick={() => onSearchModeChange(mode.value)}
                  className={cn(
                    "inline-flex min-h-11 min-w-11 items-center gap-1.5 rounded-[7px] border px-3 text-[11px] font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70",
                    active
                      ? "border-cyan-300/35 bg-cyan-300/12 text-cyan-50 shadow-[var(--omnix-glow-xs)]"
                      : "border-transparent text-[var(--omnix-text-3)] hover:bg-[var(--omnix-surface)] hover:text-slate-100",
                  )}
                  aria-label={`${mode.label} search mode`}
                  aria-pressed={active}
                  title={`${mode.label} search mode`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0 sm:h-3 sm:w-3" />
                  <span className={cn(!active && "max-[480px]:sr-only")}>{mode.label}</span>
                </button>
              );
            })}
          </div>
          <div className="flex items-center justify-end gap-2">
            <span className="hidden text-[10px] tracking-[0.04em] text-[var(--omnix-text-3)] sm:inline">
              Return to send
            </span>
            {loading ? (
              <Button
                type="button"
                size={"icon"}
                aria-label="Stop generating"
                title="Stop generating"
                onClick={() => onCancel?.()}
                className="h-11 w-11 rounded-lg border-0 bg-rose-500/20 text-rose-300 shadow-[var(--omnix-glow-sm)] hover:bg-rose-500/40 hover:text-white"
              >
                <Square className="h-4 w-4 fill-current sm:h-3.5 sm:w-3.5" />
              </Button>
            ) : (
              <Button
                type="button"
                size={"icon"}
                aria-label="Send message"
                title="Send message"
                disabled={!value.trim()}
                onClick={submit}
                className="h-11 w-11 rounded-lg border-0 bg-[var(--omnix-grad-primary)] text-[var(--omnix-bg)] shadow-[var(--omnix-glow-sm)] hover:shadow-[var(--omnix-glow-md)] disabled:bg-[var(--omnix-surface)] disabled:text-[var(--omnix-text-3)] disabled:shadow-none"
              >
                <Send className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
