"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import dynamic from "next/dynamic";

const WorkspaceInitiativesSurface = dynamic(
  () => import("@/components/initiatives/WorkspaceInitiativesSurface").then((mod) => ({ default: mod.WorkspaceInitiativesSurface })),
  { ssr: false, loading: () => null },
);

export default function InitiativesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InitiativesPageContent />
    </Suspense>
  );
}

function InitiativesPageContent() {
  return <WorkspaceInitiativesSurface />;
}
