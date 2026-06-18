import type { RefObject } from "react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { ClipboardCheck } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import type {
  WorkspaceInitiative,
  WorkspaceMember,
  WorkspaceTask,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";
import { TaskCard } from "./TaskCard";

type TaskPhase = {
  value: WorkspaceTaskStatus;
  label: string;
};

type TaskListProps = {
  listRef: RefObject<HTMLDivElement | null>;
  loading: boolean;
  tasks: WorkspaceTask[];
  virtualItems: VirtualItem[];
  totalSize: number;
  measureElement: (node: HTMLDivElement | null) => void;
  members: WorkspaceMember[];
  initiatives: WorkspaceInitiative[];
  phases: TaskPhase[];
  currentUserId?: string;
  focusedTaskId: string | null;
  updatingId: string | null;
  blockerDrafts: Record<string, string>;
  onCreateClick: () => void;
  onPatchTask: (task: WorkspaceTask, payload: Partial<WorkspaceTask>) => void;
  onBlockerDraftChange: (taskId: string, value: string) => void;
  onAddBlocker: (task: WorkspaceTask) => void;
  taskRef: (taskId: string, node: HTMLElement | null) => void;
};

export function TaskList({
  listRef,
  loading,
  tasks,
  virtualItems,
  totalSize,
  measureElement,
  members,
  initiatives,
  phases,
  currentUserId,
  focusedTaskId,
  updatingId,
  blockerDrafts,
  onCreateClick,
  onPatchTask,
  onBlockerDraftChange,
  onAddBlocker,
  taskRef,
}: TaskListProps) {
  return (
    <div ref={listRef} className="omnix-scrollbar overflow-y-auto xl:min-h-0 xl:flex-1">
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-xl border border-[var(--omnix-border)] bg-black/[0.12] p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton variant="line" className="h-4 w-2/3" />
                  <Skeleton variant="line" className="mt-2 h-3 w-full max-w-md" />
                </div>
                <Skeleton className="h-7 w-24 rounded-lg" />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <Skeleton variant="line" className="h-3 w-28" />
                <Skeleton variant="line" className="h-3 w-24" />
                <Skeleton variant="line" className="h-3 w-32" />
              </div>
              <Skeleton variant="line" className="mt-3 h-3 w-full max-w-sm" />
            </div>
          ))}
        </div>
      ) : null}

      {!loading && tasks.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No tasks yet"
          description="Create your first task to start tracking execution"
          action={{ label: "Create Task", onClick: onCreateClick }}
          className="mx-auto mt-10 max-w-lg"
        />
      ) : null}

      {!loading && tasks.length > 0 ? (
        <div className="relative w-full" style={{ height: totalSize }}>
          {virtualItems.map((virtualRow) => {
            const task = tasks[virtualRow.index];
            if (!task) return null;

            return (
              <div
                key={task.id}
                data-index={virtualRow.index}
                ref={measureElement}
                className="absolute left-0 top-0 w-full pb-2"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <TaskCard
                  task={task}
                  members={members}
                  initiatives={initiatives}
                  phases={phases}
                  currentUserId={currentUserId}
                  focused={focusedTaskId === task.id}
                  updating={updatingId === task.id}
                  blockerDraft={blockerDrafts[task.id] || ""}
                  onPatchTask={onPatchTask}
                  onBlockerDraftChange={onBlockerDraftChange}
                  onAddBlocker={onAddBlocker}
                  taskRef={taskRef}
                />
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
