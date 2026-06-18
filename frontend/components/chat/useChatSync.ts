"use client";

import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { Message } from "@/components/chat/types";
import {
  type ChatRef,
  type SenderLookup,
  fetchConversationSnapshot,
  reconcileMessageLists,
} from "@/components/chat/useChatMessages";
import { logClientError } from "@/lib/errors";

const MESSAGE_VALIDATION_INTERVAL_MS = 45_000;
const MESSAGE_FOCUS_STALE_MS = 12_000;
const WORKSPACE_SYNC_INTERVAL_MS = 60_000;

type SyncOptions = {
  force?: boolean;
  silent?: boolean;
  allowInactiveConversation?: boolean;
};

type UseChatSyncParams = {
  authenticatedUserId: string | null;
  currentConversationRef: ChatRef<string | null>;
  lastMessageSyncRef: ChatRef<number>;
  mountedRef: ChatRef<boolean>;
  refreshActiveWorkspaceData: (options?: { force?: boolean; silent?: boolean }) => Promise<void>;
  respondingRef: ChatRef<boolean>;
  senderLookupRef: ChatRef<SenderLookup>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
};

export function useChatSync({
  authenticatedUserId,
  currentConversationRef,
  lastMessageSyncRef,
  mountedRef,
  refreshActiveWorkspaceData,
  respondingRef,
  senderLookupRef,
  setError,
  setMessages,
}: UseChatSyncParams) {
  const lastWorkspaceSyncRef = useRef(0);
  const messageSyncInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());

  const reconcileConversationMessages = useCallback(
    async (convId: string, options: SyncOptions = {}) => {
      const now = Date.now();
      if (options.silent && !options.force && now - lastMessageSyncRef.current < MESSAGE_FOCUS_STALE_MS) {
        return false;
      }

      const inFlight = messageSyncInFlightRef.current.get(convId);
      if (inFlight) return inFlight;

      const request = (async () => {
        try {
          const serverMessages = await fetchConversationSnapshot(convId, senderLookupRef.current);
          if (!mountedRef.current) return false;

          const activeConversationRef = currentConversationRef.current;
          if (!activeConversationRef) return Boolean(options.allowInactiveConversation);
          if (activeConversationRef !== convId) return Boolean(options.allowInactiveConversation);

          setMessages((current) => reconcileMessageLists(current, serverMessages));
          setError(null);
          lastMessageSyncRef.current = Date.now();
          return true;
        } catch (err) {
          if (!options.silent && mountedRef.current) {
            logClientError("Failed to sync conversation", err, { endpoint: `/conversations/${convId}/messages` });
            setError("Unable to sync conversation.");
          }
          return false;
        } finally {
          messageSyncInFlightRef.current.delete(convId);
        }
      })();

      messageSyncInFlightRef.current.set(convId, request);
      return request;
    },
    [currentConversationRef, lastMessageSyncRef, mountedRef, senderLookupRef, setError, setMessages],
  );

  useEffect(() => {
    if (!authenticatedUserId || typeof window === "undefined") return;

    const syncActiveConversation = (options?: { forceMessages?: boolean; forceWorkspace?: boolean }) => {
      if (document.visibilityState === "hidden") return;
      const convId = currentConversationRef.current;
      const now = Date.now();

      if (
        convId &&
        !respondingRef.current &&
        (options?.forceMessages || now - lastMessageSyncRef.current > MESSAGE_VALIDATION_INTERVAL_MS)
      ) {
        void reconcileConversationMessages(convId, { force: options?.forceMessages, silent: true });
      }

      if (options?.forceWorkspace || now - lastWorkspaceSyncRef.current > WORKSPACE_SYNC_INTERVAL_MS) {
        lastWorkspaceSyncRef.current = now;
        void refreshActiveWorkspaceData({ silent: true });
      }
    };

    const syncOnFocus = () => syncActiveConversation({ forceMessages: false, forceWorkspace: false });
    const syncOnVisibility = () => {
      if (document.visibilityState === "visible") {
        syncActiveConversation({ forceMessages: true, forceWorkspace: true });
      }
    };

    const intervalId = window.setInterval(syncActiveConversation, MESSAGE_VALIDATION_INTERVAL_MS);
    window.addEventListener("focus", syncOnFocus);
    document.addEventListener("visibilitychange", syncOnVisibility);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncOnFocus);
      document.removeEventListener("visibilitychange", syncOnVisibility);
    };
  }, [
    authenticatedUserId,
    currentConversationRef,
    lastMessageSyncRef,
    reconcileConversationMessages,
    refreshActiveWorkspaceData,
    respondingRef,
  ]);

  return { reconcileConversationMessages };
}
