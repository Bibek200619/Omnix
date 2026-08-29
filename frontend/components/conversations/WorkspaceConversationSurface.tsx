"use client";

import { FormEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { ChannelList } from "@/components/conversations/ChannelList";
import { ConversationAIPanel } from "@/components/conversations/ConversationAIPanel";
import { DecisionFromMessageModal } from "@/components/conversations/DecisionFromMessageModal";
import { MessageThread } from "@/components/conversations/MessageThread";
import { TaskFromMessageModal } from "@/components/conversations/TaskFromMessageModal";
import { ThreadPanel } from "@/components/conversations/ThreadPanel";
import { WorkspaceConversationChrome } from "@/components/conversations/WorkspaceConversationChrome";
import { Button } from "@/components/ui/Button";
import {
  type ConversationMutationScope,
  type DecisionSource,
  type DisplayMessage,
  type TaskSource,
  canCreateOperationalChannel,
  conversationMutationScopeMatches,
  hydrateConversationMessageAuthor,
  incrementThreadReplyCount,
  mergeMessagePage,
  mergeMessage,
  splitMessagePage,
} from "@/components/conversations/conversationUtils";
import { useWorkspaceConversationSender } from "@/components/conversations/useWorkspaceConversationSender";
import { useConversationFailures } from "@/components/conversations/useConversationFailures";
import { useWorkspaceChannels } from "@/components/conversations/useWorkspaceChannels";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import {
  type MutationAttempt,
  mutationAttempt,
  mutationRevisionStillOwned,
  releaseExclusiveMutation,
  runExclusiveMutation,
} from "@/lib/mutation-lifecycle";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { cn } from "@/lib/utils";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceMembership, useWorkspaceTree } from "@/lib/workspace-context";
import type {
  WorkspaceActivityEvent,
  WorkspaceChannel,
  WorkspaceChannelMessage,
} from "@/lib/workspace-types";

const MESSAGE_PAGE_SIZE = 80;
const DISCUSSION_LOAD_ERROR_MESSAGE = "Unable to load discussion. Check your connection and try again.";
const THREAD_LOAD_ERROR_MESSAGE = "Unable to open thread. Check your connection and try again.";
const CHANNEL_CREATE_ERROR_MESSAGE = "Unable to create operational channel. Your session may have expired; refresh and try again.";
const DISCUSSION_FAILURE_KEY = "conversation:discussion-load";
const THREAD_FAILURE_KEY = "conversation:thread-load";
const CHANNEL_CREATE_FAILURE_KEY = "conversation:channel-create";
type ConversationMessageUpdate =
  | DisplayMessage[]
  | ((current: DisplayMessage[]) => DisplayMessage[]);

