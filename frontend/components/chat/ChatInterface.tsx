"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, FileSearch, ShieldCheck, Users, WifiOff } from "lucide-react";
import dynamic from "next/dynamic";
const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });
import { FileText } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type {
  ApiMessage,
  Message,
} from "@/components/chat/types";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";

function formatTime(value?: string) {
  const date = value ? new Date(value) : new Date();

  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(Number.isNaN(date.getTime()) ? new Date() : date);
}

function normalizeMessage(message: ApiMessage, index: number): Message {
  const failed = message.status === "failed";
  const pending = message.status === "pending";
  const role = message.role === "user" ? "user" : "assistant";
  const content =
    message.content ||
    (failed && role === "assistant"
      ? "The assistant response failed before it could be completed."
      : "");

  return {
    id: message.id ?? `message-${index}`,
    role,
    content,
    timestamp: formatTime(message.timestamp ?? message.created_at),
    status: failed ? "failed" : pending ? "sending" : "sent",
    error: failed ? "Not completed" : undefined,
  };
}

interface FileData {
  id: string;
  file_name?: string;
  filename?: string;
  file_type?: string;
  content_type?: string;
  size_bytes?: number;
  storage_path?: string;
}

type StreamEvent = {
  type: "init" | "status" | "token" | "error" | "done";
  conversation_id?: string;
  user_message_id?: string;
  assistant_message_id?: string;
  sources?: Message["sources"];
  status?: string;
  text?: string;
  detail?: string;
};

