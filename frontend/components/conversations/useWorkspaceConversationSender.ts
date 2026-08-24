"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type {
  ReportConversationFailure,
  ResolveConversationFailure,
} from "@/components/conversations/useConversationFailures";
import {
  type ConversationMutationScope,
  type DisplayMessage,
  conversationMutationScopeMatches,
  markOptimisticMessageFailed,
  mergeMessage,
  messageMatchesConversationMutation,
  persistedMessageForNonce,
} from "@/components/conversations/conversationUtils";
import { mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import {
  type MutationAttempt,
  mutationAttempt,
  mutationRevisionStillOwned,
  releaseExclusiveMutation,
  runExclusiveMutation,
} from "@/lib/mutation-lifecycle";
import { queryGet } from "@/lib/query";
import { ambientConversationIdentity } from "@/lib/workspace-roles";
import type {
  WorkspaceChannelMessage,
  WorkspaceMentionMetadata,
  WorkspaceRole,
} from "@/lib/workspace-types";

type SenderIdentity = {
  currentUserId: string;
  email?: string | null;
  fullName?: string | null;
  operationalLabel?: string | null;
  role?: WorkspaceRole | null;
  workspaceRole?: WorkspaceRole | null;
};

type ConversationSendAttempt = {
  attempt: MutationAttempt;
  content: string;
  mentions: WorkspaceMentionMetadata[];
  parentMessageId: string | null;
  registryKey: string;
  restoredDraftRevision: number | null;
  scope: ConversationMutationScope;
};

const DELIVERY_ERROR_MESSAGE = "Unable to deliver message. Check your connection and try again.";
const CANONICAL_MESSAGE_PAGE_SIZE = 100;

type UseWorkspaceConversationSenderParams = {
  activeThreadReplyCount: number;
  activeThreadRootId: string | null;
  activeWorkspaceId: string | null;
  getMessages: (inThread: boolean) => DisplayMessage[];
  identity: SenderIdentity;
  mayPost: boolean;
  onChannelMessageCreated: (message: WorkspaceChannelMessage) => void;
  onFailure: ReportConversationFailure;
  onFailureResolved: ResolveConversationFailure;
  onThreadReplyCreated: (message: WorkspaceChannelMessage) => void;
  selectedChannelId: string | null;
  sendTypingSignal: (conversationId?: string | null, isTyping?: boolean) => Promise<void>;
  setMessages: (updater: (current: DisplayMessage[]) => DisplayMessage[]) => void;
  setThreadMessages: (updater: (current: DisplayMessage[]) => DisplayMessage[]) => void;
};

function canonicalMessageEndpoint(
  scope: ConversationMutationScope,
  parentMessageId: string | null,
  threadReplyCount: number,
) {
  const parameters = new URLSearchParams({
    limit: String(CANONICAL_MESSAGE_PAGE_SIZE),
    offset: parentMessageId
      ? String(Math.max(threadReplyCount - CANONICAL_MESSAGE_PAGE_SIZE + 1, 0))
      : "0",
  });
  if (parentMessageId) parameters.set("thread_root_id", parentMessageId);
  return `/workspaces/${scope.workspaceId}/channels/${scope.channelId}/messages?${parameters.toString()}`;
}

function hasSameDraftPayload(
  value: string,
  currentMentions: WorkspaceMentionMetadata[],
  content: string,
  mentions: WorkspaceMentionMetadata[],
) {
  return value.trim() === content
    && JSON.stringify(mentionPayload(currentMentions, content))
      === JSON.stringify(mentionPayload(mentions, content));
}

export function useWorkspaceConversationSender({
  activeThreadReplyCount,
  activeThreadRootId,
  activeWorkspaceId,
  getMessages,
  identity,
  mayPost,
  onChannelMessageCreated,
  onFailure,
  onFailureResolved,
  onThreadReplyCreated,
  selectedChannelId,
  sendTypingSignal,
  setMessages,
  setThreadMessages,
}: UseWorkspaceConversationSenderParams) {
  const [draft, setDraftState] = useState("");
  const [threadDraft, setThreadDraftState] = useState("");
  const [draftMentions, setDraftMentionsState] = useState<WorkspaceMentionMetadata[]>([]);
  const [threadDraftMentions, setThreadDraftMentionsState] = useState<WorkspaceMentionMetadata[]>([]);
  const [sending, setSending] = useState(false);
  const [threadSending, setThreadSending] = useState(false);
  const activeWorkspaceRef = useRef(activeWorkspaceId);
  const selectedChannelRef = useRef(selectedChannelId);
  const activeThreadRootRef = useRef(activeThreadRootId);
  const mountedRef = useRef(true);
  const mutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const mainAttemptRef = useRef<MutationAttempt | null>(null);
  const threadAttemptRef = useRef<MutationAttempt | null>(null);
  const mainAttemptDetailsRef = useRef<ConversationSendAttempt | null>(null);
  const threadAttemptDetailsRef = useRef<ConversationSendAttempt | null>(null);
  const mainPendingTokenRef = useRef<string | null>(null);
  const threadPendingTokenRef = useRef<string | null>(null);
  const draftRef = useRef("");
  const threadDraftRef = useRef("");
  const draftMentionsRef = useRef<WorkspaceMentionMetadata[]>([]);
  const threadDraftMentionsRef = useRef<WorkspaceMentionMetadata[]>([]);
  const draftRevisionRef = useRef(0);
  const threadDraftRevisionRef = useRef(0);

  useLayoutEffect(() => {
    activeWorkspaceRef.current = activeWorkspaceId;
    selectedChannelRef.current = selectedChannelId;
    activeThreadRootRef.current = activeThreadRootId;
  }, [activeThreadRootId, activeWorkspaceId, selectedChannelId]);

  const setDraft = useCallback((value: string) => {
    draftRef.current = value;
    draftRevisionRef.current += 1;
    setDraftState(value);
  }, []);

  const setThreadDraft = useCallback((value: string) => {
    threadDraftRef.current = value;
    threadDraftRevisionRef.current += 1;
    setThreadDraftState(value);
  }, []);

  const setDraftMentions = useCallback((mentions: WorkspaceMentionMetadata[]) => {
    const next = [...mentions];
    draftMentionsRef.current = next;
    draftRevisionRef.current += 1;
    setDraftMentionsState(next);
  }, []);

  const setThreadDraftMentions = useCallback((mentions: WorkspaceMentionMetadata[]) => {
    const next = [...mentions];
    threadDraftMentionsRef.current = next;
    threadDraftRevisionRef.current += 1;
    setThreadDraftMentionsState(next);
  }, []);

  const clearOwnedDeliveryError = useCallback((nonce: string) => {
    onFailureResolved(`conversation:delivery:${nonce}`, nonce);
  }, [onFailureResolved]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    for (const details of [mainAttemptDetailsRef.current, threadAttemptDetailsRef.current]) {
      if (!details) continue;
      releaseExclusiveMutation(mutationRegistryRef.current, details.registryKey);
      clearOwnedDeliveryError(details.attempt.nonce);
    }
    mainAttemptRef.current = null;
    threadAttemptRef.current = null;
    mainAttemptDetailsRef.current = null;
    threadAttemptDetailsRef.current = null;
    mainPendingTokenRef.current = null;
    threadPendingTokenRef.current = null;
    setSending(false);
    setThreadSending(false);
    setDraft("");
    setDraftMentions([]);
    setThreadDraft("");
    setThreadDraftMentions([]);
  }, [
    activeWorkspaceId,
    clearOwnedDeliveryError,
    selectedChannelId,
    setDraft,
    setDraftMentions,
    setThreadDraft,
    setThreadDraftMentions,
  ]);

  useEffect(() => {
    const details = threadAttemptDetailsRef.current;
    if (details) {
      releaseExclusiveMutation(mutationRegistryRef.current, details.registryKey);
      clearOwnedDeliveryError(details.attempt.nonce);
    }
    threadAttemptRef.current = null;
    threadAttemptDetailsRef.current = null;
    threadPendingTokenRef.current = null;
    setThreadSending(false);
    setThreadDraft("");
    setThreadDraftMentions([]);
  }, [activeThreadRootId, clearOwnedDeliveryError, setThreadDraft, setThreadDraftMentions]);

  function optimisticMessage(
    content: string,
    nonce: string,
    workspaceId: string,
    channelId: string,
    parentMessageId?: string,
    mentions: WorkspaceMentionMetadata[] = [],
  ): DisplayMessage {
    return {
      id: `pending-${nonce}`,
      workspace_id: workspaceId,
      channel_id: channelId,
      author_user_id: identity.currentUserId,
      parent_message_id: parentMessageId || null,
      content,
      context_links: [],
      metadata: mentions.length ? { mentions } : {},
      mentions,
      client_nonce: nonce,
      created_at: new Date().toISOString(),
      author_name: identity.fullName || identity.email || "You",
      author_avatar_label: (identity.email || "Y")[0].toUpperCase(),
      author_identity: ambientConversationIdentity(identity.role || identity.workspaceRole, identity.operationalLabel),
      thread_reply_count: 0,
      delivery: "sending",
    };
  }

  function payloadFingerprint(
    scope: ConversationMutationScope,
    content: string,
    mentions: WorkspaceMentionMetadata[],
  ) {
    return JSON.stringify({
      ...scope,
      content,
      mentions: mentionPayload(mentions, content),
    });
  }

  function clearDraftForAttempt(
    inThread: boolean,
    content: string,
    mentions: WorkspaceMentionMetadata[],
  ) {
    if (inThread) {
      if (!hasSameDraftPayload(threadDraftRef.current, threadDraftMentionsRef.current, content, mentions)) {
        return null;
      }
      setThreadDraft("");
      setThreadDraftMentions([]);
      return threadDraftRevisionRef.current;
    }
    if (!hasSameDraftPayload(draftRef.current, draftMentionsRef.current, content, mentions)) {
      return null;
    }
    setDraft("");
    setDraftMentions([]);
    return draftRevisionRef.current;
  }

  function restoreDraftForAttempt(
    inThread: boolean,
    clearedRevision: number | null,
    content: string,
    mentions: WorkspaceMentionMetadata[],
  ) {
    if (clearedRevision === null) return null;
    if (inThread) {
      if (threadDraftRevisionRef.current !== clearedRevision) return null;
      setThreadDraft(content);
      setThreadDraftMentions(mentions);
      return threadDraftRevisionRef.current;
    }
    if (draftRevisionRef.current !== clearedRevision) return null;
    setDraft(content);
    setDraftMentions(mentions);
    return draftRevisionRef.current;
  }

  const reconcileCommittedMessage = useCallback((message: WorkspaceChannelMessage) => {
    const nonce = message.client_nonce;
    if (
      !nonce
      || message.workspace_id !== activeWorkspaceRef.current
      || message.channel_id !== selectedChannelRef.current
    ) {
      return false;
    }

    const inThread = Boolean(message.parent_message_id);
    const attemptRef = inThread ? threadAttemptRef : mainAttemptRef;
    const attemptDetailsRef = inThread ? threadAttemptDetailsRef : mainAttemptDetailsRef;
    const pendingTokenRef = inThread ? threadPendingTokenRef : mainPendingTokenRef;
    const details = attemptDetailsRef.current;
    if (
      !details
      || !messageMatchesConversationMutation(
        message,
        details.scope,
        details.attempt.nonce,
        details.parentMessageId || undefined,
      )
    ) {
      clearOwnedDeliveryError(nonce);
      return false;
    }

    releaseExclusiveMutation(mutationRegistryRef.current, details.registryKey);
    clearOwnedDeliveryError(nonce);
    if (attemptRef.current === details.attempt) attemptRef.current = null;
    attemptDetailsRef.current = null;
    if (pendingTokenRef.current === nonce) pendingTokenRef.current = null;
    if (inThread) {
      setThreadSending(false);
      if (mutationRevisionStillOwned(
        threadDraftRevisionRef.current,
        details.restoredDraftRevision,
      ) && hasSameDraftPayload(
        threadDraftRef.current,
        threadDraftMentionsRef.current,
        details.content,
        details.mentions,
      )) {
        setThreadDraft("");
        setThreadDraftMentions([]);
      }
    } else {
      setSending(false);
      if (mutationRevisionStillOwned(
        draftRevisionRef.current,
        details.restoredDraftRevision,
      ) && hasSameDraftPayload(
        draftRef.current,
        draftMentionsRef.current,
        details.content,
        details.mentions,
      )) {
        setDraft("");
        setDraftMentions([]);
      }
    }
    void sendTypingSignal(message.channel_id, false).catch((err) => {
      logClientError("Failed to clear conversation typing state", err, {
        endpoint: `/workspaces/${message.workspace_id}/presence`,
      });
    });
    return true;
  }, [
    clearOwnedDeliveryError,
    sendTypingSignal,
    setDraft,
    setDraftMentions,
    setThreadDraft,
    setThreadDraftMentions,
  ]);

  async function sendMessage(content: string, parentMessageId?: string, mentions: WorkspaceMentionMetadata[] = []) {
    if (!activeWorkspaceId || !selectedChannelId || !mayPost || !content.trim()) return;
    const cleaned = content.trim();
    const requestWorkspaceId = activeWorkspaceId;
    const requestChannelId = selectedChannelId;
    const inThread = Boolean(parentMessageId);
    const requestThreadReplyCount = activeThreadReplyCount;
    const requestScope: ConversationMutationScope = {
      workspaceId: requestWorkspaceId,
      channelId: requestChannelId,
      ...(inThread ? { sourceId: parentMessageId || null } : {}),
    };
    const registryKey = `conversation:send:${requestWorkspaceId}:${requestChannelId}:${parentMessageId || "main"}`;
    const fingerprint = payloadFingerprint(requestScope, cleaned, mentions);

    await runExclusiveMutation(mutationRegistryRef.current, registryKey, async () => {
      const currentScope = (): ConversationMutationScope => ({
        workspaceId: activeWorkspaceRef.current,
        channelId: selectedChannelRef.current,
        sourceId: activeThreadRootRef.current,
      });
      if (!mountedRef.current || !conversationMutationScopeMatches(requestScope, currentScope())) {
        return;
      }

      const attemptRef = inThread ? threadAttemptRef : mainAttemptRef;
      const attemptDetailsRef = inThread ? threadAttemptDetailsRef : mainAttemptDetailsRef;
      const pendingTokenRef = inThread ? threadPendingTokenRef : mainPendingTokenRef;
      const previousAttempt = attemptRef.current;
      const attempt = mutationAttempt(attemptRef.current, fingerprint);
      if (previousAttempt && previousAttempt !== attempt) {
        clearOwnedDeliveryError(previousAttempt.nonce);
        const abandonPrevious = (current: DisplayMessage[]) => current.filter(
          (message) => !(
            message.id === `pending-${previousAttempt.nonce}`
            && message.client_nonce === previousAttempt.nonce
            && message.delivery === "failed"
          ),
        );
        if (inThread) setThreadMessages(abandonPrevious);
        else setMessages(abandonPrevious);
      }
      attemptRef.current = attempt;
      attemptDetailsRef.current = {
        attempt,
        content: cleaned,
        mentions: [...mentions],
        parentMessageId: parentMessageId || null,
        registryKey,
        restoredDraftRevision: null,
        scope: requestScope,
      };
      pendingTokenRef.current = attempt.nonce;
      if (inThread) setThreadSending(true);
      else setSending(true);

      const clearedDraftRevision = clearDraftForAttempt(inThread, cleaned, mentions);
      const optimistic = optimisticMessage(
        cleaned,
        attempt.nonce,
        requestWorkspaceId,
        requestChannelId,
        parentMessageId,
        mentions,
      );
      if (inThread) {
        setThreadMessages((current) => mergeMessage(current, optimistic));
      } else {
        setMessages((current) => mergeMessage(current, optimistic));
      }

      const isCurrentAttempt = () => mountedRef.current
        && pendingTokenRef.current === attempt.nonce
        && conversationMutationScopeMatches(requestScope, currentScope());
      const persistedForAttempt = () => {
        const persisted = persistedMessageForNonce(getMessages(inThread), attempt.nonce);
        return persisted && messageMatchesConversationMutation(
          persisted,
          requestScope,
          attempt.nonce,
          parentMessageId,
        ) ? persisted : undefined;
      };

      const acceptCommittedMessage = (created: WorkspaceChannelMessage) => {
        if (inThread) {
          setThreadMessages((current) => mergeMessage(current, created));
          onThreadReplyCreated(created);
        } else {
          setMessages((current) => mergeMessage(current, created));
        }
        onChannelMessageCreated(created);
        if (attemptRef.current === attempt) attemptRef.current = null;
        if (attemptDetailsRef.current?.attempt === attempt) {
          attemptDetailsRef.current = null;
        }
        clearOwnedDeliveryError(attempt.nonce);
        void sendTypingSignal(requestChannelId, false).catch((typingError) => {
          logClientError("Failed to clear conversation typing state", typingError, {
            endpoint: `/workspaces/${requestWorkspaceId}/presence`,
          });
        });
      };

      try {
        const created = await apiClient.post<WorkspaceChannelMessage>(
          `/workspaces/${requestWorkspaceId}/channels/${requestChannelId}/messages`,
          {
            content: cleaned,
            parent_message_id: parentMessageId || null,
            client_nonce: attempt.nonce,
            context_links: [],
            mentions: mentionPayload(mentions, cleaned),
          },
        );
        if (!messageMatchesConversationMutation(
          created,
          requestScope,
          attempt.nonce,
          parentMessageId,
        )) {
          throw new Error("Conversation message response did not match the active mutation.");
        }
        if (!isCurrentAttempt()) {
          const realtimeCommitted = mountedRef.current
            && conversationMutationScopeMatches(requestScope, currentScope())
            && persistedForAttempt();
          if (realtimeCommitted) {
            if (inThread) {
              setThreadMessages((current) => mergeMessage(current, created));
            } else {
              setMessages((current) => mergeMessage(current, created));
            }
          }
          return;
        }

        acceptCommittedMessage(created);
      } catch (err) {
        if (!isCurrentAttempt()) return;
        let persisted = persistedForAttempt();
        if (!persisted) {
          const canonicalEndpoint = canonicalMessageEndpoint(
            requestScope,
            parentMessageId || null,
            requestThreadReplyCount,
          );
          try {
            const canonicalMessages = await queryGet<WorkspaceChannelMessage[]>(
              canonicalEndpoint,
              { force: true },
            );
            if (!isCurrentAttempt()) return;
            persisted = canonicalMessages.find((message) =>
              messageMatchesConversationMutation(
                message,
                requestScope,
                attempt.nonce,
                parentMessageId,
              ),
            );
          } catch (reconciliationError) {
            if (!isCurrentAttempt()) return;
            logClientError("Failed to reconcile conversation send", reconciliationError, {
              endpoint: canonicalEndpoint,
            });
          }
        }
        persisted ??= persistedForAttempt();
        if (persisted) {
          if (!isCurrentAttempt()) return;
          acceptCommittedMessage(persisted);
          return;
        }
        if (inThread) {
          setThreadMessages((current) => markOptimisticMessageFailed(current, attempt.nonce));
        } else {
          setMessages((current) => markOptimisticMessageFailed(current, attempt.nonce));
        }
        const restoredDraftRevision = restoreDraftForAttempt(
          inThread,
          clearedDraftRevision,
          cleaned,
          mentions,
        );
        if (attemptDetailsRef.current?.attempt === attempt) {
          attemptDetailsRef.current.restoredDraftRevision = restoredDraftRevision;
        }
        logClientError("Failed to deliver message", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/channels/${requestChannelId}/messages`,
        });
        onFailure(
          `conversation:delivery:${attempt.nonce}`,
          attempt.nonce,
          DELIVERY_ERROR_MESSAGE,
        );
      } finally {
        if (isCurrentAttempt()) {
          pendingTokenRef.current = null;
          if (inThread) setThreadSending(false);
          else setSending(false);
        }
      }
    });
  }

  return {
    draft,
    draftMentions,
    reconcileCommittedMessage,
    sending,
    sendMessage,
    setDraft,
    setDraftMentions,
    setThreadDraft,
    setThreadDraftMentions,
    threadDraft,
    threadDraftMentions,
    threadSending,
  };
}