export const WorkspaceConversationSurface = memo(function WorkspaceConversationSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Workspace conversations">
      <WorkspaceConversationSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function WorkspaceConversationSurfaceContent() {
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { activeMembers } = useWorkspaceMembership();
  const { activity, presence, realtimeStatus, sendTypingSignal, typingUsers } = useWorkspaceCollaboration();
  const routeChannelId = useSearchParams()?.get("channel") ?? null;
  const {
    applyRealtimeChange: applyChannelRealtimeChange,
    channels,
    channelsError,
    channelsLoading,
    channelsRefreshing,
    dismissChannelsError,
    projectMessage: applyChannelMessageSummary,
    refreshChannels,
    upsertChannel,
  } = useWorkspaceChannels(activeWorkspaceId);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessagesState] = useState<DisplayMessage[]>([]);
  const [threadRoot, setThreadRoot] = useState<WorkspaceChannelMessage | null>(null);
  const [threadMessages, setThreadMessagesState] = useState<DisplayMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingNewerThreadReplies, setLoadingNewerThreadReplies] = useState(false);
  const [hasNewerThreadReplies, setHasNewerThreadReplies] = useState(false);
  const { clearFailures, dismissLatestFailure, error, reportFailure, resolveFailure } = useConversationFailures();
  const [createOpen, setCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelPurpose, setChannelPurpose] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [taskSource, setTaskSource] = useState<TaskSource | null>(null);
  const [taskConfirmation, setTaskConfirmation] = useState<string | null>(null);
  const [decisionSource, setDecisionSource] = useState<DecisionSource | null>(null);
  const [decisionConfirmation, setDecisionConfirmation] = useState<string | null>(null);
  const [mobileConversationView, setMobileConversationView] = useState<"channels" | "messages">("channels");
  const workspaceRef = useRef(activeWorkspaceId);
  const selectedChannelRef = useRef(selectedChannelId);
  const messageRequestRef = useRef(0);
  const nextMessageOffsetRef = useRef<number | null>(null);
  const threadRequestRef = useRef(0);
  const nextThreadOffsetRef = useRef<number | null>(null);
  const threadRootRef = useRef(threadRoot);
  const countedThreadReplyIdsRef = useRef(new Set<string>());
  const lastIdentityActivityRef = useRef<string | null>(null);
  const channelMutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const channelCreateAttemptRef = useRef<MutationAttempt | null>(null);
  const channelCreateDetailsRef = useRef<{ nonce: string; registryKey: string } | null>(null);
  const channelCreatePendingTokenRef = useRef<string | null>(null);
  const channelCreateErrorNonceRef = useRef<string | null>(null);
  const channelSelectionRevisionRef = useRef(0);
  const discussionFailureTokenRef = useRef<string | null>(null);
  const threadFailureTokenRef = useRef<string | null>(null);
  const surfaceMountedRef = useRef(true);
  const messagesRef = useRef<DisplayMessage[]>([]);
  const threadMessagesRef = useRef<DisplayMessage[]>([]);
  const channelsRef = useRef(channels);
  const reconcileCommittedMessageRef = useRef<(
    message: WorkspaceChannelMessage,
  ) => boolean>(() => false);

  useLayoutEffect(() => {
    workspaceRef.current = activeWorkspaceId;
    if (selectedChannelRef.current !== selectedChannelId) {
      channelSelectionRevisionRef.current += 1;
    }
    selectedChannelRef.current = selectedChannelId;
    threadRootRef.current = threadRoot;
    channelsRef.current = channels;
  }, [activeWorkspaceId, channels, selectedChannelId, threadRoot]);
  const updateMessages = useCallback((update: ConversationMessageUpdate) => {
    const next = typeof update === "function"
      ? update(messagesRef.current)
      : update;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);
  const updateThreadMessages = useCallback((update: ConversationMessageUpdate) => {
    const next = typeof update === "function"
      ? update(threadMessagesRef.current)
      : update;
    threadMessagesRef.current = next;
    setThreadMessagesState(next);
  }, []);
  const getMessagesForMutation = useCallback(
    (inThread: boolean) => inThread
      ? threadMessagesRef.current
      : messagesRef.current,
    [],
  );
  const clearOwnedChannelCreateError = useCallback((nonce: string) => {
    if (channelCreateErrorNonceRef.current !== nonce) return;
    channelCreateErrorNonceRef.current = null;
    resolveFailure(CHANNEL_CREATE_FAILURE_KEY, nonce);
  }, [resolveFailure]);
  const resolveScopedFailure = useCallback((key: string, tokenRef: { current: string | null }) => {
    const token = tokenRef.current;
    if (token) resolveFailure(key, token);
    tokenRef.current = null;
  }, [resolveFailure]);
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const currentUserId = session?.user.id ?? "";
  const currentMember = activeMembers.find((member) => member.user_id === currentUserId);
  const inheritedIdentityWorkspaceId = activeWorkspace?.is_global && activeWorkspace.parent_workspace_id ? activeWorkspace.parent_workspace_id : null;
  const mayCreateChannel = canCreateOperationalChannel(activeWorkspace?.current_user_role);
  const mayPost = Boolean(selectedChannel && (selectedChannel.posting_policy === "members" || mayCreateChannel));
  const visibleError = error ?? channelsError;

  const loadMessages = useCallback(async (
    channelId: string,
    { append = false, offset = 0 }: { append?: boolean; offset?: number } = {},
  ) => {
    if (!activeWorkspaceId) return;
    const requestId = ++messageRequestRef.current;
    if (append) {
      setLoadingOlderMessages(true);
    } else {
      setMessagesLoading(true);
      setLoadingOlderMessages(false);
    }
    try {
      const incoming = await apiClient.get<WorkspaceChannelMessage[]>(
        `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages?limit=${MESSAGE_PAGE_SIZE + 1}&offset=${offset}`,
      );
      if (requestId === messageRequestRef.current && workspaceRef.current === activeWorkspaceId && selectedChannelRef.current === channelId) {
        const page = splitMessagePage(incoming, MESSAGE_PAGE_SIZE, "start");
        page.records.forEach((message) =>
          reconcileCommittedMessageRef.current(message),
        );
        updateMessages((current) => mergeMessagePage(current, page.records));
        nextMessageOffsetRef.current = page.hasMore ? offset + MESSAGE_PAGE_SIZE : null;
        setHasOlderMessages(page.hasMore);
        resolveScopedFailure(DISCUSSION_FAILURE_KEY, discussionFailureTokenRef);
      }
    } catch (err) {
      if (
        requestId === messageRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId
      ) {
        logClientError("Failed to load discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        const failureToken = `${activeWorkspaceId}:${channelId}:${requestId}`;
        discussionFailureTokenRef.current = failureToken;
        reportFailure(DISCUSSION_FAILURE_KEY, failureToken, DISCUSSION_LOAD_ERROR_MESSAGE);
      }
    } finally {
      if (
        requestId === messageRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId
      ) {
        if (append) setLoadingOlderMessages(false);
        else setMessagesLoading(false);
      }
    }
  }, [activeWorkspaceId, reportFailure, resolveScopedFailure, updateMessages]);

  const loadThread = useCallback(async (
    channelId: string,
    root: WorkspaceChannelMessage,
    { append = false, offset = 0 }: { append?: boolean; offset?: number } = {},
  ) => {
    if (!activeWorkspaceId) return;
    const requestId = ++threadRequestRef.current;
    if (append) {
      setLoadingNewerThreadReplies(true);
    } else {
      setThreadLoading(true);
      setLoadingNewerThreadReplies(false);
    }
    try {
      const incoming = await apiClient.get<WorkspaceChannelMessage[]>(
        `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages?thread_root_id=${root.id}&limit=${MESSAGE_PAGE_SIZE + 1}&offset=${offset}`,
      );
      if (
        requestId === threadRequestRef.current
        && workspaceRef.current === activeWorkspaceId
        && selectedChannelRef.current === channelId
        && threadRootRef.current?.id === root.id
      ) {
        const returnedRoot = incoming.find((message) => message.id === root.id) ?? root;
        const page = splitMessagePage(incoming.filter((message) => message.id !== root.id), MESSAGE_PAGE_SIZE, "end");
        [returnedRoot, ...page.records].forEach((message) =>
          reconcileCommittedMessageRef.current(message),
        );
        const reconciledRoot = mergeMessage([threadRootRef.current ?? root], returnedRoot)[0];
        threadRootRef.current = reconciledRoot;
        setThreadRoot(reconciledRoot);
        updateMessages((current) => mergeMessage(current, reconciledRoot));
        if (append) {
          updateThreadMessages((current) => mergeMessagePage(mergeMessage(current, reconciledRoot), page.records));
        } else {
          updateThreadMessages((current) =>
            mergeMessagePage(current, [reconciledRoot, ...page.records]),
          );
        }
        nextThreadOffsetRef.current = page.hasMore ? offset + MESSAGE_PAGE_SIZE : null;
        setHasNewerThreadReplies(page.hasMore);
        resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef);
      }
    } catch (err) {
      if (
        requestId === threadRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId &&
        threadRootRef.current?.id === root.id
      ) {
        logClientError("Failed to open thread", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        const failureToken = `${activeWorkspaceId}:${channelId}:${root.id}:${requestId}`;
        threadFailureTokenRef.current = failureToken;
        reportFailure(THREAD_FAILURE_KEY, failureToken, THREAD_LOAD_ERROR_MESSAGE);
      }
    } finally {
      if (
        requestId === threadRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId &&
        threadRootRef.current?.id === root.id
      ) {
        if (append) setLoadingNewerThreadReplies(false);
        else setThreadLoading(false);
      }
    }
  }, [activeWorkspaceId, reportFailure, resolveScopedFailure, updateMessages, updateThreadMessages]);
  const loadOlderMessages = useCallback(() => {
    const offset = nextMessageOffsetRef.current;
    if (!selectedChannelId || !hasOlderMessages || loadingOlderMessages || offset === null) return;
    void loadMessages(selectedChannelId, { append: true, offset });
  }, [hasOlderMessages, loadMessages, loadingOlderMessages, selectedChannelId]);
  const loadNewerThreadReplies = useCallback(() => {
    const offset = nextThreadOffsetRef.current;
    if (!selectedChannelId || !threadRoot || !hasNewerThreadReplies || loadingNewerThreadReplies || offset === null) return;
    void loadThread(selectedChannelId, threadRoot, { append: true, offset });
  }, [hasNewerThreadReplies, loadThread, loadingNewerThreadReplies, selectedChannelId, threadRoot]);
  const refreshVisibleMessageIdentities = useCallback(() => {
    const channelId = selectedChannelRef.current;
    if (!channelId) return;
    void loadMessages(channelId);
    if (threadRootRef.current) void loadThread(channelId, threadRootRef.current);
  }, [loadMessages, loadThread]);
  const applyThreadReplyCount = useCallback((message: WorkspaceChannelMessage) => {
    if (
      !message.parent_message_id
      || message.workspace_id !== workspaceRef.current
      || message.channel_id !== selectedChannelRef.current
    ) return;
    if (!countedThreadReplyIdsRef.current.has(message.id)) {
      countedThreadReplyIdsRef.current.add(message.id);
      updateMessages((current) => incrementThreadReplyCount(current, message));
    }
    void loadMessages(message.channel_id);
  }, [loadMessages, updateMessages]);
  const hydrateRealtimeMessage = useCallback((message: WorkspaceChannelMessage) => {
    return hydrateConversationMessageAuthor(message, activeMembers);
  }, [activeMembers]);
  useEffect(() => {
    if (!activeMembers.length) return;
    updateMessages((current) => current.map(hydrateRealtimeMessage));
    updateThreadMessages((current) => current.map(hydrateRealtimeMessage));
    if (!threadRootRef.current) return;
    const hydratedRoot = hydrateRealtimeMessage(threadRootRef.current);
    threadRootRef.current = hydratedRoot;
    setThreadRoot(hydratedRoot);
  }, [activeMembers.length, hydrateRealtimeMessage, updateMessages, updateThreadMessages]);
  const sender = useWorkspaceConversationSender({
    activeThreadReplyCount: threadRoot?.thread_reply_count ?? 0,
    activeThreadRootId: threadRoot?.id ?? null,
    activeWorkspaceId,
    identity: {
      currentUserId,
      email: session?.user.email,
      fullName: typeof session?.user.user_metadata?.full_name === "string" ? session.user.user_metadata.full_name : null,
      operationalLabel: currentMember?.operational_label,
      role: currentMember?.role,
      workspaceRole: activeWorkspace?.current_user_role,
    },
    mayPost,
    getMessages: getMessagesForMutation,
    onChannelMessageCreated: applyChannelMessageSummary,
    onFailure: reportFailure,
    onFailureResolved: resolveFailure,
    onThreadReplyCreated: applyThreadReplyCount,
    selectedChannelId,
    sendTypingSignal,
    setMessages: updateMessages,
    setThreadMessages: updateThreadMessages,
  });
  const { reconcileCommittedMessage } = sender;
  useLayoutEffect(() => {
    reconcileCommittedMessageRef.current = reconcileCommittedMessage;
  }, [reconcileCommittedMessage]);

  useEffect(() => {
    surfaceMountedRef.current = true;
    return () => {
      surfaceMountedRef.current = false;
      channelCreatePendingTokenRef.current = null;
    };
  }, []);

  useEffect(() => {
    messageRequestRef.current += 1;
    threadRequestRef.current += 1;
    const channelCreateDetails = channelCreateDetailsRef.current;
    if (channelCreateDetails) {
      releaseExclusiveMutation(
        channelMutationRegistryRef.current,
        channelCreateDetails.registryKey,
      );
    }
    channelCreateAttemptRef.current = null;
    channelCreateDetailsRef.current = null;
    channelCreatePendingTokenRef.current = null;
    channelCreateErrorNonceRef.current = null;
    resolveScopedFailure(DISCUSSION_FAILURE_KEY, discussionFailureTokenRef);
    resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef);
    setCreatingChannel(false);
    setChannelName("");
    setChannelPurpose("");
    setCreateOpen(false);
    clearFailures();
    setSelectedChannelId(null);
    updateMessages([]);
    setMessagesLoading(false);
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    nextMessageOffsetRef.current = null;
    countedThreadReplyIdsRef.current.clear();
    threadRootRef.current = null;
    setThreadRoot(null);
    updateThreadMessages([]);
    setThreadLoading(false);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setTaskSource(null);
    setTaskConfirmation(null);
    setDecisionSource(null);
    setDecisionConfirmation(null);
    setMobileConversationView("channels");
  }, [activeWorkspaceId, clearFailures, resolveScopedFailure, updateMessages, updateThreadMessages]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      return;
    }
    setSelectedChannelId((existing) => {
      if (
        routeChannelId &&
        channels.some((channel) => channel.id === routeChannelId)
      ) {
        return routeChannelId;
      }
      return channels.some((channel) => channel.id === existing)
        ? existing
        : channels[0]?.id ?? null;
    });
    if (
      routeChannelId &&
      channels.some((channel) => channel.id === routeChannelId)
    ) {
      setMobileConversationView("messages");
    }
  }, [activeWorkspaceId, channels, routeChannelId]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe({ type: "channels", workspaceId: activeWorkspaceId }, (channel) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "workspace_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, applyChannelRealtimeChange),
    );
    return () => realtimeRegistry.unsubscribe({ type: "channels", workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, applyChannelRealtimeChange, session?.user.id]);

  useLayoutEffect(() => {
    resolveScopedFailure(DISCUSSION_FAILURE_KEY, discussionFailureTokenRef);
    resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef);
    threadRequestRef.current += 1;
    threadRootRef.current = null;
    setThreadRoot(null);
    updateThreadMessages([]);
    setThreadLoading(false);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    nextMessageOffsetRef.current = null;
    countedThreadReplyIdsRef.current.clear();
    if (!selectedChannelId) {
      messageRequestRef.current += 1;
      updateMessages([]);
      setMessagesLoading(false);
      return;
    }
    updateMessages([]);
    void loadMessages(selectedChannelId);
  }, [loadMessages, resolveScopedFailure, selectedChannelId, updateMessages, updateThreadMessages]);
  useEffect(() => {
    if (!activeWorkspaceId || !selectedChannelId || !session?.user.id) return;
    realtimeRegistry.subscribe({ type: "channel_messages", workspaceId: activeWorkspaceId, conversationId: selectedChannelId }, (channel) =>
      channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_channel_messages", filter: `channel_id=eq.${selectedChannelId}` }, (payload: { new: WorkspaceChannelMessage }) => {
        const incoming = hydrateRealtimeMessage(payload.new);
        if (
          incoming.workspace_id !== workspaceRef.current ||
          incoming.channel_id !== selectedChannelRef.current
        ) {
          return;
        }
        reconcileCommittedMessage(incoming);
        if (incoming.parent_message_id) {
          if (threadRootRef.current?.id === incoming.parent_message_id) {
            updateThreadMessages((current) => mergeMessage(current, incoming));
          }
          applyThreadReplyCount(incoming);
          return;
        }
        updateMessages((current) => mergeMessage(current, incoming));
      }),
    );
    return () => realtimeRegistry.unsubscribe({ type: "channel_messages", workspaceId: activeWorkspaceId, conversationId: selectedChannelId });
  }, [activeWorkspaceId, applyThreadReplyCount, hydrateRealtimeMessage, reconcileCommittedMessage, selectedChannelId, session?.user.id, updateMessages, updateThreadMessages]);

  useEffect(() => {
    const identityEvent = activity.find((event) => event.event_type === "workspace.member_role_updated");
    if (!identityEvent || identityEvent.id === lastIdentityActivityRef.current) return;
    lastIdentityActivityRef.current = identityEvent.id;
    refreshVisibleMessageIdentities();
  }, [activity, refreshVisibleMessageIdentities]);

  useEffect(() => {
    if (!activeWorkspaceId || !inheritedIdentityWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe({ type: "conversation_identity", workspaceId: inheritedIdentityWorkspaceId, conversationId: activeWorkspaceId }, (channel) =>
      channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_activity_events", filter: `workspace_id=eq.${inheritedIdentityWorkspaceId}` }, (payload: { new: WorkspaceActivityEvent }) => {
        if (payload.new.event_type === "workspace.member_role_updated") refreshVisibleMessageIdentities();
      }),
    );
    return () => realtimeRegistry.unsubscribe({ type: "conversation_identity", workspaceId: inheritedIdentityWorkspaceId, conversationId: activeWorkspaceId });
  }, [activeWorkspaceId, inheritedIdentityWorkspaceId, refreshVisibleMessageIdentities, session?.user.id]);

  const channelTyping = useMemo(
    () => Object.values(typingUsers).filter((typing) => typing.userId !== currentUserId && typing.conversationId === selectedChannelId),
    [currentUserId, selectedChannelId, typingUsers],
  );

  async function handleCreateChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !channelName.trim()) return;
    const requestWorkspaceId = activeWorkspaceId;
    const requestName = channelName.trim();
    const requestPurpose = channelPurpose.trim() || null;
    const requestScope: ConversationMutationScope = {
      workspaceId: requestWorkspaceId,
    };
    const fingerprint = JSON.stringify({
      workspaceId: requestWorkspaceId,
      name: requestName,
      purpose: requestPurpose,
    });
    const registryKey = `conversation:channel:create:${requestWorkspaceId}`;
    const selectionRevision = channelSelectionRevisionRef.current;
    const knownChannelIds = new Set(
      channelsRef.current.map((channel) => channel.id),
    );

    await runExclusiveMutation(channelMutationRegistryRef.current, registryKey, async () => {
      if (
        !surfaceMountedRef.current
        || !conversationMutationScopeMatches(requestScope, { workspaceId: workspaceRef.current })
      ) {
        return;
      }
      const attempt = mutationAttempt(channelCreateAttemptRef.current, fingerprint);
      const previousFailureNonce = channelCreateErrorNonceRef.current;
      if (previousFailureNonce) clearOwnedChannelCreateError(previousFailureNonce);
      channelCreateAttemptRef.current = attempt;
      channelCreateDetailsRef.current = { nonce: attempt.nonce, registryKey };
      channelCreatePendingTokenRef.current = attempt.nonce;
      setCreatingChannel(true);

      const isCurrentAttempt = () => surfaceMountedRef.current
        && channelCreatePendingTokenRef.current === attempt.nonce
        && conversationMutationScopeMatches(requestScope, { workspaceId: workspaceRef.current });
      const stillOwnsSelection = () => mutationRevisionStillOwned(channelSelectionRevisionRef.current, selectionRevision);

      try {
        const created = await apiClient.post<WorkspaceChannel>(
          `/workspaces/${requestWorkspaceId}/channels`,
          {
            name: requestName,
            purpose: requestPurpose,
            channel_type: "operational",
            visibility: "workspace",
            posting_policy: "members",
          },
        );
        if (!isCurrentAttempt()) return;
        if (created.workspace_id !== requestWorkspaceId) {
          throw new Error("Channel response did not match the active workspace.");
        }
        await upsertChannel(created);
        if (!isCurrentAttempt()) return;
        if (stillOwnsSelection()) {
          setSelectedChannelId(created.id);
          setMobileConversationView("messages");
        }
        setChannelName("");
        setChannelPurpose("");
        setCreateOpen(false);
        clearOwnedChannelCreateError(attempt.nonce);
        if (channelCreateAttemptRef.current === attempt) {
          channelCreateAttemptRef.current = null;
        }
      } catch (err) {
        if (!isCurrentAttempt()) return;
        const refreshedChannels = await refreshChannels().catch(() => []);
        if (!isCurrentAttempt()) return;
        const committed = refreshedChannels.find((channel) => (
          !knownChannelIds.has(channel.id)
          && channel.workspace_id === requestWorkspaceId
          && channel.name.trim().toLocaleLowerCase()
            === requestName.toLocaleLowerCase()
          && (channel.purpose?.trim() || null) === requestPurpose
        ));
        if (committed) {
          if (stillOwnsSelection()) {
            setSelectedChannelId(committed.id);
            setMobileConversationView("messages");
          }
          setChannelName("");
          setChannelPurpose("");
          setCreateOpen(false);
          clearOwnedChannelCreateError(attempt.nonce);
          if (channelCreateAttemptRef.current === attempt) {
            channelCreateAttemptRef.current = null;
          }
          return;
        }
        logClientError("Failed to create operational channel", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/channels`,
        });
        channelCreateErrorNonceRef.current = attempt.nonce;
        reportFailure(CHANNEL_CREATE_FAILURE_KEY, attempt.nonce, CHANNEL_CREATE_ERROR_MESSAGE);
      } finally {
        if (channelCreateDetailsRef.current?.nonce === attempt.nonce) {
          channelCreateDetailsRef.current = null;
        }
        if (isCurrentAttempt()) {
          channelCreatePendingTokenRef.current = null;
          setCreatingChannel(false);
        }
      }
    });
  }
  function handleSelectChannel(channelId: string) {
    channelSelectionRevisionRef.current += 1;
    setSelectedChannelId(channelId);
    setMobileConversationView("messages");
  }
  function handleBackToChannels() {
    closeThread();
    setMobileConversationView("channels");
  }

  function closeThread() {
    resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef);
    threadRequestRef.current += 1;
    threadRootRef.current = null;
    setThreadRoot(null);
    updateThreadMessages([]);
    setThreadLoading(false);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
  }

  function openThread(message: WorkspaceChannelMessage) {
    if (!selectedChannelId) return;
    resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef);
    threadRootRef.current = message;
    setThreadRoot(message);
    updateThreadMessages([]);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setMobileConversationView("messages");
    sender.setThreadDraftMentions([]);
    void loadThread(selectedChannelId, message);
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to enter operational conversations.</p>
      </section>
    );
  }

  return (
    <section className="omnix-container-responsive flex min-h-0 flex-1 flex-col overflow-x-hidden px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <WorkspaceConversationChrome activeCount={presence?.active_count ?? 0} channelsLoading={channelsLoading || channelsRefreshing} decisionConfirmation={decisionConfirmation} error={visibleError} onDismissDecision={() => setDecisionConfirmation(null)} onDismissError={() => error ? dismissLatestFailure() : dismissChannelsError()} onDismissTask={() => setTaskConfirmation(null)} onRetryConversations={() => void refreshChannels()} realtimeStatus={realtimeStatus} taskConfirmation={taskConfirmation} workspaceName={activeWorkspace?.name} />

      <div
        className="omnix-conversation-workbench"
        data-thread={threadRoot ? "open" : "closed"}
        data-view={mobileConversationView}
      >
        <div className={cn("omnix-conversation-channels min-h-0", mobileConversationView !== "channels" && "hidden")}>
          <ChannelList channelName={channelName} channelPurpose={channelPurpose} channels={channels} channelsLoading={channelsLoading} createOpen={createOpen} creatingChannel={creatingChannel} mayCreateChannel={mayCreateChannel} onCreateChannel={handleCreateChannel} onSelectChannel={handleSelectChannel} selectedChannelId={selectedChannelId} setChannelName={setChannelName} setChannelPurpose={setChannelPurpose} setCreateOpen={setCreateOpen} />
        </div>
        <div className={cn("omnix-conversation-messages min-h-0 min-w-0 flex-col gap-3", mobileConversationView !== "messages" ? "hidden" : "flex")}>
          <div className="omnix-conversation-mobile-back">
            <Button type="button" variant="ghost" size="sm" className="h-11 border-white/10 text-xs text-[var(--omnix-text-2)]" leftIcon={<ArrowLeft className="h-3.5 w-3.5" />} onClick={handleBackToChannels}>
              Channels
            </Button>
          </div>
          <MessageThread activeMembers={activeMembers} aiPanel={<ConversationAIPanel activeWorkspaceId={activeWorkspaceId} messagesCount={messages.length} onFailure={reportFailure} onFailureResolved={resolveFailure} onOpenDecision={setDecisionSource} onOpenTask={setTaskSource} selectedChannelId={selectedChannelId} threadRoot={threadRoot} />} channelTyping={channelTyping} draft={sender.draft} draftMentions={sender.draftMentions} hasOlderMessages={hasOlderMessages} loadingOlderMessages={loadingOlderMessages} mayPost={mayPost} messages={messages} messagesLoading={messagesLoading} onDraftChange={sender.setDraft} onDraftMentionsChange={sender.setDraftMentions} onLoadOlderMessages={loadOlderMessages} onOpenDecision={(message) => setDecisionSource({ kind: "message", message, scope: { workspaceId: message.workspace_id, channelId: message.channel_id, threadRootId: null } })} onOpenTask={(message) => setTaskSource({ kind: "message", message, scope: { workspaceId: message.workspace_id, channelId: message.channel_id, threadRootId: null } })} onOpenThread={openThread} onSend={(content, parent, mentions) => void sender.sendMessage(content, parent, mentions)} onTypingChange={(isTyping) => void sendTypingSignal(selectedChannelId, isTyping)} selectedChannel={selectedChannel} sending={sender.sending} />
        </div>
        <div className="omnix-conversation-thread min-h-0 min-w-0">
          <ThreadPanel activeMembers={activeMembers} hasNewerThreadReplies={hasNewerThreadReplies} loadingNewerThreadReplies={loadingNewerThreadReplies} mayPost={mayPost} onClose={closeThread} onLoadNewerReplies={loadNewerThreadReplies} onOpenDecision={(message) => setDecisionSource({ kind: "message", message, scope: { workspaceId: message.workspace_id, channelId: message.channel_id, threadRootId: threadRoot?.id ?? null } })} onOpenTask={(message) => setTaskSource({ kind: "message", message, scope: { workspaceId: message.workspace_id, channelId: message.channel_id, threadRootId: threadRoot?.id ?? null } })} onSend={(content, parent, mentions) => void sender.sendMessage(content, parent, mentions)} onThreadDraftChange={sender.setThreadDraft} onThreadDraftMentionsChange={sender.setThreadDraftMentions} onTypingChange={(isTyping) => void sendTypingSignal(selectedChannelId, isTyping)} threadDraft={sender.threadDraft} threadDraftMentions={sender.threadDraftMentions} threadLoading={threadLoading} threadMessages={threadMessages} threadRoot={threadRoot} threadSending={sender.threadSending} />
        </div>
      </div>
      <TaskFromMessageModal activeMembers={activeMembers} activeWorkspaceId={activeWorkspaceId} currentThreadRootId={threadRoot?.id ?? null} onClose={() => setTaskSource(null)} onCreated={setTaskConfirmation} onFailure={reportFailure} onFailureResolved={resolveFailure} selectedChannelId={selectedChannelId} source={taskSource} />
      <DecisionFromMessageModal activeMembers={activeMembers} activeWorkspaceId={activeWorkspaceId} currentThreadRootId={threadRoot?.id ?? null} onClose={() => setDecisionSource(null)} onCreated={setDecisionConfirmation} onFailure={reportFailure} onFailureResolved={resolveFailure} selectedChannelId={selectedChannelId} source={decisionSource} />
    </section>
  );
}
