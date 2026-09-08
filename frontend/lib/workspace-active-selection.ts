"use client";

import { useCallback, useRef, useState } from "react";
import { setApiWorkspaceId } from "./api";
import { logger } from "./logger";
import { invalidateQueries } from "./query";
import { persistActiveWorkspaceId } from "./workspace-active-storage";

type ReplaceOptions = {
  forceInvalidate?: boolean;
};

export type WorkspaceSelectionSnapshot = Readonly<{
  generation: number;
  workspaceId: string | null;
}>;

export type WorkspaceSelectionGuard = WorkspaceSelectionSnapshot & Readonly<{
  isCurrent: () => boolean;
}>;

export function workspaceSelectionIsCurrent(
  snapshot: WorkspaceSelectionSnapshot,
  workspaceId: string | null,
  generation: number,
) {
  return snapshot.workspaceId === workspaceId && snapshot.generation === generation;
}

function normalizeWorkspaceId(id: string | null): string | null {
  const normalized = id?.trim();
  return normalized || null;
}

export function useActiveWorkspaceSelection(userId: string | null) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(null);
  const requestGenerationRef = useRef(0);

  const replaceActiveWorkspace = useCallback((id: string | null, options?: ReplaceOptions) => {
    const normalizedId = normalizeWorkspaceId(id);
    const changed = normalizedId !== activeWorkspaceIdRef.current;
    if (changed || options?.forceInvalidate) {
      requestGenerationRef.current += 1;
      invalidateQueries();
    }

    activeWorkspaceIdRef.current = normalizedId;
    setActiveWorkspaceId(normalizedId);
    setApiWorkspaceId(normalizedId);
  }, []);

  const setActiveWorkspace = useCallback((id: string | null) => {
    logger.debug("[workspace] set active workspace", { id });
    const normalizedId = normalizeWorkspaceId(id);
    replaceActiveWorkspace(normalizedId);
    try {
      persistActiveWorkspaceId(userId, normalizedId);
    } catch {
      // ignore
    }
  }, [replaceActiveWorkspace, userId]);

  const captureActiveWorkspaceSelection = useCallback((): WorkspaceSelectionGuard => {
    const snapshot = {
      workspaceId: activeWorkspaceIdRef.current,
      generation: requestGenerationRef.current,
    };
    return {
      ...snapshot,
      isCurrent: () => workspaceSelectionIsCurrent(
        snapshot,
        activeWorkspaceIdRef.current,
        requestGenerationRef.current,
      ),
    };
  }, []);

  return {
    activeWorkspaceId,
    activeWorkspaceIdRef,
    captureActiveWorkspaceSelection,
    requestGenerationRef,
    replaceActiveWorkspace,
    setActiveWorkspace,
  };
}
