"use client";

import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./auth-context";
import { logClientError } from "./errors";
import { logger } from "./logger";
import { useToast } from "./toast-context";
import { useActiveWorkspaceSelection } from "./workspace-active-selection";
import { readStoredActiveWorkspaceId } from "./workspace-active-storage";
import {
  useWorkspaceDestructiveConfirmation,
  WorkspaceDestructiveConfirmationModal,
} from "./workspace-destructive-confirmation";
import { useWorkspaceContextValues } from "./workspace-context-values";
import { useWorkspaceMembershipState } from "./workspace-membership-state";
import {
  useActiveWorkspaceReconciliation,
  usePendingWorkspaceInvitePolling,
} from "./workspace-provider-effects";
import { useWorkspaceIntelligenceState } from "./workspace-intelligence-state";
import { flattenWorkspaces } from "./workspace-utils";
import {
  createSubspaceRequest,
  createWorkspaceRequest,
  deleteWorkspaceRequest,
  fetchWorkspaceHierarchy,
  fetchWorkspaceSubspaces,
  fetchWorkspaceTree,
  findRootWorkspaceById,
  findWorkspaceById,
  patchWorkspaceInTree,
  renameWorkspaceRequest,
  removeWorkspaceFromTree,
  sortSubspaces,
  updateWorkspaceSubspaces,
  upsertWorkspaceTree,
} from "./workspace-tree";
import {
  type Workspace,
  type WorkspaceCreatePayload,
  type WorkspaceSubspaceCreatePayload,
} from "./workspace-types";
import { WorkspaceIntelligenceContext } from "./workspace-intelligence-context";
import { WorkspaceMembershipContext } from "./workspace-membership-context";
import { WorkspaceTreeContext } from "./workspace-tree-context";
import type { RefreshOptions } from "./workspace-context-types";

export { useWorkspaceIntelligence } from "./workspace-intelligence-context";
export { useWorkspaceMembership } from "./workspace-membership-context";
export { useWorkspaceTree } from "./workspace-tree-context";
export type {
  RefreshOptions,
  WorkspaceIntelligenceContextValue,
  WorkspaceMembershipContextValue,
  WorkspaceTreeContextValue,
} from "./workspace-context-types";

