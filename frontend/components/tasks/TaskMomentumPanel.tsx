import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  WorkspaceTaskAssistance,
  WorkspaceTaskAssistanceMode,
  WorkspaceTaskMomentum,
} from "@/lib/workspace-types";

const assistLabels: Record<WorkspaceTaskAssistanceMode, string> = {
  blockers: "Surface blockers",
  stalled: "Due attention",
  next_actions: "Next actions",
  workload: "Ownership view",
};

type SimplifiedMomentum = {
  label: string;
  color: string;
  description: string;
};

type TaskMomentumPanelProps = {
  momentum: WorkspaceTaskMomentum | null;
  simplifiedMomentum: SimplifiedMomentum | null;
  taskCount: number;
  myOpenTaskCount: number;
  assistance: WorkspaceTaskAssistance | null;
  assisting: WorkspaceTaskAssistanceMode | null;
  onRequestAssistance: (mode: WorkspaceTaskAssistanceMode) => void;
};

export function TaskMomentumPanel({
  momentum,
  simplifiedMomentum,
  taskCount,
  myOpenTaskCount,
  assistance,
  assisting,
  onRequestAssistance,
}: TaskMomentumPanelProps) {
  return (
    <aside className="space-y-3">
      <section className="omnix-panel rounded-xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Momentum</p>
        {simplifiedMomentum && (
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <div className={cn("h-2 w-2 rounded-full shadow-[0_0_8px_currentColor]", simplifiedMomentum.color)} />
              <p className={cn("text-lg font-bold", simplifiedMomentum.color)}>{simplifiedMomentum.label}</p>
            </div>
            <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-2)]">{simplifiedMomentum.description}</p>
          </div>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2 text-center">
          {[
            ["Active", momentum?.flow_counts.active ?? 0],
            ["Blocked", momentum?.blocked_count ?? 0],
            ["Due soon", momentum?.due_soon_count ?? 0],
            ["My tasks", myOpenTaskCount],
          ].map(([label, count]) => (
            <div key={String(label)} className="rounded-lg border border-[var(--omnix-border)] bg-black/10 px-2 py-2 transition hover:bg-white/[0.02]">
              <p className="text-lg font-bold text-white">{count}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--omnix-text-3)]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="omnix-panel rounded-xl p-4">
        <p className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-100/70">
          <Sparkles className="h-3.5 w-3.5" /> Execution Assist
        </p>
        <div className="grid gap-1.5">
          {Object.entries(assistLabels).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              disabled={!taskCount || Boolean(assisting)}
              onClick={() => onRequestAssistance(mode as WorkspaceTaskAssistanceMode)}
              className="flex items-center justify-between rounded-lg border border-purple-300/12 bg-purple-300/[0.03] px-3 py-2 text-left text-xs text-purple-100/85 transition hover:bg-purple-300/[0.08] disabled:opacity-40"
            >
              {label}
              {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            </button>
          ))}
        </div>
        {assistance ? (
          <div className="mt-3 rounded-lg border border-purple-300/15 bg-purple-300/[0.045] p-3">
            <p className="whitespace-pre-wrap break-words text-xs leading-5 text-[var(--omnix-text)]">{assistance.content}</p>
            <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">
              Advisory only. Read from {assistance.source_task_count} task records.
            </p>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
