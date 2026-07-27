"use client";

import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type DecisionSource,
  type DisplayMessage,
  type TaskSource,
  canCreateOperationalChannel,
  incrementThreadReplyCount,
  isCurrentWorkspaceChannelChange,
  isCurrentWorkspaceChannelLoad,
  mergeMessagePage,
  mergeWorkspaceChannelMessage,
  mergeMessage,
  reconcileWorkspaceChannelChange,
  splitMessagePage,
  sortWorkspaceChannels,
  type WorkspaceChannelRealtimeChange,
} from "@/components/conversations/conversationUtils";
import { useWorkspaceConversationSender } from "@/components/conversations/useWorkspaceConversationSender";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
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
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadRoot, setThreadRoot] = useState<WorkspaceChannelMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<DisplayMessage[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadingNewerThreadReplies, setLoadingNewerThreadReplies] = useState(false);
  const [hasNewerThreadReplies, setHasNewerThreadReplies] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const channelRequestRef = useRef(0);
  const channelStateRevisionRef = useRef(0);
  const loadChannelsRef = useRef<(() => Promise<void>) | null>(null);
  const messageRequestRef = useRef(0);
  const nextMessageOffsetRef = useRef<number | null>(null);
  const threadRequestRef = useRef(0);
  const nextThreadOffsetRef = useRef<number | null>(null);
  const threadRootRef = useRef(threadRoot);
  const countedThreadReplyIdsRef = useRef(new Set<string>());
  const lastIdentityActivityRef = useRef<string | null>(null);

  workspaceRef.current = activeWorkspaceId;
  selectedChannelRef.current = selectedChannelId;
  threadRootRef.current = threadRoot;
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const currentUserId = session?.user.id ?? "";
  const currentMember = activeMembers.find((member) => member.user_id === currentUserId);
  const inheritedIdentityWorkspaceId = activeWorkspace?.is_global && activeWorkspace.parent_workspace_id ? activeWorkspace.parent_workspace_id : null;
  const mayCreateChannel = canCreateOperationalChannel(activeWorkspace?.current_user_role);
  const mayPost = Boolean(selectedChannel && (selectedChannel.posting_policy === "members" || mayCreateChannel));

  const loadChannels = useCallback(async () => {
    if (!activeWorkspaceId) {
      setChannels([]);
      setChannelsLoading(false);
      return;
    }
    const requestId = ++channelRequestRef.current;
    const stateRevision = channelStateRevisionRef.current;
    setChannelsLoading(true);
    try {
      const incoming = await apiClient.get<WorkspaceChannel[]>(`/workspaces/${activeWorkspaceId}/channels`);
      if (!isCurrentWorkspaceChannelLoad({
        requestId,
        latestRequestId: channelRequestRef.current,
        requestWorkspaceId: activeWorkspaceId,
        activeWorkspaceId: workspaceRef.current,
        stateRevision,
        currentStateRevision: channelStateRevisionRef.current,
      })) {
        if (
          requestId === channelRequestRef.current
          && workspaceRef.current === activeWorkspaceId
          && stateRevision !== channelStateRevisionRef.current
        ) {
          void loadChannelsRef.current?.();
        }
        return;
      }
      setChannels(sortWorkspaceChannels(incoming));
      setSelectedChannelId((existing) => {
        if (routeChannelId && incoming.some((channel) => channel.id === routeChannelId)) return routeChannelId;
        return incoming.some((channel) => channel.id === existing) ? existing : incoming[0]?.id ?? null;
      });
      if (routeChannelId && incoming.some((channel) => channel.id === routeChannelId)) {
        setMobileConversationView("messages");
      }
      setError(null);
    } catch (err) {
      const isCurrentRequest = requestId === channelRequestRef.current && workspaceRef.current === activeWorkspaceId;
      if (isCurrentRequest && stateRevision !== channelStateRevisionRef.current) {
        void loadChannelsRef.current?.();
        return;
      }
      if (isCurrentRequest) {
        logClientError("Failed to load workspace conversations", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels` });
        setError("Unable to load conversations. Check your connection and try again.");
      }
    } finally {
      if (requestId === channelRequestRef.current && workspaceRef.current === activeWorkspaceId) setChannelsLoading(false);
    }
  }, [activeWorkspaceId, routeChannelId]);

  loadChannelsRef.current = loadChannels;

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
        if (append) {
          setMessages((current) => mergeMessagePage(current, page.records));
        } else {
          setMessages(page.records);
        }
        nextMessageOffsetRef.current = page.hasMore ? offset + MESSAGE_PAGE_SIZE : null;
        setHasOlderMessages(page.hasMore);
        setError(null);
      }
    } catch (err) {
      if (requestId === messageRequestRef.current) {
        logClientError("Failed to load discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        setError("Unable to load discussion. Check your connection and try again.");
      }
    } finally {
      if (requestId === messageRequestRef.current) {
        if (append) setLoadingOlderMessages(false);
        else setMessagesLoading(false);
      }
    }
  }, [activeWorkspaceId]);

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
        if (append) {
          setThreadMessages((current) => mergeMessagePage(current, page.records));
        } else {
          setThreadMessages(mergeMessagePage([], [returnedRoot, ...page.records]));
        }
        nextThreadOffsetRef.current = page.hasMore ? offset + MESSAGE_PAGE_SIZE : null;
        setHasNewerThreadReplies(page.hasMore);
      }
    } catch (err) {
      if (requestId === threadRequestRef.current) {
        logClientError("Failed to open thread", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        setError("Unable to open thread. Check your connection and try again.");
      }
    } finally {
      if (requestId === threadRequestRef.current) {
        if (append) setLoadingNewerThreadReplies(false);
        else setThreadLoading(false);
      }
    }
  }, [activeWorkspaceId]);

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

  const applyChannelMessageSummary = useCallback((message: WorkspaceChannelMessage) => {
    if (!message.workspace_id || message.workspace_id !== workspaceRef.current) return;
    channelStateRevisionRef.current += 1;
    setChannels((current) => mergeWorkspaceChannelMessage(current, message));
  }, []);

  const applyThreadReplyCount = useCallback((message: WorkspaceChannelMessage) => {
    if (
      !message.parent_message_id
      || message.workspace_id !== workspaceRef.current
      || message.channel_id !== selectedChannelRef.current
      || countedThreadReplyIdsRef.current.has(message.id)
    ) return;
    countedThreadReplyIdsRef.current.add(message.id);
    setMessages((current) => incrementThreadReplyCount(current, message));
  }, []);

  const applyChannelRealtimeChange = useCallback((payload: WorkspaceChannelRealtimeChange) => {
    if (!isCurrentWorkspaceChannelChange(payload, activeWorkspaceId, workspaceRef.current)) return;

    channelStateRevisionRef.current += 1;
    setChannels((current) => reconcileWorkspaceChannelChange(current, payload));
    if (payload.eventType === "DELETE" || payload.new?.is_archived) {
      void loadChannels();
    }
  }, [activeWorkspaceId, loadChannels]);

  const sender = useWorkspaceConversationSender({
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
    onChannelMessageCreated: applyChannelMessageSummary,
    onThreadReplyCreated: applyThreadReplyCount,
    selectedChannelId,
    sendTypingSignal,
    setError,
    setMessages,
    setThreadMessages,
  });

  useEffect(() => {
    setSelectedChannelId(null);
    setMessages([]);
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    nextMessageOffsetRef.current = null;
    countedThreadReplyIdsRef.current.clear();
    threadRootRef.current = null;
    setThreadRoot(null);
    setThreadMessages([]);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setTaskSource(null);
    setTaskConfirmation(null);
    setDecisionSource(null);
    setDecisionConfirmation(null);
    setMobileConversationView("channels");
    void loadChannels();
  }, [activeWorkspaceId, loadChannels]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe({ type: "channels", workspaceId: activeWorkspaceId }, (channel) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "workspace_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, applyChannelRealtimeChange),
    );
    return () => realtimeRegistry.unsubscribe({ type: "channels", workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, applyChannelRealtimeChange, session?.user.id]);

  useEffect(() => {
    threadRootRef.current = null;
    setThreadRoot(null);
    setThreadMessages([]);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setHasOlderMessages(false);
    setLoadingOlderMessages(false);
    nextMessageOffsetRef.current = null;
    countedThreadReplyIdsRef.current.clear();
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedChannelId);
  }, [loadMessages, selectedChannelId]);

  useEffect(() => {
    if (!activeWorkspaceId || !selectedChannelId || !session?.user.id) return;
    realtimeRegistry.subscribe({ type: "channel_messages", workspaceId: activeWorkspaceId, conversationId: selectedChannelId }, (channel) =>
      channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "workspace_channel_messages", filter: `channel_id=eq.${selectedChannelId}` }, (payload: { new: WorkspaceChannelMessage }) => {
        const incoming = payload.new;
        if (incoming.parent_message_id) {
          if (threadRootRef.current?.id === incoming.parent_message_id) {
            setThreadMessages((current) => mergeMessage(current, incoming));
          }
          applyThreadReplyCount(incoming);
          return;
        }
        setMessages((current) => mergeMessage(current, incoming));
      }),
    );
    return () => realtimeRegistry.unsubscribe({ type: "channel_messages", workspaceId: activeWorkspaceId, conversationId: selectedChannelId });
  }, [activeWorkspaceId, applyThreadReplyCount, selectedChannelId, session?.user.id]);

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
    try {
      setCreatingChannel(true);
      const created = await apiClient.post<WorkspaceChannel>(`/workspaces/${activeWorkspaceId}/channels`, {
        name: channelName.trim(),
        purpose: channelPurpose.trim() || null,
        channel_type: "operational",
        visibility: "workspace",
        posting_policy: "members",
      });
      if (workspaceRef.current !== activeWorkspaceId) return;
      channelStateRevisionRef.current += 1;
      setChannels((current) => reconcileWorkspaceChannelChange(current, { eventType: "INSERT", new: created }));
      setSelectedChannelId(created.id);
      setMobileConversationView("messages");
      setChannelName("");
      setChannelPurpose("");
      setCreateOpen(false);
    } catch (err) {
      logClientError("Failed to create operational channel", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels` });
      setError("Unable to create operational channel. Your session may have expired; refresh and try again.");
    } finally {
      setCreatingChannel(false);
    }
  }

  function handleSelectChannel(channelId: string) {
    setSelectedChannelId(channelId);
    setMobileConversationView("messages");
  }

  function handleBackToChannels() {
    closeThread();
    setMobileConversationView("channels");
  }

  function closeThread() {
    threadRootRef.current = null;
    setThreadRoot(null);
    setThreadMessages([]);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
  }

  function openThread(message: WorkspaceChannelMessage) {
    if (!selectedChannelId) return;
    threadRootRef.current = message;
    setThreadRoot(message);
    setThreadMessages([]);
    setHasNewerThreadReplies(false);
    setLoadingNewerThreadReplies(false);
    nextThreadOffsetRef.current = null;
    setMobileConversationView("messages");
    sender.setThreadDraft("");
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
      <WorkspaceConversationChrome activeCount={presence?.active_count ?? 0} channelsLoading={channelsLoading} decisionConfirmation={decisionConfirmation} error={error} onDismissDecision={() => setDecisionConfirmation(null)} onDismissError={() => setError(null)} onDismissTask={() => setTaskConfirmation(null)} onRetryConversations={() => void loadChannels()} realtimeStatus={realtimeStatus} taskConfirmation={taskConfirmation} workspaceName={activeWorkspace?.name} />

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
          <MessageThread activeMembers={activeMembers} aiPanel={<ConversationAIPanel activeWorkspaceId={activeWorkspaceId} messagesCount={messages.length} onError={setError} onOpenDecision={setDecisionSource} onOpenTask={setTaskSource} selectedChannelId={selectedChannelId} threadRoot={threadRoot} />} channelTyping={channelTyping} draft={sender.draft} draftMentions={sender.draftMentions} hasOlderMessages={hasOlderMessages} loadingOlderMessages={loadingOlderMessages} mayPost={mayPost} messages={messages} messagesLoading={messagesLoading} onDraftChange={sender.setDraft} onDraftMentionsChange={sender.setDraftMentions} onLoadOlderMessages={loadOlderMessages} onOpenDecision={(message) => setDecisionSource({ kind: "message", message })} onOpenTask={(message) => setTaskSource({ kind: "message", message })} onOpenThread={openThread} onSend={(content, parent, mentions) => void sender.sendMessage(content, parent, mentions)} onTypingChange={(isTyping) => void sendTypingSignal(selectedChannelId, isTyping)} selectedChannel={selectedChannel} sending={sender.sending} />
        </div>
        <div className="omnix-conversation-thread min-h-0 min-w-0">
          <ThreadPanel activeMembers={activeMembers} hasNewerThreadReplies={hasNewerThreadReplies} loadingNewerThreadReplies={loadingNewerThreadReplies} mayPost={mayPost} onClose={closeThread} onLoadNewerReplies={loadNewerThreadReplies} onOpenDecision={(message) => setDecisionSource({ kind: "message", message })} onOpenTask={(message) => setTaskSource({ kind: "message", message })} onSend={(content, parent, mentions) => void sender.sendMessage(content, parent, mentions)} onThreadDraftChange={sender.setThreadDraft} onThreadDraftMentionsChange={sender.setThreadDraftMentions} onTypingChange={(isTyping) => void sendTypingSignal(selectedChannelId, isTyping)} threadDraft={sender.threadDraft} threadDraftMentions={sender.threadDraftMentions} threadLoading={threadLoading} threadMessages={threadMessages} threadRoot={threadRoot} threadSending={sender.threadSending} />
        </div>
      </div>
      <TaskFromMessageModal activeMembers={activeMembers} activeWorkspaceId={activeWorkspaceId} onClose={() => setTaskSource(null)} onCreated={setTaskConfirmation} onError={setError} selectedChannelId={selectedChannelId} source={taskSource} threadRoot={threadRoot} />
      <DecisionFromMessageModal activeMembers={activeMembers} activeWorkspaceId={activeWorkspaceId} onClose={() => setDecisionSource(null)} onCreated={setDecisionConfirmation} onError={setError} selectedChannelId={selectedChannelId} source={decisionSource} />
    </section>
  );
}
