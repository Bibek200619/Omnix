"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { PageTransition } from "@/components/layout/PageTransition";
import { ConversationHistoryProvider } from "@/lib/conversation-history-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
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
      <ConversationHistoryProvider>
        <div className="surface-noise min-h-screen bg-canvas text-white">
          <Sidebar
            isOpen={isSidebarOpen}
            collapsed={isSidebarCollapsed}
            onClose={() => setIsSidebarOpen(false)}
            onToggleCollapse={() => setIsSidebarCollapsed((value) => !value)}
          />
          <div
            className={cn(
              "min-h-screen transition-[padding] duration-200 ease-out",
              isSidebarCollapsed ? "lg:pl-0" : "lg:pl-[17rem]",
            )}
          >
            <Header
              sidebarCollapsed={isSidebarCollapsed}
              onMenuClick={() => setIsSidebarOpen(true)}
              onExpandSidebar={() => setIsSidebarCollapsed(false)}
            />
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
        </div>
      </ConversationHistoryProvider>
    </WorkspaceProvider>
  );
}
