"use client";

import { AtSign, Bell, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useWorkspaceNotifications } from "@/lib/workspace-notifications-context";
import { cn } from "@/lib/utils";

function countLabel(count: number) {
  if (count > 99) return "99+";
  return String(count);
}

export function NotificationBell() {
  const router = useRouter();
  const { unreadCount, loading, refreshNotifications } = useWorkspaceNotifications();
  const hasUnread = unreadCount > 0;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={
        unreadCount === 1
          ? "Mention notifications, 1 unread"
          : `Mention notifications, ${unreadCount} unread`
      }
      title="Mention notifications"
      onClick={() => {
        void refreshNotifications();
        router.push("/notifications");
      }}
      className="relative h-10 w-10 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] sm:h-9 sm:w-9"
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <span className="relative inline-flex">
          <Bell className="h-4 w-4" />
          <AtSign className="absolute -bottom-1 -right-1 h-2.5 w-2.5 rounded-full bg-[var(--omnix-surface)] text-cyan-100/70" />
        </span>
      )}
      <span
        className={cn(
          "absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full border px-1 text-[10px] font-semibold leading-none",
          hasUnread
            ? "border-cyan-300/25 bg-cyan-300/15 text-cyan-50 shadow-[0_0_14px_rgba(0,255,255,0.16)]"
            : "border-white/10 bg-white/[0.04] text-white/40",
        )}
      >
        {countLabel(unreadCount)}
      </span>
    </Button>
  );
}
