"use client";
import { useEffect, useRef } from "react";
import { MessageBubble } from "./MessageBubble";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

export function MessageList({ messages }: { messages: Message[] }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
      {messages.length === 0 ? (
        <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
          <div className="w-20 h-20 bg-white/5 rounded-3xl flex items-center justify-center mb-8 border border-white/10 shadow-2xl relative overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-blue-500/20" />
            <span className="text-4xl relative z-10">🤖</span>
          </div>
          <h2 className="text-3xl font-bold mb-4 tracking-tight">How can I help you today?</h2>
          <p className="text-gray-400 text-lg leading-relaxed">
            Upload documents to query them, or just ask me a general question. I'm ready when you are.
          </p>
        </div>
      ) : (
        <div className="space-y-2 pb-4">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} role={msg.role} content={msg.content} />
          ))}
        </div>
      )}
      <div ref={bottomRef} className="h-4" />
    </div>
  );
}
