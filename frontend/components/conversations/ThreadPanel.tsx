"use client";

import type { FormEvent } from "react";
import { ArrowRight, Loader2, X } from "lucide-react";
import { ConversationMessageRow } from "@/components/conversations/MessageThread";
import type { DisplayMessage } from "@/components/conversations/conversationUtils";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";
import { Button } from "@/components/ui/Button";
import type {
  WorkspaceChannelMessage,
  WorkspaceMentionMetadata,
  WorkspaceMember,
} from "@/lib/workspace-types";

type ThreadPanelProps = {
  activeMembers: WorkspaceMember[];
  mayPost: boolean;
  onClose: () => void;
  onOpenDecision: (message: WorkspaceChannelMessage) => void;
  onOpenTask: (message: WorkspaceChannelMessage) => void;
  onSend: (content: string, parentMessageId?: string, mentions?: WorkspaceMentionMetadata[]) => void;
  onThreadDraftChange: (value: string) => void;
  onThreadDraftMentionsChange: (mentions: WorkspaceMentionMetadata[]) => void;
  onTypingChange: (isTyping: boolean) => void;
  threadDraft: string;
  threadDraftMentions: WorkspaceMentionMetadata[];
  threadLoading: boolean;
  threadMessages: DisplayMessage[];
  threadRoot: WorkspaceChannelMessage | null;
  threadSending: boolean;
};

export function ThreadPanel({
  activeMembers,
  mayPost,
  onClose,
  onOpenDecision,
  onOpenTask,
  onSend,
  onThreadDraftChange,
  onThreadDraftMentionsChange,
  onTypingChange,
  threadDraft,
  threadDraftMentions,
  threadLoading,
  threadMessages,
  threadRoot,
  threadSending,
}: ThreadPanelProps) {
  const root = threadRoot;
  if (!root) return null;
  const rootId = root.id;

  function sendThreadDraft() {
    const content = threadDraft.trim();
    if (!content || !mayPost || threadSending) return;
    const mentions = threadDraftMentions;
    onThreadDraftChange("");
    onThreadDraftMentionsChange([]);
    onTypingChange(false);
    onSend(content, rootId, mentions);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendThreadDraft();
  }

  return (
    <aside className="omnix-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl lg:min-h-[22rem]">
      <div className="flex items-center justify-between border-b border-[var(--omnix-border)] px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Operational thread</p>
          <p className="mt-1 text-xs text-[var(--omnix-text-2)]">Focused follow-through</p>
        </div>
        <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/40 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" aria-label="Close thread">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {threadLoading ? <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-cyan-100/50" /> : null}
        {threadMessages.map((message) => (
          <ConversationMessageRow
            key={message.id}
            message={message}
            threaded
            onOpenDecision={onOpenDecision}
            onOpenTask={onOpenTask}
          />
        ))}
      </div>
      <form className="border-t border-[var(--omnix-border)] p-3" onSubmit={submit}>
        <MentionTextarea
          value={threadDraft}
          onChange={(nextValue) => {
            onThreadDraftChange(nextValue);
            onTypingChange(Boolean(nextValue.trim()));
          }}
          members={activeMembers}
          mentions={threadDraftMentions}
          onMentionsChange={onThreadDraftMentionsChange}
          placeholder="Add focused follow-through..."
          disabled={!mayPost || threadSending}
          className="omnix-input h-20 w-full resize-none rounded-lg p-2.5 text-sm leading-6"
        />
        <Button type="submit" size="sm" className="mt-2 w-full" disabled={!threadDraft.trim() || !mayPost || threadSending} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
          Reply in thread
        </Button>
      </form>
    </aside>
  );
}
