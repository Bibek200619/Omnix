"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowUpRight, AtSign, Bell, BellRing, Info, RefreshCw, UserPlus } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Button } from "@/components/ui/Button";
import {
  getBrowserNotificationsPermission,
  readBrowserNotificationsEnabled,
  requestBrowserNotificationsPermission,
  type BrowserNotificationsPermission,
  writeBrowserNotificationsEnabled,
} from "@/lib/browser-notifications";
import { useWorkspaceNotifications } from "@/lib/workspace-notifications-context";

function browserStatusLabel(permission: BrowserNotificationsPermission, enabled: boolean) {
  if (permission === "unsupported") return "Unsupported";
  if (permission === "denied") return "Blocked";
  if (permission === "granted" && enabled) return "On";
  if (permission === "granted") return "Off";
  return "Ready";
}

export default function NotificationSettingsPage() {
  const { unreadCount, loading, error, refreshNotifications } = useWorkspaceNotifications();
  const [browserPermission, setBrowserPermission] = useState<BrowserNotificationsPermission>("unsupported");
  const [browserEnabled, setBrowserEnabled] = useState(false);
  const [requestingBrowserPermission, setRequestingBrowserPermission] = useState(false);

  useEffect(() => {
    setBrowserPermission(getBrowserNotificationsPermission());
    setBrowserEnabled(readBrowserNotificationsEnabled());
  }, []);

  async function handleEnableBrowserNotifications() {
    try {
      setRequestingBrowserPermission(true);
      const permission =
        browserPermission === "granted" ? getBrowserNotificationsPermission() : await requestBrowserNotificationsPermission();
      const enabled = permission === "granted";
      writeBrowserNotificationsEnabled(enabled);
      setBrowserPermission(permission);
      setBrowserEnabled(enabled);
    } finally {
      setRequestingBrowserPermission(false);
    }
  }

  function handleDisableBrowserNotifications() {
    writeBrowserNotificationsEnabled(false);
    setBrowserEnabled(false);
    setBrowserPermission(getBrowserNotificationsPermission());
  }

  return (
    <SettingsShell
      title="Notifications"
      description="In-app mention and invitation surfaces for the active workspace."
    >
      <div className="grid gap-4 md:grid-cols-3">
        <section className="omnix-cinematic-card flex min-h-[15rem] flex-col justify-between gap-5 p-5">
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/14 bg-cyan-300/[0.055] text-cyan-100">
                <AtSign className="h-5 w-5" />
              </div>
              <span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/16 bg-cyan-300/[0.055] px-2 text-[11px] font-medium text-cyan-100/75">
                Live
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">Mention notifications</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
              {unreadCount > 0
                ? `${unreadCount} unread mention${unreadCount === 1 ? "" : "s"} in the active workspace.`
                : "No unread mentions in the active workspace."}
            </p>
            {error ? <p className="mt-2 text-xs leading-5 text-rose-100/80">{error}</p> : null}
          </div>
          <div className="relative z-10 flex flex-wrap gap-2">
            <Link
              href="/notifications"
              className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-sm font-medium text-cyan-100/85 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              Open
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Refresh notifications"
              title="Refresh notifications"
              isLoading={loading}
              onClick={() => void refreshNotifications()}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </section>

        <section className="omnix-cinematic-card flex min-h-[15rem] flex-col justify-between gap-5 p-5">
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/14 bg-cyan-300/[0.055] text-cyan-100">
                <UserPlus className="h-5 w-5" />
              </div>
              <span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/16 bg-cyan-300/[0.055] px-2 text-[11px] font-medium text-cyan-100/75">
                In app
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">Workspace invitations</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
              Pending workspace invites use the invitation control in the header.
            </p>
          </div>
          <Link
            href="/settings/team"
            className="relative z-10 inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-sm font-medium text-cyan-100/85 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.09] active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
          >
            Manage invites
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </section>

        <section className="omnix-cinematic-card flex min-h-[15rem] flex-col justify-between gap-5 p-5">
          <div className="relative z-10">
            <div className="flex items-start justify-between gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/14 bg-cyan-300/[0.055] text-cyan-100">
                <BellRing className="h-5 w-5" />
              </div>
              <span className="inline-flex min-h-7 items-center rounded-full border border-cyan-300/16 bg-cyan-300/[0.055] px-2 text-[11px] font-medium text-cyan-100/75">
                {browserStatusLabel(browserPermission, browserEnabled)}
              </span>
            </div>
            <h3 className="mt-4 text-base font-semibold text-white">Browser alerts</h3>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">
              Show desktop alerts when new mentions arrive while Omnix is open.
            </p>
          </div>
          {browserEnabled ? (
            <Button type="button" variant="secondary" onClick={handleDisableBrowserNotifications}>
              Turn off
            </Button>
          ) : (
            <Button
              type="button"
              onClick={() => void handleEnableBrowserNotifications()}
              isLoading={requestingBrowserPermission}
              disabled={browserPermission === "unsupported" || browserPermission === "denied"}
            >
              Enable alerts
            </Button>
          )}
        </section>

        <section className="omnix-cinematic-card p-5 md:col-span-3">
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
