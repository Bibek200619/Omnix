"use client";

import { useEffect } from "react";
import { logger } from "./logger";
import type { RefreshOptions } from "./workspace-context-types";
import type { Workspace } from "./workspace-types";
import { flattenWorkspaces } from "./workspace-utils";
import { findWorkspaceById } from "./workspace-tree";

export function usePendingWorkspaceInvitePolling({
  userId,
  intervalMs,
  refreshPendingInvites,
}: {
  userId: string | null;
  intervalMs: number;
  refreshPendingInvites: (options?: RefreshOptions) => Promise<void>;
}) {
  useEffect(() => {
    if (!userId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshPendingInvites({ silent: true });
      }
    }, intervalMs);

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
  }, [intervalMs, refreshPendingInvites, userId]);
}

export function useActiveWorkspaceReconciliation({
  activeWorkspaceId,
  error,
  loading,
  setActiveWorkspace,
  userId,
  workspaces,
}: {
  activeWorkspaceId: string | null;
  error: string | null;
  loading: boolean;
  setActiveWorkspace: (id: string | null) => void;
  userId: string | null;
  workspaces: Workspace[];
}) {
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
}
