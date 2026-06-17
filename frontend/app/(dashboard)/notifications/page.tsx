import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import { NotificationCenterSurface } from "@/components/notifications/NotificationCenterSurface";

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <NotificationsPageContent />
    </Suspense>
  );
}

function NotificationsPageContent() {
  return <NotificationCenterSurface />;
}
