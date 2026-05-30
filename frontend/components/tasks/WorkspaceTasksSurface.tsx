"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CircleDot,
  ClipboardCheck,
  Compass,
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
  WorkspaceInitiative,
  WorkspaceTask,
  WorkspaceTaskAssistance,
  WorkspaceTaskAssistanceMode,
  WorkspaceTaskMomentum,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";
import { DecisionTraceabilityList } from "../decisions/DecisionTraceabilityList";

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

function mergeTask(current: WorkspaceTask[], incoming: WorkspaceTask) {
  return [incoming, ...current.filter((task) => task.id !== incoming.id && !(incoming.client_nonce && task.client_nonce === incoming.client_nonce))];
}

export function WorkspaceTasksSurface() {
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
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
  const [initiativeId, setInitiativeId] = useState("");
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
      setInitiatives([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const requests: [
        Promise<WorkspaceTask[]>,
        Promise<WorkspaceTaskMomentum>,
        Promise<WorkspaceInitiative[]>,
        Promise<WorkspaceMember[]> | null,
      ] = [
        apiClient.get<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`),
        apiClient.get<WorkspaceTaskMomentum>(`/workspaces/${activeWorkspaceId}/tasks/momentum`),
        apiClient.get<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        withMembers ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : null,
      ];
      const [incomingTasks, incomingMomentum, incomingInitiatives, incomingMembers] = await Promise.all([
        requests[0],
        requests[1],
        requests[2] ?? Promise.resolve(null),
        requests[3] ?? Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      setTasks(incomingTasks);
      setMomentum(incomingMomentum);
      setInitiatives(incomingInitiatives);
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
    setInitiatives([]);
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

  const displayedTasks = useMemo(() => {
    const filtered = tasks.filter((task) => (filter === "open" ? task.status !== "complete" : task.status === filter));
    
    // Prioritization Logic:
    // 1. Active status tasks
    // 2. Tasks with blockers
    // 3. Tasks due soon (within 3 days)
    // 4. Assigned to me
    // 5. Everything else (by created_at)
    
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);

    return [...filtered].sort((a, b) => {
      // 1. Active
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;

      // 2. Blocked
      const aBlocked = a.blockers.length > 0;
      const bBlocked = b.blockers.length > 0;
      if (aBlocked && !bBlocked) return -1;
      if (bBlocked && !aBlocked) return 1;

      // 3. Due Soon
      const aDue = a.due_date ? new Date(a.due_date) : null;
      const bDue = b.due_date ? new Date(b.due_date) : null;
      const aDueSoon = aDue && aDue <= threeDaysFromNow;
      const bDueSoon = bDue && bDue <= threeDaysFromNow;
      if (aDueSoon && !bDueSoon) return -1;
      if (bDueSoon && !aDueSoon) return 1;

      // 4. Assigned to me
      const aMine = a.owner_user_id === session?.user.id;
      const bMine = b.owner_user_id === session?.user.id;
      if (aMine && !bMine) return -1;
      if (bMine && !aMine) return 1;

      return 0;
    });
  }, [filter, tasks, session?.user.id]);

  const executionOverview = useMemo(() => {
    if (!tasks.length) return null;
    
    const active = tasks.filter(t => t.status === "active").length;
    const blocked = tasks.filter(t => t.blockers.length > 0 && t.status !== "complete").length;
    
    const now = new Date();
    const threeDaysFromNow = new Date();
    threeDaysFromNow.setDate(now.getDate() + 3);
    const dueSoon = tasks.filter(t => {
      if (!t.due_date || t.status === "complete") return false;
      return new Date(t.due_date) <= threeDaysFromNow;
    }).length;
    
    const myTasks = tasks.filter(t => t.owner_user_id === session?.user.id && t.status !== "complete").length;
    
    return [
      { label: "Active Tasks", count: active, color: "text-cyan-300" },
      { label: "Blocked Tasks", count: blocked, color: "text-amber-300" },
      { label: "Due Soon", count: dueSoon, color: "text-rose-300" },
      { label: "My Tasks", count: myTasks, color: "text-emerald-300" },
    ];
  }, [tasks, session?.user.id]);

  const simplifiedMomentum = useMemo(() => {
    if (!momentum) return null;
    const blocked = momentum.blocked_count > 0;
    const moving = momentum.flow_counts.active > 0 || momentum.flow_counts.review > 0;
    const complete = momentum.flow_counts.complete > 0 && momentum.open_count === 0;

    if (blocked) return { label: "Blocked", color: "text-amber-300", description: "Progress is currently impeded by identified blockers." };
    if (moving) return { label: "Moving", color: "text-cyan-300", description: "Operational tasks are advancing through the flow." };
    if (complete) return { label: "Complete", color: "text-emerald-300", description: "All recorded tasks in this view have reached completion." };
    return { label: "Quiet", color: "text-[var(--omnix-text-3)]", description: "No active operational momentum detected in recorded tasks." };
  }, [momentum]);

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
      initiative_id: initiativeId || null,
      client_nonce: nonce,
      linked_decisions: [],
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
        initiative_id: optimistic.initiative_id,
        client_nonce: nonce,
      });
      setTasks((current) => mergeTask(current, created));
      setTitle("");
      setDescription("");
      setStatus("idea");
      setOwnerId("");
      setDueDate("");
      setInitialBlocker("");
      setInitiativeId("");
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
    <section className="omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5 xl:overflow-hidden">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <ClipboardCheck className="h-3.5 w-3.5" /> Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Execution</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">
            {activeWorkspace?.name} operational focus.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active
          <span className="text-[var(--omnix-text-3)]">/</span>
          {realtimeStatus === "connected" ? "synced" : "recovering"}
        </div>
      </header>

      {/* Phase 2: Execution Overview */}
      {executionOverview && (
        <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {executionOverview.map((item) => (
            <div key={item.label} className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3 shadow-[var(--omnix-glow-xs)] transition hover:bg-white/[0.02]">
              <p className={cn("text-xl font-bold sm:text-2xl", item.color)}>{item.count}</p>
              <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

      <div className="omnix-scrollbar mb-4 flex shrink-0 gap-2 overflow-x-auto pb-1 xl:grid xl:grid-cols-5 xl:overflow-visible xl:pb-0">
        {flow.map((phase) => (
          <button
            key={phase.value}
            type="button"
            onClick={() => setFilter(phase.value)}
            className={cn(
              "min-w-[7.75rem] shrink-0 rounded-xl border px-3 py-3 text-left transition xl:min-w-0",
              filter === phase.value ? "border-cyan-300/30 bg-cyan-300/[0.08]" : "border-[var(--omnix-border)] bg-black/10 hover:bg-white/[0.025]",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">{phase.label}</p>
            <p className="mt-1 text-lg font-medium text-white">{momentum?.flow_counts[phase.value] ?? 0}</p>
          </button>
        ))}
      </div>

      <div className="grid shrink-0 gap-3 xl:min-h-0 xl:flex-1 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <main className="omnix-panel flex min-w-0 flex-col rounded-xl p-3 sm:p-4 xl:min-h-[28rem]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--omnix-border)] pb-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFilter("open")} className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", filter === "open" ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-[var(--omnix-border)] text-[var(--omnix-text-2)]")}>Current Flow</button>
              <p className="text-xs text-[var(--omnix-text-3)]">{displayedTasks.length} items</p>
            </div>
            <Button size="sm" onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
              Record Task
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
              <select value={initiativeId} onChange={(event) => setInitiativeId(event.target.value)} className="omnix-input h-10 rounded-lg px-2 text-sm sm:col-span-2">
                <option value="">No initiative link</option>
                {initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.title}</option>)}
              </select>
              <div className="flex justify-end gap-2 sm:col-span-2">
                <Button type="button" size="sm" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim()}>Create record</Button>
              </div>
            </form>
          ) : null}

          <div className="space-y-2 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
            {loading ? <Loader2 className="mx-auto mt-10 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && displayedTasks.length === 0 ? (
              <div className="mx-auto mt-14 max-w-sm text-center">
                <ClipboardCheck className="mx-auto h-7 w-7 text-cyan-100/35" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No tasks recorded in this view.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Capture only the next steps that require shared visibility.</p>
              </div>
            ) : null}
            {displayedTasks.map((task) => {
              const isMyTask = task.owner_user_id === session?.user.id;
              const isBlocked = task.blockers.length > 0;
              const isActive = task.status === "active";
              
              const now = new Date();
              const threeDaysFromNow = new Date();
              threeDaysFromNow.setDate(now.getDate() + 3);
              const isDueSoon = task.due_date && new Date(task.due_date) <= threeDaysFromNow;

              return (
                <article key={task.id} className={cn(
                  "group relative rounded-xl border p-3.5 transition",
                  isBlocked ? "border-amber-400/30 bg-amber-400/[0.03]" : "border-[var(--omnix-border)] bg-black/[0.12] hover:bg-white/[0.03]"
                )}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {isBlocked && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />}
                        {isActive && <div className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)]" />}
                        <p className="truncate text-sm font-medium text-white">{task.title}</p>
                      </div>
                      {task.description ? <p className="mt-1 line-clamp-1 text-xs text-[var(--omnix-text-2)] group-hover:line-clamp-none transition-all">{task.description}</p> : null}
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={task.status}
                        disabled={updatingId === task.id}
                        onChange={(event) => void patchTask(task, { status: event.target.value as WorkspaceTaskStatus })}
                        className={cn(
                          "omnix-input h-7 rounded-lg px-2 text-[11px] font-semibold transition",
                          task.status === "active" ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100" : "bg-black/20"
                        )}
                        aria-label={`Status for ${task.title}`}
                      >
                        {flow.map((phase) => <option key={phase.value} value={phase.value}>{phase.label}</option>)}
                      </select>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    {/* Simplified Metadata */}
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-2)]">
                        <UserRound className={cn("h-3 w-3", isMyTask ? "text-emerald-300" : "text-[var(--omnix-text-3)]")} />
                        <select
                          value={task.owner_user_id || ""}
                          disabled={updatingId === task.id}
                          onChange={(event) => void patchTask(task, { owner_user_id: event.target.value || null })}
                          className="bg-transparent outline-none"
                        >
                          <option value="">Unassigned</option>
                          {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || "Teammate"}</option>)}
                        </select>
                      </div>

                      <div className={cn("flex items-center gap-1.5 text-[11px]", isDueSoon ? "text-rose-300 font-medium" : "text-[var(--omnix-text-2)]")}>
                        <CalendarDays className="h-3 w-3" />
                        <input
                          type="date"
                          value={task.due_date || ""}
                          disabled={updatingId === task.id}
                          onChange={(event) => void patchTask(task, { due_date: event.target.value || null })}
                          className="bg-transparent outline-none"
                        />
                        {!task.due_date && <span className="text-[var(--omnix-text-3)]">No date</span>}
                      </div>
                    </div>

                    {/* Secondary metadata hidden until hover/focus */}
                    <div className="flex items-center gap-3 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                      <div className="flex items-center gap-1.5 text-[11px] text-[var(--omnix-text-3)]">
                        <Compass className="h-3 w-3" />
                        <select
                          value={task.initiative_id || ""}
                          disabled={updatingId === task.id}
                          onChange={(event) => void patchTask(task, { initiative_id: event.target.value || null })}
                          className="bg-transparent outline-none max-w-[120px] truncate"
                        >
                          <option value="">No initiative</option>
                          {initiatives.map((initiative) => <option key={initiative.id} value={initiative.id}>{initiative.title}</option>)}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Blockers Area */}
                  {task.blockers.length > 0 && (
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                      {task.blockers.map((blocker) => (
                        <button
                          type="button"
                          key={blocker}
                          onClick={() => void patchTask(task, { blockers: task.blockers.filter((entry) => entry !== blocker) })}
                          className="inline-flex items-center gap-1 rounded-md border border-amber-300/20 bg-amber-300/[0.08] px-2 py-1 text-[10px] font-medium text-amber-100"
                        >
                          {blocker} <X className="h-2.5 w-2.5 opacity-60" />
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Phase 3: Linked Decisions */}
                  <DecisionTraceabilityList decisions={task.linked_decisions} />
                  
                  {/* Inline Blocker Adder (Simplified) */}
                  <div className="mt-2.5 border-t border-white/[0.04] pt-2.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <input
                      value={blockerDrafts[task.id] || ""}
                      onChange={(event) => setBlockerDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addBlocker(task);
                        }
                      }}
                      placeholder="Add blocker..."
                      className="h-6 w-full bg-transparent px-1 text-[10px] text-[var(--omnix-text-3)] outline-none placeholder:text-white/10 focus:placeholder:text-white/20"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </main>

        <aside className="space-y-3">
          {/* Phase 6: Momentum Refinement */}
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
                ["My tasks", tasks.filter(t => t.owner_user_id === session?.user.id && t.status !== "complete").length],
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
                <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">Advisory only. Read from {assistance.source_task_count} task records.</p>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}
