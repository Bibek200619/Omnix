"use client";

import { useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Menu,
  MessageSquarePlus,
  PanelLeftOpen,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import { InviteNotificationBar, InviteNotificationBell } from "@/components/workspace/InviteNotifications";
import { ProfileMenu } from "@/components/layout/ProfileMenu";

const routeTitles = [
  { match: "/dashboard", title: "Dashboard", subtitle: "Welcome back" },
  { match: "/chat", title: "AI Chat", subtitle: "Omnix Intelligence" },
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
  { match: "/settings/notifications", title: "Notifications", subtitle: "Preferences" },
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

export function Header({ sidebarCollapsed = false, onMenuClick, onExpandSidebar }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut, user } = useAuth();
  const { activeWorkspace, workspaces } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  
  const active = routeTitles.find((route) => pathname.startsWith(route.match)) ?? routeTitles[0];
  
  // Dynamic Hierarchy Orientation
  const parentWorkspace = workspaces.find(w => w.id === activeWorkspace?.parent_workspace_id);
  const isSubspace = !!activeWorkspace?.parent_workspace_id;

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutError(null);

    const { error } = await signOut();

    if (error) {
      console.error("Unable to sign out", error);
      setSignOutError(error.message || "Unable to sign out.");
      setSigningOut(false);
      return;
    }

    router.replace("/login");
    router.refresh();
  }

  return (
    <header className="relative z-30 shrink-0 select-none border-b border-[rgba(0,255,255,0.08)] bg-[var(--omnix-header-glass)] pt-safe backdrop-blur-[24px]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent_0%,rgba(0,255,255,0.25)_40%,rgba(0,255,255,0.5)_55%,rgba(0,255,255,0.25)_70%,transparent_100%)]" />
      <InviteNotificationBar />
      <div className="relative flex h-[var(--omnix-header-h)] w-full items-center gap-3 px-5 sm:px-[22px]">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-9 w-9 rounded-[10px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.04)] text-[var(--omnix-text-2)] hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.08)] hover:shadow-[var(--omnix-glow-xs)] lg:hidden"
            aria-label="Open navigation"
            title="Open navigation"
            onClick={onMenuClick}
          >
            <Menu className="h-5 w-5" />
          </Button>
          {sidebarCollapsed ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="hidden h-9 w-9 rounded-[10px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.04)] text-[var(--omnix-text-2)] hover:border-[rgba(0,255,255,0.3)] hover:bg-[rgba(0,255,255,0.08)] hover:shadow-[var(--omnix-glow-xs)] lg:inline-flex"
              aria-label="Expand workspace sidebar"
              title="Expand workspace sidebar"
              onClick={onExpandSidebar}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 overflow-hidden">
              {isSubspace && parentWorkspace ? (
                <>
                  <span className="truncate text-xs font-medium text-[rgba(255,255,255,0.35)]">
                    {parentWorkspace.name}
                  </span>
                  <ChevronRight className="h-3 w-3 shrink-0 text-white/10" />
                </>
              ) : null}
              <span className="omnix-display truncate text-sm font-bold tracking-[0.01em] text-[rgba(255,255,255,0.92)]">
                {activeWorkspace?.name || active.title}
              </span>
              <span className={cn(
                 "shrink-0 rounded-[4px] border border-white/5 bg-white/5 px-1.5 py-0.5 text-[9px] font-medium capitalize tracking-wide text-white/30",
               )}>
                 {activeWorkspace?.current_user_role?.replace(/_/g, ' ') || "Member"}
              </span>
            </div>
            <p className="mt-px truncate text-[10px] tracking-[0.03em] text-[rgba(255,255,255,0.22)]">
               {activeWorkspace ? (isSubspace ? "Operational Subspace" : "Super Workspace") : active.subtitle}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <InviteNotificationBell />
          <div className="hidden h-[22px] w-px bg-[rgba(0,255,255,0.1)] sm:block" />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={() => router.push("/chat")}
            className="h-9 w-9 rounded-[10px] border-[var(--omnix-cyan)] bg-transparent text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)] sm:w-auto sm:px-4"
            aria-label="Start new chat"
            title="Start new chat"
          >
            <MessageSquarePlus className="h-4 w-4 sm:mr-2 sm:h-3.5 sm:w-3.5" />
            <span className="hidden sm:inline text-xs font-bold tracking-[0.03em]">New Chat</span>
          </Button>
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
  );
}
