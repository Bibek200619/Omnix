"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { KeyboardShortcutsModal } from "@/components/layout/KeyboardShortcutsModal";
import { MobileDock } from "@/components/layout/MobileDock";
import { PageTransition } from "@/components/layout/PageTransition";
import { AmbientParticles } from "@/components/layout/AmbientParticles";
import { DashboardProviders } from "@/components/layout/DashboardProviders";
import { PhoneNumberPrompt } from "@/components/profile/PhoneNumberPrompt";
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
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "?" && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) {
        event.preventDefault();
        setIsShortcutsOpen(true);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <DashboardProviders>
      <div className="omnix-app-bg omnix-auth-shell relative min-h-[100svh] overflow-x-hidden text-white lg:h-screen lg:min-h-0 lg:overflow-hidden">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-lg focus:bg-[var(--omnix-cyan)] focus:px-4 focus:py-2 focus:font-bold focus:text-[var(--omnix-bg)] focus:shadow-[var(--omnix-glow-md)]"
        >
          Skip to main content
        </a>
        <div className="omnix-ambient-layer" aria-hidden="true" />
        <AmbientParticles count={30} />
        <div className="omnix-shell-scanline" aria-hidden="true" />
        <div
          className="pointer-events-none fixed inset-x-0 top-0 z-[2] h-px bg-[linear-gradient(90deg,transparent_0%,var(--omnix-rgba-0-255-255-0-35)_30%,var(--omnix-rgba-0-255-255-0-6)_50%,var(--omnix-rgba-0-255-255-0-35)_70%,transparent_100%)]"
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
            "relative z-[1] flex min-h-[100svh] flex-col transition-[padding] duration-200 ease-out lg:h-full lg:min-h-0",
            isSidebarCollapsed ? "lg:pl-0" : "lg:pl-[var(--omnix-sidebar-w)]",
          )}
        >
          <Header
            sidebarCollapsed={isSidebarCollapsed}
            onMenuClick={() => setIsSidebarOpen(true)}
            onExpandSidebar={() => setIsSidebarCollapsed(false)}
          />
          <main
            id="main-content"
            className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain pb-[calc(4.25rem_+_env(safe-area-inset-bottom))] lg:overflow-hidden lg:pb-0"
          >
            <PageTransition className="flex min-h-0 flex-1 flex-col">{children}</PageTransition>
          </main>
          <MobileDock onMoreClick={() => setIsSidebarOpen(true)} />
          <KeyboardShortcutsModal
            isOpen={isShortcutsOpen}
            onClose={() => setIsShortcutsOpen(false)}
          />
          <PhoneNumberPrompt />
        </div>
      </div>
    </DashboardProviders>
  );
}
