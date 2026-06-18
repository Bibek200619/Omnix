"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CircleDot,
  ClipboardCheck,
  Plus,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useToast } from "@/lib/toast-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type {
  WorkspaceMember,
  WorkspaceMentionMetadata,
  WorkspaceInitiative,
  WorkspaceTask,
  WorkspaceTaskAssistance,
  WorkspaceTaskAssistanceMode,
  WorkspaceTaskMomentum,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";
import { ExecutionOverview } from "./ExecutionOverview";
import { TaskCreateForm } from "./TaskCreateForm";
import { TaskList } from "./TaskList";
import { TaskMomentumPanel } from "./TaskMomentumPanel";

const flow: Array<{ value: WorkspaceTaskStatus; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "complete", label: "Complete" },
];

function mergeTask(current: WorkspaceTask[], incoming: WorkspaceTask) {
  return [incoming, ...current.filter((task) => task.id !== incoming.id && !(incoming.client_nonce && task.client_nonce === incoming.client_nonce))];
}

export function WorkspaceTasksSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Execution">
      <WorkspaceTasksSurfaceContent />
    </SurfaceErrorBoundary>
  );
}

function WorkspaceTasksSurfaceContent() {
  const { session } = useAuth();
  const { showToast } = useToast();
  const { activeWorkspace, activeWorkspaceId } = useWorkspace();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const searchParams = useSearchParams();
  const routeTaskId = searchParams?.get("id") ?? null;
  const routeCreateTask = searchParams?.get("create") === "task";
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
  const [descriptionMentions, setDescriptionMentions] = useState<WorkspaceMentionMetadata[]>([]);
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
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const taskRefs = useRef<Record<string, HTMLElement | null>>({});
  const taskListRef = useRef<HTMLDivElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const liveAnnouncementRef = useRef("");
  const workspaceRef = useRef(activeWorkspaceId);
  const requestRef = useRef(0);
  const [liveAnnouncementVersion, setLiveAnnouncementVersion] = useState(0);

  workspaceRef.current = activeWorkspaceId;

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
      if (routeTaskId) {
        const routeTask = incomingTasks.find((task) => task.id === routeTaskId);
        if (routeTask) {
          setFocusedTaskId(routeTask.id);
          setFilter(routeTask.status === "complete" ? "complete" : "open");
        } else {
          setFocusedTaskId(null);
        }
      } else {
        setFocusedTaskId(null);
      }
      setError(null);
    } catch (err) {
      if (requestId === requestRef.current) {
        logClientError("Failed to load tasks", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks` });
        setError("Unable to load tasks. Check your connection and try again.");
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [activeWorkspaceId, routeTaskId]);

  useEffect(() => {
    setTasks([]);
    setMomentum(null);
    setInitiatives([]);
    setAssistance(null);
    setFilter("open");
    setFocusedTaskId(routeTaskId);
    void loadExecution(true);
  }, [activeWorkspaceId, loadExecution, routeTaskId]);

  useEffect(() => {
    if (routeCreateTask) {
      setCreateOpen(true);
    }
  }, [routeCreateTask]);

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

  const taskVirtualizer = useVirtualizer({
    count: displayedTasks.length,
    getScrollElement: () => taskListRef.current,
    estimateSize: () => 88,
    overscan: 6,
  });

  useEffect(() => {
    if (!focusedTaskId || loading) return;
    const focusedIndex = displayedTasks.findIndex((task) => task.id === focusedTaskId);
    if (focusedIndex >= 0) {
      taskVirtualizer.scrollToIndex(focusedIndex, { align: "center" });
    }
    const timer = window.setTimeout(() => {
      taskRefs.current[focusedTaskId]?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [displayedTasks, focusedTaskId, loading, taskVirtualizer]);

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
      activity_metadata: descriptionMentions.length ? { origin: "manual", mentions: descriptionMentions } : { origin: "manual" },
      momentum_metadata: {},
      mentions: descriptionMentions,
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
        mentions: mentionPayload(descriptionMentions, description),
      });
      setTasks((current) => mergeTask(current, created));
      setTitle("");
      setDescription("");
      setDescriptionMentions([]);
      setStatus("idea");
      setOwnerId("");
      setDueDate("");
      setInitialBlocker("");
      setInitiativeId("");
      setCreateOpen(false);
      announceMutation(`Task ${created.title} created.`);
      showToast({ title: "Task created", message: created.title });
      void loadExecution();
    } catch (err) {
      setTasks((current) => current.filter((task) => task.client_nonce !== nonce));
      logClientError("Failed to open task", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks` });
      setError("Unable to open task. Check your connection and try again.");
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
      const blockerRemoved = Array.isArray(payload.blockers) && payload.blockers.length < task.blockers.length;
      announceMutation(blockerRemoved ? `Blocker removed from ${updated.title}.` : `Task ${updated.title} updated.`);
      showToast({ title: blockerRemoved ? "Blocker removed" : "Task updated", message: updated.title });
      void loadExecution();
    } catch (err) {
      setTasks((current) => current.map((item) => (item.id === task.id ? before : item)));
      logClientError("Failed to update task", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks/${task.id}` });
      setError("Unable to update task. Your session may have expired; refresh and try again.");
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
      logClientError("Failed to load task assistance", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks/assist` });
      setError("Execution assistance is temporarily unavailable. Please try again in a moment.");
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
    <section className="omnix-container-responsive omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5 xl:overflow-hidden">
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-255-255-0-025)] px-4 py-3 sm:px-5 sm:py-4">
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

      <ExecutionOverview items={executionOverview} />

      {error ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title={error.startsWith("Unable to load tasks.") ? "Tasks are unavailable" : "Task action needs attention"}
          message={error}
          onRetry={error.startsWith("Unable to load tasks.") ? () => void loadExecution(true) : undefined}
          isRetrying={loading}
          onDismiss={() => setError(null)}
        />
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

      <div className="omnix-task-workbench shrink-0">
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
            <TaskCreateForm
              title={title}
              description={description}
              descriptionMentions={descriptionMentions}
              status={status}
              ownerId={ownerId}
              dueDate={dueDate}
              initialBlocker={initialBlocker}
              initiativeId={initiativeId}
              members={members}
              initiatives={initiatives}
              phases={flow}
              creating={creating}
              onSubmit={createTask}
              onCancel={() => {
                setCreateOpen(false);
                setDescriptionMentions([]);
              }}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onDescriptionMentionsChange={setDescriptionMentions}
              onStatusChange={setStatus}
              onOwnerChange={setOwnerId}
              onDueDateChange={setDueDate}
              onInitialBlockerChange={setInitialBlocker}
              onInitiativeChange={setInitiativeId}
            />
          ) : null}

          <TaskList
            listRef={taskListRef}
            loading={loading}
            tasks={displayedTasks}
            virtualItems={taskVirtualizer.getVirtualItems()}
            totalSize={taskVirtualizer.getTotalSize()}
            measureElement={taskVirtualizer.measureElement}
            members={members}
            initiatives={initiatives}
            phases={flow}
            currentUserId={session?.user.id}
            focusedTaskId={focusedTaskId}
            updatingId={updatingId}
            blockerDrafts={blockerDrafts}
            onCreateClick={() => setCreateOpen(true)}
            onPatchTask={(task, payload) => void patchTask(task, payload)}
            onBlockerDraftChange={(taskId, value) =>
              setBlockerDrafts((current) => ({ ...current, [taskId]: value }))
            }
            onAddBlocker={addBlocker}
            taskRef={(taskId, node) => {
              taskRefs.current[taskId] = node;
            }}
          />
        </main>

        <TaskMomentumPanel
          momentum={momentum}
          simplifiedMomentum={simplifiedMomentum}
          taskCount={tasks.length}
          myOpenTaskCount={tasks.filter((task) => task.owner_user_id === session?.user.id && task.status !== "complete").length}
          assistance={assistance}
          assisting={assisting}
          onRequestAssistance={(mode) => void requestAssistance(mode)}
        />
      </div>
    </section>
  );
}
