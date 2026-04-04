export type Message = {
  id: string;
  role: "user" | "assistant";
  userId?: string | null;
  senderName?: string;
  senderEmail?: string | null;
  senderAvatar?: string;
  senderAvatarUrl?: string | null;
  senderHandle?: string | null;
  senderRole?: "owner" | "co_owner" | "member" | "assistant";
  isOwn?: boolean;
  content: string;
  timestamp: string;
  createdAt?: string;
  // status now supports streaming to reflect progressive reveal
  status?: "sending" | "streaming" | "sent" | "failed";
  error?: string;
  attachments?: MessageAttachment[];
  // UI helpers
  isStreaming?: boolean;
  // optional sources attached to assistant responses
  sources?: Array<{
    id?: string;
    label?: string;
    type?: string;
    title?: string;
    url?: string;
    domain?: string;
    favicon_url?: string;
    published_date?: string;
    excerpt?: string;
    chunk_preview?: string;
    score?: number;
    chunk_index?: number | null;
    file_id?: string | null;
    metadata?: Record<string, unknown>;
  }>;
};

export type MessageAttachment = {
  id: string;
  file_name?: string;
  filename?: string;
  file_type?: string;
  content_type?: string;
  size_bytes?: number;
  storage_path?: string;
  conversation_id?: string | null;
  workspace_id?: string | null;
  created_at?: string;
  metadata?: Record<string, unknown> | null;
};

export type ApiMessage = {
  id?: string;
  conversation_id?: string;
  user_id?: string;
  role?: "user" | "assistant" | "system";
  content?: string;
  status?: "pending" | "completed" | "failed";
  created_at?: string;
  timestamp?: string;
  metadata?: Record<string, unknown> | null;
  sources?: Message["sources"];
};

export type ConversationSummary = {
  id: string;
  user_id?: string;
  title?: string | null;
  preview?: string | null;
  latest_message_role?: string | null;
  latest_message_at?: string | null;
  is_archived?: boolean | null;
  workspace_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_message_at?: string | null;
};

export type ChatApiResponse = {
  conversation_id: string;
  user_message_id: string;
  assistant_message_id: string;
  response: string;
  sources?: Array<Record<string, unknown>>;
  conversation?: ConversationSummary | null;
  user_message?: ApiMessage | null;
  assistant_message?: ApiMessage | null;
};

export type SearchMode = "auto" | "workspace" | "web" | "hybrid";
