"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BadgeCheck, Loader2, Plus, RefreshCw, Target, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceDecision, WorkspaceDecisionStatus } from "@/lib/workspace-types";
import { DecisionContextPanel } from "./DecisionContextPanel";
import { CreateDecisionModal } from "./CreateDecisionModal";

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
  const [statusFilter, setStatusFilter] = useState<WorkspaceDecisionStatus | "all">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const requestRef = useRef(0);

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
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        logClientError("Failed to load decisions", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions` });
        setError("Unable to load decisions.");
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
    void loadDecisions();
  }, [activeWorkspaceId, loadDecisions, searchParams]);

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
    <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-4 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.015)] px-4 py-4 sm:px-6 sm:py-5">
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
        <div className="flex items-center gap-3">
          <Button
            type="button"
            size="sm"
            onClick={() => setCreateOpen(true)}
            leftIcon={<Plus className="h-3.5 w-3.5" />}
            className="h-9 px-4 shadow-[0_0_15px_rgba(34,211,238,0.1)]"
          >
            New Decision
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => void loadDecisions()}
            disabled={loading}
            className="h-9 px-4 border border-cyan-300/10 hover:bg-cyan-300/5"
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
          }}
        />
      )}

      {/* Decision Overview Strip */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
        <div className="flex flex-1 flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-400/10 bg-cyan-400/[0.01] p-8 text-center sm:p-12">
          <div className="relative mb-8">
            <div className="absolute inset-0 -m-12 animate-pulse bg-cyan-400/5 blur-3xl rounded-full" />
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-400/20 bg-black/40 shadow-[0_0_30px_rgba(34,211,238,0.1)]">
              <BadgeCheck className="h-10 w-10 text-cyan-400" />
            </div>
          </div>
          
          <h2 className="omnix-display text-2xl font-bold text-white sm:text-3xl">Decision Memory</h2>
          <p className="mt-3 max-w-lg text-base text-[var(--omnix-text-2)]">
            Capture important organizational choices. Decisions preserve context, rationale, and follow-through.
          </p>

          <div className="mt-8 grid max-w-2xl gap-4 text-left sm:grid-cols-2">
            {[
              { title: "Preserve Rationale", desc: "Why a choice was made and the historical context.", icon: Target },
              { title: "Execution Linkage", desc: "What work came from it and which tasks it spawned.", icon: ListTodo },
              { title: "Strategic Impact", desc: "Which initiative it supports and how it fits the roadmap.", icon: BadgeCheck },
              { title: "Operational Audit", desc: "A searchable timeline of team consensus and shifts.", icon: RefreshCw },
            ].map((feature, i) => (
              <div key={i} className="flex gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition hover:bg-white/[0.04]">
                <feature.icon className="h-5 w-5 shrink-0 text-cyan-400/60" />
                <div>
                  <h4 className="text-sm font-semibold text-white">{feature.title}</h4>
                  <p className="mt-1 text-xs text-[var(--omnix-text-3)] leading-relaxed">{feature.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-10 flex flex-col items-center gap-4">
            <Button size="lg" onClick={() => setCreateOpen(true)} leftIcon={<Plus className="h-5 w-5" />} className="h-12 px-8 text-base shadow-[0_0_25px_rgba(34,211,238,0.2)]">
              Create First Decision
            </Button>
            <p className="text-xs text-[var(--omnix-text-3)]">
              Important conversations can also be converted into decisions.
            </p>
          </div>

          {/* Example Card (Phase 4) */}
          <div className="mt-12 w-full max-w-md text-left opacity-50 grayscale hover:opacity-80 hover:grayscale-0 transition-all duration-500">
            <p className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--omnix-text-3)]">Example Decision</p>
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/5 p-5 shadow-2xl">
              <div className="flex items-start justify-between">
                <div>
                  <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400">Accepted</span>
                  <h3 className="mt-2 text-sm font-bold text-white">Use Supabase Realtime</h3>
                </div>
                <BadgeCheck className="h-5 w-5 text-cyan-400/40" />
              </div>
              <p className="mt-3 text-[11px] text-[var(--omnix-text-2)] leading-relaxed">
                Reduce operational complexity by leveraging built-in sync.
              </p>
              <div className="mt-4 flex items-center gap-3 border-t border-white/5 pt-4">
                <div className="flex items-center gap-1.5">
                  <ListTodo className="h-3 w-3 text-white/20" />
                  <span className="text-[10px] font-medium text-white/40">4 tasks</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Target className="h-3 w-3 text-white/20" />
                  <span className="text-[10px] font-medium text-white/40">1 initiative</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-4 lg:grid-cols-[22rem_minmax(0,1fr)] lg:grid-rows-1">
          <aside className="omnix-panel flex min-h-0 flex-col rounded-2xl p-4 shadow-xl">
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
                      "flex-1 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-wider transition-all",
                      statusFilter === s 
                        ? "bg-cyan-400/10 text-cyan-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" 
                        : "text-[var(--omnix-text-3)] hover:text-[var(--omnix-text-2)]"
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>            </div>

            <div className="omnix-scrollbar -mx-1 flex min-h-0 gap-3 overflow-x-auto px-1 pb-1 lg:flex-1 lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
              {loading ? <Loader2 className="mx-auto mt-12 h-6 w-6 animate-spin text-cyan-400/40" /> : null}
              
              {!loading && filteredDecisions.length === 0 && decisions.length > 0 ? (
                <div className="py-12 text-center">
                  <p className="text-xs text-[var(--omnix-text-3)] italic">No decisions match this filter.</p>
                  <button 
                    onClick={() => setStatusFilter("all")}
                    className="mt-2 text-[10px] font-bold uppercase tracking-widest text-cyan-400 hover:text-cyan-300"
                  >
                    Clear filter
                  </button>
                </div>
              ) : null}

              {filteredDecisions.map((decision) => {
                const active = selected?.id === decision.id;
                return (
                  <button
                    key={decision.id}
                    type="button"
                    onClick={() => setSelectedId(decision.id)}
                    className={cn(
                      "w-[min(18rem,85vw)] shrink-0 group relative flex flex-col rounded-xl border p-4 text-left transition-all duration-300 lg:w-full",
                      active
                        ? "border-cyan-400/30 bg-cyan-400/[0.07] shadow-[0_0_20px_rgba(34,211,238,0.05)]"
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
                        decision.status === "accepted" ? "bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.5)]" :
                        decision.status === "proposed" ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" :
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

          <main className="omnix-panel min-h-0 min-w-0 overflow-hidden rounded-2xl border-[var(--omnix-border)] shadow-2xl">
            {selected ? (
              <div className="flex h-full min-h-0 flex-col">
                <header className="border-b border-[var(--omnix-border)] bg-white/[0.01] px-6 py-6">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-3 flex items-center gap-3">
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
