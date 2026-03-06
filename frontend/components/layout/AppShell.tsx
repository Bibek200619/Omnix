"use client";

import { useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { PageTransition } from "@/components/layout/PageTransition";
import { ConversationHistoryProvider } from "@/lib/conversation-history-context";
import { WorkspaceProvider } from "@/lib/workspace-context";

type AppShellProps = {
  children: React.ReactNode;
};

export function AppShell({ children }: AppShellProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <WorkspaceProvider>
      <ConversationHistoryProvider>
        <div className="surface-noise min-h-screen bg-canvas text-white">
          <Sidebar
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
          <div className="min-h-screen lg:pl-72">
            <Header onMenuClick={() => setIsSidebarOpen(true)} />
            <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-5 sm:px-6 lg:px-8">
              <PageTransition>{children}</PageTransition>
            </main>
          </div>
        </div>
      </ConversationHistoryProvider>
    </WorkspaceProvider>
  );
}
