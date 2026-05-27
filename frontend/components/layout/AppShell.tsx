"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { MobileDock } from "@/components/layout/MobileDock";
import { PageTransition } from "@/components/layout/PageTransition";
import { ConversationHistoryProvider } from "@/lib/conversation-history-context";
import { ProfileProvider } from "@/lib/profile-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { WorkspaceCollaborationProvider } from "@/lib/workspace-collaboration-context";
import { WorkspaceContinuityProvider } from "@/lib/workspace-continuity-context";
import { WorkspaceOnboardingGate } from "@/components/workspace/WorkspaceOnboardingGate";
import { cn } from "@/lib/utils";

type AppShellProps = {
  children: React.ReactNode;
};

const sidebarCollapsedPreferenceKey = "omnix.sidebar.collapsed";

function readSidebarCollapsedPreference() {
  if (typeof window === "undefined") return false;

  try {
    const stored = window.localStorage?.getItem(sidebarCollapsedPreferenceKey);
    if (stored !== null && stored !== undefined) {
      return stored === "true";
    }
  } catch {
    // Fall back to a cookie below.
  }

  try {
    return document.cookie
      .split("; ")
      .some((item) => item === `${sidebarCollapsedPreferenceKey}=true`);
  } catch {
    return false;
  }
}

function writeSidebarCollapsedPreference(collapsed: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage?.setItem(sidebarCollapsedPreferenceKey, String(collapsed));
  } catch {
    // The cookie fallback still preserves the preference.
  }

  try {
    document.cookie = `${sidebarCollapsedPreferenceKey}=${collapsed}; path=/; max-age=31536000; samesite=lax`;
  } catch {
    // Preference persistence is non-critical.
  }
}

export function AppShell({ children }: AppShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarPreferenceLoaded, setSidebarPreferenceLoaded] = useState(false);

  useEffect(() => {
    setIsSidebarCollapsed(readSidebarCollapsedPreference());
    setSidebarPreferenceLoaded(true);
  }, []);

  useEffect(() => {
    if (!sidebarPreferenceLoaded) {
      return;
    }

    writeSidebarCollapsedPreference(isSidebarCollapsed);
  }, [isSidebarCollapsed, sidebarPreferenceLoaded]);

  return (
    <WorkspaceProvider>
      <WorkspaceCollaborationProvider>
        <WorkspaceContinuityProvider>
          <ProfileProvider>
            <ConversationHistoryProvider>
              <WorkspaceOnboardingGate>
                <div className="omnix-app-bg omnix-auth-shell relative h-[100dvh] overflow-hidden text-white sm:h-screen">
                  <div className="omnix-ambient-layer" aria-hidden="true" />
                  <div className="omnix-shell-scanline" aria-hidden="true" />
                  <div
                    className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-px bg-[linear-gradient(90deg,transparent_0%,rgba(0,255,255,0.35)_30%,rgba(0,255,255,0.6)_50%,rgba(0,255,255,0.35)_70%,transparent_100%)]"
                    aria-hidden="true"
                  />
                  <Sidebar
                    isOpen={isSidebarOpen}
                    collapsed={isSidebarCollapsed}
                    onClose={() => setIsSidebarOpen(false)}
                    onToggleCollapse={() => setIsSidebarCollapsed((value) => !value)}
                  />
                  <div
                    className={cn(
                      "relative z-[1] flex h-full min-h-0 flex-col transition-[padding] duration-200 ease-out",
                      isSidebarCollapsed ? "lg:pl-0" : "lg:pl-[var(--omnix-sidebar-w)]",
                    )}
                  >
                    <Header
                      sidebarCollapsed={isSidebarCollapsed}
                      onMenuClick={() => setIsSidebarOpen(true)}
                      onExpandSidebar={() => setIsSidebarCollapsed(false)}
                    />
                    <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden pb-[calc(4.25rem_+_env(safe-area-inset-bottom))] lg:pb-0">
                      <PageTransition className="flex min-h-0 flex-1 flex-col">{children}</PageTransition>
                    </main>
                    <MobileDock />
                  </div>
                </div>
              </WorkspaceOnboardingGate>
            </ConversationHistoryProvider>
          </ProfileProvider>
        </WorkspaceContinuityProvider>
      </WorkspaceCollaborationProvider>
    </WorkspaceProvider>
  );
}
