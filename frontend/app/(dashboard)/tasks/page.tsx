import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { WorkspaceTasksSurface } from "@/components/tasks/WorkspaceTasksSurface";

export default function TasksPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TasksPageContent />
    </Suspense>
  );
}

function TasksPageContent() {
  return <WorkspaceTasksSurface />;
}
