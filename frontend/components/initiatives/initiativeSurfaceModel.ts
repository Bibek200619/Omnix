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
  WorkspaceInitiative,
  WorkspaceInitiativeAssistance,
  WorkspaceInitiativeAssistanceMode,
  WorkspaceInitiativeStatus,
} from "@/lib/workspace-types";

export type OptimisticInitiativePatch = Readonly<{
  before: WorkspaceInitiative;
  canonicalProofMisses?: number;
  initiativeId: string;
  patch: Partial<WorkspaceInitiative>;
  proofOwner?: OptimisticInitiativePatch;
  responseUpdatedAt?: string | null;
  workspaceId: string;
}>;

export const INITIATIVE_PATCH_SYNC_WARNING =
  "The initiative update was accepted, but the latest server state could not be verified. Review the current values and try again.";
export const INITIATIVE_PATCH_UNCONFIRMED_WARNING =
  "The initiative update response was lost and the latest server state did not confirm it. Canonical values were restored; review them and try again.";

export type InitiativeCreateDraft = Readonly<{
  context: string;
  description: string;
  ownerId: string | null;
  targetDate: string | null;
  title: string;
}>;

export function initiativeCreateFingerprint(
  workspaceId: string,
  draft: InitiativeCreateDraft,
) {
  return JSON.stringify({ workspaceId, ...draft });
}

export function createOptimisticInitiative(
  workspaceId: string,
  nonce: string,
  createdBy: string | null,
  ownerName: string | null,
  draft: InitiativeCreateDraft,
): WorkspaceInitiative {
  return {
    id: `pending-${nonce}`,
    workspace_id: workspaceId,
    title: draft.title,
    description: draft.description || null,
    status: "draft",
    owner_user_id: draft.ownerId,
    created_by: createdBy,
    target_date: draft.targetDate,
    initiative_context: draft.context || null,
    linked_resources: [],
    activity_metadata: { origin: "manual" },
    client_nonce: nonce,
    linked_tasks: [],
    linked_channels: [],
    linked_decisions: [],
    owner_name: ownerName,
    momentum: quietMomentum(),
  };
}

