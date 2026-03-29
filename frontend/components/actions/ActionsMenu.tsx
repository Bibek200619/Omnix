"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Edit3, Ellipsis, Eraser, Loader2, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useConversationHistory } from "@/lib/conversation-history-context";
import type { ApiMessage } from "@/components/chat/types";
import { cn } from "@/lib/utils";

type BusyAction = "rename" | "clear" | "delete" | "export" | null;

export function ActionsMenu({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();
  const params = useSearchParams();
  const {
    activeConversationId,
    archiveConversation,
    conversations,
    refreshConversations,
    renameConversation,
  } = useConversationHistory();
  const conversationId = params.get("conversation") || activeConversationId;
  const activeConversation = conversations.find((item) => item.id === conversationId);
  const disabled = !conversationId || Boolean(busyAction);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  async function runAction(action: BusyAction, task: () => Promise<void>) {
    if (!action || !conversationId) return;

    try {
      setBusyAction(action);
      setError(null);
      await task();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRename() {
    if (!conversationId) return;
    const nextTitle = window.prompt(
      "Rename chat",
      activeConversation?.title || "Untitled conversation",
    );
    if (nextTitle === null || !nextTitle.trim()) return;

    await runAction("rename", async () => {
      await renameConversation(conversationId, nextTitle.trim());
      await refreshConversations();
    });
  }

  async function handleClear() {
    if (!conversationId) return;
    const confirmed = window.confirm("Clear all messages in this conversation?");
    if (!confirmed) return;

    await runAction("clear", async () => {
      await apiClient.delete(`/conversations/${conversationId}/messages`);
      window.dispatchEvent(
        new CustomEvent("omnix:conversation-cleared", {
          detail: { conversationId },
        }),
      );
      await refreshConversations();
    });
  }

  async function handleDelete() {
    if (!conversationId) return;
    const confirmed = window.confirm("Delete this conversation?");
    if (!confirmed) return;

    await runAction("delete", async () => {
      await archiveConversation(conversationId);
      router.push("/chat");
    });
  }

  async function handleExport() {
    if (!conversationId) return;

    await runAction("export", async () => {
      const messages = await apiClient.get<ApiMessage[]>(`/conversations/${conversationId}/messages`);
      const body = messages
        .map((message) => {
          const role = message.role === "assistant" ? "Assistant" : "User";
          const content = (message.content || "").trim();
          return `## ${role}\n\n${content || "_No content_"}`;
        })
        .join("\n\n");
      const title = activeConversation?.title || "Omnix conversation";
      const blob = new Blob([`# ${title}\n\n${body}\n`], { type: "text/markdown" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "omnix-chat"}.md`;
      anchor.click();
      URL.revokeObjectURL(url);
    });
  }

  const items = [
    { label: "Rename chat", icon: Edit3, action: handleRename, key: "rename" as const },
    { label: "Clear conversation", icon: Eraser, action: handleClear, key: "clear" as const },
    { label: "Export conversation", icon: Download, action: handleExport, key: "export" as const },
    { label: "Delete conversation", icon: Trash2, action: handleDelete, key: "delete" as const, danger: true },
  ];

  return (
    <div ref={menuRef} className={cn("relative", className)}>
      <Button
        type="button"
        variant="secondary"
        rightIcon={busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ellipsis className="h-4 w-4" />}
        onClick={() => {
          setError(null);
          setOpen((current) => !current);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Conversation actions"
      >
        <span className="hidden md:inline">Actions</span>
      </Button>

      {open ? (
        <div
          role="menu"
          aria-label="Conversation actions"
          className="absolute right-0 top-full z-[100] mt-2 w-64 overflow-hidden rounded-lg border border-white/12 bg-[#05070b] p-1 shadow-[0_24px_70px_rgba(0,0,0,0.65)] ring-1 ring-black/40"
        >
          <div className="border-b border-white/8 px-3 py-2">
            <p className="truncate text-sm font-medium text-white">
              {activeConversation?.title || (conversationId ? "Untitled conversation" : "No active chat")}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {conversationId ? "Conversation tools" : "Start or open a chat first"}
            </p>
          </div>

          <div className="py-1">
            {items.map((item) => {
              const Icon = item.icon;
              const isBusy = busyAction === item.key;

              return (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={disabled}
                  onClick={item.action}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60 disabled:cursor-not-allowed disabled:opacity-45",
                    item.danger
                      ? "text-rose-100 hover:bg-rose-400/10"
                      : "text-slate-200 hover:bg-white/[0.06] hover:text-white",
                  )}
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {error ? (
            <div className="border-t border-rose-400/20 bg-rose-400/10 px-3 py-2 text-xs leading-5 text-rose-100">
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
