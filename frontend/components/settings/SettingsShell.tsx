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
  { href: "/settings/appearance", label: "Appearance", description: "Local interface preferences", icon: Monitor },
  { href: "/settings/notifications", label: "Notifications", description: "Invite and email preferences", icon: Bell },
  { href: "/settings/team", label: "Team Management", description: "Roles, members, invites", icon: Users },
  { href: "/settings/ai", label: "AI Settings", description: "Model behavior and context", icon: BrainCircuit },
  { href: "/settings/about", label: "About", description: "Product notes and policies", icon: FileText },
  { href: "/settings/terms", label: "Terms", description: "Policies and product terms", icon: FileText },
];

type SettingsShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function SettingsShell({ title, description, children }: SettingsShellProps) {
  const pathname = usePathname();

  return (
    <div className="relative flex h-full w-full overflow-hidden text-[var(--omnix-text)]">
      <aside className="relative hidden w-[220px] shrink-0 overflow-hidden border-r border-[rgba(0,255,255,0.07)] bg-[rgba(5,12,23,0.82)] px-2.5 py-4 shadow-[18px_0_70px_rgba(0,0,0,0.3)] backdrop-blur-xl md:block">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[radial-gradient(ellipse_at_50%_-10%,rgba(0,255,255,0.1)_0%,transparent_70%)]" />
        {/* Right edge beam */}
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(0,255,255,0.14),rgba(0,255,255,0.07),transparent)]" />
        <div className="relative z-10 mb-3 flex items-center gap-2 px-2">
          <div className="h-px flex-1 bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.12))]" />
          <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Settings</p>
          <div className="h-px flex-1 bg-[linear-gradient(90deg,rgba(0,255,255,0.12),transparent)]" />
        </div>
        <nav className="relative z-10 flex flex-col gap-0.5">
          {settingsNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "group/slink relative flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-left text-[13px] transition duration-150",
                  active
                    ? "border border-cyan-300/20 bg-[radial-gradient(ellipse_at_0%_50%,rgba(0,255,255,0.1),transparent_60%),rgba(0,255,255,0.06)] font-semibold text-white shadow-[var(--omnix-glow-xs),inset_0_1px_0_rgba(255,255,255,0.04)]"
                    : "border border-transparent text-[var(--omnix-text-2)] hover:bg-[rgba(0,255,255,0.05)] hover:text-white",
                )}
              >
                {active ? <span className="omnix-active-rail" /> : null}
                <Icon
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 transition-all",
                    active
                      ? "text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_rgba(0,255,255,0.7)]"
                      : "text-[var(--omnix-text-3)] group-hover/slink:text-[var(--omnix-text-2)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{item.label}</span>
                  <span className="sr-only">{item.description}</span>
                </span>
                {active && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--omnix-cyan)] shadow-[0_0_6px_rgba(0,255,255,0.9)]" />
                )}
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="omnix-scrollbar min-w-0 flex-1 overflow-y-auto px-4 py-5 sm:px-8 sm:py-7">
        <div className="relative z-10 max-w-[88rem] pb-12">
          <div className="sticky top-0 z-20 -mx-4 mb-5 border-b border-[rgba(0,255,255,0.08)] bg-[rgba(5,12,23,0.92)] px-4 pb-3 pt-1 backdrop-blur-xl md:hidden">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Settings</p>
              <span className="h-px min-w-10 flex-1 bg-[linear-gradient(90deg,rgba(0,255,255,0.16),transparent)]" />
            </div>
            <nav className="omnix-scrollbar flex snap-x gap-2 overflow-x-auto pb-1" aria-label="Settings sections">
              {settingsNav.map((item) => {
                const Icon = item.icon;
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "inline-flex h-11 min-w-[8.75rem] snap-start items-center gap-2 rounded-lg border px-3 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60",
                      active
                        ? "border-cyan-300/25 bg-cyan-300/10 text-white shadow-[var(--omnix-glow-xs)]"
                        : "border-[var(--omnix-border)] bg-[rgba(0,255,255,0.03)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 shrink-0", active ? "text-cyan-100" : "text-[var(--omnix-text-3)]")} />
                    <span className="truncate">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="mb-5 max-w-[640px]">
            <h2 className="omnix-display text-[22px] font-bold leading-tight text-white">{title}</h2>
            <p className="mt-1 text-[13px] leading-6 text-[var(--omnix-text-3)]">{description}</p>
          </div>
          <div>{children}</div>
        </div>
      </section>
    </div>
  );
}
