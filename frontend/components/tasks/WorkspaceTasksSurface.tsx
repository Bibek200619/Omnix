"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CircleDot,
  ClipboardCheck,
  Link2,
  Loader2,
  Plus,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type {
  WorkspaceMember,
  WorkspaceTask,
  WorkspaceTaskAssistance,
  WorkspaceTaskAssistanceMode,
  WorkspaceTaskMomentum,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";

const flow: Array<{ value: WorkspaceTaskStatus; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "complete", label: "Complete" },
];

const assistLabels: Record<WorkspaceTaskAssistanceMode, string> = {
  blockers: "Surface blockers",
  stalled: "Due attention",
  next_actions: "Next actions",
  workload: "Ownership view",
};

function dueLabel(value?: string | null) {
  if (!value) return "No due date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function mergeTask(current: WorkspaceTask[], incoming: WorkspaceTask) {
  return [incoming, ...current.filter((task) => task.id !== incoming.id && !(incoming.client_nonce && task.client_nonce === incoming.client_nonce))];
}

export function WorkspaceTasksSurface() {
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [momentum, setMomentum] = useState<WorkspaceTaskMomentum | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<WorkspaceTaskStatus | "open">("open");
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<WorkspaceTaskStatus>("idea");
  const [ownerId, setOwnerId] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [initialBlocker, setInitialBlocker] = useState("");
  const [creating, setCreating] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [blockerDrafts, setBlockerDrafts] = useState<Record<string, string>>({});
  const [assistance, setAssistance] = useState<WorkspaceTaskAssistance | null>(null);
  const [assisting, setAssisting] = useState<WorkspaceTaskAssistanceMode | null>(null);
  const workspaceRef = useRef(activeWorkspaceId);
  const requestRef = useRef(0);

  workspaceRef.current = activeWorkspaceId;

  const loadExecution = useCallback(async (withMembers = false) => {
    if (!activeWorkspaceId) {
      setTasks([]);
      setMomentum(null);
      setMembers([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const requests: [
        Promise<WorkspaceTask[]>,
        Promise<WorkspaceTaskMomentum>,
        Promise<WorkspaceMember[]> | null,
      ] = [
        apiClient.get<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`),
        apiClient.get<WorkspaceTaskMomentum>(`/workspaces/${activeWorkspaceId}/tasks/momentum`),
        withMembers ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : null,
      ];
      const [incomingTasks, incomingMomentum, incomingMembers] = await Promise.all([
        requests[0],
        requests[1],
        requests[2] ?? Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      setTasks(incomingTasks);
      setMomentum(incomingMomentum);
      if (incomingMembers) setMembers(incomingMembers);
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load workspace tasks.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    setTasks([]);
    setMomentum(null);
    setAssistance(null);
    setFilter("open");
    void loadExecution(true);
  }, [activeWorkspaceId, loadExecution]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      { type: "tasks", workspaceId: activeWorkspaceId },
      (channel) =>
        channel.on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "workspace_tasks",
            filter: `workspace_id=eq.${activeWorkspaceId}`,
          },
          () => void loadExecution(),
        ),
    );
    return () => realtimeRegistry.unsubscribe({ type: "tasks", workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, loadExecution, session?.user.id]);

  const displayedTasks = useMemo(
    () => tasks.filter((task) => (filter === "open" ? task.status !== "complete" : task.status === filter)),
    [filter, tasks],
  );

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !title.trim() || creating) return;
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const optimistic: WorkspaceTask = {
      id: `pending-${nonce}`,
      workspace_id: activeWorkspaceId,
      title: title.trim(),
      description: description.trim() || null,
      status,
      owner_user_id: ownerId || null,
      created_by: session?.user.id || "",
      due_date: dueDate || null,
      blockers: initialBlocker.trim() ? [initialBlocker.trim()] : [],
      linked_context: [],
      activity_metadata: { origin: "manual" },
      momentum_metadata: {},
      client_nonce: nonce,
      owner_name: members.find((member) => member.user_id === ownerId)?.full_name ?? null,
    };
    setTasks((current) => mergeTask(current, optimistic));
    try {
      setCreating(true);
      const created = await apiClient.post<WorkspaceTask>(`/workspaces/${activeWorkspaceId}/tasks`, {
        title: optimistic.title,
        description: optimistic.description,
        status: optimistic.status,
        owner_user_id: optimistic.owner_user_id,
        due_date: optimistic.due_date,
        blockers: optimistic.blockers,
        linked_context: [],
        client_nonce: nonce,
      });
      setTasks((current) => mergeTask(current, created));
      setTitle("");
      setDescription("");
      setStatus("idea");
      setOwnerId("");
      setDueDate("");
      setInitialBlocker("");
      setCreateOpen(false);
      void loadExecution();
    } catch (err) {
      setTasks((current) => current.filter((task) => task.client_nonce !== nonce));
      setError(err instanceof Error ? err.message : "Unable to open task.");
    } finally {
      setCreating(false);
    }
  }

  async function patchTask(task: WorkspaceTask, payload: Partial<WorkspaceTask>) {
    if (!activeWorkspaceId || task.id.startsWith("pending-")) return;
    const before = task;
    setUpdatingId(task.id);
    setTasks((current) => current.map((item) => (item.id === task.id ? { ...item, ...payload } : item)));
    try {
      const updated = await apiClient.patch<WorkspaceTask>(`/workspaces/${activeWorkspaceId}/tasks/${task.id}`, payload);
      setTasks((current) => current.map((item) => (item.id === task.id ? updated : item)));
      void loadExecution();
    } catch (err) {
      setTasks((current) => current.map((item) => (item.id === task.id ? before : item)));
      setError(err instanceof Error ? err.message : "Unable to update task.");
    } finally {
      setUpdatingId(null);
    }
  }

  function addBlocker(task: WorkspaceTask) {
    const blocker = blockerDrafts[task.id]?.trim();
    if (!blocker || task.blockers.includes(blocker)) return;
    setBlockerDrafts((current) => ({ ...current, [task.id]: "" }));
    void patchTask(task, { blockers: [...task.blockers, blocker] });
  }

  async function requestAssistance(mode: WorkspaceTaskAssistanceMode) {
    if (!activeWorkspaceId) return;
    try {
      setAssisting(mode);
      setAssistance(await apiClient.post<WorkspaceTaskAssistance>(`/workspaces/${activeWorkspaceId}/tasks/assist`, { mode }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Execution assistance is unavailable.");
    } finally {
      setAssisting(null);
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to orient operational execution.</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-4 sm:px-5">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <ClipboardCheck className="h-3.5 w-3.5" /> Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Workspace Tasks</h1>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">
            {activeWorkspace?.name} next steps, ownership, and recorded blockers.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active
          <span className="text-[var(--omnix-text-3)]">/</span>
          {realtimeStatus === "connected" ? "synced" : "recovering"}
        </div>
      </header>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

      <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {flow.map((phase) => (
          <button
            key={phase.value}
            type="button"
            onClick={() => setFilter(phase.value)}
            className={cn(
              "rounded-xl border px-3 py-3 text-left transition",
              filter === phase.value ? "border-cyan-300/30 bg-cyan-300/[0.08]" : "border-[var(--omnix-border)] bg-black/10 hover:bg-white/[0.025]",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">{phase.label}</p>
            <p className="mt-1 text-lg font-medium text-white">{momentum?.flow_counts[phase.value] ?? 0}</p>
          </button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="omnix-panel flex min-h-[28rem] min-w-0 flex-col rounded-xl p-3 sm:p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFilter("open")} className={cn("rounded-full border px-3 py-1.5 text-xs transition", filter === "open" ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-[var(--omnix-border)] text-[var(--omnix-text-2)]")}>Open flow</button>
              <p className="text-xs text-[var(--omnix-text-3)]">{displayedTasks.length} shown</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Open task
            </Button>
          </div>
          {createOpen ? (
            <form onSubmit={createTask} className="mb-4 grid gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3 sm:grid-cols-2">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Operational next step" className="h-10 text-sm sm:col-span-2" autoFocus />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Context, expected outcome, or handoff" className="omnix-input min-h-[68px] w-full resize-none rounded-lg p-2.5 text-sm sm:col-span-2" />
              <select value={status} onChange={(event) => setStatus(event.target.value as WorkspaceTaskStatus)} className="omnix-input h-10 rounded-lg px-2 text-sm">
                {flow.map((phase) => <option key={phase.value} value={phase.value}>{phase.label}</option>)}
              </select>
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="omnix-input h-10 rounded-lg px-2 text-sm">
                <option value="">Unassigned</option>
                {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || member.handle || member.user_id}</option>)}
              </select>
              <input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} className="omnix-input h-10 rounded-lg px-2 text-sm" />
              <Input value={initialBlocker} onChange={(event) => setInitialBlocker(event.target.value)} placeholder="Recorded blocker, optional" className="h-10 text-sm" />
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim()}>Create record</Button>
              </div>
            </form>
          ) : null}
          <div className="omnix-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto">
            {loading ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && displayedTasks.length === 0 ? (
              <div className="mx-auto mt-14 max-w-sm text-center">
                <ClipboardCheck className="mx-auto h-7 w-7 text-cyan-100/35" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No tasks recorded in this view.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Capture only the next steps that require shared visibility.</p>
              </div>
            ) : null}
            {displayedTasks.map((task) => (
              <article key={task.id} className="rounded-xl border border-[var(--omnix-border)] bg-black/[0.12] p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white">{task.title}</p>
                    {task.description ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">{task.description}</p> : null}
                  </div>
                  <select
                    value={task.status}
                    disabled={updatingId === task.id}
                    onChange={(event) => void patchTask(task, { status: event.target.value as WorkspaceTaskStatus })}
                    className="omnix-input h-8 rounded-lg px-2 text-xs"
                    aria-label={`Status for ${task.title}`}
                  >
                    {flow.map((phase) => <option key={phase.value} value={phase.value}>{phase.label}</option>)}
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--omnix-border)] px-2 py-1 text-[11px] text-[var(--omnix-text-2)]">
                    <UserRound className="h-3.5 w-3.5" />
                    <select
                      value={task.owner_user_id || ""}
                      disabled={updatingId === task.id}
                      onChange={(event) => void patchTask(task, { owner_user_id: event.target.value || null })}
                      className="bg-transparent text-[11px] outline-none"
                      aria-label={`Owner for ${task.title}`}
                    >
                      <option value="">Unassigned</option>
                      {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || member.handle || member.user_id}</option>)}
                    </select>
                  </label>
                  <label className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--omnix-border)] px-2 py-1 text-[11px] text-[var(--omnix-text-2)]">
                    <CalendarDays className="h-3.5 w-3.5" />
                    <input
                      type="date"
                      value={task.due_date || ""}
                      disabled={updatingId === task.id}
                      onChange={(event) => void patchTask(task, { due_date: event.target.value || null })}
                      className="bg-transparent outline-none"
                      aria-label={`Due date for ${task.title}`}
                    />
                    {!task.due_date ? <span>{dueLabel(null)}</span> : null}
                  </label>
                  {task.linked_context.map((link) => (
                    <span key={`${link.context_type}-${link.context_id}`} className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.045] px-2 py-1 text-[11px] text-cyan-100/80">
                      <Link2 className="h-3 w-3" /> {link.label || link.context_type}
                    </span>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {task.blockers.map((blocker) => (
                    <button
                      type="button"
                      key={blocker}
                      onClick={() => void patchTask(task, { blockers: task.blockers.filter((entry) => entry !== blocker) })}
                      className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 bg-amber-300/[0.06] px-2 py-1 text-[11px] text-amber-100"
                      title="Remove recorded blocker"
                    >
                      <AlertTriangle className="h-3 w-3" /> {blocker} <X className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                  <input
                    value={blockerDrafts[task.id] || ""}
                    onChange={(event) => setBlockerDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addBlocker(task);
                      }
                    }}
                    placeholder={task.blockers.length ? "Add blocker" : "Record blocker"}
                    className="h-7 min-w-[9rem] rounded-md border border-dashed border-[var(--omnix-border)] bg-transparent px-2 text-[11px] text-[var(--omnix-text-2)] outline-none focus:border-cyan-300/30"
                  />
                </div>
              </article>
            ))}
          </div>
        </main>

        <aside className="space-y-3">
          <section className="omnix-panel rounded-xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Momentum</p>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text)]">{momentum?.summary || "Reading recorded execution state."}</p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-center">
              {[
                ["Open", momentum?.open_count ?? 0],
                ["Blocked", momentum?.blocked_count ?? 0],
                ["Due soon", momentum?.due_soon_count ?? 0],
                ["Unassigned", momentum?.unassigned_count ?? 0],
              ].map(([label, count]) => (
                <div key={String(label)} className="rounded-lg border border-[var(--omnix-border)] bg-black/10 px-2 py-2">
                  <p className="text-lg text-white">{count}</p>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--omnix-text-3)]">{label}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[10px] leading-5 text-[var(--omnix-text-3)]">Calculated only from recorded status, assignment, blocker, and due-date fields.</p>
          </section>
          <section className="omnix-panel rounded-xl p-4">
            <p className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-100/70">
              <Sparkles className="h-3.5 w-3.5" /> Ambient execution assist
            </p>
            <div className="grid gap-1.5">
              {Object.entries(assistLabels).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  disabled={!tasks.length || Boolean(assisting)}
                  onClick={() => void requestAssistance(mode as WorkspaceTaskAssistanceMode)}
                  className="flex items-center justify-between rounded-lg border border-purple-300/12 bg-purple-300/[0.03] px-3 py-2 text-left text-xs text-purple-100/85 transition hover:bg-purple-300/[0.08] disabled:opacity-40"
                >
                  {label}
                  {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                </button>
              ))}
            </div>
            {assistance ? (
              <div className="mt-3 rounded-lg border border-purple-300/15 bg-purple-300/[0.045] p-3">
                <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--omnix-text)]">{assistance.content}</p>
                <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">Advisory only. Read from {assistance.source_task_count} task records; no state changed.</p>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}
