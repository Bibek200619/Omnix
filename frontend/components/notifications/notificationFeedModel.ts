import type { WorkspaceActivityEvent, WorkspaceMentionInboxItem } from "@/lib/workspace-types";

export type NotificationFeedFilter = "all" | "mentions" | "activity";

export type NotificationFeedItem =
  | { id: string; kind: "mention"; createdAt: string; mention: WorkspaceMentionInboxItem }
  | { id: string; kind: "activity"; createdAt: string; activity: WorkspaceActivityEvent };

function timestamp(value?: string | null) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildNotificationFeed(
  mentions: WorkspaceMentionInboxItem[],
  activity: WorkspaceActivityEvent[],
  filter: NotificationFeedFilter,
): NotificationFeedItem[] {
  const mentionItems: NotificationFeedItem[] = mentions.map((mention) => ({
    id: `mention:${mention.id}`,
    kind: "mention",
    createdAt: mention.created_at ?? "",
    mention,
  }));
  const activityItems: NotificationFeedItem[] = activity.map((event) => ({
    id: `activity:${event.id}`,
    kind: "activity",
    createdAt: event.created_at ?? "",
    activity: event,
  }));

  const selected = filter === "mentions" ? mentionItems : filter === "activity" ? activityItems : [...mentionItems, ...activityItems];
  return selected.toSorted((left, right) => timestamp(right.createdAt) - timestamp(left.createdAt) || left.id.localeCompare(right.id));
}

export function activityDestination(eventType: string) {
  const normalized = eventType.toLowerCase();
  if (normalized.includes("message") || normalized.includes("conversation") || normalized.includes("channel")) return "/conversations";
  if (normalized.includes("task")) return "/tasks";
  if (normalized.includes("initiative")) return "/initiatives";
  if (normalized.includes("decision")) return "/decisions";
  if (normalized.includes("file") || normalized.includes("document") || normalized.includes("source")) return "/files";
  if (normalized.includes("member") || normalized.includes("invite")) return "/team";
  return "/workspace";
}

export function activityLabel(eventType: string) {
  return eventType.split(".").pop()?.replaceAll("_", " ") || "workspace activity";
}
