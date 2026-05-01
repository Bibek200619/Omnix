"use client";

import * as React from "react";
import { MessageBubble, type ChatMessage } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";

type MessageListProps = {
  messages: ChatMessage[];
  loading: boolean;
};

export function MessageList({ messages, loading }: MessageListProps) {
  const endRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  return (
    <div className="thin-scrollbar flex-1 overflow-y-auto px-3 py-5 sm:px-6">
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        {messages.map((message) => (
          <MessageBubble key={message.id} message={message} />
        ))}
        {loading ? <TypingIndicator /> : null}
        <div ref={endRef} />
      </div>
    </div>
  );
}
