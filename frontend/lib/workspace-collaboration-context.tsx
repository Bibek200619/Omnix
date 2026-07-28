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
import { usePathname, useRouter } from "next/navigation";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";
import { logger } from "./logger";
import { realtimeRegistry } from "./realtime-registry";
import { useWorkspaceIntelligence } from "./workspace-intelligence-context";
import { useWorkspaceMembership } from "./workspace-membership-context";
import { useWorkspaceTree } from "./workspace-tree-context";
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
  retryRealtimeConnection: () => Promise<void>;
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
  if (pathname.includes("/conversations")) return "conversations";
  if (pathname.includes("/decisions")) return "decisions";
  if (pathname.includes("/tasks")) return "tasks";
  if (pathname.includes("/initiatives")) return "initiatives";
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
  const router = useRouter();
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId, refreshWorkspaces, setActiveWorkspace } =
    useWorkspaceTree();
  const { refreshActiveWorkspaceData } = useWorkspaceMembership();
  const { refreshWorkspaceIntelligence } = useWorkspaceIntelligence();
  const [presence, setPresence] = useState<WorkspacePresenceSnapshot | null>(null);
  const [activity, setActivity] = useState<WorkspaceActivityEvent[]>([]);
  const [liveStatuses, setLiveStatuses] = useState<Record<string, WorkspaceLiveStatus>>({});
  const [typingUsers, setTypingUsers] = useState<Record<string, TypingSignal>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("connecting");
  const [loadingPresence] = useState(false);
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  
  const typingSentAtRef = useRef(0);
  const lastPresenceWorkspaceIdRef = useRef<string | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const userId = session?.user.id ?? null;
  const userEmail = session?.user.email ?? null;
  const userFullName =
    typeof session?.user.user_metadata?.full_name === "string"
      ? session.user.user_metadata.full_name
      : null;
  const userAvatarUrl =
    typeof session?.user.user_metadata?.avatar_url === "string"
      ? session.user.user_metadata.avatar_url
      : undefined;

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const refreshPresence = useCallback(async () => {
    if (!userId || !activeWorkspaceId) {
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
  }, [activeWorkspaceId, userId]);

  const heartbeatPresence = useCallback(async () => {
    if (!userId || !activeWorkspaceId) return null;

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
  }, [activeWorkspace?.name, activeWorkspaceId, pathname, userId]);

  const refreshActivity = useCallback(async () => {
    if (!userId || !activeWorkspaceId) {
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
  }, [activeWorkspaceId, userId]);

  const refreshLiveStatuses = useCallback(async () => {
    if (!userId) {
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
  }, [userId]);

  const leaveWorkspace = useCallback(async (wid?: string | null) => {
    const targetId = wid || activeWorkspaceId;
    if (!userId || !targetId) return;

    try {
      await apiClient.delete(`/workspaces/${targetId}/presence`);
      if (targetId === activeWorkspaceIdRef.current) {
        setPresence(null);
      }
    } catch (err) {
      console.warn("Unable to leave workspace presence", err);
    }
  }, [activeWorkspaceId, userId]);

  const handleAuthorityRevocation = useCallback((workspaceId: string, type: string) => {
     console.warn(`[authority] Revocation detected for workspace ${workspaceId}: ${type}`);
     const currentWorkspaceId = activeWorkspaceIdRef.current;
     const activeInheritsRevokedWorkspace =
       Boolean(activeWorkspace?.is_global && activeWorkspace.parent_workspace_id === workspaceId);
     
     // 1. Unsubscribe from all channels for this workspace
     realtimeRegistry.unsubscribe({ type: "presence", workspaceId });
     realtimeRegistry.unsubscribe({ type: "activity", workspaceId });

     void refreshWorkspaces({ force: true, silent: true });
     
     // 2. If it's the active workspace, we must evacuate
     if (workspaceId === currentWorkspaceId) {
        if (type === "membership_removed" || type === "workspace_deleted") {
           setPresence(null);
           setActivity([]);
           setTypingUsers({});
           setActiveWorkspace(null);
           router.replace("/dashboard");
        } else if (type === "role_changed") {
           void refreshActiveWorkspaceData({ force: true, silent: true });
           void refreshWorkspaceIntelligence({ force: true, silent: true });
        }
     } else if (activeInheritsRevokedWorkspace) {
       if (type === "membership_removed" || type === "workspace_deleted") {
         setPresence(null);
         setActivity([]);
         setTypingUsers({});
         setActiveWorkspace(null);
         router.replace("/dashboard");
       } else if (type === "role_changed") {
         void refreshActiveWorkspaceData({ force: true, silent: true });
         void refreshWorkspaceIntelligence({ force: true, silent: true });
       }
     }
  }, [
    activeWorkspace?.is_global,
    activeWorkspace?.parent_workspace_id,
    refreshActiveWorkspaceData,
    refreshWorkspaceIntelligence,
    refreshWorkspaces,
    router,
    setActiveWorkspace,
  ]);

  // Use refs for stable callback access in the subscription effect
  const refreshPresenceRef = useRef(refreshPresence);
  const refreshActivityRef = useRef(refreshActivity);
  const handleAuthorityRevocationRef = useRef(handleAuthorityRevocation);

  useEffect(() => {
    refreshPresenceRef.current = refreshPresence;
    refreshActivityRef.current = refreshActivity;
    handleAuthorityRevocationRef.current = handleAuthorityRevocation;
  }, [refreshPresence, refreshActivity, handleAuthorityRevocation]);

  const sendTypingSignal = useCallback(
    async (conversationId?: string | null, isTyping = true) => {
      if (!userId || !activeWorkspaceId) return;

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

      const payload: TypingSignal = {
        userId,
        fullName: userFullName || userEmail?.split("@")[0] || "Teammate",
        avatarUrl: userAvatarUrl,
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
    [activeWorkspaceId, userAvatarUrl, userEmail, userFullName, userId],
  );

  const retryRealtimeConnection = useCallback(async () => {
    if (!userId || !activeWorkspaceId) {
      setRealtimeStatus("disconnected");
      return;
    }

    setRealtimeStatus("connecting");
    setReconnectAttempt((attempt) => attempt + 1);

    await Promise.allSettled([
      heartbeatPresence(),
      refreshActivity(),
      refreshLiveStatuses(),
    ]);
  }, [activeWorkspaceId, heartbeatPresence, refreshActivity, refreshLiveStatuses, userId]);

  // Realtime Subscriptions
  useEffect(() => {
    if (!userId || !activeWorkspaceId) {
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
              logger.debug("[realtime] presence change detected, refreshing...");
              void refreshPresenceRef.current();
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
                [payload.userId]: payload,
              };
            });
          }),
      (status) => {
        if (status === "SUBSCRIBED") setRealtimeStatus("connected");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") setRealtimeStatus("error");
        if (status === "CLOSED") setRealtimeStatus("disconnected");
      },
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
              logger.debug("[realtime] activity insert detected", payload);
              void refreshActivityRef.current();
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
              filter: `user_id=eq.${userId}`,
            },
            (payload: { new: { workspace_id: string; revocation_type: string } }) => {
              console.warn("[realtime] authority revocation detected", payload);
              const { workspace_id, revocation_type } = payload.new;
              handleAuthorityRevocationRef.current(workspace_id, revocation_type);
            }
          )
    );

    return () => {
      realtimeRegistry.unsubscribe({ type: "presence", workspaceId: activeWorkspaceId });
      realtimeRegistry.unsubscribe({ type: "activity", workspaceId: activeWorkspaceId });
      realtimeRegistry.unsubscribe({ type: "revocation" });
    };
  }, [activeWorkspaceId, reconnectAttempt, userId]);

  // Periodic Refresh / Heartbeat
  useEffect(() => {
    const previousWorkspaceId = lastPresenceWorkspaceIdRef.current;
    if (previousWorkspaceId && previousWorkspaceId !== activeWorkspaceId) {
      void leaveWorkspace(previousWorkspaceId);
    }
    lastPresenceWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId, leaveWorkspace]);

  useEffect(() => {
    void heartbeatPresence();
    void refreshActivity();
    void refreshLiveStatuses();
  }, [refreshActivity, refreshLiveStatuses, heartbeatPresence]);

  useEffect(() => {
    return () => {
      const workspaceId = lastPresenceWorkspaceIdRef.current;
      if (workspaceId) {
        void leaveWorkspace(workspaceId);
      }
    };
  }, [leaveWorkspace]);

  useEffect(() => {
    if (!userId) return;

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

    const refreshVisibleWorkspaceState = () => {
      if (document.visibilityState !== "visible") {
        return;
      }
      void heartbeatPresence();
      void refreshActivity();
      void refreshLiveStatuses();
    };

    window.addEventListener("focus", refreshVisibleWorkspaceState);
    document.addEventListener("visibilitychange", refreshVisibleWorkspaceState);

    return () => {
      window.clearInterval(heartbeatId);
      window.clearInterval(statusId);
      window.removeEventListener("focus", refreshVisibleWorkspaceState);
      document.removeEventListener("visibilitychange", refreshVisibleWorkspaceState);
    };
  }, [refreshActivity, refreshLiveStatuses, heartbeatPresence, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const timeoutId = window.setInterval(() => {
       if (document.visibilityState !== "visible") {
          return;
       }
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
  }, [userId]);

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
      retryRealtimeConnection,
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
      retryRealtimeConnection,
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
