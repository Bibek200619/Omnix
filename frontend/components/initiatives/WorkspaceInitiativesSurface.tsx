"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CircleDot,
  Compass,
  Link2,
  Loader2,
  MessagesSquare,
  Plus,
  Sparkles,
  Target,
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
  WorkspaceChannel,
  WorkspaceInitiative,
  WorkspaceInitiativeAssistance,
  WorkspaceInitiativeAssistanceMode,
  WorkspaceInitiativeMomentumHealth,
  WorkspaceInitiativeResource,
  WorkspaceInitiativeStatus,
  WorkspaceMember,
  WorkspaceTask,
} from "@/lib/workspace-types";

const statuses: Array<{ value: WorkspaceInitiativeStatus; label: string }> = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "focused", label: "Focused" },
  { value: "at_risk", label: "At Risk" },
  { value: "complete", label: "Complete" },
];

const momentumLabels: Record<WorkspaceInitiativeMomentumHealth, string> = {
  quiet: "Awaiting linkage",
  active_movement: "Active movement",
  blocked_execution: "Blocked execution",
  dormant: "Dormant state",
  completion_flow: "Completion flow",
};

const assistanceLabels: Record<WorkspaceInitiativeAssistanceMode, string> = {
  state: "State brief",
  blockers: "Blockers",
  momentum: "Movement",
  decisions: "Decisions",
};

function mergeInitiative(current: WorkspaceInitiative[], incoming: WorkspaceInitiative) {
  return [
    incoming,
    ...current.filter(
      (item) =>
        item.id !== incoming.id &&
        !(incoming.client_nonce && item.client_nonce === incoming.client_nonce),
    ),
  ];
}

