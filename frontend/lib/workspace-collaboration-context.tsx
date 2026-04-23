"use client";

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";
import { useWorkspace } from "./workspace-context";
import { realtimeRegistry } from "./realtime-registry";
import type {
  WorkspaceActivityEvent,
  WorkspaceLiveStatus,
  WorkspacePresenceSnapshot,
} from "./workspace-types";

type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

type CollaborationContextType = {
  presence: WorkspacePresenceSnapshot | null;
  activity: WorkspaceActivityEvent[];
  liveStatuses: Record<string, WorkspaceLiveStatus>;
  realtimeStatus: RealtimeStatus;
  loadingPresence: boolean;
  loadingActivity: boolean;
  refreshPresence: () => Promise<WorkspacePresenceSnapshot | null>;
  refreshActivity: () => Promise<WorkspaceActivityEvent[]>;
  refreshLiveStatuses: () => Promise<Record<string, WorkspaceLiveStatus>>;
  leaveWorkspace: (workspaceId?: string | null) => Promise<void>;
  sendTypingSignal: (conversationId?: string | null, isTyping?: boolean) => Promise<void>;
  statusForWorkspace: (workspaceId?: string | null) => WorkspaceLiveStatus | null;
};

const CollaborationContext = createContext<CollaborationContextType | undefined>(undefined);

const HEARTBEAT_INTERVAL_MS = 45_000; // Slower heartbeat since we have realtime updates
const STATUS_INTERVAL_MS = 60_000;
const TYPING_THROTTLE_MS = 2_500;

function currentViewFromPath(pathname: string | null) {
  if (!pathname) return "workspace";
  if (pathname.includes("/chat")) return "chat";
  if (pathname.includes("/workspace")) return "workspace";
  if (pathname.includes("/team")) return "team";
  if (pathname.includes("/sources")) return "sources";
  if (pathname.includes("/analytics")) return "analytics";
  if (pathname.includes("/settings")) return "settings";
  if (pathname.includes("/dashboard")) return "dashboard";
  return "workspace";
}

function normalizeStatuses(statuses: WorkspaceLiveStatus[]) {
  return statuses.reduce<Record<string, WorkspaceLiveStatus>>((acc, status) => {
    acc[status.workspace_id] = status;
    return acc;
  }, {});
}

