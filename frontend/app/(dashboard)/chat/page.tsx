"use client";

import { PageSkeleton } from "@/components/ui/PageSkeleton";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const ChatInterface = dynamic(
  () => import("@/components/chat/ChatInterface").then((mod) => ({ default: mod.ChatInterface })),
  { ssr: false, loading: () => <div className="text-sm text-slate-400">Loading chat...</div> },
);

export default function ChatPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChatPageContent />
    </Suspense>
  );
}

function ChatPageContent() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400">Loading chat...</div>}>
      <ChatInterface />
    </Suspense>
  );
}
