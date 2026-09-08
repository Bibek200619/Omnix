"use client";

import { useMemo } from "react";
import type {
  WorkspaceIntelligenceContextValue,
  WorkspaceMembershipContextValue,
  WorkspaceTreeContextValue,
} from "./workspace-context-types";

type WorkspaceContextValuesParams =
  WorkspaceTreeContextValue &
  WorkspaceMembershipContextValue &
  WorkspaceIntelligenceContextValue;

export function useWorkspaceContextValues(params: WorkspaceContextValuesParams) {
  const {
    workspaces,
    loading,
    error,
    activeWorkspaceId,
    activeWorkspace,
    activeRootWorkspace,
    subspaceLoadingByParentId,
    subspaceErrorByParentId,
    captureActiveWorkspaceSelection,
    setActiveWorkspace,
    refreshWorkspaces,
    refreshWorkspaceTree,
    refreshWorkspaceSubspaces,
    createWorkspace,
    createSubspace,
    renameWorkspace,
    deleteWorkspace,
    activeMembers,
    activeInvites,
    pendingInvites,
    membersError,
    membersLoading,
    invitesLoading,
    pendingInvitesLoading,
    refreshActiveWorkspaceData,
    refreshPendingInvites,
    inviteToActiveWorkspace,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    assignWorkspaceMember,
    revokeInvite,
    acceptInvite,
    declineInvite,
    activeWorkspaceIntelligence,
    intelligenceError,
    intelligenceLoading,
    refreshWorkspaceIntelligence,
    updateWorkspaceIntelligence,
  } = params;

  const treeValue = useMemo<WorkspaceTreeContextValue>(
    () => ({
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeRootWorkspace,
      subspaceLoadingByParentId,
      subspaceErrorByParentId,
      captureActiveWorkspaceSelection,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshWorkspaceTree,
      refreshWorkspaceSubspaces,
      createWorkspace,
      createSubspace,
      renameWorkspace,
      deleteWorkspace,
    }),
    [
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeRootWorkspace,
      subspaceLoadingByParentId,
      subspaceErrorByParentId,
      captureActiveWorkspaceSelection,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshWorkspaceTree,
      refreshWorkspaceSubspaces,
      createWorkspace,
      createSubspace,
      renameWorkspace,
      deleteWorkspace,
    ],
  );

  const membershipValue = useMemo<WorkspaceMembershipContextValue>(
    () => ({
      activeMembers,
      activeInvites,
      pendingInvites,
      membersError,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      refreshActiveWorkspaceData,
      refreshPendingInvites,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      assignWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    }),
    [
      activeMembers,
      activeInvites,
      pendingInvites,
      membersError,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      refreshActiveWorkspaceData,
      refreshPendingInvites,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      assignWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    ],
  );

  const intelligenceValue = useMemo<WorkspaceIntelligenceContextValue>(
    () => ({
      activeWorkspaceIntelligence,
      intelligenceError,
      intelligenceLoading,
      refreshWorkspaceIntelligence,
      updateWorkspaceIntelligence,
    }),
    [
      activeWorkspaceIntelligence,
      intelligenceError,
      intelligenceLoading,
      refreshWorkspaceIntelligence,
      updateWorkspaceIntelligence,
    ],
  );

  return {
    treeValue,
    membershipValue,
    intelligenceValue,
  };
}
