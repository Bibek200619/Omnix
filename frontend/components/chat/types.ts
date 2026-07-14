import type { WorkspaceRole } from "@/lib/workspace-types";

export type Message = {
  id: string;
  role: "user" | "assistant";
  userId?: string | null;
  senderName?: string;
  senderEmail?: string | null;
  senderAvatar?: string;
  senderAvatarUrl?: string | null;
  senderHandle?: string | null;
  senderRole?: WorkspaceRole | "assistant";
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
  sourceMode?: SearchMode;
  webSearchUsed?: boolean;
  citations?: string[];
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
    snippet?: string;
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
  page_count?: number | null;
  extractor_used?: string | null;
  extracted_character_count?: number | null;
  image_page_count?: number | null;
  text_page_count?: number | null;
  extraction_status?: "processing" | "searchable" | "ocr_required" | "extraction_failed" | null;
  extraction_failure_reason?: string | null;
  processing_status?: "uploaded" | "queued" | "extracting" | "chunking" | "embedding" | "ocr_required" | "ocr_running" | "searchable" | "partially_searchable" | "failed" | "processing" | "extracted" | "chunked" | "embedded" | null;
  processing_error?: string | null;
  processing_job_id?: string | null;
  ocr_used?: boolean | null;
  ocr_character_count?: number | null;
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
  payload?: Record<string, unknown> | null;
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
