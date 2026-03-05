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
  const [isTyping, setIsTyping] = useState(false);

  const handleSend = (content: string) => {
    // Add user message
    const userMsg: Message = {
      id: Date.now().toString(),
      role: "user",
      content
    };
    
    setMessages(prev => [...prev, userMsg]);
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "ai",
        content: "This is a simulated response. The UI is now fully interactive, using `next/navigation` and Framer Motion micro-interactions."
      };
      setMessages(prev => [...prev, aiMsg]);
      setIsTyping(false);
    }, 2000); // 2 seconds typing simulation
  };

  return (
    <ChatLayout>
      <MessageList messages={messages} isTyping={isTyping} />
      <ChatInput onSend={handleSend} disabled={isTyping} />
    </ChatLayout>
  );
}
