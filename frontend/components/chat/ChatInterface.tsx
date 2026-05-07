"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Database, FileSearch, ShieldCheck, WifiOff } from "lucide-react";
import dynamic from "next/dynamic";
const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });
import { FileText } from "lucide-react";
import { ChatInput } from "@/components/chat/ChatInput";
import { MessageList } from "@/components/chat/MessageList";
import type {
  ApiMessage,
  ChatApiResponse,
  ConversationSummary,
  Message,
} from "@/components/chat/types";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useConversationHistory } from "@/lib/conversation-history-context";

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

function optimisticConversation(
  conversationId: string,
  content: string,
): ConversationSummary {
  const compact = content.replace(/\s+/g, " ").trim();
  const title = compact.length > 72 ? `${compact.slice(0, 69)}...` : compact;
  const timestamp = new Date().toISOString();

  return {
    id: conversationId,
    title: title || "New conversation",
    preview: compact,
    latest_message_role: "user",
    latest_message_at: timestamp,
    last_message_at: timestamp,
    updated_at: timestamp,
    created_at: timestamp,
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

export function ChatInterface() {
  const params = useSearchParams();
  const router = useRouter();
  const { session } = useAuth();
  const {
    refreshConversations,
    setActiveConversation,
    upsertConversation,
  } = useConversationHistory();
  const conversationId = params.get("conversation");

  const [messages, setMessages] = useState<Message[]>([]);
  const [responding, setResponding] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);
    const [currentConversation, setCurrentConversation] = useState<string | null>(
    conversationId,
  );

  const [chatFiles, setChatFiles] = useState<FileData[]>([]);
  const [showUpload, setShowUpload] = useState(false);

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
    [refreshConversations, router, setActiveConversation],
  );

  useEffect(() => {
    if (conversationId) {
      loadConversation(conversationId);
      return;
    }

    setCurrentConversation(null);
    setActiveConversation(null);
    setMessages([]);
    setError(null);
  }, [conversationId, loadConversation, setActiveConversation]);

  const statusItems = useMemo(
    () => [
      {
        icon: Database,
        label: "Retrieval",
        value: currentConversation ? "Context attached" : "Ready",
        color: "text-cyan-200",
      },
      {
        icon: ShieldCheck,
        label: "Session",
        value: session?.user?.email ?? "Authenticated",
        color: "text-emerald-200",
      },
      {
        icon: FileSearch,
        label: "Workspace",
        value: currentConversation ? "Saved thread" : "Draft thread",
        color: "text-amber-200",
      },
    ],
    [currentConversation, session?.user?.email],
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
              const obj = JSON.parse(payload);
              handleStreamEvent(obj);
            } catch (e) {
              console.error("Failed to parse stream payload", payload, e);
            }
          }
        };

        // stateful ids for updating messages
        let assistantId: string | null = null;
        let persistedUserMessageId: string | null = null;

        const handleStreamEvent = (obj: any) => {
          const t = obj.type;
          if (t === "init") {
            // persist conversation & user message ids
            if (obj.conversation_id) {
              setCurrentConversation(obj.conversation_id);
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
            // optionally show retrieval progress
            // we display a short status message in the assistant content
            const st = obj.status;
            if (assistantId && st) {
              setMessages((current) =>
                current.map((m) =>
                  m.id === assistantId
                    ? { ...m, content: `...${st}...` }
                    : m,
                ),
              );
            }
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
          }
        };

        // read loop
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let parts = buffer.split(/\n\n/);
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
      refreshConversations,
      responding,
      router,
      setActiveConversation,
      upsertConversation,
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
                <p className="text-xs font-medium text-slate-400 mb-2">Using retrieved sources:</p>
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
                {showUpload ? "Hide Upload" : "Attach Document"}
              </Button>
            </div>
        </div>

        <ChatInput onSend={sendMessage} loading={responding} />
      </div>
    </section>
  );
}
