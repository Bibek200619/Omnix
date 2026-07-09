import {
  Activity,
  BadgeCheck,
  Bell,
  Bot,
  ClipboardCheck,
  Compass,
  FileText,
  MessagesSquare,
  Plus,
  Settings,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { WorkspaceSearchResponse, WorkspaceSearchResult } from "@/lib/workspace-types";

export const searchGroupKeys = [
  "tasks",
  "decisions",
  "initiatives",
  "conversations",
  "files",
  "documents",
  "sources",
  "members",
  "mentions",
  "workspaces",
  "automations",
  "activity",
  "jobs",
] as const;

export type SearchGroupKey = (typeof searchGroupKeys)[number];
export type PaletteItemKind = "action" | "search" | "recent";

export type PaletteItem = {
  id: string;
  kind: PaletteItemKind;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  group?: SearchGroupKey;
  createType?: "task" | "decision" | "initiative";
};

export type RecentDestination = {
  href: string;
  label: string;
  description: string;
  visitedAt: number;
};

export const searchGroups: Array<{ key: SearchGroupKey; label: string; icon: LucideIcon }> = [
  { key: "tasks", label: "Tasks", icon: ClipboardCheck },
  { key: "decisions", label: "Decisions", icon: BadgeCheck },
  { key: "initiatives", label: "Initiatives", icon: Compass },
  { key: "conversations", label: "Conversations", icon: MessagesSquare },
  { key: "files", label: "Files", icon: FileText },
  { key: "documents", label: "Document Text", icon: FileText },
  { key: "sources", label: "Sources", icon: FileText },
  { key: "members", label: "Team Members", icon: UsersRound },
  { key: "mentions", label: "Mentions", icon: Bell },
  { key: "workspaces", label: "Workspace Metadata", icon: Settings },
  { key: "automations", label: "Automations", icon: Workflow },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "jobs", label: "Jobs", icon: Bot },
];

export const emptySearchGroups: Record<SearchGroupKey, WorkspaceSearchResult[]> = {
  conversations: [],
  tasks: [],
  initiatives: [],
  decisions: [],
  files: [],
  documents: [],
  sources: [],
  members: [],
  mentions: [],
  workspaces: [],
  automations: [],
  activity: [],
  jobs: [],
};

export const emptyResults: WorkspaceSearchResponse = {
  ...emptySearchGroups,
  items: [],
};

export const quickActions: PaletteItem[] = [
  {
    id: "action:create-task",
    kind: "action",
    label: "Create Task",
    description: "Open the existing task creation flow.",
    href: "/tasks?create=task",
    icon: Plus,
    createType: "task",
  },
  {
    id: "action:create-decision",
    kind: "action",
    label: "Create Decision",
    description: "Open the existing decision creation flow.",
    href: "/decisions?create=decision",
    icon: Plus,
    createType: "decision",
  },
  {
    id: "action:create-initiative",
    kind: "action",
    label: "Create Initiative",
    description: "Open the existing initiative creation flow.",
    href: "/initiatives?create=initiative",
    icon: Plus,
    createType: "initiative",
  },
  {
    id: "action:open-conversations",
    kind: "action",
    label: "Open Conversations",
    description: "Go to workspace conversations.",
    href: "/conversations",
    icon: MessagesSquare,
  },
  {
    id: "action:open-tasks",
    kind: "action",
    label: "Open Tasks",
    description: "Go to shared execution.",
    href: "/tasks",
    icon: ClipboardCheck,
  },
  {
    id: "action:open-decisions",
    kind: "action",
    label: "Open Decisions",
    description: "Go to decision memory.",
    href: "/decisions",
    icon: BadgeCheck,
  },
  {
    id: "action:open-initiatives",
    kind: "action",
    label: "Open Initiatives",
    description: "Go to shared operational direction.",
    href: "/initiatives",
    icon: Compass,
  },
  {
    id: "action:open-notifications",
    kind: "action",
    label: "Open Notifications",
    description: "Review in-app mentions.",
    href: "/notifications",
    icon: Bell,
  },
  {
    id: "action:open-team",
    kind: "action",
    label: "Open Team",
    description: "Go to workspace members.",
    href: "/team",
    icon: UsersRound,
  },
  {
    id: "action:open-files",
    kind: "action",
    label: "Open Files",
    description: "Go to workspace files.",
    href: "/files",
    icon: FileText,
  },
  {
    id: "action:open-settings",
    kind: "action",
    label: "Open Settings",
    description: "Go to workspace settings.",
    href: "/settings",
    icon: Settings,
  },
];

