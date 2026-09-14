"use client";

import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { logClientError } from "./errors";
import type { RefreshOptions } from "./workspace-context-types";
import {
  acceptWorkspaceInvite,
  assignWorkspaceMemberRequest,
  declineWorkspaceInvite,
  fetchPendingWorkspaceInvites,
  fetchWorkspaceInvites,
  fetchWorkspaceMembers,
  inviteToWorkspace,
  reconcileWorkspaceInvites,
  removeWorkspaceMemberRequest,
  revokeWorkspaceInvite,
  sortWorkspaceInvites,
  updateWorkspaceMemberRoleRequest,
} from "./workspace-members";
import { isWorkspaceFounderRole } from "./workspace-roles";
import { patchWorkspaceInTree } from "./workspace-tree";
import {
  getWorkspaceInviteId,
  type Workspace,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberAssign,
  type WorkspaceRole,
} from "./workspace-types";

const PENDING_INVITES_SILENT_REFRESH_MIN_MS = 30_000;
const ACTIVE_WORKSPACE_DATA_MIN_MS = 45_000;

type ShowToast = (
  toast:
    | string
    | {
        title?: string;
        message: string;
        variant?: "info" | "success" | "warning" | "error";
        durationMs?: number;
      },
) => string;

type ConfirmDestructiveAction = (confirmation: {
  title: string;
  description: string;
  confirmLabel: string;
}) => Promise<boolean>;

type UseWorkspaceMembershipStateParams = {
  activeWorkspace: Workspace | null;
  activeWorkspaceId: string | null;
  activeWorkspaceIdRef: MutableRefObject<string | null>;
  confirmDestructiveAction: ConfirmDestructiveAction;
  refreshWorkspaces: (options?: RefreshOptions) => Promise<void>;
  requestGenerationRef: MutableRefObject<number>;
  setActiveWorkspace: (id: string | null) => void;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
  showToast: ShowToast;
  userId: string | null;
};

