import type { ApiMessage, Message, SearchMode } from "@/components/chat/types";
import { initialsFromText } from "@/lib/workspace-roles";
import type { WorkspaceMember } from "@/lib/workspace-types";

export type SenderLookup = {
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  currentUserName?: string | null;
  currentUserHandle?: string | null;
  currentUserAvatarUrl?: string | null;
  currentUserWorkspaceRole?: Message["senderRole"];
  membersById: Map<string, WorkspaceMember>;
};

export function formatChatTime(value?: string) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    Number.isNaN(date.getTime()) ? new Date() : date,
  );
}

export function currentUserNameFromSession(email?: string | null, metadata?: Record<string, unknown>) {
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return email || "You";
}

export function timestampMs(value?: string) {
  if (!value) return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function sourcesFromPayload(payload?: Record<string, unknown> | null): NonNullable<Message["sources"]> {
  const sources = payload?.sources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((source): source is NonNullable<Message["sources"]>[number] =>
    Boolean(source && typeof source === "object"),
  );
}

function sourceModeFromPayload(payload?: Record<string, unknown> | null): SearchMode | undefined {
  const mode = payload?.mode;
  return mode === "auto" || mode === "workspace" || mode === "web" || mode === "hybrid" ? mode : undefined;
}

function webSearchUsedFromPayload(payload?: Record<string, unknown> | null) {
  return typeof payload?.web_search_used === "boolean" ? payload.web_search_used : undefined;
}

function citationsFromPayload(payload?: Record<string, unknown> | null) {
  const citations = payload?.citations;
  if (!Array.isArray(citations)) return undefined;
  return citations.filter((item): item is string => typeof item === "string" && Boolean(item));
}

export function normalizeMessage(message: ApiMessage, index: number, senderLookup: SenderLookup): Message {
  const failed = message.status === "failed";
  const pending = message.status === "pending";
  const role = message.role === "user" ? "user" : "assistant";
  const userId = message.user_id ?? null;
  const member = userId ? senderLookup.membersById.get(userId) : undefined;
  const isOwn = role === "user" && Boolean(userId && userId === senderLookup.currentUserId);
  const senderName = role === "assistant" ? "Omnix" : isOwn ? "You" : member?.full_name || member?.email || "Teammate";
  const payloadSources = sourcesFromPayload(message.payload);
  const metadataSources = sourcesFromPayload(message.metadata);

  return {
    id: message.id ?? `message-${index}`,
    role,
    userId,
    senderName,
    senderEmail: role === "assistant" ? null : member?.email ?? (isOwn ? senderLookup.currentUserEmail ?? null : null),
    senderAvatar: role === "assistant" ? "OX" : member?.avatar_label || initialsFromText(senderName || userId || "U"),
    senderAvatarUrl: role === "assistant" ? null : member?.avatar_url ?? (isOwn ? senderLookup.currentUserAvatarUrl ?? null : null),
    senderHandle: role === "assistant" ? null : member?.handle ?? (isOwn ? senderLookup.currentUserHandle ?? null : null),
    senderRole: role === "assistant" ? "assistant" : member?.role ?? (isOwn ? senderLookup.currentUserWorkspaceRole ?? "member" : "member"),
    isOwn,
    content: message.content || (failed && role === "assistant" ? "The assistant response failed before it could be completed." : ""),
    timestamp: formatChatTime(message.timestamp ?? message.created_at),
    createdAt: message.timestamp ?? message.created_at,
    status: failed ? "failed" : pending ? (role === "assistant" ? "streaming" : "sending") : "sent",
    error: failed ? "Not completed" : undefined,
    isStreaming: pending && role === "assistant",
    sources: role === "assistant" ? (message.sources?.length ? message.sources : payloadSources.length ? payloadSources : metadataSources) : undefined,
    sourceMode: sourceModeFromPayload(message.payload),
    webSearchUsed: webSearchUsedFromPayload(message.payload),
    citations: citationsFromPayload(message.payload),
  };
}
