"use client";

import Link from "next/link";
import { BrainCircuit, CheckCircle2, Database, Server, ShieldCheck } from "lucide-react";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { useWorkspaceIntelligence, useWorkspaceTree } from "@/lib/workspace-context";
import type { WorkspaceFocus } from "@/lib/workspace-types";

const focusLabels: Record<WorkspaceFocus, string> = {
  general: "General",
  engineering: "Engineering",
  design: "Design",
  research: "Research",
  strategy: "Strategy",
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--omnix-border)] bg-black/20 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

export default function AISettingsPage() {
  const { activeWorkspace } = useWorkspaceTree();
  const { activeWorkspaceIntelligence } = useWorkspaceIntelligence();
  const focus = activeWorkspace?.workspace_focus ?? activeWorkspace?.ai_specialization ?? "general";
  const preferences = activeWorkspace?.intelligence_preferences ?? {};
  const memoryEnabled = preferences.memory_enabled !== false;
  const retrievalScope = activeWorkspace?.is_global ? "Global" : "Workspace";

  return (
    <SettingsShell
      title="AI Settings"
      description="Review the active workspace intelligence surface. Cognitive posture changes are saved on the workspace record."
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <section className="omnix-cinematic-card border-[var(--omnix-border-active)] bg-cyan-300/[0.04] p-5 shadow-[var(--omnix-glow-xs)]">
          <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100">
              <Server className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="omnix-display text-lg font-semibold text-white">Connected Model</h3>
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300/25 bg-emerald-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-100">
                  <CheckCircle2 className="h-3 w-3" />
                  Online
                </span>
              </div>
              <p className="mt-1 text-sm text-[var(--omnix-text-2)]">Operational model routing is managed via the Omnix Intelligence API.</p>
            </div>
          </div>
          <div className="relative z-10 mt-4 grid gap-3 sm:grid-cols-3">
            <StatRow label="Routing API" value="Production" />
            <StatRow label="Streaming" value="Active" />
            <StatRow label="Inference" value="Cloud Native" />
          </div>
        </section>

        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <BrainCircuit className="h-4 w-4 text-cyan-200" />
                Workspace Cognition
              </div>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-[var(--omnix-text-3)]">
                Focus is stored per workspace and applied inside the chat system prompt and streaming pipeline.
              </p>
            </div>
            <Link
              href="/settings/workspace"
              className="inline-flex h-9 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-300/15"
            >
              Edit workspace
            </Link>
          </div>
          <div className="relative z-10 grid gap-3 sm:grid-cols-2">
            <StatRow label="Cognitive focus" value={focusLabels[focus]} />
            <StatRow label="Retrieval scope" value={retrievalScope} />
            <StatRow label="Workspace memory" value={memoryEnabled ? "Enabled" : "Disabled"} />
            <StatRow label="Authorized sources" value={String(activeWorkspaceIntelligence?.source_count ?? 0)} />
          </div>
        </section>

        <section className="omnix-cinematic-card p-5">
          <div className="relative z-10 mb-4 flex items-center gap-2 text-sm font-semibold text-white">
            <ShieldCheck className="h-4 w-4 text-emerald-200" />
            Context Integrity
          </div>
          <div className="relative z-10 grid gap-3 sm:grid-cols-3">
            <StatRow label="Profile" value={activeWorkspaceIntelligence ? "Loaded" : "Syncing"} />
            <StatRow label="Sources" value={`${activeWorkspaceIntelligence?.connected_sources.length ?? 0} visible`} />
            <StatRow label="Domains" value={`${activeWorkspaceIntelligence?.active_domains.length ?? 0} detected`} />
          </div>
          <div className="relative z-10 mt-4 rounded-lg border border-[var(--omnix-border)] bg-black/15 px-3 py-3 text-xs leading-5 text-[var(--omnix-text-2)]">
            <Database className="mr-2 inline h-3.5 w-3.5 text-cyan-200" />
            These values reflect the active workspace record and backend intelligence profile.
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
