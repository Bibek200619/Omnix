"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  FileSearch,
  Globe2,
  Hash,
  MessageSquare,
  MoreVertical,
  Pin,
  Search,
  ShieldCheck,
  Users,
  WifiOff,
} from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type {
  ApiMessage,
  Message,
  MessageAttachment,
  SearchMode,
} from "@/components/chat/types";
import { Alert } from "@/components/ui/Alert";
import { ApiError, apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { logClientError } from "@/lib/errors";
import { useProfile } from "@/lib/profile-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { initialsFromText, workspaceRoleLabel } from "@/lib/workspace-roles";
import type { WorkspaceMember } from "@/lib/workspace-types";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { WorkspacePresenceCluster } from "@/components/workspace/WorkspacePresenceCluster";

function formatTime(value?: string) {
  const date = value ? new Date(value) : new Date();

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
}

type SenderLookup = {
  currentUserId?: string | null;
  currentUserEmail?: string | null;
  currentUserName?: string | null;
  currentUserHandle?: string | null;
  currentUserAvatarUrl?: string | null;
  currentUserWorkspaceRole?: Message["senderRole"];
  membersById: Map<string, WorkspaceMember>;
};

function currentUserNameFromSession(email?: string | null, metadata?: Record<string, unknown>) {
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return email || "You";
}

function normalizeMessage(message: ApiMessage, index: number, senderLookup: SenderLookup): Message {
  const failed = message.status === "failed";
  const pending = message.status === "pending";
  const role = message.role === "user" ? "user" : "assistant";
  const status = failed ? "failed" : pending ? (role === "assistant" ? "streaming" : "sending") : "sent";
  const content =
    message.content ||
    (failed && role === "assistant"
      ? "The assistant response failed before it could be completed."
      : "");

  const userId = message.user_id ?? null;
  const member = userId ? senderLookup.membersById.get(userId) : undefined;
  const isOwn = role === "user" && Boolean(userId && userId === senderLookup.currentUserId);
  const senderName =
    role === "assistant"
      ? "Omnix"
      : isOwn
      ? "You"
      : member?.full_name || member?.email || "Teammate";
  const senderEmail =
    role === "assistant"
      ? null
      : member?.email ?? (isOwn ? senderLookup.currentUserEmail ?? null : null);
  const senderAvatar =
    role === "assistant"
      ? "OX"
      : member?.avatar_label || initialsFromText(senderName || senderEmail || userId || "U");
  const senderAvatarUrl =
    role === "assistant"
      ? null
      : member?.avatar_url ?? (isOwn ? senderLookup.currentUserAvatarUrl ?? null : null);
  const senderHandle =
    role === "assistant"
      ? null
      : member?.handle ?? (isOwn ? senderLookup.currentUserHandle ?? null : null);
  const payloadSources = sourcesFromPayload(message.payload);
  const metadataSources = sourcesFromPayload(message.metadata);
  const sources =
    role === "assistant"
      ? message.sources?.length
        ? message.sources
        : payloadSources.length
        ? payloadSources
        : metadataSources
      : undefined;
  const sourceMode = sourceModeFromPayload(message.payload);

  return {
    id: message.id ?? `message-${index}`,
    role,
    userId,
    senderName,
    senderEmail,
    senderAvatar,
    senderAvatarUrl,
    senderHandle,
    senderRole:
      role === "assistant"
        ? "assistant"
        : member?.role ?? (isOwn ? senderLookup.currentUserWorkspaceRole ?? "member" : "member"),
    isOwn,
    content,
    timestamp: formatTime(message.timestamp ?? message.created_at),
    createdAt: message.timestamp ?? message.created_at,
    status,
    error: failed ? "Not completed" : undefined,
    isStreaming: pending && role === "assistant",
    sources,
    sourceMode,
    webSearchUsed: webSearchUsedFromPayload(message.payload),
    citations: citationsFromPayload(message.payload),
  };
}

function sourcesFromPayload(payload?: Record<string, unknown> | null): NonNullable<Message["sources"]> {
  const sources = payload?.sources;
  if (!Array.isArray(sources)) return [];
  return sources.filter((source): source is NonNullable<Message["sources"]>[number] => {
    return Boolean(source && typeof source === "object");
  });
}

function sourceModeFromPayload(payload?: Record<string, unknown> | null): SearchMode | undefined {
  const mode = payload?.mode;
  return mode === "auto" || mode === "workspace" || mode === "web" || mode === "hybrid"
    ? mode
    : undefined;
}

function webSearchUsedFromPayload(payload?: Record<string, unknown> | null) {
  return typeof payload?.web_search_used === "boolean" ? payload.web_search_used : undefined;
}

function citationsFromPayload(payload?: Record<string, unknown> | null) {
  const citations = payload?.citations;
  if (!Array.isArray(citations)) return undefined;
  return citations.filter((item): item is string => typeof item === "string" && Boolean(item));
}

function timestampMs(value?: string) {
  if (!value) return Number.NaN;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function attachFilesToMessages(messages: Message[], files: MessageAttachment[]) {
  if (!files.length) return messages;

  const userMessages = messages.filter((message) => message.role === "user");
  if (!userMessages.length) return messages;

  const attachmentsByMessageId = new Map<string, MessageAttachment[]>();
  const sortedFiles = [...files].sort(
    (a, b) => (timestampMs(a.created_at) || 0) - (timestampMs(b.created_at) || 0),
  );

  for (const file of sortedFiles) {
    const fileTime = timestampMs(file.created_at);
    const target =
      userMessages.find((message) => {
        const messageTime = timestampMs(message.createdAt);
        return !Number.isNaN(fileTime) && !Number.isNaN(messageTime) && messageTime >= fileTime - 30_000;
      }) ?? userMessages[userMessages.length - 1];

    const existing = attachmentsByMessageId.get(target.id) ?? [];
    if (!existing.some((item) => item.id === file.id)) {
      attachmentsByMessageId.set(target.id, [...existing, file]);
    }
  }

  return messages.map((message) => {
    const attachments = attachmentsByMessageId.get(message.id);
    if (!attachments?.length) return message;

    return {
      ...message,
      attachments: [...(message.attachments ?? []), ...attachments],
    };
  });
}

type StreamEvent = {
  type: "init" | "status" | "sources" | "token" | "error" | "done";
  conversation_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
  sources?: Message["sources"];
  status?: string;
  text?: string;
  detail?: string;
};

const MESSAGE_VALIDATION_INTERVAL_MS = 45_000;
const MESSAGE_FOCUS_STALE_MS = 12_000;
const WORKSPACE_SYNC_INTERVAL_MS = 60_000;

async function fetchConversationSnapshot(convId: string, senderLookup: SenderLookup) {
  const [data, files] = await Promise.all([
    apiClient.get<ApiMessage[]>(`/conversations/${convId}/messages`),
    apiClient
      .get<MessageAttachment[]>("/files?conversation_id=" + convId)
      .catch((err) => {
        console.error("Failed to load conversation files", err);
        return [];
      }),
  ]);

  return attachFilesToMessages(
    data.map((message, index) => normalizeMessage(message, index, senderLookup)),
    files,
  );
}

function mergeAttachments(
  current?: MessageAttachment[],
  incoming?: MessageAttachment[],
) {
  const byId = new Map<string, MessageAttachment>();
  for (const file of current ?? []) byId.set(file.id, file);
  for (const file of incoming ?? []) byId.set(file.id, file);
  return [...byId.values()];
}

function isOptimisticDuplicate(localMessage: Message, serverMessages: Message[]) {
  if (
    localMessage.role !== "user" ||
    (localMessage.status !== "sending" && localMessage.status !== "failed")
  ) {
    return false;
  }

  const localContent = localMessage.content.trim();
  if (!localContent) {
    return false;
  }

  return serverMessages.some(
    (message) =>
      message.role === "user" &&
      message.content.trim() === localContent &&
      message.status === "sent",
  );
}

function reconcileMessageLists(
  currentMessages: Message[],
  serverMessages: Message[],
) {
  const currentById = new Map(currentMessages.map((message) => [message.id, message]));
  const serverIds = new Set(serverMessages.map((message) => message.id));

  const reconciled = serverMessages.map((serverMessage) => {
    const current = currentById.get(serverMessage.id);
    if (!current) {
      return serverMessage;
    }

    const merged: Message = {
      ...serverMessage,
      attachments: mergeAttachments(current.attachments, serverMessage.attachments),
      sources: serverMessage.sources?.length ? serverMessage.sources : current.sources,
    };

    if (
      current.status === "streaming" &&
      serverMessage.role === "assistant" &&
      serverMessage.status === "streaming" &&
      (!serverMessage.content || current.content.length > serverMessage.content.length)
    ) {
      return {
        ...merged,
        content: current.content,
        status: current.status,
        isStreaming: current.isStreaming,
        error: current.error,
      };
    }

    return merged;
  });

  const localOnly = currentMessages.filter((message) => {
    if (serverIds.has(message.id)) {
      return false;
    }

    if (isOptimisticDuplicate(message, serverMessages)) {
      return false;
    }

    return message.status === "sending" || message.status === "streaming" || message.status === "failed";
  });

  return [...reconciled, ...localOnly];
}

export function ChatInterface() {
  const params = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { profile } = useProfile();
  const {
    activeWorkspace,
    activeMembers,
    activeWorkspaceId,
    activeWorkspaceIntelligence,
    refreshActiveWorkspaceData,
  } = useWorkspace();
  const {
    activeConversationId,
    conversations,
    refreshConversations,
    setActiveConversation,
  } = useConversationHistory();
  const {
    presence,
    typingUsers,
    sendTypingSignal,
    statusForWorkspace,
  } = useWorkspaceCollaboration();
  const conversationId = params.get("conversation");
  const authenticatedUserId = user?.id ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [responding, setResponding] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentConversation, setCurrentConversation] = useState<string | null>(
    conversationId,
  );
  const [currentConversationWorkspaceId, setCurrentConversationWorkspaceId] = useState<string | null>(
    activeWorkspaceId,
  );
  const [pendingAttachments, setPendingAttachments] = useState<MessageAttachment[]>([]);
  const [searchMode, setSearchMode] = useState<SearchMode>("auto");
  const [historyOpen, setHistoryOpen] = useState(true);
  const workspaceMembers = useMemo(
    () => (activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? []),
    [activeMembers, activeWorkspace?.members_preview],
  );
  const activeLiveStatus = statusForWorkspace(activeWorkspaceId);

  const conversationTypingMembers = useMemo(() => {
    return Object.values(typingUsers)
      .filter((signal) => {
        if (signal.userId === user?.id) return false;
        if (!currentConversation) return true;
        return !signal.conversationId || signal.conversationId === currentConversation;
      })
      .map((signal) => ({
        user_id: signal.userId,
        full_name: signal.fullName,
        avatar_url: signal.avatarUrl,
        avatar_label: initialsFromText(signal.fullName),
        is_typing: true,
        workspace_id: activeWorkspaceId || "",
        status: "online" as const,
        is_online: true,
      }));
  }, [currentConversation, typingUsers, user?.id, activeWorkspaceId]);

  const senderLookup = useMemo<SenderLookup>(() => {
    const membersById = new Map<string, WorkspaceMember>();
    for (const member of workspaceMembers) {
      membersById.set(member.user_id, member);
    }

    return {
      currentUserId: user?.id ?? null,
      currentUserEmail: user?.email ?? null,
      currentUserName: profile?.display_name || currentUserNameFromSession(user?.email ?? null, user?.user_metadata),
      currentUserHandle: profile?.username ?? profile?.handle ?? null,
      currentUserAvatarUrl: profile?.avatar_url ?? null,
      currentUserWorkspaceRole: activeWorkspace?.current_user_role ?? "member",
      membersById,
    };
  }, [activeWorkspace?.current_user_role, profile?.avatar_url, profile?.display_name, profile?.handle, profile?.username, user?.email, user?.id, user?.user_metadata, workspaceMembers]);
  const mountedRef = useRef(false);
  const currentConversationRef = useRef<string | null>(conversationId);
  const messagesRef = useRef<Message[]>([]);
  const respondingRef = useRef(false);
  const lastWorkspaceSyncRef = useRef(0);
  const lastMessageSyncRef = useRef(0);
  const messageSyncInFlightRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const loadRequestIdRef = useRef(0);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const senderLookupRef = useRef(senderLookup);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      activeStreamAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    currentConversationRef.current = currentConversation;
  }, [currentConversation]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    respondingRef.current = responding;
  }, [responding]);

  useEffect(() => {
    senderLookupRef.current = senderLookup;
  }, [senderLookup]);

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
  }, [activeWorkspaceId]);

  const reconcileConversationMessages = useCallback(
    async (
      convId: string,
      options: {
        force?: boolean;
        silent?: boolean;
        allowInactiveConversation?: boolean;
      } = {},
    ) => {
      const now = Date.now();
      if (
        options.silent &&
        !options.force &&
        now - lastMessageSyncRef.current < MESSAGE_FOCUS_STALE_MS
      ) {
        return false;
      }

      const inFlight = messageSyncInFlightRef.current.get(convId);
      if (inFlight) {
        return inFlight;
      }

      const request = (async () => {
        try {
          const serverMessages = await fetchConversationSnapshot(convId, senderLookupRef.current);
          if (!mountedRef.current) {
            return false;
          }

          const activeConversationRef = currentConversationRef.current;
          if (!activeConversationRef) {
            return Boolean(options.allowInactiveConversation);
          }
          if (activeConversationRef && activeConversationRef !== convId) {
            return Boolean(options.allowInactiveConversation);
          }

          setMessages((current) =>
            reconcileMessageLists(current, serverMessages),
          );
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
    [],
  );

  const loadConversation = useCallback(
    async (convId: string) => {
      const requestId = loadRequestIdRef.current + 1;
      loadRequestIdRef.current = requestId;

      try {
        setLoadingConversation(true);
        setError(null);
        const serverMessages = await fetchConversationSnapshot(convId, senderLookupRef.current);
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        setMessages(serverMessages);
        lastMessageSyncRef.current = Date.now();
        currentConversationRef.current = convId;
        setCurrentConversation(convId);
        setCurrentConversationWorkspaceId(activeWorkspaceIdRef.current);
        setActiveConversation(convId);
      } catch (err) {
        if (!mountedRef.current || loadRequestIdRef.current !== requestId) {
          return;
        }
        logClientError("Failed to load conversation", err, { endpoint: `/conversations/${convId}/messages` });
        const rawMessage = err instanceof ApiError ? err.rawMessage ?? "" : "";
        const missingConversation = err instanceof ApiError && (err.status === 404 || /conversation not found/i.test(rawMessage));
        setError("Unable to load conversation.");

        if (missingConversation) {
          setMessages([]);
          currentConversationRef.current = null;
          setCurrentConversation(null);
          setActiveConversation(null);
          await refreshConversations();
          router.replace("/chat", { scroll: false });
        }
      } finally {
        if (mountedRef.current && loadRequestIdRef.current === requestId) {
          setLoadingConversation(false);
        }
      }
    },
    [refreshConversations, router, setActiveConversation],
  );

  useEffect(() => {
    if (!authenticatedUserId || typeof window === "undefined") {
      return;
    }

    const syncActiveConversation = (options?: { forceMessages?: boolean; forceWorkspace?: boolean }) => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const convId = currentConversationRef.current;
      const now = Date.now();

      if (
        convId &&
        !respondingRef.current &&
        (options?.forceMessages || now - lastMessageSyncRef.current > MESSAGE_VALIDATION_INTERVAL_MS)
      ) {
        void reconcileConversationMessages(convId, {
          force: options?.forceMessages,
          silent: true,
        });
      }

      if (
        options?.forceWorkspace ||
        now - lastWorkspaceSyncRef.current > WORKSPACE_SYNC_INTERVAL_MS
      ) {
        lastWorkspaceSyncRef.current = now;
        void refreshActiveWorkspaceData({ silent: true });
      }
    };

    const syncOnFocus = () => {
      syncActiveConversation({ forceMessages: false, forceWorkspace: false });
    };

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
    reconcileConversationMessages,
    refreshActiveWorkspaceData,
  ]);

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
    if (!currentConversation) {
      return;
    }

    if (currentConversationWorkspaceId !== activeWorkspaceId) {
      currentConversationRef.current = null;
      setCurrentConversation(null);
      setCurrentConversationWorkspaceId(activeWorkspaceId);
      lastMessageSyncRef.current = 0;
      setPendingAttachments([]);
      setMessages([]);
      setActiveConversation(null);
      router.replace("/chat", { scroll: false });
    }
  }, [activeWorkspaceId, currentConversation, currentConversationWorkspaceId, router, setActiveConversation]);

  useEffect(() => {
    function handleConversationCleared(event: Event) {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (!detail?.conversationId || detail.conversationId !== currentConversation) {
        return;
      }
      setMessages([]);
      setPendingAttachments([]);
    }

    window.addEventListener("omnix:conversation-cleared", handleConversationCleared);
    return () => window.removeEventListener("omnix:conversation-cleared", handleConversationCleared);
  }, [currentConversation]);

  const statusItems = useMemo(
    () => [
      {
        icon: FileSearch,
        label: "Workspace",
        value: activeWorkspace?.name ?? "Loading workspace",
        color: "text-cyan-200",
      },
      {
        icon: Database,
        label: "AI context",
        value: activeWorkspaceIntelligence
          ? `Using ${activeWorkspaceIntelligence.workspace_name} operational context`
          : activeWorkspace?.is_shared
          ? `Organizational memory scoped to ${activeWorkspace.member_count} members`
          : "Workspace-scoped retrieval active",
        color: "text-emerald-200",
      },
      {
        icon: Globe2,
        label: "Research",
        value:
          searchMode === "auto"
            ? "Auto hybrid"
            : searchMode === "workspace"
            ? "Workspace only"
            : searchMode === "web"
            ? "Live web"
            : "Workspace + web",
        color: "text-violet-200",
      },
      {
        icon: ShieldCheck,
        label: "Trust scope",
        value: activeWorkspaceIntelligence
          ? `Using ${activeWorkspaceIntelligence.source_count} authorized ${activeWorkspaceIntelligence.source_count === 1 ? "source" : "sources"}`
          : activeWorkspace?.current_user_role
          ? `Authorized as ${workspaceRoleLabel(activeWorkspace.current_user_role)}`
          : "Scoped authorization",
        color: "text-amber-200",
      },
      {
        icon: Users,
        label: "Presence",
        value: activeLiveStatus
          ? `${activeLiveStatus.active_count} active now`
          : presence
          ? `${presence.active_count} active now`
          : "Presence syncing",
        color: "text-emerald-200",
      },
    ],
    [activeLiveStatus, activeWorkspace, activeWorkspaceIntelligence, presence, searchMode],
  );

  const sendMessage = useCallback(
    async (
      content: string,
      retryMessageId?: string,
      attachmentsOverride?: MessageAttachment[],
    ) => {
      if (respondingRef.current) return;

      const messageId = retryMessageId ?? crypto.randomUUID();
      const attachments = attachmentsOverride ?? pendingAttachments;
      const attachmentIds = attachments.map((file) => file.id).filter(Boolean);
      const userMessage: Message = {
        id: messageId,
        role: "user",
        userId: user?.id ?? null,
        senderName: "You",
        senderEmail: user?.email ?? null,
        senderAvatar: initialsFromText(senderLookup.currentUserName || user?.email || "You"),
        senderAvatarUrl: senderLookup.currentUserAvatarUrl ?? null,
        senderHandle: senderLookup.currentUserHandle ?? null,
        senderRole: activeWorkspace?.current_user_role ?? "member",
        isOwn: true,
        content,
        timestamp: formatTime(),
        createdAt: new Date().toISOString(),
        status: "sending",
        attachments,
      };

      setMessages((current) => {
        if (retryMessageId) {
          return current.map((message) =>
            message.id === retryMessageId
              ? { ...message, status: "sending", error: undefined }
              : message,
          );
        }

        return [...current, userMessage];
      });

      if (!retryMessageId) {
        setPendingAttachments([]);
      }

      // keep responding true until streaming completes
      respondingRef.current = true;
      setResponding(true);
      setError(null);
      let assistantId: string | null = null;
      let persistedUserMessageId: string | null = null;
      let streamConversationId: string | null = currentConversation;
      const streamAbortController = new AbortController();
      activeStreamAbortRef.current = streamAbortController;
      let pendingTokenText = "";
      let tokenFlushFrame: number | null = null;

      const applyPendingTokens = () => {
        if (!assistantId || !pendingTokenText) return;

        const nextText = pendingTokenText;
        pendingTokenText = "";
        setMessages((current) =>
          current.map((m) =>
            m.id === assistantId ? { ...m, content: (m.content || "") + nextText } : m,
          ),
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
        // Use streaming endpoint when available
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

        const decoder = new TextDecoder();
        let buffer = "";

        // helper to process an SSE block (one or more data: lines)
        const processEvent = (block: string) => {
          const lines = block.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.replace(/^data:\s?/, "");
            try {
              const obj = JSON.parse(payload) as StreamEvent;
              handleStreamEvent(obj);
            } catch (e) {
              console.error("Failed to parse stream payload", payload, e);
            }
          }
        };

        const handleStreamEvent = (obj: StreamEvent) => {
          const t = obj.type;
          if (t === "init") {
            // persist conversation & user message ids
            if (obj.conversation_id) {
              streamConversationId = obj.conversation_id;
              currentConversationRef.current = obj.conversation_id;
              setCurrentConversation(obj.conversation_id);
              setCurrentConversationWorkspaceId(activeWorkspaceId);
              setActiveConversation(obj.conversation_id);
            }
            persistedUserMessageId = obj.user_message_id ?? null;
            assistantId = obj.assistant_message_id ?? crypto.randomUUID();

            // update messages list: replace optimistic user message and add assistant placeholder
            setMessages((current) => {
              const next = current.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      id: persistedUserMessageId ?? message.id,
                      status: "sent" as const,
                    }
                  : message,
              );

              if (next.some((message) => message.id === assistantId)) {
                return next.map((message) =>
                  message.id === assistantId
                    ? {
                        ...message,
                        status: "streaming",
                        isStreaming: true,
                        sources: obj.sources ?? message.sources ?? [],
                      }
                    : message,
                );
              }

              return [
                ...next,
                {
                  id: assistantId as string,
                  role: "assistant",
                  senderName: "Omnix",
                  senderAvatar: "OX",
                  senderRole: "assistant",
                  isOwn: false,
                  content: "",
                  timestamp: formatTime(),
                  createdAt: new Date().toISOString(),
                  status: "streaming",
                  isStreaming: true,
                  sources: obj.sources ?? [],
                },
              ];
            });
          } else if (t === "status") {
            // Status events are transport metadata. Keep them out of the
            // persisted assistant text so streamed tokens remain clean.
            return;
          } else if (t === "sources") {
            if (!assistantId) return;
            setMessages((current) =>
              current.map((m) =>
                m.id === assistantId ? { ...m, sources: obj.sources ?? [] } : m,
              ),
            );
          } else if (t === "token") {
            if (!assistantId) return;
            const txt = obj.text ?? "";
            if (!txt) return;
            pendingTokenText += txt;
            scheduleTokenFlush();
          } else if (t === "error") {
            flushPendingTokens();
            logClientError("[chat] stream returned an error event", new Error(String(obj.detail ?? "Stream error")), {
              responsePayload: obj,
            });
            const detail = "AI response is unavailable.";
            if (assistantId) {
              setMessages((current) =>
                current.map((m) => (m.id === assistantId ? { ...m, status: "failed", isStreaming: false, error: detail } : m)),
              );
            }
          } else if (t === "done") {
            flushPendingTokens();
            streamConversationId = obj.conversation_id ?? streamConversationId;
            if (assistantId) {
              setMessages((current) =>
                current.map((m) => (m.id === assistantId ? { ...m, status: "sent", isStreaming: false } : m)),
              );
            }
            // update conversation url
            if (!conversationId && obj.conversation_id) {
              router.replace(`/chat?conversation=${obj.conversation_id}`, { scroll: false });
            }
          }
        };

        // read loop
        let streamTimeout: number | undefined;
        const resetStreamTimeout = () => {
          if (streamTimeout) window.clearTimeout(streamTimeout);
          streamTimeout = window.setTimeout(() => {
            console.warn("[chat] stream timeout reached, aborting");
            streamAbortController.abort(new Error("Stream timed out after 45 seconds of inactivity."));
          }, 45000);
        };

        resetStreamTimeout();
        while (true) {
          const { done, value } = await reader.read();
          resetStreamTimeout();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\n\n/);
          buffer = parts.pop() || "";
          for (const part of parts) processEvent(part);
        }
        if (streamTimeout) window.clearTimeout(streamTimeout);
        if (buffer.trim()) {
          processEvent(buffer);
        }
        flushPendingTokens();

        const targetConversationId = streamConversationId || currentConversationRef.current;
        if (targetConversationId) {
          await reconcileConversationMessages(targetConversationId, {
            allowInactiveConversation: true,
            force: true,
            silent: true,
          });
        }
        await refreshConversations({ force: true, silent: true });

      } catch (err) {
        if (mountedRef.current) {
          flushPendingTokens();
        }
        if (streamAbortController.signal.aborted && !mountedRef.current) {
          return;
        }

        logClientError("Failed to send message", err, { endpoint: "/chat/stream" });
        const message = "Unable to send message.";
        const targetConversationId = streamConversationId || currentConversationRef.current;
        const recovered = targetConversationId
          ? await reconcileConversationMessages(targetConversationId, {
              allowInactiveConversation: true,
              force: true,
              silent: true,
            })
          : false;

        if (!recovered) {
          setError(message);
          setMessages((current) =>
            current.map((item) =>
              item.id === (persistedUserMessageId ?? messageId)
                ? { ...item, status: "failed", error: "Not sent" }
                : item,
            ),
          );
        }
        await refreshConversations({ force: true, silent: true });
      } finally {
        if (tokenFlushFrame !== null) {
          window.cancelAnimationFrame(tokenFlushFrame);
          tokenFlushFrame = null;
        }
        // ensure responding is cleared when streaming completes or error occurred
        respondingRef.current = false;
        if (mountedRef.current) {
          setResponding(false);
        }
        if (activeStreamAbortRef.current === streamAbortController) {
          activeStreamAbortRef.current = null;
        }
      }
    },
    [
      conversationId,
      currentConversation,
      activeWorkspace?.current_user_role,
      activeWorkspaceId,
      pendingAttachments,
      refreshConversations,
      reconcileConversationMessages,
      router,
      searchMode,
      senderLookup,
      setActiveConversation,
      user?.email,
      user?.id,
    ],
  );

  const handleRetry = useCallback((message: Message) => {
    sendMessage(message.content, message.id, message.attachments ?? []);
  }, [sendMessage]);

  const handleRegenerate = useCallback((assistantMessageId: string) => {
    // find the preceding user message and resend it
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const prev = currentMessages[idx - 1];
    if (!prev || prev.role !== "user") return;
    sendMessage(prev.content, undefined, prev.attachments ?? []);
  }, [sendMessage]);

  function handleUploadSuccess(file: MessageAttachment) {
    console.debug("[upload] attaching uploaded file to pending chat message", {
      fileId: file.id,
      conversationId: currentConversation,
      workspaceId: activeWorkspaceId,
    });
    setPendingAttachments((current) => {
      if (current.some((item) => item.id === file.id)) {
        return current;
      }
      return [...current, file];
    });
  }

  function handleRemoveAttachment(fileId: string) {
    setPendingAttachments((current) => current.filter((file) => file.id !== fileId));
  }

  function openConversationFromPanel(conversationId: string) {
    setActiveConversation(conversationId);
    router.push(`/chat?conversation=${conversationId}`, { scroll: false });
  }

  const visibleHistory = conversations.slice(0, 7);
  const activeHistoryItem = visibleHistory.find((item) => item.id === activeConversationId) ?? visibleHistory[0];

  return (
    <section className="relative flex h-full w-full overflow-hidden bg-[var(--omnix-bg)] text-[var(--omnix-text)]">
      <div className="pointer-events-none absolute left-[18%] top-[-18%] h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(0,255,255,0.075),transparent_68%)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-20%] right-[4%] h-[34rem] w-[34rem] rounded-full bg-[radial-gradient(circle,rgba(0,51,255,0.085),transparent_70%)] blur-3xl" />
      {historyOpen ? (
        <>
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity md:hidden"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-[var(--omnix-border)] bg-[rgba(5,12,23,0.98)] shadow-[18px_0_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl md:relative md:z-10 md:w-[264px] md:flex md:bg-[rgba(5,12,23,0.6)]">
          <div className="flex items-center gap-2 border-b border-[var(--omnix-border)] px-3 py-2.5">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--omnix-text-3)]" />
              <input
                type="text"
                placeholder="Search chats..."
                className="omnix-input h-[30px] w-full rounded-full pl-7 pr-3 text-xs"
                readOnly
              />
            </div>
            <button
              type="button"
              onClick={() => setHistoryOpen(false)}
              className="omnix-ghost-action flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
              aria-label="Close history"
              title="Close history"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="omnix-scrollbar flex-1 overflow-y-auto px-2 py-2">
            <div className="mb-3">
              <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
                <Pin className="h-2.5 w-2.5" />
                Pinned
              </div>
              {activeHistoryItem ? (
                <button
                  type="button"
                  onClick={() => openConversationFromPanel(activeHistoryItem.id)}
                  className="w-full rounded-[8px] border border-cyan-300/15 bg-cyan-300/[0.07] px-2.5 py-2 text-left shadow-[var(--omnix-glow-xs)] transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
                >
                  <div className="mb-0.5 flex justify-between gap-2">
                    <span className="truncate text-xs font-medium text-white">{activeHistoryItem.title || "Omnix conversation"}</span>
                    <span className="text-[10px] text-[var(--omnix-cyan)]">Now</span>
                  </div>
                  <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">{activeHistoryItem.preview || "Workspace context ready..."}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => router.push("/chat")}
                  className="w-full rounded-[8px] border border-cyan-300/15 bg-cyan-300/[0.07] px-2.5 py-2 text-left shadow-[var(--omnix-glow-xs)] transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
                >
                  <div className="mb-0.5 flex justify-between gap-2">
                    <span className="truncate text-xs font-medium text-white">New AI session</span>
                    <span className="text-[10px] text-[var(--omnix-cyan)]">Now</span>
                  </div>
                  <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">Start a collaborative intelligence thread.</span>
                </button>
              )}
            </div>

            <div>
              <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
                <MessageSquare className="h-2.5 w-2.5" />
                Recent
              </div>
              {visibleHistory.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openConversationFromPanel(conversation.id)}
                  className="mb-px w-full rounded-[8px] border border-transparent px-2.5 py-2 text-left transition hover:bg-[var(--omnix-surface)]"
                >
                  <div className="mb-0.5 flex justify-between gap-2">
                    <span className="max-w-[150px] truncate text-xs font-medium text-[var(--omnix-text-2)]">{conversation.title || "Omnix conversation"}</span>
                    <span className="shrink-0 text-[10px] text-[var(--omnix-text-3)]">
                      {formatTime(conversation.latest_message_at ?? conversation.last_message_at ?? conversation.updated_at ?? conversation.created_at ?? undefined)}
                    </span>
                  </div>
                  <span className="block truncate text-[11px] text-[var(--omnix-text-3)]">{conversation.preview || "No preview yet"}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>
      </>
      ) : null}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.85)] px-3 shadow-[0_12px_44px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-[18px]">
          <div className="flex min-w-0 items-center gap-2.5">
            {!historyOpen ? (
              <button
                type="button"
                onClick={() => setHistoryOpen(true)}
                className="omnix-ghost-action flex h-7 w-7 items-center justify-center rounded-[7px]"
                aria-label="Open history"
                title="Open history"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <div className="omnix-icon-tile h-7 w-7 bg-cyan-300/[0.08]">
              <Hash className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="omnix-display truncate text-sm font-semibold text-white">
                {currentConversation ? "Active intelligence session" : "New intelligence session"}
              </div>
              <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--omnix-text-3)]">
                <span className="h-[5px] w-[5px] rounded-full bg-[var(--omnix-green)] shadow-[0_0_5px_var(--omnix-green)]" />
                Active collaborative session
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {activeWorkspace ? (
              <WorkspaceMemberStack
                members={workspaceMembers}
                totalCount={activeWorkspace.member_count}
                size="sm"
                presenceMembers={presence?.recently_active_members ?? []}
                showPresence
              />
            ) : null}
            <div className="hidden items-center gap-1.5 rounded-[7px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-1.5 text-[11px] text-[var(--omnix-text-2)] sm:flex">
              <BookOpen className="h-3 w-3" />
              Sources
              <span className="rounded-full border border-cyan-300/25 bg-cyan-300/15 px-1.5 py-px text-[9px] font-bold text-[var(--omnix-cyan)]">
                {activeWorkspaceIntelligence?.source_count ?? 0}
              </span>
            </div>
            <button type="button" className="flex items-center text-[var(--omnix-text-3)] transition hover:text-white" aria-label="Session actions" title="Session actions">
              <MoreVertical className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="hidden shrink-0 border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.48)] px-[18px] py-2 backdrop-blur-xl lg:block">
          <div className="grid grid-cols-5 gap-2">
            {statusItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/10">
                    <Icon className={cn("h-3.5 w-3.5", item.color)} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
                      {item.label}
                    </span>
                    <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">
                      {item.value}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="hidden shrink-0 border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.34)] px-[18px] py-2 backdrop-blur-xl xl:block">
          <WorkspacePresenceCluster
            presence={presence}
            workspaceName={activeWorkspace?.name}
            currentUserId={user?.id}
            compact
          />
        </div>

      {error ? (
        <div className="px-4 pt-4">
          <Alert
            variant="error"
            title="Omnix could not complete the request"
            className="items-start"
          >
            <span className="inline-flex items-start gap-2">
              <WifiOff className="mt-1 h-3.5 w-3.5 shrink-0" />
              {error}
            </span>
          </Alert>
        </div>
      ) : null}

      <div className="relative flex min-h-0 flex-1 flex-col">
        <MessageList
          key={`${activeWorkspaceId}-${currentConversation || "new"}`}
          messages={messages}
          loading={responding}
          loadingConversation={loadingConversation}
          typingMembers={conversationTypingMembers}
          onRetry={handleRetry}
          onRegenerate={handleRegenerate}
        />
        <div className="shrink-0 bg-gradient-to-t from-[var(--omnix-bg)] via-[rgba(5,12,23,0.94)] to-transparent px-2.5 pb-2.5 pt-3 sm:px-[22px] sm:pb-[18px] sm:pt-10">
          <ChatInput
            onSend={sendMessage}
            loading={responding}
            onCancel={() => activeStreamAbortRef.current?.abort()}
            conversationId={currentConversation || undefined}
            attachments={pendingAttachments}
            searchMode={searchMode}
            onSearchModeChange={setSearchMode}
            onUploadSuccess={handleUploadSuccess}
            onRemoveAttachment={handleRemoveAttachment}
            onTypingChange={(isTyping) => {
              void sendTypingSignal(currentConversationRef.current, isTyping);
            }}
          />
        </div>
      </div>
      </div>
    </section>
  );
}
