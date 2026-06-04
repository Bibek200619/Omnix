export type WorkspaceRole =
  | "founder"
  | "owner"
  | "co_owner"
  | "member"
  | "super_founder"
  | "sub_leader"
  | "team_lead"
  | "sub_member";

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  email?: string | null;
  full_name?: string | null;
  handle?: string | null;
  avatar_url?: string | null;
  avatar_label: string;
  operational_label?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkspacePotentialMember = {
  user_id: string;
  email?: string | null;
  full_name?: string | null;
  handle?: string | null;
  avatar_url?: string | null;
  avatar_label: string;
  org_role: WorkspaceRole;
};

export type WorkspaceMemberAssign = {
  user_id: string;
  role: WorkspaceRole;
};

export type WorkspaceInviteStatus = "pending" | "accepted" | "declined" | "revoked";

export type WorkspaceInvite = {
  id: string;
  invite_id: string;
  workspace_id: string;
  email: string;
  role: "co_owner" | "member" | "sub_leader" | "sub_member";
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

export type WorkspaceType = "workspace" | "super" | "sub" | "super_workspace" | "subworkspace" | "global_workspace";
export type WorkspaceFocus = "general" | "engineering" | "design" | "research" | "strategy";
export type WorkspaceAIMode = WorkspaceFocus;

export type WorkspaceIntelligencePreferences = {
  retrieval_scope?: "workspace" | "global";
  source_permissions?: "workspace_only" | "inherit_global" | "organization";
  memory_enabled?: boolean;
  [key: string]: unknown;
};

export type WorkspaceCreatePayload = {
  name: string;
  description?: string;
  parent_workspace_id?: string | null;
  workspace_type?: WorkspaceType;
  is_global?: boolean;
  workspace_focus?: WorkspaceFocus;
};

export type WorkspaceSubspaceCreatePayload = {
  name: string;
  description?: string;
  workspace_focus?: WorkspaceFocus;
};

export type Workspace = {
  id: string;
  user_id: string;
  name: string;
  description?: string | null;
  parent_workspace_id?: string | null;
  workspace_type: WorkspaceType;
  is_global: boolean;
  expertise_area?: string | null;
  workspace_focus: WorkspaceFocus;
  ai_specialization: WorkspaceAIMode;
  ai_instructions?: string | null;
  intelligence_preferences: WorkspaceIntelligencePreferences;
  current_user_role: WorkspaceRole;
  member_count: number;
  is_shared: boolean;
  members_preview: WorkspaceMember[];
  created_at?: string | null;
  updated_at?: string | null;
  subspaces?: Workspace[];
};

export type WorkspaceIntelligenceProfile = {
  workspace_id: string;
  workspace_name: string;
  workspace_type: WorkspaceType;
  is_global: boolean;
  parent_workspace_id?: string | null;
  description?: string | null;
  expertise_area?: string | null;
  workspace_focus: WorkspaceFocus;
  ai_specialization: WorkspaceAIMode;
  ai_instructions?: string | null;
  intelligence_preferences: WorkspaceIntelligencePreferences;
  source_count: number;
  conversation_count: number;
  member_count: number;
  active_domains: string[];
  connected_sources: Array<{
    id: string;
    name: string;
    type?: string | null;
    workspace_id?: string | null;
    created_at?: string | null;
  }>;
  recent_insights: string[];
  retrieval_scope: "workspace" | "global" | "personal";
  scope_workspace_ids: string[];
  context_summary: string;
};

export type WorkspaceIntelligenceUpdatePayload = {
  expertise_area?: string | null;
  workspace_focus: WorkspaceFocus;
  ai_specialization: WorkspaceAIMode;
  ai_instructions?: string | null;
  intelligence_preferences: WorkspaceIntelligencePreferences;
};

export type WorkspacePresenceStatus = "online" | "recent" | "offline";

export type WorkspacePresenceMember = {
  workspace_id: string;
  user_id: string;
  status: WorkspacePresenceStatus;
  current_view?: string | null;
  current_label?: string | null;
  is_online: boolean;
  is_typing: boolean;
  typing_conversation_id?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
  email?: string | null;
  full_name?: string | null;
  handle?: string | null;
  avatar_url?: string | null;
  avatar_label: string;
};

export type WorkspacePresenceSnapshot = {
  workspace_id: string;
  online_count: number;
  active_count: number;
  recently_active_count: number;
  typing_count: number;
  online_members: WorkspacePresenceMember[];
  active_members: WorkspacePresenceMember[];
  recently_active_members: WorkspacePresenceMember[];
  typing_members: WorkspacePresenceMember[];
  updated_at?: string | null;
};

export type WorkspaceActivityEvent = {
  id: string;
  workspace_id: string;
  actor_user_id?: string | null;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at?: string | null;
  actor_name?: string | null;
  actor_email?: string | null;
  actor_avatar_url?: string | null;
  actor_avatar_label: string;
};

export type WorkspaceInitiativeStatus = "draft" | "active" | "focused" | "at_risk" | "complete";
export type WorkspaceInitiativeMomentumHealth = "quiet" | "active_movement" | "blocked_execution" | "dormant" | "completion_flow";
export type WorkspaceInitiativeAssistanceMode = "state" | "blockers" | "momentum" | "decisions";

export type WorkspaceInitiativeResource = {
  resource_type: "file" | "decision" | "ai_session" | "reference";
  resource_id: string;
  label?: string | null;
  metadata: Record<string, unknown>;
};

export type WorkspaceInitiativeChannel = {
  id: string;
  name: string;
  purpose?: string | null;
  message_count: number;
  last_message_at?: string | null;
};

export type WorkspaceInitiativeMomentum = {
  health: WorkspaceInitiativeMomentumHealth;
  summary: string;
  task_count: number;
  open_task_count: number;
  complete_task_count: number;
  blocked_task_count: number;
  due_soon_count: number;
  overdue_count: number;
  channel_count: number;
  discussion_message_count: number;
  last_movement_at?: string | null;
};

export type WorkspaceInitiative = {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null;
  status: WorkspaceInitiativeStatus;
  owner_user_id?: string | null;
  created_by?: string | null;
  target_date?: string | null;
  initiative_context?: string | null;
  linked_resources: WorkspaceInitiativeResource[];
  activity_metadata: Record<string, unknown>;
  client_nonce?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_avatar_label?: string | null;
  creator_name?: string | null;
  linked_tasks: WorkspaceTask[];
  linked_channels: WorkspaceInitiativeChannel[];
  linked_decisions: Array<{
    id: string;
    title: string;
    status: WorkspaceDecisionStatus;
    decision_reason?: string | null;
    created_at?: string | null;
  }>;
  momentum: WorkspaceInitiativeMomentum;
};

export type WorkspaceInitiativeAssistance = {
  mode: WorkspaceInitiativeAssistanceMode;
  content: string;
  source_task_count: number;
  source_channel_count: number;
  source_message_count: number;
  generated_at: string;
};

export type WorkspaceOperationalTimelineEvent = {
  id: string;
  workspace_id: string;
  initiative_id?: string | null;
  event_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type WorkspaceContinuityMemory = {
  id: string;
  workspace_id: string;
  initiative_id?: string | null;
  memory_type: string;
  content: string;
  resolution_status?: string | null;
  structured_data: Record<string, unknown>;
  importance_score: number;
  created_at: string;
  updated_at: string;
};

export type WorkspaceLiveStatus = {
  workspace_id: string;
  online_count: number;
  active_count: number;
  recently_active_count: number;
  typing_count: number;
  source_count: number;
  workspace_focus: WorkspaceFocus;
  ai_specialization: WorkspaceAIMode;
  ai_status: "ready" | "learning" | "active";
  health: "quiet" | "warming" | "alive";
  recent_activity_at?: string | null;
  recent_activity_summary?: string | null;
};

export type TypingSignal = {
  userId: string;
  fullName: string;
  avatarUrl?: string | null;
  conversationId: string | null;
  isTyping: boolean;
  sentAt: string;
};

export type WorkspaceChannel = {
  id: string;
  workspace_id: string;
  created_by?: string | null;
  name: string;
  slug: string;
  purpose?: string | null;
  channel_type: "operational" | "announcement";
  visibility: "workspace" | "private" | "project";
  posting_policy: "members" | "leaders";
  is_archived: boolean;
  message_count: number;
  last_message_preview?: string | null;
  last_message_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type ExecutionContextLink = {
  entity_type: "file" | "ai_session" | "decision" | "task" | "initiative" | "memory";
  entity_id: string;
  label?: string | null;
};

export type WorkspaceConversationAuthorIdentity = {
  role_label?: string | null;
  operational_label?: string | null;
  display_label?: string | null;
};

export type WorkspaceMentionMetadata = {
  user_id: string;
  label?: string | null;
  display_name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
  avatar_label: string;
  operational_label?: string | null;
};

export type WorkspaceMentionInput = {
  user_id: string;
};

export type WorkspaceChannelMessage = {
  id: string;
  workspace_id: string;
  channel_id: string;
  author_user_id: string;
  parent_message_id?: string | null;
  content: string;
  context_links: ExecutionContextLink[];
  metadata: Record<string, unknown>;
  mentions?: WorkspaceMentionMetadata[];
  client_nonce?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  edited_at?: string | null;
  author_name?: string | null;
  author_email?: string | null;
  author_avatar_url?: string | null;
  author_avatar_label: string;
  author_identity?: WorkspaceConversationAuthorIdentity | null;
  thread_reply_count: number;
};

export type WorkspaceConversationAssistanceMode = "summary" | "decisions" | "actions" | "blockers";

export type WorkspaceConversationAssistance = {
  mode: WorkspaceConversationAssistanceMode;
  content: string;
  source_message_count: number;
  generated_at: string;
};

export type WorkspaceTaskStatus = "idea" | "planned" | "active" | "review" | "complete";

export type WorkspaceTaskContextLink = {
  context_type:
    | "conversation_message"
    | "channel"
    | "ai_session"
    | "file"
    | "decision"
    | "initiative"
    | "ai_action_extraction";
  context_id: string;
  label?: string | null;
  metadata: Record<string, unknown>;
};

export type WorkspaceTask = {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null;
  status: WorkspaceTaskStatus;
  owner_user_id?: string | null;
  created_by: string;
  due_date?: string | null;
  blockers: string[];
  linked_context: WorkspaceTaskContextLink[];
  activity_metadata: Record<string, unknown>;
  momentum_metadata: Record<string, unknown>;
  mentions?: WorkspaceMentionMetadata[];
  initiative_id?: string | null;
  client_nonce?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_avatar_label?: string | null;
  creator_name?: string | null;
  linked_decisions: Array<{
    id: string;
    title: string;
    status: WorkspaceDecisionStatus;
    decision_reason?: string | null;
    created_at?: string | null;
  }>;
};

export type WorkspaceTaskMomentum = {
  workspace_id: string;
  total_count: number;
  open_count: number;
  complete_count: number;
  blocked_count: number;
  due_soon_count: number;
  overdue_count: number;
  unassigned_count: number;
  flow_counts: Record<WorkspaceTaskStatus, number>;
  completion_ratio: number;
  health: "quiet" | "moving" | "blocked" | "complete";
  summary: string;
  calculated_at: string;
};

export type WorkspaceTaskAssistanceMode = "blockers" | "stalled" | "next_actions" | "workload";

export type WorkspaceTaskAssistance = {
  mode: WorkspaceTaskAssistanceMode;
  content: string;
  source_task_count: number;
  generated_at: string;
};

export type WorkspaceDecisionStatus = "proposed" | "accepted" | "rejected" | "superseded";

export type WorkspaceDecision = {
  id: string;
  workspace_id: string;
  title: string;
  description?: string | null;
  decision_reason?: string | null;
  status: WorkspaceDecisionStatus;
  source_message_id?: string | null;
  source_channel_id?: string | null;
  initiative_id?: string | null;
  created_by: string;
  created_at?: string | null;
  updated_at?: string | null;
  creator_name?: string | null;
  creator_email?: string | null;
  creator_avatar_label?: string | null;
  mentions?: WorkspaceMentionMetadata[];

  // Linkages
  linked_tasks: Array<{
    id: string;
    title: string;
    status: WorkspaceTaskStatus;
    owner_user_id?: string | null;
  }>;
  initiative?: {
    id: string;
    title: string;
    status: WorkspaceInitiativeStatus;
    momentum_state: Record<string, unknown>;
  } | null;
};

export type WorkspaceSearchResultType = "conversation" | "task" | "initiative" | "decision";

export type WorkspaceSearchResult = {
  id: string;
  workspace_id: string;
  type: WorkspaceSearchResultType;
  title: string;
  preview?: string | null;
  context?: string | null;
  url: string;
  channel_id?: string | null;
  message_id?: string | null;
  matched_field?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type WorkspaceSearchResponse = {
  conversations: WorkspaceSearchResult[];
  tasks: WorkspaceSearchResult[];
  initiatives: WorkspaceSearchResult[];
  decisions: WorkspaceSearchResult[];
};

export type WorkspaceMentionSourceType = "conversation_message" | "task" | "decision";

export type WorkspaceMentionInboxItem = {
  id: string;
  workspace_id: string;
  mentioned_user_id: string;
  mentioned_by_user_id: string;
  source_type: WorkspaceMentionSourceType;
  source_id: string;
  created_at?: string | null;
  read_at?: string | null;
  mentioned_by_name?: string | null;
  mentioned_by_email?: string | null;
  mentioned_by_avatar_label: string;
  mentioned_user_name?: string | null;
  source_title: string;
  source_preview?: string | null;
  source_url: string;
};

export type WorkspaceMentionUnreadCount = {
  unread_count: number;
};

export type WorkspaceMentionMarkReadResponse = {
  mention_id: string;
  read_at: string;
};

export type WorkspaceMentionMarkAllReadResponse = {
  updated_count: number;
  read_at: string;
};
