"use client";

import { useState } from "react";
import {
  type DisplayMessage,
  chronological,
  mergeMessage,
} from "@/components/conversations/conversationUtils";
import { mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { ambientConversationIdentity } from "@/lib/workspace-roles";
import type {
  WorkspaceChannelMessage,
  WorkspaceMentionMetadata,
  WorkspaceRole,
} from "@/lib/workspace-types";

type SenderIdentity = {
  currentUserId: string;
  email?: string | null;
  fullName?: string | null;
  operationalLabel?: string | null;
  role?: WorkspaceRole | null;
  workspaceRole?: WorkspaceRole | null;
};

type UseWorkspaceConversationSenderParams = {
  activeWorkspaceId: string | null;
  identity: SenderIdentity;
  loadChannels: () => void;
  loadMessages: (channelId: string) => void;
  mayPost: boolean;
  selectedChannelId: string | null;
  sendTypingSignal: (conversationId?: string | null, isTyping?: boolean) => Promise<void>;
  setError: (message: string) => void;
  setMessages: (updater: (current: DisplayMessage[]) => DisplayMessage[]) => void;
  setThreadMessages: (updater: (current: DisplayMessage[]) => DisplayMessage[]) => void;
};

export function useWorkspaceConversationSender({
  activeWorkspaceId,
  identity,
  loadChannels,
  loadMessages,
  mayPost,
  selectedChannelId,
  sendTypingSignal,
  setError,
  setMessages,
  setThreadMessages,
}: UseWorkspaceConversationSenderParams) {
  const [draft, setDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [threadDraftMentions, setThreadDraftMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [sending, setSending] = useState(false);
  const [threadSending, setThreadSending] = useState(false);

  function optimisticMessage(content: string, nonce: string, parentMessageId?: string, mentions: WorkspaceMentionMetadata[] = []): DisplayMessage {
    return {
      id: `pending-${nonce}`,
      workspace_id: activeWorkspaceId || "",
      channel_id: selectedChannelId || "",
      author_user_id: identity.currentUserId,
      parent_message_id: parentMessageId || null,
      content,
      context_links: [],
      metadata: mentions.length ? { mentions } : {},
      mentions,
      client_nonce: nonce,
      created_at: new Date().toISOString(),
      author_name: identity.fullName || identity.email || "You",
      author_avatar_label: (identity.email || "Y")[0].toUpperCase(),
      author_identity: ambientConversationIdentity(identity.role || identity.workspaceRole, identity.operationalLabel),
      thread_reply_count: 0,
      delivery: "sending",
    };
  }

  async function sendMessage(content: string, parentMessageId?: string, mentions: WorkspaceMentionMetadata[] = []) {
    if (!activeWorkspaceId || !selectedChannelId || !mayPost || !content.trim()) return;
    const cleaned = content.trim();
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const optimistic = optimisticMessage(cleaned, nonce, parentMessageId, mentions);
    const inThread = Boolean(parentMessageId);
    if (inThread) setThreadMessages((current) => chronological([...current, optimistic]));
    else setMessages((current) => chronological([...current, optimistic]));
    if (inThread) setThreadSending(true);
    else setSending(true);

    try {
      const created = await apiClient.post<WorkspaceChannelMessage>(`/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/messages`, {
        content: cleaned,
        parent_message_id: parentMessageId || null,
        client_nonce: nonce,
        context_links: [],
        mentions: mentionPayload(mentions, cleaned),
      });
      if (inThread) {
        setThreadMessages((current) => mergeMessage(current, created));
        setThreadDraft("");
        setThreadDraftMentions([]);
        loadMessages(selectedChannelId);
      } else {
        setMessages((current) => mergeMessage(current, created));
        setDraft("");
        setDraftMentions([]);
      }
      await sendTypingSignal(selectedChannelId, false);
      loadChannels();
    } catch (err) {
      const markFailed = (current: DisplayMessage[]) =>
        current.map((message) => message.client_nonce === nonce ? { ...message, delivery: "failed" as const } : message);
      if (inThread) setThreadMessages(markFailed);
      else setMessages(markFailed);
      logClientError("Failed to deliver message", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/messages` });
      setError("Unable to deliver message.");
    } finally {
      if (inThread) setThreadSending(false);
      else setSending(false);
    }
  }

  return {
    draft,
    draftMentions,
    sending,
    sendMessage,
    setDraft,
    setDraftMentions,
    setThreadDraft,
    setThreadDraftMentions,
    threadDraft,
    threadDraftMentions,
    threadSending,
  };
}
