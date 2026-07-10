"use client";

import dynamic from "next/dynamic";
import { ConversationHistoryProvider } from "@/lib/conversation-history-context";
import { ProfileProvider } from "@/lib/profile-context";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { WorkspaceCollaborationProvider } from "@/lib/workspace-collaboration-context";
import { WorkspaceContinuityProvider } from "@/lib/workspace-continuity-context";
import { WorkspaceNotificationsProvider } from "@/lib/workspace-notifications-context";

const WorkspaceOnboardingGate = dynamic(
  () => import("@/components/workspace/WorkspaceOnboardingGate").then((mod) => ({ default: mod.WorkspaceOnboardingGate })),
  { ssr: false, loading: () => null },
);

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceProvider>
      <WorkspaceCollaborationProvider>
        <WorkspaceNotificationsProvider>
          <WorkspaceContinuityProvider>
            <ProfileProvider>
              <ConversationHistoryProvider>
                <WorkspaceOnboardingGate>{children}</WorkspaceOnboardingGate>
              </ConversationHistoryProvider>
            </ProfileProvider>
          </WorkspaceContinuityProvider>
        </WorkspaceNotificationsProvider>
      </WorkspaceCollaborationProvider>
    </WorkspaceProvider>
  );
}
