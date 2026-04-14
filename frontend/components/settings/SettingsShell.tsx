"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bell,
  BrainCircuit,
  FileText,
  Monitor,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const settingsNav = [
  { href: "/settings/profile", label: "Profile", description: "Avatar, display name, handle", icon: UserRound },
  { href: "/settings/account", label: "Account", description: "Session and identity controls", icon: ShieldCheck },
  { href: "/settings/workspace", label: "Workspace", description: "Name and workspace details", icon: Settings },
  { href: "/settings/ai", label: "AI Settings", description: "Model behavior and context", icon: BrainCircuit },
  { href: "/settings/appearance", label: "Appearance", description: "Local interface preferences", icon: Monitor },
  { href: "/settings/notifications", label: "Notifications", description: "Invite and email preferences", icon: Bell },
  { href: "/settings/team", label: "Team Management", description: "Roles, members, invites", icon: Users },
  { href: "/settings/about", label: "About", description: "Product notes and policies", icon: FileText },
];

type SettingsShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function SettingsShell({ title, description, children }: SettingsShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-full overflow-hidden text-[var(--omnix-text)]">
      <aside className="hidden w-[220px] shrink-0 border-r border-[var(--omnix-border)] bg-[rgba(5,12,23,0.6)] px-2.5 py-4 backdrop-blur-xl md:block">
        <div className="px-2 pb-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">Settings Menu</p>
        </div>
        <nav className="flex flex-col gap-0.5">
          {settingsNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition",
                  active
                    ? "bg-[var(--omnix-surface-hover)] font-medium text-white shadow-[var(--omnix-glow-xs)]"
                    : "text-[var(--omnix-text-2)] hover:bg-[var(--omnix-surface)] hover:text-white",
                )}
              >
                {active ? <span className="omnix-active-rail" /> : null}
                <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-[var(--omnix-cyan)]" : "text-[var(--omnix-text-3)]")} />
                <span className="min-w-0">
                  <span className="block truncate">{item.label}</span>
                  <span className="sr-only">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="omnix-scrollbar min-w-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-[680px] pb-20">
        <div className="mb-6">
          <h2 className="omnix-display text-[22px] font-bold text-white">{title}</h2>
          <p className="mt-1 text-[13px] leading-6 text-[var(--omnix-text-3)]">{description}</p>
        </div>
        {children}
        </div>
      </section>
    </div>
  );
}
