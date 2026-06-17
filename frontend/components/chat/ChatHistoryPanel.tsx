"use client";

import { ChevronLeft, MessageSquare, Pin, Search } from "lucide-react";
import type { ConversationSummary } from "@/components/chat/types";
import { formatChatTime } from "@/components/chat/useChatMessages";

type ChatHistoryPanelProps = {
  activeHistoryItem?: ConversationSummary;
  historyOpen: boolean;
  onClose: () => void;
  onOpenConversation: (conversationId: string) => void;
  onStartNew: () => void;
  visibleHistory: ConversationSummary[];
};

export function ChatHistoryPanel({
  activeHistoryItem,
  historyOpen,
  onClose,
  onOpenConversation,
  onStartNew,
  visibleHistory,
}: ChatHistoryPanelProps) {
  if (!historyOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm transition-opacity md:hidden"
        onClick={onClose}
      />
      <aside className="fixed inset-y-0 left-0 z-50 flex w-[280px] shrink-0 flex-col border-r border-[var(--omnix-border)] bg-[rgba(5,12,23,0.98)] shadow-[18px_0_70px_rgba(0,0,0,0.24)] backdrop-blur-2xl md:relative md:z-10 md:w-[264px] md:flex md:bg-[rgba(5,12,23,0.6)]">
        <div className="flex items-center gap-2 border-b border-[var(--omnix-border)] px-3 py-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--omnix-text-3)]" />
            <input
              type="text"
              placeholder="Search chats..."
              className="omnix-input h-[30px] w-full rounded-full pl-7 pr-3 text-xs"
              readOnly
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="omnix-ghost-action flex h-[26px] w-[26px] items-center justify-center rounded-[7px]"
            aria-label="Close history"
            title="Close history"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="omnix-scrollbar flex-1 overflow-y-auto px-2 py-2">
          <div className="mb-3">
            <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
              <Pin className="h-2.5 w-2.5" />
              Pinned
            </div>
            {activeHistoryItem ? (
              <button
                type="button"
                onClick={() => onOpenConversation(activeHistoryItem.id)}
                className="w-full rounded-[8px] border border-cyan-300/15 bg-cyan-300/[0.07] px-2.5 py-2 text-left shadow-[var(--omnix-glow-xs)] transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
              >
                <div className="mb-0.5 flex justify-between gap-2">
                  <span className="truncate text-xs font-medium text-white">{activeHistoryItem.title || "Omnix conversation"}</span>
                  <span className="text-[10px] text-[var(--omnix-cyan)]">Now</span>
                </div>
                <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">
                  {activeHistoryItem.preview || "Workspace context ready..."}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartNew}
                className="w-full rounded-[8px] border border-cyan-300/15 bg-cyan-300/[0.07] px-2.5 py-2 text-left shadow-[var(--omnix-glow-xs)] transition hover:border-cyan-300/30 hover:bg-cyan-300/10"
              >
                <div className="mb-0.5 flex justify-between gap-2">
                  <span className="truncate text-xs font-medium text-white">New AI session</span>
                  <span className="text-[10px] text-[var(--omnix-cyan)]">Now</span>
                </div>
                <span className="block truncate text-[11px] text-[var(--omnix-text-2)]">
                  Start a collaborative intelligence thread.
                </span>
              </button>
            )}
          </div>

          <div>
            <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">
              <MessageSquare className="h-2.5 w-2.5" />
              Recent
            </div>
            {visibleHistory.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onOpenConversation(conversation.id)}
                className="mb-px w-full rounded-[8px] border border-transparent px-2.5 py-2 text-left transition hover:bg-[var(--omnix-surface)]"
              >
                <div className="mb-0.5 flex justify-between gap-2">
                  <span className="max-w-[150px] truncate text-xs font-medium text-[var(--omnix-text-2)]">
                    {conversation.title || "Omnix conversation"}
                  </span>
                  <span className="shrink-0 text-[10px] text-[var(--omnix-text-3)]">
                    {formatChatTime(
                      conversation.latest_message_at ??
                        conversation.last_message_at ??
                        conversation.updated_at ??
                        conversation.created_at ??
                        undefined,
                    )}
                  </span>
                </div>
                <span className="block truncate text-[11px] text-[var(--omnix-text-3)]">
                  {conversation.preview || "No preview yet"}
                </span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