export function ChatInterface() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const { activeWorkspace, activeMembers, activeWorkspaceId } = useWorkspace();
  const {
    refreshConversations,
    setActiveConversation,
  } = useConversationHistory();
  const conversationId = params.get("conversation");

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

  const [chatFiles, setChatFiles] = useState<FileData[]>([]);
  const [showUpload, setShowUpload] = useState(false);
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];

  useEffect(() => {
    if (currentConversation) {
      apiClient.get<FileData[]>("/files?conversation_id=" + currentConversation).then(setChatFiles).catch(console.error);
    } else {
      setChatFiles([]);
    }
  }, [currentConversation]);


  const loadConversation = useCallback(
    async (convId: string) => {
      try {
        setLoadingConversation(true);
        setError(null);
        const data = await apiClient.get<ApiMessage[]>(
          `/conversations/${convId}/messages`,
        );
        setMessages(data.map(normalizeMessage));
        setCurrentConversation(convId);
        setCurrentConversationWorkspaceId(activeWorkspaceId);
        setActiveConversation(convId);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to load conversation";
        setError(message);
        setMessages([]);

        if (message.toLowerCase().includes("conversation not found")) {
          setCurrentConversation(null);
          setActiveConversation(null);
          await refreshConversations();
          router.replace("/chat", { scroll: false });
        }
      } finally {
        setLoadingConversation(false);
      }
    },
    [activeWorkspaceId, refreshConversations, router, setActiveConversation],
  );

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
      return;
    }

    setCurrentConversation(null);
    setCurrentConversationWorkspaceId(activeWorkspaceId);
    setActiveConversation(null);
    setMessages([]);
    setError(null);
  }, [activeWorkspaceId, conversationId, loadConversation, setActiveConversation]);

  useEffect(() => {
    if (!currentConversation) {
      return;
    }

    if (currentConversationWorkspaceId !== activeWorkspaceId) {
      setCurrentConversation(null);
      setCurrentConversationWorkspaceId(activeWorkspaceId);
      setChatFiles([]);
      setMessages([]);
      setActiveConversation(null);
      router.replace("/chat", { scroll: false });
    }
  }, [activeWorkspaceId, currentConversation, currentConversationWorkspaceId, router, setActiveConversation]);

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
        label: "Memory",
        value: activeWorkspace?.is_shared
          ? `Shared with ${activeWorkspace.member_count} members`
          : "Private to this workspace",
        color: "text-emerald-200",
      },
      {
        icon: ShieldCheck,
        label: "Access",
        value: activeWorkspace?.current_user_role === "owner"
          ? "Owner controls"
          : session?.user?.email ?? "Collaborator",
        color: "text-amber-200",
      },
    ],
    [activeWorkspace, session?.user?.email],
  );

  const sendMessage = useCallback(
    async (content: string, retryMessageId?: string) => {
      if (responding) return;

      const messageId = retryMessageId ?? crypto.randomUUID();
      const userMessage: Message = {
        id: messageId,
        role: "user",
        content,
        timestamp: formatTime(),
        status: "sending",
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

      // keep responding true until streaming completes
      setResponding(true);
      setError(null);

      try {
        // Use streaming endpoint when available
        const resp = await apiClient.stream("/chat/stream", {
          method: "POST",
          body: JSON.stringify({ message: content, conversation_id: currentConversation || undefined }),
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

        // stateful ids for updating messages
        let assistantId: string | null = null;
        let persistedUserMessageId: string | null = null;

        const handleStreamEvent = (obj: StreamEvent) => {
          const t = obj.type;
          if (t === "init") {
            // persist conversation & user message ids
            if (obj.conversation_id) {
              setCurrentConversation(obj.conversation_id);
              setCurrentConversationWorkspaceId(activeWorkspaceId);
              setActiveConversation(obj.conversation_id);
            }
            persistedUserMessageId = obj.user_message_id ?? null;
            assistantId = obj.assistant_message_id ?? crypto.randomUUID();

            // update messages list: replace optimistic user message and add assistant placeholder
            setMessages((current) =>
              current.map((message) =>
                message.id === messageId
                  ? {
                      ...message,
                      id: persistedUserMessageId ?? message.id,
                      status: "sent",
                    }
                  : message,
              ),
            );

            setMessages((current) => [
              ...current,
              {
                id: assistantId as string,
                role: "assistant",
                content: "",
                timestamp: formatTime(),
                status: "streaming",
                isStreaming: true,
                sources: obj.sources ?? [],
              },
            ]);
          } else if (t === "status") {
            // Status events are transport metadata. Keep them out of the
            // persisted assistant text so streamed tokens remain clean.
            return;
          } else if (t === "token") {
            if (!assistantId) return;
            const txt = obj.text ?? "";
            setMessages((current) =>
              current.map((m) => (m.id === assistantId ? { ...m, content: (m.content || "") + txt } : m)),
            );
          } else if (t === "error") {
            const detail = obj.detail ?? "Unknown error";
            if (assistantId) {
              setMessages((current) =>
                current.map((m) => (m.id === assistantId ? { ...m, status: "failed", isStreaming: false, error: detail } : m)),
              );
            }
          } else if (t === "done") {
            if (assistantId) {
              setMessages((current) =>
                current.map((m) => (m.id === assistantId ? { ...m, status: "sent", isStreaming: false } : m)),
              );
            }
            // update conversation url
            if (!conversationId && obj.conversation_id) {
              router.replace(`/chat?conversation=${obj.conversation_id}`, { scroll: false });
            }
            void refreshConversations();
          }
        };

        // read loop
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split(/\n\n/);
          buffer = parts.pop() || "";
          for (const part of parts) processEvent(part);
        }

      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to send message";
        setError(message);
        refreshConversations();
        setMessages((current) =>
          current.map((item) =>
            item.id === messageId
              ? { ...item, status: "failed", error: "Not sent" }
              : item,
          ),
        );
      } finally {
        // ensure responding is cleared when streaming completes or error occurred
        setResponding(false);
      }
    },
    [
      conversationId,
      currentConversation,
      activeWorkspaceId,
      refreshConversations,
      responding,
      router,
      setActiveConversation,
    ],
  );

  function handleRetry(message: Message) {
    sendMessage(message.content, message.id);
  }

  function handleRegenerate(assistantMessageId: string) {
    // find the preceding user message and resend it
    const idx = messages.findIndex((m) => m.id === assistantMessageId);
    if (idx <= 0) return;
    const prev = messages[idx - 1];
    if (!prev || prev.role !== "user") return;
    sendMessage(prev.content);
  }

  function handlePromptSelect(prompt: string) {
    sendMessage(prompt);
  }

  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-3">
        {statusItems.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition hover:border-white/15 hover:bg-white/[0.055]"
            >
              <div className="flex items-center gap-3">
                <Icon className={`h-5 w-5 ${item.color}`} />
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                    {item.label}
                  </p>
                  <p className="truncate text-sm font-medium text-white">
                    {item.value}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {activeWorkspace ? (
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-white">
              <Users className="h-4 w-4 text-cyan-200" />
              Collaborative AI context
            </div>
            <p className="mt-1 text-sm leading-6 text-slate-400">
              {activeWorkspace.is_shared
                ? `Retrieval and conversation history are shared across ${activeWorkspace.name}.`
                : `This workspace keeps knowledge isolated to you until you invite teammates.`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
            <div className="text-right text-xs text-slate-400">
              <div>{activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "contributor" : "contributors"}</div>
              <div>{activeWorkspace.current_user_role === "owner" ? "Owner" : "Member"}</div>
            </div>
          </div>
        </div>
      ) : null}
      {error ? (
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
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <MessageList
          messages={messages}
          loading={responding}
          loadingConversation={loadingConversation}
          onRetry={handleRetry}
          onPromptSelect={handlePromptSelect}
          onRegenerate={handleRegenerate}
        />
        
        <div className="w-full mx-auto mb-2">
            {chatFiles.length > 0 && (
              <div className="mb-3">
                <p className="mb-2 text-xs font-medium text-slate-400">
                  {activeWorkspace?.is_shared ? "Workspace sources in this thread:" : "Retrieved sources in this thread:"}
                </p>
                <div className="flex flex-wrap gap-2">
                  {chatFiles.map(f => (
                    <div key={f.id as string} className="flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-md px-3 py-1.5 text-xs text-slate-200">
                      <FileText className="w-3 h-3 text-cyan-400" />
                      <span className="truncate max-w-[150px]">{f.file_name as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {showUpload && (
              <div className="mb-4">
                <UploadDropzone conversationId={currentConversation || undefined} onUploadSuccess={() => {
                  if (currentConversation) {
                    apiClient.get<FileData[]>("/files?conversation_id=" + currentConversation).then(setChatFiles).catch(console.error);
                  }
                }} />
              </div>
            )}
            <div className="flex justify-end mb-2">
              <Button variant="ghost" size="sm" onClick={() => setShowUpload(!showUpload)} className="text-xs text-slate-400">
                {showUpload ? "Hide upload" : activeWorkspace?.is_shared ? "Attach to workspace" : "Attach document"}
              </Button>
            </div>
        </div>

        <ChatInput onSend={sendMessage} loading={responding} />
      </div>
    </section>
  );
}
