"use client";

import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  CircleDot,
  Compass,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { invalidateQueries, queryGet } from "@/lib/query";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useToast } from "@/lib/toast-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type {
  WorkspaceChannel,
  WorkspaceInitiative,
  WorkspaceInitiativeAssistance,
  WorkspaceInitiativeAssistanceMode,
  WorkspaceInitiativeResource,
  WorkspaceInitiativeStatus,
  WorkspaceMember,
  WorkspaceTask,
} from "@/lib/workspace-types";
import { InitiativeCard } from "./InitiativeCard";
import { InitiativeCreateForm } from "./InitiativeCreateForm";
import { InitiativeDetailPanel } from "./InitiativeDetailPanel";
import { initiativeAssistanceLabels } from "./initiativeOptions";

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

function invalidateInitiativeQueries(workspaceId: string) {
  invalidateQueries(`/workspaces/${workspaceId}/initiatives`);
  invalidateQueries(`/workspaces/${workspaceId}/tasks`);
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

export const WorkspaceInitiativesSurface = memo(function WorkspaceInitiativesSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Initiatives">
      <WorkspaceInitiativesSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function WorkspaceInitiativesSurfaceContent() {
  const { session } = useAuth();
  const { showToast } = useToast();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const searchParams = useSearchParams();
  const routeInitiativeId = searchParams?.get("id") ?? null;
  const routeCreateInitiative = searchParams?.get("create") === "initiative";
  const routeCreateInitiativeToken = searchParams?.get("palette") ?? null;
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
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const liveAnnouncementRef = useRef("");
  const workspaceRef = useRef(activeWorkspaceId);
  const requestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const [liveAnnouncementVersion, setLiveAnnouncementVersion] = useState(0);

  const announceMutation = useCallback((message: string) => {
    liveAnnouncementRef.current = message;
    setLiveAnnouncementVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    if (!liveRegionRef.current) return;
    liveRegionRef.current.textContent = "";
    const timer = window.setTimeout(() => {
      if (liveRegionRef.current) {
        liveRegionRef.current.textContent = liveAnnouncementRef.current;
      }
    }, 10);
    return () => window.clearTimeout(timer);
  }, [liveAnnouncementVersion]);

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
        queryGet<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        includeOptions ? queryGet<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceChannel[]>(`/workspaces/${activeWorkspaceId}/channels`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      setInitiatives(incoming);
      setSelectedId((current) => {
        if (routeInitiativeId && incoming.some((initiative) => initiative.id === routeInitiativeId)) {
          return routeInitiativeId;
        }
        return incoming.some((initiative) => initiative.id === current) ? current : incoming[0]?.id ?? null;
      });
      if (taskOptions) setTasks(taskOptions);
      if (channelOptions) setChannels(channelOptions);
      if (memberOptions) setMembers(memberOptions);
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        logClientError("Failed to load initiatives", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives` });
        setError("Unable to load initiatives. Check your connection and try again.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId, routeInitiativeId]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      if (activeWorkspaceId) {
        invalidateInitiativeQueries(activeWorkspaceId);
      }
      void loadInitiatives(true);
    }, 120);
  }, [activeWorkspaceId, loadInitiatives]);

  useEffect(() => {
    setInitiatives([]);
    setSelectedId(null);
    setAssistance(null);
    setCreateOpen(false);
    void loadInitiatives(true);
  }, [activeWorkspaceId, loadInitiatives]);

  useEffect(() => {
    if (routeCreateInitiative) {
      setCreateOpen(true);
    }
  }, [routeCreateInitiative, routeCreateInitiativeToken]);

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
      invalidateInitiativeQueries(activeWorkspaceId);
      setSelectedId(created.id);
      setTitle("");
      setDescription("");
      setOwnerId("");
      setTargetDate("");
      setContext("");
      setCreateOpen(false);
      announceMutation(`Initiative ${created.title} created.`);
      showToast({ title: "Initiative created", message: created.title });
      void loadInitiatives(true);
    } catch (err) {
      setInitiatives((current) => current.filter((initiative) => initiative.client_nonce !== nonce));
      logClientError("Failed to open initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives` });
      setError("Unable to open initiative. Check your connection and try again.");
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
      invalidateInitiativeQueries(activeWorkspaceId);
      announceMutation(`Initiative ${changed.title} updated.`);
      showToast({ title: "Initiative updated", message: changed.title });
    } catch (err) {
      setInitiatives((current) => current.map((item) => (item.id === before.id ? before : item)));
      logClientError("Failed to update initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}` });
      setError("Unable to update initiative. Your session may have expired; refresh and try again.");
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
      invalidateInitiativeQueries(activeWorkspaceId);
      setTaskToAttach("");
      announceMutation(`Task attached to ${changed.title}.`);
      showToast({ title: "Task linked", message: changed.title });
      void loadInitiatives(true);
    } catch (err) {
      logClientError("Failed to attach task to initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/tasks/${taskToAttach}` });
      setError("Unable to attach task. Check your connection and try again.");
    } finally {
      setUpdating(false);
    }
  }

  async function detachTask(task: WorkspaceTask) {
    if (!activeWorkspaceId) return;
    setUpdating(true);
    try {
      await apiClient.patch<WorkspaceTask>(`/workspaces/${activeWorkspaceId}/tasks/${task.id}`, { initiative_id: null });
      invalidateInitiativeQueries(activeWorkspaceId);
      announceMutation(`Task ${task.title} detached from initiative.`);
      showToast({ title: "Task unlinked", message: task.title });
      void loadInitiatives(true);
    } catch (err) {
      logClientError("Failed to detach task from initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks/${task.id}` });
      setError("Unable to detach task. Check your connection and try again.");
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
      invalidateInitiativeQueries(activeWorkspaceId);
      setChannelToAttach("");
      announceMutation(`Conversation attached to ${changed.title}.`);
      showToast({ title: "Conversation linked", message: changed.title });
    } catch (err) {
      logClientError("Failed to attach conversation to initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels` });
      setError("Unable to attach conversation. Check your connection and try again.");
    } finally {
      setUpdating(false);
    }
  }

  async function detachChannel(channelId: string) {
    if (!activeWorkspaceId || !selected) return;
    setUpdating(true);
    try {
      await apiClient.delete(`/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels/${channelId}`);
      invalidateInitiativeQueries(activeWorkspaceId);
      announceMutation(`Conversation detached from ${selected.title}.`);
      showToast({ title: "Conversation unlinked", message: selected.title });
      void loadInitiatives(true);
    } catch (err) {
      logClientError("Failed to detach conversation from initiative", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels/${channelId}` });
      setError("Unable to detach conversation. Check your connection and try again.");
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
      setError("Initiative assistance is temporarily unavailable. Please try again in a moment.");
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
    <section className="omnix-container-responsive omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5 xl:overflow-hidden">
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-255-255-0-025)] px-4 py-3 sm:px-5 sm:py-4">
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
          title={error.startsWith("Unable to load initiatives.") ? "Initiatives are unavailable" : "Initiative action needs attention"}
          message={error}
          onRetry={error.startsWith("Unable to load initiatives.") ? () => void loadInitiatives(true) : undefined}
          isRetrying={loading}
          onDismiss={() => setError(null)}
        />
      ) : null}

      <div className="omnix-initiative-workbench shrink-0">
        <aside className={cn(
          "omnix-panel order-1 flex shrink-0 flex-col rounded-xl p-3 lg:order-none lg:min-h-[16rem]",
          selectedId && "hidden xl:flex"
        )}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Direction</p>
            <Button size="sm" variant="ghost" onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Create Initiative</Button>
          </div>
          {createOpen ? (
            <InitiativeCreateForm
              title={title}
              description={description}
              ownerId={ownerId}
              targetDate={targetDate}
              context={context}
              members={members}
              creating={creating}
              onSubmit={createInitiative}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onOwnerChange={setOwnerId}
              onTargetDateChange={setTargetDate}
              onContextChange={setContext}
            />
          ) : null}
          <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-2 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
            {loading ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && initiatives.length === 0 ? (
              <EmptyState
                icon={Compass}
                title="No initiatives yet"
                description="Initiatives track strategic direction across your workspace"
                action={{ label: "Create Initiative", onClick: () => setCreateOpen(true) }}
                className="min-w-[min(17rem,78vw)] lg:min-w-0"
              />
            ) : null}
            {sortedInitiatives.map((initiative) => (
              <InitiativeCard
                key={initiative.id}
                initiative={initiative}
                selected={selected?.id === initiative.id}
                onSelect={() => {
                  setSelectedId(initiative.id);
                  setAssistance(null);
                }}
              />
            ))}
          </div>
        </aside>

        <InitiativeDetailPanel
          selected={selected}
          selectedId={selectedId}
          mobileTab={mobileTab}
          updating={updating}
          members={members}
          availableTasks={availableTasks}
          availableChannels={availableChannels}
          taskToAttach={taskToAttach}
          channelToAttach={channelToAttach}
          resourceType={resourceType}
          resourceLabel={resourceLabel}
          resourceId={resourceId}
          simplifiedMomentum={simplifiedMomentum}
          progressPercentage={progressPercentage}
          assistance={assistance}
          assisting={assisting}
          onBack={() => setSelectedId(null)}
          onMobileTabChange={setMobileTab}
          onPatchInitiative={(payload) => void patchInitiative(payload)}
          onTaskToAttachChange={setTaskToAttach}
          onAttachTask={() => void attachTask()}
          onDetachTask={(task) => void detachTask(task)}
          onChannelToAttachChange={setChannelToAttach}
          onAttachChannel={() => void attachChannel()}
          onDetachChannel={(channelId) => void detachChannel(channelId)}
          onResourceTypeChange={setResourceType}
          onResourceLabelChange={setResourceLabel}
          onResourceIdChange={setResourceId}
          onAddResource={addResource}
          onRequestAssistance={(mode) => void requestAssistance(mode)}
        />

        <aside className={cn(
          "order-2 space-y-3 lg:order-none xl:col-span-1",
          selectedId && "hidden xl:block"
        )}>
          <section className="omnix-panel rounded-xl p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Movement</p>
            <p className="mt-3 break-words text-sm font-medium leading-6 text-white">{selected?.momentum.summary || "Select an initiative to see recorded movement."}</p>
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
              {Object.entries(initiativeAssistanceLabels).map(([mode, label]) => (
                <button key={mode} type="button" disabled={!selected || Boolean(assisting)} onClick={() => void requestAssistance(mode as WorkspaceInitiativeAssistanceMode)} className="group flex items-center justify-between rounded-xl border border-purple-300/15 bg-purple-300/[0.03] px-4 py-2.5 text-left text-xs font-medium text-purple-100/90 transition hover:bg-purple-300/[0.08] disabled:opacity-40">
                  {label}
                  {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 opacity-0 group-hover:opacity-40 transition-opacity" />}
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
      </div>
    </section>
  );
}
