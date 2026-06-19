import type { Message, MessageAttachment } from "@/components/chat/types";
import { formatChatTime, type SenderLookup } from "@/components/chat/chatMessageUtils";
import { initialsFromText } from "@/lib/workspace-roles";

type OptimisticUserMessageParams = {
  activeWorkspaceRole?: Message["senderRole"];
  attachments: MessageAttachment[];
  content: string;
  messageId: string;
  senderLookup: SenderLookup;
  userEmail?: string | null;
  userId?: string | null;
};

export function createOptimisticUserMessage({
  activeWorkspaceRole,
  attachments,
  content,
  messageId,
  senderLookup,
  userEmail,
  userId,
}: OptimisticUserMessageParams): Message {
  return {
    id: messageId,
    role: "user",
    userId: userId ?? null,
    senderName: "You",
    senderEmail: userEmail ?? null,
    senderAvatar: initialsFromText(senderLookup.currentUserName || userEmail || "You"),
    senderAvatarUrl: senderLookup.currentUserAvatarUrl ?? null,
    senderHandle: senderLookup.currentUserHandle ?? null,
    senderRole: activeWorkspaceRole ?? "member",
    isOwn: true,
    content,
    timestamp: formatChatTime(),
    createdAt: new Date().toISOString(),
    status: "sending",
    attachments,
  };
}

export function mergeStreamInitMessages(
  current: Message[],
  messageId: string,
  persistedUserMessageId: string | null,
  assistantId: string,
  sources: Message["sources"],
): Message[] {
  const next = current.map((message) =>
    message.id === messageId ? { ...message, id: persistedUserMessageId ?? message.id, status: "sent" as const } : message,
  );

  if (next.some((message) => message.id === assistantId)) {
    return next.map((message) =>
      message.id === assistantId ? { ...message, status: "streaming" as const, isStreaming: true, sources: sources ?? message.sources ?? [] } : message,
    );
  }

  return [
    ...next,
    {
      id: assistantId,
      role: "assistant",
      senderName: "Omnix",
      senderAvatar: "OX",
      senderRole: "assistant",
      isOwn: false,
      content: "",
      timestamp: formatChatTime(),
      createdAt: new Date().toISOString(),
      status: "streaming" as const,
      isStreaming: true,
      sources: sources ?? [],
    },
  ];
}