export function useInitiativeMutationFailures() {
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
  const resolveMutationFailures = useCallback((matches: (key: string) => boolean) => {
    for (const key of latestTokensRef.current.keys()) {
      if (matches(key)) latestTokensRef.current.delete(key);
    }
    setFailures((current) => current.filter(({ key }) => !matches(key)));
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
    resolveMutationFailures,
    resetMutationFailures,
  };
}

export function createInitiativeBusyOwnership(publish: (busy: boolean) => void) {
  let current: object | null = null;
  return {
    begin() {
      const owner = {};
      current = owner;
      publish(true);
      return owner;
    },
    clear() {
      current = null;
      publish(false);
    },
    finish(owner: object, mounted = true) {
      if (current !== owner) return false;
      current = null;
      if (mounted) publish(false);
      return true;
    },
  };
}

export function useInitiativeBusyState() {
  const [updating, setUpdating] = useState(false);
  const [ownership] = useState(() => createInitiativeBusyOwnership(setUpdating));
  return {
    beginUpdating: ownership.begin,
    clearUpdating: ownership.clear,
    finishUpdating: ownership.finish,
    updating,
  };
}

type InitiativeAssistanceMutationOptions = {
  activeWorkspaceId: string | null;
  beginMutation: (key: string) => string;
  failMutation: (key: string, token: string, message: string) => void;
  finishMutation: (key: string, token: string) => void;
  mountedRef: RefObject<boolean>;
  ownsMutation: (key: string, token: string) => boolean;
  resolveMutationFailure: (key: string, token: string) => void;
  selectedInitiativeId: string | null;
  selectedInitiativeRef: RefObject<string | null>;
  workspaceEpochRef: RefObject<number>;
  workspaceRef: RefObject<string | null>;
};

export function useInitiativeAssistanceMutation({
  activeWorkspaceId,
  beginMutation,
  failMutation,
  finishMutation,
  mountedRef,
  ownsMutation,
  resolveMutationFailure,
  selectedInitiativeId,
  selectedInitiativeRef,
  workspaceEpochRef,
  workspaceRef,
}: InitiativeAssistanceMutationOptions) {
  const [assistance, setAssistance] = useState<WorkspaceInitiativeAssistance | null>(null);
  const [assisting, setAssisting] = useState<WorkspaceInitiativeAssistanceMode | null>(null);
  const requestRef = useRef<object | null>(null);
  const assistanceFailureRef = useRef<{ key: string; token: string } | null>(null);
  const clearAssistanceFailure = useCallback(() => {
    const failure = assistanceFailureRef.current;
    if (!failure) return;
    resolveMutationFailure(failure.key, failure.token);
    assistanceFailureRef.current = null;
  }, [resolveMutationFailure]);
  const abandonAssistance = useCallback(() => {
    requestRef.current = null;
    clearAssistanceFailure();
    setAssistance(null);
    setAssisting(null);
  }, [clearAssistanceFailure]);
  useEffect(() => abandonAssistance(), [abandonAssistance, activeWorkspaceId, selectedInitiativeId]);
  const requestAssistance = useCallback(async (mode: WorkspaceInitiativeAssistanceMode) => {
    if (!activeWorkspaceId || !selectedInitiativeId) return;
    if (requestRef.current) return;
    clearAssistanceFailure();
    const workspaceId = activeWorkspaceId;
    const workspaceEpoch = workspaceEpochRef.current;
    const initiativeId = selectedInitiativeId;
    const key = `initiative:assist:${workspaceId}:${initiativeId}:${mode}`;
    const token = beginMutation(key);
    const request = { initiativeId, key, token, workspaceEpoch, workspaceId };
    const isCurrent = () => requestRef.current === request && mountedRef.current
      && workspaceRef.current === workspaceId && workspaceEpochRef.current === workspaceEpoch
      && selectedInitiativeRef.current === initiativeId && ownsMutation(key, token);
    requestRef.current = request;
    setAssisting(mode);
    try {
      const result = await apiClient.post<WorkspaceInitiativeAssistance>(
        `/workspaces/${workspaceId}/initiatives/${initiativeId}/assist`,
        { mode },
      );
      if (isCurrent()) setAssistance(result);
    } catch (error) {
      if (isCurrent()) {
        logClientError("Failed to load initiative assistance", error, { endpoint: `/workspaces/${workspaceId}/initiatives/${initiativeId}/assist` });
        failMutation(key, token, "Initiative assistance is temporarily unavailable. Please try again in a moment.");
        assistanceFailureRef.current = { key, token };
      }
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        if (mountedRef.current && workspaceRef.current === workspaceId && workspaceEpochRef.current === workspaceEpoch && selectedInitiativeRef.current === initiativeId && ownsMutation(key, token)) setAssisting(null);
      }
      finishMutation(key, token);
    }
  }, [activeWorkspaceId, beginMutation, clearAssistanceFailure, failMutation, finishMutation, mountedRef, ownsMutation, selectedInitiativeId, selectedInitiativeRef, workspaceEpochRef, workspaceRef]);
  return { abandonAssistance, assistance, assisting, requestAssistance };
}

export function mergeInitiative(
  current: WorkspaceInitiative[],
  incoming: WorkspaceInitiative,
) {
  return [
    incoming,
    ...current.filter((item) => (
      item.id !== incoming.id
      && !(incoming.client_nonce && item.client_nonce === incoming.client_nonce)
    )),
  ];
}

function initiativeMatchesPatch(
  initiative: WorkspaceInitiative,
  patch: Partial<WorkspaceInitiative>,
) {
  return (Object.keys(patch) as Array<keyof WorkspaceInitiative>).every((key) => (
    optimisticValueEqual(initiative[key], patch[key])
  ));
}

export function initiativePatchFromRecord(
  initiative: WorkspaceInitiative,
  patch: Partial<WorkspaceInitiative>,
) {
  return Object.fromEntries(
    (Object.keys(patch) as Array<keyof WorkspaceInitiative>).map((key) => [key, initiative[key]]),
  ) as Partial<WorkspaceInitiative>;
}

