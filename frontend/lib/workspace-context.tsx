"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";
import { getWorkspaceInviteId, type Workspace, type WorkspaceInvite, type WorkspaceMember } from "./workspace-types";

type RefreshOptions = {
  force?: boolean;
  silent?: boolean;
};

type WorkspaceContextType = {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  activeMembers: WorkspaceMember[];
  activeInvites: WorkspaceInvite[];
  pendingInvites: WorkspaceInvite[];
  membersLoading: boolean;
  invitesLoading: boolean;
  pendingInvitesLoading: boolean;
  setActiveWorkspace: (id: string | null) => void;
  refreshWorkspaces: (options?: RefreshOptions) => Promise<void>;
  refreshActiveWorkspaceData: (options?: RefreshOptions) => Promise<void>;
  refreshPendingInvites: (options?: RefreshOptions) => Promise<void>;
  createWorkspace: (payload: { name: string; description?: string }) => Promise<Workspace>;
  renameWorkspace: (workspaceId: string, payload: { name: string; description?: string | null }) => Promise<Workspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  inviteToActiveWorkspace: (target: string, role?: "co_owner" | "member") => Promise<void>;
  updateWorkspaceMemberRole: (userId: string, role: "co_owner" | "member") => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  acceptInvite: (inviteId: string) => Promise<Workspace>;
  declineInvite: (inviteId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function workspaceStorageKey() {
  return "omnix.activeWorkspaceId";
}

const WORKSPACE_SILENT_REFRESH_MIN_MS = 15_000;
const PENDING_INVITES_POLL_INTERVAL_MS = 60_000;
const PENDING_INVITES_SILENT_REFRESH_MIN_MS = 30_000;
const ACTIVE_WORKSPACE_DATA_MIN_MS = 45_000;

const inviteStatusRank: Record<WorkspaceInvite["status"], number> = {
  pending: 0,
  accepted: 1,
  declined: 2,
  revoked: 3,
};

function inviteTimestamp(invite: WorkspaceInvite) {
  return Date.parse(invite.updated_at || invite.created_at || "") || 0;
}

function sortWorkspaceInvites(invites: WorkspaceInvite[]) {
  return [...invites].sort((a, b) => {
    const statusDelta = inviteStatusRank[a.status] - inviteStatusRank[b.status];
    if (statusDelta !== 0) return statusDelta;
    return inviteTimestamp(b) - inviteTimestamp(a);
  });
}

function reconcileWorkspaceInvites(current: WorkspaceInvite[], incoming: WorkspaceInvite[]) {
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeMembers, setActiveMembers] = useState<WorkspaceMember[]>([]);
  const [activeInvites, setActiveInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const workspaceFetchIdRef = useRef(0);
  const createWorkspaceInFlightRef = useRef<Map<string, Promise<Workspace>>>(new Map());
  const workspaceRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const pendingInvitesInFlightRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceDataInFlightRef = useRef<Promise<void> | null>(null);
  const lastWorkspaceRefreshAtRef = useRef(0);
  const lastPendingInvitesRefreshAtRef = useRef(0);
  const lastActiveWorkspaceDataRefreshAtRef = useRef(0);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [activeWorkspaceId, workspaces],
  );

  const setActiveWorkspace = useCallback((id: string | null) => {
    console.debug("[workspace] set active workspace", { id });
    setActiveWorkspaceId(id);
    try {
      if (typeof window !== "undefined") {
        if (id) {
          window.localStorage.setItem(workspaceStorageKey(), id);
        } else {
          window.localStorage.removeItem(workspaceStorageKey());
        }
      }
    } catch {
      // ignore
    }
  }, []);

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
        const data = await apiClient.get<Workspace[]>("/workspaces");
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        setWorkspaces(data || []);
        setError(null);
        lastWorkspaceRefreshAtRef.current = Date.now();
      } catch (err) {
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load workspaces");
        if (!options?.silent) {
          setWorkspaces([]);
        }
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

  const refreshPendingInvites = useCallback(async (options?: RefreshOptions) => {
    if (!user) {
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
        const data = await apiClient.get<WorkspaceInvite[]>("/workspace-invites");
        setPendingInvites(sortWorkspaceInvites(data || []));
        lastPendingInvitesRefreshAtRef.current = Date.now();
      } catch (err) {
        console.error("Failed to load pending invites", err);
      } finally {
        if (!options?.silent) {
          setPendingInvitesLoading(false);
        }
        pendingInvitesInFlightRef.current = null;
      }
    })();

    pendingInvitesInFlightRef.current = request;
    return request;
  }, [user]);

  const refreshActiveWorkspaceData = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveMembers([]);
      setActiveInvites([]);
      return;
    }

    if (!activeWorkspace) {
      setActiveMembers([]);
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

    if (activeWorkspaceDataInFlightRef.current) {
      return activeWorkspaceDataInFlightRef.current;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setMembersLoading(true);
        }
        const members = await apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`);
        setActiveMembers(members || []);
      } catch (err) {
        console.error("Failed to load workspace members", err);
        if (!options?.silent) {
          setActiveMembers([]);
        }
      } finally {
        if (!options?.silent) {
          setMembersLoading(false);
        }
      }

      if (activeWorkspace.current_user_role !== "owner") {
        setActiveInvites([]);
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
        activeWorkspaceDataInFlightRef.current = null;
        return;
      }

      try {
        if (!options?.silent) {
          setInvitesLoading(true);
        }
        const invites = await apiClient.get<WorkspaceInvite[]>(`/workspaces/${activeWorkspaceId}/invites`);
        setActiveInvites((current) => reconcileWorkspaceInvites(current, invites || []));
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
      } catch (err) {
        console.error("Failed to load workspace invites", err);
      } finally {
        if (!options?.silent) {
          setInvitesLoading(false);
        }
        activeWorkspaceDataInFlightRef.current = null;
      }
    })();

    activeWorkspaceDataInFlightRef.current = request;
    return request;
  }, [activeWorkspace, activeWorkspaceId]);

  const createWorkspace = useCallback(async (payload: { name: string; description?: string }) => {
    const normalizedPayload = {
      ...payload,
      name: payload.name.trim(),
    };
    const inFlightKey = `${normalizedPayload.name.toLowerCase()}::${normalizedPayload.description ?? ""}`;
    const inFlight = createWorkspaceInFlightRef.current.get(inFlightKey);
    if (inFlight) {
      console.debug("[workspace] create deduped while request is in flight", { name: normalizedPayload.name });
      return inFlight;
    }

    console.debug("[workspace] explicit create requested", { name: normalizedPayload.name });
    const request = apiClient
      .post<Workspace>("/workspaces", normalizedPayload)
      .then((created) => {
        console.debug("[workspace] create success", { id: created.id, name: created.name });
        setWorkspaces((current) => [created, ...current.filter((workspace) => workspace.id !== created.id)]);
        return created;
      })
      .finally(() => {
        createWorkspaceInFlightRef.current.delete(inFlightKey);
      });

    createWorkspaceInFlightRef.current.set(inFlightKey, request);
    return request;
  }, []);

  const renameWorkspace = useCallback(async (workspaceId: string, payload: { name: string; description?: string | null }) => {
    const nextName = payload.name.trim();
    if (!nextName) {
      throw new Error("Workspace name cannot be empty.");
    }

    console.debug("[workspace] rename requested", { workspaceId, nextName });
    const previousWorkspaces = workspaces;
    setWorkspaces((current) =>
      current.map((workspace) =>
        workspace.id === workspaceId
          ? { ...workspace, name: nextName, description: payload.description ?? workspace.description }
          : workspace,
      ),
    );

    try {
      const updated = await apiClient.patch<Workspace>(`/workspaces/${workspaceId}`, {
        ...payload,
        name: nextName,
      });
      console.debug("[workspace] rename success", { workspaceId, name: updated.name });
      setWorkspaces((current) =>
        current.map((workspace) => (workspace.id === workspaceId ? updated : workspace)),
      );
      return updated;
    } catch (err) {
      console.debug("[workspace] rename failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      throw err;
    }
  }, [workspaces]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    console.debug("[workspace] delete requested", { workspaceId });
    const previousWorkspaces = workspaces;
    const remainingWorkspaces = workspaces.filter((workspace) => workspace.id !== workspaceId);

    setWorkspaces(remainingWorkspaces);
    if (activeWorkspaceId === workspaceId) {
      setActiveWorkspace(remainingWorkspaces[0]?.id ?? null);
      setActiveMembers([]);
      setActiveInvites([]);
    }

    try {
      await apiClient.delete(`/workspaces/${workspaceId}`);
      console.debug("[workspace] delete success", { workspaceId });
      await refreshWorkspaces({ force: true });
    } catch (err) {
      console.debug("[workspace] delete failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspace(workspaceId);
      }
      throw err;
    }
  }, [activeWorkspaceId, refreshWorkspaces, setActiveWorkspace, workspaces]);

  const inviteToActiveWorkspace = useCallback(
    async (target: string, role: "co_owner" | "member" = "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const invite = await apiClient.post<WorkspaceInvite>(`/workspaces/${activeWorkspaceId}/invites`, {
        email: target,
        role,
      });
      const nextInviteId = getWorkspaceInviteId(invite);
      setActiveInvites((current) =>
        sortWorkspaceInvites([
          invite,
          ...current.filter((item) => getWorkspaceInviteId(item) !== nextInviteId),
        ]),
      );
    },
    [activeWorkspaceId],
  );

  const removeWorkspaceMember = useCallback(
    async (userId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      await apiClient.delete(`/workspaces/${activeWorkspaceId}/members/${userId}`);
      setActiveMembers((current) => current.filter((member) => member.user_id !== userId));
      await refreshWorkspaces({ force: true });
    },
    [activeWorkspaceId, refreshWorkspaces],
  );

  const updateWorkspaceMemberRole = useCallback(
    async (userId: string, role: "co_owner" | "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const previousMembers = activeMembers;
      setActiveMembers((current) =>
        current.map((member) =>
          member.user_id === userId
            ? { ...member, role, updated_at: new Date().toISOString() }
            : member,
        ),
      );

      try {
        const updated = await apiClient.patch<WorkspaceMember>(
          `/workspaces/${activeWorkspaceId}/members/${userId}`,
          { role },
        );
        setActiveMembers((current) =>
          current.map((member) => (member.user_id === userId ? updated : member)),
        );
        await refreshWorkspaces({ force: true, silent: true });
        return updated;
      } catch (err) {
        setActiveMembers(previousMembers);
        throw err;
      }
    },
    [activeMembers, activeWorkspaceId, refreshWorkspaces],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      await apiClient.delete(`/workspaces/${activeWorkspaceId}/invites/${inviteId}`);
      setActiveInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
    },
    [activeWorkspaceId],
  );

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      const workspace = await apiClient.post<Workspace>(`/workspace-invites/${inviteId}/accept`);
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
      await apiClient.post(`/workspace-invites/${inviteId}/decline`);
      setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
    },
    [],
  );

  useEffect(() => {
    if (!user) {
      workspaceFetchIdRef.current += 1;
      createWorkspaceInFlightRef.current.clear();
      setWorkspaces([]);
      setActiveWorkspace(null);
      setActiveMembers([]);
      setActiveInvites([]);
      setPendingInvites([]);
      setLoading(false);
      return;
    }

    refreshWorkspaces({ force: true });
    refreshPendingInvites({ force: true });

    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(workspaceStorageKey()) : null;
      console.debug("[workspace] hydration read saved active workspace", { saved });
      if (saved) {
        setActiveWorkspaceId(saved);
      }
    } catch {
      // ignore
    }
  }, [refreshPendingInvites, refreshWorkspaces, setActiveWorkspace, user]);

  useEffect(() => {
    if (!user) {
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
  }, [refreshPendingInvites, user]);

  useEffect(() => {
    if (!user || loading) {
      return;
    }

    if (workspaces.length === 0) {
      console.debug("[workspace] no workspaces after verified fetch; waiting for explicit create");
      if (activeWorkspaceId) {
        setActiveWorkspace(null);
      }
      return;
    }

    const activeExists = activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId);
    if (!activeExists) {
      console.debug("[workspace] saved active workspace missing; selecting first available workspace", {
        activeWorkspaceId,
        nextWorkspaceId: workspaces[0].id,
      });
      setActiveWorkspace(workspaces[0].id);
    }
  }, [activeWorkspaceId, loading, setActiveWorkspace, user, workspaces]);

  useEffect(() => {
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
    activeWorkspaceDataInFlightRef.current = null;
    void refreshActiveWorkspaceData({ force: true });
  }, [refreshActiveWorkspaceData]);

  const value = useMemo(
    () => ({
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeMembers,
      activeInvites,
      pendingInvites,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshActiveWorkspaceData,
      refreshPendingInvites,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    }),
    [
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeMembers,
      activeInvites,
      pendingInvites,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshActiveWorkspaceData,
      refreshPendingInvites,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
