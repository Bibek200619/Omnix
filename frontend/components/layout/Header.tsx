"use client";

import { useState } from "react";
import { AlertCircle, LogOut, Menu, MessageSquarePlus, PanelLeftOpen, Users } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { InviteNotificationBar, InviteNotificationBell } from "@/components/workspace/InviteNotifications";
import { ActionsMenu } from "@/components/actions/ActionsMenu";

const routeTitles = [
  { match: "/chat", title: "Chat", eyebrow: "AI workspace" },
  { match: "/files", title: "Files", eyebrow: "Workspace knowledge" },
  { match: "/history", title: "History", eyebrow: "Previous conversations" },
  { match: "/settings/terms", title: "Terms", eyebrow: "Product policies" },
  { match: "/settings", title: "Settings", eyebrow: "Account controls" },
];

type HeaderProps = {
  sidebarCollapsed?: boolean;
  onMenuClick: () => void;
  onExpandSidebar?: () => void;
};

export function Header({ sidebarCollapsed = false, onMenuClick, onExpandSidebar }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
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
    <header className="sticky top-0 z-30 border-b border-white/10 bg-canvas/85 backdrop-blur-xl">
      <InviteNotificationBar />
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="lg:hidden"
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
              className="hidden h-9 w-9 lg:inline-flex"
              aria-label="Expand workspace sidebar"
              title="Expand workspace sidebar"
              onClick={onExpandSidebar}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          ) : null}
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-cyan-200/70">
              {activeWorkspace ? activeWorkspace.name : active.eyebrow}
            </p>
            <h1 className="truncate text-lg font-semibold text-white sm:text-xl">
              {active.title}
            </h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeWorkspace ? (
            <div className="hidden items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300 lg:flex">
              <div className="flex items-center gap-2 text-slate-400">
                <Users className="h-4 w-4 text-cyan-200" />
                <span>{activeWorkspace.member_count}</span>
              </div>
              <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} />
            </div>
          ) : null}
          <InviteNotificationBell />
          <ActionsMenu className="inline-flex" />
          <Button
            type="button"
            variant="secondary"
            leftIcon={<MessageSquarePlus className="h-4 w-4" />}
            onClick={() => router.push("/chat")}
            className="hidden sm:inline-flex"
          >
            New chat
          </Button>
          <Button
            type="button"
            variant="ghost"
            leftIcon={<LogOut className="h-4 w-4" />}
            isLoading={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? "Signing out" : "Sign out"}
          </Button>
        </div>
      </div>
      {signOutError ? (
        <div className="border-t border-rose-400/20 bg-rose-400/10 px-4 py-2 text-sm text-rose-100 sm:px-6 lg:px-8">
          <div className="mx-auto flex max-w-7xl items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {signOutError}
          </div>
        </div>
      ) : null}
    </header>
  );
}
