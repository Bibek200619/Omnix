import type {
  Workspace,
  WorkspaceCreatePayload,
  WorkspaceIntelligenceProfile,
  WorkspaceIntelligenceUpdatePayload,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceMemberAssign,
  WorkspaceRole,
  WorkspaceSubspaceCreatePayload,
} from "./workspace-types";
import type { WorkspaceSelectionGuard } from "./workspace-active-selection";

export type RefreshOptions = {
  force?: boolean;
  silent?: boolean;
};

export type WorkspaceTreeContextValue = {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  activeRootWorkspace: Workspace | null;
  subspaceLoadingByParentId: Record<string, boolean>;
  subspaceErrorByParentId: Record<string, string | null>;
  captureActiveWorkspaceSelection: () => WorkspaceSelectionGuard;
  setActiveWorkspace: (id: string | null) => void;
  refreshWorkspaces: (options?: RefreshOptions) => Promise<void>;
  refreshWorkspaceTree: (workspaceId: string, options?: RefreshOptions) => Promise<Workspace | null>;
  refreshWorkspaceSubspaces: (workspaceId: string, options?: RefreshOptions) => Promise<Workspace[]>;
  createWorkspace: (payload: WorkspaceCreatePayload) => Promise<Workspace>;
  createSubspace: (parentId: string, payload: WorkspaceSubspaceCreatePayload) => Promise<Workspace>;
  renameWorkspace: (workspaceId: string, payload: { name: string; description?: string | null }) => Promise<Workspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
};

export type WorkspaceMembershipContextValue = {
  activeMembers: WorkspaceMember[];
  activeInvites: WorkspaceInvite[];
  pendingInvites: WorkspaceInvite[];
  membersError: string | null;
  membersLoading: boolean;
  invitesLoading: boolean;
  pendingInvitesLoading: boolean;
  refreshActiveWorkspaceData: (options?: RefreshOptions) => Promise<void>;
  refreshPendingInvites: (options?: RefreshOptions) => Promise<void>;
  inviteToActiveWorkspace: (target: string, role?: WorkspaceRole) => Promise<void>;
  updateWorkspaceMemberRole: (userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  assignWorkspaceMember: (payload: WorkspaceMemberAssign) => Promise<WorkspaceMember>;
  revokeInvite: (inviteId: string) => Promise<void>;
  acceptInvite: (inviteId: string) => Promise<Workspace>;
  declineInvite: (inviteId: string) => Promise<void>;
};

export type WorkspaceIntelligenceContextValue = {
  activeWorkspaceIntelligence: WorkspaceIntelligenceProfile | null;
  intelligenceError: string | null;
  intelligenceLoading: boolean;
  refreshWorkspaceIntelligence: (options?: RefreshOptions) => Promise<WorkspaceIntelligenceProfile | null>;
  updateWorkspaceIntelligence: (payload: WorkspaceIntelligenceUpdatePayload) => Promise<WorkspaceIntelligenceProfile>;
};
