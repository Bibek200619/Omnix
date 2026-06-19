"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { setApiWorkspaceId } from "./api";
import { useAuth } from "./auth-context";
import { logClientError } from "./errors";
import { logger } from "./logger";
import { useToast } from "./toast-context";
import { isWorkspaceFounderRole } from "./workspace-roles";
import { flattenWorkspaces } from "./workspace-utils";
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
import {
  applyWorkspaceIntelligenceProfile,
  fetchWorkspaceIntelligenceProfile,
  updateWorkspaceIntelligenceProfile,
} from "./workspace-intelligence";
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
  getWorkspaceInviteId,
  type Workspace,
  type WorkspaceCreatePayload,
  type WorkspaceIntelligenceProfile,
  type WorkspaceIntelligenceUpdatePayload,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberAssign,
  type WorkspaceRole,
  type WorkspaceSubspaceCreatePayload,
} from "./workspace-types";
import { WorkspaceIntelligenceContext } from "./workspace-intelligence-context";
import { WorkspaceMembershipContext } from "./workspace-membership-context";
import { WorkspaceTreeContext } from "./workspace-tree-context";
import type {
  RefreshOptions,
  WorkspaceContextType,
  WorkspaceIntelligenceContextValue,
  WorkspaceMembershipContextValue,
  WorkspaceTreeContextValue,
} from "./workspace-context-types";

export { useWorkspaceIntelligence } from "./workspace-intelligence-context";
export { useWorkspaceMembership } from "./workspace-membership-context";
export { useWorkspaceTree } from "./workspace-tree-context";
export type {
  RefreshOptions,
  WorkspaceContextType,
  WorkspaceIntelligenceContextValue,
  WorkspaceMembershipContextValue,
  WorkspaceTreeContextValue,
} from "./workspace-context-types";

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

type DestructiveConfirmation = {
  title: string;
  description: string;
  confirmLabel: string;
  resolve: (confirmed: boolean) => void;
};

const LEGACY_WORKSPACE_STORAGE_KEY = "omnix.activeWorkspaceId";

function workspaceStorageKey(userId?: string | null) {
  return userId ? `${LEGACY_WORKSPACE_STORAGE_KEY}.${userId}` : null;
}

