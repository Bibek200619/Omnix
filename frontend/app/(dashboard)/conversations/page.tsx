"use client";

import dynamic from "next/dynamic";

const WorkspaceConversationSurface = dynamic(
  () => import("@/components/conversations/WorkspaceConversationSurface").then((mod) => ({ default: mod.WorkspaceConversationSurface })),
  { ssr: false, loading: () => null },
);

export default function ConversationsPage() {
  return <WorkspaceConversationSurface />;
}
