"use client";

import { useState } from "react";
import { CheckCircle2, XCircle, History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { WorkspaceDecision, WorkspaceDecisionStatus } from "@/lib/workspace-types";

interface DecisionLifecycleControlsProps {
  decision: WorkspaceDecision;
  onUpdate: (updated: WorkspaceDecision) => void;
}

export function DecisionLifecycleControls({ decision, onUpdate }: DecisionLifecycleControlsProps) {
  const [loading, setLoading] = useState<WorkspaceDecisionStatus | null>(null);

  const updateStatus = async (status: WorkspaceDecisionStatus) => {
    setLoading(status);
    try {
      const updated = await apiClient.patch<WorkspaceDecision>(
        `/workspaces/${decision.workspace_id}/decisions/${decision.id}/status`,
        { status }
      );
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to update decision status", err);
    } finally {
      setLoading(null);
    }
  };

  if (decision.status === "rejected") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-300/10 bg-rose-300/[0.03] px-3 py-2">
        <XCircle className="h-4 w-4 text-rose-300/60" />
        <span className="text-[11px] font-medium uppercase tracking-wider text-rose-100/70">Decision Rejected (Read-only)</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {decision.status === "proposed" && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-emerald-300/20 bg-emerald-300/[0.05] text-emerald-100 hover:bg-emerald-300/[0.1] hover:text-emerald-50"
            onClick={() => updateStatus("accepted")}
            disabled={!!loading}
            leftIcon={loading === "accepted" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 border border-rose-300/20 bg-rose-300/[0.05] text-rose-100 hover:bg-rose-300/[0.1] hover:text-rose-50"
            onClick={() => updateStatus("rejected")}
            disabled={!!loading}
            leftIcon={loading === "rejected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          >
            Reject
          </Button>
        </>
      )}

      {decision.status === "accepted" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 border border-amber-300/20 bg-amber-300/[0.05] text-amber-100 hover:bg-amber-300/[0.1] hover:text-amber-50"
          onClick={() => updateStatus("superseded")}
          disabled={!!loading}
          leftIcon={loading === "superseded" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        >
          Supersede
        </Button>
      )}

      {decision.status === "superseded" && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300/10 bg-amber-300/[0.03] px-3 py-2">
          <History className="h-4 w-4 text-amber-300/60" />
          <span className="text-[11px] font-medium uppercase tracking-wider text-amber-100/70">Decision Superseded</span>
        </div>
      )}
    </div>
  );
}
