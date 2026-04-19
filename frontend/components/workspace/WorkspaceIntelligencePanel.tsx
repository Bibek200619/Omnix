"use client";

import type { CSSProperties } from "react";
import { BrainCircuit, Database, FileText, Globe2, Layers3, Loader2, Sparkles } from "lucide-react";
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
  const summary = profile?.context_summary ?? "Workspace intelligence is ready once a workspace is selected.";
  const mode = profile?.ai_specialization ?? "general";

  return (
    <section className={cn("omnix-cinematic-card overflow-hidden p-5", className)}>
      <div className="pointer-events-none absolute right-[-6rem] top-[-6rem] h-56 w-56 rounded-full bg-cyan-300/10 blur-[80px]" />
      <div className="relative z-10 flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-[var(--omnix-glow-sm)]">
            {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <BrainCircuit className="h-5 w-5" />}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Workspace intelligence</p>
            <h3 className="omnix-display mt-1 text-lg font-semibold text-white">
              {profile ? `${profile.workspace_name} context` : "Context not loaded"}
            </h3>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text-2)]">{summary}</p>
          </div>
        </div>
        <span
          className="shrink-0 rounded-full border px-3 py-1 text-xs font-semibold"
          style={{
            borderColor: profile?.retrieval_scope === "global" ? "rgba(155,92,255,0.35)" : "rgba(0,255,255,0.28)",
            background: profile?.retrieval_scope === "global" ? "rgba(155,92,255,0.12)" : "rgba(0,255,255,0.09)",
            color: profile?.retrieval_scope === "global" ? "rgb(216,196,255)" : "rgb(180,255,255)",
          }}
        >
          {profile?.retrieval_scope === "global" ? "Global scope" : "Workspace scope"}
        </span>
      </div>

      <div className={cn("relative z-10 mt-5 grid gap-3", compact ? "sm:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4")}>
        {[
          { label: "AI mode", value: modeLabels[mode], icon: Sparkles, color: "var(--omnix-cyan)" },
          { label: "Sources active", value: profile?.source_count ?? 0, icon: Database, color: "var(--omnix-green)" },
          { label: "Memory threads", value: profile?.conversation_count ?? 0, icon: Layers3, color: "var(--omnix-purple)" },
          { label: "Members", value: profile?.member_count ?? 0, icon: Globe2, color: "var(--omnix-amber)" },
        ].slice(0, compact ? 3 : 4).map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-xl border border-[var(--omnix-border)] bg-black/15 p-3" style={{ "--metric-color": item.color } as CSSProperties}>
              <Icon className="h-4 w-4" style={{ color: item.color }} />
              <div className="mt-3 truncate text-sm font-semibold text-white">{item.value}</div>
              <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{item.label}</div>
            </div>
          );
        })}
      </div>

      {!compact ? (
        <div className="relative z-10 mt-5 grid gap-4 lg:grid-cols-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Active domains</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {domains.length ? domains.map((domain) => (
                <span key={domain} className="rounded-full border border-cyan-300/18 bg-cyan-300/8 px-2.5 py-1 text-xs text-cyan-100">
                  {domain}
                </span>
              )) : (
                <span className="rounded-full border border-dashed border-[var(--omnix-border)] px-2.5 py-1 text-xs text-[var(--omnix-text-3)]">
                  No domains detected yet
                </span>
              )}
            </div>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Connected sources</p>
            <div className="mt-3 space-y-2">
              {sources.length ? sources.slice(0, 3).map((source) => (
                <div key={source.id} className="flex items-center gap-2 rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 py-2 text-xs text-[var(--omnix-text-2)]">
                  <FileText className="h-3.5 w-3.5 text-cyan-200" />
                  <span className="min-w-0 flex-1 truncate">{source.name}</span>
                </div>
              )) : (
                <div className="rounded-lg border border-dashed border-[var(--omnix-border)] bg-black/10 px-3 py-3 text-xs text-[var(--omnix-text-3)]">
                  Connect workspace sources to activate retrieval memory.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
