"use client";

import { memo } from "react";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { NotificationCenterSurface } from "@/components/notifications/NotificationCenterSurface";

export const MentionsInboxSurface = memo(function MentionsInboxSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Mentions inbox">
      <NotificationCenterSurface />
    </SurfaceErrorBoundary>
  );
});
