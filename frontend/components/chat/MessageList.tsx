"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageSquare, ArrowDown } from "lucide-react";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import type { Message } from "@/components/chat/types";
import type { WorkspacePresenceMember } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

type MessageListProps = {
  messages: Message[];
  loading: boolean;
  loadingConversation?: boolean;
  onRetry?: (message: Message) => void;
  onRegenerate?: (assistantMessageId: string) => void;
  typingMembers?: WorkspacePresenceMember[];
};

function ConversationSkeleton() {
  return (
    <div className="omnix-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 sm:px-6">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className={`shimmer rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-4 shadow-[var(--omnix-glow-xs)] ${
            item === 1 ? "ml-auto w-[74%]" : "w-[82%] sm:w-[62%]"
          }`}
        >
          <div className="h-3 w-24 rounded-full bg-[var(--omnix-surface-hover)]" />
          <div className="mt-4 h-2.5 w-full rounded-full bg-[var(--omnix-surface-hover)]" />
          <div className="mt-2 h-2.5 w-2/3 rounded-full bg-[var(--omnix-surface-hover)]" />
        </div>
      ))}
    </div>
  );
}

export function MessageList({
  messages,
  loading,
  loadingConversation = false,
  onRetry,
  onRegenerate,
  typingMembers = [],
}: MessageListProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const wasAtBottomRef = useRef(true);
  const prevMessagesCountRef = useRef(messages.length);

  const scrollToBottom = useCallback((smooth = true) => {
    if (!endRef.current) return;
    
    // Use requestAnimationFrame to ensure the DOM has updated
    window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ 
        behavior: smooth ? "smooth" : "instant", 
        block: "end" 
      });
      
      // Force sync bottom state
      setIsAtBottom(true);
      wasAtBottomRef.current = true;
      setNewMessagesCount(0);
    });
  }, []);

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    // Using a threshold of 100px to detect if user is near bottom
    const atBottom = scrollHeight - scrollTop - clientHeight < 100;
    
    setIsAtBottom(atBottom);
    wasAtBottomRef.current = atBottom;
    
    if (atBottom) {
      setNewMessagesCount(0);
    }
  }, []);

  const isMessagesEmpty = messages.length === 0;
  // Initial scroll to bottom when conversation loads
  useEffect(() => {
    if (!loadingConversation && !isMessagesEmpty) {
      scrollToBottom(false);
    }
  }, [loadingConversation, isMessagesEmpty, scrollToBottom]);

  // Handle new messages and streaming auto-follow
  useEffect(() => {
    if (messages.length > prevMessagesCountRef.current) {
      const lastMessage = messages[messages.length - 1];
      const isUserMessage = lastMessage?.isOwn;
      
      // Auto-follow if we were already at bottom or if it's a new message from current user
      if (wasAtBottomRef.current || isUserMessage) {
        scrollToBottom(true);
      } else {
        // We are scrolled up, increment counter for new incoming messages
        setNewMessagesCount(prev => prev + (messages.length - prevMessagesCountRef.current));
      }
    } else if (loading && wasAtBottomRef.current) {
      // Keep following if streaming and we are at the bottom
      scrollToBottom(true);
    }
    
    prevMessagesCountRef.current = messages.length;
  }, [messages, loading, scrollToBottom]);

  if (loadingConversation) {
    return <ConversationSkeleton />;
  }

  if (messages.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: "easeOut" }}
        className="flex min-h-0 flex-1 flex-col items-center justify-center px-5 py-6 text-center sm:p-8"
      >
        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-200 shadow-[var(--omnix-glow-md)]">
          <span className="absolute inset-0 rounded-xl bg-cyan-300/10 blur-xl" />
          <span className="absolute -inset-4 rounded-full bg-[radial-gradient(circle,var(--omnix-rgba-rgba-0-255-255-0-2),transparent_70%)] opacity-70 [animation:auth-drift_12s_ease-in-out_infinite]" />
          <MessageSquare className="h-5 w-5" />
        </div>
        <h2 className="omnix-display mt-5 text-lg font-semibold text-white sm:text-xl">
          Ask Omnix anything your workspace should know
        </h2>
        <p className="mt-2 max-w-md text-sm leading-6 text-[var(--omnix-text-2)]">
          Start from a document, a customer question, or a knowledge gap. Omnix
          will save the thread and return a backend response.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div 
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="omnix-scrollbar flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4 pb-5 sm:gap-7 sm:px-7 sm:py-6 sm:pb-7 lg:px-9"
      >
        <AnimatePresence initial={false}>
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} onRetry={onRetry} onRegenerate={onRegenerate} />
          ))}
          {typingMembers.length ? (
            <motion.div
              key="collaborator-typing"
              layout
              className="flex w-full items-start gap-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-emerald-300/25 bg-emerald-300/10 text-xs font-bold text-emerald-100 shadow-[0_0_18px_var(--omnix-rgba-rgba-0-232-122-0-16)]">
                {typingMembers[0]?.avatar_label || "U"}
              </div>
              <TypingIndicator
                label={
                  typingMembers.length === 1
                    ? `${typingMembers[0]?.full_name || typingMembers[0]?.email || "A teammate"} is typing`
                    : `${typingMembers.length} teammates are typing`
                }
              />
            </motion.div>
          ) : null}
          {loading ? (
            <motion.div
              key="typing"
              layout
              className="flex w-full items-start gap-3"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            >
              <div className="mt-1 h-9 w-9 shrink-0 rounded-lg border border-cyan-300/30 bg-cyan-300/10 shadow-[var(--omnix-glow-xs)]" />
              <TypingIndicator />
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div ref={endRef} className="h-px w-full shrink-0" />
      </div>

      <AnimatePresence>
        {!isAtBottom && messages.length > 3 && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2"
          >
            <button
              onClick={() => scrollToBottom(true)}
              className={cn(
                "group relative flex h-10 w-10 items-center justify-center rounded-full border transition-all",
                "bg-[var(--omnix-surface)]/90 backdrop-blur-md shadow-[var(--omnix-glow-md)]",
                "hover:bg-[var(--omnix-surface)] hover:border-cyan-300/50 hover:scale-110 active:scale-95",
                newMessagesCount > 0 
                  ? "border-cyan-300/60 ring-2 ring-cyan-300/20" 
                  : "border-[var(--omnix-border)]"
              )}
              title="Jump to Latest"
            >
              {newMessagesCount > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cyan-500 px-1 text-[9px] font-bold text-[var(--omnix-color-050c17)] shadow-[0_0_10px_var(--omnix-rgba-rgba-6-182-212-0-6)] animate-in zoom-in duration-300">
                  {newMessagesCount}
                </span>
              )}
              <ArrowDown className="h-5 w-5 text-white transition-transform group-hover:translate-y-0.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

