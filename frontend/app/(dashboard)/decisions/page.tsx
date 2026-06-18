import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { Suspense } from "react";
import { WorkspaceDecisionsSurface } from "@/components/decisions/WorkspaceDecisionsSurface";
import { Loader2 } from "lucide-react";

export default function DecisionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DecisionsPageContent />
    </Suspense>
  );
}

function DecisionsPageContent() {
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-cyan-100/50" /></div>}>
      <WorkspaceDecisionsSurface />
    </Suspense>
  );
}
