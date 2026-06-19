import type {
  WorkspaceInitiativeAssistanceMode,
  WorkspaceInitiativeMomentumHealth,
  WorkspaceInitiativeStatus,
} from "@/lib/workspace-types";

export const initiativeStatuses: Array<{ value: WorkspaceInitiativeStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "focused", label: "Focused" },
  { value: "at_risk", label: "At Risk" },
  { value: "complete", label: "Complete" },
];

export const initiativeMomentumLabels: Record<WorkspaceInitiativeMomentumHealth, string> = {
  quiet: "Awaiting linkage",
  active_movement: "Active movement",
  blocked_execution: "Blocked execution",
  dormant: "Dormant state",
  completion_flow: "Completion flow",
};

export const initiativeAssistanceLabels: Record<WorkspaceInitiativeAssistanceMode, string> = {
  state: "State brief",
  blockers: "Blockers",
  momentum: "Movement",
  decisions: "Decisions",
};
