"use client";

import Link from "next/link";
import { ArrowUpRight, AtSign, Bell, Info, UserPlus } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";

const notificationSurfaces = [
  {
    title: "Mention notifications",
    description: "Unread @mentions use the header bell and the notification center.",
    href: "/notifications",
    action: "Open notifications",
    icon: AtSign,
  },
  {
    title: "Workspace invitations",
    description: "Pending workspace invites use the invitation control in the header.",
    href: "/settings/team",
    action: "Manage invites",
    icon: UserPlus,
  },
];

export default function NotificationSettingsPage() {
  return (
    <SettingsShell
      title="Notifications"
      description="In-app mention and invitation surfaces for the active workspace."
    >
      <div className="grid gap-4 md:grid-cols-2">
        {notificationSurfaces.map((surface) => {
          const Icon = surface.icon;

          return (
            <section key={surface.title} className="omnix-cinematic-card flex min-h-[15rem] flex-col justify-between gap-5 p-5">
              <div className="relative z-10">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/14 bg-cyan-300/[0.055] text-cyan-100">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/16 bg-cyan-300/[0.055] px-2 text-[11px] font-medium text-cyan-100/75">
                    In app
                  </span>
                </div>
                <h3 className="mt-4 text-base font-semibold text-white">{surface.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">{surface.description}</p>
              </div>
              <Link
                href={surface.href}
                className="relative z-10 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-sm font-medium text-cyan-100/85 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              >
                {surface.action}
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </section>
          );
        })}

        <section className="omnix-cinematic-card p-5 md:col-span-2">
          <div className="relative z-10 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.035] text-[var(--omnix-text-2)]">
              <Bell className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-white">External channels are not active</h3>
              <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                Email, push, SMS, Slack, Discord, and AI notifications are outside this in-app notification center.
              </p>
            </div>
            <Info className="ml-auto hidden h-4 w-4 shrink-0 text-cyan-100/35 sm:block" />
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
