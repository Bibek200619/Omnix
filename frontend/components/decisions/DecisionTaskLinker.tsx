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
          <ListTodo className="h-4 w-4 text-white/40" />
          <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-white">Execution Tasks</h4>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-[10px] font-bold uppercase tracking-widest border border-white/10 hover:bg-white/5 text-white/60"
          onClick={() => setShowSelector(!showSelector)}
        >
          {showSelector ? "Done" : <><Plus className="h-3 w-3" /> Link</>}
        </Button>
      </div>

      {showSelector && (
        <div className="rounded-xl border border-white/10 bg-black/40 p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-white/20" />
            <input
              type="text"
              placeholder="Search tasks..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-white/5 py-2.5 pl-9 pr-4 text-[11px] text-white placeholder:text-white/20 focus:border-white/20 focus:outline-none transition-colors"
            />
          </div>
          <div className="omnix-scrollbar max-h-56 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <div className="py-6 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-white/20" /></div>
            ) : filteredTasks.length === 0 ? (
              <p className="py-6 text-center text-[10px] text-white/30 italic">No tasks found.</p>
            ) : (
              filteredTasks.map((task) => {
                const isLinked = linkedIds.has(task.id);
                return (
                  <button
                    key={task.id}
                    onClick={() => toggleLink(task.id, isLinked)}
                    disabled={linking === task.id}
                    className={cn(
                      "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left transition",
                      isLinked ? "bg-cyan-400/10 text-cyan-400" : "hover:bg-white/5 text-white/60"
                    )}
                  >
                    <span className="truncate text-[11px]">{task.title}</span>
                    {linking === task.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isLinked ? (
                      <Unlink2 className="h-3.5 w-3.5 opacity-50" />
                    ) : (
                      <Link2 className="h-3.5 w-3.5 opacity-30" />
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      <div className="space-y-2.5">
        {decision.linked_tasks.length === 0 && !showSelector ? (
          <div className="rounded-xl border border-dashed border-white/5 bg-white/[0.01] py-4 px-4 text-center">
            <p className="text-[10px] font-medium italic text-white/20">No tasks linked.</p>
          </div>
        ) : (
          decision.linked_tasks.map((task) => (
            <div key={task.id} className="group flex items-center justify-between rounded-xl border border-white/5 bg-black/20 px-4 py-3.5 transition-all hover:bg-black/40 hover:border-white/10">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-white/90 group-hover:text-white transition-colors">{task.title}</p>
                <div className="mt-2 flex items-center gap-2.5">
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest",
                    task.status === "complete" ? "bg-emerald-400/10 text-emerald-400" : "bg-cyan-400/10 text-cyan-400 border border-cyan-400/10"
                  )}>
                    {task.status}
                  </span>
                  {task.owner_user_id && (
                    <span className="text-[9px] text-white/20 truncate font-mono">
                      OWNER_ID: {task.owner_user_id.slice(0, 8)}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 rounded-lg p-0 text-white/10 hover:bg-rose-500/10 hover:text-rose-400 transition-all opacity-0 group-hover:opacity-100"
                onClick={() => toggleLink(task.id, true)}
                disabled={linking === task.id}
              >
                {linking === task.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink2 className="h-4 w-4" />}
              </Button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

