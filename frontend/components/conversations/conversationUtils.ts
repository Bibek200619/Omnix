import type {
  DecisionCandidate,
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

export function messageAuthor(message: WorkspaceChannelMessage) {
  return message.author_name || message.author_email || "Teammate";
}

export function messageIdentity(message: WorkspaceChannelMessage) {
  return message.author_identity?.display_label || null;
}

export function readableTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function canCreateOperationalChannel(role?: string | null) {
  return ["founder", "owner", "co_owner", "super_founder", "sub_leader", "team_lead"].includes(role || "");
}