export function confirmedInitiativePatch(
  optimistic: OptimisticInitiativePatch,
  response: WorkspaceInitiative,
): OptimisticInitiativePatch {
  return {
    ...optimistic,
    canonicalProofMisses: 0,
    patch: initiativePatchFromRecord(response, optimistic.patch),
    responseUpdatedAt: response.updated_at ?? null,
  };
}

function timestampMillis(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function initiativeSupersedesPatch(
  initiative: WorkspaceInitiative,
  optimistic: OptimisticInitiativePatch,
) {
  const incoming = timestampMillis(initiative.updated_at);
  const response = timestampMillis(optimistic.responseUpdatedAt);
  return incoming !== null && response !== null && incoming > response;
}

function initiativePatchProofOwner(optimistic: OptimisticInitiativePatch) {
  return optimistic.proofOwner ?? optimistic;
}

export function reconcileInitiativeSnapshot(
  incoming: WorkspaceInitiative[],
  workspaceId: string,
  optimisticCreate: WorkspaceInitiative | null,
  optimisticPatches: ReadonlyArray<readonly [string, OptimisticInitiativePatch]>,
  canonicalProofKey: string | null = null,
) {
  let next = incoming;
  let settledCreate: Readonly<{
    canonical: WorkspaceInitiative;
    optimistic: WorkspaceInitiative;
  }> | null = null;
  const settledPatches: Array<readonly [string, OptimisticInitiativePatch]> = [];
  const deferredPatches: Array<readonly [string, OptimisticInitiativePatch, OptimisticInitiativePatch]> = [];
  const conflictedPatches: Array<readonly [string, OptimisticInitiativePatch]> = [];

  if (optimisticCreate) {
    const committed = incoming.find((initiative) => (
      initiative.id === optimisticCreate.id
      || Boolean(
        optimisticCreate.client_nonce
        && initiative.client_nonce === optimisticCreate.client_nonce,
      )
    ));
    if (committed) {
      settledCreate = { canonical: committed, optimistic: optimisticCreate };
    } else {
      next = mergeInitiative(next, optimisticCreate);
    }
  }

  for (const [key, optimistic] of optimisticPatches) {
    if (optimistic.workspaceId !== workspaceId) continue;
    const initiative = next.find((item) => item.id === optimistic.initiativeId);
    if (initiative && initiativeMatchesPatch(initiative, optimistic.patch)) {
      settledPatches.push([key, optimistic]);
      continue;
    }
    if (
      initiative && optimistic.responseUpdatedAt !== undefined
      && initiativeSupersedesPatch(initiative, optimistic)
    ) {
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
        proofOwner: initiativePatchProofOwner(optimistic),
      };
      deferredPatches.push([key, optimistic, deferred]);
      next = mergeInitiative(next, {
        ...(initiative ?? optimistic.before),
        ...deferred.patch,
      });
      continue;
    }
    next = mergeInitiative(next, {
      ...(initiative ?? optimistic.before),
      ...optimistic.patch,
    });
  }

  return {
    conflictedPatches,
    deferredPatches,
    next,
    settledCreate,
    settledPatches,
  };
}

