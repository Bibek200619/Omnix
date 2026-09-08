import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  WorkspaceInitiative,
  WorkspaceInitiativeAssistance,
  WorkspaceInitiativeAssistanceMode,
} from "@/lib/workspace-types";
import { initiativeAssistanceLabels } from "./initiativeOptions";

type InitiativeSupportPanelProps = {
  assistance: WorkspaceInitiativeAssistance | null;
  assisting: WorkspaceInitiativeAssistanceMode | null;
  onRequestAssistance: (mode: WorkspaceInitiativeAssistanceMode) => void;
  selected: WorkspaceInitiative | null;
  selectedId: string | null;
};

export function InitiativeSupportPanel({
  assistance,
  assisting,
  onRequestAssistance,
  selected,
  selectedId,
}: InitiativeSupportPanelProps) {
  return (
    <aside className={cn(
      "order-2 space-y-3 lg:order-none xl:col-span-1",
      selectedId && "hidden xl:block",
    )}>
      <section className="omnix-panel rounded-xl p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Movement</p>
        <p className="mt-3 break-words text-sm font-medium leading-6 text-white">
          {selected?.momentum.summary || "Select an initiative to see recorded movement."}
        </p>
        {selected ? (
          <div className="mt-5 grid grid-cols-2 gap-2 text-center">
            {[
              ["Tasks", selected.momentum.open_task_count],
              ["Blocked", selected.momentum.blocked_task_count],
              ["Due soon", selected.momentum.due_soon_count],
              ["Comms", selected.momentum.channel_count],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-xl border border-[var(--omnix-border)] bg-black/15 px-2 py-2.5 transition hover:bg-white/[0.02]">
                <p className="text-xl font-bold text-white">{value}</p>
                <p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">{label}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <section className="omnix-panel rounded-xl p-4">
        <p className="mb-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-300/70"><Sparkles className="h-3.5 w-3.5" /> Mission Assist</p>
        <div className="grid gap-2">
          {Object.entries(initiativeAssistanceLabels).map(([mode, label]) => (
            <button key={mode} type="button" disabled={!selected || Boolean(assisting)} onClick={() => onRequestAssistance(mode as WorkspaceInitiativeAssistanceMode)} className="group flex items-center justify-between rounded-xl border border-purple-300/15 bg-purple-300/[0.03] px-4 py-2.5 text-left text-xs font-medium text-purple-100/90 transition hover:bg-purple-300/[0.08] disabled:opacity-40">
              {label}
              {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-40" />}
            </button>
          ))}
        </div>
        {assistance ? (
          <div className="mt-4 rounded-xl border border-purple-300/20 bg-purple-300/[0.04] p-4">
            <p className="whitespace-pre-wrap break-words text-xs leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
            <p className="mt-3 text-[10px] font-medium leading-relaxed text-[var(--omnix-text-3)]">Read from {assistance.source_task_count} tasks and {assistance.source_message_count} messages.</p>
          </div>
        ) : null}
      </section>
    </aside>
  );
}