const WORKSPACE_SILENT_REFRESH_MIN_MS = 15_000;
const PENDING_INVITES_POLL_INTERVAL_MS = 60_000;
const PENDING_INVITES_SILENT_REFRESH_MIN_MS = 30_000;
const ACTIVE_WORKSPACE_DATA_MIN_MS = 45_000;

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const userId = user?.id ?? null;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeMembers, setActiveMembers] = useState<WorkspaceMember[]>([]);
  const [activeInvites, setActiveInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [activeWorkspaceIntelligence, setActiveWorkspaceIntelligence] = useState<WorkspaceIntelligenceProfile | null>(null);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [subspaceLoadingByParentId, setSubspaceLoadingByParentId] = useState<Record<string, boolean>>({});
  const [subspaceErrorByParentId, setSubspaceErrorByParentId] = useState<Record<string, string | null>>({});
  const [destructiveConfirmation, setDestructiveConfirmation] = useState<DestructiveConfirmation | null>(null);
  
  const requestGenerationRef = useRef(0);
  const workspaceFetchIdRef = useRef(0);
  
  const createWorkspaceInFlightRef = useRef<Map<string, Promise<Workspace>>>(new Map());
  const workspaceRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const workspaceTreeRefreshInFlightRef = useRef<Map<string, Promise<Workspace | null>>>(new Map());
  const subspaceRefreshInFlightRef = useRef<Map<string, Promise<Workspace[]>>>(new Map());
  const pendingInvitesInFlightRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceDataInFlightRef = useRef<{ 
    workspaceId: string; 
    generation: number;
    request: Promise<void> 
  } | null>(null);
  const workspaceIntelligenceInFlightRef = useRef<{
    workspaceId: string;
    generation: number;
    request: Promise<WorkspaceIntelligenceProfile | null>;
  } | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const lastWorkspaceRefreshAtRef = useRef(0);
  const lastPendingInvitesRefreshAtRef = useRef(0);
  const lastActiveWorkspaceDataRefreshAtRef = useRef(0);

  const confirmDestructiveAction = useCallback(
    (confirmation: Omit<DestructiveConfirmation, "resolve">) =>
      new Promise<boolean>((resolve) => {
        setDestructiveConfirmation({ ...confirmation, resolve });
      }),
    [],
  );

  const cancelDestructiveConfirmation = useCallback(() => {
    setDestructiveConfirmation((current) => {
      current?.resolve(false);
      return null;
    });
  }, []);

  const approveDestructiveConfirmation = useCallback(() => {
    setDestructiveConfirmation((current) => {
      current?.resolve(true);
      return null;
    });
  }, []);

  const activeWorkspace = useMemo(
    () => findWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const activeRootWorkspace = useMemo(
    () => findRootWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
    requestGenerationRef.current += 1; // Increment generation on workspace switch
  }, [activeWorkspaceId]);

  const setActiveWorkspace = useCallback((id: string | null) => {
    logger.debug("[workspace] set active workspace", { id });
    if (id !== activeWorkspaceIdRef.current) {
      requestGenerationRef.current += 1;
    }
    setActiveWorkspaceId(id);
    setApiWorkspaceId(id);
    try {
      if (typeof window !== "undefined") {
        const storageKey = workspaceStorageKey(userId);
        window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
        if (!storageKey) {
          return;
        }
        if (id) {
          window.localStorage.setItem(storageKey, id);
        } else {
          window.localStorage.removeItem(storageKey);
        }
      }
    } catch {
      // ignore
    }
  }, [userId]);

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
        
        // Discard if workspace or generation changed
        if (
          activeWorkspaceIdRef.current !== requestWorkspaceId || 
          requestGenerationRef.current !== generation
        ) {
          return;
        }
        
        setActiveMembers(members || []);
        setMembersError(null);
      } catch (err) {
        logClientError("Failed to load workspace members", err, { endpoint: `/workspaces/${requestWorkspaceId}/members` });
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
        if (activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId) {
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
        logClientError("Failed to load workspace invites", err, { endpoint: `/workspaces/${requestWorkspaceId}/invites` });
      } finally {
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setInvitesLoading(false);
        }
        if (activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId) {
          activeWorkspaceDataInFlightRef.current = null;
        }
      }
    })();

    activeWorkspaceDataInFlightRef.current = { workspaceId: requestWorkspaceId, generation, request };
    return request;
  }, [activeWorkspace, activeWorkspaceId]);

  const refreshWorkspaceIntelligence = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveWorkspaceIntelligence(null);
      setIntelligenceError(null);
      return null;
    }

    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;

    if (
      workspaceIntelligenceInFlightRef.current?.workspaceId === requestWorkspaceId &&
      workspaceIntelligenceInFlightRef.current?.generation === generation
    ) {
      return workspaceIntelligenceInFlightRef.current.request;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setIntelligenceLoading(true);
        }
        const profile = await fetchWorkspaceIntelligenceProfile(requestWorkspaceId);
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveWorkspaceIntelligence(profile);
          setIntelligenceError(null);
        }
        return profile;
      } catch (err) {
        logClientError("Failed to load workspace intelligence", err, { endpoint: `/workspaces/${requestWorkspaceId}/intelligence` });
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveWorkspaceIntelligence(null);
          setIntelligenceError("Unable to load workspace intelligence. Please try again in a moment.");
        }
        return null;
      } finally {
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setIntelligenceLoading(false);
        }
        if (workspaceIntelligenceInFlightRef.current?.workspaceId === requestWorkspaceId) {
          workspaceIntelligenceInFlightRef.current = null;
        }
      }
    })();

    workspaceIntelligenceInFlightRef.current = { workspaceId: requestWorkspaceId, generation, request };
    return request;
  }, [activeWorkspaceId]);

  const updateWorkspaceIntelligence = useCallback(async (payload: WorkspaceIntelligenceUpdatePayload) => {
    if (!activeWorkspaceId) {
      throw new Error("Select a workspace first.");
    }
    const profile = await updateWorkspaceIntelligenceProfile(activeWorkspaceId, payload);
    setActiveWorkspaceIntelligence(profile);
    setWorkspaces((current) =>
      patchWorkspaceInTree(current, activeWorkspaceId, (workspace) =>
        applyWorkspaceIntelligenceProfile(workspace, profile),
      ),
    );
    return profile;
  }, [activeWorkspaceId]);

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
      .then((workspace) => {
        logger.debug("[workspace] create success", { id: workspace.id, name: workspace.name });
        setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
        showToast({ title: "Workspace created", message: workspace.name });
        if (workspace.workspace_type === "super_workspace") {
          void refreshWorkspaceTree(workspace.id, { silent: true });
        }
        return workspace;
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
      setActiveMembers([]);
      setActiveInvites([]);
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
  }, [activeWorkspaceId, confirmDestructiveAction, refreshWorkspaces, setActiveWorkspace, showToast, workspaces]);

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
    [activeWorkspaceId, refreshActiveWorkspaceData],
  );

  const removeWorkspaceMember = useCallback(
    async (userId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const member = activeMembers.find((item) => item.user_id === userId);
      const memberLabel = member?.full_name || member?.email || "this member";
      const confirmed = await confirmDestructiveAction({
        title: "Remove member",
        description: `Remove ${memberLabel} from ${activeWorkspace?.name || "this workspace"}? They will lose access to this workspace immediately.`,
        confirmLabel: "Remove member",
      });
      if (!confirmed) return;

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;

      setActiveMembers((current) => current.filter((member) => member.user_id !== userId));

      try {
        await removeWorkspaceMemberRequest(requestWorkspaceId, userId);
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
    [activeMembers, activeWorkspace?.name, activeWorkspaceId, confirmDestructiveAction, refreshActiveWorkspaceData, refreshWorkspaces, showToast],
  );

  const updateWorkspaceMemberRole = useCallback(
    async (userId: string, role: WorkspaceRole) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      if (activeWorkspaceIdRef.current === requestWorkspaceId) {
        setActiveMembers((current) =>
          current.map((member) =>
            member.user_id === userId
              ? { ...member, role, updated_at: new Date().toISOString() }
              : member,
          ),
        );
      }

      try {
        const updated = await updateWorkspaceMemberRoleRequest(requestWorkspaceId, userId, role);
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers((current) =>
            current.map((member) => (member.user_id === userId ? updated : member)),
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
    [activeMembers, activeWorkspaceId, refreshActiveWorkspaceData, refreshWorkspaces],
  );

  const assignWorkspaceMember = useCallback(
    async (payload: WorkspaceMemberAssign) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      const shouldApplyActiveUpdate = activeWorkspaceIdRef.current === requestWorkspaceId;

      // Optimistic member count update in tree
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
        // Rollback on failure
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
    [activeWorkspaceId, activeMembers, refreshActiveWorkspaceData, refreshWorkspaces],
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
    [refreshWorkspaces, setActiveWorkspace],
  );

  const declineInvite = useCallback(
    async (inviteId: string) => {
      await declineWorkspaceInvite(inviteId);
      setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
    },
    [],
  );

  useEffect(() => {
    if (!userId) {
      workspaceFetchIdRef.current += 1;
      createWorkspaceInFlightRef.current.clear();
      workspaceRefreshInFlightRef.current = null;
      workspaceTreeRefreshInFlightRef.current.clear();
      subspaceRefreshInFlightRef.current.clear();
      pendingInvitesInFlightRef.current = null;
      activeWorkspaceDataInFlightRef.current = null;
      workspaceIntelligenceInFlightRef.current = null;
      lastWorkspaceRefreshAtRef.current = 0;
      lastPendingInvitesRefreshAtRef.current = 0;
      lastActiveWorkspaceDataRefreshAtRef.current = 0;
      setWorkspaces([]);
      setActiveWorkspace(null);
      setActiveMembers([]);
      setActiveInvites([]);
      setPendingInvites([]);
      setActiveWorkspaceIntelligence(null);
      setIntelligenceError(null);
      setMembersError(null);
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
    pendingInvitesInFlightRef.current = null;
    activeWorkspaceDataInFlightRef.current = null;
    workspaceIntelligenceInFlightRef.current = null;
    lastWorkspaceRefreshAtRef.current = 0;
    lastPendingInvitesRefreshAtRef.current = 0;
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setApiWorkspaceId(null);
    setActiveMembers([]);
    setActiveInvites([]);
    setPendingInvites([]);
    setActiveWorkspaceIntelligence(null);
    setIntelligenceError(null);
    setMembersError(null);
    setSubspaceLoadingByParentId({});
    setSubspaceErrorByParentId({});
    setError(null);
    setLoading(true);

    refreshWorkspaces({ force: true });
    refreshPendingInvites({ force: true });

    try {
      const storageKey = workspaceStorageKey(userId);
      const saved = typeof window !== "undefined" && storageKey ? window.localStorage.getItem(storageKey) : null;
      logger.debug("[workspace] hydration read saved active workspace", { saved });
      setApiWorkspaceId(saved);
      if (saved) {
        setActiveWorkspaceId(saved);
      }
    } catch {
      // ignore
    }
  }, [refreshPendingInvites, refreshWorkspaces, setActiveWorkspace, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshPendingInvites({ silent: true });
      }
    }, PENDING_INVITES_POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshPendingInvites({ silent: true });
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPendingInvites, userId]);

  useEffect(() => {
    if (!userId || loading) {
      return;
    }

    if (error && workspaces.length === 0) {
      logger.debug("[workspace] fetch failed; preserving active workspace id during failure state");
      return;
    }

    if (workspaces.length === 0) {
      logger.debug("[workspace] no workspaces after verified fetch; waiting for explicit create");
      if (activeWorkspaceId) {
        setActiveWorkspace(null);
      }
      return;
    }

    const activeExists = Boolean(findWorkspaceById(workspaces, activeWorkspaceId));
    if (!activeExists) {
      const nextWorkspaceId = flattenWorkspaces(workspaces)[0]?.id ?? null;
      logger.debug("[workspace] saved active workspace missing; selecting first available workspace", {
        activeWorkspaceId,
        nextWorkspaceId,
      });
      setActiveWorkspace(nextWorkspaceId);
    }
  }, [activeWorkspaceId, error, loading, setActiveWorkspace, userId, workspaces]);

  useEffect(() => {
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
    activeWorkspaceDataInFlightRef.current = null;
    void refreshActiveWorkspaceData({ force: true });
  }, [refreshActiveWorkspaceData]);

  useEffect(() => {
    workspaceIntelligenceInFlightRef.current = null;
    void refreshWorkspaceIntelligence({ force: true });
  }, [refreshWorkspaceIntelligence]);

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

  const value = useMemo<WorkspaceContextType>(
    () => ({
      ...treeValue,
      ...membershipValue,
      ...intelligenceValue,
    }),
    [treeValue, membershipValue, intelligenceValue],
  );

  return (
    <WorkspaceTreeContext.Provider value={treeValue}>
      <WorkspaceMembershipContext.Provider value={membershipValue}>
        <WorkspaceIntelligenceContext.Provider value={intelligenceValue}>
          <WorkspaceContext.Provider value={value}>
            {children}
            <Modal
              isOpen={Boolean(destructiveConfirmation)}
              onClose={cancelDestructiveConfirmation}
              title={destructiveConfirmation?.title || "Confirm destructive action"}
              footer={
                <>
                  <Button type="button" variant="ghost" onClick={cancelDestructiveConfirmation}>
                    Cancel
                  </Button>
                  <Button type="button" variant="danger" onClick={approveDestructiveConfirmation}>
                    {destructiveConfirmation?.confirmLabel || "Confirm"}
                  </Button>
                </>
              }
            >
              <Modal.Header>
                <div>
                  <p className="text-base font-semibold text-white">{destructiveConfirmation?.title || "Confirm destructive action"}</p>
                  <p className="mt-1 text-sm text-[var(--omnix-text-2)]">This action needs confirmation before it runs.</p>
                </div>
              </Modal.Header>
              <Modal.Body>
                <p className="text-sm leading-6 text-[var(--omnix-text)]">{destructiveConfirmation?.description}</p>
              </Modal.Body>
            </Modal>
          </WorkspaceContext.Provider>
        </WorkspaceIntelligenceContext.Provider>
      </WorkspaceMembershipContext.Provider>
    </WorkspaceTreeContext.Provider>
  );
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
