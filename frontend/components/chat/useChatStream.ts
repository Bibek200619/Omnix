"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createOptimisticUserMessage, mergeStreamInitMessages } from "@/components/chat/chatStreamMessages";
import { readChatStream, type StreamEvent } from "@/components/chat/chatStreamProtocol";
import type { Message, MessageAttachment, SearchMode } from "@/components/chat/types";
import { normalizeRetrievalState } from "@/components/chat/chatMessageUtils";
import { type ChatRef, type RefreshConversations, type SenderLookup } from "@/components/chat/useChatMessages";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";

type RouterLike = {
  replace: (href: string, options?: { scroll?: boolean }) => void;
};

type ReconcileConversationMessages = (
  convId: string,
  options?: { force?: boolean; silent?: boolean; allowInactiveConversation?: boolean },
) => Promise<boolean>;

type UseChatStreamParams = {
  activeWorkspaceId: string | null;
  activeWorkspaceRole?: Message["senderRole"];
  conversationId: string | null;
  currentConversation: string | null;
  currentConversationRef: ChatRef<string | null>;
  messagesRef: ChatRef<Message[]>;
  mountedRef: ChatRef<boolean>;
  pendingAttachments: MessageAttachment[];
  reconcileConversationMessages: ReconcileConversationMessages;
  refreshConversations: RefreshConversations;
  respondingRef: ChatRef<boolean>;
  router: RouterLike;
  searchMode: SearchMode;
  senderLookup: SenderLookup;
  setActiveConversation: (conversationId: string | null) => void;
  setCurrentConversation: Dispatch<SetStateAction<string | null>>;
  setCurrentConversationWorkspaceId: Dispatch<SetStateAction<string | null>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setPendingAttachments: Dispatch<SetStateAction<MessageAttachment[]>>;
  userEmail?: string | null;
  userId?: string | null;
};

