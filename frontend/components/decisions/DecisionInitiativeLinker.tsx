"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Unlink2, Rocket, Plus, Loader2, Search, Target } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { WorkspaceDecision, WorkspaceInitiative } from "@/lib/workspace-types";

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
          <Target className="h-4 w-4 text-cyan-400" />
          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Strategic Impact</h4>
        </div>
        {!decision.initiative_id && !showSelector && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-3 text-[10px] font-bold uppercase tracking-widest border border-cyan-400/20 hover:bg-cyan-400/10 text-cyan-400"
            onClick={() => setShowSelector(true)}
          >
            <Plus className="h-3 w-3" /> Link
          </Button>
        )}
      </div>

      {showSelector && (
        <div className="rounded-xl border border-cyan-400/20 bg-black/40 p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-cyan-400/40" />
            <input
              type="text"
              placeholder="Search initiatives..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-9 pr-4 text-[11px] text-white placeholder:text-white/20 focus:border-cyan-400/40 focus:outline-none transition-colors"
            />
          </div>
          <div className="omnix-scrollbar max-h-56 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-cyan-400/40" /></div>
            ) : filteredInitiatives.length === 0 ? (
              <p className="py-6 text-center text-[10px] text-white/30 italic">No initiatives found.</p>
            ) : (
              filteredInitiatives.map((init) => (
                <button
                  key={init.id}
                  onClick={() => updateInitiative(init.id)}
                  disabled={linking}
                  className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[11px] text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  <span className="truncate">{init.title}</span>
                  <Link2 className="h-3.5 w-3.5 opacity-30" />
                </button>
              ))
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="mt-3 w-full text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white/60"
            onClick={() => setShowSelector(false)}
          >
            Cancel
          </Button>
        </div>
      )}

      {decision.initiative && !showSelector && (
        <div className="group relative overflow-hidden rounded-xl border border-cyan-400/20 bg-cyan-400/[0.03] p-4 transition-all hover:bg-cyan-400/[0.06] hover:border-cyan-400/40">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white leading-snug">{decision.initiative.title}</p>
              <div className="mt-2.5 flex items-center gap-3">
                <div className="flex items-center gap-1.5 rounded-full bg-cyan-400/10 px-2 py-0.5 border border-cyan-400/10">
                  <Rocket className="h-3 w-3 text-cyan-400" />
                  <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">
                    {decision.initiative.status}
                  </span>
                </div>
                <span className="text-[10px] text-white/30 font-mono italic">Strategic Link</span>
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 w-8 rounded-lg p-0 text-white/20 hover:bg-rose-500/10 hover:text-rose-400 transition-all"
              onClick={() => updateInitiative(null)}
              disabled={linking}
            >
              {linking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      )}

      {!decision.initiative && !showSelector && (
        <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.01] py-4 px-4 text-center">
          <p className="text-[10px] font-medium italic text-white/20">No strategic initiative linked.</p>
        </div>
      )}
    </div>
  );
}

