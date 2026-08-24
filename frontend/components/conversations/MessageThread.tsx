"use client";

import type { FormEvent, ReactNode } from "react";
import {
  BadgeCheck,
  ClipboardCheck,
  CornerDownRight,
  FileText,
  Loader2,
  MessagesSquare,
  SendHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { MentionText } from "@/components/mentions/MentionText";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";
import {
  type DisplayMessage,
  messageHasPersistedActions,
  messageAuthor,
  messageIdentity,
  readableTime,
} from "@/components/conversations/conversationUtils";
import { cn } from "@/lib/utils";
import type {
  TypingSignal,
  WorkspaceChannel,
  WorkspaceChannelMessage,
  WorkspaceMentionMetadata,
  WorkspaceMember,
} from "@/lib/workspace-types";

type ConversationMessageRowProps = {
  message: DisplayMessage;
  onOpenDecision: (message: WorkspaceChannelMessage) => void;
  onOpenTask: (message: WorkspaceChannelMessage) => void;
  onOpenThread?: (message: WorkspaceChannelMessage) => void;
  threaded?: boolean;
};

export function ConversationMessageRow({
  message,
  onOpenDecision,
  onOpenTask,
  onOpenThread,
  threaded = false,
}: ConversationMessageRowProps) {
  const identity = messageIdentity(message);
  const hasPersistedActions = messageHasPersistedActions(message);

  return (
    <article
      className={cn(
        "group rounded-xl border border-transparent px-3 py-3 transition hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-rgba-0-255-255-0-025)]",
        message.delivery === "failed" && "border-rose-400/20",
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/7 text-[11px] font-semibold text-cyan-100">
          {message.author_avatar_label || "U"}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-semibold text-white">{messageAuthor(message)}</span>
            {identity ? (
              <span className="max-w-full break-words text-[11px] font-medium tracking-[0.01em] text-cyan-100/48">
                {identity}
              </span>
            ) : null}
            <time className="text-[11px] text-[var(--omnix-text-3)]">{readableTime(message.created_at)}</time>
            {message.delivery === "sending" ? <span className="text-[10px] text-cyan-200/60">sending</span> : null}
            {message.delivery === "failed" ? <span className="text-[10px] text-rose-200">delivery failed</span> : null}
          </div>
          <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--omnix-text)]">
            <MentionText content={message.content} mentions={message.mentions} />
          </p>
          {message.context_links.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {message.context_links.map((link) => (
                <span key={`${link.entity_type}-${link.entity_id}`} className="inline-flex max-w-full items-center gap-1 rounded-md border border-cyan-300/15 bg-cyan-300/5 px-2 py-1 text-[10px] text-cyan-100">
                  <FileText className="h-3 w-3" />
                  <span className="min-w-0 truncate">{link.label || link.entity_type}</span>
                </span>
              ))}
            </div>
          ) : null}
          {hasPersistedActions ? (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {!threaded && onOpenThread ? (
                <button
                  type="button"
                  onClick={() => onOpenThread(message)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100"
                >
                  <CornerDownRight className="h-3.5 w-3.5" />
                  {message.thread_reply_count ? `${message.thread_reply_count} thread replies` : "Open thread"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onOpenTask(message)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100"
              >
                <ClipboardCheck className="h-3.5 w-3.5" />
                Track as task
              </button>
              <button
                type="button"
                onClick={() => onOpenDecision(message)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100"
              >
                <BadgeCheck className="h-3.5 w-3.5" />
                Convert to Decision
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

type MessageThreadProps = {
  activeMembers: WorkspaceMember[];
  aiPanel: ReactNode;
  channelTyping: TypingSignal[];
  draft: string;
  draftMentions: WorkspaceMentionMetadata[];
  hasOlderMessages: boolean;
  loadingOlderMessages: boolean;
  mayPost: boolean;
  messages: DisplayMessage[];
  messagesLoading: boolean;
  onDraftChange: (value: string) => void;
  onDraftMentionsChange: (mentions: WorkspaceMentionMetadata[]) => void;
  onLoadOlderMessages: () => void;
  onOpenDecision: (message: WorkspaceChannelMessage) => void;
  onOpenTask: (message: WorkspaceChannelMessage) => void;
  onOpenThread: (message: WorkspaceChannelMessage) => void;
  onSend: (content: string, parentMessageId?: string, mentions?: WorkspaceMentionMetadata[]) => void;
  onTypingChange: (isTyping: boolean) => void;
  selectedChannel: WorkspaceChannel | null;
  sending: boolean;
};

export function MessageThread({
  activeMembers,
  aiPanel,
  channelTyping,
  draft,
  draftMentions,
  hasOlderMessages,
  loadingOlderMessages,
  mayPost,
  messages,
  messagesLoading,
  onDraftChange,
  onDraftMentionsChange,
  onLoadOlderMessages,
  onOpenDecision,
  onOpenTask,
  onOpenThread,
  onSend,
  onTypingChange,
  selectedChannel,
  sending,
}: MessageThreadProps) {
  function sendDraft() {
    const content = draft.trim();
    if (!content || !mayPost || sending) return;
    const mentions = draftMentions;
    onTypingChange(false);
    onSend(content, undefined, mentions);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendDraft();
  }

  return (
    <main className="omnix-panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--omnix-border)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{selectedChannel?.name || "Conversation"}</h2>
          <p className="mt-0.5 break-words text-xs text-[var(--omnix-text-2)]">{selectedChannel?.purpose || "Workspace operational discussion."}</p>
        </div>
      </div>
      {aiPanel}
      <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3 sm:px-3">
        {messagesLoading ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
        {hasOlderMessages ? (
          <div className="flex flex-wrap items-center justify-center gap-2 px-2 pb-2">
            <Button type="button" size="sm" variant="ghost" onClick={onLoadOlderMessages} isLoading={loadingOlderMessages}>
              Load Earlier Messages
            </Button>
            <p role="status" aria-live="polite" className="text-[11px] text-[var(--omnix-text-3)]">
              {loadingOlderMessages ? "Loading earlier messages…" : "Earlier discussion is available."}
            </p>
          </div>
        ) : null}
        {!messagesLoading && messages.length === 0 ? (
          <div className="mx-auto mt-14 max-w-sm text-center">
            <MessagesSquare className="mx-auto h-7 w-7 text-cyan-100/35" />
            <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No operational discussion yet.</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Capture coordination, context, and decisions when work begins.</p>
          </div>
        ) : null}
        {messages.map((message) => (
          <ConversationMessageRow
            key={message.id}
            message={message}
            onOpenDecision={onOpenDecision}
            onOpenTask={onOpenTask}
            onOpenThread={onOpenThread}
          />
        ))}
      </div>
      {channelTyping.length ? (
        <p className="px-5 pb-2 text-[11px] text-cyan-100/55">
          {channelTyping.length === 1 ? `${channelTyping[0].fullName} is drafting an update` : `${channelTyping.length} teammates are drafting updates`}
        </p>
      ) : null}
      <form className="border-t border-[var(--omnix-border)] p-3 sm:p-4" onSubmit={submit}>
        <MentionTextarea
          value={draft}
          onChange={(nextValue) => {
            onDraftChange(nextValue);
            onTypingChange(Boolean(nextValue.trim()));
          }}
          members={activeMembers}
          mentions={draftMentions}
          onMentionsChange={onDraftMentionsChange}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              sendDraft();
            }
          }}
          placeholder={
            !selectedChannel
              ? "Select a channel"
              : mayPost
                ? "Write an operational update..."
                : "Updates in this channel are published by workspace leads."
          }
          disabled={!mayPost || sending}
          className="omnix-input min-h-[72px] w-full resize-none rounded-xl px-3 py-2.5 text-sm leading-6"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="min-w-0 break-words text-[10px] text-[var(--omnix-text-3)]">Context links for tasks, decisions, files, and initiatives are structurally ready.</p>
          <Button type="submit" size="sm" disabled={!draft.trim() || !mayPost || sending} leftIcon={<SendHorizontal className="h-3.5 w-3.5" />}>
            Send
          </Button>
        </div>
      </form>
    </main>
  );
}