export function useWorkspaceMembershipState({
  activeWorkspace,
  activeWorkspaceId,
  activeWorkspaceIdRef,
  confirmDestructiveAction,
  refreshWorkspaces,
  requestGenerationRef,
  setActiveWorkspace,
  setWorkspaces,
  showToast,
  userId,
}: UseWorkspaceMembershipStateParams) {
  const [activeMembers, setActiveMembers] = useState<WorkspaceMember[]>([]);
  const [activeInvites, setActiveInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const pendingInvitesInFlightRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceDataInFlightRef = useRef<{
    workspaceId: string;
    generation: number;
    request: Promise<void>;
  } | null>(null);
  const lastPendingInvitesRefreshAtRef = useRef(0);
  const lastActiveWorkspaceDataRefreshAtRef = useRef(0);

  const resetWorkspaceMembershipState = useCallback(() => {
    pendingInvitesInFlightRef.current = null;
    activeWorkspaceDataInFlightRef.current = null;
    lastPendingInvitesRefreshAtRef.current = 0;
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
    setActiveMembers([]);
    setActiveInvites([]);
    setPendingInvites([]);
    setMembersError(null);
    setMembersLoading(false);
    setInvitesLoading(false);
    setPendingInvitesLoading(false);
  }, []);

  const clearActiveWorkspaceDataRequest = useCallback(() => {
    activeWorkspaceDataInFlightRef.current = null;
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
  }, []);

  const clearActiveWorkspaceMembership = useCallback(() => {
    activeWorkspaceDataInFlightRef.current = null;
    setActiveMembers([]);
    setActiveInvites([]);
    setMembersError(null);
    setMembersLoading(false);
    setInvitesLoading(false);
  }, []);

  const refreshPendingInvites = useCallback(async (options?: RefreshOptions) => {
    if (!userId) {
      setPendingInvites([]);
      return;
    }

    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastPendingInvitesRefreshAtRef.current < PENDING_INVITES_SILENT_REFRESH_MIN_MS
    ) {
      return;
    }

    if (pendingInvitesInFlightRef.current) {
      return pendingInvitesInFlightRef.current;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setPendingInvitesLoading(true);
        }
        const data = await fetchPendingWorkspaceInvites();
        setPendingInvites(sortWorkspaceInvites(data || []));
        lastPendingInvitesRefreshAtRef.current = Date.now();
      } catch (err) {
        logClientError("Failed to load pending invites", err, { endpoint: "/workspace-invites" });
      } finally {
        if (!options?.silent) {
          setPendingInvitesLoading(false);
        }
        pendingInvitesInFlightRef.current = null;
      }
    })();

    pendingInvitesInFlightRef.current = request;
    return request;
  }, [userId]);

  const refreshActiveWorkspaceData = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveMembers([]);
      setMembersError(null);
      setActiveInvites([]);
      return;
    }

    if (!activeWorkspace) {
      setActiveMembers([]);
      setMembersError(null);
      return;
    }

    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastActiveWorkspaceDataRefreshAtRef.current < ACTIVE_WORKSPACE_DATA_MIN_MS
    ) {
      return;
    }

    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;

    if (
      activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId &&
      activeWorkspaceDataInFlightRef.current?.generation === generation
    ) {
      return activeWorkspaceDataInFlightRef.current.request;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setMembersLoading(true);
        }
        const members = await fetchWorkspaceMembers(requestWorkspaceId);

        if (
          activeWorkspaceIdRef.current !== requestWorkspaceId ||
          requestGenerationRef.current !== generation
        ) {
          return;
        }

        setActiveMembers(members || []);
        setMembersError(null);
      } catch (err) {
        logClientError("Failed to load workspace members", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/members`,
        });
        if (
          !options?.silent &&
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveMembers([]);
          setMembersError("Unable to load team members. Check your connection and try again.");
        }
      } finally {
        if (
          !options?.silent &&
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setMembersLoading(false);
        }
      }

      if (!isWorkspaceFounderRole(activeWorkspace.current_user_role)) {
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveInvites([]);
        }
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
        if (
          activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId &&
          activeWorkspaceDataInFlightRef.current?.generation === generation
        ) {
          activeWorkspaceDataInFlightRef.current = null;
        }
        return;
      }

      try {
        if (!options?.silent) {
          setInvitesLoading(true);
        }
        const invites = await fetchWorkspaceInvites(requestWorkspaceId);
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveInvites((current) => reconcileWorkspaceInvites(current, invites || []));
        }
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
      } catch (err) {
        logClientError("Failed to load workspace invites", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/invites`,
        });
      } finally {
        if (
          !options?.silent &&
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setInvitesLoading(false);
        }
        if (
          activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId &&
          activeWorkspaceDataInFlightRef.current?.generation === generation
        ) {
          activeWorkspaceDataInFlightRef.current = null;
        }
      }
    })();

    activeWorkspaceDataInFlightRef.current = { workspaceId: requestWorkspaceId, generation, request };
    return request;
  }, [activeWorkspace, activeWorkspaceId, activeWorkspaceIdRef, requestGenerationRef]);

  const inviteToActiveWorkspace = useCallback(
    async (target: string, role: WorkspaceRole = "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const invite = await inviteToWorkspace(requestWorkspaceId, target, role);
      const nextInviteId = getWorkspaceInviteId(invite);
      if (activeWorkspaceIdRef.current === requestWorkspaceId) {
        setActiveInvites((current) =>
          sortWorkspaceInvites([
            invite,
            ...current.filter((item) => getWorkspaceInviteId(item) !== nextInviteId),
          ]),
        );
        await refreshActiveWorkspaceData({ force: true, silent: true });
      }
    },
    [activeWorkspaceId, activeWorkspaceIdRef, refreshActiveWorkspaceData],
  );

  const removeWorkspaceMember = useCallback(
    async (memberUserId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const member = activeMembers.find((item) => item.user_id === memberUserId);
      const memberLabel = member?.full_name || member?.email || "this member";
      const confirmed = await confirmDestructiveAction({
        title: "Remove member",
        description: `Remove ${memberLabel} from ${activeWorkspace?.name || "this workspace"}? They will lose access to this workspace immediately.`,
        confirmLabel: "Remove member",
      });
      if (!confirmed) return;

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;

      setActiveMembers((current) => current.filter((member) => member.user_id !== memberUserId));

      try {
        await removeWorkspaceMemberRequest(requestWorkspaceId, memberUserId);
        await refreshWorkspaces({ force: true, silent: true });
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        showToast({ title: "Member removed", message: memberLabel });
      } catch (err) {
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [
      activeMembers,
      activeWorkspace?.name,
      activeWorkspaceId,
      activeWorkspaceIdRef,
      confirmDestructiveAction,
      refreshActiveWorkspaceData,
      refreshWorkspaces,
      showToast,
    ],
  );

  const updateWorkspaceMemberRole = useCallback(
    async (memberUserId: string, role: WorkspaceRole) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      if (activeWorkspaceIdRef.current === requestWorkspaceId) {
        setActiveMembers((current) =>
          current.map((member) =>
            member.user_id === memberUserId
              ? { ...member, role, updated_at: new Date().toISOString() }
              : member,
          ),
        );
      }

      try {
        const updated = await updateWorkspaceMemberRoleRequest(requestWorkspaceId, memberUserId, role);
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers((current) =>
            current.map((member) => (member.user_id === memberUserId ? updated : member)),
          );
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        await refreshWorkspaces({ force: true, silent: true });
        return updated;
      } catch (err) {
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [activeMembers, activeWorkspaceId, activeWorkspaceIdRef, refreshActiveWorkspaceData, refreshWorkspaces],
  );

  const assignWorkspaceMember = useCallback(
    async (payload: WorkspaceMemberAssign) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      const shouldApplyActiveUpdate = activeWorkspaceIdRef.current === requestWorkspaceId;

      setWorkspaces((current) =>
        patchWorkspaceInTree(current, requestWorkspaceId, (workspace) => ({
          ...workspace,
          member_count: workspace.member_count + 1,
        })),
      );

      try {
        const member = await assignWorkspaceMemberRequest(requestWorkspaceId, payload);

        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers((current) => {
            const exists = current.some((m) => m.user_id === member.user_id);
            if (exists) return current;
            return [...current, member];
          });
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }

        await refreshWorkspaces({ force: true, silent: true });
        return member;
      } catch (err) {
        setWorkspaces((current) =>
          patchWorkspaceInTree(current, requestWorkspaceId, (workspace) => ({
            ...workspace,
            member_count: Math.max(0, workspace.member_count - 1),
          })),
        );
        if (shouldApplyActiveUpdate && activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [
      activeMembers,
      activeWorkspaceId,
      activeWorkspaceIdRef,
      refreshActiveWorkspaceData,
      refreshWorkspaces,
      setWorkspaces,
    ],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const invite = activeInvites.find((item) => getWorkspaceInviteId(item) === inviteId);
      const confirmed = await confirmDestructiveAction({
        title: "Revoke invite",
        description: `Revoke the invite for ${invite?.email || "this teammate"}? The invite link will stop working immediately.`,
        confirmLabel: "Revoke invite",
      });
      if (!confirmed) return;

      await revokeWorkspaceInvite(activeWorkspaceId, inviteId);
      setActiveInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
      showToast({ title: "Invite revoked", message: invite?.email || "Workspace invite revoked" });
    },
    [activeInvites, activeWorkspaceId, confirmDestructiveAction, showToast],
  );

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      const workspace = await acceptWorkspaceInvite(inviteId);
      setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
      setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
      setActiveWorkspace(workspace.id);
      await refreshWorkspaces({ force: true });
      return workspace;
    },
    [refreshWorkspaces, setActiveWorkspace, setWorkspaces],
  );

  const declineInvite = useCallback(async (inviteId: string) => {
    await declineWorkspaceInvite(inviteId);
    setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
  }, []);

  return {
    activeMembers,
    activeInvites,
    pendingInvites,
    membersError,
    membersLoading,
    invitesLoading,
    pendingInvitesLoading,
    clearActiveWorkspaceDataRequest,
    clearActiveWorkspaceMembership,
    refreshActiveWorkspaceData,
    refreshPendingInvites,
    resetWorkspaceMembershipState,
    inviteToActiveWorkspace,
    updateWorkspaceMemberRole,
    removeWorkspaceMember,
    assignWorkspaceMember,
    revokeInvite,
    acceptInvite,
    declineInvite,
  };
}
