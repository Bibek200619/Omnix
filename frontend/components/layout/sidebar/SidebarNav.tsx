"use client";

import Link from "next/link";
import {
  BadgeCheck,
  BarChart2,
  Bell,
  ClipboardCheck,
  Compass,
  FileText,
  Layers3,
  LayoutDashboard,
  MessageSquare,
  MessagesSquare,
  Settings,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "Core",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/chat", label: "AI Chat", icon: MessageSquare },
      { href: "/conversations", label: "Conversations", icon: MessagesSquare },
    ],
  },
  {
    label: "Execution",
    items: [
      { href: "/decisions", label: "Decisions", icon: BadgeCheck },
      { href: "/tasks", label: "Tasks", icon: ClipboardCheck },
      { href: "/initiatives", label: "Initiatives", icon: Compass },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/workspace", label: "Workspaces", icon: Layers3 },
      { href: "/team", label: "Team", icon: Users },
      { href: "/sources", label: "Sources", icon: FileText },
    ],
  },
  {
    label: "System",
    items: [
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/analytics", label: "Analytics", icon: BarChart2 },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

type SidebarNavProps = {
  pathname: string;
  onNavigate: () => void;
};

export function SidebarNav({ pathname, onNavigate }: SidebarNavProps) {
  return (
    <nav className="omnix-scrollbar relative min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-3">
      <div className="mb-2 flex items-center gap-2 px-2">
        <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.12),transparent)]" />
        <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Navigation</p>
        <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.12),transparent)]" />
      </div>
      {navGroups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-2 pt-2 text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">
            {group.label}
          </p>
          {group.items.map((item) => {
            const Icon = item.icon;
            const isActive =
              item.href === "/settings"
                ? pathname.startsWith("/settings")
                : pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onNavigate}
                className={cn(
                  "omnix-sidebar-link group/nav relative mb-px flex min-h-11 items-center gap-2.5 rounded-[var(--omnix-radius-sm)] border px-2.5 py-[9px] text-[13px] transition duration-150 lg:min-h-0",
                  isActive
                    ? "border-cyan-300/20 bg-[radial-gradient(ellipse_at_0%_50%,rgba(0,255,255,0.1),transparent_60%),rgba(0,255,255,0.06)] font-semibold text-white shadow-[var(--omnix-glow-xs),inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border-transparent font-normal text-[var(--omnix-text-2)] hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)] hover:text-white hover:shadow-[var(--omnix-glow-xs)]",
                )}
              >
                {isActive ? <span className="omnix-active-rail" /> : null}
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-all duration-150",
                    isActive
                      ? "text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_rgba(0,255,255,0.7)]"
                      : "text-[var(--omnix-text-3)] group-hover/nav:text-[var(--omnix-text-2)]",
                  )}
                />
                <span className={cn(isActive && "text-white")}>{item.label}</span>
                {isActive ? (
                  <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[var(--omnix-cyan)] shadow-[0_0_6px_rgba(0,255,255,0.9)]" />
                ) : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
