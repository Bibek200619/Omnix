import { Suspense } from "react";
import { ChatInterface } from "@/components/chat/ChatInterface";

export default function ChatPage() {
  return (
    <Suspense fallback={<div className="text-sm text-slate-400">Loading chat...</div>}>
      <ChatInterface />
    </Suspense>
  );
}
