"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Unlink2, Rocket, Plus, Loader2, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { WorkspaceDecision, WorkspaceInitiative } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

interface DecisionInitiativeLinkerProps {
  decision: WorkspaceDecision;
  onUpdate: (updated: WorkspaceDecision) => void;
}

export function DecisionInitiativeLinker({ decision, onUpdate }: DecisionInitiativeLinkerProps) {
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [showSelector, setShowSelector] = useState(false);
  const [search, setSearch] = useState("");

  const loadInitiatives = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<WorkspaceInitiative[]>(`/workspaces/${decision.workspace_id}/initiatives`);
      setInitiatives(data);
    } catch (err) {
      console.error("Failed to load initiatives", err);
    } finally {
      setLoading(false);
    }
  }, [decision.workspace_id]);

  useEffect(() => {
    if (showSelector) {
      void loadInitiatives();
    }
  }, [showSelector, loadInitiatives]);

  const updateInitiative = async (initiativeId: string | null) => {
    setLinking(true);
    try {
      const updated = await apiClient.patch<WorkspaceDecision>(
        `/workspaces/${decision.workspace_id}/decisions/${decision.id}/initiative`,
        { initiative_id: initiativeId }
      );
      onUpdate(updated);
      setShowSelector(false);
    } catch (err) {
      console.error("Failed to update initiative link", err);
    } finally {
      setLinking(false);
    }
  };

  const filteredInitiatives = initiatives.filter(i => 
    i.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-cyan-100/60" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">Strategic Impact</h4>
        </div>
        {!decision.initiative_id && !showSelector && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 gap-1.5 px-2 text-[10px]"
            onClick={() => setShowSelector(true)}
          >
            <Plus className="h-3 w-3" /> Link Initiative
          </Button>
        )}
      </div>

      {showSelector && (
        <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.03] p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-cyan-100/40" />
            <input
              type="text"
              placeholder="Search initiatives..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-cyan-300/10 bg-black/20 py-2 pl-8 pr-3 text-[11px] text-white placeholder:text-cyan-100/30 focus:border-cyan-300/30 focus:outline-none"
            />
          </div>
          <div className="omnix-scrollbar max-h-48 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-cyan-100/50" /></div>
            ) : filteredInitiatives.length === 0 ? (
              <p className="py-4 text-center text-[10px] text-cyan-100/40">No initiatives found.</p>
            ) : (
              filteredInitiatives.map((init) => (
                <button
                  key={init.id}
                  onClick={() => updateInitiative(init.id)}
                  disabled={linking}
                  className="flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-cyan-100/70 transition hover:bg-white/5"
                >
                  <span className="truncate text-[11px]">{init.title}</span>
                  <Link2 className="h-3 w-3 opacity-30" />
                </button>
              ))
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2 w-full text-[10px]"
            onClick={() => setShowSelector(false)}
          >
            Cancel
          </Button>
        </div>
      )}

      {decision.initiative && !showSelector && (
        <div className="flex items-center justify-between rounded-lg border border-[var(--omnix-border)] bg-cyan-300/[0.02] px-3 py-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.02)]">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{decision.initiative.title}</p>
            <div className="mt-1.5 flex items-center gap-2">
              <Rocket className="h-3 w-3 text-cyan-100/40" />
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tighter",
                decision.initiative.status === "complete" ? "bg-emerald-300/10 text-emerald-300" : "bg-cyan-300/10 text-cyan-300"
              )}>
                {decision.initiative.status}
              </span>
            </div>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-cyan-100/40 hover:text-rose-300"
            onClick={() => updateInitiative(null)}
            disabled={linking}
          >
            {linking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink2 className="h-4 w-4" />}
          </Button>
        </div>
      )}

      {!decision.initiative && !showSelector && (
        <p className="py-2 text-center text-[10px] italic text-cyan-100/40">No strategic initiative linked.</p>
      )}
    </div>
  );
}
