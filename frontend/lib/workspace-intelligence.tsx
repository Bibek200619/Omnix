import { apiClient } from "./api";
import type {
  Workspace,
  WorkspaceIntelligenceProfile,
  WorkspaceIntelligenceUpdatePayload,
} from "./workspace-types";

export function fetchWorkspaceIntelligenceProfile(workspaceId: string) {
  return apiClient.get<WorkspaceIntelligenceProfile>(`/workspaces/${workspaceId}/intelligence`);
}

export function updateWorkspaceIntelligenceProfile(
  workspaceId: string,
  payload: WorkspaceIntelligenceUpdatePayload,
) {
  return apiClient.patch<WorkspaceIntelligenceProfile>(
    `/workspaces/${workspaceId}/intelligence`,
    payload,
  );
}

export function applyWorkspaceIntelligenceProfile(
  workspace: Workspace,
  profile: WorkspaceIntelligenceProfile,
): Workspace {
  return {
    ...workspace,
    expertise_area: profile.expertise_area ?? null,
    workspace_focus: profile.workspace_focus,
    ai_specialization: profile.ai_specialization,
    ai_instructions: profile.ai_instructions ?? null,
    intelligence_preferences: profile.intelligence_preferences ?? {},
  };
}
