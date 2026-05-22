"use client";

import { BrainCircuit, Database, FileText, Globe2, Layers3, Loader2, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceIntelligenceProfile } from "@/lib/workspace-types";

const modeLabels: Record<WorkspaceIntelligenceProfile["ai_specialization"], string> = {
  research: "Research",
  coding: "Coding",
  design: "Design",
  strategy: "Strategy",
  analytics: "Analytics",
  general: "General Collaboration",
};

export function WorkspaceIntelligencePanel({
  profile,
  loading,
  compact = false,
  className,
}: {
  profile: WorkspaceIntelligenceProfile | null;
  loading?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const domains = profile?.active_domains ?? [];
  const sources = profile?.connected_sources ?? [];
  const insights = profile?.recent_insights ?? [];
  const summary = profile?.context_summary ?? "Intelligence awaiting workspace context synchronization.";
  const mode = profile?.ai_specialization ?? "general";
  const expertise = profile?.expertise_area;

  return (
    <section className={cn(
      "relative overflow-hidden rounded-[18px] border border-white/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.9),rgba(8,12,24,0.95))] p-6 shadow-2xl backdrop-blur-xl transition-all duration-500 hover:shadow-cyan-500/10",
      className
    )}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/10 blur-[90px] animate-pulse" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-purple-500/10 blur-[90px] animate-pulse" />
      
      <div className="relative z-10 flex flex-col md:flex-row md:items-start justify-between gap-6">
        <div className="flex min-w-0 gap-4">
          <div className="relative shrink-0">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-400/30 bg-cyan-400/10 text-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.2)]">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : <BrainCircuit className="h-6 w-6" />}
            </span>
            <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] border-2 border-slate-900" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/60">Operational Intelligence</p>
              {profile?.is_global && (
                <span className="flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-2 py-0.5 text-[9px] font-bold text-purple-300 uppercase tracking-tight">
                  <Globe2 className="h-2.5 w-2.5" />
                  Global Context
                </span>
              )}
            </div>
            <h3 className="mt-1.5 text-xl font-bold tracking-tight text-white/90">
              {profile ? profile.workspace_name : "Identity Offline"}
            </h3>
            {expertise && (
              <div className="mt-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400/90">
                <Sparkles className="h-3 w-3" />
                Specializing in {expertise}
              </div>
            )}
            <p className="mt-3 text-sm font-medium leading-relaxed text-slate-300/80 max-w-2xl">{summary}</p>
          </div>
        </div>
        
        <div className="shrink-0 flex items-center gap-3">
          <div className="text-right">
             <div className="text-[10px] font-bold uppercase tracking-wider text-white/30">AI Strategy</div>
             <div className="text-sm font-bold text-white/80">{modeLabels[mode]}</div>
          </div>
          <div className="h-8 w-px bg-white/5" />
          <div className="text-right">
             <div className="text-[10px] font-bold uppercase tracking-wider text-white/30">Scope</div>
             <div className="text-sm font-bold text-cyan-400">{profile?.retrieval_scope === "global" ? "Federated" : "Isolated"}</div>
          </div>
        </div>
      </div>

      <div className={cn("relative z-10 mt-8 grid gap-4", compact ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 lg:grid-cols-4")}>
        {[
          { label: "Knowledge Sources", value: profile?.source_count ?? 0, icon: Database, color: "#22d3ee" },
          { label: "Memory Threads", value: profile?.conversation_count ?? 0, icon: Layers3, color: "#c084fc" },
          { label: "Collaboration Depth", value: profile?.member_count ?? 0, icon: Users, color: "#fbbf24" },
          { label: "Retrieved Domains", value: domains.length, icon: Globe2, color: "#10b981" },
        ].slice(0, compact ? 4 : 4).map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/10">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 shadow-inner group-hover:scale-110 transition-transform duration-300">
                <Icon className="h-5 w-5 opacity-70" style={{ color: item.color }} />
              </div>
              <div>
                <div className="text-lg font-bold tracking-tight text-white/90">{item.value}</div>
                <div className="text-[9px] font-bold uppercase tracking-wider text-white/30">{item.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      {!compact ? (
        <div className="relative z-10 mt-8 grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-1">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <Globe2 className="h-3 w-3 text-cyan-400" />
              Active Domains
            </div>
            <div className="flex flex-wrap gap-2">
              {domains.length ? domains.map((domain) => (
                <span key={domain} className="rounded-lg border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-bold text-cyan-50/70 hover:text-white transition-colors cursor-default">
                  {domain}
                </span>
              )) : (
                <span className="text-[11px] font-medium text-white/20 italic">No domains identified in current scope.</span>
              )}
            </div>
          </div>
          
          <div className="lg:col-span-2">
            <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <Database className="h-3 w-3 text-emerald-400" />
              Intelligence Sources
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {sources.length ? sources.slice(0, 4).map((source) => (
                <div key={source.id} className="group flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-[11px] font-medium text-slate-300/80 transition-all hover:bg-white/[0.06] hover:text-white">
                  <FileText className="h-3.5 w-3.5 text-emerald-400/60 group-hover:text-emerald-400" />
                  <span className="min-w-0 flex-1 truncate">{source.name}</span>
                </div>
              )) : (
                <div className="col-span-2 rounded-xl border border-dashed border-white/5 bg-white/[0.01] p-4 text-center text-[11px] font-medium text-white/20">
                  Connect workspace assets to hydrate retrieval memory.
                </div>
              )}
            </div>
          </div>

          <div className="lg:col-span-3 border-t border-white/5 pt-6">
            <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-white/40">
              <BrainCircuit className="h-3 w-3 text-purple-400" />
              AI Memory Synthesis
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {insights.length ? insights.slice(0, 4).map((insight) => (
                <div key={insight} className="relative overflow-hidden rounded-xl border border-white/5 bg-white/[0.03] p-4 text-[11px] font-medium leading-relaxed text-slate-300/80 hover:bg-white/[0.05] transition-colors">
                  <div className="absolute top-0 left-0 h-1 w-full bg-gradient-to-r from-purple-500/20 to-transparent" />
                  {insight}
                </div>
              )) : (
                <div className="col-span-full rounded-xl border border-dashed border-white/5 bg-white/[0.01] p-6 text-center text-[11px] font-medium text-white/20">
                  Memory synthesis will begin as AI interactions evolve.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
