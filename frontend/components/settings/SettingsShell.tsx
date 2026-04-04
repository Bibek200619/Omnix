"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  Bell,
  FileText,
  Monitor,
  Settings,
  ShieldCheck,
  UserRound,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

const settingsNav = [
  { href: "/settings/profile", label: "Profile / Account", description: "Identity, avatar, handle", icon: UserRound },
  { href: "/settings/workspace", label: "Workspace", description: "Name and workspace details", icon: Settings },
  { href: "/settings/team", label: "Team Members", description: "Roles, members, invites", icon: Users },
  { href: "/settings/notifications", label: "Notifications", description: "Invite and email preferences", icon: Bell },
  { href: "/settings/security", label: "Security / Session", description: "Session and sign out", icon: ShieldCheck },
  { href: "/settings/interface", label: "Interface", description: "Local UI preferences", icon: Monitor },
  { href: "/settings/about", label: "About / Terms", description: "Product notes and policies", icon: FileText },
];

type SettingsShellProps = {
  title: string;
  description: string;
  children: ReactNode;
};

export function SettingsShell({ title, description, children }: SettingsShellProps) {
  const pathname = usePathname();

  return (
    <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="h-fit rounded-lg border border-white/10 bg-white/[0.03] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
        <div className="px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200/70">Settings</p>
          <p className="mt-1 text-sm leading-5 text-slate-400">Account and workspace controls are separated here.</p>
        </div>
        <nav className="space-y-1">
          {settingsNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-3 py-2.5 transition",
                  active
                    ? "border-cyan-300/25 bg-cyan-300/10 text-white"
                    : "border-transparent text-slate-400 hover:border-white/10 hover:bg-white/[0.045] hover:text-slate-100",
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", active ? "text-cyan-200" : "text-slate-500")} />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{item.label}</span>
                  <span className="mt-0.5 block text-xs leading-4 text-slate-500">{item.description}</span>
                </span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <section className="min-w-0">
        <div className="mb-5 rounded-lg border border-white/10 bg-white/[0.025] px-4 py-4 sm:px-5">
          <h2 className="text-xl font-semibold tracking-tight text-white">{title}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
        </div>
        {children}
      </section>
    </div>
  );
}
