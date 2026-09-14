"use client";

import type { ApiMessage, Message, MessageAttachment } from "@/components/chat/types";
import {
  type SenderLookup,
  normalizeMessage,
  timestampMs,
} from "@/components/chat/chatMessageUtils";
import { apiClient } from "@/lib/api";

export function attachFilesToMessages(messages: Message[], files: MessageAttachment[]) {
  if (!files.length) return messages;
  const userMessages = messages.filter((message) => message.role === "user");
  if (!userMessages.length) return messages;

  const attachmentsByMessageId = new Map<string, MessageAttachment[]>();
  for (const file of [...files].sort((a, b) => (timestampMs(a.created_at) || 0) - (timestampMs(b.created_at) || 0))) {
    const fileTime = timestampMs(file.created_at);
    const target =
      userMessages.find((message) => {
        const messageTime = timestampMs(message.createdAt);
        return !Number.isNaN(fileTime) && !Number.isNaN(messageTime) && messageTime >= fileTime - 30_000;
      }) ?? userMessages[userMessages.length - 1];
    const existing = attachmentsByMessageId.get(target.id) ?? [];
    if (!existing.some((item) => item.id === file.id)) attachmentsByMessageId.set(target.id, [...existing, file]);
  }

  return messages.map((message) => {
    const attachments = attachmentsByMessageId.get(message.id);
    return attachments?.length ? { ...message, attachments: [...(message.attachments ?? []), ...attachments] } : message;
  });
}

export async function fetchConversationSnapshot(convId: string, senderLookup: SenderLookup) {
  const [data, files] = await Promise.all([
    apiClient.get<ApiMessage[]>(`/conversations/${convId}/messages`),
    apiClient.get<MessageAttachment[]>(`/files?conversation_id=${encodeURIComponent(convId)}`).catch((err) => {
      console.error("Failed to load conversation files", err);
      return [];
    }),
  ]);
  return attachFilesToMessages(data.map((message, index) => normalizeMessage(message, index, senderLookup)), files);
}
