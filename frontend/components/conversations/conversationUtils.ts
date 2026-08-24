import type {
  DecisionCandidate,
  WorkspaceChannel,
  WorkspaceChannelMessage,
  WorkspaceConversationAssistance,
  WorkspaceDecisionStatus,
  WorkspaceMember,
} from "@/lib/workspace-types";
import { ambientConversationIdentity } from "@/lib/workspace-roles";

export type DisplayMessage = WorkspaceChannelMessage & {
  delivery?: "sending" | "failed";
};

export type ConversationMutationScope = {
  workspaceId: string | null;
  channelId?: string | null;
  sourceId?: string | null;
};

export type ConversationSourceScope = {
  workspaceId: string;
  channelId: string;
  threadRootId: string | null;
};

export type TaskSource =
  | { kind: "message"; message: WorkspaceChannelMessage; scope: ConversationSourceScope }
  | { kind: "assistance"; assistance: WorkspaceConversationAssistance; scope: ConversationSourceScope };

export type DecisionSource =
  | { kind: "message"; message: WorkspaceChannelMessage; scope: ConversationSourceScope }
  | { kind: "candidate"; candidate: DecisionCandidate; scope: ConversationSourceScope };

export type WorkspaceChannelRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<WorkspaceChannel> | null;
  old?: Partial<WorkspaceChannel> | null;
};

export const decisionStatusLabels: Record<WorkspaceDecisionStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
};

export function chronological(messages: DisplayMessage[]) {
  return [...messages].sort(
    (a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || ""),
  );
}

export function mergeMessage(current: DisplayMessage[], incoming: DisplayMessage) {
  const previous = current.find(
    (message) =>
      message.id === incoming.id ||
      Boolean(incoming.client_nonce && message.client_nonce === incoming.client_nonce),
  );
  const metadata = incoming.metadata && typeof incoming.metadata === "object"
    ? incoming.metadata
    : previous?.metadata ?? {};
  const metadataMentions = Array.isArray(metadata.mentions)
    ? metadata.mentions as WorkspaceChannelMessage["mentions"]
    : undefined;
  const owns = (key: keyof DisplayMessage) =>
    Object.prototype.hasOwnProperty.call(incoming, key);
  const merged: DisplayMessage = {
    ...previous,
    ...incoming,
    context_links: Array.isArray(incoming.context_links)
      ? incoming.context_links
      : previous?.context_links ?? [],
    metadata,
    mentions: Array.isArray(incoming.mentions)
      ? incoming.mentions
      : metadataMentions ?? previous?.mentions ?? [],
    author_name: owns("author_name") ? incoming.author_name : previous?.author_name,
    author_email: owns("author_email") ? incoming.author_email : previous?.author_email,
    author_avatar_url: owns("author_avatar_url")
      ? incoming.author_avatar_url
      : previous?.author_avatar_url,
    author_avatar_label: owns("author_avatar_label")
      ? incoming.author_avatar_label
      : previous?.author_avatar_label
        ?? incoming.author_user_id?.slice(0, 1).toUpperCase()
        ?? "U",
    author_identity: owns("author_identity")
      ? incoming.author_identity
      : previous?.author_identity,
    thread_reply_count: owns("thread_reply_count")
      && typeof incoming.thread_reply_count === "number"
      ? incoming.thread_reply_count
      : previous?.thread_reply_count ?? 0,
    delivery: owns("delivery") ? incoming.delivery : undefined,
  };
  const filtered = current.filter(
    (message) =>
      message.id !== incoming.id &&
      !(incoming.client_nonce && message.client_nonce === incoming.client_nonce),
  );
  return chronological([...filtered, merged]);
}

export function markOptimisticMessageFailed(
  current: DisplayMessage[],
  nonce: string,
) {
  const pendingId = `pending-${nonce}`;
  let changed = false;
  const next = current.map((message) => {
    if (
      message.id !== pendingId
      || message.client_nonce !== nonce
      || message.delivery !== "sending"
    ) {
      return message;
    }
    changed = true;
    return { ...message, delivery: "failed" as const };
  });
  return changed ? next : current;
}

export function messageHasPersistedActions(message: DisplayMessage) {
  return !message.delivery && !message.id.startsWith("pending-");
}

export function persistedMessageForNonce(
  current: DisplayMessage[],
  nonce: string,
) {
  return current.find(
    (message) =>
      message.client_nonce === nonce
      && messageHasPersistedActions(message),
  );
}

export function messageMatchesConversationMutation(
  message: WorkspaceChannelMessage,
  scope: ConversationMutationScope,
  nonce: string,
  parentMessageId?: string,
) {
  return message.workspace_id === scope.workspaceId
    && message.channel_id === scope.channelId
    && (message.parent_message_id || null) === (parentMessageId || null)
    && message.client_nonce === nonce;
}

export function conversationMutationScopeMatches(
  request: ConversationMutationScope,
  current: ConversationMutationScope,
) {
  return request.workspaceId === current.workspaceId
    && (request.channelId === undefined || request.channelId === current.channelId)
    && (request.sourceId === undefined || request.sourceId === current.sourceId);
}

