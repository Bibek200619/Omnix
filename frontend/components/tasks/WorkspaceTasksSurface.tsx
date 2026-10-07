"use client";

import { FormEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleDot, ClipboardCheck, Plus, ShieldAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { SurfaceStateCard } from "@/components/ui/SurfaceStateCard";
import { mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import {
  mutationAttempt,
  releaseExclusiveMutations,
  rollbackOptimisticPatch,
  runExclusiveMutation,
  type MutationAttempt,
} from "@/lib/mutation-lifecycle";
import { queryGet } from "@/lib/query";
import { recoverableDraftKey, useRecoverableTextDraft } from "@/lib/recoverable-draft";
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useToast } from "@/lib/toast-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceInitiative, WorkspaceMember, WorkspaceMentionMetadata, WorkspaceTask,
  WorkspaceTaskMomentum, WorkspaceTaskStatus } from "@/lib/workspace-types";
import { ExecutionOverview } from "./ExecutionOverview";
import { TaskCreateForm } from "./TaskCreateForm";
import { TaskList } from "./TaskList";
import { TaskMomentumPanel } from "./TaskMomentumPanel";
import {
  TASK_PATCH_SYNC_WARNING, TASK_PATCH_UNCONFIRMED_WARNING,
  type OptimisticTaskPatch, type TaskCreateDraft,
  confirmedTaskPatch, createOptimisticTask, createTaskOptimisticMutationState,
  invalidateTaskQueries, mergeTask, prioritizeTasks, queueTaskCanonicalProof,
  runTaskCanonicalProof, runTaskTwoReadCanonicalProof, taskCreateFingerprint, taskExecutionOverview, taskFlow,
  taskMomentumSummary, useTaskAssistanceMutation, useTaskMutationFailures,
} from "./taskSurfaceModel";