export function queueInitiativeCanonicalProof<T>(
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

type InitiativeSnapshotReconciliation = ReturnType<typeof reconcileInitiativeSnapshot>;

export async function runInitiativeCanonicalProof(
  initialEpoch: number,
  canonicalProofKey: string | null,
  activeEpoch: () => number | null,
  reconcile: (epoch: number) => Promise<InitiativeSnapshotReconciliation | null>,
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

export async function runInitiativeTwoReadCanonicalProof(
  initialEpoch: number,
  activeEpoch: () => number | null,
  reconcile: (epoch: number) => Promise<InitiativeSnapshotReconciliation | null>,
  isConfirmed: (result: InitiativeSnapshotReconciliation) => boolean,
) {
  const first = await runInitiativeCanonicalProof(initialEpoch, null, activeEpoch, reconcile);
  if (first.result === null || isConfirmed(first.result)) return first;
  return runInitiativeCanonicalProof(first.epoch, null, activeEpoch, reconcile);
}

export function reconciledInitiativeSelection(
  current: string | null,
  routeInitiativeId: string | null,
  reconciled: InitiativeSnapshotReconciliation,
) {
  if (routeInitiativeId && reconciled.next.some(({ id }) => id === routeInitiativeId)) {
    return routeInitiativeId;
  }
  if (reconciled.settledCreate && current === reconciled.settledCreate.optimistic.id) {
    return reconciled.settledCreate.canonical.id;
  }
  return reconciled.next.some(({ id }) => id === current)
    ? current
    : reconciled.next[0]?.id ?? null;
}

export function initiativeFailureBelongsToResource(
  key: string,
  workspaceId: string,
  initiativeId: string,
) {
  return key === `initiative:update:${workspaceId}:${initiativeId}` || [
    "attach-task",
    "detach-task",
    "attach-channel",
    "detach-channel",
  ].some((operation) => key.startsWith(`initiative:${operation}:${workspaceId}:${initiativeId}:`));
}

export function createInitiativeOptimisticMutationState() {
  const creates = new Map<string, WorkspaceInitiative>();
  const patches = new Map<string, OptimisticInitiativePatch>();
  const canonicalCreates = new WeakMap<WorkspaceInitiative, WorkspaceInitiative>();
  const canonicalPatches = new WeakSet<OptimisticInitiativePatch>();
  return {
    canonicalCreate: (optimistic: WorkspaceInitiative) => canonicalCreates.get(optimistic),
    canonicalPatchWasObserved: (optimistic: OptimisticInitiativePatch) => (
      canonicalPatches.has(initiativePatchProofOwner(optimistic))
    ),
    creates,
    patches,
    restorePatch(key: string, optimistic: OptimisticInitiativePatch,
      previous: OptimisticInitiativePatch | null = null) {
      const current = patches.get(key);
      if (!current || initiativePatchProofOwner(current) !== initiativePatchProofOwner(optimistic)) return false;
      if (previous) patches.set(key, previous);
      else patches.delete(key);
      return true;
    },
    reconcile(incoming: WorkspaceInitiative[], workspaceId: string, canonicalProofKey: string | null = null) {
      const reconciled = reconcileInitiativeSnapshot(
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
        canonicalPatches.add(initiativePatchProofOwner(optimistic));
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

export function invalidateInitiativeQueries(workspaceId: string) {
  invalidateQueries(`/workspaces/${workspaceId}/initiatives`);
  invalidateQueries(`/workspaces/${workspaceId}/tasks`);
}

export function quietMomentum() {
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

export function sortInitiatives(initiatives: WorkspaceInitiative[]) {
  const statusOrder: Record<WorkspaceInitiativeStatus, number> = {
    focused: 0,
    active: 1,
    at_risk: 2,
    draft: 3,
    complete: 4,
  };
  return [...initiatives].sort((a, b) => {
    const order = (statusOrder[a.status] ?? 99) - (statusOrder[b.status] ?? 99);
    if (order) return order;
    return new Date(b.updated_at || b.created_at || 0).getTime()
      - new Date(a.updated_at || a.created_at || 0).getTime();
  });
}

export function initiativeMomentumSummary(initiative: WorkspaceInitiative | null) {
  if (!initiative) return null;
  const { health, open_task_count, complete_task_count, blocked_task_count } = initiative.momentum;
  if (health === "blocked_execution" || blocked_task_count > 0) return { label: "Blocked", color: "text-amber-300", description: "Strategic progress is currently impeded by operational blockers." };
  if (health === "active_movement" || open_task_count > 0) return { label: "Moving", color: "text-cyan-300", description: "Operational execution is actively advancing the initiative mission." };
  if (health === "completion_flow" || (complete_task_count > 0 && open_task_count === 0)) return { label: "Complete", color: "text-emerald-300", description: "The defined mission has reached its completion state." };
  return { label: "Quiet", color: "text-[var(--omnix-text-3)]", description: "No active operational movement detected for this mission." };
}

export function initiativeProgress(initiative: WorkspaceInitiative | null) {
  if (!initiative?.momentum.task_count) return 0;
  return Math.round(
    (initiative.momentum.complete_task_count / initiative.momentum.task_count) * 100,
  );
}
