"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CircleDot,
  ClipboardCheck,
  CornerDownRight,
  FileText,
  Loader2,
  MessagesSquare,
  Plus,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { Portal } from "@/components/ui/Portal";
import { MentionText } from "@/components/mentions/MentionText";
import { MentionTextarea, mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { ambientConversationIdentity } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";
import type {
  WorkspaceActivityEvent,
  WorkspaceChannel,
  WorkspaceChannelMessage,
  WorkspaceConversationAssistance,
  WorkspaceConversationAssistanceMode,
  WorkspaceDecision,
  WorkspaceDecisionStatus,
  WorkspaceMentionMetadata,
  WorkspaceTask,
} from "@/lib/workspace-types";

type DisplayMessage = WorkspaceChannelMessage & {
  delivery?: "sending" | "failed";
};

type TaskSource =
  | { kind: "message"; message: WorkspaceChannelMessage }
  | { kind: "assistance"; assistance: WorkspaceConversationAssistance };

type DecisionSource = {
  message: WorkspaceChannelMessage;
};

const assistanceLabels: Record<WorkspaceConversationAssistanceMode, string> = {
  summary: "Summarize",
  decisions: "Decisions",
  actions: "Actions",
  blockers: "Blockers",
};

const decisionStatusLabels: Record<WorkspaceDecisionStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
};

function chronological(messages: DisplayMessage[]) {
  return [...messages].sort(
    (a, b) => Date.parse(a.created_at || "") - Date.parse(b.created_at || ""),
  );
}

function mergeMessage(current: DisplayMessage[], incoming: WorkspaceChannelMessage) {
  const filtered = current.filter(
    (message) =>
      message.id !== incoming.id &&
      !(incoming.client_nonce && message.client_nonce === incoming.client_nonce),
  );
  return chronological([...filtered, incoming]);
}

function messageAuthor(message: WorkspaceChannelMessage) {
  return message.author_name || message.author_email || "Teammate";
}

function messageIdentity(message: WorkspaceChannelMessage) {
  return message.author_identity?.display_label || null;
}

