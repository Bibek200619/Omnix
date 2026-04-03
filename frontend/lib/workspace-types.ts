export type WorkspaceRole = "owner" | "member";

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  email?: string | null;
  full_name?: string | null;
  avatar_label: string;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkspaceInviteStatus = "pending" | "accepted" | "declined" | "revoked";

export type WorkspaceInvite = {
  id: string;
  invite_id: string;
  workspace_id: string;
  email: string;
  role: "member";
  status: WorkspaceInviteStatus;
  invited_by?: string | null;
  accepted_by_user_id?: string | null;
  workspace_name?: string | null;
  inviter_name?: string | null;
  inviter_email?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  accepted_at?: string | null;
};

export function getWorkspaceInviteId(invite: Pick<WorkspaceInvite, "id" | "invite_id">) {
  return invite.invite_id || invite.id;
}

export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  current_user_role: WorkspaceRole;
  member_count: number;
  is_shared: boolean;
  members_preview: WorkspaceMember[];
  created_at?: string | null;
  updated_at?: string | null;
};
