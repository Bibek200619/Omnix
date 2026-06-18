import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { NotificationCenterSurface } from "@/components/notifications/NotificationCenterSurface";

export default function MentionsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <MentionsPageContent />
    </Suspense>
  );
}

function MentionsPageContent() {
  return <NotificationCenterSurface />;
}
