import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { NotificationCenterSurface } from "@/components/notifications/NotificationCenterSurface";

export function MentionsInboxSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Mentions inbox">
      <NotificationCenterSurface />
    </SurfaceErrorBoundary>
  );
}
