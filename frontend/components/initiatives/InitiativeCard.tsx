import { cn } from "@/lib/utils";
import type { WorkspaceInitiative } from "@/lib/workspace-types";
import { initiativeMomentumLabels } from "./initiativeOptions";

type InitiativeCardProps = {
  initiative: WorkspaceInitiative;
  selected: boolean;
  onSelect: () => void;
};

export function InitiativeCard({ initiative, selected, onSelect }: InitiativeCardProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group w-[min(15rem,78vw)] shrink-0 rounded-xl border p-3.5 text-left transition lg:w-full",
        selected
          ? "border-cyan-300/35 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]"
          : "border-[var(--omnix-border)] bg-black/10 hover:bg-white/[0.025]",
      )}
    >
      <p className={cn("truncate text-sm font-medium transition", selected ? "text-white" : "text-[var(--omnix-text-2)] group-hover:text-white")}>
        {initiative.title}
      </p>
      <div className="mt-3 flex items-center justify-between gap-2 text-[10px]">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wider",
            initiative.status === "at_risk"
              ? "border-rose-400/30 text-rose-300"
              : "border-[var(--omnix-border)] text-cyan-100/70",
          )}
        >
          {initiative.status.replace("_", " ")}
        </span>
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              initiative.momentum.health === "blocked_execution"
                ? "bg-amber-400 shadow-[0_0_8px_var(--omnix-rgba-251-191-36-0-5)]"
                : initiative.momentum.health === "active_movement"
                  ? "bg-cyan-400 shadow-[0_0_8px_var(--omnix-rgba-34-211-238-0-5)]"
                  : "bg-[var(--omnix-text-3)]",
            )}
          />
          <span className="font-medium text-[var(--omnix-text-3)]">
            {initiativeMomentumLabels[initiative.momentum.health]}
          </span>
        </div>
      </div>
    </button>
  );
}
