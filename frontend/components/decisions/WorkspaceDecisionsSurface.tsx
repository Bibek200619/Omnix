"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, CircleDot, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceDecision, WorkspaceDecisionStatus } from "@/lib/workspace-types";
import { DecisionContextPanel } from "./DecisionContextPanel";

const statusLabels: Record<WorkspaceDecisionStatus, string> = {
  proposed: "Proposed",
  accepted: "Accepted",
  rejected: "Rejected",
  superseded: "Superseded",
};

function statusClass(status: WorkspaceDecisionStatus) {
  if (status === "accepted") return "border-emerald-300/20 bg-emerald-300/[0.07] text-emerald-100";
  if (status === "rejected") return "border-rose-300/20 bg-rose-300/[0.07] text-rose-100";
  if (status === "superseded") return "border-amber-300/20 bg-amber-300/[0.07] text-amber-100";
  return "border-cyan-300/20 bg-cyan-300/[0.07] text-cyan-100";
}

export function WorkspaceDecisionsSurface() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const searchParams = useSearchParams();
  const [decisions, setDecisions] = useState<WorkspaceDecision[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const selected = useMemo(
    () => decisions.find((decision) => decision.id === selectedId) ?? decisions[0] ?? null,
    [decisions, selectedId],
  );

  const handleDecisionUpdate = useCallback((updated: WorkspaceDecision) => {
    setDecisions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
  }, []);

  const loadDecisions = useCallback(async () => {
    if (!activeWorkspaceId) {
      setDecisions([]);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const incoming = await apiClient.get<WorkspaceDecision[]>(`/workspaces/${activeWorkspaceId}/decisions`);
      if (requestId !== requestRef.current) return;
      setDecisions(incoming);
      setSelectedId((current) => (incoming.some((decision) => decision.id === current) ? current : incoming[0]?.id ?? null));
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load decisions.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const id = searchParams?.get("id");
    if (id) {
      setSelectedId(id);
    } else {
      setSelectedId(null);
    }
    void loadDecisions();
  }, [activeWorkspaceId, loadDecisions, searchParams]);

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to inspect recorded decisions.</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <BadgeCheck className="h-3.5 w-3.5" />
            Decision memory
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Workspace Decisions</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            {activeWorkspace?.name} choices recorded as organizational memory.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => void loadDecisions()}
          disabled={loading}
          leftIcon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        >
          Refresh
        </Button>
      </header>

      {error ? (
        <div className="mb-3 rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-3 lg:grid-cols-[21rem_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="omnix-panel flex min-h-0 flex-col rounded-xl p-3">
          <div className="mb-3 flex items-center justify-between px-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Decision list</p>
            <span className="rounded-full border border-cyan-300/12 bg-cyan-300/[0.04] px-2 py-1 text-[10px] text-cyan-100/70">
              {decisions.length}
            </span>
          </div>
          <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
            {loading ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && decisions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cyan-300/15 bg-cyan-300/[0.025] p-4 text-center">
                <BadgeCheck className="mx-auto h-6 w-6 text-cyan-100/35" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No decisions recorded.</p>
              </div>
            ) : null}
            {decisions.map((decision) => {
              const active = selected?.id === decision.id;
              return (
                <button
                  key={decision.id}
                  type="button"
                  onClick={() => setSelectedId(decision.id)}
                  className={cn(
                    "w-[min(17rem,80vw)] shrink-0 rounded-lg border px-3 py-3 text-left transition lg:w-full",
                    active
                      ? "border-cyan-300/25 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]"
                      : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="line-clamp-2 text-sm font-semibold leading-5 text-white">{decision.title}</span>
                    <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[9px] font-semibold uppercase", statusClass(decision.status))}>
                      {statusLabels[decision.status]}
                    </span>
                  </span>
                  <span className="mt-2 block truncate text-[11px] text-[var(--omnix-text-3)]">
                    {decision.decision_reason || decision.description || "No reason recorded."}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="omnix-panel min-h-0 min-w-0 overflow-hidden rounded-xl">
          {selected ? (
            <div className="flex h-full min-h-0 flex-col">
              <header className="border-b border-[var(--omnix-border)] px-4 py-4 sm:px-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mb-2 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">
                      <CircleDot className="h-3.5 w-3.5 text-cyan-100/60" />
                      Decision context
                    </p>
                    <h2 className="omnix-display max-w-4xl text-2xl font-semibold leading-tight text-white">{selected.title}</h2>
                  </div>
                  <span className={cn("rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]", statusClass(selected.status))}>
                    {statusLabels[selected.status]}
                  </span>
                </div>
              </header>
              <div className="min-h-0 flex-1">
                <DecisionContextPanel decision={selected} onUpdate={handleDecisionUpdate} />
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[22rem] items-center justify-center px-6 text-center">
              <div>
                <BadgeCheck className="mx-auto h-8 w-8 text-cyan-100/35" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">Decision detail will appear here.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
