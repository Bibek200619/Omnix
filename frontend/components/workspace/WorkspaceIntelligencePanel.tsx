"use client";

import { useState } from "react";
import { BrainCircuit, Database, FileText, Globe2, Layers3, Loader2, Sparkles, Users, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceIntelligenceProfile } from "@/lib/workspace-types";

const focusLabels: Record<WorkspaceIntelligenceProfile["workspace_focus"], string> = {
  research: "Research",
  engineering: "Engineering",
  design: "Design",
  strategy: "Strategy",
  general: "General Collaboration",
};

export function WorkspaceIntelligencePanel({
  profile,
  loading,
  error,
  compact = false,
  className,
}: {
  profile: WorkspaceIntelligenceProfile | null;
  loading?: boolean;
  error?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  
  const domains = profile?.active_domains ?? [];
  const sources = profile?.connected_sources ?? [];
  const insights = profile?.recent_insights ?? [];
  const summary = error ?? profile?.context_summary ?? "Intelligence awaiting workspace context synchronization.";
  const focus = profile?.workspace_focus ?? profile?.ai_specialization ?? "general";
  const expertise = profile?.expertise_area;

  return (
    <section className={cn(
      "relative overflow-hidden rounded-[18px] border border-white/5 bg-[linear-gradient(135deg,var(--omnix-rgba-15-23-42-0-8),var(--omnix-rgba-8-12-24-0-85))] shadow-xl backdrop-blur-xl transition-all duration-500 hover:shadow-cyan-500/5",
      className
    )}>
      <div className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-cyan-500/5 blur-[90px]" />
      <div className="pointer-events-none absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-purple-500/5 blur-[90px]" />
      
      {/* Clickable Header for Progressive Disclosure */}
      <button 
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="group relative z-10 flex w-full flex-col md:flex-row md:items-start justify-between gap-5 p-5 sm:p-6 text-left outline-none"
      >
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <div className="relative shrink-0">
            <span className={cn(
              "flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl border transition-all duration-500 group-hover:scale-105",
              loading 
                ? "border-cyan-400/20 bg-cyan-400/5 text-cyan-300/80" 
                : "border-purple-400/30 bg-purple-400/10 text-purple-300 shadow-[0_0_15px_var(--omnix-rgba-168-85-247-0-2)]"
            )}>
              {loading ? (
                <Loader2 className="h-5 w-5 sm:h-6 sm:w-6 animate-spin opacity-50" />
              ) : (
                <BrainCircuit className={cn("h-5 w-5 sm:h-6 sm:w-6", !loading && "animate-pulse")} />
              )}
            </span>
            <div className={cn(
              "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 sm:h-3 sm:w-3 rounded-full border-2 border-slate-900 shadow-sm",
              loading ? "bg-amber-500/80 animate-pulse" : "bg-emerald-500/80 shadow-[0_0_8px_var(--omnix-rgba-16-185-129-0-5)]"
            )} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="text-[9px] sm:text-[10px] font-medium uppercase tracking-[0.15em] sm:tracking-[0.2em] text-cyan-400/60">Workspace AI</p>
              {profile?.is_global && (
                <span className="flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/10 px-1.5 py-0.5 text-[8px] sm:text-[9px] font-medium text-purple-300 uppercase tracking-tight">
                  <Globe2 className="h-2 w-2 sm:h-2.5 sm:w-2.5" />
                  <span className="hidden xs:inline">Organization Wide</span>
                  <span className="xs:hidden">Global</span>
                </span>
              )}
            </div>
            <h3 className="mt-1 text-lg sm:text-xl font-medium tracking-tight text-white/90 group-hover:text-white transition-colors">
              {error ? "Workspace intelligence unavailable" : profile ? profile.workspace_name : "Waking up..."}
            </h3>
            {expertise && (
              <div className="mt-1 flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-emerald-400/90">
                <Sparkles className="h-3 w-3" />
                Specializing in {expertise}
              </div>
            )}
            <p className={cn("mt-2 sm:mt-3 text-[13px] sm:text-sm font-medium leading-relaxed text-slate-300/80 max-w-2xl transition-all", expanded ? "line-clamp-none" : "line-clamp-1")}>
               {summary}
            </p>
          </div>
        </div>
        
        <div className="shrink-0 flex flex-row md:flex-col items-center md:items-end justify-between w-full md:w-auto gap-4 border-t border-white/5 pt-4 md:border-0 md:pt-0">
          <div className="flex items-center gap-4">
            <div className="text-right hidden xs:block">
               <div className="text-[9px] font-medium uppercase tracking-wider text-white/30">Focus</div>
               <div className="text-xs sm:text-sm font-medium text-white/80">{focusLabels[focus]}</div>
            </div>
            <div className="h-7 w-px bg-white/5 hidden xs:block" />
            <div className="text-right">
               <div className="text-[9px] font-medium uppercase tracking-wider text-white/30">Search Scope</div>
               <div className="text-xs sm:text-sm font-medium text-cyan-400">{profile?.retrieval_scope === "global" ? "Everything" : "Workspace"}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] sm:text-[10px] font-medium uppercase tracking-wider text-white/40 group-hover:text-cyan-300/80 transition-colors">
            {expanded ? "Hide" : "Insights"}
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </div>
        </div>
      </button>

      {/* Expanded Content Area */}
      {expanded && (
        <div className="relative z-10 border-t border-white/5 px-4 pb-4 pt-2 animate-in fade-in slide-in-from-top-4 duration-300 sm:px-6 sm:pb-6">
          <div className={cn("grid gap-4", compact ? "grid-cols-2 md:grid-cols-4" : "grid-cols-2 lg:grid-cols-4")}>
            {[
              { label: "Connected Files", value: profile?.source_count ?? 0, icon: Database, color: "var(--omnix-color-22d3ee)" },
              { label: "Conversations", value: profile?.conversation_count ?? 0, icon: Layers3, color: "var(--omnix-color-c084fc)" },
              { label: "Team Members", value: profile?.member_count ?? 0, icon: Users, color: "var(--omnix-color-fbbf24)" },
              { label: "Topics", value: domains.length, icon: Globe2, color: "var(--omnix-color-10b981)" },
            ].slice(0, compact ? 4 : 4).map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.label} className="group/stat flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-4 transition-all duration-300 hover:bg-white/[0.04] hover:border-white/10">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-black/40 shadow-inner group-hover/stat:scale-110 transition-transform duration-300">
                    <Icon className="h-5 w-5 opacity-70" style={{ color: item.color }} />
                  </div>
                  <div>
                    <div className="text-lg font-medium tracking-tight text-white/90">{item.value}</div>
                    <div className="text-[9px] font-medium uppercase tracking-wider text-white/30">{item.label}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {!compact && (
            <div className="mt-8 grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-1">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/40">
                  <Globe2 className="h-3 w-3 text-cyan-400" />
                  Topics
                </div>
                <div className="flex flex-wrap gap-2">
                  {domains.length ? domains.map((domain) => (
                    <span key={domain} className="rounded-lg border border-white/5 bg-white/[0.04] px-2.5 py-1.5 text-[11px] font-medium text-cyan-50/70 hover:text-white transition-colors cursor-default">
                      {domain}
                    </span>
                  )) : (
                    <span className="text-[11px] font-medium text-white/20 italic">No topics identified yet.</span>
                  )}
                </div>
              </div>
              
              <div className="lg:col-span-2">
                <div className="mb-3 flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/40">
                  <Database className="h-3 w-3 text-emerald-400" />
                  Connected Files
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {sources.length ? sources.slice(0, 4).map((source) => (
                    <div key={source.id} className="group/src flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2.5 text-[11px] font-medium text-slate-300/80 transition-all hover:bg-white/[0.06] hover:text-white">
                      <FileText className="h-3.5 w-3.5 text-emerald-400/60 group-hover/src:text-emerald-400" />
                      <span className="min-w-0 flex-1 truncate">{source.name}</span>
                    </div>
                  )) : (
                    <div className="col-span-2 rounded-xl border border-dashed border-white/5 bg-white/[0.01] p-4 text-center text-[11px] font-medium text-white/20">
                      Connect files to help the AI learn about this workspace.
                    </div>
                  )}
                </div>
              </div>

              <div className="lg:col-span-3 border-t border-white/5 pt-6">
                <div className="mb-4 flex items-center gap-2 text-[10px] font-medium uppercase tracking-widest text-white/40">
                  <BrainCircuit className="h-3 w-3 text-purple-400" />
                  AI Memory
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
          )}
        </div>
      )}
    </section>
  );
}
