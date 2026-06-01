"use client";

import { useCallback, useEffect, useState } from "react";
import { Link2, Unlink2, ListTodo, Plus, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { apiClient } from "@/lib/api";
import { WorkspaceDecision, WorkspaceTask } from "@/lib/workspace-types";
import { cn } from "@/lib/utils";

interface DecisionTaskLinkerProps {
  decision: WorkspaceDecision;
  onUpdate: (updated: WorkspaceDecision) => void;
}

export function DecisionTaskLinker({ decision, onUpdate }: DecisionTaskLinkerProps) {
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [showSelector, setShowSelector] = useState(false);
  const [search, setSearch] = useState("");

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiClient.get<WorkspaceTask[]>(`/workspaces/${decision.workspace_id}/tasks`);
      setTasks(data);
    } catch (err) {
      console.error("Failed to load tasks", err);
    } finally {
      setLoading(false);
    }
  }, [decision.workspace_id]);

  useEffect(() => {
    if (showSelector) {
      void loadTasks();
    }
  }, [showSelector, loadTasks]);

  const toggleLink = async (taskId: string, isLinked: boolean) => {
    setLinking(taskId);
    try {
      let updated: WorkspaceDecision;
      if (isLinked) {
        updated = await apiClient.delete<WorkspaceDecision>(
          `/workspaces/${decision.workspace_id}/decisions/${decision.id}/tasks/${taskId}`
        );
      } else {
        updated = await apiClient.post<WorkspaceDecision>(
          `/workspaces/${decision.workspace_id}/decisions/${decision.id}/tasks`,
          { task_id: taskId }
        );
      }
      onUpdate(updated);
    } catch (err) {
      console.error("Failed to toggle task link", err);
    } finally {
      setLinking(null);
    }
  };

  const linkedIds = new Set(decision.linked_tasks.map((t) => t.id));
  const filteredTasks = tasks.filter(t => 
    t.title.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListTodo className="h-4 w-4 text-cyan-100/60" />
          <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">Linked Tasks</h4>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1.5 px-2 text-[10px]"
          onClick={() => setShowSelector(!showSelector)}
        >
          {showSelector ? "Done" : <><Plus className="h-3 w-3" /> Link Task</>}
        </Button>
      </div>

      {showSelector && (
        <div className="rounded-lg border border-cyan-300/15 bg-cyan-300/[0.03] p-2">
          <div className="relative mb-2">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-cyan-100/40" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-cyan-300/10 bg-black/20 py-2 pl-8 pr-3 text-[11px] text-white placeholder:text-cyan-100/30 focus:border-cyan-300/30 focus:outline-none"
            />
          </div>
          <div className="omnix-scrollbar max-h-48 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-4 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin text-cyan-100/50" /></div>
            ) : filteredTasks.length === 0 ? (
              <p className="py-4 text-center text-[10px] text-cyan-100/40">No tasks found.</p>
            ) : (
              filteredTasks.map((task) => {
                const isLinked = linkedIds.has(task.id);
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleLink(task.id, isLinked)}
                    disabled={linking === task.id}
                    className={cn(
                      "flex w-full items-center justify-between rounded-md px-2 py-2 text-left transition",
                      isLinked ? "bg-cyan-300/10 text-cyan-50" : "hover:bg-white/5 text-cyan-100/70"
                    )}
                  >
                    <span className="truncate text-[11px]">{task.title}</span>
                    {linking === task.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isLinked ? (
                      <Unlink2 className="h-3 w-3 opacity-50" />
                    ) : (
                      <Link2 className="h-3 w-3 opacity-30" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {decision.linked_tasks.length === 0 && !showSelector ? (
          <p className="py-2 text-center text-[10px] italic text-cyan-100/40">No tasks linked to this decision.</p>
        ) : (
          decision.linked_tasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between rounded-lg border border-[var(--omnix-border)] bg-black/10 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white">{task.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn(
                    "rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-tighter",
                    task.status === "complete" ? "bg-emerald-300/10 text-emerald-300" : "bg-cyan-300/10 text-cyan-300"
                  )}>
                    {task.status}
                  </span>
                  {task.owner_user_id && (
                    <span className="text-[9px] text-cyan-100/40 truncate">
                      Owner: {task.owner_user_id.slice(0, 8)}...
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-cyan-100/40 hover:text-rose-300"
                onClick={() => toggleLink(task.id, true)}
                disabled={linking === task.id}
              >
                {linking === task.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink2 className="h-3.5 w-3.5" />}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
