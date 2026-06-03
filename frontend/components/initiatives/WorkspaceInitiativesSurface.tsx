"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CircleDot,
  ClipboardCheck,
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
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
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
import { DecisionTraceabilityList } from "../decisions/DecisionTraceabilityList";

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
  const [mobileTab, setMobileTab] = useState<"brief" | "plan" | "assist">("brief");
  const workspaceRef = useRef(activeWorkspaceId);
  const requestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);

  const sortedInitiatives = useMemo(() => {
    const statusOrder: Record<WorkspaceInitiativeStatus, number> = {
      focused: 0,
      active: 1,
      at_risk: 2,
      draft: 3,
      complete: 4,
    };

    return [...initiatives].sort((a, b) => {
      const orderA = statusOrder[a.status] ?? 99;
      const orderB = statusOrder[b.status] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      
      const timeA = new Date(a.updated_at || a.created_at || 0).getTime();
      const timeB = new Date(b.updated_at || b.created_at || 0).getTime();
      return timeB - timeA;
    });
  }, [initiatives]);

  const selected = sortedInitiatives.find((initiative) => initiative.id === selectedId) ?? sortedInitiatives[0] ?? null;

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
        logClientError("Failed to load initiatives", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives` });
        setError("Unable to load initiatives.");
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

  const simplifiedMomentum = useMemo(() => {
    if (!selected) return null;
    const { health, open_task_count, complete_task_count, blocked_task_count } = selected.momentum;
    
    if (health === "blocked_execution" || blocked_task_count > 0) {
      return { label: "Blocked", color: "text-amber-300", description: "Strategic progress is currently impeded by operational blockers." };
    }
    if (health === "active_movement" || open_task_count > 0) {
      return { label: "Moving", color: "text-cyan-300", description: "Operational execution is actively advancing the initiative mission." };
    }
    if (health === "completion_flow" || (complete_task_count > 0 && open_task_count === 0)) {
      return { label: "Complete", color: "text-emerald-300", description: "The defined mission has reached its completion state." };
    }
    return { label: "Quiet", color: "text-[var(--omnix-text-3)]", description: "No active operational movement detected for this mission." };
  }, [selected]);

  const progressPercentage = useMemo(() => {
    if (!selected) return 0;
    const total = selected.momentum.task_count;
    if (total === 0) return 0;
    return Math.round((selected.momentum.complete_task_count / total) * 100);
  }, [selected]);

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
      linked_decisions: [],
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
      logClientError("Failed to open initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives` });
      setError("Unable to open initiative.");
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
      logClientError("Failed to update initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}` });
      setError("Unable to update initiative.");
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
      logClientError("Failed to attach task to initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/tasks/${taskToAttach}` });
      setError("Unable to attach task.");
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
      logClientError("Failed to detach task from initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks/${task.id}` });
      setError("Unable to detach task.");
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
      logClientError("Failed to attach conversation to initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels` });
      setError("Unable to attach conversation.");
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
      logClientError("Failed to detach conversation from initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels/${channelId}` });
      setError("Unable to detach conversation.");
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
      logClientError("Failed to load initiative assistance", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/assist` });
      setError("Initiative assistance is unavailable.");
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
    <section className="omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5 xl:overflow-hidden">
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <Compass className="h-3.5 w-3.5" /> Strategy layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Initiatives</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">{activeWorkspace?.name} shared operational direction.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active <span className="text-[var(--omnix-text-3)]">/</span> {realtimeStatus === "connected" ? "synced" : "recovering"}
        </div>
      </header>

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title={error === "Unable to load initiatives." ? "Initiatives are unavailable" : "Initiative action needs attention"}
          message={error}
          onRetry={error === "Unable to load initiatives." ? () => void loadInitiatives(true) : undefined}
          isRetrying={loading}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <div className="grid shrink-0 gap-3 lg:grid-cols-[19rem_minmax(0,1fr)] xl:min-h-0 xl:flex-1 xl:grid-cols-[20rem_minmax(0,1fr)_19rem]">
        <aside className={cn(
          "omnix-panel order-1 flex shrink-0 flex-col rounded-xl p-3 lg:order-none lg:min-h-[16rem]",
          selectedId && "hidden lg:flex"
        )}>
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
          <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-2 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
            {loading ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && initiatives.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <Compass className="mx-auto h-7 w-7 text-cyan-100/30" />
                <p className="mt-3 text-sm text-[var(--omnix-text-2)]">No initiatives open.</p>
                <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-3)]">Name the shared outcome that current execution serves.</p>
              </div>
            ) : null}
            {sortedInitiatives.map((initiative) => (
              <button key={initiative.id} type="button" onClick={() => { setSelectedId(initiative.id); setAssistance(null); }} className={cn("group w-[min(15rem,78vw)] shrink-0 rounded-xl border p-3.5 text-left transition lg:w-full", selected?.id === initiative.id ? "border-cyan-300/35 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]" : "border-[var(--omnix-border)] bg-black/10 hover:bg-white/[0.025]")}>
                <p className={cn("truncate text-sm font-medium transition", selected?.id === initiative.id ? "text-white" : "text-[var(--omnix-text-2)] group-hover:text-white")}>{initiative.title}</p>
                <div className="mt-3 flex items-center justify-between gap-2 text-[10px]">
                  <span className={cn(
                    "rounded-full border px-2 py-0.5 uppercase tracking-wider font-semibold",
                    initiative.status === "at_risk" ? "border-rose-400/30 text-rose-300" : "border-[var(--omnix-border)] text-cyan-100/70"
                  )}>{initiative.status.replace("_", " ")}</span>
                  <div className="flex items-center gap-1.5">
                    <div className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      initiative.momentum.health === "blocked_execution" ? "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.5)]" : 
                      initiative.momentum.health === "active_movement" ? "bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.5)]" : "bg-[var(--omnix-text-3)]"
                    )} />
                    <span className="text-[var(--omnix-text-3)] font-medium">{momentumLabels[initiative.momentum.health]}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className={cn(
          "omnix-panel order-3 min-w-0 rounded-xl p-4 sm:p-6 lg:order-none xl:min-h-[30rem] xl:overflow-y-auto",
          !selectedId && "hidden lg:block"
        )}>
          {!selected ? (
            <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-[var(--omnix-text-2)]">Select or open an initiative.</div>
          ) : (
            <>
              {/* Mobile Header with Back and Tabs */}
              <div className="mb-6 flex flex-col gap-4 lg:hidden">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
                  >
                    ‹ Back
                  </button>
                  <h2 className="omnix-display truncate text-lg font-bold text-white">{selected.title}</h2>
                </div>
                <div className="flex gap-1 rounded-lg bg-black/20 p-1 border border-[var(--omnix-border)]">
                  {(["brief", "plan", "assist"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setMobileTab(t)}
                      className={cn(
                        "flex-1 rounded-md py-2 text-[10px] font-bold uppercase tracking-wider transition-all",
                        mobileTab === t 
                          ? "bg-cyan-400/10 text-cyan-400 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]" 
                          : "text-[var(--omnix-text-3)]"
                      )}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Phase 2: Mission-First Overview */}
              <div className={cn(
                "mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--omnix-border)] pb-6",
                mobileTab !== "brief" && "hidden lg:flex"
              )}>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/60">Mission</p>
                  <h2 className="omnix-display mt-2 text-2xl font-bold text-white">{selected.title}</h2>
                  {selected.description ? <p className="mt-3 max-w-2xl text-base leading-7 text-[var(--omnix-text-2)]">{selected.description}</p> : null}
                </div>
                <div className="flex flex-col items-end gap-3">
                  <select value={selected.status} disabled={updating} onChange={(event) => void patchInitiative({ status: event.target.value as WorkspaceInitiativeStatus })} className={cn(
                    "omnix-input h-9 rounded-lg px-3 text-xs font-bold transition",
                    selected.status === "focused" ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50" : "bg-black/20"
                  )}>
                    {statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                  <div className="text-right">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Completion</p>
                    <p className="text-xl font-bold text-white">{progressPercentage}%</p>
                  </div>
                </div>
              </div>

              {/* Phase 3 & 4: Momentum and Progress Clarity */}
              <div className={cn(
                "mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3",
                mobileTab !== "brief" && "hidden lg:grid"
              )}>
                <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                    <Target className="h-3.5 w-3.5" /> Momentum
                  </p>
                  {simplifiedMomentum && (
                    <div className="flex items-start gap-3">
                      <div className={cn("mt-1 h-2 w-2 shrink-0 rounded-full shadow-[0_0_10px_currentColor]", simplifiedMomentum.color)} />
                      <div>
                        <p className={cn("text-lg font-bold leading-none", simplifiedMomentum.color)}>{simplifiedMomentum.label}</p>
                        <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--omnix-text-2)]">{simplifiedMomentum.description}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                    <UserRound className="h-3.5 w-3.5" /> Mission Owner
                  </p>
                  <select value={selected.owner_user_id || ""} disabled={updating} onChange={(event) => void patchInitiative({ owner_user_id: event.target.value || null })} className="w-full bg-transparent text-sm font-medium text-white outline-none">
                    <option value="">Unassigned</option>
                    {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.full_name || member.email || "Teammate"}</option>)}
                  </select>
                  <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">Primary operational driver</p>
                </div>

                <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
                  <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                    <CalendarDays className="h-3.5 w-3.5" /> Target Date
                  </p>
                  <input type="date" value={selected.target_date || ""} disabled={updating} onChange={(event) => void patchInitiative({ target_date: event.target.value || null })} className="w-full bg-transparent text-sm font-medium text-white outline-none" />
                  {!selected.target_date && <p className="mt-1 text-sm text-[var(--omnix-text-3)]">No deadline set</p>}
                </div>
              </div>

              {selected.initiative_context ? (
                <div className={cn(
                  "mb-8 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.025] p-4",
                  mobileTab !== "brief" && "hidden lg:block"
                )}>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300/50">Mission Context</p>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--omnix-text)]">{selected.initiative_context}</p>
                </div>
              ) : null}

              {/* Phase 3: Linked Decisions */}
              <div className={cn("mb-8", mobileTab !== "brief" && "hidden lg:block")}>
                <DecisionTraceabilityList decisions={selected.linked_decisions} title="Related Decisions" />
              </div>

              {/* Blockers Visibility */}
              {selected.momentum.blocked_task_count > 0 && (
                <div className={cn(
                  "mb-8 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4",
                  mobileTab !== "brief" && "hidden lg:block"
                )}>
                  <div className="flex items-center gap-2 text-amber-300">
                    <AlertTriangle className="h-4 w-4" />
                    <p className="text-xs font-bold uppercase tracking-widest">Active Blockers</p>
                  </div>
                  <p className="mt-2 text-sm text-amber-100/80">{selected.momentum.blocked_task_count} tasks are currently preventing strategic movement.</p>
                </div>
              )}

              {/* Phase 5: Progressive Disclosure for Linkage */}
              <div className={cn("space-y-4", mobileTab !== "plan" && "hidden lg:block")}>
                <details className="group/disclosure rounded-2xl border border-[var(--omnix-border)] bg-black/5 overflow-hidden transition-all" open={true}>
                  <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                      <ClipboardCheck className="h-4 w-4 text-[var(--omnix-text-3)]" />
                      <span className="text-sm font-medium text-white">Execution Linkage</span>
                      <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_tasks.length} tasks</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
                  </summary>
                  <div className="border-t border-[var(--omnix-border)] p-4 space-y-4">
                    <div className="flex gap-2">
                      <select value={taskToAttach} onChange={(event) => setTaskToAttach(event.target.value)} className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs">
                        <option value="">Attach existing task...</option>
                        {availableTasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                      </select>
                      <Button size="sm" variant="secondary" disabled={!taskToAttach || updating} onClick={() => void attachTask()}>Link Task</Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selected.linked_tasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/20 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-white">{task.title}</p>
                            <p className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-[var(--omnix-text-3)]">{task.status}</p>
                          </div>
                          <button type="button" onClick={() => void detachTask(task)} className="text-[var(--omnix-text-3)] hover:text-rose-400 transition-colors" aria-label="Detach task"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      {!selected.linked_tasks.length ? <p className="py-4 text-center text-xs text-[var(--omnix-text-3)] col-span-full">No task records attached.</p> : null}
                    </div>
                  </div>
                </details>

                <details className="group/disclosure rounded-2xl border border-[var(--omnix-border)] bg-black/5 overflow-hidden transition-all">
                  <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                      <MessagesSquare className="h-4 w-4 text-[var(--omnix-text-3)]" />
                      <span className="text-sm font-medium text-white">Conversations</span>
                      <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_channels.length} channels</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
                  </summary>
                  <div className="border-t border-[var(--omnix-border)] p-4 space-y-4">
                    <div className="flex gap-2">
                      <select value={channelToAttach} onChange={(event) => setChannelToAttach(event.target.value)} className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs">
                        <option value="">Attach operational channel...</option>
                        {availableChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
                      </select>
                      <Button size="sm" variant="secondary" disabled={!channelToAttach || updating} onClick={() => void attachChannel()}>Link Channel</Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {selected.linked_channels.map((channel) => (
                        <div key={channel.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/20 px-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-white">{channel.name}</p>
                            <p className="mt-1 text-[10px] text-[var(--omnix-text-3)]">{channel.message_count} messages recorded</p>
                          </div>
                          <button type="button" onClick={() => void detachChannel(channel.id)} className="text-[var(--omnix-text-3)] hover:text-rose-400 transition-colors" aria-label="Detach conversation"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      ))}
                      {!selected.linked_channels.length ? <p className="py-4 text-center text-xs text-[var(--omnix-text-3)] col-span-full">No operational channels attached.</p> : null}
                    </div>
                  </div>
                </details>

                <details className="group/disclosure rounded-2xl border border-[var(--omnix-border)] bg-black/5 overflow-hidden transition-all">
                  <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                    <div className="flex items-center gap-3">
                      <Link2 className="h-4 w-4 text-[var(--omnix-text-3)]" />
                      <span className="text-sm font-medium text-white">Resources & Decisions</span>
                      <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_resources.length} items</span>
                    </div>
                    <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
                  </summary>
                  <div className="border-t border-[var(--omnix-border)] p-4 space-y-4">
                    <form onSubmit={addResource} className="flex flex-wrap gap-2">
                      <select value={resourceType} onChange={(event) => setResourceType(event.target.value as WorkspaceInitiativeResource["resource_type"])} className="omnix-input h-9 rounded-lg px-2 text-xs">
                        <option value="decision">Decision</option><option value="file">File</option><option value="reference">Reference</option><option value="ai_session">AI context</option>
                      </select>
                      <Input value={resourceLabel} onChange={(event) => setResourceLabel(event.target.value)} placeholder="Label" className="h-9 min-w-[8rem] flex-1 text-xs" />
                      <Input value={resourceId} onChange={(event) => setResourceId(event.target.value)} placeholder="Record id or reference" className="h-9 min-w-[10rem] flex-1 text-xs" />
                      <Button type="submit" size="sm" variant="secondary" disabled={!resourceId.trim() || updating}>Link Resource</Button>
                    </form>
                    <div className="flex flex-wrap gap-2">
                      {selected.linked_resources.map((resource) => (
                        <button key={`${resource.resource_type}-${resource.resource_id}`} type="button" onClick={() => void patchInitiative({ linked_resources: selected.linked_resources.filter((item) => item !== resource) })} className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] px-3 py-1.5 text-xs text-cyan-100/90 hover:bg-cyan-300/10 transition-colors" title="Remove link">
                          <span className="text-[10px] font-bold uppercase text-cyan-400/60">{resource.resource_type}</span>
                          {resource.label || resource.resource_id} 
                          <X className="h-3 w-3 opacity-60" />
                        </button>
                      ))}
                      {!selected.linked_resources.length ? <p className="text-xs text-[var(--omnix-text-3)]">No resources linked.</p> : null}
                    </div>
                  </div>
                </details>
              </div>

              {/* Mobile Assist View */}
              <div className={cn("space-y-4 lg:hidden", mobileTab !== "assist" && "hidden")}>
                <section className="omnix-panel rounded-xl p-4">
                  <p className="mb-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-300/70"><Sparkles className="h-3.5 w-3.5" /> Mission Assist</p>
                  <div className="grid gap-2">
                    {Object.entries(assistanceLabels).map(([mode, label]) => (
                      <button key={mode} type="button" disabled={Boolean(assisting)} onClick={() => void requestAssistance(mode as WorkspaceInitiativeAssistanceMode)} className="group flex items-center justify-between rounded-xl border border-purple-300/15 bg-purple-300/[0.03] px-4 py-3 text-left text-xs font-medium text-purple-100/90 transition hover:bg-purple-300/[0.08] disabled:opacity-40">
                        {label}
                        {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 opacity-40" />}
                      </button>
                    ))}
                  </div>
                  {assistance ? (
                    <div className="mt-4 rounded-xl border border-purple-300/20 bg-purple-300/[0.04] p-4">
                      <p className="whitespace-pre-wrap text-xs leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
                      <p className="mt-3 text-[10px] font-medium leading-relaxed text-[var(--omnix-text-3)]">Read from {assistance.source_task_count} tasks and {assistance.source_message_count} messages.</p>
                    </div>
                  ) : null}
                </section>
              </div>
            </>
          )}
        </main>

        <aside className={cn(
          "order-2 space-y-3 lg:order-none lg:col-span-2 xl:col-span-1",
          selectedId && "hidden lg:block"
        )}>
          <section className="omnix-panel rounded-xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Movement</p>
            <p className="mt-3 text-sm leading-6 text-white font-medium">{selected?.momentum.summary || "Select an initiative to see recorded movement."}</p>
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
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)] mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
          
          <section className="omnix-panel rounded-xl p-4">
            <p className="mb-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-300/70"><Sparkles className="h-3.5 w-3.5" /> Mission Assist</p>
            <div className="grid gap-2">
              {Object.entries(assistanceLabels).map(([mode, label]) => (
                <button key={mode} type="button" disabled={!selected || Boolean(assisting)} onClick={() => void requestAssistance(mode as WorkspaceInitiativeAssistanceMode)} className="group flex items-center justify-between rounded-xl border border-purple-300/15 bg-purple-300/[0.03] px-4 py-2.5 text-left text-xs font-medium text-purple-100/90 transition hover:bg-purple-300/[0.08] disabled:opacity-40">
                  {label}
                  {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />}
                </button>
              ))}
            </div>
            {assistance ? (
              <div className="mt-4 rounded-xl border border-purple-300/20 bg-purple-300/[0.04] p-4">
                <p className="whitespace-pre-wrap text-xs leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
                <p className="mt-3 text-[10px] font-medium leading-relaxed text-[var(--omnix-text-3)]">Read from {assistance.source_task_count} tasks and {assistance.source_message_count} messages.</p>
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </section>
  );
}
