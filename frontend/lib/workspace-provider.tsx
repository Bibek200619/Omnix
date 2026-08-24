"use client";

import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { useAuth } from "./auth-context";
import { logClientError } from "./errors";
import { logger } from "./logger";
import { runExclusiveMutation } from "./mutation-lifecycle";
import { isQueryCancellation } from "./query";
import { useToast } from "./toast-context";
import { useActiveWorkspaceSelection } from "./workspace-active-selection";
import { readStoredActiveWorkspaceId } from "./workspace-active-storage";
import { useWorkspaceDestructiveConfirmation, WorkspaceDestructiveConfirmationModal } from "./workspace-destructive-confirmation";
import { useWorkspaceContextValues } from "./workspace-context-values";
import { useWorkspaceMembershipState } from "./workspace-membership-state";
import { useActiveWorkspaceReconciliation, usePendingWorkspaceInvitePolling } from "./workspace-provider-effects";
import { useWorkspaceIntelligenceState } from "./workspace-intelligence-state";
import { flattenWorkspaces } from "./workspace-utils";
import {
  createSubspaceRequest, createWorkspaceRequest,
  deleteWorkspaceRequest, fetchWorkspaceHierarchy, fetchWorkspaceSubspaces,
  fetchWorkspaceTree, findRootWorkspaceById, findWorkspaceMatchingRename,
  findWorkspaceSubtree, findWorkspaceById, invalidateWorkspaceDetailQueries,
  invalidateWorkspaceSubtreeDetailQueries, invalidateWorkspaceTreeQueries, patchWorkspaceInTree, prepareWorkspaceRenameMutation,
  rebaseWorkspaceCanonicalSnapshot, renameWorkspaceRequest, removeWorkspaceFromTree,
  reuseWorkspaceRefresh, runWorkspaceCreateMutation, runWorkspaceTreeMutation, sortSubspaces, type WorkspaceMutationEntry,
  type WorkspaceMutationProjection, type WorkspaceMutationScope,
  type WorkspaceScopedRefresh, updateWorkspaceSubspaces, upsertWorkspaceTree, workspaceCreateMutationKey,
  workspaceRefreshIsVisible, workspaceRequestIsCurrent, workspaceSelectionRollbackOwned,
} from "./workspace-tree";
import { type Workspace, type WorkspaceCreatePayload, type WorkspaceSubspaceCreatePayload } from "./workspace-types";
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
  const workspacesRef = useRef(workspaces);
  const workspaceMutationScopeRef = useRef<WorkspaceMutationScope>({ userId, generation: 0 });
  const canonicalWorkspacesRef = useRef({
    scope: workspaceMutationScopeRef.current,
    workspaces,
  });
  useLayoutEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);
  useLayoutEffect(() => {
    if (workspaceMutationScopeRef.current.userId !== userId) workspaceMutationScopeRef.current = {
      userId, generation: workspaceMutationScopeRef.current.generation + 1,
    };
  }, [userId]);
  const {
    confirmation: destructiveConfirmation,
    confirmDestructiveAction,
    cancelDestructiveConfirmation,
    approveDestructiveConfirmation,
  } = useWorkspaceDestructiveConfirmation();
  const {
    activeWorkspaceId,
    activeWorkspaceIdRef,
    captureActiveWorkspaceSelection,
    requestGenerationRef,
    replaceActiveWorkspace,
    setActiveWorkspace,
  } = useActiveWorkspaceSelection(userId);
  const workspaceFetchIdRef = useRef(0);
  const workspaceRefreshInFlightRef = useRef<{
    request: Promise<Workspace[] | null>; scope: WorkspaceMutationScope; visible: boolean;
  } | null>(null), workspaceRefreshResultRef = useRef<{
    data: Workspace[]; requestId: number; scope: WorkspaceMutationScope;
  } | null>(null);
  const workspaceTreeRefreshInFlightRef = useRef<Map<string, WorkspaceScopedRefresh<Workspace | null>>>(new Map());
  const subspaceRefreshInFlightRef = useRef<Map<string, WorkspaceScopedRefresh<Workspace[]>>>(new Map());
  const workspaceMutationInFlightRef = useRef<Map<string, Promise<unknown>>>(new Map());
  const workspaceMutationEntryRef = useRef<Map<string, WorkspaceMutationEntry>>(new Map());
  const lastWorkspaceRefreshAtRef = useRef(0);
  const commitWorkspaceSnapshot = useCallback((
    requestScope: WorkspaceMutationScope, update: (current: Workspace[]) => Workspace[],
  ) => {
    if (workspaceMutationScopeRef.current !== requestScope) return;
    const canonical = canonicalWorkspacesRef.current.scope === requestScope
      ? canonicalWorkspacesRef.current.workspaces
      : [];
    const rebased = rebaseWorkspaceCanonicalSnapshot(canonical, update,
      workspaceMutationEntryRef.current.values(), requestScope);
    canonicalWorkspacesRef.current = { scope: requestScope, workspaces: rebased.canonical };
    workspacesRef.current = rebased.projected;
    setWorkspaces((current) => workspaceMutationScopeRef.current === requestScope ? rebased.projected : current);
  }, []);
  const setCanonicalWorkspaces = useCallback((update: SetStateAction<Workspace[]>) => {
    const requestScope = workspaceMutationScopeRef.current;
    commitWorkspaceSnapshot(requestScope, (current) =>
      typeof update === "function" ? update(current) : update);
  }, [commitWorkspaceSnapshot]);

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
    setWorkspaces: setCanonicalWorkspaces,
  });

  const activeWorkspace = useMemo(() => findWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces]);
  const activeRootWorkspace = useMemo(() => findRootWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces]);
  const refreshWorkspaceHierarchy = useCallback(async (
    options?: RefreshOptions, requestScope = workspaceMutationScopeRef.current,
  ): Promise<Workspace[] | null> => {
    if (workspaceMutationScopeRef.current !== requestScope) return null;
    const now = Date.now();
    if (options?.silent && !options.force &&
      now - lastWorkspaceRefreshAtRef.current < WORKSPACE_SILENT_REFRESH_MIN_MS) return workspacesRef.current;

    if (!options?.force && workspaceRefreshInFlightRef.current?.scope === requestScope)
      return workspaceRefreshInFlightRef.current.request;
    const visible = workspaceRefreshIsVisible(
      options?.silent, workspaceRefreshInFlightRef.current, requestScope,
    );
    const requestId = workspaceFetchIdRef.current + 1;
    workspaceFetchIdRef.current = requestId;
    const authoritativeResult = () => {
      const inFlight = workspaceRefreshInFlightRef.current, result = workspaceRefreshResultRef.current;
      if (inFlight?.scope === requestScope) return inFlight.request;
      return result?.scope === requestScope && result.requestId > requestId ? result.data : null;
    };

    const request = (async () => {
      try {
        if (visible) setLoading(true);
        const data = await fetchWorkspaceHierarchy({ force: options?.force });
        if (workspaceMutationScopeRef.current !== requestScope) return null;
        if (workspaceFetchIdRef.current !== requestId) return authoritativeResult();
        workspaceRefreshResultRef.current = { data, requestId, scope: requestScope };
        commitWorkspaceSnapshot(requestScope, () => data);
        setError(null);
        lastWorkspaceRefreshAtRef.current = Date.now();
        return data;
      } catch (err) {
        if (workspaceMutationScopeRef.current !== requestScope) return null;
        if (workspaceFetchIdRef.current !== requestId) return authoritativeResult();
        if (isQueryCancellation(err)) return null;
        logClientError("[workspace] failed to load hierarchy", err, { endpoint: "/workspaces/hierarchy" });
        setError("Unable to load workspaces. Check your connection and try again.");
        return null;
      } finally {
        if (workspaceFetchIdRef.current === requestId &&
          workspaceMutationScopeRef.current === requestScope && visible) setLoading(false);
        if (workspaceFetchIdRef.current === requestId && workspaceMutationScopeRef.current === requestScope) {
          workspaceRefreshInFlightRef.current = null;
        }
      }
    })();

    workspaceRefreshInFlightRef.current = { request, scope: requestScope, visible };
    return request;
  }, [commitWorkspaceSnapshot]);
  const refreshWorkspaces = useCallback(async (options?: RefreshOptions) =>
    { await refreshWorkspaceHierarchy(options); }, [refreshWorkspaceHierarchy]);
  const refreshWorkspaceTree = useCallback(async (
    workspaceId: string, options?: RefreshOptions, requestScope = workspaceMutationScopeRef.current,
  ) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId || workspaceMutationScopeRef.current !== requestScope) return null;
    const inFlight = workspaceTreeRefreshInFlightRef.current.get(normalizedWorkspaceId);
    const reused = reuseWorkspaceRefresh(workspaceTreeRefreshInFlightRef.current, normalizedWorkspaceId, requestScope, options);
    if (reused) return reused.request;
    const visible = workspaceRefreshIsVisible(options?.silent, inFlight ?? null, requestScope);
    function isCurrent() {
      return workspaceRequestIsCurrent(workspaceTreeRefreshInFlightRef.current,
        normalizedWorkspaceId, request, requestScope, workspaceMutationScopeRef.current);
    }
    const request = fetchWorkspaceTree(normalizedWorkspaceId, { force: options?.force })
      .then((tree) => {
        if (!isCurrent()) return null;
        if (tree) commitWorkspaceSnapshot(requestScope, (current) => upsertWorkspaceTree(current, tree));
        setError(null);
        return tree ?? null;
      })
      .catch((err) => {
        if (!isCurrent()) return null;
        if (isQueryCancellation(err)) return null;
        if (workspaceTreeRefreshInFlightRef.current.get(normalizedWorkspaceId)?.visible) {
          logClientError("[workspace] failed to load workspace hierarchy", err, { endpoint: `/workspaces/${normalizedWorkspaceId}/hierarchy` });
          setError("Unable to load workspaces. Check your connection and try again.");
        }
        return null;
      })
      .finally(() => { if (isCurrent()) workspaceTreeRefreshInFlightRef.current.delete(normalizedWorkspaceId); });
    workspaceTreeRefreshInFlightRef.current.set(normalizedWorkspaceId, { request, scope: requestScope, visible });
    return request;
  }, [commitWorkspaceSnapshot]);
  const refreshWorkspaceSubspaces = useCallback(async (
    workspaceId: string, options?: RefreshOptions, requestScope = workspaceMutationScopeRef.current,
  ) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId || workspaceMutationScopeRef.current !== requestScope) return [];
    const inFlight = subspaceRefreshInFlightRef.current.get(normalizedWorkspaceId);
    const reused = reuseWorkspaceRefresh(subspaceRefreshInFlightRef.current, normalizedWorkspaceId, requestScope, options);
    if (reused?.becameVisible) setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: true }));
    if (reused) return reused.request;
    const visible = workspaceRefreshIsVisible(options?.silent, inFlight ?? null, requestScope);
    function isCurrent() {
      return workspaceRequestIsCurrent(subspaceRefreshInFlightRef.current,
        normalizedWorkspaceId, request, requestScope, workspaceMutationScopeRef.current);
    }
    const request = fetchWorkspaceSubspaces(normalizedWorkspaceId, { force: options?.force })
      .then((subspaces) => {
        if (!isCurrent()) return [];
        commitWorkspaceSnapshot(requestScope, (current) =>
          updateWorkspaceSubspaces(current, normalizedWorkspaceId, subspaces));
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: null }));
        return subspaces;
      })
      .catch((err) => {
        if (!isCurrent()) return [];
        if (isQueryCancellation(err)) return [];
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: "Unable to load subspaces." }));
        if (subspaceRefreshInFlightRef.current.get(normalizedWorkspaceId)?.visible) logClientError("Failed to load workspace subspaces", err, {
          endpoint: `/workspaces/${normalizedWorkspaceId}/subspaces`,
        });
        return [];
      })
      .finally(() => {
        if (!isCurrent()) return;
        if (subspaceRefreshInFlightRef.current.get(normalizedWorkspaceId)?.visible) setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: false }));
        subspaceRefreshInFlightRef.current.delete(normalizedWorkspaceId);
      });
    subspaceRefreshInFlightRef.current.set(normalizedWorkspaceId, { request, scope: requestScope, visible });
    if (visible) setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: true }));
    setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: null }));
    return request;
  }, [commitWorkspaceSnapshot]);

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
    setWorkspaces: setCanonicalWorkspaces,
    showToast,
    userId,
  });
  const createWorkspace = useCallback(async (payload: WorkspaceCreatePayload) => {
    const requestScope = workspaceMutationScopeRef.current;
    if (!requestScope.userId) throw new Error("A signed-in workspace session is required.");
    const normalizedPayload = { ...payload, name: payload.name.trim() };
    const mutationKey = workspaceCreateMutationKey(requestScope, {
      operation: "workspace", payload: normalizedPayload,
    });
    if (workspaceMutationInFlightRef.current.has(mutationKey)) {
      logger.debug("[workspace] create deduped while request is in flight", { name: normalizedPayload.name });
    }
    return runExclusiveMutation(workspaceMutationInFlightRef.current, mutationKey, async () => {
      logger.debug("[workspace] explicit create requested", { name: normalizedPayload.name });
      const workspace = await createWorkspaceRequest(normalizedPayload, { invalidate: false });
      if (workspaceMutationScopeRef.current !== requestScope) throw new Error("The workspace session changed before creation completed.");
      invalidateWorkspaceTreeQueries();
      logger.debug("[workspace] create success", { id: workspace.id, name: workspace.name });
      const nextWorkspace =
        workspace.workspace_type === "super_workspace"
          ? (await refreshWorkspaceTree(workspace.id, { force: true, silent: true }, requestScope)) ?? workspace
          : workspace;
      if (workspaceMutationScopeRef.current !== requestScope) throw new Error("The workspace session changed before creation completed.");
      commitWorkspaceSnapshot(requestScope, (current) => upsertWorkspaceTree(current, nextWorkspace));
      showToast({ title: "Workspace created", message: workspace.name });
      return nextWorkspace;
    });
  }, [commitWorkspaceSnapshot, refreshWorkspaceTree, showToast]);

  const createSubspace = useCallback(async (parentId: string, payload: WorkspaceSubspaceCreatePayload) => {
    const requestScope = workspaceMutationScopeRef.current;
    if (!requestScope.userId) throw new Error("A signed-in workspace session is required.");
    const normalizedParentId = parentId.trim();
    const normalizedPayload = { ...payload, name: payload.name.trim() };
    if (!normalizedParentId) throw new Error("A parent workspace is required.");
    if (!normalizedPayload.name) throw new Error("Subspace name cannot be empty.");
    const mutationKey = workspaceCreateMutationKey(requestScope, {
      operation: "subspace", parentId: normalizedParentId, payload: normalizedPayload,
    });
    return runWorkspaceCreateMutation(
      workspaceMutationInFlightRef.current,
      workspaceMutationEntryRef.current,
      requestScope,
      mutationKey,
      normalizedParentId,
      async () => {
      const workspace = await createSubspaceRequest(normalizedParentId, normalizedPayload, { invalidate: false });
      if (workspaceMutationScopeRef.current !== requestScope) throw new Error("The workspace session changed before subspace creation completed.");
      invalidateWorkspaceTreeQueries(normalizedParentId);
      commitWorkspaceSnapshot(requestScope, (current) => updateWorkspaceSubspaces(current, normalizedParentId,
        sortSubspaces([workspace, ...(findWorkspaceById(current, normalizedParentId)?.subspaces ?? [])].filter((item, index, items) =>
          items.findIndex((candidate) => candidate.id === item.id) === index))));
      const refreshed = await refreshWorkspaceTree(normalizedParentId, { force: true, silent: true }, requestScope);
      if (workspaceMutationScopeRef.current !== requestScope) throw new Error("The workspace session changed before subspace creation completed.");
      if (!refreshed) await refreshWorkspaceHierarchy({ force: true, silent: true }, requestScope);
      if (workspaceMutationScopeRef.current !== requestScope) throw new Error("The workspace session changed before subspace creation completed.");
      showToast({ title: "Subspace created", message: workspace.name });
      return workspace;
      },
    );
  }, [commitWorkspaceSnapshot, refreshWorkspaceHierarchy, refreshWorkspaceTree, showToast]);

  const renameWorkspace = useCallback(async (workspaceId: string, payload: { name: string; description?: string | null }) => {
    const requestScope = workspaceMutationScopeRef.current;
    const { fingerprint, hasDescription, nextName, optimisticPatch, projection, requestPayload } =
      prepareWorkspaceRenameMutation(workspaceId, payload);
    return runWorkspaceTreeMutation(
      workspaceMutationInFlightRef.current,
      workspaceMutationEntryRef.current,
      requestScope,
      canonicalWorkspacesRef.current.scope === requestScope ? canonicalWorkspacesRef.current.workspaces : [],
      workspaceId,
      fingerprint,
      async () => {
        if (workspaceMutationScopeRef.current !== requestScope || !requestScope.userId) {
          throw new Error("The workspace session changed before the rename started.");
        }
        logger.debug("[workspace] rename requested", { workspaceId, nextName });
        projection.active = true;
        if (findWorkspaceById(workspacesRef.current, workspaceId)) {
          setWorkspaces((current) =>
            workspaceMutationScopeRef.current === requestScope
              ? patchWorkspaceInTree(current, workspaceId, (workspace) => ({
                  ...workspace,
                  ...optimisticPatch,
                }))
              : current,
          );
        }

        try {
          const updated = await renameWorkspaceRequest(workspaceId, requestPayload);
          if (workspaceMutationScopeRef.current !== requestScope) {
            projection.active = false;
            return updated;
          }
          invalidateWorkspaceDetailQueries(workspaceId);
          commitWorkspaceSnapshot(requestScope, (current) => patchWorkspaceInTree(
            current, workspaceId, (workspace) => ({
              ...workspace,
              name: updated.name,
              ...(hasDescription ? { description: updated.description ?? "" } : {}),
            }),
          ));
          await refreshWorkspaceHierarchy({ force: true, silent: true }, requestScope);
          projection.active = false;
          if (workspaceMutationScopeRef.current !== requestScope) return updated;
          commitWorkspaceSnapshot(requestScope, (current) => current);
          logger.debug("[workspace] rename success", { workspaceId, name: updated.name });
          showToast({ title: "Workspace renamed", message: updated.name });
          return updated;
        } catch (err) {
          if (workspaceMutationScopeRef.current === requestScope) {
            invalidateWorkspaceDetailQueries(workspaceId);
            logger.debug("[workspace] rename failed; rolling back owned fields", { workspaceId, err });
            const canonical = await refreshWorkspaceHierarchy({ force: true, silent: true }, requestScope);
            projection.active = false;
            if (workspaceMutationScopeRef.current !== requestScope) throw err;
            const committed = canonical && findWorkspaceMatchingRename(
              canonical, workspaceId, requestPayload,
            );
            commitWorkspaceSnapshot(requestScope, (current) => current);
            if (committed) {
              logger.debug("[workspace] rename reconciled as committed", { workspaceId, name: committed.name });
              showToast({ title: "Workspace renamed", message: committed.name });
              return committed;
            }
          } else projection.active = false;
          throw err;
        }
      },
      projection,
    );
  }, [commitWorkspaceSnapshot, refreshWorkspaceHierarchy, showToast]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    const requestScope = workspaceMutationScopeRef.current;
    const projection: WorkspaceMutationProjection = { active: false, kind: "delete", workspaceId };
    return runWorkspaceTreeMutation(
      workspaceMutationInFlightRef.current,
      workspaceMutationEntryRef.current,
      requestScope,
      canonicalWorkspacesRef.current.scope === requestScope ? canonicalWorkspacesRef.current.workspaces : [],
      workspaceId,
      "delete",
      async () => {
        if (workspaceMutationScopeRef.current !== requestScope || !requestScope.userId) return;
        const workspace = findWorkspaceById(workspacesRef.current, workspaceId);
        const confirmed = await confirmDestructiveAction({
          title: "Delete workspace",
          description: `Delete ${workspace?.name || "this workspace"}? This removes the workspace and its shared context for every member.`,
          confirmLabel: "Delete workspace",
        });
        if (!confirmed || workspaceMutationScopeRef.current !== requestScope) return;

        logger.debug("[workspace] delete requested", { workspaceId });
        const removed = findWorkspaceSubtree(
          canonicalWorkspacesRef.current.scope === requestScope
            ? canonicalWorkspacesRef.current.workspaces
            : [],
          workspaceId,
        );
        const remainingWorkspaces = removeWorkspaceFromTree(workspacesRef.current, workspaceId);
        const previousActiveWorkspaceId = activeWorkspaceIdRef.current;
        const optimisticActiveWorkspaceId = findWorkspaceById(remainingWorkspaces, previousActiveWorkspaceId)
          ? previousActiveWorkspaceId
          : flattenWorkspaces(remainingWorkspaces)[0]?.id ?? null;
        let optimisticSelectionRevision: number | null = null;
        projection.active = true;
        setWorkspaces((current) =>
          workspaceMutationScopeRef.current === requestScope
            ? removeWorkspaceFromTree(current, workspaceId)
            : current,
        );
        if (
          workspaceMutationScopeRef.current === requestScope &&
          optimisticActiveWorkspaceId !== previousActiveWorkspaceId
        ) {
          setActiveWorkspace(optimisticActiveWorkspaceId);
          optimisticSelectionRevision = requestGenerationRef.current;
          clearActiveWorkspaceMembership();
        }

        try {
          await deleteWorkspaceRequest(workspaceId);
        } catch (err) {
          if (workspaceMutationScopeRef.current === requestScope) {
            logger.debug("[workspace] delete failed; restoring removed subtree", { workspaceId, err });
            const canonical = await refreshWorkspaceHierarchy({ force: true, silent: true }, requestScope);
            projection.active = false;
            if (workspaceMutationScopeRef.current !== requestScope) throw err;
            if (canonical && !findWorkspaceById(canonical, workspaceId)) {
              invalidateWorkspaceSubtreeDetailQueries(workspaceId, removed?.subtree);
              commitWorkspaceSnapshot(requestScope, (current) => current);
              logger.debug("[workspace] delete reconciled as committed", { workspaceId });
              showToast({ title: "Workspace deleted", message: removed?.subtree.name || workspace?.name || "Workspace removed" });
              return;
            }
            commitWorkspaceSnapshot(requestScope, (current) => current);
            if (optimisticActiveWorkspaceId !== previousActiveWorkspaceId && workspaceSelectionRollbackOwned(
              activeWorkspaceIdRef.current, optimisticActiveWorkspaceId,
              requestGenerationRef.current, optimisticSelectionRevision,
            )) setActiveWorkspace(previousActiveWorkspaceId);
          } else projection.active = false;
          throw err;
        }

        if (workspaceMutationScopeRef.current !== requestScope) {
          projection.active = false;
          return;
        }
        invalidateWorkspaceSubtreeDetailQueries(workspaceId, removed?.subtree);
        logger.debug("[workspace] delete success", { workspaceId });
        commitWorkspaceSnapshot(requestScope, (current) => removeWorkspaceFromTree(current, workspaceId));
        await refreshWorkspaceHierarchy({ force: true, silent: true }, requestScope);
        projection.active = false;
        if (workspaceMutationScopeRef.current !== requestScope) return;
        commitWorkspaceSnapshot(requestScope, (current) => current);
        showToast({ title: "Workspace deleted", message: removed?.subtree.name || workspace?.name || "Workspace removed" });
      },
      projection,
    );
  }, [activeWorkspaceIdRef, clearActiveWorkspaceMembership, commitWorkspaceSnapshot, confirmDestructiveAction,
    refreshWorkspaceHierarchy, requestGenerationRef, setActiveWorkspace, showToast]);

  useEffect(() => {
    if (!userId) {
      workspaceFetchIdRef.current += 1;
      workspaceRefreshInFlightRef.current = null;
      workspaceTreeRefreshInFlightRef.current.clear();
      subspaceRefreshInFlightRef.current.clear();
      lastWorkspaceRefreshAtRef.current = 0;
      canonicalWorkspacesRef.current = { scope: workspaceMutationScopeRef.current, workspaces: [] };
      workspacesRef.current = [];
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
    workspaceRefreshInFlightRef.current = null;
    workspaceTreeRefreshInFlightRef.current.clear();
    subspaceRefreshInFlightRef.current.clear();
    lastWorkspaceRefreshAtRef.current = 0;
    canonicalWorkspacesRef.current = { scope: workspaceMutationScopeRef.current, workspaces: [] };
    workspacesRef.current = [];
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
