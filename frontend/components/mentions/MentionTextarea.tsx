"use client";

import { useMemo, useRef, useState } from "react";
import type { KeyboardEvent, TextareaHTMLAttributes } from "react";
import { AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceMentionInput, WorkspaceMentionMetadata, WorkspaceMember } from "@/lib/workspace-types";

type MentionTrigger = {
  start: number;
  end: number;
  query: string;
};

type MentionTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  members: WorkspaceMember[];
  mentions: WorkspaceMentionMetadata[];
  onMentionsChange: (mentions: WorkspaceMentionMetadata[]) => void;
};

function cleanLabel(value: string | null | undefined, fallback: string) {
  let base = (value || "").trim();
  if (base.includes("@") && !base.startsWith("@")) {
    base = base.split("@", 1)[0];
  }
  base = base.replace(/^@/, "").split(/\s+/)[0] || "";
  const label = Array.from(base)
    .filter((char) => /[a-zA-Z0-9_.-]/.test(char))
    .join("")
    .replace(/^[_.-]+|[_.-]+$/g, "");
  return label.slice(0, 40) || fallback.slice(0, 1).toUpperCase() || "U";
}

function displayName(member: WorkspaceMember) {
  return member.full_name || member.handle || member.email || member.user_id;
}

export function memberToMention(member: WorkspaceMember): WorkspaceMentionMetadata {
  const label = cleanLabel(member.handle || member.full_name || member.email, member.avatar_label || "U");
  return {
    user_id: member.user_id,
    label,
    display_name: displayName(member),
    email: member.email ?? null,
    avatar_url: member.avatar_url ?? null,
    avatar_label: member.avatar_label || "U",
    operational_label: member.operational_label ?? null,
  };
}

export function mentionPayload(mentions: WorkspaceMentionMetadata[], content?: string): WorkspaceMentionInput[] {
  const seen = new Set<string>();
  const contentLower = content?.toLowerCase() ?? null;
  return mentions
    .filter((mention) => {
      if (!mention.user_id || seen.has(mention.user_id)) return false;
      if (contentLower) {
        const label = cleanLabel(mention.label || mention.display_name || mention.email, mention.avatar_label || "U").toLowerCase();
        if (!contentLower.includes(`@${label}`)) return false;
      }
      seen.add(mention.user_id);
      return true;
    })
    .map((mention) => ({ user_id: mention.user_id }));
}

function activeMentionTrigger(value: string, caret: number): MentionTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/(^|\s)@([a-zA-Z0-9_.-]{0,40})$/);
  if (!match) return null;
  const query = match[2] || "";
  return {
    start: caret - query.length - 1,
    end: caret,
    query,
  };
}

function filterMembers(members: WorkspaceMember[], query: string) {
  const needle = query.trim().toLowerCase();
  return members
    .filter((member) => {
      if (!needle) return true;
      const haystack = [
        member.full_name,
        member.handle,
        member.email,
        member.operational_label,
      ].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(needle);
    })
    .slice(0, 8);
}

export function MentionTextarea({
  value,
  onChange,
  members,
  mentions,
  onMentionsChange,
  className,
  onKeyDown,
  disabled,
  ...props
}: MentionTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const candidates = useMemo(() => filterMembers(members, trigger?.query || ""), [members, trigger?.query]);
  const pickerOpen = Boolean(trigger && candidates.length);

  function updateTrigger(nextValue: string, caret: number) {
    const nextTrigger = activeMentionTrigger(nextValue, caret);
    setTrigger(nextTrigger);
    setActiveIndex(0);
  }

  function selectMember(member: WorkspaceMember) {
    if (!trigger || disabled) return;
    const mention = memberToMention(member);
    const replacement = `@${mention.label} `;
    const nextValue = `${value.slice(0, trigger.start)}${replacement}${value.slice(trigger.end)}`;
    onChange(nextValue);
    onMentionsChange([
      ...mentions.filter((entry) => entry.user_id !== mention.user_id),
      mention,
    ]);
    setTrigger(null);
    const caret = trigger.start + replacement.length;
    window.setTimeout(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    }, 0);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (pickerOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % candidates.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + candidates.length) % candidates.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectMember(candidates[activeIndex] || candidates[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setTrigger(null);
        return;
      }
    }
    onKeyDown?.(event);
  }

  return (
    <div className="relative min-w-0">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          updateTrigger(event.target.value, event.target.selectionStart ?? event.target.value.length);
        }}
        onClick={(event) => updateTrigger(value, event.currentTarget.selectionStart ?? value.length)}
        onKeyUp={(event) => {
          if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(event.key)) return;
          updateTrigger(event.currentTarget.value, event.currentTarget.selectionStart ?? event.currentTarget.value.length);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={className}
        {...props}
      />
      {pickerOpen ? (
        <div className="absolute bottom-full left-0 z-30 mb-2 w-full max-w-[min(22rem,calc(100vw_-_2rem))] overflow-hidden rounded-xl border border-cyan-300/18 bg-[rgba(7,18,24,0.96)] shadow-2xl shadow-cyan-950/30 backdrop-blur-xl">
          <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/60">
            <AtSign className="h-3.5 w-3.5" />
            Mention teammate
          </div>
          <div className="omnix-scrollbar max-h-64 overflow-y-auto p-1.5">
            {candidates.map((member, index) => {
              const isActive = index === activeIndex;
              return (
                <button
                  type="button"
                  key={member.user_id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    selectMember(member);
                  }}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition",
                    isActive ? "bg-cyan-300/[0.12] text-white" : "text-[var(--omnix-text-2)] hover:bg-white/[0.04] hover:text-white",
                  )}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/16 bg-cyan-300/[0.07] text-[11px] font-semibold text-cyan-100">
                    {member.avatar_label || "U"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{displayName(member)}</span>
                    {member.operational_label ? (
                      <span className="block truncate text-[11px] text-cyan-100/45">{member.operational_label}</span>
                    ) : null}
                  </span>
                  <span className="text-[11px] text-cyan-100/40">@{memberToMention(member).label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
