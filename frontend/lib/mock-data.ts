import type { Message } from "@/components/chat/types";

export type ChatSummary = {
  id: string;
  title: string;
  excerpt: string;
  updatedAt: string;
  messageCount: number;
  messages: Message[];
};

export const starterMessages: Message[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "Welcome to Omnix. Ask a question and I will answer in the shape of a RAG assistant, ready to connect to your backend.",
    timestamp: "Now",
  },
];

export const mockChats: ChatSummary[] = [
  {
    id: "rag-eval",
    title: "RAG evaluation plan",
    excerpt: "Compare retrieved chunks, latency, and answer quality across uploads.",
    updatedAt: "Today, 10:42",
    messageCount: 8,
    messages: [
      {
        id: "rag-1",
        role: "user",
        content: "How should we evaluate retrieval quality before adding a production LLM?",
        timestamp: "10:39",
      },
      {
        id: "rag-2",
        role: "assistant",
        content:
          "Start with a small golden dataset, inspect top-k chunks, and track answer faithfulness separately from retrieval recall. The UI can expose citations once the backend returns source metadata.",
        timestamp: "10:40",
      },
    ],
  },
  {
    id: "supabase-auth",
    title: "Supabase auth handoff",
    excerpt: "Map the future login, register, verify, and profile flows to API contracts.",
    updatedAt: "Yesterday",
    messageCount: 5,
    messages: [
      {
        id: "auth-1",
        role: "user",
        content: "What does the frontend need from Supabase auth?",
        timestamp: "16:12",
      },
      {
        id: "auth-2",
        role: "assistant",
        content:
          "The frontend needs session creation, OTP verification, token refresh, and a profile endpoint. For now these screens are mocked with the same navigation shape.",
        timestamp: "16:13",
      },
    ],
  },
  {
    id: "upload-roadmap",
    title: "Document upload roadmap",
    excerpt: "Plan upload progress, ingestion states, and source-aware answers.",
    updatedAt: "Apr 28",
    messageCount: 12,
    messages: [
      {
        id: "upload-1",
        role: "user",
        content: "How should the document upload states look?",
        timestamp: "09:05",
      },
      {
        id: "upload-2",
        role: "assistant",
        content:
          "Use clear ingestion states: uploaded, chunking, embedded, indexed, and failed. History can surface the last file attached to a conversation later.",
        timestamp: "09:06",
      },
    ],
  },
];
