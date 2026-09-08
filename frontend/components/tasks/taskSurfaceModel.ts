import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import { invalidateQueries } from "@/lib/query";
import { optimisticValueEqual } from "@/components/shared/optimisticValueEqual";
import {
  latestOwnedMutationFailure,
  recordOwnedMutationFailure,
  resolveOwnedMutationFailure,
  type OwnedMutationFailure,
} from "@/lib/mutation-lifecycle";
import type {
  WorkspaceTask,
  WorkspaceTaskAssistance,
  WorkspaceTaskAssistanceMode,
  WorkspaceMentionMetadata,
  WorkspaceTaskMomentum,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";

export const taskFlow: Array<{ value: WorkspaceTaskStatus; label: string }> = [
  { value: "idea", label: "Idea" },
  { value: "planned", label: "Planned" },
  { value: "active", label: "Active" },
  { value: "review", label: "Review" },
  { value: "complete", label: "Complete" },
];

export type OptimisticTaskPatch = Readonly<{
  before: WorkspaceTask;
  canonicalProofMisses?: number;
  patch: Partial<WorkspaceTask>;
  proofOwner?: OptimisticTaskPatch;
  responseUpdatedAt?: string | null;
  taskId: string;
  workspaceId: string;
}>;

export const TASK_PATCH_SYNC_WARNING =
  "The task update was accepted, but the latest server state could not be verified. Review the current values and try again.";
export const TASK_PATCH_UNCONFIRMED_WARNING =
  "The task update response was lost and the latest server state did not confirm it. Canonical values were restored; review them and try again.";

export type TaskCreateDraft = Readonly<{
  description: string;
  dueDate: string | null;
  initialBlocker: string;
  initiativeId: string | null;
  mentions: WorkspaceMentionMetadata[];
  ownerId: string | null;
  status: WorkspaceTaskStatus;
  title: string;
}>;

export function taskCreateFingerprint(workspaceId: string, draft: TaskCreateDraft) {
  return JSON.stringify({ workspaceId, ...draft });
}

export function createOptimisticTask(
  workspaceId: string,
  nonce: string,
  createdBy: string,
  ownerName: string | null,
  draft: TaskCreateDraft,
): WorkspaceTask {
  return {
    id: `pending-${nonce}`,
    workspace_id: workspaceId,
    title: draft.title,
    description: draft.description || null,
    status: draft.status,
    owner_user_id: draft.ownerId,
    created_by: createdBy,
    due_date: draft.dueDate,
    blockers: draft.initialBlocker ? [draft.initialBlocker] : [],
    linked_context: [],
    activity_metadata: draft.mentions.length ? { origin: "manual", mentions: draft.mentions } : { origin: "manual" },
    momentum_metadata: {},
    mentions: draft.mentions,
    initiative_id: draft.initiativeId,
    client_nonce: nonce,
    linked_decisions: [],
    owner_name: ownerName,
  };
}

export function useTaskMutationFailures() {
  const [failures, setFailures] = useState<OwnedMutationFailure[]>([]);
  const latestTokensRef = useRef(new Map<string, string>());
  const tokenRef = useRef(0);
  const beginMutation = useCallback((key: string) => {
    const token = String(++tokenRef.current);
    latestTokensRef.current.set(key, token);
    setFailures((current) => {
      const previous = current.find((failure) => failure.key === key);
      return previous ? resolveOwnedMutationFailure(current, key, previous.token) : current;
    });
    return token;
  }, []);
  const ownsMutation = useCallback(
    (key: string, token: string) => latestTokensRef.current.get(key) === token,
    [],
  );
  const failMutation = useCallback((key: string, token: string, message: string) => {
    if (!ownsMutation(key, token)) return;
    setFailures((current) => recordOwnedMutationFailure(current, { key, message, token }));
  }, [ownsMutation]);
  const finishMutation = useCallback((key: string, token: string) => {
    if (ownsMutation(key, token)) latestTokensRef.current.delete(key);
  }, [ownsMutation]);
  const resolveMutationFailure = useCallback((key: string, token: string) => {
    if (latestTokensRef.current.get(key) === token) latestTokensRef.current.delete(key);
    setFailures((current) => resolveOwnedMutationFailure(current, key, token));
  }, []);
  const resetMutationFailures = useCallback(() => {
    latestTokensRef.current.clear();
    setFailures([]);
  }, []);
  const dismissMutationFailure = useCallback(() => setFailures((current) => {
    const latest = current[current.length - 1];
    return latest ? resolveOwnedMutationFailure(current, latest.key, latest.token) : current;
  }), []);
  return {
    beginMutation,
    dismissMutationFailure,
    failMutation,
    finishMutation,
    mutationError: latestOwnedMutationFailure(failures),
    ownsMutation,
    resolveMutationFailure,
    resetMutationFailures,
  };
}

type TaskAssistanceMutationOptions = {
  activeWorkspaceId: string | null;
  beginMutation: (key: string) => string;
  failMutation: (key: string, token: string, message: string) => void;
  finishMutation: (key: string, token: string) => void;
  mountedRef: RefObject<boolean>;
  ownsMutation: (key: string, token: string) => boolean;
  resolveMutationFailure: (key: string, token: string) => void;
  workspaceEpochRef: RefObject<number>;
  workspaceRef: RefObject<string | null>;
};

export function useTaskAssistanceMutation({
  activeWorkspaceId,
  beginMutation,
  failMutation,
  finishMutation,
  mountedRef,
  ownsMutation,
  resolveMutationFailure,
  workspaceEpochRef,
  workspaceRef,
}: TaskAssistanceMutationOptions) {
  const [assistance, setAssistance] = useState<WorkspaceTaskAssistance | null>(null);
  const [assisting, setAssisting] = useState<WorkspaceTaskAssistanceMode | null>(null);
  const requestRef = useRef<object | null>(null);
  const assistanceFailureRef = useRef<{ key: string; token: string } | null>(null);
  const clearAssistanceFailure = useCallback(() => {
    const failure = assistanceFailureRef.current;
    if (!failure) return;
    resolveMutationFailure(failure.key, failure.token);
    assistanceFailureRef.current = null;
  }, [resolveMutationFailure]);
  useEffect(() => {
    requestRef.current = null;
    clearAssistanceFailure();
    setAssistance(null);
    setAssisting(null);
  }, [activeWorkspaceId, clearAssistanceFailure]);
  const requestAssistance = useCallback(async (mode: WorkspaceTaskAssistanceMode) => {
    if (!activeWorkspaceId) return;
    if (requestRef.current) return;
    clearAssistanceFailure();
    const workspaceId = activeWorkspaceId;
    const workspaceEpoch = workspaceEpochRef.current;
    const key = `task:assist:${workspaceId}:${mode}`;
    const token = beginMutation(key);
    const request = { key, token, workspaceEpoch, workspaceId };
    const isCurrent = () => requestRef.current === request && mountedRef.current
      && workspaceRef.current === workspaceId && workspaceEpochRef.current === workspaceEpoch
      && ownsMutation(key, token);
    requestRef.current = request;
    setAssisting(mode);
    try {
      const result = await apiClient.post<WorkspaceTaskAssistance>(`/workspaces/${workspaceId}/tasks/assist`, { mode });
      if (isCurrent()) setAssistance(result);
    } catch (error) {
      if (isCurrent()) {
        logClientError("Failed to load task assistance", error, { endpoint: `/workspaces/${workspaceId}/tasks/assist` });
        failMutation(key, token, "Execution assistance is temporarily unavailable. Please try again in a moment.");
        assistanceFailureRef.current = { key, token };
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        if (mountedRef.current && workspaceRef.current === workspaceId && workspaceEpochRef.current === workspaceEpoch && ownsMutation(key, token)) setAssisting(null);
      }
      finishMutation(key, token);
    }
  }, [activeWorkspaceId, beginMutation, clearAssistanceFailure, failMutation, finishMutation, mountedRef, ownsMutation, workspaceEpochRef, workspaceRef]);
  return { assistance, assisting, requestAssistance };
}

export function mergeTask(current: WorkspaceTask[], incoming: WorkspaceTask) {
  return [
    incoming,
    ...current.filter((task) => (
      task.id !== incoming.id
      && !(incoming.client_nonce && task.client_nonce === incoming.client_nonce)
    )),
  ];
}

function taskMatchesPatch(task: WorkspaceTask, patch: Partial<WorkspaceTask>) {
  return (Object.keys(patch) as Array<keyof WorkspaceTask>).every((key) => (
    optimisticValueEqual(task[key], patch[key])
  ));
}

export function taskPatchFromRecord(
  task: WorkspaceTask,
  patch: Partial<WorkspaceTask>,
) {
  return Object.fromEntries(
    (Object.keys(patch) as Array<keyof WorkspaceTask>).map((key) => [key, task[key]]),
  ) as Partial<WorkspaceTask>;
}

export function confirmedTaskPatch(
  optimistic: OptimisticTaskPatch,
  response: WorkspaceTask,
): OptimisticTaskPatch {
  return {
    ...optimistic,
    canonicalProofMisses: 0,
    patch: taskPatchFromRecord(response, optimistic.patch),
    responseUpdatedAt: response.updated_at ?? null,
  };
}

function timestampMillis(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function taskSupersedesPatch(
  task: WorkspaceTask,
  optimistic: OptimisticTaskPatch,
) {
  const incoming = timestampMillis(task.updated_at);
  const response = timestampMillis(optimistic.responseUpdatedAt);
  return incoming !== null && response !== null && incoming > response;
}

function taskPatchProofOwner(optimistic: OptimisticTaskPatch) {
  return optimistic.proofOwner ?? optimistic;
}

export function reconcileTaskSnapshot(
  incoming: WorkspaceTask[],
  workspaceId: string,
  optimisticCreate: WorkspaceTask | null,
  optimisticPatches: ReadonlyArray<readonly [string, OptimisticTaskPatch]>,
  canonicalProofKey: string | null = null,
) {
  let next = incoming;
  let settledCreate: Readonly<{
    canonical: WorkspaceTask;
    optimistic: WorkspaceTask;
  }> | null = null;
  const settledPatches: Array<readonly [string, OptimisticTaskPatch]> = [];
  const deferredPatches: Array<readonly [string, OptimisticTaskPatch, OptimisticTaskPatch]> = [];
  const conflictedPatches: Array<readonly [string, OptimisticTaskPatch]> = [];

  if (optimisticCreate) {
    const committed = incoming.find((task) => (
      task.id === optimisticCreate.id
      || Boolean(
        optimisticCreate.client_nonce
        && task.client_nonce === optimisticCreate.client_nonce,
      )
    ));
    if (committed) {
      settledCreate = { canonical: committed, optimistic: optimisticCreate };
    } else {
      next = mergeTask(next, optimisticCreate);
    }
  }

  for (const [key, optimistic] of optimisticPatches) {
    if (optimistic.workspaceId !== workspaceId) continue;
    const task = next.find((item) => item.id === optimistic.taskId);
    if (task && taskMatchesPatch(task, optimistic.patch)) {
      settledPatches.push([key, optimistic]);
      continue;
    }
    if (task && optimistic.responseUpdatedAt !== undefined && taskSupersedesPatch(task, optimistic)) {
      settledPatches.push([key, optimistic]);
      continue;
    }
    if (key === canonicalProofKey) {
      const misses = (optimistic.canonicalProofMisses ?? 0) + 1;
      if (misses >= 2) {
        conflictedPatches.push([key, optimistic]);
        continue;
      }
      const deferred = {
        ...optimistic,
        canonicalProofMisses: misses,
        proofOwner: taskPatchProofOwner(optimistic),
      };
      deferredPatches.push([key, optimistic, deferred]);
      next = mergeTask(next, { ...(task ?? optimistic.before), ...deferred.patch });
      continue;
    }
    next = mergeTask(next, { ...(task ?? optimistic.before), ...optimistic.patch });
  }

  return {
    conflictedPatches,
    deferredPatches,
    next,
    settledCreate,
    settledPatches,
  };
}

export function queueTaskCanonicalProof<T>(
  tails: Map<string, Promise<void>>,
  workspaceId: string,
  operation: () => Promise<T>,
) {
  const previous = tails.get(workspaceId) ?? Promise.resolve();
  const request = previous.catch(() => undefined).then(operation);
  const tail = request.then(() => undefined, () => undefined);
  tails.set(workspaceId, tail);
  void tail.then(() => {
    if (tails.get(workspaceId) === tail) tails.delete(workspaceId);
  });
  return request;
}

type TaskSnapshotReconciliation = ReturnType<typeof reconcileTaskSnapshot>;

export async function runTaskCanonicalProof(
  initialEpoch: number,
  canonicalProofKey: string | null,
  activeEpoch: () => number | null,
  reconcile: (epoch: number) => Promise<TaskSnapshotReconciliation | null>,
) {
  let epoch = initialEpoch;
  for (let scopeAttempt = 0; scopeAttempt < 3; scopeAttempt += 1) {
    const result = await reconcile(epoch);
    if (result === null) {
      const replacementEpoch = activeEpoch();
      if (replacementEpoch === null || replacementEpoch === epoch) return { epoch, result };
      epoch = replacementEpoch;
      continue;
    }
    if (canonicalProofKey && result.deferredPatches.some(([key]) => key === canonicalProofKey)) {
      continue;
    }
    return { epoch, result };
  }
  return { epoch, result: null };
}

export async function runTaskTwoReadCanonicalProof(
  initialEpoch: number,
  activeEpoch: () => number | null,
  reconcile: (epoch: number) => Promise<TaskSnapshotReconciliation | null>,
  isConfirmed: (result: TaskSnapshotReconciliation) => boolean,
) {
  const first = await runTaskCanonicalProof(initialEpoch, null, activeEpoch, reconcile);
  if (first.result === null || isConfirmed(first.result)) return first;
  return runTaskCanonicalProof(first.epoch, null, activeEpoch, reconcile);
}

export function createTaskOptimisticMutationState() {
  const creates = new Map<string, WorkspaceTask>();
  const patches = new Map<string, OptimisticTaskPatch>();
  const canonicalCreates = new WeakMap<WorkspaceTask, WorkspaceTask>();
  const canonicalPatches = new WeakSet<OptimisticTaskPatch>();
  return {
    canonicalCreate: (optimistic: WorkspaceTask) => canonicalCreates.get(optimistic),
    canonicalPatchWasObserved: (optimistic: OptimisticTaskPatch) => (
      canonicalPatches.has(taskPatchProofOwner(optimistic))
    ),
    creates,
    patches,
    restorePatch(key: string, optimistic: OptimisticTaskPatch,
      previous: OptimisticTaskPatch | null = null) {
      const current = patches.get(key);
      if (!current || taskPatchProofOwner(current) !== taskPatchProofOwner(optimistic)) return false;
      if (previous) patches.set(key, previous);
      else patches.delete(key);
      return true;
    },
    reconcile(incoming: WorkspaceTask[], workspaceId: string, canonicalProofKey: string | null = null) {
      const reconciled = reconcileTaskSnapshot(
        incoming,
        workspaceId,
        creates.get(workspaceId) ?? null,
        [...patches.entries()],
        canonicalProofKey,
      );
      if (reconciled.settledCreate) {
        const { canonical, optimistic } = reconciled.settledCreate;
        canonicalCreates.set(optimistic, canonical);
        if (creates.get(workspaceId) === optimistic) creates.delete(workspaceId);
      }
      for (const [key, optimistic] of reconciled.settledPatches) {
        canonicalPatches.add(taskPatchProofOwner(optimistic));
        if (patches.get(key) === optimistic) patches.delete(key);
      }
      for (const [key, optimistic, deferred] of reconciled.deferredPatches) {
        if (patches.get(key) === optimistic) patches.set(key, deferred);
      }
      for (const [key, optimistic] of reconciled.conflictedPatches) {
        if (patches.get(key) === optimistic) patches.delete(key);
      }
      return reconciled;
    },
  };
}

export function invalidateTaskQueries(workspaceId: string) {
  invalidateQueries(`/workspaces/${workspaceId}/tasks`);
  invalidateQueries(`/workspaces/${workspaceId}/initiatives`);
}

export function prioritizeTasks(
  tasks: WorkspaceTask[],
  filter: WorkspaceTaskStatus | "open",
  currentUserId?: string,
) {
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(now.getDate() + 3);
  return tasks
    .filter((task) => filter === "open" ? task.status !== "complete" : task.status === filter)
    .sort((a, b) => {
      if (a.status === "active" && b.status !== "active") return -1;
      if (b.status === "active" && a.status !== "active") return 1;
      if (a.blockers.length > 0 && b.blockers.length === 0) return -1;
      if (b.blockers.length > 0 && a.blockers.length === 0) return 1;
      const aDueSoon = a.due_date && new Date(a.due_date) <= threeDaysFromNow;
      const bDueSoon = b.due_date && new Date(b.due_date) <= threeDaysFromNow;
      if (aDueSoon && !bDueSoon) return -1;
      if (bDueSoon && !aDueSoon) return 1;
      if (a.owner_user_id === currentUserId && b.owner_user_id !== currentUserId) return -1;
      if (b.owner_user_id === currentUserId && a.owner_user_id !== currentUserId) return 1;
      return 0;
    });
}

export function taskExecutionOverview(tasks: WorkspaceTask[], currentUserId?: string) {
  if (!tasks.length) return null;
  const now = new Date();
  const threeDaysFromNow = new Date();
  threeDaysFromNow.setDate(now.getDate() + 3);
  return [
    { label: "Active Tasks", count: tasks.filter((task) => task.status === "active").length, color: "text-cyan-300" },
    { label: "Blocked Tasks", count: tasks.filter((task) => task.blockers.length > 0 && task.status !== "complete").length, color: "text-amber-300" },
    { label: "Due Soon", count: tasks.filter((task) => task.due_date && task.status !== "complete" && new Date(task.due_date) <= threeDaysFromNow).length, color: "text-rose-300" },
    { label: "My Tasks", count: tasks.filter((task) => task.owner_user_id === currentUserId && task.status !== "complete").length, color: "text-emerald-300" },
  ];
}

export function taskMomentumSummary(momentum: WorkspaceTaskMomentum | null) {
  if (!momentum) return null;
  if (momentum.blocked_count > 0) return { label: "Blocked", color: "text-amber-300", description: "Progress is currently impeded by identified blockers." };
  if (momentum.flow_counts.active > 0 || momentum.flow_counts.review > 0) return { label: "Moving", color: "text-cyan-300", description: "Operational tasks are advancing through the flow." };
  if (momentum.flow_counts.complete > 0 && momentum.open_count === 0) return { label: "Complete", color: "text-emerald-300", description: "All recorded tasks in this view have reached completion." };
  return { label: "Quiet", color: "text-[var(--omnix-text-3)]", description: "No active operational momentum detected in recorded tasks." };
}
