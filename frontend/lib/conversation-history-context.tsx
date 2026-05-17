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
import type { ConversationSummary } from "@/components/chat/types";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";

type ConversationHistoryContextType = {
  conversations: ConversationSummary[];
  loading: boolean;
  error: string | null;
  activeConversationId: string | null;
  refreshConversations: (options?: { silent?: boolean }) => Promise<void>;
  setActiveConversation: (conversationId: string | null) => void;
  upsertConversation: (conversation: ConversationSummary) => void;
  renameConversation: (conversationId: string, title: string) => Promise<void>;
  archiveConversation: (conversationId: string) => Promise<void>;
};

const ConversationHistoryContext =
  createContext<ConversationHistoryContextType | undefined>(undefined);

function sortConversations(items: ConversationSummary[]) {
  return [...items].sort((a, b) => {
    const aTime = a.latest_message_at ?? a.last_message_at ?? a.updated_at ?? a.created_at ?? "";
    const bTime = b.latest_message_at ?? b.last_message_at ?? b.updated_at ?? b.created_at ?? "";
    const aMs = new Date(aTime).getTime();
    const bMs = new Date(bTime).getTime();
    return (Number.isNaN(bMs) ? 0 : bMs) - (Number.isNaN(aMs) ? 0 : aMs);
  });
}

function conversationStorageKey(workspaceId: string | null) {
  return `omnix.activeConversationId.${workspaceId ?? "none"}`;
}

export function ConversationHistoryProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { user } = useAuth();
  const { activeWorkspaceId } = useWorkspace();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(
    null,
  );
  const refreshInFlightRef = useRef(false);

  const setActiveConversation = useCallback((conversationId: string | null) => {
    setActiveConversationId(conversationId);

    if (typeof window === "undefined") {
      return;
    }

    const key = conversationStorageKey(activeWorkspaceId);
    if (conversationId) {
      window.localStorage.setItem(key, conversationId);
      return;
    }

    window.localStorage.removeItem(key);
  }, [activeWorkspaceId]);

  const refreshConversations = useCallback(async (options?: { silent?: boolean }) => {
    if (refreshInFlightRef.current) {
      return;
    }

    refreshInFlightRef.current = true;
    try {
      if (!options?.silent) {
        setLoading(true);
      }
      const data = await apiClient.get<ConversationSummary[]>("/conversations");
      setConversations(sortConversations(data));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversations");
      if (!options?.silent) {
        setConversations([]);
      }
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
      refreshInFlightRef.current = false;
    }
  }, []);

  const upsertConversation = useCallback((conversation: ConversationSummary) => {
    setConversations((current) => {
      const next = current.filter((item) => item.id !== conversation.id);
      return sortConversations([conversation, ...next]);
    });
  }, []);

  const mergeConversation = useCallback((conversation: ConversationSummary) => {
    setConversations((current) =>
      sortConversations(
        current.map((item) =>
          item.id === conversation.id ? { ...item, ...conversation } : item,
        ),
      ),
    );
  }, []);

  const renameConversation = useCallback(
    async (conversationId: string, title: string) => {
      const normalizedTitle = title.trim();
      if (!normalizedTitle) {
        throw new Error("Conversation title cannot be empty.");
      }

      const updated = await apiClient.patch<ConversationSummary>(
        `/conversations/${conversationId}`,
        { title: normalizedTitle },
      );
      mergeConversation(updated);
    },
    [mergeConversation],
  );

  const archiveConversation = useCallback(
    async (conversationId: string) => {
      await apiClient.patch<ConversationSummary>(
        `/conversations/${conversationId}`,
        { is_archived: true },
      );
      setConversations((current) =>
        current.filter((item) => item.id !== conversationId),
      );

      if (activeConversationId === conversationId) {
        setActiveConversation(null);
      }
    },
    [activeConversationId, setActiveConversation],
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    setActiveConversationId(
      window.localStorage.getItem(conversationStorageKey(activeWorkspaceId)),
    );
  }, [activeWorkspaceId]);

  useEffect(() => {
    if (!user) {
      setConversations([]);
      setLoading(false);
      setError(null);
      setActiveConversation(null);
      return;
    }

    refreshConversations();
  }, [activeWorkspaceId, refreshConversations, setActiveConversation, user]);

  useEffect(() => {
    if (!user || typeof window === "undefined") {
      return;
    }

    const refreshSilently = () => {
      if (document.visibilityState === "hidden") {
        return;
      }
      void refreshConversations({ silent: true });
    };

    const intervalId = window.setInterval(refreshSilently, 10_000);
    window.addEventListener("focus", refreshSilently);
    document.addEventListener("visibilitychange", refreshSilently);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refreshSilently);
      document.removeEventListener("visibilitychange", refreshSilently);
    };
  }, [refreshConversations, user]);

  useEffect(() => {
    if (!activeConversationId) {
      return;
    }

    if (!conversations.some((conversation) => conversation.id === activeConversationId)) {
      setActiveConversation(null);
    }
  }, [activeConversationId, conversations, setActiveConversation]);

  const value = useMemo(
    () => ({
      conversations,
      loading,
      error,
      activeConversationId,
      archiveConversation,
      refreshConversations,
      renameConversation,
      setActiveConversation,
      upsertConversation,
    }),
    [
      activeConversationId,
      archiveConversation,
      conversations,
      error,
      loading,
      refreshConversations,
      renameConversation,
      setActiveConversation,
      upsertConversation,
    ],
  );

  return (
    <ConversationHistoryContext.Provider value={value}>
      {children}
    </ConversationHistoryContext.Provider>
  );
}

export function useConversationHistory() {
  const context = useContext(ConversationHistoryContext);
  if (!context) {
    throw new Error(
      "useConversationHistory must be used within ConversationHistoryProvider",
    );
  }
  return context;
}
