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
  TypingSignal,
  WorkspaceActivityEvent,
  WorkspaceLiveStatus,
  WorkspacePresenceSnapshot,
} from "./workspace-types";

type RealtimeStatus = "connecting" | "connected" | "disconnected" | "error";

type CollaborationContextType = {
  presence: WorkspacePresenceSnapshot | null;
  activity: WorkspaceActivityEvent[];
  liveStatuses: Record<string, WorkspaceLiveStatus>;
  typingUsers: Record<string, TypingSignal>;
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

const HEARTBEAT_INTERVAL_MS = 60_000; // Calmer heartbeat
const STATUS_INTERVAL_MS = 90_000;    // Less frequent status polling
const TYPING_THROTTLE_MS = 3_000;
const TYPING_TIMEOUT_MS = 8_000;

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
  const [typingUsers, setTypingUsers] = useState<Record<string, TypingSignal>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [loadingPresence] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const typingSentAtRef = useRef(0);

  const refreshPresence = useCallback(async () => {
    if (!session || !activeWorkspaceId) {
      setPresence(null);
      return null;
    }

    try {
      const snapshot = await apiClient.get<WorkspacePresenceSnapshot>(
        `/workspaces/${activeWorkspaceId}/presence`
      );
      setPresence(snapshot);
      return snapshot;
    } catch (err) {
      console.warn("Unable to refresh workspace presence snapshot", err);
      return null;
    }
  }, [activeWorkspaceId, session]);

  const heartbeatPresence = useCallback(async () => {
    if (!session || !activeWorkspaceId) return null;

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
      console.warn("Unable to send workspace heartbeat", err);
      return null;
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

  const handleAuthorityRevocation = useCallback((workspaceId: string, type: string) => {
     console.warn(`[authority] Revocation detected for workspace ${workspaceId}: ${type}`);
     
     // 1. Unsubscribe from all channels for this workspace
     realtimeRegistry.unsubscribe({ type: "presence", workspaceId });
     realtimeRegistry.unsubscribe({ type: "activity", workspaceId });
     
     // 2. If it's the active workspace, we must evacuate
     if (workspaceId === activeWorkspaceId) {
        if (type === "membership_removed" || type === "workspace_deleted") {
           window.location.href = "/dashboard";
        } else if (type === "role_changed") {
           // Force reload or refresh to pick up new permissions
           window.location.reload();
        }
     }
  }, [activeWorkspaceId]);

  const sendTypingSignal = useCallback(
    async (conversationId?: string | null, isTyping = true) => {
      if (!session || !activeWorkspaceId) return;

      const now = Date.now();
      if (isTyping && now - typingSentAtRef.current < TYPING_THROTTLE_MS) {
        return;
      }
      typingSentAtRef.current = now;

      const channel = realtimeRegistry.getSubscription({ 
        type: "presence", 
        workspaceId: activeWorkspaceId 
      });

      if (!channel) return;

      const user = session.user;
      const payload: TypingSignal = {
        userId: user.id,
        fullName: user.user_metadata?.full_name || user.email?.split("@")[0] || "Teammate",
        avatarUrl: user.user_metadata?.avatar_url,
        conversationId: conversationId || null,
        isTyping,
        sentAt: new Date().toISOString(),
      };

      try {
        await channel.send({
          type: "broadcast",
          event: "typing",
          payload,
        });
      } catch (err) {
        console.warn("Unable to broadcast typing signal", err);
      }
    },
    [activeWorkspaceId, session],
  );

  // Realtime Subscriptions
  useEffect(() => {
    if (!session || !activeWorkspaceId) {
      setRealtimeStatus("disconnected");
      setTypingUsers({});
      return;
    }

    setRealtimeStatus("connecting");
    setTypingUsers({});

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
          .on("broadcast", { event: "typing" }, ({ payload }: { payload: TypingSignal }) => {
             setTypingUsers(current => {
                if (!payload.isTyping) {
                   const next = { ...current };
                   delete next[payload.userId];
                   return next;
                }
                return {
                   ...current,
                   [payload.userId]: payload
                };
             });
          })
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

    // Authority Revocation Subscription (User-scoped)
    realtimeRegistry.subscribe(
      { type: "revocation" },
      (channel) =>
        channel
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "authority_revocations",
              filter: `user_id=eq.${session.user.id}`,
            },
            (payload: { new: { workspace_id: string; revocation_type: string } }) => {
              console.warn("[realtime] authority revocation detected", payload);
              const { workspace_id, revocation_type } = payload.new;
              handleAuthorityRevocation(workspace_id, revocation_type);
            }
          )
    );

    return () => {
      realtimeRegistry.unsubscribe({ type: "presence", workspaceId: activeWorkspaceId });
      realtimeRegistry.unsubscribe({ type: "activity", workspaceId: activeWorkspaceId });
      realtimeRegistry.unsubscribe({ type: "revocation" });
    };
  }, [activeWorkspaceId, handleAuthorityRevocation, refreshActivity, refreshPresence, session]);

  // Periodic Refresh / Heartbeat
  useEffect(() => {
    void heartbeatPresence();
    void refreshActivity();
    void refreshLiveStatuses();

    return () => {
      if (activeWorkspaceId) {
        void leaveWorkspace(activeWorkspaceId);
      }
    };
  }, [activeWorkspaceId, leaveWorkspace, refreshActivity, refreshLiveStatuses, heartbeatPresence]);

  useEffect(() => {
    if (!session) return;

    const heartbeatId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void heartbeatPresence();
      }
    }, HEARTBEAT_INTERVAL_MS);
    
    const statusId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshLiveStatuses();
      }
    }, STATUS_INTERVAL_MS);

    const handleFocus = () => {
      void heartbeatPresence();
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
  }, [refreshActivity, refreshLiveStatuses, heartbeatPresence, session]);

  useEffect(() => {
    const timeoutId = window.setInterval(() => {
       setTypingUsers(current => {
          const now = Date.now();
          let changed = false;
          const next = { ...current };
          
          for (const [uid, signal] of Object.entries(current)) {
             if (now - new Date(signal.sentAt).getTime() > TYPING_TIMEOUT_MS) {
                delete next[uid];
                changed = true;
             }
          }
          
          return changed ? next : current;
       });
    }, 2000);

    return () => window.clearInterval(timeoutId);
  }, []);

  const value = useMemo<CollaborationContextType>(
    () => ({
      presence,
      activity,
      liveStatuses,
      typingUsers,
      realtimeStatus,
      loadingPresence,
      loadingActivity,
      refreshPresence: heartbeatPresence,
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
      typingUsers,
      realtimeStatus,
      loadingActivity,
      loadingPresence,
      presence,
      refreshActivity,
      refreshLiveStatuses,
      heartbeatPresence,
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
