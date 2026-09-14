"use client";

import Link from "next/link";
import { BadgeCheck, ClipboardCheck, Compass, FileText, LayoutDashboard, MessageSquare, Settings } from "lucide-react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
  { href: "/files", label: "Files", icon: FileText },
  { href: "/decisions", label: "Decisions", icon: BadgeCheck },
  { href: "/initiatives", label: "Initiatives", icon: Compass },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

export function MobileDock() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-cyan-300/10 bg-[var(--omnix-rgba-5-12-23-0-92)] pb-[max(env(safe-area-inset-bottom),0.45rem)] pl-[max(env(safe-area-inset-left),0.25rem)] pr-[max(env(safe-area-inset-right),0.25rem)] pt-2 backdrop-blur-2xl lg:hidden"
    >
      <div className="mx-auto grid max-w-xl grid-cols-7 gap-px">
        {items.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex !min-h-[48px] min-w-0 touch-manipulation flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55",
                active
                  ? "border-cyan-300/20 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                  : "border-transparent text-[var(--omnix-text-3)] hover:bg-white/[0.05] active:bg-white/[0.05]",
              )}
            >
              <Icon aria-hidden="true" className={cn("h-[19px] w-[19px]", active && "text-[var(--omnix-cyan)]")} />
              <span className="max-w-full truncate">{item.label}</span>
              {active ? <span className="absolute top-0.5 h-0.5 w-5 rounded-full bg-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)]" /> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
