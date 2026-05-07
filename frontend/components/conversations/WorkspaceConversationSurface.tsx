"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleDot,
  CornerDownRight,
  FileText,
  Loader2,
  MessagesSquare,
  Plus,
  SendHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type {
  WorkspaceChannel,
  WorkspaceChannelMessage,
  WorkspaceConversationAssistance,
  WorkspaceConversationAssistanceMode,
} from "@/lib/workspace-types";

type DisplayMessage = WorkspaceChannelMessage & {
  delivery?: "sending" | "failed";
};

const assistanceLabels: Record<WorkspaceConversationAssistanceMode, string> = {
  summary: "Summarize",
  decisions: "Decisions",
  actions: "Actions",
  blockers: "Blockers",
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
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { presence, realtimeStatus, sendTypingSignal, typingUsers } = useWorkspaceCollaboration();
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [threadRoot, setThreadRoot] = useState<WorkspaceChannelMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [threadDraft, setThreadDraft] = useState("");
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
  const workspaceRef = useRef(activeWorkspaceId);
  const selectedChannelRef = useRef(selectedChannelId);
  const channelRequestRef = useRef(0);
  const messageRequestRef = useRef(0);
  const threadRequestRef = useRef(0);

  workspaceRef.current = activeWorkspaceId;
  selectedChannelRef.current = selectedChannelId;
  const selectedChannel = channels.find((channel) => channel.id === selectedChannelId) ?? null;
  const currentUserId = session?.user.id ?? "";
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
      setSelectedChannelId((existing) =>
        incoming.some((channel) => channel.id === existing) ? existing : incoming[0]?.id ?? null,
      );
      setError(null);
    } catch (err) {
      if (requestId === channelRequestRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load workspace conversations.");
      }
    } finally {
      if (requestId === channelRequestRef.current) setChannelsLoading(false);
    }
  }, [activeWorkspaceId]);

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
        setError(err instanceof Error ? err.message : "Unable to load discussion.");
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
        setError(err instanceof Error ? err.message : "Unable to open thread.");
      }
    } finally {
      if (requestId === threadRequestRef.current) setThreadLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setSelectedChannelId(null);
    setMessages([]);
    setThreadRoot(null);
    setThreadMessages([]);
    setAssistance(null);
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
                setThreadMessages((current) => mergeMessage(current, incoming));
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
            setMessages((current) => mergeMessage(current, incoming));
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

  const channelTyping = useMemo(
    () =>
      Object.values(typingUsers).filter(
        (typing) => typing.userId !== currentUserId && typing.conversationId === selectedChannelId,
      ),
    [currentUserId, selectedChannelId, typingUsers],
  );

  function optimisticMessage(content: string, nonce: string, parentMessageId?: string) {
    return {
      id: `pending-${nonce}`,
      workspace_id: activeWorkspaceId || "",
      channel_id: selectedChannelId || "",
      author_user_id: currentUserId,
      parent_message_id: parentMessageId || null,
      content,
      context_links: [],
      metadata: {},
      client_nonce: nonce,
      created_at: new Date().toISOString(),
      author_name: session?.user.user_metadata?.full_name || session?.user.email || "You",
      author_avatar_label: (session?.user.email || "Y")[0].toUpperCase(),
      thread_reply_count: 0,
      delivery: "sending" as const,
    };
  }

  async function sendMessage(content: string, parentMessageId?: string) {
    if (!activeWorkspaceId || !selectedChannelId || !mayPost || !content.trim()) return;
    const cleaned = content.trim();
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const optimistic = optimisticMessage(cleaned, nonce, parentMessageId);
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
        },
      );
      if (inThread) {
        setThreadMessages((current) => mergeMessage(current, created));
        setThreadDraft("");
        void loadMessages(selectedChannelId);
      } else {
        setMessages((current) => mergeMessage(current, created));
        setDraft("");
      }
      await sendTypingSignal(selectedChannelId, false);
      void loadChannels();
    } catch (err) {
      const markFailed = (current: DisplayMessage[]): DisplayMessage[] =>
        current.map((message) => (message.client_nonce === nonce ? { ...message, delivery: "failed" as const } : message));
      if (inThread) setThreadMessages(markFailed);
      else setMessages(markFailed);
      setError(err instanceof Error ? err.message : "Unable to deliver message.");
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
      setError(err instanceof Error ? err.message : "Unable to create operational channel.");
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
      setError(err instanceof Error ? err.message : "AI assistance is unavailable.");
    } finally {
      setAssistanceLoading(null);
    }
  }

  function openThread(message: WorkspaceChannelMessage) {
    if (!selectedChannelId) return;
    setThreadRoot(message);
    setThreadDraft("");
    void loadThread(selectedChannelId, message);
  }

  function MessageRow({ message, threaded = false }: { message: DisplayMessage; threaded?: boolean }) {
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
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-white">{messageAuthor(message)}</span>
              <time className="text-[11px] text-[var(--omnix-text-3)]">{readableTime(message.created_at)}</time>
              {message.delivery === "sending" ? <span className="text-[10px] text-cyan-200/60">sending</span> : null}
              {message.delivery === "failed" ? <span className="text-[10px] text-rose-200">delivery failed</span> : null}
            </div>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-[var(--omnix-text)]">
              {message.content}
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
            {!threaded && message.delivery !== "sending" ? (
              <button
                type="button"
                onClick={() => openThread(message)}
                className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-3)] transition hover:text-cyan-100"
              >
                <CornerDownRight className="h-3.5 w-3.5" />
                {message.thread_reply_count ? `${message.thread_reply_count} thread replies` : "Open thread"}
              </button>
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
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-4 sm:px-5">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <MessagesSquare className="h-3.5 w-3.5" />
            Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Workspace Conversations</h1>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">
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
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

      <div className={cn("grid min-h-0 flex-1 gap-3", threadRoot ? "lg:grid-cols-[15.5rem_minmax(0,1fr)_22rem]" : "lg:grid-cols-[15.5rem_minmax(0,1fr)]")}>
        <aside className="omnix-panel flex min-h-[10rem] flex-col rounded-xl p-3 lg:min-h-0">
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
          <div className="omnix-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto">
            {channelsLoading ? <Loader2 className="mx-auto mt-6 h-4 w-4 animate-spin text-cyan-100/60" /> : null}
            {channels.map((channel) => (
              <button
                type="button"
                key={channel.id}
                onClick={() => setSelectedChannelId(channel.id)}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition",
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
          <p className="mt-3 border-t border-[var(--omnix-border)] px-1 pt-3 text-[11px] leading-5 text-[var(--omnix-text-3)]">
            Messages stay scoped to this workspace. Attention signals remain intentionally quiet.
          </p>
        </aside>

        <main className="omnix-panel flex min-h-[26rem] min-w-0 flex-col overflow-hidden rounded-xl">
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
              <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">Derived from {assistance.source_message_count} discussion messages. Not posted into the channel.</p>
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
              void sendMessage(draft);
            }}
          >
            <textarea
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                void sendTypingSignal(selectedChannelId, Boolean(event.target.value.trim()));
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void sendMessage(draft);
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
          <aside className="omnix-panel flex min-h-[22rem] min-w-0 flex-col overflow-hidden rounded-xl">
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
                void sendMessage(threadDraft, threadRoot.id);
              }}
            >
              <textarea
                value={threadDraft}
                onChange={(event) => {
                  setThreadDraft(event.target.value);
                  void sendTypingSignal(selectedChannelId, Boolean(event.target.value.trim()));
                }}
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
    </section>
  );
}
