"use client";

import Link from "next/link";
import { ClipboardCheck, LayoutDashboard, MessageSquare, MessagesSquare, MoreHorizontal } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

type MobileDockProps = {
  onMoreClick?: () => void;
};

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/conversations", label: "Threads", icon: MessagesSquare },
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
];

export function MobileDock({ onMoreClick }: MobileDockProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-cyan-300/10 bg-[rgba(5,12,23,0.92)] px-2 pb-[max(env(safe-area-inset-bottom),0.45rem)] pt-2 backdrop-blur-2xl lg:hidden"
    >
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-medium transition",
                active
                  ? "border-cyan-300/20 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                  : "border-transparent text-[var(--omnix-text-3)] active:bg-white/[0.05]",
              )}
            >
              <Icon className={cn("h-[19px] w-[19px]", active && "text-[var(--omnix-cyan)]")} />
              <span>{item.label}</span>
              {active ? <span className="absolute top-0.5 h-0.5 w-5 rounded-full bg-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)]" /> : null}
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onMoreClick}
          aria-label="Open more navigation"
          title="Open more navigation"
          className="relative flex min-h-[48px] flex-col items-center justify-center gap-1 rounded-xl border border-transparent text-[10px] font-medium text-[var(--omnix-text-3)] transition active:bg-white/[0.05]"
        >
          <MoreHorizontal className="h-[19px] w-[19px]" />
          <span>More</span>
        </button>
      </div>
    </nav>
  );
}
