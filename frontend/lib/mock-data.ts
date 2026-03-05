export type ChatPreview = {
  id: string;
  title: string;
  summary: string;
  updatedAt: string;
  messageCount: number;
};

export const chatHistory: ChatPreview[] = [
  {
    id: "rag-roadmap",
    title: "RAG launch checklist",
    summary: "Chunking strategy, embeddings, retrieval metrics, and handoff notes.",
    updatedAt: "Today, 4:22 PM",
    messageCount: 18
  },
  {
    id: "supabase-auth",
    title: "Supabase auth flow",
    summary: "Email verification, profile metadata, and session refresh behavior.",
    updatedAt: "Yesterday, 8:10 PM",
    messageCount: 11
  },
  {
    id: "policy-answers",
    title: "Policy answer quality",
    summary: "Grounded responses with citation slots and confidence language.",
    updatedAt: "Apr 29, 2026",
    messageCount: 7
  }
];