export function WorkspaceCollaborationProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const [presence, setPresence] = useState<WorkspacePresenceSnapshot | null>(null);
  const [activity, setActivity] = useState<WorkspaceActivityEvent[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, WorkspaceLiveStatus>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [loadingPresence, setLoadingPresence] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const typingSentAtRef = useRef(0);
  const typingInFlightRef = useRef<Promise<void> | null>(null);

  const refreshPresence = useCallback(async () => {
    if (!session || !activeWorkspaceId) {
      setPresence(null);
      return null;
    }

    setLoadingPresence(true);
    try {
      const snapshot = await apiClient.post<WorkspacePresenceSnapshot>(
        `/workspaces/${activeWorkspaceId}/presence/heartbeat`,
        {
          current_view: currentViewFromPath(pathname),
          current_label: activeWorkspace?.name ?? null,
          metadata: { path: pathname },
        },
      );
      setPresence(snapshot);
      return snapshot;
    } catch (err) {
      console.warn("Unable to refresh workspace presence", err);
      return null;
    } finally {
      setLoadingPresence(false);
    }
  }, [activeWorkspace?.name, activeWorkspaceId, pathname, session]);

  const refreshActivity = useCallback(async () => {
    if (!session || !activeWorkspaceId) {
      setActivity([]);
      return [];
    }

    setLoadingActivity(true);
    try {
      const rows = await apiClient.get<WorkspaceActivityEvent[]>(
        `/workspaces/${activeWorkspaceId}/activity?limit=12`,
      );
      setActivity(rows);
      return rows;
    } catch (err) {
      console.warn("Unable to refresh workspace activity", err);
      setActivity([]);
      return [];
    } finally {
      setLoadingActivity(false);
    }
  }, [activeWorkspaceId, session]);

  const refreshLiveStatuses = useCallback(async () => {
    if (!session) {
      setLiveStatuses({});
      return {};
    }

    try {
      const rows = await apiClient.get<WorkspaceLiveStatus[]>("/workspaces/status");
      const normalized = normalizeStatuses(rows);
      setLiveStatuses(normalized);
      return normalized;
    } catch (err) {
      console.warn("Unable to refresh workspace live statuses", err);
      return {};
    }
  }, [session]);

  const leaveWorkspace = useCallback(async (wid?: string | null) => {
    const targetId = wid || activeWorkspaceId;
    if (!session || !targetId) return;

    try {
      await apiClient.delete(`/workspaces/${targetId}/presence`);
      if (targetId === activeWorkspaceId) {
        setPresence(null);
      }
    } catch (err) {
      console.warn("Unable to leave workspace presence", err);
    }
  }, [activeWorkspaceId, session]);

  const sendTypingSignal = useCallback(
    async (conversationId?: string | null, isTyping = true) => {
      if (!session || !activeWorkspaceId) return;

      const now = Date.now();
      if (isTyping && now - typingSentAtRef.current < TYPING_THROTTLE_MS) {
        return;
      }
      typingSentAtRef.current = now;

      const request = apiClient
        .post<WorkspacePresenceSnapshot>(`/workspaces/${activeWorkspaceId}/presence/typing`, {
          conversation_id: conversationId || null,
          is_typing: isTyping,
        })
        .then((snapshot) => {
          setPresence(snapshot);
        })
        .catch((err) => {
          console.warn("Unable to send typing signal", err);
        })
        .finally(() => {
          if (typingInFlightRef.current === request) {
            typingInFlightRef.current = null;
          }
        });

      typingInFlightRef.current = request;
      await request;
    },
    [activeWorkspaceId, session],
  );

  // Realtime Subscriptions
  useEffect(() => {
    if (!session || !activeWorkspaceId) {
      setRealtimeStatus("disconnected");
      return;
    }

    setRealtimeStatus("connecting");

    // Presence Subscription
    realtimeRegistry.subscribe(
      { type: "presence", workspaceId: activeWorkspaceId },
      (channel) =>
        channel
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "workspace_presence",
              filter: `workspace_id=eq.${activeWorkspaceId}`,
            },
            () => {
              console.debug("[realtime] presence change detected, refreshing...");
              void refreshPresence();
            }
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") setRealtimeStatus("connected");
            if (status === "CHANNEL_ERROR") setRealtimeStatus("error");
          })
    );

    // Activity Subscription
    realtimeRegistry.subscribe(
      { type: "activity", workspaceId: activeWorkspaceId },
      (channel) =>
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "workspace_activity_events",
              filter: `workspace_id=eq.${activeWorkspaceId}`,
            },
            (payload) => {
              console.debug("[realtime] activity insert detected", payload);
              void refreshActivity();
            }
          )
    );

    return () => {
      realtimeRegistry.unsubscribe({ type: "presence", workspaceId: activeWorkspaceId });
      realtimeRegistry.unsubscribe({ type: "activity", workspaceId: activeWorkspaceId });
    };
  }, [activeWorkspaceId, refreshActivity, refreshPresence, session]);

  // Periodic Refresh / Heartbeat
  useEffect(() => {
    void refreshPresence();
    void refreshActivity();
    void refreshLiveStatuses();

    return () => {
      if (activeWorkspaceId) {
        void leaveWorkspace(activeWorkspaceId);
      }
    };
  }, [activeWorkspaceId, leaveWorkspace, refreshActivity, refreshLiveStatuses, refreshPresence]);

  useEffect(() => {
    if (!session) return;

    const heartbeatId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshPresence();
      }
    }, HEARTBEAT_INTERVAL_MS);
    
    const statusId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshLiveStatuses();
      }
    }, STATUS_INTERVAL_MS);

    const handleFocus = () => {
      void refreshPresence();
      void refreshActivity();
      void refreshLiveStatuses();
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleFocus);

    return () => {
      window.clearInterval(heartbeatId);
      window.clearInterval(statusId);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleFocus);
    };
  }, [refreshActivity, refreshLiveStatuses, refreshPresence, session]);

  const value = useMemo<CollaborationContextType>(
    () => ({
      presence,
      activity,
      liveStatuses,
      realtimeStatus,
      loadingPresence,
      loadingActivity,
      refreshPresence,
      refreshActivity,
      refreshLiveStatuses,
      leaveWorkspace,
      sendTypingSignal,
      statusForWorkspace: (workspaceId?: string | null) =>
        workspaceId ? liveStatuses[workspaceId] ?? null : null,
    }),
    [
      activity,
      liveStatuses,
      realtimeStatus,
      loadingActivity,
      loadingPresence,
      presence,
      refreshActivity,
      refreshLiveStatuses,
      refreshPresence,
      leaveWorkspace,
      sendTypingSignal,
    ],
  );

  return (
    <CollaborationContext.Provider value={value}>
      {children}
    </CollaborationContext.Provider>
  );
}

export function useWorkspaceCollaboration() {
  const context = useContext(CollaborationContext);
  if (!context) {
    throw new Error("useWorkspaceCollaboration must be used within WorkspaceCollaborationProvider");
  }
  return context;
}