function readableTime(value?: string | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function canCreateOperationalChannel(role?: string | null) {
  return ["founder", "owner", "co_owner", "super_founder", "sub_leader", "team_lead"].includes(role || "");
}

export function WorkspaceConversationSurface() {
  const { session } = useAuth();
  const { activeMembers, activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { activity, presence, realtimeStatus, sendTypingSignal, typingUsers } = useWorkspaceCollaboration();
  const searchParams = useSearchParams();
  const routeChannelId = searchParams?.get("channel") ?? null;
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadRoot, setThreadRoot] = useState<WorkspaceChannelMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
  const [draftMentions, setDraftMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [threadDraftMentions, setThreadDraftMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [threadSending, setThreadSending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [channelName, setChannelName] = useState("");
  const [channelPurpose, setChannelPurpose] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);
  const [assistance, setAssistance] = useState<WorkspaceConversationAssistance | null>(null);
  const [assistanceLoading, setAssistanceLoading] = useState<WorkspaceConversationAssistanceMode | null>(null);
  const [taskSource, setTaskSource] = useState<TaskSource | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskMentions, setTaskMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskConfirmation, setTaskConfirmation] = useState<string | null>(null);
  const [decisionSource, setDecisionSource] = useState<DecisionSource | null>(null);
  const [decisionTitle, setDecisionTitle] = useState("");
  const [decisionDescription, setDecisionDescription] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [decisionMentions, setDecisionMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [decisionStatus, setDecisionStatus] = useState<WorkspaceDecisionStatus>("accepted");
  const [creatingDecision, setCreatingDecision] = useState(false);
  const [decisionConfirmation, setDecisionConfirmation] = useState<string | null>(null);
  const workspaceRef = useRef(activeWorkspaceId);
  const selectedChannelRef = useRef(selectedChannelId);
  const channelRequestRef = useRef(0);
  const messageRequestRef = useRef(0);
  const threadRequestRef = useRef(0);
  const threadRootRef = useRef(threadRoot);
  const lastIdentityActivityRef = useRef<string | null>(null);

  workspaceRef.current = activeWorkspaceId;
  selectedChannelRef.current = selectedChannelId;
  threadRootRef.current = threadRoot;
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const currentUserId = session?.user.id ?? "";
  const currentMember = activeMembers.find((member) => member.user_id === currentUserId);
  const inheritedIdentityWorkspaceId =
    activeWorkspace?.is_global && activeWorkspace.parent_workspace_id
      ? activeWorkspace.parent_workspace_id
      : null;
  const mayCreateChannel = canCreateOperationalChannel(activeWorkspace?.current_user_role);
  const mayPost = Boolean(
    selectedChannel &&
      (selectedChannel.posting_policy === "members" || mayCreateChannel),
  );

  const loadChannels = useCallback(async () => {
    if (!activeWorkspaceId) {
      setChannels([]);
      setChannelsLoading(false);
      return;
    }
    const requestId = ++channelRequestRef.current;
    setChannelsLoading(true);
    try {
      const incoming = await apiClient.get<WorkspaceChannel[]>(`/workspaces/${activeWorkspaceId}/channels`);
      if (requestId !== channelRequestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      setChannels(incoming);
      setSelectedChannelId((existing) => {
        if (routeChannelId && incoming.some((channel) => channel.id === routeChannelId)) {
          return routeChannelId;
        }
        return incoming.some((channel) => channel.id === existing) ? existing : incoming[0]?.id ?? null;
      });
      setError(null);
    } catch (err) {
      if (requestId === channelRequestRef.current) {
        logClientError("Failed to load workspace conversations", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels` });
        setError("Unable to load conversations.");
      }
    } finally {
      if (requestId === channelRequestRef.current) setChannelsLoading(false);
    }
  }, [activeWorkspaceId, routeChannelId]);

  const loadMessages = useCallback(async (channelId: string) => {
    if (!activeWorkspaceId) return;
    const requestId = ++messageRequestRef.current;
    setMessagesLoading(true);
    try {
      const incoming = await apiClient.get<WorkspaceChannelMessage[]>(
        `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages?limit=80`,
      );
      if (
        requestId === messageRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId
      ) {
        setMessages(incoming);
        setError(null);
      }
    } catch (err) {
      if (requestId === messageRequestRef.current) {
        logClientError("Failed to load discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        setError("Unable to load discussion.");
      }
    } finally {
      if (requestId === messageRequestRef.current) setMessagesLoading(false);
    }
  }, [activeWorkspaceId]);

  const loadThread = useCallback(async (channelId: string, root: WorkspaceChannelMessage) => {
    if (!activeWorkspaceId) return;
    const requestId = ++threadRequestRef.current;
    setThreadLoading(true);
    try {
      const incoming = await apiClient.get<WorkspaceChannelMessage[]>(
        `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages?thread_root_id=${root.id}&limit=80`,
      );
      if (
        requestId === threadRequestRef.current &&
        workspaceRef.current === activeWorkspaceId &&
        selectedChannelRef.current === channelId
      ) {
        setThreadMessages(incoming);
      }
    } catch (err) {
      if (requestId === threadRequestRef.current) {
        logClientError("Failed to open thread", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${channelId}/messages` });
        setError("Unable to open thread.");
      }
    } finally {
      if (requestId === threadRequestRef.current) setThreadLoading(false);
    }
  }, [activeWorkspaceId]);

  const refreshVisibleMessageIdentities = useCallback(() => {
    const channelId = selectedChannelRef.current;
    if (!channelId) return;
    void loadMessages(channelId);
    const openThread = threadRootRef.current;
    if (openThread) {
      void loadThread(channelId, openThread);
    }
  }, [loadMessages, loadThread]);

  useEffect(() => {
    setSelectedChannelId(null);
    setMessages([]);
    setThreadRoot(null);
    setThreadMessages([]);
    setAssistance(null);
    setTaskSource(null);
    setTaskConfirmation(null);
    setDecisionSource(null);
    setDecisionConfirmation(null);
    void loadChannels();
  }, [activeWorkspaceId, loadChannels]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      { type: "channels", workspaceId: activeWorkspaceId },
      (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_channels",
            filter: `workspace_id=eq.${activeWorkspaceId}`,
          },
          () => void loadChannels(),
        ),
    );
    return () => realtimeRegistry.unsubscribe({ type: "channels", workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, loadChannels, session?.user.id]);

  useEffect(() => {
    setThreadRoot(null);
    setThreadMessages([]);
    setAssistance(null);
    if (!selectedChannelId) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedChannelId);
  }, [loadMessages, selectedChannelId]);

  useEffect(() => {
    if (!activeWorkspaceId || !selectedChannelId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      { type: "channel_messages", workspaceId: activeWorkspaceId, conversationId: selectedChannelId },
      (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "workspace_channel_messages",
            filter: `channel_id=eq.${selectedChannelId}`,
          },
          (payload: { new: WorkspaceChannelMessage }) => {
            const incoming = payload.new;
            if (incoming.parent_message_id) {
              if (threadRoot?.id === incoming.parent_message_id) {
                void loadThread(selectedChannelId, threadRoot);
              }
              setMessages((current) =>
                current.map((message) =>
                  message.id === incoming.parent_message_id
                    ? { ...message, thread_reply_count: message.thread_reply_count + 1 }
                    : message,
                ),
              );
              return;
            }
            void loadMessages(selectedChannelId);
          },
        ),
    );
    return () =>
      realtimeRegistry.unsubscribe({
        type: "channel_messages",
        workspaceId: activeWorkspaceId,
        conversationId: selectedChannelId,
      });
  }, [activeWorkspaceId, loadMessages, loadThread, selectedChannelId, session?.user.id, threadRoot]);

  useEffect(() => {
    const identityEvent = activity.find((event) => event.event_type === "workspace.member_role_updated");
    if (!identityEvent || identityEvent.id === lastIdentityActivityRef.current) return;
    lastIdentityActivityRef.current = identityEvent.id;
    refreshVisibleMessageIdentities();
  }, [activity, refreshVisibleMessageIdentities]);

  useEffect(() => {
    if (!activeWorkspaceId || !inheritedIdentityWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      {
        type: "conversation_identity",
        workspaceId: inheritedIdentityWorkspaceId,
        conversationId: activeWorkspaceId,
      },
      (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "workspace_activity_events",
            filter: `workspace_id=eq.${inheritedIdentityWorkspaceId}`,
          },
          (payload: { new: WorkspaceActivityEvent }) => {
            if (payload.new.event_type === "workspace.member_role_updated") {
              refreshVisibleMessageIdentities();
            }
          },
        ),
    );
    return () =>
      realtimeRegistry.unsubscribe({
        type: "conversation_identity",
        workspaceId: inheritedIdentityWorkspaceId,
        conversationId: activeWorkspaceId,
      });
  }, [activeWorkspaceId, inheritedIdentityWorkspaceId, refreshVisibleMessageIdentities, session?.user.id]);

  const channelTyping = useMemo(
    () =>
      Object.values(typingUsers).filter(
        (typing) => typing.userId !== currentUserId && typing.conversationId === selectedChannelId,
      ),
    [currentUserId, selectedChannelId, typingUsers],
  );

  function optimisticMessage(
    content: string,
    nonce: string,
    parentMessageId?: string,
    mentions: WorkspaceMentionMetadata[] = [],
  ) {
    return {
      id: `pending-${nonce}`,
      workspace_id: activeWorkspaceId || "",
      channel_id: selectedChannelId || "",
      author_user_id: currentUserId,
      parent_message_id: parentMessageId || null,
      content,
      context_links: [],
      metadata: mentions.length ? { mentions } : {},
      mentions,
      client_nonce: nonce,
      created_at: new Date().toISOString(),
      author_name: session?.user.user_metadata?.full_name || session?.user.email || "You",
      author_avatar_label: (session?.user.email || "Y")[0].toUpperCase(),
      author_identity: ambientConversationIdentity(
        currentMember?.role || activeWorkspace?.current_user_role,
        currentMember?.operational_label,
      ),
      thread_reply_count: 0,
      delivery: "sending" as const,
    };
  }

  async function sendMessage(content: string, parentMessageId?: string, mentions: WorkspaceMentionMetadata[] = []) {
    if (!activeWorkspaceId || !selectedChannelId || !mayPost || !content.trim()) return;
    const cleaned = content.trim();
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const optimistic = optimisticMessage(cleaned, nonce, parentMessageId, mentions);
    const inThread = Boolean(parentMessageId);
    if (inThread) setThreadMessages((current) => chronological([...current, optimistic]));
    else setMessages((current) => chronological([...current, optimistic]));
    if (inThread) setThreadSending(true);
    else setSending(true);
    try {
      const created = await apiClient.post<WorkspaceChannelMessage>(
        `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/messages`,
        {
          content: cleaned,
          parent_message_id: parentMessageId || null,
          client_nonce: nonce,
          context_links: [],
          mentions: mentionPayload(mentions, cleaned),
        },
      );
      if (inThread) {
        setThreadMessages((current) => mergeMessage(current, created));
        setThreadDraft("");
        setThreadDraftMentions([]);
        void loadMessages(selectedChannelId);
      } else {
        setMessages((current) => mergeMessage(current, created));
        setDraft("");
        setDraftMentions([]);
      }
      await sendTypingSignal(selectedChannelId, false);
      void loadChannels();
    } catch (err) {
      const markFailed = (current: DisplayMessage[]): DisplayMessage[] =>
        current.map((message) => (message.client_nonce === nonce ? { ...message, delivery: "failed" as const } : message));
      if (inThread) setThreadMessages(markFailed);
      else setMessages(markFailed);
      logClientError("Failed to deliver message", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/messages` });
      setError("Unable to deliver message.");
    } finally {
      if (inThread) setThreadSending(false);
      else setSending(false);
    }
  }

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
      setChannels((current) => [...current.filter((channel) => channel.id !== created.id), created]);
      setSelectedChannelId(created.id);
      setChannelName("");
      setChannelPurpose("");
      setCreateOpen(false);
    } catch (err) {
      logClientError("Failed to create operational channel", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels` });
      setError("Unable to create operational channel.");
    } finally {
      setCreatingChannel(false);
    }
  }

  async function requestAssistance(mode: WorkspaceConversationAssistanceMode) {
    if (!activeWorkspaceId || !selectedChannelId) return;
    try {
      setAssistanceLoading(mode);
      setAssistance(
        await apiClient.post<WorkspaceConversationAssistance>(
          `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/assist`,
          { mode, thread_root_id: threadRoot?.id ?? null },
        ),
      );
    } catch (err) {
      logClientError("Failed to load conversation assistance", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/assist` });
      setError("Conversation assistance is unavailable.");
    } finally {
      setAssistanceLoading(null);
    }
  }

  function openThread(message: WorkspaceChannelMessage) {
    if (!selectedChannelId) return;
    setThreadRoot(message);
    setThreadDraft("");
    setThreadDraftMentions([]);
    void loadThread(selectedChannelId, message);
  }

  function openMessageTask(message: WorkspaceChannelMessage) {
    const title = message.content.replace(/\s+/g, " ").trim();
    setTaskSource({ kind: "message", message });
    setTaskTitle(title.length > 110 ? `${title.slice(0, 107).trim()}...` : title);
    setTaskDescription(message.content);
    setTaskMentions(message.mentions || []);
  }

  function openMessageDecision(message: WorkspaceChannelMessage) {
    const title = message.content.replace(/\s+/g, " ").trim();
    setDecisionSource({ message });
    setDecisionTitle(title.length > 110 ? `${title.slice(0, 107).trim()}...` : title);
    setDecisionDescription(message.content);
    setDecisionReason("");
    setDecisionMentions(message.mentions || []);
    setDecisionStatus("accepted");
  }

  function openAssistanceTask(result: WorkspaceConversationAssistance) {
    setTaskSource({ kind: "assistance", assistance: result });
    setTaskTitle("");
    setTaskDescription(result.content);
    setTaskMentions([]);
  }

  async function createTaskFromContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !selectedChannelId || !taskSource || !taskTitle.trim()) return;
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      setCreatingTask(true);
      let created: WorkspaceTask;
      if (taskSource.kind === "message") {
        created = await apiClient.post<WorkspaceTask>(
          `/workspaces/${activeWorkspaceId}/tasks/from-message/${selectedChannelId}/${taskSource.message.id}`,
          {
            title: taskTitle.trim(),
            description: taskDescription.trim() || null,
            status: "idea",
            client_nonce: nonce,
            mentions: mentionPayload(taskMentions, taskDescription),
          },
        );
      } else {
        created = await apiClient.post<WorkspaceTask>(
          `/workspaces/${activeWorkspaceId}/tasks/from-assistance/${selectedChannelId}`,
          {
            title: taskTitle.trim(),
            description: taskDescription.trim() || null,
            assistance_text: taskSource.assistance.content,
            thread_root_id: threadRoot?.id ?? null,
            status: "idea",
            client_nonce: nonce,
            mentions: mentionPayload(taskMentions, taskDescription),
          },
        );
      }
      setTaskConfirmation(`Task opened: ${created.title}`);
      setTaskSource(null);
      setTaskTitle("");
      setTaskDescription("");
      setTaskMentions([]);
    } catch (err) {
      logClientError("Failed to open task from discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks` });
      setError("Unable to open task from discussion.");
    } finally {
      setCreatingTask(false);
    }
  }

  async function createDecisionFromContext(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !selectedChannelId || !decisionSource || !decisionTitle.trim()) return;
    try {
      setCreatingDecision(true);
      const created = await apiClient.post<WorkspaceDecision>(
        `/workspaces/${activeWorkspaceId}/decisions/from-message/${selectedChannelId}/${decisionSource.message.id}`,
        {
          title: decisionTitle.trim(),
          description: decisionDescription.trim() || null,
          decision_reason: decisionReason.trim() || null,
          status: decisionStatus,
          mentions: mentionPayload(decisionMentions, `${decisionReason}\n${decisionDescription}`),
        },
      );
      setDecisionConfirmation(`Decision recorded: ${created.title}`);
      setDecisionSource(null);
      setDecisionTitle("");
      setDecisionDescription("");
      setDecisionReason("");
      setDecisionMentions([]);
      setDecisionStatus("accepted");
    } catch (err) {
      logClientError("Failed to record decision from discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions` });
      setError("Unable to record decision from discussion.");
    } finally {
      setCreatingDecision(false);
    }
  }

  function MessageRow({ message, threaded = false }: { message: DisplayMessage; threaded?: boolean }) {
    const identity = messageIdentity(message);
    return (
      <article
        className={cn(
          "group rounded-xl border border-transparent px-3 py-3 transition hover:border-[var(--omnix-border)] hover:bg-[rgba(0,255,255,0.025)]",
          message.delivery === "failed" && "border-rose-400/20",
        )}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-300/7 text-[11px] font-semibold text-cyan-100">
            {message.author_avatar_label || "U"}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-sm font-semibold text-white">{messageAuthor(message)}</span>
              {identity ? (
                <span className="max-w-full break-words text-[11px] font-medium tracking-[0.01em] text-cyan-100/48">
                  {identity}
                </span>
              ) : null}
              <time className="text-[11px] text-[var(--omnix-text-3)]">{readableTime(message.created_at)}</time>
              {message.delivery === "sending" ? <span className="text-[10px] text-cyan-200/60">sending</span> : null}
              {message.delivery === "failed" ? <span className="text-[10px] text-rose-200">delivery failed</span> : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--omnix-text)]">
              <MentionText content={message.content} mentions={message.mentions} />
            </p>
            {message.context_links.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {message.context_links.map((link) => (
                  <span key={`${link.entity_type}-${link.entity_id}`} className="inline-flex items-center gap-1 rounded-md border border-cyan-300/15 bg-cyan-300/5 px-2 py-1 text-[10px] text-cyan-100">
                    <FileText className="h-3 w-3" />
                    {link.label || link.entity_type}
                  </span>
                ))}
              </div>
            ) : null}
            {message.delivery !== "sending" ? (
              <div className="mt-2 flex flex-wrap items-center gap-3">
                {!threaded ? (
                  <button
                    type="button"
                    onClick={() => openThread(message)}
                    className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100 md:min-h-0 md:px-0"
                  >
                    <CornerDownRight className="h-3.5 w-3.5" />
                    {message.thread_reply_count ? `${message.thread_reply_count} thread replies` : "Open thread"}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => openMessageTask(message)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100 md:min-h-0 md:px-0"
                >
                  <ClipboardCheck className="h-3.5 w-3.5" />
                  Track as task
                </button>
                <button
                  type="button"
                  onClick={() => openMessageDecision(message)}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-1 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100 md:min-h-0 md:px-0"
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Convert to Decision
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </article>
    );
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to enter operational conversations.</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <MessagesSquare className="h-3.5 w-3.5" />
            Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Workspace Conversations</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            {activeWorkspace?.name} operational discussion, decisions, and coordination.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active
          <span className="text-[var(--omnix-text-3)]">/</span>
          {realtimeStatus === "connected" ? "connected" : "recovering"}
        </div>
      </header>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-3"
          title={error === "Unable to load conversations." ? "Conversations are unavailable" : "Conversation action needs attention"}
          message={error}
          onRetry={error === "Unable to load conversations." ? () => void loadChannels() : undefined}
          isRetrying={channelsLoading}
          onDismiss={() => setError(null)}
        />
      ) : null}
      {taskConfirmation ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-emerald-300/18 bg-emerald-300/[0.06] px-3 py-2 text-xs text-emerald-100">
          <span>{taskConfirmation}. Source context is preserved.</span>
          <button type="button" onClick={() => setTaskConfirmation(null)} aria-label="Dismiss confirmation"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}
      {decisionConfirmation ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-cyan-300/18 bg-cyan-300/[0.06] px-3 py-2 text-xs text-cyan-100">
          <span>{decisionConfirmation}. Source message and channel are preserved.</span>
          <button type="button" onClick={() => setDecisionConfirmation(null)} aria-label="Dismiss decision confirmation"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

      <div className={cn("grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-rows-1", threadRoot ? "lg:grid-cols-[15.5rem_minmax(0,1fr)_22rem]" : "lg:grid-cols-[15.5rem_minmax(0,1fr)]")}>
        <aside className="omnix-panel flex shrink-0 flex-col rounded-xl p-3 lg:min-h-0">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Channels</p>
            {mayCreateChannel ? (
              <button type="button" onClick={() => setCreateOpen((open) => !open)} className="rounded-md p-1 text-cyan-100/70 hover:bg-cyan-300/10 hover:text-cyan-100" aria-label="Create channel">
                <Plus className="h-4 w-4" />
              </button>
            ) : null}
          </div>
          {createOpen ? (
            <form onSubmit={handleCreateChannel} className="mb-3 space-y-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-2.5">
              <Input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="backend" className="h-9 text-sm" autoFocus />
              <textarea value={channelPurpose} onChange={(event) => setChannelPurpose(event.target.value)} placeholder="Operational purpose" className="omnix-input h-16 w-full resize-none rounded-lg p-2 text-xs" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={!channelName.trim()} isLoading={creatingChannel} className="h-8 flex-1 text-xs">Open</Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCreateOpen(false)}>Cancel</Button>
              </div>
            </form>
          ) : null}
          <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-1 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
            {channelsLoading ? <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-cyan-100/60" /> : null}
            {channels.map((channel) => (
              <button
                type="button"
                key={channel.id}
                onClick={() => setSelectedChannelId(channel.id)}
                className={cn(
                  "w-[min(12rem,76vw)] shrink-0 rounded-lg border px-3 py-2.5 text-left transition lg:w-full",
                  selectedChannelId === channel.id
                    ? "border-cyan-300/25 bg-cyan-300/[0.08]"
                    : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                  <span className="truncate">{channel.name}</span>
                  {channel.channel_type === "announcement" ? <span className="rounded border border-amber-300/20 px-1 py-0.5 text-[9px] uppercase text-amber-100">brief</span> : null}
                </span>
                <span className="mt-1 block truncate text-[11px] text-[var(--omnix-text-3)]">
                  {channel.last_message_preview || channel.purpose || "Ready for coordination"}
                </span>
              </button>
            ))}
          </div>
          <p className="mt-3 hidden border-t border-[var(--omnix-border)] px-1 pt-3 text-[11px] leading-5 text-[var(--omnix-text-3)] lg:block">
            Messages stay scoped to this workspace. Attention signals remain intentionally quiet.
          </p>
        </aside>

        <main className={cn("omnix-panel min-h-0 min-w-0 flex-col overflow-hidden rounded-xl lg:flex lg:min-h-[26rem]", threadRoot ? "hidden" : "flex")}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--omnix-border)] px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-white">{selectedChannel?.name || "Conversation"}</h2>
              <p className="mt-0.5 text-xs text-[var(--omnix-text-2)]">{selectedChannel?.purpose || "Workspace operational discussion."}</p>
            </div>
            {selectedChannel ? (
              <div className="flex flex-wrap gap-1">
                {Object.entries(assistanceLabels).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => void requestAssistance(mode as WorkspaceConversationAssistanceMode)}
                    disabled={Boolean(assistanceLoading) || messages.length === 0}
                    className="inline-flex items-center gap-1 rounded-md border border-cyan-300/12 bg-cyan-300/[0.04] px-2 py-1.5 text-[11px] text-cyan-100/80 transition hover:bg-cyan-300/10 disabled:opacity-40"
                  >
                    {assistanceLoading === mode ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {assistance ? (
            <div className="mx-4 mt-3 rounded-xl border border-purple-300/15 bg-purple-300/[0.045] px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100/80">
                  <Sparkles className="h-3.5 w-3.5" /> Ambient assistance / {assistance.mode}
                </p>
                <button type="button" onClick={() => setAssistance(null)} className="text-white/30 hover:text-white"><X className="h-3.5 w-3.5" /></button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] text-[var(--omnix-text-3)]">Derived from {assistance.source_message_count} discussion messages. Not posted into the channel.</p>
                {assistance.mode === "actions" ? (
                  <button
                    type="button"
                    onClick={() => openAssistanceTask(assistance)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-purple-300/15 px-2 py-1 text-[11px] text-purple-100/85 transition hover:bg-purple-300/[0.08]"
                  >
                    <ClipboardCheck className="h-3.5 w-3.5" /> Convert selected action
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto px-2 py-3 sm:px-3">
            {messagesLoading ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!messagesLoading && messages.length === 0 ? (
              <div className="mx-auto mt-14 max-w-sm text-center">
                <MessagesSquare className="mx-auto h-7 w-7 text-cyan-100/35" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No operational discussion yet.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Capture coordination, context, and decisions when work begins.</p>
              </div>
            ) : null}
            {messages.map((message) => <MessageRow key={message.id} message={message} />)}
          </div>
          {channelTyping.length ? (
            <p className="px-5 pb-2 text-[11px] text-cyan-100/55">
              {channelTyping.length === 1 ? `${channelTyping[0].fullName} is drafting an update` : `${channelTyping.length} teammates are drafting updates`}
            </p>
          ) : null}
          <form
            className="border-t border-[var(--omnix-border)] p-3 sm:p-4"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(draft, undefined, draftMentions);
            }}
          >
            <MentionTextarea
              value={draft}
              onChange={(nextValue) => {
                setDraft(nextValue);
                void sendTypingSignal(selectedChannelId, Boolean(nextValue.trim()));
              }}
              members={activeMembers}
              mentions={draftMentions}
              onMentionsChange={setDraftMentions}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendMessage(draft, undefined, draftMentions);
                }
              }}
              placeholder={
                !selectedChannel
                  ? "Select a channel"
                  : mayPost
                    ? "Write an operational update..."
                    : "Updates in this channel are published by workspace leads."
              }
              disabled={!mayPost || sending}
              className="omnix-input min-h-[72px] w-full resize-none rounded-xl px-3 py-2.5 text-sm leading-6"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="text-[10px] text-[var(--omnix-text-3)]">Context links for tasks, decisions, files, and initiatives are structurally ready.</p>
              <Button type="submit" size="sm" disabled={!draft.trim() || !mayPost || sending} leftIcon={<SendHorizontal className="h-3.5 w-3.5" />}>
                Send
              </Button>
            </div>
          </form>
        </main>

        {threadRoot ? (
          <aside className="omnix-panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl lg:min-h-[22rem]">
            <div className="flex items-center justify-between border-b border-[var(--omnix-border)] px-4 py-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Operational thread</p>
                <p className="mt-1 text-xs text-[var(--omnix-text-2)]">Focused follow-through</p>
              </div>
              <button type="button" onClick={() => setThreadRoot(null)} className="rounded-md p-1.5 text-white/40 hover:bg-white/5 hover:text-white" aria-label="Close thread">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {threadLoading ? <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-cyan-100/50" /> : null}
              {threadMessages.map((message) => <MessageRow key={message.id} message={message} threaded />)}
            </div>
            <form
              className="border-t border-[var(--omnix-border)] p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void sendMessage(threadDraft, threadRoot.id, threadDraftMentions);
            }}
          >
              <MentionTextarea
                value={threadDraft}
                onChange={(nextValue) => {
                  setThreadDraft(nextValue);
                  void sendTypingSignal(selectedChannelId, Boolean(nextValue.trim()));
                }}
                members={activeMembers}
                mentions={threadDraftMentions}
                onMentionsChange={setThreadDraftMentions}
                placeholder="Add focused follow-through..."
                disabled={!mayPost || threadSending}
                className="omnix-input h-20 w-full resize-none rounded-lg p-2.5 text-sm leading-6"
              />
              <Button type="submit" size="sm" className="mt-2 w-full" disabled={!threadDraft.trim() || !mayPost || threadSending} rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                Reply in thread
              </Button>
            </form>
          </aside>
        ) : null}
      </div>
      {taskSource ? (
        <Portal>
          <div className="omnix-mobile-sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6">
            <form onSubmit={createTaskFromContext} className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to execution</p>
                  <h2 className="mt-1 text-base font-semibold text-white">Open linked task</h2>
                </div>
                <button type="button" onClick={() => { setTaskSource(null); setTaskMentions([]); }} className="rounded-md p-1.5 text-white/45 hover:text-white" aria-label="Close task conversion">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Name the specific next step" className="h-10 text-sm" autoFocus />
              <MentionTextarea
                value={taskDescription}
                onChange={setTaskDescription}
                members={activeMembers}
                mentions={taskMentions}
                onMentionsChange={setTaskMentions}
                className="omnix-input mt-2 min-h-[104px] w-full resize-none rounded-lg p-3 text-sm leading-6"
                placeholder="Carry forward the operational context"
              />
              <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
                This creates one Idea task linked to {taskSource.kind === "message" ? "the source message" : "the selected AI extraction and channel"}. Ownership and dates remain unset unless recorded later.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setTaskSource(null); setTaskMentions([]); }}>Cancel</Button>
                <Button type="submit" size="sm" isLoading={creatingTask} disabled={!taskTitle.trim()} leftIcon={<ClipboardCheck className="h-3.5 w-3.5" />}>
                  Open task
                </Button>
              </div>
            </form>
          </div>
        </Portal>
      ) : null}
      {decisionSource ? (
        <Portal>
          <div className="omnix-mobile-sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6">
            <form onSubmit={createDecisionFromContext} className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to decision</p>
                  <h2 className="mt-1 text-base font-semibold text-white">Record linked decision</h2>
                </div>
                <button type="button" onClick={() => { setDecisionSource(null); setDecisionMentions([]); }} className="rounded-md p-1.5 text-white/45 hover:text-white" aria-label="Close decision conversion">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <Input value={decisionTitle} onChange={(event) => setDecisionTitle(event.target.value)} placeholder="Name the organizational choice" className="h-10 text-sm" autoFocus />
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
                <MentionTextarea
                  value={decisionReason}
                  onChange={setDecisionReason}
                  members={activeMembers}
                  mentions={decisionMentions}
                  onMentionsChange={setDecisionMentions}
                  className="omnix-input min-h-[96px] w-full resize-none rounded-lg p-3 text-sm leading-6"
                  placeholder="Reason, if explicitly known"
                />
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Status</span>
                  <select
                    value={decisionStatus}
                    onChange={(event) => setDecisionStatus(event.target.value as WorkspaceDecisionStatus)}
                    className="omnix-input h-10 w-full rounded-lg px-3 text-sm"
                  >
                    {Object.entries(decisionStatusLabels).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </label>
              </div>
              <MentionTextarea
                value={decisionDescription}
                onChange={setDecisionDescription}
                members={activeMembers}
                mentions={decisionMentions}
                onMentionsChange={setDecisionMentions}
                className="omnix-input mt-2 min-h-[92px] w-full resize-none rounded-lg p-3 text-sm leading-6"
                placeholder="Source description"
              />
              <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
                This creates one decision linked to the selected message, channel, and workspace. It does not infer agreement beyond what you record here.
              </p>
              <div className="mt-4 flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => { setDecisionSource(null); setDecisionMentions([]); }}>Cancel</Button>
                <Button type="submit" size="sm" isLoading={creatingDecision} disabled={!decisionTitle.trim()} leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}>
                  Record decision
                </Button>
              </div>
            </form>
          </div>
        </Portal>
      ) : null}
    </section>
  );
}