const WORKSPACE_SILENT_REFRESH_MIN_MS = 15_000;
const PENDING_INVITES_POLL_INTERVAL_MS = 60_000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id ?? null;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subspaceLoadingByParentId, setSubspaceLoadingByParentId] = useState<Record<string, boolean>>({});
  const [subspaceErrorByParentId, setSubspaceErrorByParentId] = useState<Record<string, string | null>>({});
  const {
    confirmation: destructiveConfirmation,
    confirmDestructiveAction,
    cancelDestructiveConfirmation,
    approveDestructiveConfirmation,
  } = useWorkspaceDestructiveConfirmation();
  
  const {
    activeWorkspaceId,
    activeWorkspaceIdRef,
    requestGenerationRef,
    replaceActiveWorkspace,
    setActiveWorkspace,
  } = useActiveWorkspaceSelection(userId);
  const workspaceFetchIdRef = useRef(0);
  
  const createWorkspaceInFlightRef = useRef<Map<string, Promise<Workspace>>>(new Map());
  const workspaceRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const workspaceTreeRefreshInFlightRef = useRef<Map<string, Promise<Workspace | null>>>(new Map());
  const subspaceRefreshInFlightRef = useRef<Map<string, Promise<Workspace[]>>>(new Map());
  const lastWorkspaceRefreshAtRef = useRef(0);

  const {
    activeWorkspaceIntelligence,
    intelligenceError,
    intelligenceLoading,
    clearWorkspaceIntelligenceRequest,
    refreshWorkspaceIntelligence,
    resetWorkspaceIntelligenceState,
    updateWorkspaceIntelligence,
  } = useWorkspaceIntelligenceState({
    activeWorkspaceId,
    activeWorkspaceIdRef,
    requestGenerationRef,
    setWorkspaces,
  });

  const activeWorkspace = useMemo(
    () => findWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const activeRootWorkspace = useMemo(
    () => findRootWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const refreshWorkspaces = useCallback(async (options?: RefreshOptions) => {
    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastWorkspaceRefreshAtRef.current < WORKSPACE_SILENT_REFRESH_MIN_MS
    ) {
      return;
    }

    if (workspaceRefreshInFlightRef.current) {
      return workspaceRefreshInFlightRef.current;
    }

    const requestId = workspaceFetchIdRef.current + 1;
    workspaceFetchIdRef.current = requestId;

    const request = (async () => {
      try {
        if (!options?.silent) {
          setLoading(true);
        }
        const data = await fetchWorkspaceHierarchy({ force: options?.force });
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        setWorkspaces(data);
        setError(null);
        lastWorkspaceRefreshAtRef.current = Date.now();
      } catch (err) {
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        logClientError("[workspace] failed to load hierarchy", err, { endpoint: "/workspaces/hierarchy" });
        setError("Unable to load workspaces. Check your connection and try again.");
      } finally {
        if (workspaceFetchIdRef.current === requestId && !options?.silent) {
          setLoading(false);
        }
        workspaceRefreshInFlightRef.current = null;
      }
    })();

    workspaceRefreshInFlightRef.current = request;
    return request;
  }, []);

  const refreshWorkspaceTree = useCallback(async (workspaceId: string, options?: RefreshOptions) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return null;
    }

    const inFlight = workspaceTreeRefreshInFlightRef.current.get(normalizedWorkspaceId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const tree = await fetchWorkspaceTree(normalizedWorkspaceId, { force: options?.force });
        if (tree) {
          setWorkspaces((current) => upsertWorkspaceTree(current, tree));
        }
        return tree ?? null;
      } catch (err) {
        if (!options?.silent) {
          logClientError("[workspace] failed to load workspace hierarchy", err, { endpoint: `/workspaces/${normalizedWorkspaceId}/hierarchy` });
          setError("Unable to load workspaces. Check your connection and try again.");
        }
        return null;
      } finally {
        workspaceTreeRefreshInFlightRef.current.delete(normalizedWorkspaceId);
      }
    })();

    workspaceTreeRefreshInFlightRef.current.set(normalizedWorkspaceId, request);
    return request;
  }, []);

  const refreshWorkspaceSubspaces = useCallback(async (workspaceId: string, options?: RefreshOptions) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return [];
    }

    const inFlight = subspaceRefreshInFlightRef.current.get(normalizedWorkspaceId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: true }));
        }
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: null }));
        const subspaces = await fetchWorkspaceSubspaces(normalizedWorkspaceId, { force: options?.force });
        setWorkspaces((current) => updateWorkspaceSubspaces(current, normalizedWorkspaceId, subspaces));
        return subspaces;
      } catch (err) {
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: "Unable to load subspaces." }));
        if (!options?.silent) {
          logClientError("Failed to load workspace subspaces", err, { endpoint: `/workspaces/${normalizedWorkspaceId}/subspaces` });
        }
        return [];
      } finally {
        if (!options?.silent) {
          setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: false }));
        }
        subspaceRefreshInFlightRef.current.delete(normalizedWorkspaceId);
      }
    })();

    subspaceRefreshInFlightRef.current.set(normalizedWorkspaceId, request);
    return request;
  }, []);

  const {
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
  } = useWorkspaceMembershipState({
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
  });

  const createWorkspace = useCallback(async (payload: WorkspaceCreatePayload) => {
    const normalizedPayload = {
      ...payload,
      name: payload.name.trim(),
    };
    const inFlightKey = `${normalizedPayload.name.toLowerCase()}::${normalizedPayload.description ?? ""}::${normalizedPayload.workspace_type ?? "workspace"}::${normalizedPayload.parent_workspace_id ?? ""}`;
    const inFlight = createWorkspaceInFlightRef.current.get(inFlightKey);
    if (inFlight) {
      logger.debug("[workspace] create deduped while request is in flight", { name: normalizedPayload.name });
      return inFlight;
    }

    logger.debug("[workspace] explicit create requested", { name: normalizedPayload.name });
    const request = createWorkspaceRequest(normalizedPayload)
      .then(async (workspace) => {
        logger.debug("[workspace] create success", { id: workspace.id, name: workspace.name });
        const nextWorkspace =
          workspace.workspace_type === "super_workspace"
            ? (await refreshWorkspaceTree(workspace.id, { force: true, silent: true })) ?? workspace
            : workspace;
        setWorkspaces((current) => upsertWorkspaceTree(current, nextWorkspace));
        showToast({ title: "Workspace created", message: workspace.name });
        return nextWorkspace;
      })
      .finally(() => {
        createWorkspaceInFlightRef.current.delete(inFlightKey);
      });

    createWorkspaceInFlightRef.current.set(inFlightKey, request);
    return request;
  }, [refreshWorkspaceTree, showToast]);

  const createSubspace = useCallback(async (parentId: string, payload: WorkspaceSubspaceCreatePayload) => {
    const normalizedPayload = { ...payload, name: payload.name.trim() };
    if (!normalizedPayload.name) {
      throw new Error("Subspace name cannot be empty.");
    }
    const workspace = await createSubspaceRequest(parentId, normalizedPayload);
    setWorkspaces((current) =>
      updateWorkspaceSubspaces(
        current,
        parentId,
        sortSubspaces([workspace, ...(findWorkspaceById(current, parentId)?.subspaces ?? [])].filter((item, index, items) =>
          items.findIndex((candidate) => candidate.id === item.id) === index,
        )),
      ),
    );
    const refreshed = await refreshWorkspaceTree(parentId, { force: true, silent: true });
    if (!refreshed) {
      await refreshWorkspaces({ force: true, silent: true });
    }
    showToast({ title: "Subspace created", message: workspace.name });
    return workspace;
  }, [refreshWorkspaceTree, refreshWorkspaces, showToast]);

  const renameWorkspace = useCallback(async (workspaceId: string, payload: { name: string; description?: string | null }) => {
    const nextName = payload.name.trim();
    if (!nextName) {
      throw new Error("Workspace name cannot be empty.");
    }

    logger.debug("[workspace] rename requested", { workspaceId, nextName });
    const previousWorkspaces = workspaces;

    setWorkspaces((current) =>
      patchWorkspaceInTree(current, workspaceId, (workspace) => ({
        ...workspace,
        name: nextName,
        description: payload.description ?? workspace.description,
      })),
    );

    try {
      const updated = await renameWorkspaceRequest(workspaceId, {
        ...payload,
        name: nextName,
      });
      logger.debug("[workspace] rename success", { workspaceId, name: updated.name });
      showToast({ title: "Workspace renamed", message: updated.name });
      void refreshWorkspaces({ force: true, silent: true });
      return updated;
    } catch (err) {
      logger.debug("[workspace] rename failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      throw err;
    }
  }, [workspaces, refreshWorkspaces, showToast]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    const workspace = findWorkspaceById(workspaces, workspaceId);
    const confirmed = await confirmDestructiveAction({
      title: "Delete workspace",
      description: `Delete ${workspace?.name || "this workspace"}? This removes the workspace and its shared context for every member.`,
      confirmLabel: "Delete workspace",
    });
    if (!confirmed) return;

    logger.debug("[workspace] delete requested", { workspaceId });
    const previousWorkspaces = workspaces;
    const remainingWorkspaces = removeWorkspaceFromTree(workspaces, workspaceId);
    setWorkspaces(remainingWorkspaces);

    if (!findWorkspaceById(remainingWorkspaces, activeWorkspaceId)) {
      setActiveWorkspace(flattenWorkspaces(remainingWorkspaces)[0]?.id ?? null);
      clearActiveWorkspaceMembership();
    }

    try {
      await deleteWorkspaceRequest(workspaceId);
      logger.debug("[workspace] delete success", { workspaceId });
      await refreshWorkspaces({ force: true });
      showToast({ title: "Workspace deleted", message: workspace?.name || "Workspace removed" });
    } catch (err) {
      logger.debug("[workspace] delete failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspace(workspaceId);
      }
      throw err;
    }
  }, [
    activeWorkspaceId,
    clearActiveWorkspaceMembership,
    confirmDestructiveAction,
    refreshWorkspaces,
    setActiveWorkspace,
    showToast,
    workspaces,
  ]);

  useEffect(() => {
    if (!userId) {
      workspaceFetchIdRef.current += 1;
      createWorkspaceInFlightRef.current.clear();
      workspaceRefreshInFlightRef.current = null;
      workspaceTreeRefreshInFlightRef.current.clear();
      subspaceRefreshInFlightRef.current.clear();
      lastWorkspaceRefreshAtRef.current = 0;
      setWorkspaces([]);
      setActiveWorkspace(null);
      resetWorkspaceMembershipState();
      resetWorkspaceIntelligenceState();
      setSubspaceLoadingByParentId({});
      setSubspaceErrorByParentId({});
      setLoading(false);
      return;
    }

    workspaceFetchIdRef.current += 1;
    createWorkspaceInFlightRef.current.clear();
    workspaceRefreshInFlightRef.current = null;
    workspaceTreeRefreshInFlightRef.current.clear();
    subspaceRefreshInFlightRef.current.clear();
    lastWorkspaceRefreshAtRef.current = 0;
    setWorkspaces([]);
    replaceActiveWorkspace(null, { forceInvalidate: true });
    resetWorkspaceMembershipState();
    resetWorkspaceIntelligenceState();
    setSubspaceLoadingByParentId({});
    setSubspaceErrorByParentId({});
    setError(null);
    setLoading(true);

    refreshWorkspaces({ force: true });
    refreshPendingInvites({ force: true });

    try {
      const saved = readStoredActiveWorkspaceId(userId);
      logger.debug("[workspace] hydration read saved active workspace", { saved });
      replaceActiveWorkspace(saved);
    } catch {
      // ignore
    }
  }, [
    refreshPendingInvites,
    refreshWorkspaces,
    replaceActiveWorkspace,
    resetWorkspaceIntelligenceState,
    resetWorkspaceMembershipState,
    setActiveWorkspace,
    userId,
  ]);

  usePendingWorkspaceInvitePolling({
    userId,
    intervalMs: PENDING_INVITES_POLL_INTERVAL_MS,
    refreshPendingInvites,
  });

  useActiveWorkspaceReconciliation({
    activeWorkspaceId,
    error,
    loading,
    setActiveWorkspace,
    userId,
    workspaces,
  });

  useEffect(() => {
    clearActiveWorkspaceDataRequest();
    void refreshActiveWorkspaceData({ force: true });
  }, [clearActiveWorkspaceDataRequest, refreshActiveWorkspaceData]);

  useEffect(() => {
    clearWorkspaceIntelligenceRequest();
    void refreshWorkspaceIntelligence({ force: true });
  }, [clearWorkspaceIntelligenceRequest, refreshWorkspaceIntelligence]);

  const { treeValue, membershipValue, intelligenceValue } = useWorkspaceContextValues({
    workspaces,
    loading,
    error,
    activeWorkspaceId,
    activeWorkspace,
    activeRootWorkspace,
    subspaceLoadingByParentId,
    subspaceErrorByParentId,
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
  });

  return (
    <WorkspaceTreeContext.Provider value={treeValue}>
      <WorkspaceMembershipContext.Provider value={membershipValue}>
        <WorkspaceIntelligenceContext.Provider value={intelligenceValue}>
          {children}
          <WorkspaceDestructiveConfirmationModal
            confirmation={destructiveConfirmation}
            onCancel={cancelDestructiveConfirmation}
            onConfirm={approveDestructiveConfirmation}
          />
        </WorkspaceIntelligenceContext.Provider>
      </WorkspaceMembershipContext.Provider>
    </WorkspaceTreeContext.Provider>
  );
}
