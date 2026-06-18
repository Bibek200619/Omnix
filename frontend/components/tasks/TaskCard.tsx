import { AlertTriangle, CalendarDays, Compass, UserRound, X } from "lucide-react";
import { MentionText } from "@/components/mentions/MentionText";
import { DecisionTraceabilityList } from "@/components/decisions/DecisionTraceabilityList";
import { cn } from "@/lib/utils";
import type {
  WorkspaceInitiative,
  WorkspaceMember,
  WorkspaceTask,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";

type TaskPhase = {
  value: WorkspaceTaskStatus;
  label: string;
};

type TaskCardProps = {
  task: WorkspaceTask;
  members: WorkspaceMember[];
  initiatives: WorkspaceInitiative[];
  phases: TaskPhase[];
  currentUserId?: string;
  focused: boolean;
  updating: boolean;
  blockerDraft: string;
  onPatchTask: (task: WorkspaceTask, payload: Partial<WorkspaceTask>) => void;
  onBlockerDraftChange: (taskId: string, value: string) => void;
  onAddBlocker: (task: WorkspaceTask) => void;
  taskRef: (taskId: string, node: HTMLElement | null) => void;
};

export function TaskCard({
  task,
  members,
  initiatives,
  phases,
  currentUserId,
  focused,
  updating,
  blockerDraft,
  onPatchTask,
  onBlockerDraftChange,
  onAddBlocker,
  taskRef,
}: TaskCardProps) {
  const isMyTask = task.owner_user_id === currentUserId;
  const isBlocked = task.blockers.length > 0;
  const isActive = task.status === "active";
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(now.getDate() + 3);
  const isDueSoon = task.due_date && new Date(task.due_date) <= threeDaysFromNow;

  return (
    <article
      ref={(node) => {
        taskRef(task.id, node);
      }}
      className={cn(
        "group relative rounded-xl border p-3.5 transition",
        focused
          ? "border-cyan-300/45 bg-cyan-300/[0.07] shadow-[var(--omnix-glow-xs)]"
          : isBlocked
            ? "border-amber-400/30 bg-amber-400/[0.03]"
            : "border-[var(--omnix-border)] bg-black/[0.12] hover:bg-white/[0.03]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {isBlocked && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
            {isActive && <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_var(--omnix-rgba-34-211-238-0-8)]" />}
            <p className="truncate text-sm font-medium text-white">{task.title}</p>
          </div>
          {task.description ? (
            <p className="mt-1 line-clamp-2 break-words text-xs text-[var(--omnix-text-2)]">
              <MentionText content={task.description} mentions={task.mentions} />
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={task.status}
            disabled={updating}
            onChange={(event) => onPatchTask(task, { status: event.target.value as WorkspaceTaskStatus })}
            className={cn(
              "omnix-input h-7 rounded-lg px-2 text-[11px] font-semibold transition focus-visible:ring-2 focus-visible:ring-cyan-300/70",
              task.status === "active" ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "bg-black/20",
            )}
            aria-label={`Status for ${task.title}`}
          >
            {phases.map((phase) => (
              <option key={phase.value} value={phase.value}>
                {phase.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-2)]">
            <UserRound className={cn("h-3 w-3", isMyTask ? "text-emerald-300" : "text-[var(--omnix-text-3)]")} />
            <select
              value={task.owner_user_id || ""}
              disabled={updating}
              onChange={(event) => onPatchTask(task, { owner_user_id: event.target.value || null })}
              className="bg-transparent outline-none"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.full_name || member.email || "Teammate"}
                </option>
              ))}
            </select>
          </div>

          <div className={cn("flex items-center gap-1.5 text-[11px]", isDueSoon ? "font-medium text-rose-300" : "text-[var(--omnix-text-2)]")}>
            <CalendarDays className="h-3 w-3" />
            <input
              type="date"
              value={task.due_date || ""}
              disabled={updating}
              onChange={(event) => onPatchTask(task, { due_date: event.target.value || null })}
              className="bg-transparent outline-none"
            />
            {!task.due_date && <span className="text-[var(--omnix-text-3)]">No date</span>}
          </div>
        </div>

        <div className="flex items-center gap-3 opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-3)]">
            <Compass className="h-3 w-3" />
            <select
              value={task.initiative_id || ""}
              disabled={updating}
              onChange={(event) => onPatchTask(task, { initiative_id: event.target.value || null })}
              className="max-w-[120px] truncate bg-transparent outline-none"
            >
              <option value="">No initiative</option>
              {initiatives.map((initiative) => (
                <option key={initiative.id} value={initiative.id}>
                  {initiative.title}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {task.blockers.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {task.blockers.map((blocker) => (
            <button
              type="button"
              key={blocker}
              onClick={() => onPatchTask(task, { blockers: task.blockers.filter((entry) => entry !== blocker) })}
              className="inline-flex max-w-full items-center gap-1 rounded-md border border-amber-300/20 bg-amber-300/[0.08] px-2 py-1 text-left text-[10px] font-medium text-amber-100"
            >
              <span className="min-w-0 break-words">{blocker}</span>
              <X className="h-2.5 w-2.5 shrink-0 opacity-60" />
            </button>
          ))}
        </div>
      )}

      <DecisionTraceabilityList decisions={task.linked_decisions} />

      <div className="mt-2.5 border-t border-white/[0.04] pt-2.5 opacity-100 transition-opacity focus-within:opacity-100 md:opacity-0 md:group-hover:opacity-100">
        <input
          value={blockerDraft}
          onChange={(event) => onBlockerDraftChange(task.id, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddBlocker(task);
            }
          }}
          placeholder="Add blocker..."
          className="h-6 w-full bg-transparent px-1 text-[10px] text-[var(--omnix-text-3)] outline-none placeholder:text-white/10 focus:placeholder:text-white/20"
        />
      </div>
    </article>
  );
}
