"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";
import type { Workspace, WorkspaceInvite, WorkspaceMember } from "./workspace-types";

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
  refreshWorkspaces: () => Promise<void>;
  refreshActiveWorkspaceData: () => Promise<void>;
  refreshPendingInvites: () => Promise<void>;
  createWorkspace: (payload: { name: string; description?: string }) => Promise<Workspace>;
  inviteToActiveWorkspace: (email: string) => Promise<void>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  acceptInvite: (inviteId: string) => Promise<Workspace>;
  declineInvite: (inviteId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function workspaceStorageKey() {
  return "omnix.activeWorkspaceId";
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
  const attemptedDefault = useRef(false);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || null,
    [activeWorkspaceId, workspaces],
  );

  const setActiveWorkspace = useCallback((id: string | null) => {
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

  const refreshWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<Workspace[]>("/workspaces");
      setWorkspaces(data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPendingInvites = useCallback(async () => {
    if (!user) {
      setPendingInvites([]);
      return;
    }

    try {
      setPendingInvitesLoading(true);
      const data = await apiClient.get<WorkspaceInvite[]>("/workspaces/invites/pending");
      setPendingInvites(data || []);
    } catch (err) {
      console.error("Failed to load pending invites", err);
      setPendingInvites([]);
    } finally {
      setPendingInvitesLoading(false);
    }
  }, [user]);

  const refreshActiveWorkspaceData = useCallback(async () => {
    if (!activeWorkspaceId || !activeWorkspace) {
      setActiveMembers([]);
      setActiveInvites([]);
      return;
    }

    try {
      setMembersLoading(true);
      const members = await apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`);
      setActiveMembers(members || []);
    } catch (err) {
      console.error("Failed to load workspace members", err);
      setActiveMembers([]);
    } finally {
      setMembersLoading(false);
    }

    if (activeWorkspace.current_user_role !== "owner") {
      setActiveInvites([]);
      return;
    }

    try {
      setInvitesLoading(true);
      const invites = await apiClient.get<WorkspaceInvite[]>(`/workspaces/${activeWorkspaceId}/invites`);
      setActiveInvites(invites || []);
    } catch (err) {
      console.error("Failed to load workspace invites", err);
      setActiveInvites([]);
    } finally {
      setInvitesLoading(false);
    }
  }, [activeWorkspace, activeWorkspaceId]);

  const createWorkspace = useCallback(async (payload: { name: string; description?: string }) => {
    const created = await apiClient.post<Workspace>("/workspaces", payload);
    setWorkspaces((current) => [created, ...current.filter((workspace) => workspace.id !== created.id)]);
    return created;
  }, []);

  const inviteToActiveWorkspace = useCallback(
    async (email: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const invite = await apiClient.post<WorkspaceInvite>(`/workspaces/${activeWorkspaceId}/invites`, {
        email,
      });
      setActiveInvites((current) => [invite, ...current.filter((item) => item.id !== invite.id)]);
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
      await refreshWorkspaces();
    },
    [activeWorkspaceId, refreshWorkspaces],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      await apiClient.delete(`/workspaces/${activeWorkspaceId}/invites/${inviteId}`);
      setActiveInvites((current) => current.filter((invite) => invite.id !== inviteId));
    },
    [activeWorkspaceId],
  );

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      const workspace = await apiClient.post<Workspace>(`/workspaces/invites/${inviteId}/accept`);
      setPendingInvites((current) => current.filter((invite) => invite.id !== inviteId));
      await refreshWorkspaces();
      setActiveWorkspace(workspace.id);
      return workspace;
    },
    [refreshWorkspaces, setActiveWorkspace],
  );

  const declineInvite = useCallback(
    async (inviteId: string) => {
      await apiClient.post(`/workspaces/invites/${inviteId}/decline`);
      setPendingInvites((current) => current.filter((invite) => invite.id !== inviteId));
    },
    [],
  );

  useEffect(() => {
    if (!user) {
      attemptedDefault.current = false;
      setWorkspaces([]);
      setActiveWorkspace(null);
      setActiveMembers([]);
      setActiveInvites([]);
      setPendingInvites([]);
      setLoading(false);
      return;
    }

    refreshWorkspaces();
    refreshPendingInvites();

    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(workspaceStorageKey()) : null;
      if (saved) {
        setActiveWorkspaceId(saved);
      }
    } catch {
      // ignore
    }
  }, [refreshPendingInvites, refreshWorkspaces, setActiveWorkspace, user]);

  useEffect(() => {
    if (!user || loading) {
      return;
    }

    if (attemptedDefault.current) {
      return;
    }

    if (workspaces.length === 0) {
      attemptedDefault.current = true;
      void (async () => {
        try {
          const created = await createWorkspace({ name: "My Workspace" });
          setActiveWorkspace(created.id);
        } catch (err) {
          console.error("Failed to create default workspace", err);
        }
      })();
      return;
    }

    const activeExists = activeWorkspaceId && workspaces.some((workspace) => workspace.id === activeWorkspaceId);
    if (!activeExists) {
      setActiveWorkspace(workspaces[0].id);
    }
  }, [activeWorkspaceId, createWorkspace, loading, setActiveWorkspace, user, workspaces]);

  useEffect(() => {
    void refreshActiveWorkspaceData();
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
      inviteToActiveWorkspace,
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
      inviteToActiveWorkspace,
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
