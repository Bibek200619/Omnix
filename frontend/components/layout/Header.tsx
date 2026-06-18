"use client";

import { memo, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  AlertCircle,
  ChevronRight,
  Menu,
  MessageSquarePlus,
  PanelLeftOpen,
  RefreshCw,
  X,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import type { Workspace } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";
import { InviteNotificationBar, InviteNotificationBell } from "@/components/workspace/InviteNotifications";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ProfileMenu } from "@/components/layout/ProfileMenu";

const CommandPalette = dynamic(
  () => import("@/components/layout/CommandPalette").then((mod) => ({ default: mod.CommandPalette })),
  { ssr: false, loading: () => null },
);

const routeTitles = [
  { match: "/dashboard", title: "Dashboard", subtitle: "Welcome back" },
  { match: "/analytics", title: "Analytics", subtitle: "Usage metrics and performance insights" },
  { match: "/chat", title: "AI Chat", subtitle: "Omnix Intelligence" },
  { match: "/conversations", title: "Conversations", subtitle: "Operational discussion" },
  { match: "/decisions", title: "Decisions", subtitle: "Organizational memory" },
  { match: "/tasks", title: "Tasks", subtitle: "Shared execution" },
  { match: "/initiatives", title: "Initiatives", subtitle: "Shared operational direction" },
  { match: "/notifications", title: "Notifications", subtitle: "In-app mentions" },
  { match: "/mentions", title: "Notifications", subtitle: "In-app mentions" },
  { match: "/workspace", title: "Workspaces", subtitle: "Manage your super workspaces and sub-spaces" },
  { match: "/team", title: "Team", subtitle: "Manage workspace members" },
  { match: "/sources", title: "Sources", subtitle: "Manage your connected data" },
  { match: "/files", title: "Sources", subtitle: "Manage your connected data" },
  { match: "/analytics", title: "Analytics", subtitle: "Usage metrics and performance insights" },
  { match: "/history", title: "History", subtitle: "Previous conversations" },
  { match: "/settings/terms", title: "Terms", subtitle: "Product policies" },
  { match: "/settings/profile", title: "Profile", subtitle: "Account identity" },
  { match: "/settings/account", title: "Account", subtitle: "Session controls" },
  { match: "/settings/ai", title: "AI Settings", subtitle: "Model behavior" },
  { match: "/settings/appearance", title: "Appearance", subtitle: "Interface preferences" },
  { match: "/settings/workspace", title: "Workspace Settings", subtitle: "Workspace controls" },
  { match: "/settings/team", title: "Team", subtitle: "Manage workspace members" },
  { match: "/settings/notifications", title: "Notifications", subtitle: "In-app alerts" },
  { match: "/settings/security", title: "Security", subtitle: "Session controls" },
  { match: "/settings/interface", title: "Interface", subtitle: "Preferences" },
  { match: "/settings/about", title: "About", subtitle: "Product policies" },
  { match: "/settings", title: "Settings", subtitle: "Manage your account and preferences" },
];

type HeaderProps = {
  sidebarCollapsed?: boolean;
  onMenuClick: () => void;
  onExpandSidebar?: () => void;
};

function findWorkspaceTrail(workspaces: Workspace[], workspaceId: string | null): Workspace[] {
  if (!workspaceId) {
    return [];
  }

  for (const workspace of workspaces) {
    if (workspace.id === workspaceId) {
      return [workspace];
    }

    const subspaceTrail = findWorkspaceTrail(workspace.subspaces ?? [], workspaceId);
    if (subspaceTrail.length > 0) {
      return [workspace, ...subspaceTrail];
    }
  }

  return [];
}

