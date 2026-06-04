"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useWorkspace } from "@/lib/workspace-context";
import type { WorkspaceMentionInboxItem } from "@/lib/workspace-types";

type WorkspaceNotificationsContextType = {
  mentions: WorkspaceMentionInboxItem[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  refreshNotifications: () => Promise<void>;
  markMentionRead: (mentionId: string) => Promise<void>;
  markAllMentionsRead: () => Promise<void>;
};

type MentionRealtimePayload = {
  new?: { workspace_id?: string | null; mentioned_user_id?: string | null };
  old?: { workspace_id?: string | null; mentioned_user_id?: string | null };
};

const WorkspaceNotificationsContext = createContext<WorkspaceNotificationsContextType | undefined>(undefined);

export function WorkspaceNotificationsProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const userId = session?.user.id ?? null;
  const [mentions, setMentions] = useState<WorkspaceMentionInboxItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refreshNotifications = useCallback(async () => {
    if (!activeWorkspaceId || !userId) {
      setMentions([]);
      setUnreadCount(0);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const [incoming, unread] = await Promise.all([
        apiClient.listWorkspaceMentions(activeWorkspaceId),
        apiClient.getWorkspaceMentionsUnreadCount(activeWorkspaceId),
      ]);
      if (requestId !== requestRef.current) return;
      setMentions(incoming);
      setUnreadCount(unread.unread_count);
      setError(null);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      logClientError("Failed to load workspace notifications", err, {
        endpoint: `/workspaces/${activeWorkspaceId}/mentions`,
      });
      setError("Unable to load notifications.");
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId, userId]);

  const refreshRef = useRef(refreshNotifications);

  useEffect(() => {
    refreshRef.current = refreshNotifications;
  }, [refreshNotifications]);

  useEffect(() => {
    setMentions([]);
    setUnreadCount(0);
    void refreshNotifications();
  }, [refreshNotifications]);

  useEffect(() => {
    if (!activeWorkspaceId || !userId) return;

    realtimeRegistry.subscribe(
      { type: "workspace_mentions", workspaceId: activeWorkspaceId },
      (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_mentions",
            filter: `workspace_id=eq.${activeWorkspaceId}`,
          },
          (payload: MentionRealtimePayload) => {
            const row = payload.new ?? payload.old;
            if (String(row?.mentioned_user_id ?? "") === userId) {
              void refreshRef.current();
            }
          },
        ),
    );

    return () => {
      realtimeRegistry.unsubscribe({ type: "workspace_mentions", workspaceId: activeWorkspaceId });
    };
  }, [activeWorkspaceId, userId]);

  const markMentionRead = useCallback(
    async (mentionId: string) => {
      if (!activeWorkspaceId) return;

      const existing = mentions.find((mention) => mention.id === mentionId);
      const wasUnread = Boolean(existing && !existing.read_at);
      const optimisticReadAt = new Date().toISOString();

      if (wasUnread) {
        setMentions((current) =>
          current.map((mention) =>
            mention.id === mentionId && !mention.read_at ? { ...mention, read_at: optimisticReadAt } : mention,
          ),
        );
        setUnreadCount((current) => Math.max(0, current - 1));
      }

      try {
        const updated = await apiClient.markWorkspaceMentionRead(activeWorkspaceId, mentionId);
        setMentions((current) =>
          current.map((mention) =>
            mention.id === updated.mention_id ? { ...mention, read_at: updated.read_at } : mention,
          ),
        );
        setError(null);
      } catch (err) {
        logClientError("Failed to mark mention read", err, {
          endpoint: `/workspaces/${activeWorkspaceId}/mentions/${mentionId}/read`,
        });
        setError("Unable to update notification read state.");
        void refreshNotifications();
        throw err;
      }
    },
    [activeWorkspaceId, mentions, refreshNotifications],
  );

  const markAllMentionsRead = useCallback(async () => {
    if (!activeWorkspaceId) return;

    try {
      const updated = await apiClient.markAllWorkspaceMentionsRead(activeWorkspaceId);
      setMentions((current) =>
        current.map((mention) => (mention.read_at ? mention : { ...mention, read_at: updated.read_at })),
      );
      setUnreadCount(0);
      setError(null);
    } catch (err) {
      logClientError("Failed to mark all mentions read", err, {
        endpoint: `/workspaces/${activeWorkspaceId}/mentions/read-all`,
      });
      setError("Unable to update notification read state.");
      void refreshNotifications();
      throw err;
    }
  }, [activeWorkspaceId, refreshNotifications]);

  const value = useMemo(
    () => ({
      mentions,
      unreadCount,
      loading,
      error,
      refreshNotifications,
      markMentionRead,
      markAllMentionsRead,
    }),
    [error, loading, markAllMentionsRead, markMentionRead, mentions, refreshNotifications, unreadCount],
  );

  return <WorkspaceNotificationsContext.Provider value={value}>{children}</WorkspaceNotificationsContext.Provider>;
}

export function useWorkspaceNotifications() {
  const context = useContext(WorkspaceNotificationsContext);
  if (!context) {
    throw new Error("useWorkspaceNotifications must be used within WorkspaceNotificationsProvider");
  }
  return context;
}
