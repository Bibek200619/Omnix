import type {
  DecisionCandidate,
  WorkspaceChannel,
  WorkspaceChannelMessage,
  WorkspaceConversationAssistance,
  WorkspaceDecisionStatus,
} from "@/lib/workspace-types";

export type DisplayMessage = WorkspaceChannelMessage & {
  delivery?: "sending" | "failed";
};

export type TaskSource =
  | { kind: "message"; message: WorkspaceChannelMessage }
  | { kind: "assistance"; assistance: WorkspaceConversationAssistance };

export type DecisionSource =
  | { kind: "message"; message: WorkspaceChannelMessage }
  | { kind: "candidate"; candidate: DecisionCandidate };

export type WorkspaceChannelRealtimeChange = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new?: Partial<WorkspaceChannel> | null;
  old?: Partial<WorkspaceChannel> | null;
};

type WorkspaceChannelLoadState = {
  requestId: number;
  latestRequestId: number;
  requestWorkspaceId: string | null;
  activeWorkspaceId: string | null;
  stateRevision: number;
  currentStateRevision: number;
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

export function mergeMessage(current: DisplayMessage[], incoming: WorkspaceChannelMessage) {
  const filtered = current.filter(
    (message) =>
      message.id !== incoming.id &&
      !(incoming.client_nonce && message.client_nonce === incoming.client_nonce),
  );
  return chronological([...filtered, incoming]);
}

export function mergeMessagePage(current: DisplayMessage[], incoming: WorkspaceChannelMessage[]) {
  return incoming.reduce<DisplayMessage[]>((merged, message) => mergeMessage(merged, message), current);
}

export function incrementThreadReplyCount(current: DisplayMessage[], reply: WorkspaceChannelMessage) {
  if (!reply.parent_message_id) return current;
  return current.map((message) => (
    message.id === reply.parent_message_id
      ? { ...message, thread_reply_count: message.thread_reply_count + 1 }
      : message
  ));
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

export function isCurrentWorkspaceChannelLoad({
  requestId,
  latestRequestId,
  requestWorkspaceId,
  activeWorkspaceId,
  stateRevision,
  currentStateRevision,
}: WorkspaceChannelLoadState) {
  return requestId === latestRequestId
    && requestWorkspaceId === activeWorkspaceId
    && stateRevision === currentStateRevision;
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
