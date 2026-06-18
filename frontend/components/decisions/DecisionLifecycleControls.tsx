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
      <div className="flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-400/[0.05] px-4 py-1.5 shadow-[0_0_15px_var(--omnix-rgba-rgba-251-113-133-0-05)]">
        <XCircle className="h-3.5 w-3.5 text-rose-400" />
        <span className="text-[10px] font-bold uppercase tracking-widest text-rose-400/90">Decision Rejected</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {decision.status === "proposed" && (
        <>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full border border-emerald-400/30 bg-emerald-400/[0.08] px-4 text-[10px] font-bold uppercase tracking-widest text-emerald-400 hover:bg-emerald-400/[0.15] hover:text-emerald-300 shadow-[0_2px_10px_var(--omnix-rgba-rgba-52-211-153-0-05)]"
            onClick={() => updateStatus("accepted")}
            disabled={!!loading}
            leftIcon={loading === "accepted" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
          >
            Finalize Choice
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 rounded-full border border-rose-400/20 bg-rose-400/[0.05] px-4 text-[10px] font-bold uppercase tracking-widest text-rose-400/80 hover:bg-rose-400/[0.1] hover:text-rose-300"
            onClick={() => updateStatus("rejected")}
            disabled={!!loading}
            leftIcon={loading === "rejected" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
          >
            Decline
          </Button>
        </>
      )}

      {decision.status === "accepted" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-8 rounded-full border border-amber-400/30 bg-amber-400/[0.08] px-4 text-[10px] font-bold uppercase tracking-widest text-amber-400 hover:bg-amber-400/[0.15] hover:text-amber-300 shadow-[0_2px_10px_var(--omnix-rgba-rgba-251-191-36-0-05)]"
          onClick={() => updateStatus("superseded")}
          disabled={!!loading}
          leftIcon={loading === "superseded" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}
        >
          Supersede
        </Button>
      )}

      {decision.status === "superseded" && (
        <div className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/[0.05] px-4 py-1.5 shadow-[0_0_15px_var(--omnix-rgba-rgba-251-191-36-0-05)]">
          <History className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-400/90">Superseded</span>
        </div>
      )}
    </div>
  );
}