export function conversationSourceScopeMatches(
  source: ConversationSourceScope,
  workspaceId: string | null,
  channelId: string | null,
  threadRootId: string | null,
) {
  return source.workspaceId === workspaceId
    && source.channelId === channelId
    && (source.threadRootId === null || source.threadRootId === threadRootId);
}

export function mergeMessagePage(current: DisplayMessage[], incoming: WorkspaceChannelMessage[]) {
  return incoming.reduce<DisplayMessage[]>((merged, message) => mergeMessage(merged, message), current);
}

export function incrementThreadReplyCount(current: DisplayMessage[], reply: WorkspaceChannelMessage) {
  if (!reply.parent_message_id) return current;
  return current.map((message) => (
    message.id === reply.parent_message_id
      ? { ...message, thread_reply_count: (message.thread_reply_count ?? 0) + 1 }
      : message
  ));
}

export function hydrateConversationMessageAuthor(
  message: WorkspaceChannelMessage,
  members: WorkspaceMember[],
) {
  const author = members.find((member) => member.user_id === message.author_user_id);
  if (!author) return message;
  return {
    ...message,
    author_name: author.full_name || author.handle || null,
    author_email: author.email || null,
    author_avatar_url: author.avatar_url || null,
    author_avatar_label: author.avatar_label || message.author_user_id.slice(0, 1).toUpperCase() || "U",
    author_identity: ambientConversationIdentity(author.role, author.operational_label),
  };
}

export function splitMessagePage<T>(
  records: T[],
  pageSize: number,
  probePosition: "start" | "end",
) {
  const hasMore = records.length > pageSize;
  if (!hasMore) return { records, hasMore: false };
  return {
    records: probePosition === "start" ? records.slice(1) : records.slice(0, pageSize),
    hasMore: true,
  };
}

export function sortWorkspaceChannels(channels: WorkspaceChannel[]) {
  return [...channels].sort((left, right) => {
    const channelTypeOrder = Number(left.channel_type !== "announcement") - Number(right.channel_type !== "announcement");
    if (channelTypeOrder) return channelTypeOrder;
    const leftName = left.name.toLowerCase();
    const rightName = right.name.toLowerCase();
    return leftName < rightName ? -1 : leftName > rightName ? 1 : 0;
  });
}

export function isCurrentWorkspaceChannelChange(
  change: WorkspaceChannelRealtimeChange,
  subscribedWorkspaceId: string | null,
  activeWorkspaceId: string | null,
) {
  const payloadWorkspaceId = String(change.new?.workspace_id ?? change.old?.workspace_id ?? "");
  return Boolean(subscribedWorkspaceId)
    && subscribedWorkspaceId === activeWorkspaceId
    && (!payloadWorkspaceId || payloadWorkspaceId === activeWorkspaceId);
}

export function reconcileWorkspaceChannelChange(
  current: WorkspaceChannel[],
  change: WorkspaceChannelRealtimeChange,
) {
  const changed = change.new;
  const channelId = String(changed?.id || change.old?.id || "");
  if (!channelId) return current;

  if (change.eventType === "DELETE" || changed?.is_archived) {
    return current.filter((channel) => channel.id !== channelId);
  }
  if (!changed) return current;

  const existing = current.find((channel) => channel.id === channelId);
  const nextChannel = existing ? { ...existing, ...changed } : changed as WorkspaceChannel;
  return sortWorkspaceChannels([...current.filter((channel) => channel.id !== channelId), nextChannel]);
}

function channelPreview(content: string) {
  const normalized = content.trim().replace(/\s+/g, " ");
  return normalized.length <= 110 ? normalized : `${normalized.slice(0, 107)}...`;
}

export function mergeWorkspaceChannelMessage(
  current: WorkspaceChannel[],
  incoming: WorkspaceChannelMessage,
) {
  const incomingTimestamp = Date.parse(incoming.created_at || "");
  return current.map((channel) => {
    if (channel.id !== incoming.channel_id) return channel;

    const currentTimestamp = Date.parse(channel.last_message_at || "");
    if (Number.isFinite(currentTimestamp) && Number.isFinite(incomingTimestamp) && currentTimestamp >= incomingTimestamp) {
      return channel;
    }

    // The database-triggered channel event remains authoritative for message_count.
    return {
      ...channel,
      last_message_preview: channelPreview(incoming.content),
      last_message_at: incoming.created_at || channel.last_message_at,
      updated_at: incoming.created_at || channel.updated_at,
    };
  });
}

export function messageAuthor(message: WorkspaceChannelMessage) {
  return message.author_name || message.author_email || "Teammate";
}

export function messageIdentity(message: WorkspaceChannelMessage) {
  return message.author_identity?.display_label || null;
}

export function readableTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function canCreateOperationalChannel(role?: string | null) {
  return ["founder", "owner", "co_owner", "super_founder", "sub_leader", "team_lead"].includes(role || "");
}
