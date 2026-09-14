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
  applyWorkspaceIntelligenceProfile,
  fetchWorkspaceIntelligenceProfile,
  updateWorkspaceIntelligenceProfile,
} from "./workspace-intelligence";
import { patchWorkspaceInTree } from "./workspace-tree";
import type {
  Workspace,
  WorkspaceIntelligenceProfile,
  WorkspaceIntelligenceUpdatePayload,
} from "./workspace-types";

type UseWorkspaceIntelligenceStateParams = {
  activeWorkspaceId: string | null;
  activeWorkspaceIdRef: MutableRefObject<string | null>;
  requestGenerationRef: MutableRefObject<number>;
  setWorkspaces: Dispatch<SetStateAction<Workspace[]>>;
};

export function useWorkspaceIntelligenceState({
  activeWorkspaceId,
  activeWorkspaceIdRef,
  requestGenerationRef,
  setWorkspaces,
}: UseWorkspaceIntelligenceStateParams) {
  const [activeWorkspaceIntelligence, setActiveWorkspaceIntelligence] =
    useState<WorkspaceIntelligenceProfile | null>(null);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const workspaceIntelligenceInFlightRef = useRef<{
    workspaceId: string;
    generation: number;
    request: Promise<WorkspaceIntelligenceProfile | null>;
  } | null>(null);

  const clearWorkspaceIntelligenceRequest = useCallback(() => {
    workspaceIntelligenceInFlightRef.current = null;
  }, []);

  const resetWorkspaceIntelligenceState = useCallback(() => {
    workspaceIntelligenceInFlightRef.current = null;
    setActiveWorkspaceIntelligence(null);
    setIntelligenceError(null);
    setIntelligenceLoading(false);
  }, []);

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
        logClientError("Failed to load workspace intelligence", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/intelligence`,
        });
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
        if (
          workspaceIntelligenceInFlightRef.current?.workspaceId === requestWorkspaceId &&
          workspaceIntelligenceInFlightRef.current?.generation === generation
        ) {
          workspaceIntelligenceInFlightRef.current = null;
        }
      }
    })();

    workspaceIntelligenceInFlightRef.current = {
      workspaceId: requestWorkspaceId,
      generation,
      request,
    };
    return request;
  }, [activeWorkspaceId, activeWorkspaceIdRef, requestGenerationRef]);

  const updateWorkspaceIntelligence = useCallback(async (payload: WorkspaceIntelligenceUpdatePayload) => {
    if (!activeWorkspaceId) {
      throw new Error("Select a workspace first.");
    }
    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;
    const profile = await updateWorkspaceIntelligenceProfile(requestWorkspaceId, payload);
    if (
      activeWorkspaceIdRef.current !== requestWorkspaceId ||
      requestGenerationRef.current !== generation
    ) return profile;
    setActiveWorkspaceIntelligence(profile);
    setWorkspaces((current) =>
      patchWorkspaceInTree(current, requestWorkspaceId, (workspace) =>
        applyWorkspaceIntelligenceProfile(workspace, profile),
      ),
    );
    return profile;
  }, [activeWorkspaceId, activeWorkspaceIdRef, requestGenerationRef, setWorkspaces]);

  return {
    activeWorkspaceIntelligence,
    intelligenceError,
    intelligenceLoading,
    clearWorkspaceIntelligenceRequest,
    refreshWorkspaceIntelligence,
    resetWorkspaceIntelligenceState,
    updateWorkspaceIntelligence,
  };
}
