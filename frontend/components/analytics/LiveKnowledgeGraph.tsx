"use client";

import {
  Activity,
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Database,
  GitBranch,
  Layers3,
  MessageSquare,
  Server,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useDecorativeMotionEnabled } from "@/lib/use-decorative-motion";
import { cn } from "@/lib/utils";

type LiveKnowledgeGraphProps = {
  conversationCount: number;
  memberCount: number;
  sourceCount: number;
  workspaceCount: number;
  workerCount: number;
  runtimeStatus: string;
};

type NodeTone = "cyan" | "green" | "violet" | "amber" | "blue";

type GraphNodeCardProps = {
  title: string;
  value: string | number;
  detail: string;
  icon: LucideIcon;
  tone: NodeTone;
  progress?: number;
  emphasis?: boolean;
};

const toneClasses: Record<NodeTone, { icon: string; border: string; glow: string; bar: string; text: string }> = {
  cyan: {
    icon: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
    border: "border-cyan-300/18",
    glow: "from-cyan-300/12",
    bar: "bg-cyan-300",
    text: "text-cyan-100",
  },
  green: {
    icon: "border-emerald-300/25 bg-emerald-300/10 text-emerald-100",
    border: "border-emerald-300/18",
    glow: "from-emerald-300/12",
    bar: "bg-emerald-300",
    text: "text-emerald-100",
  },
  violet: {
    icon: "border-violet-300/25 bg-violet-300/10 text-violet-100",
    border: "border-violet-300/18",
    glow: "from-violet-300/12",
    bar: "bg-violet-300",
    text: "text-violet-100",
  },
  amber: {
    icon: "border-amber-300/25 bg-amber-300/10 text-amber-100",
    border: "border-amber-300/18",
    glow: "from-amber-300/12",
    bar: "bg-amber-300",
    text: "text-amber-100",
  },
  blue: {
    icon: "border-blue-300/25 bg-blue-300/10 text-blue-100",
    border: "border-blue-300/18",
    glow: "from-blue-300/12",
    bar: "bg-blue-300",
    text: "text-blue-100",
  },
};

