"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  createInitiative: (title: string, description?: string) => Promise<WorkspaceInitiative>;
};

const ContinuityContext = createContext<ContinuityContextType | undefined>(undefined);

export function WorkspaceContinuityProvider({ children }: { children: ReactNode }) {
  const { activeWorkspaceId } = useWorkspace();
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [timeline, setTimeline] = useState<WorkspaceOperationalTimelineEvent[]>([]);
  const [unresolvedContinuity, setUnresolvedContinuity] = useState<WorkspaceContinuityMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const requestGenerationRef = useRef(0);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);

  useEffect(() => {
    if (activeWorkspaceId !== activeWorkspaceIdRef.current) {
      requestGenerationRef.current += 1;
    }
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const refreshContinuity = useCallback(async () => {
    if (!activeWorkspaceId) return;
    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;
    
    setLoading(true);
    setError(null);
    try {
      const [initData, timelineData, unresolvedData] = await Promise.all([
        apiClient.get<WorkspaceInitiative[]>(`/workspaces/${requestWorkspaceId}/initiatives`),
        apiClient.get<WorkspaceOperationalTimelineEvent[]>(`/workspaces/${requestWorkspaceId}/timeline`),
        apiClient.get<WorkspaceContinuityMemory[]>(`/workspaces/${requestWorkspaceId}/continuity/unresolved`)
      ]);

      if (
        activeWorkspaceIdRef.current === requestWorkspaceId &&
        requestGenerationRef.current === generation
      ) {
        setInitiatives(initData);
        setTimeline(timelineData);
        setUnresolvedContinuity(unresolvedData);
      }
    } catch (err) {
      console.error("Failed to refresh operational continuity", err);
      if (
        activeWorkspaceIdRef.current === requestWorkspaceId &&
        requestGenerationRef.current === generation
      ) {
        setError(err instanceof Error ? err.message : "Unable to load continuity data.");
      }
    } finally {
      if (
        activeWorkspaceIdRef.current === requestWorkspaceId &&
        requestGenerationRef.current === generation
      ) {
        setLoading(false);
      }
    }
  }, [activeWorkspaceId]);

  const createInitiative = useCallback(async (title: string, description?: string) => {
    if (!activeWorkspaceId) throw new Error("No active workspace.");
    
    const initiative = await apiClient.post<WorkspaceInitiative>(`/workspaces/${activeWorkspaceId}/initiatives`, {
      title,
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