export const WorkspaceTasksSurface = memo(function WorkspaceTasksSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Execution">
      <WorkspaceTasksSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function WorkspaceTasksSurfaceContent() {
  const { session } = useAuth();
  const { showToast } = useToast();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const searchParams = useSearchParams();
  const routeTaskId = searchParams?.get("id") ?? null;
  const routeCreateTask = searchParams?.get("create") === "task";
  const routeCreateTaskToken = searchParams?.get("palette") ?? null;
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [momentum, setMomentum] = useState<WorkspaceTaskMomentum | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | undefined>();
  const [filter, setFilter] = useState<WorkspaceTaskStatus | "open">("open");
  const [createOpen, setCreateOpen] = useState(false);
  const createDraftKey = useCallback((field: string) => (
    recoverableDraftKey([
      "task-create",
      session?.user.id ?? "anonymous",
      activeWorkspaceId ?? "no-workspace",
      field,
    ])
  ), [activeWorkspaceId, session?.user.id]);
  const [title, setTitle] = useRecoverableTextDraft(createDraftKey("title"));
  const [description, setDescription] = useRecoverableTextDraft(createDraftKey("description"));
  const [descriptionMentions, setDescriptionMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [statusDraft, setStatusDraft] = useRecoverableTextDraft(createDraftKey("status"), "idea");
  const status = useMemo<WorkspaceTaskStatus>(
    () => taskFlow.some((phase) => phase.value === statusDraft) ? statusDraft as WorkspaceTaskStatus : "idea",
    [statusDraft],
  );
  const [ownerId, setOwnerId] = useRecoverableTextDraft(createDraftKey("owner"));
  const [dueDate, setDueDate] = useRecoverableTextDraft(createDraftKey("due-date"));
  const [initialBlocker, setInitialBlocker] = useRecoverableTextDraft(createDraftKey("initial-blocker"));
  const [initiativeId, setInitiativeId] = useRecoverableTextDraft(createDraftKey("initiative"));
  const [creating, setCreating] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(() => new Set());
  const [blockerDrafts, setBlockerDrafts] = useState<Record<string, string>>({});
  const [focusedTaskId, setFocusedTaskId] = useState<string | null>(null);
  const taskRefs = useRef<Record<string, HTMLElement | null>>({});
  const taskListRef = useRef<HTMLDivElement | null>(null);
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const liveAnnouncementRef = useRef("");
  const workspaceRef = useRef(activeWorkspaceId);
  const workspaceEpochRef = useRef(0);
  const requestRef = useRef(0);
  const mutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const canonicalRefreshRegistryRef = useRef(new Map<string, Promise<void>>());
  const [optimisticState] = useState(createTaskOptimisticMutationState);
  const createAttemptsRef = useRef(new Map<string, MutationAttempt>());
  const mountedRef = useRef(true);
  const { beginMutation, dismissMutationFailure, failMutation, finishMutation,
    mutationError, ownsMutation, resolveMutationFailure, resetMutationFailures,
  } = useTaskMutationFailures();
  const { assistance, assisting, requestAssistance } = useTaskAssistanceMutation({
    activeWorkspaceId, beginMutation, failMutation, finishMutation,
    mountedRef, ownsMutation, resolveMutationFailure, workspaceEpochRef, workspaceRef,
  });
  const [liveAnnouncementVersion, setLiveAnnouncementVersion] = useState(0);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useLayoutEffect(() => {
    if (workspaceRef.current === activeWorkspaceId) return;
    const previousWorkspaceId = workspaceRef.current;
    if (previousWorkspaceId) releaseExclusiveMutations(mutationRegistryRef.current, (key) => (
      key === `task:create:${previousWorkspaceId}`
    ));
    workspaceRef.current = activeWorkspaceId;
    workspaceEpochRef.current += 1;
  }, [activeWorkspaceId]);
  const isCurrentWorkspaceMutation = (workspaceId: string, workspaceEpoch: number) =>
    mountedRef.current && workspaceRef.current === workspaceId && workspaceEpochRef.current === workspaceEpoch;
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
      setLoadError(null);
      setLoadErrorStatus(undefined);
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
        queryGet<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`),
        queryGet<WorkspaceTaskMomentum>(`/workspaces/${activeWorkspaceId}/tasks/momentum`),
        queryGet<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        withMembers ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : null,
      ];
      const [incomingTasks, incomingMomentum, incomingInitiatives, incomingMembers] = await Promise.all([
        requests[0],
        requests[1],
        requests[2] ?? Promise.resolve(null),
        requests[3] ?? Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      const reconciled = optimisticState.reconcile(incomingTasks, activeWorkspaceId);
      setTasks(reconciled.next);
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
      setLoadError(null);
      setLoadErrorStatus(undefined);
    } catch (err) {
      if (requestId === requestRef.current && workspaceRef.current === activeWorkspaceId) {
        logClientError("Failed to load tasks", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks` });
        const accessDenied = err instanceof ApiError && err.status === 403;
        setLoadErrorStatus(err instanceof ApiError ? err.status : undefined);
        setLoadError(
          accessDenied
            ? "You don't have access to this workspace's tasks. Choose an accessible workspace or retry after your access changes."
            : "Unable to load tasks. Check your connection and try again.",
        );
      }
    } finally {
      if (requestId === requestRef.current && workspaceRef.current === activeWorkspaceId) {
        setLoading(false);
      }
    }
  }, [activeWorkspaceId, optimisticState, routeTaskId]);

  const reconcileTaskMutation = useCallback((workspaceId: string, workspaceEpoch: number,
    canonicalProofKey: string | null = null) => {
    const isCurrent = () => mountedRef.current && workspaceRef.current === workspaceId
      && workspaceEpochRef.current === workspaceEpoch;
    if (!isCurrent()) return Promise.resolve(null);
    return queueTaskCanonicalProof(canonicalRefreshRegistryRef.current, workspaceId, async () => {
      if (!isCurrent()) return null;
      const incoming = await apiClient.get<WorkspaceTask[]>(`/workspaces/${workspaceId}/tasks`,
        { dedupe: false });
      if (!isCurrent()) return null;
      const reconciled = optimisticState.reconcile(incoming, workspaceId, canonicalProofKey);
      invalidateTaskQueries(workspaceId);
      requestRef.current += 1;
      setTasks(reconciled.next);
      setLoadError(null);
      return reconciled;
    });
  }, [optimisticState]);
  const proveTaskMutation = useCallback((workspaceId: string, workspaceEpoch: number,
    canonicalProofKey: string | null = null) => runTaskCanonicalProof(
    workspaceEpoch,
    canonicalProofKey,
    () => mountedRef.current && workspaceRef.current === workspaceId ? workspaceEpochRef.current : null,
    (epoch) => reconcileTaskMutation(workspaceId, epoch, canonicalProofKey),
  ), [reconcileTaskMutation]);
  useEffect(() => {
    setCreating(false);
    setUpdatingIds(new Set());
    setLoadError(null);
    resetMutationFailures();
    setCreateOpen(false);
  }, [activeWorkspaceId, resetMutationFailures]);

  useEffect(() => {
    setTasks([]);
    setMomentum(null);
    setInitiatives([]);
    setFilter("open");
    setFocusedTaskId(routeTaskId);
    void loadExecution(true);
  }, [activeWorkspaceId, loadExecution, routeTaskId]);

  useEffect(() => {
    if (routeCreateTask) {
      setCreateOpen(true);
    }
  }, [routeCreateTask, routeCreateTaskToken]);

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
          () => {
            invalidateTaskQueries(activeWorkspaceId);
            void loadExecution();
          },
        ),
    );
    return () => realtimeRegistry.unsubscribe({ type: "tasks", workspaceId: activeWorkspaceId });
  }, [activeWorkspaceId, loadExecution, session?.user.id]);

  const displayedTasks = useMemo(
    () => prioritizeTasks(tasks, filter, session?.user.id),
    [filter, tasks, session?.user.id],
  );

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

  const executionOverview = useMemo(
    () => taskExecutionOverview(tasks, session?.user.id),
    [tasks, session?.user.id],
  );
  const simplifiedMomentum = useMemo(() => taskMomentumSummary(momentum), [momentum]);
  const completeVisibleTaskCreate = (created: WorkspaceTask) => {
    setTasks((current) => mergeTask(current, created));
    setTitle(""); setDescription(""); setDescriptionMentions([]);
    setStatusDraft("idea"); setOwnerId(""); setDueDate("");
    setInitialBlocker(""); setInitiativeId(""); setCreateOpen(false);
    announceMutation(`Task ${created.title} created.`);
    showToast({ title: "Task created", message: created.title });
  };
  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !title.trim()) return;

    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const mutationKey = `task:create:${requestWorkspaceId}`;
    if (mutationRegistryRef.current.has(mutationKey)) {
      return;
    }
    const draft: TaskCreateDraft = {
      title: title.trim(),
      description: description.trim(),
      mentions: descriptionMentions,
      status,
      ownerId: ownerId || null,
      dueDate: dueDate || null,
      initialBlocker: initialBlocker.trim(),
      initiativeId: initiativeId || null,
    };
    const fingerprint = taskCreateFingerprint(requestWorkspaceId, draft);
    const attempt = mutationAttempt(createAttemptsRef.current.get(requestWorkspaceId) ?? null, fingerprint);
    createAttemptsRef.current.set(requestWorkspaceId, attempt);
    const mutationToken = beginMutation(mutationKey);
    await runExclusiveMutation(
      mutationRegistryRef.current,
      mutationKey,
      async () => {
        const optimistic = createOptimisticTask(
          requestWorkspaceId,
          attempt.nonce,
          session?.user.id || "",
          members.find((member) => member.user_id === draft.ownerId)?.full_name ?? null,
          draft,
        );
        setCreating(true);
        const previousCreate = optimisticState.creates.get(requestWorkspaceId);
        optimisticState.creates.set(requestWorkspaceId, optimistic);
        setTasks((current) => mergeTask(
          previousCreate?.id.startsWith("pending-")
            ? current.filter((task) => task.id !== previousCreate.id)
            : current,
          optimistic,
        ));
        try {
          const created = await apiClient.post<WorkspaceTask>(`/workspaces/${requestWorkspaceId}/tasks`, {
            title: optimistic.title,
            description: optimistic.description,
            status: optimistic.status,
            owner_user_id: optimistic.owner_user_id,
            due_date: optimistic.due_date,
            blockers: optimistic.blockers,
            linked_context: [],
            initiative_id: optimistic.initiative_id,
            client_nonce: attempt.nonce,
            mentions: mentionPayload(descriptionMentions, description),
          });
          if (
            created.workspace_id !== requestWorkspaceId ||
            created.client_nonce !== attempt.nonce
          ) {
            throw new Error("Task creation response did not match its mutation attempt.");
          }
          if (optimisticState.creates.get(requestWorkspaceId) === optimistic) {
            optimisticState.creates.set(requestWorkspaceId, created);
          }
          try {
            await proveTaskMutation(requestWorkspaceId, requestWorkspaceEpoch);
          } catch {
            invalidateTaskQueries(requestWorkspaceId);
          }
          if (ownsMutation(mutationKey, mutationToken) && createAttemptsRef.current.get(requestWorkspaceId) === attempt) {
            createAttemptsRef.current.delete(requestWorkspaceId);
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(mutationKey, mutationToken)) {
            if (optimisticState.creates.get(requestWorkspaceId) === created) {
              optimisticState.creates.delete(requestWorkspaceId);
            }
            return;
          }
          completeVisibleTaskCreate(created);
        } catch (err) {
          try {
            await runTaskTwoReadCanonicalProof(
              requestWorkspaceEpoch,
              () => mountedRef.current && workspaceRef.current === requestWorkspaceId ? workspaceEpochRef.current : null,
              (epoch) => reconcileTaskMutation(requestWorkspaceId, epoch),
              () => Boolean(optimisticState.canonicalCreate(optimistic)),
            );
          } catch {
            invalidateTaskQueries(requestWorkspaceId);
          }
          const canonical = optimisticState.canonicalCreate(optimistic);
          if (optimisticState.creates.get(requestWorkspaceId) === optimistic) {
            optimisticState.creates.delete(requestWorkspaceId);
          }
          if (canonical) {
            if (ownsMutation(mutationKey, mutationToken) && createAttemptsRef.current.get(requestWorkspaceId) === attempt) {
              createAttemptsRef.current.delete(requestWorkspaceId);
            }
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
              completeVisibleTaskCreate(canonical);
            }
            return;
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(mutationKey, mutationToken)) {
            return;
          }
          setTasks((current) => current.filter((task) => task.id !== optimistic.id));
          logClientError("Failed to open task", err, { endpoint: `/workspaces/${requestWorkspaceId}/tasks` });
          failMutation(mutationKey, mutationToken, "Unable to open task. Check your connection and try again.");
        } finally {
          if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
            setCreating(false);
          }
          finishMutation(mutationKey, mutationToken);
        }
      },
    );
  }

  async function patchTask(
    task: WorkspaceTask,
    payload: Partial<WorkspaceTask>,
  ): Promise<boolean> {
    if (!activeWorkspaceId || task.id.startsWith("pending-")) return false;
    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const requestTaskId = task.id;
    const mutationKey = `task:update:${requestWorkspaceId}:${requestTaskId}`;
    if (mutationRegistryRef.current.has(mutationKey)) {
      return false;
    }
    const before = task;
    const optimisticPatch = { ...payload };
    const previousOptimistic = optimisticState.patches.get(mutationKey);
    const optimistic: OptimisticTaskPatch = {
      before: previousOptimistic?.before ?? before,
      patch: { ...previousOptimistic?.patch, ...optimisticPatch },
      taskId: requestTaskId,
      workspaceId: requestWorkspaceId,
    };
    const mutationToken = beginMutation(mutationKey);
    return runExclusiveMutation(
      mutationRegistryRef.current,
      mutationKey,
      async () => {
        optimisticState.patches.set(mutationKey, optimistic);
        setUpdatingIds((current) => new Set(current).add(requestTaskId));
        setTasks((current) => current.map((item) => (
          item.id === requestTaskId ? { ...item, ...optimisticPatch } : item
        )));
        try {
          const updated = await apiClient.patch<WorkspaceTask>(
            `/workspaces/${requestWorkspaceId}/tasks/${requestTaskId}`,
            payload,
          );
          if (
            updated.id !== requestTaskId ||
            updated.workspace_id !== requestWorkspaceId
          ) {
            throw new Error("Task update response did not match its requested resource.");
          }
          const canonicalOptimistic = confirmedTaskPatch(optimistic, updated);
          if (optimisticState.patches.get(mutationKey) === optimistic) {
            optimisticState.patches.set(mutationKey, canonicalOptimistic);
          }
          let syncConflict = false;
          try {
            const { result: reconciled } = await proveTaskMutation(
              requestWorkspaceId, requestWorkspaceEpoch, mutationKey,
            );
            syncConflict = Boolean(
              reconciled?.conflictedPatches.some(([key]) => key === mutationKey),
            );
          } catch (reconciliationError) {
            optimisticState.patches.delete(mutationKey);
            invalidateTaskQueries(requestWorkspaceId);
            syncConflict = true;
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch)) {
              setTasks((current) => current.map((item) => item.id === requestTaskId ? updated : item));
              logClientError("Failed to verify successful task update", reconciliationError, { endpoint: `/workspaces/${requestWorkspaceId}/tasks` });
            }
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(mutationKey, mutationToken)) {
            optimisticState.patches.delete(mutationKey);
            return !syncConflict;
          }
          if (syncConflict) {
            failMutation(mutationKey, mutationToken, TASK_PATCH_SYNC_WARNING);
            return false;
          }
          const blockerRemoved = Array.isArray(payload.blockers) && payload.blockers.length < task.blockers.length;
          announceMutation(blockerRemoved ? `Blocker removed from ${updated.title}.` : `Task ${updated.title} updated.`);
          showToast({ title: blockerRemoved ? "Blocker removed" : "Task updated", message: updated.title });
          return true;
        } catch (err) {
          let canonicalProof = null;
          try {
            canonicalProof = (await proveTaskMutation(
              requestWorkspaceId, requestWorkspaceEpoch, mutationKey,
            )).result;
          } catch {
            invalidateTaskQueries(requestWorkspaceId);
          }
          if (optimisticState.canonicalPatchWasObserved(optimistic)) {
            if (optimisticState.patches.get(mutationKey) === optimistic) {
              optimisticState.patches.delete(mutationKey);
            }
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
              announceMutation(`Task ${task.title} updated.`);
              showToast({ title: "Task updated", message: task.title });
            }
            return true;
          }
          if (canonicalProof?.conflictedPatches.some(([key]) => key === mutationKey)) {
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch)) {
              failMutation(mutationKey, mutationToken, TASK_PATCH_UNCONFIRMED_WARNING);
            }
            return false;
          }
          optimisticState.restorePatch(mutationKey, optimistic, previousOptimistic ?? null);
          invalidateTaskQueries(requestWorkspaceId);
          if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
            setTasks((current) => current.map((item) => (
              item.id === requestTaskId
                ? rollbackOptimisticPatch(item, before, optimisticPatch)
                : item
            )));
            logClientError("Failed to update task", err, { endpoint: `/workspaces/${requestWorkspaceId}/tasks/${requestTaskId}` });
            failMutation(mutationKey, mutationToken, "Unable to update task. Your session may have expired; refresh and try again.");
          }
          return false;
        } finally {
          if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
            setUpdatingIds((current) => {
              if (!current.has(requestTaskId)) return current;
              const next = new Set(current);
              next.delete(requestTaskId);
              return next;
            });
          }
          finishMutation(mutationKey, mutationToken);
        }
      },
    );
  }

  function addBlocker(task: WorkspaceTask) {
    const blocker = blockerDrafts[task.id]?.trim();
    if (!blocker || task.blockers.includes(blocker)) return;
    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    if (!requestWorkspaceId) return;
    void patchTask(task, { blockers: [...task.blockers, blocker] }).then((succeeded) => {
      if (
        succeeded &&
        isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch)
      ) {
        setBlockerDrafts((current) => ({ ...current, [task.id]: "" }));
      }
    });
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <SurfaceStateCard
          tone="inaccessible"
          icon={ShieldAlert}
          title="No Active Workspace"
          description="Choose an accessible workspace from the sidebar to orient operational execution."
          className="max-w-md"
        />
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

      {mutationError || loadError ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title={mutationError ? "Task action needs attention" : loadErrorStatus === 403 ? "Workspace access required" : "Tasks are unavailable"}
          message={mutationError ?? loadError ?? ""}
          onRetry={!mutationError && loadError ? () => void loadExecution(true) : undefined}
          isRetrying={loading}
          onDismiss={mutationError ? dismissMutationFailure : () => setLoadError(null)}
        />
      ) : null}

      <div className="omnix-scrollbar mb-4 flex shrink-0 gap-2 overflow-x-auto pb-1 xl:grid xl:grid-cols-5 xl:overflow-visible xl:pb-0">
        {taskFlow.map((phase) => (
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

      {loadError ? (
        <SurfaceStateCard
          tone={loadErrorStatus === 403 ? "inaccessible" : "empty"}
          icon={ShieldAlert}
          title={loadErrorStatus === 403 ? "Tasks are inaccessible" : "Tasks are unavailable"}
          description={loadError}
          action={{ label: "Retry", onClick: () => void loadExecution(true) }}
          className="flex-1"
        />
      ) : (
        <div className="omnix-task-workbench shrink-0">
        <main className="omnix-panel flex min-w-0 flex-col rounded-xl p-3 sm:p-4 xl:min-h-[28rem]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--omnix-border)] pb-3">
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setFilter("open")} className={cn("min-h-11 rounded-full border px-3 text-xs font-medium transition", filter === "open" ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-100" : "border-[var(--omnix-border)] text-[var(--omnix-text-2)]")}>Current Flow</button>
              <p className="text-xs text-[var(--omnix-text-3)]">{displayedTasks.length} items</p>
            </div>
            <Button size="sm" disabled={creating} onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>
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
              phases={taskFlow}
              creating={creating}
              onSubmit={createTask}
              onCancel={() => {
                setCreateOpen(false);
                setDescriptionMentions([]);
              }}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onDescriptionMentionsChange={setDescriptionMentions}
              onStatusChange={setStatusDraft}
              onOwnerChange={setOwnerId}
              onDueDateChange={setDueDate}
              onInitialBlockerChange={setInitialBlocker}
              onInitiativeChange={setInitiativeId}
            />
          ) : null}

          <TaskList
            listRef={taskListRef}
            loading={loading}
            error={loadError}
            tasks={displayedTasks}
            virtualItems={taskVirtualizer.getVirtualItems()}
            totalSize={taskVirtualizer.getTotalSize()}
            measureElement={taskVirtualizer.measureElement}
            members={members}
            initiatives={initiatives}
            phases={taskFlow}
            currentUserId={session?.user.id}
            focusedTaskId={focusedTaskId}
            updatingIds={updatingIds}
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
      )}
    </section>
  );
}
