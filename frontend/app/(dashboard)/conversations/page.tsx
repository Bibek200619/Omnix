"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import dynamic from "next/dynamic";

const WorkspaceConversationSurface = dynamic(
  () => import("@/components/conversations/WorkspaceConversationSurface").then((mod) => ({ default: mod.WorkspaceConversationSurface })),
  { ssr: false, loading: () => null },
);

export default function ConversationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ConversationsPageContent />
    </Suspense>
  );
}

function ConversationsPageContent() {
  return <WorkspaceConversationSurface />;
}