function formatStatus(status: string) {
  if (!status) return "Unavailable";
  return status.replace(/_/g, " ");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function graphProgress(value: number, target: number) {
  if (value <= 0) return 0;
  if (target <= 0) return 0;
  return clamp(Math.round((value / target) * 100), 8, 100);
}

function GraphNodeCard({ title, value, detail, icon: Icon, tone, progress, emphasis }: GraphNodeCardProps) {
  const toneClass = toneClasses[tone];

  return (
    <article
      className={cn(
        "relative min-w-0 overflow-hidden rounded-xl border bg-[#07111d]/95 p-3 shadow-inner",
        toneClass.border,
        emphasis ? "min-h-[9.75rem] sm:p-4" : "min-h-[7.25rem]",
      )}
    >
      <div className={cn("pointer-events-none absolute inset-0 bg-gradient-to-br to-transparent opacity-80", toneClass.glow)} />
      <div className="relative z-10 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">{title}</p>
          <div className={cn("mt-2 truncate font-black tabular-nums text-white", emphasis ? "text-3xl" : "text-2xl")}>{value}</div>
        </div>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border", toneClass.icon)}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
      </div>
      <p className="relative z-10 mt-2 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-3)]">{detail}</p>
      {typeof progress === "number" ? (
        <div className="relative z-10 mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className={cn("h-full rounded-full", toneClass.bar)} style={{ width: `${progress}%` }} />
        </div>
      ) : null}
    </article>
  );
}

function FlowChip({ children, tone }: { children: string; tone: NodeTone }) {
  return (
    <span className={cn("rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]", toneClasses[tone].border, toneClasses[tone].text)}>
      {children}
    </span>
  );
}

export function LiveKnowledgeGraph({
  conversationCount,
  memberCount,
  sourceCount,
  workspaceCount,
  workerCount,
  runtimeStatus,
}: LiveKnowledgeGraphProps) {
  const motionEnabled = useDecorativeMotionEnabled({
    disableOnCoarsePointer: false,
    disableOnSmallScreen: false,
  });
  const normalizedStatus = runtimeStatus.toLowerCase();
  const runtimeHealthy = normalizedStatus === "healthy";
  const contextItems = sourceCount + workspaceCount;
  const accessSignal = memberCount + workerCount;

  const sourceProgress = graphProgress(sourceCount, 12);
  const contextProgress = graphProgress(contextItems, 16);
  const sessionProgress = graphProgress(conversationCount, 12);
  const memberProgress = graphProgress(memberCount, 8);
  const runtimeProgress = runtimeHealthy ? 100 : workerCount > 0 ? 68 : 18;

  return (
    <section className="relative overflow-hidden rounded-[var(--omnix-radius)] border border-cyan-300/10 bg-black/20 p-3 shadow-[var(--omnix-glow-xs)] sm:p-4">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(0,255,255,0.075),rgba(155,92,255,0.045),transparent_68%)]" />
      <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
            <BrainCircuit className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[12px] font-black uppercase tracking-[0.14em] text-white">LIVE KNOWLEDGE GRAPH</h2>
            <p className="mt-1 truncate text-xs text-[var(--omnix-text-3)]">Sources become workspace context, then flow into AI answers.</p>
          </div>
        </div>
        <div
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em]",
            runtimeHealthy ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100" : "border-amber-300/20 bg-amber-300/10 text-amber-100",
          )}
        >
          <span className={cn("h-1.5 w-1.5 rounded-full", runtimeHealthy ? "bg-emerald-300" : "bg-amber-300", motionEnabled && "animate-pulse")} />
          {formatStatus(runtimeStatus)}
        </div>
      </div>

      <div className="relative z-10 mt-3 grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(15rem,0.7fr)]">
        <div
          className="relative overflow-hidden rounded-xl border border-white/[0.06] bg-[#020915]/85 p-3 sm:p-4 lg:p-5"
          data-omnix-live-knowledge-graph="true"
        >
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.025)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.025)_1px,transparent_1px)] bg-[size:42px_42px]" />
          <svg className="pointer-events-none absolute inset-0 hidden h-full w-full lg:block" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <marker id="omnix-graph-arrow" markerHeight="5" markerWidth="5" orient="auto" refX="4.2" refY="2.5">
                <path d="M0,0 L5,2.5 L0,5 Z" fill="rgba(0,255,255,0.72)" />
              </marker>
              <linearGradient id="omnix-graph-line" x1="0" x2="1" y1="0" y2="0">
                <stop offset="0%" stopColor="rgba(0,232,122,0.55)" />
                <stop offset="52%" stopColor="rgba(0,255,255,0.72)" />
                <stop offset="100%" stopColor="rgba(155,92,255,0.58)" />
              </linearGradient>
            </defs>
            <path d="M29 50 C36 50 38 50 43 50" fill="none" markerEnd="url(#omnix-graph-arrow)" stroke="url(#omnix-graph-line)" strokeWidth="0.62" />
            <path d="M57 50 C64 50 66 50 72 50" fill="none" markerEnd="url(#omnix-graph-arrow)" stroke="url(#omnix-graph-line)" strokeWidth="0.62" />
            <path d="M50 27 C50 34 50 37 50 41" fill="none" markerEnd="url(#omnix-graph-arrow)" stroke="rgba(155,92,255,0.58)" strokeWidth="0.45" />
            <path d="M27 77 C34 70 40 63 44 57" fill="none" markerEnd="url(#omnix-graph-arrow)" stroke="rgba(51,102,255,0.54)" strokeWidth="0.45" />
            <path d="M50 77 C50 69 50 64 50 58" fill="none" markerEnd="url(#omnix-graph-arrow)" stroke="rgba(255,184,0,0.58)" strokeWidth="0.45" />
          </svg>

          <div className="relative z-10 grid gap-3 lg:grid-cols-3 lg:grid-rows-[minmax(6rem,auto)_minmax(9rem,auto)_minmax(6rem,auto)]">
            <div className="lg:col-start-2 lg:row-start-1">
              <GraphNodeCard
                title="Team Access"
                value={memberCount}
                detail="People allowed to reach this workspace memory."
                icon={Users}
                tone="violet"
                progress={memberProgress}
              />
            </div>
            <div className="lg:col-start-1 lg:row-start-2">
              <GraphNodeCard
                title="Sources"
                value={sourceCount}
                detail="Files and knowledge assets available for retrieval."
                icon={Database}
                tone="green"
                progress={sourceProgress}
              />
            </div>
            <div className="lg:col-start-2 lg:row-start-2">
              <GraphNodeCard
                title="Workspace Context"
                value={contextItems}
                detail="The scoped memory layer combining sources and workspace structure."
                icon={BrainCircuit}
                tone="cyan"
                progress={contextProgress}
                emphasis
              />
            </div>
            <div className="lg:col-start-3 lg:row-start-2">
              <GraphNodeCard
                title="AI Answers"
                value={conversationCount}
                detail="Sessions using the current workspace context."
                icon={MessageSquare}
                tone="violet"
                progress={sessionProgress}
              />
            </div>
            <div className="lg:col-start-1 lg:row-start-3">
              <GraphNodeCard
                title="Workspace Scope"
                value={workspaceCount}
                detail="Spaces that define where private knowledge can flow."
                icon={Layers3}
                tone="blue"
                progress={graphProgress(workspaceCount, 6)}
              />
            </div>
            <div className="lg:col-start-2 lg:row-start-3">
              <GraphNodeCard
                title="Runtime"
                value={workerCount}
                detail={runtimeHealthy ? "Runtime is healthy and ready to process context." : "Runtime telemetry is limited or unavailable."}
                icon={Server}
                tone={runtimeHealthy ? "green" : "amber"}
                progress={runtimeProgress}
              />
            </div>
          </div>

          <div className="relative z-10 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.06] bg-black/25 px-3 py-2">
            <FlowChip tone="green">Sources</FlowChip>
            <ArrowRight className="h-3.5 w-3.5 text-[var(--omnix-text-3)]" aria-hidden="true" />
            <FlowChip tone="cyan">Workspace Context</FlowChip>
            <ArrowRight className="h-3.5 w-3.5 text-[var(--omnix-text-3)]" aria-hidden="true" />
            <FlowChip tone="violet">AI Answers</FlowChip>
          </div>
        </div>

        <aside className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
              <GitBranch className="h-3.5 w-3.5 text-cyan-200" aria-hidden="true" />
              Primary Flow
            </div>
            <p className="mt-2 text-sm font-semibold text-white">Sources to context to answers</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">The center node is the active workspace memory used by chat.</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" aria-hidden="true" />
              Readiness
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{contextItems > 0 ? "Context Available" : "Add Sources"}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">{contextItems} scoped item{contextItems === 1 ? "" : "s"} feeding the graph.</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">
              <Activity className="h-3.5 w-3.5 text-amber-200" aria-hidden="true" />
              Live Signal
            </div>
            <p className="mt-2 text-sm font-semibold text-white">{accessSignal} access signal{accessSignal === 1 ? "" : "s"}</p>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Members plus workers currently shaping graph availability.</p>
          </div>
        </aside>
      </div>
    </section>
  );
}
