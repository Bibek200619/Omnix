"use client";

import dynamic from "next/dynamic";
import { ConversationHistoryProvider } from "@/lib/conversation-history-context";
import { ProfileProvider } from "@/lib/profile-context";
import { OmnixQueryProvider } from "@/lib/query-provider";
import { WorkspaceProvider } from "@/lib/workspace-provider";
import { WorkspaceCollaborationProvider } from "@/lib/workspace-collaboration-context";
import { WorkspaceNotificationsProvider } from "@/lib/workspace-notifications-context";

const WorkspaceOnboardingGate = dynamic(
  () => import("@/components/workspace/WorkspaceOnboardingGate").then((mod) => ({ default: mod.WorkspaceOnboardingGate })),
  { ssr: false, loading: () => null },
);

export function DashboardProviders({ children }: { children: React.ReactNode }) {
  return (
    <OmnixQueryProvider>
      <WorkspaceProvider>
        <WorkspaceCollaborationProvider>
          <WorkspaceNotificationsProvider>
            <ProfileProvider>
              <ConversationHistoryProvider>
                <WorkspaceOnboardingGate>{children}</WorkspaceOnboardingGate>
              </ConversationHistoryProvider>
            </ProfileProvider>
          </WorkspaceNotificationsProvider>
        </WorkspaceCollaborationProvider>
      </WorkspaceProvider>
    </OmnixQueryProvider>
  );
}