function displayDate(value?: string | null) {
  if (!value) return "No target date";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function quietMomentum() {
  return {
    health: "quiet" as const,
    summary: "No execution records are linked to this initiative yet.",
    task_count: 0,
    open_task_count: 0,
    complete_task_count: 0,
    blocked_task_count: 0,
    due_soon_count: 0,
    overdue_count: 0,
    channel_count: 0,
    discussion_message_count: 0,
    last_movement_at: null,
  };
}

export function WorkspaceInitiativesSurface() {
  const { session } = useAuth();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [context, setContext] = useState("");
  const [creating, setCreating] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [taskToAttach, setTaskToAttach] = useState("");
  const [channelToAttach, setChannelToAttach] = useState("");
  const [resourceType, setResourceType] = useState<WorkspaceInitiativeResource["resource_type"]>("decision");
  const [resourceLabel, setResourceLabel] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [assistance, setAssistance] = useState<WorkspaceInitiativeAssistance | null>(null);
  const [assisting, setAssisting] = useState<WorkspaceInitiativeAssistanceMode | null>(null);
  const workspaceRef = useRef(activeWorkspaceId);
  const requestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  workspaceRef.current = activeWorkspaceId;
  const selected = initiatives.find((initiative) => initiative.id === selectedId) ?? initiatives[0] ?? null;

  const loadInitiatives = useCallback(async (includeOptions = false) => {
    if (!activeWorkspaceId) {
      setInitiatives([]);
      setTasks([]);
      setChannels([]);
      setMembers([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const [incoming, taskOptions, channelOptions, memberOptions] = await Promise.all([
        apiClient.get<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        includeOptions ? apiClient.get<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceChannel[]>(`/workspaces/${activeWorkspaceId}/channels`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      setInitiatives(incoming);
      setSelectedId((current) => (incoming.some((initiative) => initiative.id === current) ? current : incoming[0]?.id ?? null));
      if (taskOptions) setTasks(taskOptions);
      if (channelOptions) setChannels(channelOptions);
      if (memberOptions) setMembers(memberOptions);
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        setError(err instanceof Error ? err.message : "Unable to load initiatives.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      void loadInitiatives(true);
    }, 120);
  }, [loadInitiatives]);

  useEffect(() => {
    setInitiatives([]);
    setSelectedId(null);
    setAssistance(null);
    setCreateOpen(false);
    void loadInitiatives(true);
  }, [activeWorkspaceId, loadInitiatives]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      { type: "initiatives", workspaceId: activeWorkspaceId },
      (channel) =>
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_initiatives", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_initiative_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_tasks", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh),
    );
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      realtimeRegistry.unsubscribe({ type: "initiatives", workspaceId: activeWorkspaceId });
    };
  }, [activeWorkspaceId, scheduleRefresh, session?.user.id]);

  const availableTasks = useMemo(
    () => tasks.filter((task) => task.initiative_id !== selected?.id),
    [selected?.id, tasks],
  );
  const availableChannels = useMemo(
    () => channels.filter((channel) => !selected?.linked_channels.some((linked) => linked.id === channel.id)),
    [channels, selected?.linked_channels],
  );

  async function createInitiative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !title.trim() || creating) return;
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const optimistic: WorkspaceInitiative = {
      id: `pending-${nonce}`,
      workspace_id: activeWorkspaceId,
      title: title.trim(),
      description: description.trim() || null,
      status: "draft",
      owner_user_id: ownerId || null,
      created_by: session?.user.id || null,
      target_date: targetDate || null,
      initiative_context: context.trim() || null,
      linked_resources: [],
      activity_metadata: { origin: "manual" },
      client_nonce: nonce,
      linked_tasks: [],
      linked_channels: [],
      owner_name: members.find((member) => member.user_id === ownerId)?.full_name ?? null,
      momentum: quietMomentum(),
    };
    setInitiatives((current) => mergeInitiative(current, optimistic));
    setSelectedId(optimistic.id);
    setCreating(true);
    try {
      const created = await apiClient.post<WorkspaceInitiative>(`/workspaces/${activeWorkspaceId}/initiatives`, {
        title: optimistic.title,
        description: optimistic.description,
        owner_user_id: optimistic.owner_user_id,
        target_date: optimistic.target_date,
        initiative_context: optimistic.initiative_context,
        client_nonce: nonce,
      });
      setInitiatives((current) => mergeInitiative(current, created));
      setSelectedId(created.id);
      setTitle("");
      setDescription("");
      setOwnerId("");
      setTargetDate("");
      setContext("");
      setCreateOpen(false);
      void loadInitiatives(true);
    } catch (err) {
      setInitiatives((current) => current.filter((initiative) => initiative.client_nonce !== nonce));
      setError(err instanceof Error ? err.message : "Unable to open initiative.");
    } finally {
      setCreating(false);
    }
  }

  async function patchInitiative(payload: Partial<WorkspaceInitiative>) {
    if (!activeWorkspaceId || !selected || selected.id.startsWith("pending-") || updating) return;
    const before = selected;
    setUpdating(true);
    setInitiatives((current) => current.map((item) => (item.id === selected.id ? { ...item, ...payload } : item)));
    try {
      const changed = await apiClient.patch<WorkspaceInitiative>(
        `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}`,
        payload,
      );
      setInitiatives((current) => current.map((item) => (item.id === changed.id ? changed : item)));
    } catch (err) {
      setInitiatives((current) => current.map((item) => (item.id === before.id ? before : item)));
      setError(err instanceof Error ? err.message : "Unable to update initiative.");
    } finally {
      setUpdating(false);
    }
  }

  async function attachTask() {
    if (!activeWorkspaceId || !selected || !taskToAttach) return;
    setUpdating(true);
    try {
      const changed = await apiClient.post<WorkspaceInitiative>(
        `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/tasks/${taskToAttach}`,
      );
      setInitiatives((current) => current.map((item) => (item.id === changed.id ? changed : item)));
      setTaskToAttach("");
      void loadInitiatives(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to attach task.");
    } finally {
      setUpdating(false);
    }
  }

  async function detachTask(task: WorkspaceTask) {
    if (!activeWorkspaceId) return;
    setUpdating(true);
    try {
      await apiClient.patch<WorkspaceTask>(`/workspaces/${activeWorkspaceId}/tasks/${task.id}`, { initiative_id: null });
      void loadInitiatives(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to detach task.");
    } finally {
      setUpdating(false);
    }
  }

  async function attachChannel() {
    if (!activeWorkspaceId || !selected || !channelToAttach) return;
    setUpdating(true);
    try {
      const changed = await apiClient.post<WorkspaceInitiative>(
        `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels`,
        { channel_id: channelToAttach },
      );
      setInitiatives((current) => current.map((item) => (item.id === changed.id ? changed : item)));
      setChannelToAttach("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to attach conversation.");
    } finally {
      setUpdating(false);
    }
  }

  async function detachChannel(channelId: string) {
    if (!activeWorkspaceId || !selected) return;
    setUpdating(true);
    try {
      await apiClient.delete(`/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels/${channelId}`);
      void loadInitiatives(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to detach conversation.");
    } finally {
      setUpdating(false);
    }
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !resourceId.trim()) return;
    const resource: WorkspaceInitiativeResource = {
      resource_type: resourceType,
      resource_id: resourceId.trim(),
      label: resourceLabel.trim() || null,
      metadata: {},
    };
    await patchInitiative({ linked_resources: [...selected.linked_resources, resource] });
    setResourceId("");
    setResourceLabel("");
  }

  async function requestAssistance(mode: WorkspaceInitiativeAssistanceMode) {
    if (!activeWorkspaceId || !selected) return;
    try {
      setAssisting(mode);
      setAssistance(
        await apiClient.post<WorkspaceInitiativeAssistance>(
          `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/assist`,
          { mode },
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Initiative assistance is unavailable.");
    } finally {
      setAssisting(null);
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to orient shared initiatives.</p>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-4 sm:px-5">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <Compass className="h-3.5 w-3.5" /> Execution layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Initiatives</h1>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">{activeWorkspace?.name} shared operational direction and movement.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active <span className="text-[var(--omnix-text-3)]">/</span> {realtimeStatus === "connected" ? "synced" : "recovering"}
        </div>
      </header>

      {error ? (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/8 px-3 py-2 text-xs text-rose-100">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><X className="h-3.5 w-3.5" /></button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_19rem]">
        <aside className="omnix-panel flex min-h-[16rem] flex-col rounded-xl p-3">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Direction</p>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Open</Button>
          </div>
          {createOpen ? (
            <form onSubmit={createInitiative} className="mb-3 space-y-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3">
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Investor demo" className="h-9 text-sm" autoFocus />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Shared outcome" className="omnix-input h-16 w-full resize-none rounded-lg p-2 text-xs" />
              <select value={ownerId} onChange={(event) => setOwnerId(event.target.value)} className="omnix-input h-9 w-full rounded-lg px-2 text-xs">
                <option value="">No owner recorded</option>
                {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || member.user_id}</option>)}
              </select>
              <input type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value)} className="omnix-input h-9 w-full rounded-lg px-2 text-xs" />
              <textarea value={context} onChange={(event) => setContext(event.target.value)} placeholder="Planning context, optional" className="omnix-input h-16 w-full resize-none rounded-lg p-2 text-xs" />
              <Button type="submit" size="sm" className="w-full" isLoading={creating} disabled={!title.trim()}>Create initiative</Button>
            </form>
          ) : null}
          <div className="omnix-scrollbar min-h-0 flex-1 space-y-2 overflow-y-auto">
            {loading ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && initiatives.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <Compass className="mx-auto h-7 w-7 text-cyan-100/30" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No initiatives open.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Name the shared outcome that current execution serves.</p>
              </div>
            ) : null}
            {initiatives.map((initiative) => (
              <button key={initiative.id} type="button" onClick={() => { setSelectedId(initiative.id); setAssistance(null); }} className={cn("w-full rounded-xl border p-3 text-left transition", selected?.id === initiative.id ? "border-cyan-300/25 bg-cyan-300/[0.07]" : "border-[var(--omnix-border)] bg-black/10 hover:bg-white/[0.025]")}>
                <p className="truncate text-sm font-medium text-white">{initiative.title}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px]">
                  <span className="rounded-full border border-[var(--omnix-border)] px-2 py-0.5 uppercase tracking-[0.1em] text-cyan-100/75">{initiative.status.replace("_", " ")}</span>
                  <span className={initiative.momentum.health === "blocked_execution" ? "text-amber-100" : "text-[var(--omnix-text-3)]"}>{momentumLabels[initiative.momentum.health]}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="omnix-panel min-h-[30rem] min-w-0 overflow-y-auto rounded-xl p-4 sm:p-5">
          {!selected ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-[var(--omnix-text-2)]">Select or open an initiative.</div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/60">Operational initiative</p>
                  <h2 className="omnix-display mt-1 text-xl font-semibold text-white">{selected.title}</h2>
                  {selected.description ? <p className="mt-2 max-w-xl text-sm leading-6 text-[var(--omnix-text-2)]">{selected.description}</p> : null}
                </div>
                <select value={selected.status} disabled={updating} onChange={(event) => void patchInitiative({ status: event.target.value as WorkspaceInitiativeStatus })} className="omnix-input h-10 rounded-lg px-3 text-sm">
                  {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                </select>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                <label className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3 text-xs text-[var(--omnix-text-2)]">
                  <span className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--omnix-text-3)]"><UserRound className="h-3 w-3" /> Owner</span>
                  <select value={selected.owner_user_id || ""} disabled={updating} onChange={(event) => void patchInitiative({ owner_user_id: event.target.value || null })} className="w-full bg-transparent text-sm text-white outline-none">
                    <option value="">Unassigned</option>
                    {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || member.user_id}</option>)}
                  </select>
                </label>
                <label className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3 text-xs text-[var(--omnix-text-2)]">
                  <span className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--omnix-text-3)]"><CalendarDays className="h-3 w-3" /> Target</span>
                  <input type="date" value={selected.target_date || ""} disabled={updating} onChange={(event) => void patchInitiative({ target_date: event.target.value || null })} className="w-full bg-transparent text-sm text-white outline-none" />
                  {!selected.target_date ? <span className="text-sm">{displayDate(null)}</span> : null}
                </label>
                <div className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-[var(--omnix-text-3)]"><Target className="h-3 w-3" /> Momentum</p>
                  <p className={cn("text-sm", selected.momentum.health === "blocked_execution" ? "text-amber-100" : "text-white")}>{momentumLabels[selected.momentum.health]}</p>
                </div>
              </div>
              {selected.initiative_context ? (
                <div className="mt-4 rounded-xl border border-cyan-300/12 bg-cyan-300/[0.025] p-3">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/55">Planning context</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--omnix-text)]">{selected.initiative_context}</p>
                </div>
              ) : null}
              <div className="mt-5 grid gap-3 2xl:grid-cols-2">
                <section className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-medium text-white">Linked tasks</h3>
                    <span className="text-[11px] text-[var(--omnix-text-3)]">{selected.momentum.open_task_count} open</span>
                  </div>
                  <div className="mb-3 flex gap-2">
                    <select value={taskToAttach} onChange={(event) => setTaskToAttach(event.target.value)} className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs">
                      <option value="">Attach existing task</option>
                      {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={!taskToAttach || updating} onClick={() => void attachTask()}>Attach</Button>
                  </div>
                  <div className="space-y-2">
                    {selected.linked_tasks.map((task) => (
                      <div key={task.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--omnix-border)] px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs text-white">{task.title}</p>
                          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">{task.status}</p>
                        </div>
                        <button type="button" onClick={() => void detachTask(task)} className="text-white/35 hover:text-white" aria-label="Detach task"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {!selected.linked_tasks.length ? <p className="py-3 text-center text-xs text-[var(--omnix-text-3)]">No task records attached.</p> : null}
                  </div>
                </section>
                <section className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="inline-flex items-center gap-1.5 text-sm font-medium text-white"><MessagesSquare className="h-3.5 w-3.5 text-cyan-100/70" /> Conversations</h3>
                    <span className="text-[11px] text-[var(--omnix-text-3)]">{selected.momentum.discussion_message_count} messages</span>
                  </div>
                  <div className="mb-3 flex gap-2">
                    <select value={channelToAttach} onChange={(event) => setChannelToAttach(event.target.value)} className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs">
                      <option value="">Attach operational channel</option>
                      {availableChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                    </select>
                    <Button size="sm" variant="secondary" disabled={!channelToAttach || updating} onClick={() => void attachChannel()}>Attach</Button>
                  </div>
                  <div className="space-y-2">
                    {selected.linked_channels.map((channel) => (
                      <div key={channel.id} className="flex items-start justify-between gap-2 rounded-lg border border-[var(--omnix-border)] px-3 py-2">
                        <div>
                          <p className="text-xs text-white">{channel.name}</p>
                          <p className="mt-1 text-[10px] text-[var(--omnix-text-3)]">{channel.message_count} recorded messages</p>
                        </div>
                        <button type="button" onClick={() => void detachChannel(channel.id)} className="text-white/35 hover:text-white" aria-label="Detach conversation"><X className="h-3.5 w-3.5" /></button>
                      </div>
                    ))}
                    {!selected.linked_channels.length ? <p className="py-3 text-center text-xs text-[var(--omnix-text-3)]">No operational channels attached.</p> : null}
                  </div>
                </section>
              </div>
              <section className="mt-3 rounded-xl border border-[var(--omnix-border)] bg-black/10 p-3">
                <h3 className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-white"><Link2 className="h-3.5 w-3.5 text-cyan-100/70" /> Decisions and resources</h3>
                <form onSubmit={addResource} className="mb-3 flex flex-wrap gap-2">
                  <select value={resourceType} onChange={(event) => setResourceType(event.target.value as WorkspaceInitiativeResource["resource_type"])} className="omnix-input h-9 rounded-lg px-2 text-xs">
                    <option value="decision">Decision</option><option value="file">File</option><option value="reference">Reference</option><option value="ai_session">AI context</option>
                  </select>
                  <Input value={resourceLabel} onChange={(event) => setResourceLabel(event.target.value)} placeholder="Label" className="h-9 min-w-[8rem] flex-1 text-xs" />
                  <Input value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="Record id or reference" className="h-9 min-w-[10rem] flex-1 text-xs" />
                  <Button type="submit" size="sm" variant="secondary" disabled={!resourceId.trim() || updating}>Link</Button>
                </form>
                <div className="flex flex-wrap gap-1.5">
                  {selected.linked_resources.map((resource) => (
                    <button key={`${resource.resource_type}-${resource.resource_id}`} type="button" onClick={() => void patchInitiative({ linked_resources: selected.linked_resources.filter((item) => item !== resource) })} className="inline-flex items-center gap-1 rounded-md border border-cyan-300/15 bg-cyan-300/[0.045] px-2 py-1 text-[11px] text-cyan-100/80" title="Remove link">
                      {resource.label || resource.resource_type} <X className="h-3 w-3 opacity-60" />
                    </button>
                  ))}
                  {!selected.linked_resources.length ? <p className="text-xs text-[var(--omnix-text-3)]">No files or explicit decisions linked.</p> : null}
                </div>
              </section>
            </>
          )}
        </main>

        <aside className="space-y-3 lg:col-span-2 xl:col-span-1">
          <section className="omnix-panel rounded-xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Momentum</p>
            <p className="mt-2 text-sm leading-6 text-[var(--omnix-text)]">{selected?.momentum.summary || "Select an initiative for recorded movement."}</p>
            {selected ? (
              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                {[
                  ["Open tasks", selected.momentum.open_task_count],
                  ["Blocked", selected.momentum.blocked_task_count],
                  ["Due soon", selected.momentum.due_soon_count],
                  ["Conversations", selected.momentum.channel_count],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded-lg border border-[var(--omnix-border)] bg-black/10 px-2 py-2">
                    <p className="text-lg text-white">{value}</p>
                    <p className="text-[10px] uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">{label}</p>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-3 text-[10px] leading-5 text-[var(--omnix-text-3)]">Based only on linked status, blockers, dates, and recorded channel activity.</p>
          </section>
          <section className="omnix-panel rounded-xl p-4">
            <p className="mb-3 inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-purple-100/70"><Sparkles className="h-3.5 w-3.5" /> Initiative assist</p>
            <div className="grid gap-1.5">
              {Object.entries(assistanceLabels).map(([mode, label]) => (
                <button key={mode} type="button" disabled={!selected || Boolean(assisting)} onClick={() => void requestAssistance(mode as WorkspaceInitiativeAssistanceMode)} className="flex items-center justify-between rounded-lg border border-purple-300/12 bg-purple-300/[0.03] px-3 py-2 text-left text-xs text-purple-100/85 transition hover:bg-purple-300/[0.08] disabled:opacity-40">
                  {label}
                  {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3 w-3 opacity-40" />}
                </button>
              ))}
            </div>
            {assistance ? (
              <div className="mt-3 rounded-lg border border-purple-300/15 bg-purple-300/[0.045] p-3">
                <p className="whitespace-pre-wrap text-xs leading-5 text-[var(--omnix-text)]">{assistance.content}</p>
                <p className="mt-2 text-[10px] leading-5 text-[var(--omnix-text-3)]">Advisory only. Read from {assistance.source_task_count} tasks, {assistance.source_channel_count} channels, and {assistance.source_message_count} messages.</p>
              </div>
            ) : null}
          </section>
          {selected?.momentum.blocked_task_count ? (
            <p className="inline-flex items-start gap-2 rounded-xl border border-amber-300/18 bg-amber-300/[0.05] p-3 text-xs leading-5 text-amber-100">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> Blocked state reflects explicit linked task blockers only.
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