export const destinations: Record<string, Omit<RecentDestination, "visitedAt">> = {
  "/dashboard": { href: "/dashboard", label: "Dashboard", description: "Workspace overview" },
  "/conversations": { href: "/conversations", label: "Conversations", description: "Operational discussion" },
  "/tasks": { href: "/tasks", label: "Tasks", description: "Shared execution" },
  "/decisions": { href: "/decisions", label: "Decisions", description: "Decision memory" },
  "/initiatives": { href: "/initiatives", label: "Initiatives", description: "Operational direction" },
  "/notifications": { href: "/notifications", label: "Notifications", description: "In-app mentions" },
  "/team": { href: "/team", label: "Team", description: "Workspace members" },
  "/files": { href: "/files", label: "Files", description: "Workspace files" },
  "/sources": { href: "/sources", label: "Sources", description: "Knowledge sources" },
  "/settings": { href: "/settings", label: "Settings", description: "Account and workspace controls" },
  "/workspace": { href: "/workspace", label: "Workspaces", description: "Workspace hierarchy" },
};

export function recentStorageKey(workspaceId: string | null | undefined) {
  return `omnix.commandPalette.recent.${workspaceId || "global"}`;
}

function normalize(text: string) {
  return text.trim().toLowerCase();
}

export function matchesQuery(item: Pick<PaletteItem, "label" | "description">, query: string) {
  const value = normalize(query);
  if (!value) return true;
  return `${item.label} ${item.description}`.toLowerCase().includes(value);
}

function searchResultTypeLabel(result: WorkspaceSearchResult) {
  if (result.type === "conversation") return "Conversation";
  if (result.type === "initiative") return "Initiative";
  if (result.type === "decision") return "Decision";
  if (result.type === "file") return "File";
  if (result.type === "document") return "Document Text";
  if (result.type === "source") return "Source";
  if (result.type === "member") return "Team Member";
  if (result.type === "mention") return "Mention";
  if (result.type === "workspace") return "Workspace";
  if (result.type === "automation") return "Automation";
  if (result.type === "activity") return "Activity";
  if (result.type === "job") return "Job";
  return "Task";
}

function searchResultIcon(result: WorkspaceSearchResult): LucideIcon {
  if (result.type === "conversation") return MessagesSquare;
  if (result.type === "initiative") return Compass;
  if (result.type === "decision") return BadgeCheck;
  if (result.type === "file" || result.type === "document" || result.type === "source") return FileText;
  if (result.type === "member") return UsersRound;
  if (result.type === "mention") return Bell;
  if (result.type === "workspace") return Settings;
  if (result.type === "automation") return Workflow;
  if (result.type === "activity") return Activity;
  if (result.type === "job") return Bot;
  return ClipboardCheck;
}

export function searchResultItem(result: WorkspaceSearchResult, group: SearchGroupKey): PaletteItem {
  return {
    id: `search:${result.type}:${result.id}:${result.message_id || "record"}`,
    kind: "search",
    label: result.title,
    description: result.preview || result.context || searchResultTypeLabel(result),
    href: result.url,
    icon: searchResultIcon(result),
    group,
  };
}

export function hrefWithFreshCreateToken(item: PaletteItem) {
  if (!item.createType) return item.href;
  const separator = item.href.includes("?") ? "&" : "?";
  return `${item.href}${separator}palette=${Date.now()}`;
}
