"use client";

import { useEffect } from "react";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { logClientError } from "@/lib/errors";

type DashboardErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  useEffect(() => {
    logClientError("Dashboard route failed to render", error, {
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="omnix-page-frame">
      <div className="omnix-content-max">
        <OmnixErrorState
          title="Dashboard view needs attention"
          message="This workspace view could not be rendered. Retry the view before refreshing the full session."
          retryLabel="Retry view"
          onRetry={reset}
        />
      </div>
    </div>
  );
}