export const Header = memo(function Header({ sidebarCollapsed = false, onMenuClick, onExpandSidebar }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { activeWorkspace, activeWorkspaceId, workspaces } = useWorkspaceTree();
  const { realtimeStatus, retryRealtimeConnection } = useWorkspaceCollaboration();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [retryingRealtime, setRetryingRealtime] = useState(false);
  const [offlineAlertDismissed, setOfflineAlertDismissed] = useState(false);
  
  const active = routeTitles.find((route) => pathname.startsWith(route.match)) ?? routeTitles[0];
  const workspaceBreadcrumb = useMemo(() => {
    const trail = findWorkspaceTrail(workspaces, activeWorkspaceId);

    if (trail.length > 0) {
      return trail;
    }

    return activeWorkspace ? [activeWorkspace] : [];
  }, [activeWorkspace, activeWorkspaceId, workspaces]);
  
  // Dynamic Hierarchy Orientation
  const parentWorkspace = workspaceBreadcrumb.length > 1 ? workspaceBreadcrumb[workspaceBreadcrumb.length - 2] : null;
  const isSubspace = workspaceBreadcrumb.length > 1 || !!activeWorkspace?.parent_workspace_id;
  const realtimeOffline = !!activeWorkspaceId && (realtimeStatus === "disconnected" || realtimeStatus === "error");
  const realtimeStatusLabel = realtimeOffline
    ? "offline"
    : realtimeStatus === "connecting"
      ? "connecting"
      : "connected";
  const realtimeTitle =
    realtimeStatus === "connected"
      ? "Realtime connected"
      : realtimeStatus === "connecting"
        ? "Realtime connecting"
        : "Realtime offline";

  useEffect(() => {
    if (!realtimeOffline) {
      setOfflineAlertDismissed(false);
    }
  }, [realtimeOffline]);

  async function handleRetryRealtime() {
    setRetryingRealtime(true);

    try {
      await retryRealtimeConnection();
    } finally {
      setRetryingRealtime(false);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);

    const { error } = await signOut();

    if (error) {
      logClientError("Unable to sign out", error);
      setSignOutError("Unable to sign out. Check your connection and try again.");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
  }

  return (
    <>
      <header className="relative z-30 shrink-0 select-none border-b border-[var(--omnix-rgba-0-255-255-0-08)] bg-[var(--omnix-header-glass)] pt-safe backdrop-blur-[24px]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,var(--omnix-rgba-0-255-255-0-25)_40%,var(--omnix-rgba-0-255-255-0-5)_55%,var(--omnix-rgba-0-255-255-0-25)_70%,transparent_100%)]" />
        <InviteNotificationBar />
        <div className="relative flex h-[var(--omnix-header-h)] w-full items-center gap-1.5 px-3 sm:gap-3 sm:px-[22px]">
          <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
            <Tooltip content="Open navigation" className="lg:hidden">
              <Button
                type="button"
                variant="ghost"
                size={"icon"}
                className="h-11 w-11 rounded-[10px] border border-[var(--omnix-rgba-0-255-255-0-1)] bg-[var(--omnix-rgba-0-255-255-0-04)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-rgba-0-255-255-0-3)] hover:bg-[var(--omnix-rgba-0-255-255-0-08)] hover:shadow-[var(--omnix-glow-xs)]"
                aria-label="Open navigation"
                title="Open navigation"
                onClick={onMenuClick}
              >
                <Menu className="h-5 w-5" />
              </Button>
            </Tooltip>
            {sidebarCollapsed ? (
              <Tooltip content="Expand workspace sidebar" className="hidden lg:inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size={"icon"}
                  className="h-11 w-11 rounded-[10px] border border-[var(--omnix-rgba-0-255-255-0-1)] bg-[var(--omnix-rgba-0-255-255-0-04)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-rgba-0-255-255-0-3)] hover:bg-[var(--omnix-rgba-0-255-255-0-08)] hover:shadow-[var(--omnix-glow-xs)]"
                  aria-label="Expand workspace sidebar"
                  title="Expand workspace sidebar"
                  onClick={onExpandSidebar}
                >
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              </Tooltip>
            ) : null}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 overflow-hidden">
                {isSubspace && parentWorkspace ? (
                  <>
                    <span className="truncate text-xs font-medium text-[var(--omnix-rgba-255-255-255-0-35)]">
                      {parentWorkspace.name}
                    </span>
                    <ChevronRight className="h-3 w-3 shrink-0 text-white/10" />
                  </>
                ) : null}
                <span className="omnix-display truncate text-sm font-bold tracking-[0.01em] text-[var(--omnix-rgba-255-255-255-0-92)]">
                  {activeWorkspace?.name || active.title}
                </span>
                <span className={cn(
                   "hidden shrink-0 rounded-[4px] border border-white/5 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium capitalize tracking-wide text-white/30 sm:inline-flex",
                 )}>
                   {activeWorkspace?.current_user_role?.replace(/_/g, ' ') || "Member"}
                </span>
              </div>
              {workspaceBreadcrumb.length > 0 ? (
                <nav
                  aria-label="Workspace breadcrumb"
                  className="mt-px hidden min-w-0 text-[10px] tracking-[0.03em] text-[var(--omnix-rgba-255-255-255-0-35)] min-[390px]:block"
                >
                  <ol className="flex min-w-0 items-center gap-1 overflow-hidden">
                    {workspaceBreadcrumb.map((workspace) => (
                      <li key={workspace.id} className="flex min-w-0 items-center gap-1">
                        <span className="truncate">{workspace.name}</span>
                        <ChevronRight className="h-2.5 w-2.5 shrink-0 text-white/15" aria-hidden="true" />
                      </li>
                    ))}
                    <li className="min-w-0 truncate text-[var(--omnix-rgba-255-255-255-0-5)]" aria-current="page">
                      {active.title}
                    </li>
                  </ol>
                </nav>
              ) : (
                <p className="mt-px hidden truncate text-[10px] tracking-[0.03em] text-[var(--omnix-rgba-255-255-255-0-22)] min-[390px]:block">
                  {active.subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <CommandPalette />
            {realtimeOffline ? (
              <div
                role="group"
                aria-label={`Realtime status: ${realtimeStatusLabel}`}
                title={realtimeTitle}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-rose-400/20 bg-rose-400/10 px-2 text-rose-100"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400 shadow-[0_0_8px_var(--omnix-rgba-251-113-133-0-75)]" />
                <span className="text-[10px] font-semibold leading-none">Offline</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-5 rounded px-1.5 text-[10px] text-rose-100 hover:bg-rose-400/15 hover:text-white"
                  aria-label="Retry realtime connection"
                  title="Retry realtime connection"
                  disabled={retryingRealtime}
                  leftIcon={<RefreshCw className={cn("h-3 w-3", retryingRealtime && "animate-spin")} />}
                  onClick={handleRetryRealtime}
                >
                  Retry
                </Button>
              </div>
            ) : (
              <span
                role="status"
                aria-label={`Realtime status: ${realtimeStatusLabel}`}
                title={realtimeTitle}
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center"
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    realtimeStatus === "connecting"
                      ? "animate-pulse bg-amber-300 shadow-[0_0_8px_var(--omnix-rgba-252-211-77-0-75)]"
                      : "bg-emerald-400 shadow-[0_0_8px_var(--omnix-rgba-52-211-153-0-75)]",
                  )}
                />
              </span>
            )}
            <NotificationBell />
            <InviteNotificationBell />
            <div className="hidden h-[22px] w-px bg-[var(--omnix-rgba-0-255-255-0-1)] sm:block" />
            <Tooltip content="Start new chat" className="hidden sm:inline-flex">
              <Button
                type="button"
                variant="secondary"
                size={"icon"}
                onClick={() => router.push("/chat")}
                className="h-11 w-11 rounded-[10px] border-[var(--omnix-cyan)] bg-transparent text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)] sm:w-auto sm:px-4"
                aria-label="Start new chat"
                title="Start new chat"
              >
                <MessageSquarePlus className="h-4 w-4 sm:mr-2 sm:h-3.5 sm:w-3.5" />
                <span className="hidden text-xs font-bold tracking-[0.03em] sm:inline">New Chat</span>
              </Button>
            </Tooltip>
            <ProfileMenu user={user} signingOut={signingOut} onSignOut={handleSignOut} />
          </div>
        </div>
        {signOutError ? (
          <div className="border-t border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 sm:px-6 lg:px-8">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {signOutError}
            </div>
          </div>
        ) : null}
      </header>
      {realtimeOffline && !offlineAlertDismissed ? (
        <div className="relative z-20 shrink-0 border-b border-amber-300/10 bg-[var(--omnix-header-glass)] px-3 py-2 backdrop-blur-[24px] sm:px-[22px]">
          <Alert variant="warning" title="Realtime connection offline" className="items-start p-2.5 text-xs">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>Live workspace updates are paused until the connection recovers.</span>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-md border-amber-300/20 px-2 text-[11px] text-amber-50 hover:bg-amber-300/10 hover:text-white"
                  aria-label="Retry realtime connection"
                  disabled={retryingRealtime}
                  leftIcon={<RefreshCw className={cn("h-3 w-3", retryingRealtime && "animate-spin")} />}
                  onClick={handleRetryRealtime}
                >
                  Retry
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 rounded-md border-amber-300/20 text-amber-50 hover:bg-amber-300/10 hover:text-white"
                  aria-label="Dismiss realtime offline alert"
                  title="Dismiss"
                  onClick={() => setOfflineAlertDismissed(true)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Alert>
        </div>
      ) : null}
    </>
  );
});
