"use client";
import { useState } from "react";
import { ChatLayout } from "@/components/chat/ChatLayout";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);

  const handleSend = (content: string) => {
    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content
    };
    
    setMessages(prev => [...prev, userMsg]);

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: "This is a simulated response. In the future, this will connect to the FastAPI backend and use RAG to answer based on your documents."
      };
      setMessages(prev => [...prev, aiMsg]);
    }, 1000);
  };

  return (
    <ChatLayout>
      <MessageList messages={messages} />
      <ChatInput onSend={handleSend} />
    </ChatLayout>
  );
}
