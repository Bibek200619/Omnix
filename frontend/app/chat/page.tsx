"use client";
import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { MessageList } from "@/components/chat/MessageList";
import { ChatInput } from "@/components/chat/ChatInput";
import { sendMessage } from "@/lib/api";

interface Message {
  id: string;
  role: "user" | "ai";
  content: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = async (content: string) => {
    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    try {
      const data = await sendMessage(content);
      
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: data.response || "No response received."
      };
      setMessages(prev => [...prev, aiMsg]);
    } catch (error: any) {
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: "⚠️ Error: Could not connect to the backend server. Please make sure the FastAPI server is running."
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col h-full w-full">
        <MessageList messages={messages} isTyping={isTyping} />
        <ChatInput onSend={handleSend} disabled={isTyping} />
      </div>
    </AppLayout>
  );
}

