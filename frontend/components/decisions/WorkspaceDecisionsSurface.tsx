"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, Loader2, Plus, RefreshCw, Target, ListTodo } from "lucide-react";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceDecision, WorkspaceDecisionStatus } from "@/lib/workspace-types";
import { DecisionContextPanel } from "./DecisionContextPanel";

const CreateDecisionModal = dynamic(
  () => import("./CreateDecisionModal").then((mod) => ({ default: mod.CreateDecisionModal })),
  { ssr: false, loading: () => null },
);

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

export const WorkspaceDecisionsSurface = memo(function WorkspaceDecisionsSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Workspace decisions">
      <WorkspaceDecisionsSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function WorkspaceDecisionsSurfaceContent() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const searchParams = useSearchParams();
  const routeCreateDecision = searchParams?.get("create") === "decision";
  const [decisions, setDecisions] = useState<WorkspaceDecision[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<WorkspaceDecisionStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const requestRef = useRef(0);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const liveAnnouncementRef = useRef("");
  const [liveAnnouncementVersion, setLiveAnnouncementVersion] = useState(0);

  const announceMutation = useCallback((message: string) => {
    liveAnnouncementRef.current = message;
    setLiveAnnouncementVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!liveRegionRef.current) return;
    liveRegionRef.current.textContent = "";
    const timer = window.setTimeout(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = liveAnnouncementRef.current;
      }
    }, 10);
    return () => window.clearTimeout(timer);
  }, [liveAnnouncementVersion]);

  const stats = useMemo(() => {
    return {
      total: decisions.length,
      accepted: decisions.filter(d => d.status === "accepted").length,
      proposed: decisions.filter(d => d.status === "proposed").length,
      superseded: decisions.filter(d => d.status === "superseded").length,
      rejected: decisions.filter(d => d.status === "rejected").length,
    };
  }, [decisions]);

  const filteredDecisions = useMemo(() => {
    if (statusFilter === "all") return decisions;
    return decisions.filter((d) => d.status === statusFilter);
  }, [decisions, statusFilter]);

  const selected = useMemo(
    () => decisions.find((decision) => decision.id === selectedId) ?? filteredDecisions[0] ?? null,
    [decisions, filteredDecisions, selectedId],
  );

  const handleDecisionUpdate = useCallback((updated: WorkspaceDecision) => {
    setDecisions((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
    announceMutation(`Decision ${updated.title} updated.`);
  }, [announceMutation]);

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
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        logClientError("Failed to load decisions", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions` });
        setError("Unable to load decisions. Check your connection and try again.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    const id = searchParams?.get("id");
    if (id) {
      setSelectedId(id);
    }
    if (routeCreateDecision) {
      setCreateOpen(true);
    }
    void loadDecisions();
  }, [activeWorkspaceId, loadDecisions, routeCreateDecision, searchParams]);

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <div className="max-w-md text-center">
          <BadgeCheck className="mx-auto mb-4 h-12 w-12 text-cyan-100/20" />
          <h2 className="text-xl font-semibold text-white">Select a workspace</h2>
          <p className="mt-2 text-sm text-[var(--omnix-text-2)]">Choose a workspace from the sidebar to inspect recorded decisions and organizational memory.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="omnix-container-responsive flex min-h-0 flex-1 flex-col overflow-x-hidden px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-4 rounded-2xl border border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-255-255-0-015)] px-4 py-4 sm:px-6 sm:py-5">
        <div>
          <p className="mb-1.5 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/70">
            <BadgeCheck className="h-4 w-4" />
            Decision Intelligence
          </p>
          <h1 className="omnix-display text-2xl font-bold tracking-tight text-white">Workspace Decisions</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            Architectural and operational choices for <span className="text-cyan-100/90 font-medium">{activeWorkspace?.name}</span>.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            className="h-9 flex-1 px-4 shadow-[0_0_15px_var(--omnix-rgba-34-211-238-0-1)] sm:flex-none"
          >
            New Decision
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void loadDecisions()}
            disabled={loading}
            className="h-9 flex-1 border border-cyan-300/10 px-4 hover:bg-cyan-300/5 sm:flex-none"
            leftIcon={loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          >
            Refresh Memory
          </Button>
        </div>
      </header>

      {createOpen && (
        <CreateDecisionModal 
          workspaceId={activeWorkspaceId}
          onClose={() => setCreateOpen(false)}
          onSuccess={(decision) => {
            setDecisions(prev => [decision, ...prev]);
            setSelectedId(decision.id);
            setCreateOpen(false);
            announceMutation(`Decision ${decision.title} created.`);
          }}
        />
      )}

      {/* Decision Overview Strip */}
      <div className={cn("mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4", selectedId && "hidden xl:grid")}>
        {[
          { label: "Accepted", value: stats.accepted, color: "text-emerald-400", bg: "bg-emerald-400/5" },
          { label: "Proposed", value: stats.proposed, color: "text-cyan-400", bg: "bg-cyan-400/5" },
          { label: "Superseded", value: stats.superseded, color: "text-amber-400", bg: "bg-amber-400/5" },
          { label: "Rejected", value: stats.rejected, color: "text-rose-400", bg: "bg-rose-400/5" },
        ].map((stat, i) => (
          <div key={i} className={cn("flex flex-col rounded-xl border border-[var(--omnix-border)] p-3 transition-colors", stat.bg)}>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">{stat.label}</span>
            <span className={cn("mt-1 text-2xl font-bold font-mono", stat.color)}>{stat.value}</span>
          </div>
        ))}
      </div>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title="Decisions are unavailable"
          message={error}
          onRetry={() => void loadDecisions()}
          isRetrying={loading}
        />
      ) : null}

      {!loading && decisions.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title="No decisions recorded"
          description="Capture decisions to build your organization's memory"
          action={{ label: "Record Decision", onClick: () => setCreateOpen(true) }}
          className="flex-1"
        />
      ) : (
        <div className="omnix-decisions-workbench" data-selection={selectedId ? "active" : "empty"}>
          <aside className={cn(
            "omnix-panel omnix-decisions-list flex min-h-0 flex-col rounded-2xl p-4 shadow-xl",
          )}>
            <div className="mb-4">
              <div className="mb-3 flex items-center justify-between px-1">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[var(--omnix-text-3)]">Memory Bank</p>
                <span className="rounded-full border border-cyan-300/12 bg-cyan-300/[0.04] px-2.5 py-0.5 text-[10px] font-mono text-cyan-400">
                  {filteredDecisions.length}
                </span>
              </div>
              
              {/* Status Filter Tabs */}
              <div className="flex gap-1 rounded-lg bg-black/20 p-1 border border-[var(--omnix-border)]">
                {(["all", "accepted", "proposed", "superseded", "rejected"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    className={cn(
                      "min-h-11 flex-1 rounded-md px-2 text-[10px] font-bold uppercase tracking-wider transition-all",
                      statusFilter === s 
                        ? "bg-cyan-400/10 text-cyan-400 shadow-[inset_0_1px_1px_var(--omnix-rgba-255-255-255-0-05)]" 
                        : "text-[var(--omnix-text-3)] hover:text-[var(--omnix-text-2)]"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>            </div>

            <div className="omnix-scrollbar -mx-1 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
              {loading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-cyan-400/40" /> : null}
              
              {!loading && filteredDecisions.length === 0 && decisions.length > 0 ? (
                <div className="py-12 text-center">
                  <p className="text-sm font-medium text-white">No decisions match this filter.</p>
                  <p className="mx-auto mt-1 max-w-xs text-xs leading-5 text-[var(--omnix-text-3)]">
                    Clear the status filter to return to the full decision memory.
                  </p>
                  <button 
                    onClick={() => setStatusFilter("all")}
                    className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-cyan-300/14 bg-cyan-300/[0.055] px-3 text-[10px] font-bold uppercase tracking-widest text-cyan-400 hover:text-cyan-300"
                  >
                    Clear filter
                  </button>
                </div>
              ) : null}

              {filteredDecisions.map((decision) => {
                const active = selectedId === decision.id;
                return (
                  <button
                    key={decision.id}
                    type="button"
                    onClick={() => setSelectedId(decision.id)}
                    className={cn(
                      "group relative mb-2 flex flex-col rounded-xl border p-4 text-left transition-all duration-300",
                      active
                        ? "border-cyan-400/30 bg-cyan-400/[0.07] shadow-[0_0_20px_var(--omnix-rgba-34-211-238-0-05)]"
                        : "border-transparent hover:border-white/10 hover:bg-white/[0.03]",
                    )}
                  >
                    {active && <div className="absolute left-0 top-4 bottom-4 w-1 bg-cyan-400 rounded-r-full" />}
                    <div className="flex items-start justify-between gap-3">
                      <span className={cn(
                        "line-clamp-2 text-sm font-semibold leading-tight transition-colors",
                        active ? "text-white" : "text-[var(--omnix-text-2)] group-hover:text-white"
                      )}>
                        {decision.title}
                      </span>
                      <div className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full mt-1.5",
                        decision.status === "accepted" ? "bg-emerald-400 shadow-[0_0_8px_var(--omnix-rgba-52-211-153-0-5)]" :
                        decision.status === "proposed" ? "bg-cyan-400 shadow-[0_0_8px_var(--omnix-rgba-34-211-238-0-5)]" :
                        "bg-amber-400"
                      )} />
                    </div>
                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="text-[10px] font-mono text-[var(--omnix-text-3)]">
                        {decision.created_at ? new Date(decision.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : "N/A"}
                      </span>
                      <span className="h-0.5 w-0.5 rounded-full bg-white/10" />
                      <span className="line-clamp-1 text-[10px] font-medium uppercase tracking-tight text-[var(--omnix-text-3)] group-hover:text-[var(--omnix-text-2)]">
                        {statusLabels[decision.status]}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className={cn(
            "omnix-panel omnix-decisions-detail flex min-h-0 min-w-0 overflow-hidden rounded-2xl border-[var(--omnix-border)] shadow-2xl",
          )}>
            {selected ? (
              <div className="flex h-full min-h-0 flex-col">
                <header className="border-b border-[var(--omnix-border)] bg-white/[0.01] px-6 py-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex items-center gap-3">
                        <button
                          type="button"
                          onClick={() => setSelectedId(null)}
                          className="omnix-decisions-back flex min-h-11 items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
                        >
                          ‹ Back
                        </button>
                        <span className={cn(
                          "rounded-full border px-2.5 py-0.5 text-[9px] font-bold uppercase tracking-widest", 
                          statusClass(selected.status)
                        )}>
                          {statusLabels[selected.status]}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--omnix-text-3)]">
                          Decision Entry
                        </span>
                      </div>
                      <h2 className="omnix-display max-w-4xl text-2xl sm:text-3xl font-bold leading-tight tracking-tight text-white">
                        {selected.title}
                      </h2>
                    </div>
                  </div>
                </header>
                <div className="min-h-0 flex-1">
                  <DecisionContextPanel decision={selected} onUpdate={handleDecisionUpdate} />
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[25rem] flex-col items-center justify-center px-10 text-center">
                <div className="relative mb-6">
                  <div className="absolute inset-0 -m-8 animate-pulse bg-cyan-400/5 blur-3xl rounded-full" />
                  <BadgeCheck className="relative h-16 w-16 text-cyan-400/10" />
                </div>
                <h3 className="text-lg font-semibold text-white">Select a Decision</h3>
                <p className="mt-2 max-w-xs text-sm text-[var(--omnix-text-3)] leading-relaxed">
                  Review historical choices, architectural shifts, and team consensus to maintain operational continuity.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                  <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-left">
                    <Target className="h-4 w-4 text-cyan-400/40" />
                    <p className="text-[10px] text-[var(--omnix-text-3)]">Decisions can be linked to strategic initiatives for roadmap alignment.</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] p-3 text-left">
                    <ListTodo className="h-4 w-4 text-emerald-400/40" />
                    <p className="text-[10px] text-[var(--omnix-text-3)]">Linked tasks allow you to track the execution of your choices.</p>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      )}
    </section>
  );
}
