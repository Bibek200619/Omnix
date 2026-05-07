"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";

// Minimal local types to avoid extra type file requirements
type WorkspaceRead = { id: string; user_id?: string; name: string; description?: string };

type WorkspaceContextType = {
  workspaces: WorkspaceRead[];
  loading: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  setActiveWorkspace: (id: string | null) => void;
  refreshWorkspaces: () => Promise<void>;
  createWorkspace: (payload: { name: string; description?: string }) => Promise<WorkspaceRead>;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const attemptedDefault = useRef(false);

  const refreshWorkspaces = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<WorkspaceRead[]>("/workspaces");
      setWorkspaces(data || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workspaces");
      setWorkspaces([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const createWorkspace = useCallback(async (payload: { name: string; description?: string }) => {
    const created = await apiClient.post<WorkspaceRead>("/workspaces", payload);
    setWorkspaces((current) => [created, ...current]);
    return created;
  }, []);

  const setActiveWorkspace = useCallback((id: string | null) => {
    setActiveWorkspaceId(id);
    try {
      if (typeof window !== "undefined") {
        if (id) window.localStorage.setItem("omnix.activeWorkspaceId", id);
        else window.localStorage.removeItem("omnix.activeWorkspaceId");
      }
    } catch {
      // ignore
    }
  }, []);

  // initial load
  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setActiveWorkspaceId(null);
      setLoading(false);
      return;
    }
    refreshWorkspaces();
    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("omnix.activeWorkspaceId") : null;
      if (saved) setActiveWorkspaceId(saved);
    } catch {
      // ignore
    }
  }, [user, refreshWorkspaces, setActiveWorkspace]);

  // If user has no workspaces, create a sensible default once
  useEffect(() => {
    if (!user) return;
    if (loading) return;
    if (attemptedDefault.current) return;

    if (workspaces.length === 0) {
      attemptedDefault.current = true;
      (async () => {
        try {
          const created = await createWorkspace({ name: "My Workspace" });
          setActiveWorkspace(created.id);
        } catch (err) {
          // fail silently — UI can show create button
          console.error("Failed to create default workspace:", err);
        }
      })();
    } else if (!activeWorkspaceId && workspaces.length > 0) {
      // pick first workspace as active if none set
      setActiveWorkspace(workspaces[0].id);
    }
  }, [user, workspaces, loading, activeWorkspaceId, createWorkspace, setActiveWorkspace]);

  const value = useMemo(() => ({ workspaces, loading, error, activeWorkspaceId, setActiveWorkspace, refreshWorkspaces, createWorkspace }), [workspaces, loading, error, activeWorkspaceId, setActiveWorkspace, refreshWorkspaces, createWorkspace]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
