"use client";

import dynamic from "next/dynamic";

const WorkspaceInitiativesSurface = dynamic(
  () => import("@/components/initiatives/WorkspaceInitiativesSurface").then((mod) => ({ default: mod.WorkspaceInitiativesSurface })),
  { ssr: false, loading: () => null },
);

export default function InitiativesPage() {
  return <WorkspaceInitiativesSurface />;
}
