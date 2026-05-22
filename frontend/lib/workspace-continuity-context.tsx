"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiClient } from "./api";
import { useWorkspace } from "./workspace-context";
import type { 
  WorkspaceInitiative, 
  WorkspaceOperationalTimelineEvent,
  WorkspaceContinuityMemory
} from "./workspace-types";

type ContinuityContextType = {
  initiatives: WorkspaceInitiative[];
  timeline: WorkspaceOperationalTimelineEvent[];
  unresolvedContinuity: WorkspaceContinuityMemory[];
  loading: boolean;
  error: string | null;
  refreshContinuity: () => Promise<void>;
  createInitiative: (name: string, description?: string) => Promise<WorkspaceInitiative>;
};

const ContinuityContext = createContext<ContinuityContextType | undefined>(undefined);

export function WorkspaceContinuityProvider({ children }: { children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace();
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [timeline, setTimeline] = useState<WorkspaceOperationalTimelineEvent[]>([]);
  const [unresolvedContinuity, setUnresolvedContinuity] = useState<WorkspaceContinuityMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshContinuity = useCallback(async () => {
    if (!activeWorkspaceId) return;
    
    setLoading(true);
    setError(null);
    try {
      const [initData, timelineData, unresolvedData] = await Promise.all([
        apiClient.get<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        apiClient.get<WorkspaceOperationalTimelineEvent[]>(`/workspaces/${activeWorkspaceId}/timeline`),
        apiClient.get<WorkspaceContinuityMemory[]>(`/workspaces/${activeWorkspaceId}/continuity/unresolved`)
      ]);
      
      setInitiatives(initData);
      setTimeline(timelineData);
      setUnresolvedContinuity(unresolvedData);
    } catch (err) {
      console.error("Failed to refresh operational continuity", err);
      setError(err instanceof Error ? err.message : "Unable to load continuity data.");
    } finally {
      setLoading(false);
    }
  }, [activeWorkspaceId]);

  const createInitiative = useCallback(async (name: string, description?: string) => {
    if (!activeWorkspaceId) throw new Error("No active workspace.");
    
    const initiative = await apiClient.post<WorkspaceInitiative>(`/workspaces/${activeWorkspaceId}/initiatives`, {
      workspace_id: activeWorkspaceId,
      name,
      description
    });
    
    setInitiatives(prev => [initiative, ...prev]);
    void refreshContinuity(); // Refresh timeline as well
    return initiative;
  }, [activeWorkspaceId, refreshContinuity]);

  useEffect(() => {
    if (activeWorkspaceId) {
      void refreshContinuity();
    } else {
      setInitiatives([]);
      setTimeline([]);
      setUnresolvedContinuity([]);
    }
  }, [activeWorkspaceId, refreshContinuity]);

  const value = useMemo(() => ({
    initiatives,
    timeline,
    unresolvedContinuity,
    loading,
    error,
    refreshContinuity,
    createInitiative
  }), [initiatives, timeline, unresolvedContinuity, loading, error, refreshContinuity, createInitiative]);

  return (
    <ContinuityContext.Provider value={value}>
      {children}
    </ContinuityContext.Provider>
  );
}

export function useWorkspaceContinuity() {
  const context = useContext(ContinuityContext);
  if (context === undefined) {
    throw new Error("useWorkspaceContinuity must be used within a WorkspaceContinuityProvider");
  }
  return context;
}
