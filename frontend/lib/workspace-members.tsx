import { apiClient } from "./api";
import { normalizeWorkspaceForest, type WorkspaceApiRecord } from "./workspace-tree";
import {
  getWorkspaceInviteId,
  type Workspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberAssign,
  type WorkspaceRole,
} from "./workspace-types";

const inviteStatusRank: Record<WorkspaceInvite["status"], number> = {
  pending: 0,
  accepted: 1,
  declined: 2,
  revoked: 3,
};

function inviteTimestamp(invite: WorkspaceInvite) {
  return Date.parse(invite.updated_at || invite.created_at || "") || 0;
}

export function sortWorkspaceInvites(invites: WorkspaceInvite[]) {
  return [...invites].sort((a, b) => {
    const statusDelta = inviteStatusRank[a.status] - inviteStatusRank[b.status];
    if (statusDelta !== 0) return statusDelta;
    return inviteTimestamp(b) - inviteTimestamp(a);
  });
}

export function reconcileWorkspaceInvites(current: WorkspaceInvite[], incoming: WorkspaceInvite[]) {
  const incomingIds = new Set(incoming.map((invite) => getWorkspaceInviteId(invite)));
  const byId = new Map<string, WorkspaceInvite>();

  incoming.forEach((invite) => {
    byId.set(getWorkspaceInviteId(invite), invite);
  });

  current.forEach((invite) => {
    const inviteId = getWorkspaceInviteId(invite);
    if (invite.status === "pending" && !incomingIds.has(inviteId)) {
      byId.set(inviteId, invite);
    }
  });

  return sortWorkspaceInvites(Array.from(byId.values()));
}

export function fetchPendingWorkspaceInvites() {
  return apiClient.get<WorkspaceInvite[]>("/workspace-invites");
}

export function fetchWorkspaceMembers(workspaceId: string) {
  return apiClient.get<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`);
}

export function fetchWorkspaceInvites(workspaceId: string) {
  return apiClient.get<WorkspaceInvite[]>(`/workspaces/${workspaceId}/invites`);
}

export function inviteToWorkspace(workspaceId: string, target: string, role: WorkspaceRole) {
  return apiClient.post<WorkspaceInvite>(`/workspaces/${workspaceId}/invites`, {
    email: target,
    role,
  });
}

export function updateWorkspaceMemberRoleRequest(workspaceId: string, userId: string, role: WorkspaceRole) {
  return apiClient.patch<WorkspaceMember>(
    `/workspaces/${workspaceId}/members/${userId}`,
    { role },
  );
}

export function removeWorkspaceMemberRequest(workspaceId: string, userId: string) {
  return apiClient.delete(`/workspaces/${workspaceId}/members/${userId}`);
}

export function assignWorkspaceMemberRequest(workspaceId: string, payload: WorkspaceMemberAssign) {
  return apiClient.post<WorkspaceMember>(
    `/workspaces/${workspaceId}/members/assign`,
    payload,
  );
}

export function revokeWorkspaceInvite(workspaceId: string, inviteId: string) {
  return apiClient.delete(`/workspaces/${workspaceId}/invites/${inviteId}`);
}

export async function acceptWorkspaceInvite(inviteId: string): Promise<Workspace> {
  const created = await apiClient.post<WorkspaceApiRecord>(`/workspace-invites/${inviteId}/accept`);
  const [workspace] = normalizeWorkspaceForest([created]);
  if (!workspace) {
    throw new Error("Invite was accepted, but the workspace could not be loaded. Refresh the workspace list and try again.");
  }
  return workspace;
}

export function declineWorkspaceInvite(inviteId: string) {
  return apiClient.post(`/workspace-invites/${inviteId}/decline`);
}
