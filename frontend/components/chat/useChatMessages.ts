"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fetchConversationSnapshot } from "@/components/chat/chatConversationSnapshot";
import type { Message, MessageAttachment } from "@/components/chat/types";
import {
  type SenderLookup,
  currentUserNameFromSession,
  formatChatTime,
} from "@/components/chat/chatMessageUtils";
import { ApiError } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export { currentUserNameFromSession, formatChatTime };
export { attachFilesToMessages, fetchConversationSnapshot } from "@/components/chat/chatConversationSnapshot";
export type { SenderLookup };

type RouterLike = {
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

export type RefreshConversations = (options?: { force?: boolean; silent?: boolean }) => Promise<void>;

export type ChatRef<T> = {
  current: T;
};

function mergeAttachments(current?: MessageAttachment[], incoming?: MessageAttachment[]) {
  const byId = new Map<string, MessageAttachment>();
  for (const file of current ?? []) byId.set(file.id, file);
  for (const file of incoming ?? []) byId.set(file.id, file);
  return [...byId.values()];
}

function isOptimisticDuplicate(localMessage: Message, serverMessages: Message[]) {
  if (localMessage.role !== "user" || (localMessage.status !== "sending" && localMessage.status !== "failed")) return false;
  const localContent = localMessage.content.trim();
  return Boolean(localContent) && serverMessages.some((message) => message.role === "user" && message.content.trim() === localContent && message.status === "sent");
}

export function reconcileMessageLists(currentMessages: Message[], serverMessages: Message[]) {
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const serverIds = new Set(serverMessages.map((message) => message.id));
  const reconciled = serverMessages.map((serverMessage) => {
    const current = currentById.get(serverMessage.id);
    if (!current) return serverMessage;
    const merged: Message = {
      ...serverMessage,
      attachments: mergeAttachments(current.attachments, serverMessage.attachments),
      sources: serverMessage.sources?.length ? serverMessage.sources : current.sources,
      retrieval: serverMessage.retrieval ?? current.retrieval,
    };
    if (
      current.status === "streaming" &&
      serverMessage.role === "assistant" &&
      serverMessage.status === "streaming" &&
      (!serverMessage.content || current.content.length > serverMessage.content.length)
    ) {
      return { ...merged, content: current.content, status: current.status, isStreaming: current.isStreaming, error: current.error };
    }
    return merged;
  });
  const localOnly = currentMessages.filter((message) => {
    if (serverIds.has(message.id) || isOptimisticDuplicate(message, serverMessages)) return false;
    return message.status === "sending" || message.status === "streaming" || message.status === "failed";
  });
  return [...reconciled, ...localOnly];
}

type UseChatMessagesParams = {
  activeWorkspaceId: string | null;
  conversationId: string | null;
  refreshConversations: RefreshConversations;
  router: RouterLike;
  senderLookup: SenderLookup;
  setActiveConversation: (conversationId: string | null) => void;
};

export function useChatMessages({
  activeWorkspaceId,
  conversationId,
  refreshConversations,
  router,
  senderLookup,
  setActiveConversation,
}: UseChatMessagesParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConversation, setCurrentConversation] = useState<string | null>(conversationId);
  const [currentConversationWorkspaceId, setCurrentConversationWorkspaceId] = useState<string | null>(activeWorkspaceId);
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const mountedRef = useRef(false);
  const currentConversationRef = useRef<string | null>(conversationId);
  const messagesRef = useRef<Message[]>([]);
  const loadRequestIdRef = useRef(0);
  const senderLookupRef = useRef(senderLookup);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
  const lastMessageSyncRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => void (currentConversationRef.current = currentConversation), [currentConversation]);
  useEffect(() => void (messagesRef.current = messages), [messages]);
  useEffect(() => void (senderLookupRef.current = senderLookup), [senderLookup]);
  useEffect(() => void (activeWorkspaceIdRef.current = activeWorkspaceId), [activeWorkspaceId]);

  const loadConversation = useCallback(async (convId: string) => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    try {
      setLoadingConversation(true);
      setError(null);
      const serverMessages = await fetchConversationSnapshot(convId, senderLookupRef.current);
      if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
      setMessages(serverMessages);
      lastMessageSyncRef.current = Date.now();
      currentConversationRef.current = convId;
      setCurrentConversation(convId);
      setCurrentConversationWorkspaceId(activeWorkspaceIdRef.current);
      setActiveConversation(convId);
    } catch (err) {
      if (!mountedRef.current || loadRequestIdRef.current !== requestId) return;
      logClientError("Failed to load conversation", err, { endpoint: `/conversations/${convId}/messages` });
      const rawMessage = err instanceof ApiError ? err.rawMessage ?? "" : "";
      const missingConversation = err instanceof ApiError && (err.status === 404 || /conversation not found/i.test(rawMessage));
      setError("Unable to load conversation. Check your connection and try again.");
      if (missingConversation) {
        setMessages([]);
        currentConversationRef.current = null;
        setCurrentConversation(null);
        setActiveConversation(null);
        await refreshConversations();
        router.replace("/chat", { scroll: false });
      }
    } finally {
      if (mountedRef.current && loadRequestIdRef.current === requestId) setLoadingConversation(false);
    }
  }, [refreshConversations, router, setActiveConversation]);

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
      return;
    }
    currentConversationRef.current = null;
    setCurrentConversation(null);
    loadRequestIdRef.current += 1;
    lastMessageSyncRef.current = 0;
    setCurrentConversationWorkspaceId(activeWorkspaceId);
    setActiveConversation(null);
    setMessages([]);
    setPendingAttachments([]);
    setError(null);
  }, [activeWorkspaceId, conversationId, loadConversation, setActiveConversation]);

  useEffect(() => {
    if (!currentConversation || currentConversationWorkspaceId === activeWorkspaceId) return;
    currentConversationRef.current = null;
    setCurrentConversation(null);
    setCurrentConversationWorkspaceId(activeWorkspaceId);
    lastMessageSyncRef.current = 0;
    setPendingAttachments([]);
    setMessages([]);
    setActiveConversation(null);
    router.replace("/chat", { scroll: false });
  }, [activeWorkspaceId, currentConversation, currentConversationWorkspaceId, router, setActiveConversation]);

  useEffect(() => {
    function handleConversationCleared(event: Event) {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (!detail?.conversationId || detail.conversationId !== currentConversation) return;
      setMessages([]);
      setPendingAttachments([]);
    }
    window.addEventListener("omnix:conversation-cleared", handleConversationCleared);
    return () => window.removeEventListener("omnix:conversation-cleared", handleConversationCleared);
  }, [currentConversation]);

  function handleUploadSuccess(file: MessageAttachment) {
    logger.debug("[upload] attaching uploaded file to pending chat message", { fileId: file.id, conversationId: currentConversation, workspaceId: activeWorkspaceId });
    setPendingAttachments((current) => (current.some((item) => item.id === file.id) ? current : [...current, file]));
  }

  function handleRemoveAttachment(fileId: string) {
    setPendingAttachments((current) => current.filter((file) => file.id !== fileId));
  }

  return {
    messages,
    setMessages: setMessages as Dispatch<SetStateAction<Message[]>>,
    loadingConversation,
    error,
    setError,
    currentConversation,
    setCurrentConversation,
    currentConversationRef,
    currentConversationWorkspaceId,
    setCurrentConversationWorkspaceId,
    pendingAttachments,
    setPendingAttachments,
    handleUploadSuccess,
    handleRemoveAttachment,
    mountedRef,
    messagesRef,
    senderLookupRef,
    activeWorkspaceIdRef,
    lastMessageSyncRef,
  };
}
