"use client";

import { useState } from "react";
import { AlertCircle, Menu, MessageSquarePlus, PanelLeftOpen, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { InviteNotificationBar, InviteNotificationBell } from "@/components/workspace/InviteNotifications";
import { ActionsMenu } from "@/components/actions/ActionsMenu";
import { ProfileMenu } from "@/components/layout/ProfileMenu";

const routeTitles = [
  { match: "/dashboard", title: "Dashboard", eyebrow: "Workspace command center" },
  { match: "/chat", title: "AI Chat", eyebrow: "Collaborative intelligence" },
  { match: "/files", title: "Sources", eyebrow: "Workspace knowledge" },
  { match: "/history", title: "History", eyebrow: "Previous conversations" },
  { match: "/settings/terms", title: "Terms", eyebrow: "Product policies" },
  { match: "/settings/profile", title: "Profile", eyebrow: "Account identity" },
  { match: "/settings/account", title: "Account", eyebrow: "Session controls" },
  { match: "/settings/ai", title: "AI Settings", eyebrow: "Model behavior" },
  { match: "/settings/appearance", title: "Appearance", eyebrow: "Interface preferences" },
  { match: "/settings/workspace", title: "Workspace Settings", eyebrow: "Workspace controls" },
  { match: "/settings/team", title: "Team Members", eyebrow: "Collaboration" },
  { match: "/settings/notifications", title: "Notifications", eyebrow: "Preferences" },
  { match: "/settings/security", title: "Security", eyebrow: "Session controls" },
  { match: "/settings/interface", title: "Interface", eyebrow: "Preferences" },
  { match: "/settings/about", title: "About", eyebrow: "Product policies" },
  { match: "/settings", title: "Settings", eyebrow: "Workspace controls" },
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
  const { activeWorkspace, activeMembers } = useWorkspace();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const active =
    routeTitles.find((route) => pathname.startsWith(route.match)) ??
    routeTitles[0];
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];

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
    <header className="relative z-30 shrink-0 border-b border-[var(--omnix-border)] bg-[rgba(5,12,23,0.96)] backdrop-blur-[20px]">
      <InviteNotificationBar />
      <div className="flex h-[var(--omnix-header-h)] w-full items-center justify-between gap-3 px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-[34px] w-[34px] rounded-[9px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)] lg:hidden"
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
              className="hidden h-[34px] w-[34px] rounded-[9px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface-hover)] hover:shadow-[var(--omnix-glow-xs)] lg:inline-flex"
              aria-label="Expand workspace sidebar"
              title="Expand workspace sidebar"
              onClick={onExpandSidebar}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <h1 className="omnix-display truncate text-[15px] font-semibold tracking-[0.01em] text-white">
              {active.title}
            </h1>
            <p className="mt-0.5 truncate text-[10px] tracking-[0.03em] text-[var(--omnix-text-3)]">
              {activeWorkspace ? `${activeWorkspace.name} workspace` : active.eyebrow}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {activeWorkspace ? (
            <div className="hidden h-[34px] items-center gap-3 rounded-[9px] border border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3 text-xs text-[var(--omnix-text-2)] transition hover:border-[var(--omnix-border-2)] xl:flex">
              <div className="flex items-center gap-2 text-[var(--omnix-text-2)]">
                <Users className="h-4 w-4 text-[var(--omnix-cyan)]" />
                <span>{activeWorkspace.member_count}</span>
              </div>
              <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} />
            </div>
          ) : null}
          <InviteNotificationBell />
          <ActionsMenu className="inline-flex" />
          <div className="hidden h-5 w-px bg-[var(--omnix-border)] md:block" />
          <Button
            type="button"
            variant="secondary"
            leftIcon={<MessageSquarePlus className="h-4 w-4" />}
            onClick={() => router.push("/chat")}
            className="hidden h-[34px] rounded-[9px] border-[var(--omnix-cyan)] bg-transparent px-3.5 text-xs font-semibold tracking-[0.02em] text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] hover:-translate-y-0.5 hover:border-[var(--omnix-cyan)] hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)] md:inline-flex"
          >
            New chat
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
