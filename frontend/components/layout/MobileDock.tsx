"use client";

import Link from "next/link";
import { Bell, ClipboardCheck, FileText, LayoutDashboard, MessageSquare, MoreHorizontal, Search } from "lucide-react";
import { usePathname } from "next/navigation";
import { useWorkspaceNotifications } from "@/lib/workspace-notifications-context";
import { cn } from "@/lib/utils";

type MobileDockProps = {
  onMoreClick?: () => void;
};

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { action: "search", label: "Search", icon: Search },
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/notifications", label: "Alerts", icon: Bell },
] as const;

export function MobileDock({ onMoreClick }: MobileDockProps) {
  const pathname = usePathname();
  const { unreadCount } = useWorkspaceNotifications();
  const hasUnreadNotifications = unreadCount > 0;

  function openCommandPalette() {
    window.dispatchEvent(new Event("omnix:open-command-palette"));
  }

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-cyan-300/10 bg-[var(--omnix-rgba-5-12-23-0-92)] px-2 pb-[max(env(safe-area-inset-bottom),0.45rem)] pt-2 backdrop-blur-2xl lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-7 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          if ("action" in item) {
            return (
              <button
                key={item.action}
                type="button"
                onClick={openCommandPalette}
                aria-label="Open workspace search"
                title="Open workspace search"
                className="relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent text-[10px] font-medium text-[var(--omnix-text-3)] transition active:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
              >
                <Icon className="h-[19px] w-[19px]" />
                <span>{item.label}</span>
              </button>
            );
          }
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const showUnreadBadge = item.href === "/notifications" && hasUnreadNotifications;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={showUnreadBadge ? `${item.label}, ${unreadCount} unread` : undefined}
              className={cn(
                "relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-medium transition",
                active
                  ? "border-cyan-300/20 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                  : "border-transparent text-[var(--omnix-text-3)] active:bg-white/[0.05]",
              )}
            >
              <Icon className={cn("h-[19px] w-[19px]", active && "text-[var(--omnix-cyan)]")} />
              <span>{item.label}</span>
              {showUnreadBadge ? (
                <span
                  className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_var(--omnix-rgba-251-113-133-0-8)]"
                  aria-hidden="true"
                />
              ) : null}
              {active ? <span className="absolute top-0.5 h-0.5 w-5 rounded-full bg-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)]" /> : null}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onMoreClick}
          aria-label={hasUnreadNotifications ? `Open more navigation, ${unreadCount} unread notifications` : "Open more navigation"}
          title="Open more navigation"
          className="relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent text-[10px] font-medium text-[var(--omnix-text-3)] transition active:bg-white/[0.05]"
        >
          <MoreHorizontal className="h-[19px] w-[19px]" />
          <span>More</span>
          {hasUnreadNotifications ? (
            <span
              className="absolute right-2 top-2 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_var(--omnix-rgba-251-113-133-0-8)]"
              aria-hidden="true"
            />
          ) : null}
        </button>
      </div>
    </nav>
  );
}