export function useChatStream({
  activeWorkspaceId,
  activeWorkspaceRole,
  conversationId,
  currentConversation,
  currentConversationRef,
  messagesRef,
  mountedRef,
  pendingAttachments,
  reconcileConversationMessages,
  refreshConversations,
  respondingRef,
  router,
  searchMode,
  senderLookup,
  setActiveConversation,
  setCurrentConversation,
  setCurrentConversationWorkspaceId,
  setError,
  setMessages,
  setPendingAttachments,
  userEmail,
  userId,
}: UseChatStreamParams) {
  const [responding, setResponding] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const streamAnnouncerClearTimerRef = useRef<number | null>(null);

  const clearStreamAnnouncerTimer = useCallback(() => {
    if (streamAnnouncerClearTimerRef.current !== null) {
      window.clearTimeout(streamAnnouncerClearTimerRef.current);
      streamAnnouncerClearTimerRef.current = null;
    }
  }, []);

  const scheduleStreamAnnouncerClear = useCallback(() => {
    clearStreamAnnouncerTimer();
    streamAnnouncerClearTimerRef.current = window.setTimeout(() => {
      setStreamingContent("");
      streamAnnouncerClearTimerRef.current = null;
    }, 2000);
  }, [clearStreamAnnouncerTimer]);

  useEffect(() => void (respondingRef.current = responding), [responding, respondingRef]);
  useEffect(() => {
    return () => {
      clearStreamAnnouncerTimer();
      activeStreamAbortRef.current?.abort();
    };
  }, [clearStreamAnnouncerTimer]);

  const sendMessage = useCallback(async (content: string, retryMessageId?: string, attachmentsOverride?: MessageAttachment[]) => {
    if (respondingRef.current) return;

    const messageId = retryMessageId ?? crypto.randomUUID();
    const attachments = attachmentsOverride ?? pendingAttachments;
    const attachmentIds = attachments.map((file) => file.id).filter(Boolean);
    const userMessage = createOptimisticUserMessage({
      activeWorkspaceRole,
      attachments,
      content,
      messageId,
      senderLookup,
      userEmail,
      userId,
    });

    setMessages((current) => {
      if (retryMessageId) {
        return current.map((message) =>
          message.id === retryMessageId ? { ...message, status: "sending", error: undefined } : message,
        );
      }
      return [...current, userMessage];
    });
    if (!retryMessageId) setPendingAttachments([]);

    respondingRef.current = true;
    setResponding(true);
    setError(null);
    let assistantId: string | null = null;
    let persistedUserMessageId: string | null = null;
    let streamConversationId: string | null = currentConversation;
    const streamAbortController = new AbortController();
    activeStreamAbortRef.current = streamAbortController;
    clearStreamAnnouncerTimer();
    setStreamingContent("");
    let pendingTokenText = "";
    let tokenFlushFrame: number | null = null;

    const applyPendingTokens = () => {
      if (!assistantId || !pendingTokenText) return;
      const nextText = pendingTokenText;
      pendingTokenText = "";
      setMessages((current) =>
        current.map((message) => (message.id === assistantId ? { ...message, content: (message.content || "") + nextText } : message)),
      );
    };
    const flushPendingTokens = () => {
      if (tokenFlushFrame !== null) {
        window.cancelAnimationFrame(tokenFlushFrame);
        tokenFlushFrame = null;
      }
      applyPendingTokens();
    };
    const scheduleTokenFlush = () => {
      if (tokenFlushFrame !== null) return;
      tokenFlushFrame = window.requestAnimationFrame(() => {
        tokenFlushFrame = null;
        applyPendingTokens();
      });
    };

    try {
      const resp = await apiClient.stream("/chat/stream", {
        method: "POST",
        signal: streamAbortController.signal,
        body: JSON.stringify({
          message: content,
          conversation_id: currentConversation || undefined,
          attachment_ids: attachmentIds,
          search_mode: searchMode,
        }),
      });
      const reader = resp.body?.getReader();
      if (!reader) throw new Error("Streaming not supported by this browser.");

      const handleStreamEvent = (obj: StreamEvent) => {
        const retrieval = normalizeRetrievalState(obj.retrieval);
        if (obj.type === "init") {
          if (obj.conversation_id) {
            streamConversationId = obj.conversation_id;
            currentConversationRef.current = obj.conversation_id;
            setCurrentConversation(obj.conversation_id);
            setCurrentConversationWorkspaceId(activeWorkspaceId);
            setActiveConversation(obj.conversation_id);
          }
          persistedUserMessageId = obj.user_message_id ?? null;
          assistantId = obj.assistant_message_id ?? crypto.randomUUID();
          setMessages((current) =>
            mergeStreamInitMessages(current, messageId, persistedUserMessageId, assistantId as string, obj.sources, retrieval),
          );
          return;
        }
        if (obj.type === "status") {
          if (!assistantId || !retrieval) return;
          setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, retrieval } : message)));
          return;
        }
        if (obj.type === "sources") {
          if (!assistantId) return;
          setMessages((current) => current.map((message) => (
            message.id === assistantId ? { ...message, sources: obj.sources ?? [], retrieval: retrieval ?? message.retrieval } : message
          )));
          return;
        }
        if (obj.type === "token") {
          if (!assistantId) return;
          const txt = obj.text ?? "";
          if (!txt) return;
          setStreamingContent((current) => current + txt);
          pendingTokenText += txt;
          scheduleTokenFlush();
          return;
        }
        if (obj.type === "error") {
          flushPendingTokens();
          logClientError("[chat] stream returned an error event", new Error(String(obj.detail ?? "Stream error")), { responsePayload: obj });
          const detail = "AI response is unavailable.";
          if (assistantId) {
            setMessages((current) =>
              current.map((message) => (message.id === assistantId ? { ...message, status: "failed", isStreaming: false, error: detail } : message)),
            );
          }
          return;
        }
        if (obj.type === "done") {
          flushPendingTokens();
          streamConversationId = obj.conversation_id ?? streamConversationId;
          if (assistantId) {
            setMessages((current) => current.map((message) => (message.id === assistantId ? { ...message, status: "sent", isStreaming: false } : message)));
          }
          if (!conversationId && obj.conversation_id) router.replace(`/chat?conversation=${obj.conversation_id}`, { scroll: false });
          scheduleStreamAnnouncerClear();
        }
      };

      await readChatStream(reader, handleStreamEvent, streamAbortController);
      flushPendingTokens();

      await refreshConversations({ force: true, silent: true });
    } catch (err) {
      if (mountedRef.current) flushPendingTokens();
      if (streamAbortController.signal.aborted && !mountedRef.current) return;
      logClientError("Failed to send message", err, { endpoint: "/chat/stream" });
      const targetConversationId = streamConversationId || currentConversationRef.current;
      const recovered = targetConversationId
        ? await reconcileConversationMessages(targetConversationId, { allowInactiveConversation: true, force: true, silent: true })
        : false;
      if (!recovered) {
        setError("Unable to send message. Check your connection and try again.");
        setMessages((current) =>
          current.map((item) => (item.id === (persistedUserMessageId ?? messageId) ? { ...item, status: "failed", error: "Not sent" } : item)),
        );
      }
      await refreshConversations({ force: true, silent: true });
    } finally {
      if (tokenFlushFrame !== null) window.cancelAnimationFrame(tokenFlushFrame);
      respondingRef.current = false;
      if (mountedRef.current) setResponding(false);
      if (activeStreamAbortRef.current === streamAbortController) activeStreamAbortRef.current = null;
    }
  }, [
    activeWorkspaceId,
    activeWorkspaceRole,
    clearStreamAnnouncerTimer,
    conversationId,
    currentConversation,
    currentConversationRef,
    mountedRef,
    pendingAttachments,
    reconcileConversationMessages,
    refreshConversations,
    respondingRef,
    router,
    scheduleStreamAnnouncerClear,
    searchMode,
    senderLookup,
    setActiveConversation,
    setCurrentConversation,
    setCurrentConversationWorkspaceId,
    setError,
    setMessages,
    setPendingAttachments,
    userEmail,
    userId,
  ]);

  const handleRetry = useCallback((message: Message) => {
    void sendMessage(message.content, message.id, message.attachments ?? []);
  }, [sendMessage]);

  const handleRegenerate = useCallback((assistantMessageId: string) => {
    const idx = messagesRef.current.findIndex((message) => message.id === assistantMessageId);
    if (idx <= 0) return;
    const previous = messagesRef.current[idx - 1];
    if (!previous || previous.role !== "user") return;
    void sendMessage(previous.content, undefined, previous.attachments ?? []);
  }, [messagesRef, sendMessage]);

  const cancelStream = useCallback(() => {
    activeStreamAbortRef.current?.abort();
  }, []);

  return { responding, streamingContent, sendMessage, handleRetry, handleRegenerate, cancelStream };
}
