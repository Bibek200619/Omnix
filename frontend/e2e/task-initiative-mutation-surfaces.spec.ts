import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { optimisticValueEqual } from "../components/shared/optimisticValueEqual";
import {
  confirmedTaskPatch,
  createTaskOptimisticMutationState,
  queueTaskCanonicalProof,
  reconcileTaskSnapshot,
  runTaskCanonicalProof,
  runTaskTwoReadCanonicalProof,
} from "../components/tasks/taskSurfaceModel";
import {
  confirmedInitiativePatch,
  createInitiativeBusyOwnership,
  createInitiativeOptimisticMutationState,
  initiativeFailureBelongsToResource,
  queueInitiativeCanonicalProof,
  reconcileInitiativeSnapshot,
  reconciledInitiativeSelection,
  runInitiativeCanonicalProof,
  runInitiativeTwoReadCanonicalProof,
} from "../components/initiatives/initiativeSurfaceModel";
import type { WorkspaceInitiative, WorkspaceTask } from "../lib/workspace-types";

const taskSurface = readFileSync(
  resolve(__dirname, "../components/tasks/WorkspaceTasksSurface.tsx"),
  "utf-8",
);
const taskSurfaceModel = readFileSync(
  resolve(__dirname, "../components/tasks/taskSurfaceModel.ts"),
  "utf-8",
);
const taskList = readFileSync(
  resolve(__dirname, "../components/tasks/TaskList.tsx"),
  "utf-8",
);
const taskCard = readFileSync(
  resolve(__dirname, "../components/tasks/TaskCard.tsx"),
  "utf-8",
);
const taskCreateForm = readFileSync(
  resolve(__dirname, "../components/tasks/TaskCreateForm.tsx"),
  "utf-8",
);
const initiativeSurface = readFileSync(
  resolve(__dirname, "../components/initiatives/WorkspaceInitiativesSurface.tsx"),
  "utf-8",
);
const initiativeSurfaceModel = readFileSync(
  resolve(__dirname, "../components/initiatives/initiativeSurfaceModel.ts"),
  "utf-8",
);
const initiativeCreateForm = readFileSync(
  resolve(__dirname, "../components/initiatives/InitiativeCreateForm.tsx"),
  "utf-8",
);
const initiativeDetail = readFileSync(
  resolve(__dirname, "../components/initiatives/InitiativeDetailPanel.tsx"),
  "utf-8",
);

function section(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  expect(startIndex, `missing section start: ${start}`).toBeGreaterThanOrEqual(0);
  expect(endIndex, `missing section end: ${end}`).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

function occurrences(source: string, value: string) {
  return source.split(value).length - 1;
}

function taskRecord(overrides: Partial<WorkspaceTask> = {}): WorkspaceTask {
  return {
    id: "task-one",
    workspace_id: "workspace-one",
    title: "Canonical task",
    status: "active",
    created_by: "user-one",
    blockers: [],
    linked_context: [],
    activity_metadata: {},
    momentum_metadata: {},
    linked_decisions: [],
    updated_at: "2026-08-21T10:00:00.000Z",
    ...overrides,
  };
}

function initiativeRecord(
  overrides: Partial<WorkspaceInitiative> = {},
): WorkspaceInitiative {
  return {
    id: "initiative-one",
    workspace_id: "workspace-one",
    title: "Canonical initiative",
    status: "active",
    linked_resources: [],
    activity_metadata: {},
    linked_tasks: [],
    linked_channels: [],
    linked_decisions: [],
    momentum: {
      health: "quiet",
      summary: "Quiet",
      task_count: 0,
      open_task_count: 0,
      complete_task_count: 0,
      blocked_task_count: 0,
      due_soon_count: 0,
      overdue_count: 0,
      channel_count: 0,
      discussion_message_count: 0,
      last_movement_at: null,
    },
    updated_at: "2026-08-21T10:00:00.000Z",
    ...overrides,
  };
}

test("task create and patch lifecycles are synchronously scoped and reconciliation-safe", () => {
  const workspaceScope = section(
    taskSurface,
    "useLayoutEffect(() => {\n    if (workspaceRef.current === activeWorkspaceId)",
    "const isCurrentWorkspaceMutation",
  );
  const taskLoader = section(
    taskSurface,
    "const loadExecution = useCallback",
    "const reconcileTaskMutation",
  );
  const reconciliation = section(
    taskSurface,
    "const reconcileTaskMutation",
    "useEffect(() => {\n    setCreating(false);",
  );
  const createTask = section(
    taskSurface,
    "async function createTask",
    "async function patchTask",
  );
  const patchTask = section(
    taskSurface,
    "async function patchTask",
    "function addBlocker",
  );
  const addBlocker = section(
    taskSurface,
    "function addBlocker",
    "if (!activeWorkspaceId) {\n    return (",
  );
  const workspaceReset = section(
    taskSurface,
    "useEffect(() => {\n    setCreating(false);",
    "useEffect(() => {\n    if (routeCreateTask)",
  );

  expect(createTask).toContain("const mutationKey = `task:create:${requestWorkspaceId}`");
  expect(createTask.indexOf("mutationRegistryRef.current.has(mutationKey)"))
    .toBeLessThan(createTask.indexOf("mutationAttempt(createAttemptsRef.current.get(requestWorkspaceId)"));
  expect(createTask).toContain("client_nonce: attempt.nonce");
  expect(createTask).toContain("created.client_nonce !== attempt.nonce");
  expect(createTask).toContain("created.workspace_id !== requestWorkspaceId");
  expect(createTask).toContain("await proveTaskMutation(requestWorkspaceId, requestWorkspaceEpoch)");
  expect(createTask).toContain("await runTaskTwoReadCanonicalProof(");
  expect(createTask.indexOf("await proveTaskMutation(requestWorkspaceId, requestWorkspaceEpoch)"))
    .toBeLessThan(createTask.indexOf("canonicalCreate(optimistic)"));
  expect(createTask).toContain("current.filter((task) => task.id !== optimistic.id)");
  expect(createTask).toContain("optimisticState.creates.set(requestWorkspaceId, optimistic)");
  expect(createTask).toContain("optimisticState.creates.set(requestWorkspaceId, created)");
  expect(taskLoader).toContain("optimisticState.reconcile(incomingTasks, activeWorkspaceId)");
  expect(taskLoader).toContain("setLoadError(null)");
  expect(taskSurfaceModel).toContain(
    "task.client_nonce === optimisticCreate.client_nonce",
  );
  expect(taskSurfaceModel).toContain("settledCreate = { canonical: committed, optimistic: optimisticCreate }");
  expect(taskSurfaceModel).toContain("} else {\n      next = mergeTask(next, optimisticCreate);");

  expect(taskSurface).not.toContain("renderedWorkspaceRef");
  expect(occurrences(taskSurface, "workspaceRef.current = activeWorkspaceId")).toBe(1);
  expect(workspaceScope).toContain("workspaceRef.current = activeWorkspaceId");
  expect(workspaceScope).toContain("releaseExclusiveMutations(mutationRegistryRef.current");
  expect(workspaceScope).toContain("key === `task:create:${previousWorkspaceId}`");
  expect(workspaceScope).not.toContain("task:update:");
  expect(taskSurface).toContain("workspaceEpochRef.current === workspaceEpoch");
  expect(taskSurface).toContain("mountedRef.current && workspaceRef.current === workspaceId");
  expect(taskSurface).not.toContain("mutationRegistryRef.current.clear()");
  expect(reconciliation).toContain("queueTaskCanonicalProof(canonicalRefreshRegistryRef.current");
  expect(reconciliation).toContain("apiClient.get<WorkspaceTask[]>");
  expect(reconciliation).toContain("{ dedupe: false }");
  expect(reconciliation).toContain("workspaceEpochRef.current === workspaceEpoch");
  expect(reconciliation.indexOf("if (!isCurrent()) return null;"))
    .toBeLessThan(reconciliation.indexOf("optimisticState.reconcile(incoming, workspaceId, canonicalProofKey)"));
  expect(reconciliation).toContain("invalidateTaskQueries(workspaceId)");
  expect(reconciliation).toContain("mountedRef.current && workspaceRef.current === workspaceId");
  expect(reconciliation).toContain("requestRef.current += 1");
  expect(workspaceReset).not.toContain("createAttemptsRef.current.clear()");
  expect(workspaceReset).toContain("setCreating(false)");
  expect(workspaceReset).toContain("setUpdatingIds(new Set())");
  expect(workspaceReset).toContain("setLoadError(null)");
  expect(workspaceReset).toContain("resetMutationFailures()");
  expect(workspaceReset).toContain("setCreateOpen(false)");
  expect(taskSurfaceModel).toContain("recordOwnedMutationFailure");
  expect(taskSurfaceModel).toContain("resolveOwnedMutationFailure");
  expect(taskSurfaceModel).toContain("if (requestRef.current) return;");
  expect(taskSurfaceModel).toContain("requestRef.current === request");
  expect(taskSurfaceModel).toContain("resolveMutationFailure(failure.key, failure.token)");
  expect(taskSurfaceModel).toContain("clearAssistanceFailure();");

  expect(patchTask).toContain("const mutationKey = `task:update:${requestWorkspaceId}:${requestTaskId}`");
  expect(patchTask).toContain("if (mutationRegistryRef.current.has(mutationKey))");
  expect(patchTask).not.toContain("if (updating");
  expect(patchTask).toContain("new Set(current).add(requestTaskId)");
  expect(patchTask).toContain("rollbackOptimisticPatch(item, before, optimisticPatch)");
  expect(patchTask).toContain("optimisticState.patches.set(mutationKey, optimistic)");
  expect(patchTask).toContain("confirmedTaskPatch(optimistic, updated)");
  expect(patchTask).toContain(
    "patch: { ...previousOptimistic?.patch, ...optimisticPatch }",
  );
  expect(patchTask).toContain("optimisticState.restorePatch(mutationKey, optimistic, previousOptimistic ?? null)");
  expect(patchTask).toContain("reconciled?.conflictedPatches.some(([key]) => key === mutationKey)");
  expect(patchTask).toContain("TASK_PATCH_SYNC_WARNING");
  expect(taskSurfaceModel).toContain("taskMatchesPatch(task, optimistic.patch)");
  expect(taskSurfaceModel).toContain("incoming > response");
  expect(taskSurfaceModel).toContain("if (misses >= 2)");
  expect(taskSurfaceModel).toContain(
    "next = mergeTask(next, { ...(task ?? optimistic.before), ...optimistic.patch })",
  );
  expect(patchTask).toContain("await proveTaskMutation(");
  expect(patchTask.indexOf("await proveTaskMutation("))
    .toBeLessThan(patchTask.indexOf("canonicalPatchWasObserved(optimistic)"));
  expect(taskList).toContain("updatingIds: ReadonlySet<string>");
  expect(taskList).toContain("updating={updatingIds.has(task.id)}");
  expect(addBlocker).toContain("isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch)");
  expect(taskCard).toMatch(/disabled=\{updating\}\s+onClick=\{\(\) => onPatchTask/);
  expect(taskCard).toMatch(/value=\{blockerDraft\}\s+disabled=\{updating\}/);
  expect(occurrences(taskCreateForm, "disabled={creating}")).toBe(8);
  expect(taskCreateForm).toContain("disabled={creating || !title.trim()}");
  expect(taskSurface).toContain('<Button size="sm" disabled={creating}');
});

test("initiative mutations guard workspace and selection while reconciling canonically", () => {
  const workspaceScope = section(
    initiativeSurface,
    "useLayoutEffect(() => {\n    if (workspaceRef.current === activeWorkspaceId)",
    "const isCurrentWorkspaceMutation",
  );
  const selectionScope = section(
    initiativeSurface,
    "const selectedInitiativeRef",
    "const isCurrentInitiativeMutation",
  );
  const initiativeLoader = section(
    initiativeSurface,
    "const loadInitiatives =",
    "const reconcileInitiativeMutation",
  );
  const reconciliation = section(
    initiativeSurface,
    "const reconcileInitiativeMutation",
    "const scheduleRefresh",
  );
  const createInitiative = section(
    initiativeSurface,
    "async function createInitiative",
    "async function patchInitiative",
  );
  const patchInitiative = section(
    initiativeSurface,
    "async function patchInitiative",
    "async function mutateInitiativeLink",
  );
  const linkMutations = section(
    initiativeSurface,
    "async function mutateInitiativeLink",
    "async function addResource",
  );
  const addResource = section(
    initiativeSurface,
    "async function addResource",
    "\n  if (!activeWorkspaceId) {\n    return (",
  );
  const workspaceReset = section(
    initiativeSurface,
    "useEffect(() => {\n    setCreating(false);",
    "useEffect(() => {\n    if (routeCreateInitiative)",
  );

  expect(createInitiative).toContain("const mutationKey = `initiative:create:${requestWorkspaceId}`");
  expect(createInitiative.indexOf("mutationRegistryRef.current.has(mutationKey)"))
    .toBeLessThan(createInitiative.indexOf("mutationAttempt(createAttemptsRef.current.get(requestWorkspaceId)"));
  expect(createInitiative).toContain("client_nonce: attempt.nonce");
  expect(createInitiative).toContain("created.client_nonce !== attempt.nonce");
  expect(createInitiative).toContain("await proveInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch)");
  expect(createInitiative).toContain("await runInitiativeTwoReadCanonicalProof(");
  expect(createInitiative.indexOf("await proveInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch)"))
    .toBeLessThan(createInitiative.indexOf("canonicalCreate(optimistic)"));
  expect(createInitiative).toContain("completeVisibleInitiativeCreate(created, optimistic.id)");
  expect(createInitiative).not.toContain("setSelectedId(created.id)");
  expect(createInitiative).toContain("current.filter((initiative) => initiative.id !== optimistic.id)");
  expect(createInitiative).toContain("optimisticState.creates.set(requestWorkspaceId, optimistic)");
  expect(createInitiative).toContain("optimisticState.creates.set(requestWorkspaceId, created)");
  expect(initiativeLoader).toContain("optimisticState.reconcile(incoming, activeWorkspaceId)");
  expect(initiativeLoader).toContain("setLoadError(null)");
  expect(initiativeSurfaceModel).toContain(
    "initiative.client_nonce === optimisticCreate.client_nonce",
  );
  expect(initiativeSurfaceModel).toContain("settledCreate = { canonical: committed, optimistic: optimisticCreate }");
  expect(initiativeSurfaceModel).toContain("} else {\n      next = mergeInitiative(next, optimisticCreate);");

  expect(initiativeSurface).not.toContain("renderedWorkspaceRef");
  expect(occurrences(initiativeSurface, "workspaceRef.current = activeWorkspaceId")).toBe(1);
  expect(workspaceScope).toContain("workspaceRef.current = activeWorkspaceId");
  expect(workspaceScope).toContain("releaseExclusiveMutations(");
  expect(workspaceScope).toContain("key === `initiative:create:${previousWorkspaceId}`");
  expect(workspaceScope).not.toContain("initiative:update:");
  expect(selectionScope).toContain("const selectInitiative = useCallback");
  expect(selectionScope).toContain("selectedInitiativeRef.current = next");
  expect(selectionScope).toContain("initiativeFailureBelongsToResource");
  expect(selectionScope).toContain("clearUpdating()");
  expect(initiativeSurface).toContain("workspaceEpochRef.current === workspaceEpoch");
  expect(initiativeSurface).toContain("mountedRef.current && workspaceRef.current === workspaceId");
  expect(initiativeSurface).toContain("selectedInitiativeRef.current === initiativeId");
  expect(initiativeSurface).not.toContain("mutationRegistryRef.current.clear()");
  expect(reconciliation).toContain("queueInitiativeCanonicalProof(canonicalRefreshRegistryRef.current");
  expect(reconciliation).toContain("apiClient.get<WorkspaceInitiative[]>");
  expect(reconciliation).toContain("{ dedupe: false }");
  expect(reconciliation).toContain("workspaceEpochRef.current === workspaceEpoch");
  expect(reconciliation.indexOf("if (!isCurrent()) return null;"))
    .toBeLessThan(reconciliation.indexOf("optimisticState.reconcile(incoming, workspaceId, canonicalProofKey)"));
  expect(reconciliation).toContain("invalidateInitiativeQueries(workspaceId)");
  expect(reconciliation).toContain("mountedRef.current && workspaceRef.current === workspaceId");
  expect(reconciliation).toContain("requestRef.current += 1");
  expect(workspaceReset).not.toContain("createAttemptsRef.current.clear()");
  expect(workspaceReset).toContain("setCreating(false)");
  expect(workspaceReset).toContain("clearUpdating()");
  expect(workspaceReset).toContain("setLoadError(null)");
  expect(workspaceReset).toContain("resetMutationFailures()");
  expect(initiativeSurfaceModel).toContain("recordOwnedMutationFailure");
  expect(initiativeSurfaceModel).toContain("resolveOwnedMutationFailure");

  expect(patchInitiative).toContain("): Promise<boolean>");
  expect(patchInitiative).toContain("const mutationKey = `initiative:update:${requestWorkspaceId}:${requestInitiativeId}`");
  expect(patchInitiative).toContain("rollbackOptimisticPatch(item, before, optimisticPatch)");
  expect(patchInitiative).toContain("return true");
  expect(patchInitiative).toContain("return false");
  expect(patchInitiative).toContain("optimisticState.patches.set(mutationKey, optimistic)");
  expect(patchInitiative).toContain("confirmedInitiativePatch(optimistic, changed)");
  expect(patchInitiative).toContain(
    "patch: { ...previousOptimistic?.patch, ...optimisticPatch }",
  );
  expect(patchInitiative).toContain("optimisticState.restorePatch(mutationKey, optimistic, previousOptimistic ?? null)");
  expect(patchInitiative).toContain("reconciled?.conflictedPatches.some(([key]) => key === mutationKey)");
  expect(patchInitiative).toContain("INITIATIVE_PATCH_SYNC_WARNING");
  expect(initiativeSurfaceModel).toContain(
    "initiativeMatchesPatch(initiative, optimistic.patch)",
  );
  expect(initiativeSurfaceModel).toContain("incoming > response");
  expect(initiativeSurfaceModel).toContain("if (misses >= 2)");
  expect(initiativeSurfaceModel).toContain("...(initiative ?? optimistic.before)");
  expect(patchInitiative).toContain("await proveInitiativeMutation(");
  expect(patchInitiative.indexOf("await proveInitiativeMutation("))
    .toBeLessThan(patchInitiative.indexOf("canonicalPatchWasObserved(optimistic)"));

  expect(occurrences(linkMutations, "const mutationKey = `initiative:update:${requestWorkspaceId}:${requestInitiativeId}`")).toBe(1);
  expect(occurrences(linkMutations, "mutationRegistryRef.current.has(mutationKey)")).toBe(1);
  expect(occurrences(linkMutations, "scheduleInitiativeReconciliation(requestWorkspaceId, requestWorkspaceEpoch)")).toBe(1);
  expect(linkMutations).toContain("await runInitiativeTwoReadCanonicalProof(");
  expect(linkMutations.indexOf("await runInitiativeTwoReadCanonicalProof("))
    .toBeLessThan(linkMutations.indexOf("failMutation(failureKey, mutationToken, errorMessage)"));
  expect(linkMutations).toContain("resolveMutationFailure(failureKey, mutationToken)");
  expect(linkMutations).toContain("finishUpdating(updatingOwner, mountedRef.current)");
  expect(linkMutations).not.toMatch(/item\.id === requestInitiativeId\s*\?\s*changed\s*:\s*item/);

  expect(addResource).toContain("const succeeded = await patchInitiative");
  expect(addResource).toContain("isCurrentInitiativeMutation(");
  expect(addResource.indexOf("setResourceId(\"\")"))
    .toBeGreaterThan(addResource.indexOf("isCurrentInitiativeMutation("));
  expect(initiativeSurface).toContain("selectInitiative(null)");
  expect(initiativeSurface).toContain("abandonAssistance()");
  expect(initiativeSurfaceModel).toContain("if (requestRef.current) return;");
  expect(initiativeSurfaceModel).toContain("requestRef.current === request");
  expect(initiativeSurfaceModel).toContain("selectedInitiativeRef.current === initiativeId");
  expect(initiativeSurfaceModel).toContain("resolveMutationFailure(failure.key, failure.token)");
  expect(initiativeSurfaceModel).toContain("clearAssistanceFailure();");
});

test("task canonical proof preserves one stale snapshot and accepts strict supersession", () => {
  const before = taskRecord();
  const response = taskRecord({
    status: "planned",
    updated_at: "2026-08-21T10:01:00.000Z",
  });
  const optimistic = confirmedTaskPatch({
    before,
    patch: { status: "planned" },
    taskId: before.id,
    workspaceId: before.workspace_id,
  }, response);
  const first = reconcileTaskSnapshot(
    [before],
    before.workspace_id,
    null,
    [["task-key", optimistic]],
    "task-key",
  );

  expect(first.next[0].status).toBe("planned");
  expect(first.deferredPatches).toHaveLength(1);
  expect(first.conflictedPatches).toHaveLength(0);

  const superseding = taskRecord({
    status: "review",
    updated_at: "2026-08-21T10:02:00.000Z",
  });
  const second = reconcileTaskSnapshot(
    [superseding],
    before.workspace_id,
    null,
    [["task-key", first.deferredPatches[0][2]]],
    "task-key",
  );
  expect(second.next[0]).toBe(superseding);
  expect(second.settledPatches).toHaveLength(1);
  expect(second.conflictedPatches).toHaveLength(0);
});

test("task canonical proof retires repeated stale data without masking it", () => {
  const before = taskRecord();
  const response = taskRecord({
    status: "planned",
    updated_at: "2026-08-21T10:01:00.000Z",
  });
  const optimistic = confirmedTaskPatch({
    before,
    patch: { status: "planned" },
    taskId: before.id,
    workspaceId: before.workspace_id,
  }, response);
  const first = reconcileTaskSnapshot(
    [before], before.workspace_id, null, [["task-key", optimistic]], "task-key",
  );
  const second = reconcileTaskSnapshot(
    [before], before.workspace_id, null,
    [["task-key", first.deferredPatches[0][2]]], "task-key",
  );

  expect(second.conflictedPatches).toHaveLength(1);
  expect(second.next[0]).toBe(before);
  expect(second.next[0].status).toBe("active");
});

test("initiative canonical proof bounds missing timestamps and preserves canonical data", () => {
  const before = initiativeRecord({ updated_at: null });
  const response = initiativeRecord({ status: "at_risk", updated_at: null });
  const optimistic = confirmedInitiativePatch({
    before,
    initiativeId: before.id,
    patch: { status: "at_risk" },
    workspaceId: before.workspace_id,
  }, response);
  const first = reconcileInitiativeSnapshot(
    [before], before.workspace_id, null, [["initiative-key", optimistic]], "initiative-key",
  );
  expect(first.next[0].status).toBe("at_risk");
  expect(first.deferredPatches).toHaveLength(1);

  const canonical = initiativeRecord({ status: "complete", updated_at: null });
  const second = reconcileInitiativeSnapshot(
    [canonical], before.workspace_id, null,
    [["initiative-key", first.deferredPatches[0][2]]], "initiative-key",
  );
  expect(second.conflictedPatches).toHaveLength(1);
  expect(second.next[0]).toBe(canonical);
  expect(second.next[0].status).toBe("complete");
});

test("canonical proof queues serialize distinct reads instead of sharing an in-flight result", async () => {
  const taskTails = new Map<string, Promise<void>>();
  const initiativeTails = new Map<string, Promise<void>>();
  const events: string[] = [];
  let markFirstStarted!: () => void;
  const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
  const first = queueTaskCanonicalProof(taskTails, "workspace-one", async () => {
    events.push("task:first:start");
    markFirstStarted();
    await firstGate;
    events.push("task:first:end");
    return "first";
  });
  const second = queueTaskCanonicalProof(taskTails, "workspace-one", async () => {
    events.push("task:second");
    return "second";
  });

  await firstStarted;
  expect(events).toEqual(["task:first:start"]);
  releaseFirst();
  await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
  expect(events).toEqual(["task:first:start", "task:first:end", "task:second"]);

  const initiativeResults = await Promise.all([
    queueInitiativeCanonicalProof(initiativeTails, "workspace-one", async () => "one"),
    queueInitiativeCanonicalProof(initiativeTails, "workspace-one", async () => "two"),
  ]);
  expect(initiativeResults).toEqual(["one", "two"]);
  await Promise.resolve();
  expect(taskTails.size).toBe(0);
  expect(initiativeTails.size).toBe(0);
});

test("canonical proofs follow an A-B-A replacement epoch before committing snapshots", async () => {
  const taskEpochs: number[] = [];
  const taskSnapshot = reconcileTaskSnapshot(
    [taskRecord()], "workspace-one", null, [],
  );
  const taskProof = await runTaskCanonicalProof(
    1,
    null,
    () => 3,
    async (epoch) => {
      taskEpochs.push(epoch);
      return epoch === 1 ? null : taskSnapshot;
    },
  );
  expect(taskEpochs).toEqual([1, 3]);
  expect(taskProof).toEqual({ epoch: 3, result: taskSnapshot });

  const initiativeEpochs: number[] = [];
  const initiativeSnapshot = reconcileInitiativeSnapshot(
    [initiativeRecord()], "workspace-one", null, [],
  );
  const initiativeProof = await runInitiativeCanonicalProof(
    4,
    null,
    () => 6,
    async (epoch) => {
      initiativeEpochs.push(epoch);
      return epoch === 4 ? null : initiativeSnapshot;
    },
  );
  expect(initiativeEpochs).toEqual([4, 6]);
  expect(initiativeProof).toEqual({ epoch: 6, result: initiativeSnapshot });
});

test("task response-loss proof spends two reads only on the requesting patch", async () => {
  const primary = taskRecord();
  const secondary = taskRecord({ id: "task-two", title: "Second task" });
  const state = createTaskOptimisticMutationState();
  state.patches.set("primary", {
    before: primary,
    patch: { status: "planned" },
    taskId: primary.id,
    workspaceId: primary.workspace_id,
  });
  state.patches.set("secondary", {
    before: secondary,
    patch: { title: "Optimistic second task" },
    taskId: secondary.id,
    workspaceId: secondary.workspace_id,
  });
  let reads = 0;
  const { result } = await runTaskCanonicalProof(
    8,
    "primary",
    () => 8,
    async () => {
      reads += 1;
      return state.reconcile([primary, secondary], primary.workspace_id, "primary");
    },
  );

  expect(reads).toBe(2);
  expect(result).not.toBeNull();
  if (!result) throw new Error("Expected a task canonical proof result");
  expect(result.conflictedPatches.map(([key]) => key)).toEqual(["primary"]);
  expect(result.next.find(({ id }) => id === primary.id)).toBe(primary);
  expect(result.next.find(({ id }) => id === secondary.id)?.title).toBe("Optimistic second task");
  expect(state.patches.has("primary")).toBe(false);
  expect(state.patches.get("secondary")?.canonicalProofMisses).toBeUndefined();
});

test("initiative response-loss proof retires repeated mismatch to canonical selection", async () => {
  const removed = initiativeRecord();
  const canonical = initiativeRecord({ id: "initiative-two", title: "Canonical fallback" });
  const state = createInitiativeOptimisticMutationState();
  state.patches.set("removed", {
    before: removed,
    initiativeId: removed.id,
    patch: { status: "at_risk" },
    workspaceId: removed.workspace_id,
  });
  let reads = 0;
  const { result } = await runInitiativeCanonicalProof(
    2,
    "removed",
    () => 2,
    async () => {
      reads += 1;
      return state.reconcile([canonical], removed.workspace_id, "removed");
    },
  );

  expect(reads).toBe(2);
  expect(result).not.toBeNull();
  if (!result) throw new Error("Expected an initiative canonical proof result");
  expect(result.conflictedPatches.map(([key]) => key)).toEqual(["removed"]);
  expect(result.next).toEqual([canonical]);
  expect(reconciledInitiativeSelection(removed.id, null, result)).toBe(canonical.id);
});

test("stale then exact response-loss proofs settle the original patch owners", () => {
  const taskBefore = taskRecord();
  const taskState = createTaskOptimisticMutationState();
  const taskOptimistic = {
    before: taskBefore,
    patch: { status: "planned" as const },
    taskId: taskBefore.id,
    workspaceId: taskBefore.workspace_id,
  };
  taskState.patches.set("task-key", taskOptimistic);
  taskState.reconcile([taskBefore], taskBefore.workspace_id, "task-key");
  expect(taskState.patches.get("task-key")).not.toBe(taskOptimistic);
  taskState.reconcile(
    [taskRecord({ status: "planned" })], taskBefore.workspace_id, "task-key",
  );
  expect(taskState.canonicalPatchWasObserved(taskOptimistic)).toBe(true);
  expect(taskState.patches.has("task-key")).toBe(false);

  const initiativeBefore = initiativeRecord();
  const initiativeState = createInitiativeOptimisticMutationState();
  const initiativeOptimistic = {
    before: initiativeBefore,
    initiativeId: initiativeBefore.id,
    patch: { status: "at_risk" as const },
    workspaceId: initiativeBefore.workspace_id,
  };
  initiativeState.patches.set("initiative-key", initiativeOptimistic);
  initiativeState.reconcile(
    [initiativeBefore], initiativeBefore.workspace_id, "initiative-key",
  );
  expect(initiativeState.patches.get("initiative-key")).not.toBe(initiativeOptimistic);
  initiativeState.reconcile(
    [initiativeRecord({ status: "at_risk" })], initiativeBefore.workspace_id, "initiative-key",
  );
  expect(initiativeState.canonicalPatchWasObserved(initiativeOptimistic)).toBe(true);
  expect(initiativeState.patches.has("initiative-key")).toBe(false);
});

test("second-read errors retire deferred patch overlays in both domains", async () => {
  const taskBefore = taskRecord();
  const taskState = createTaskOptimisticMutationState();
  const taskOptimistic = {
    before: taskBefore,
    patch: { status: "planned" as const },
    taskId: taskBefore.id,
    workspaceId: taskBefore.workspace_id,
  };
  taskState.patches.set("task-key", taskOptimistic);
  let taskReads = 0;
  await expect(runTaskCanonicalProof(1, "task-key", () => 1, async () => {
    taskReads += 1;
    if (taskReads === 2) throw new Error("second task read failed");
    return taskState.reconcile([taskBefore], taskBefore.workspace_id, "task-key");
  })).rejects.toThrow("second task read failed");
  expect(taskState.restorePatch("task-key", taskOptimistic)).toBe(true);
  expect(taskState.reconcile([taskBefore], taskBefore.workspace_id).next[0]).toBe(taskBefore);

  const initiativeBefore = initiativeRecord();
  const initiativeState = createInitiativeOptimisticMutationState();
  const initiativeOptimistic = {
    before: initiativeBefore,
    initiativeId: initiativeBefore.id,
    patch: { status: "at_risk" as const },
    workspaceId: initiativeBefore.workspace_id,
  };
  initiativeState.patches.set("initiative-key", initiativeOptimistic);
  let initiativeReads = 0;
  await expect(runInitiativeCanonicalProof(1, "initiative-key", () => 1, async () => {
    initiativeReads += 1;
    if (initiativeReads === 2) throw new Error("second initiative read failed");
    return initiativeState.reconcile(
      [initiativeBefore], initiativeBefore.workspace_id, "initiative-key",
    );
  })).rejects.toThrow("second initiative read failed");
  expect(initiativeState.restorePatch("initiative-key", initiativeOptimistic)).toBe(true);
  expect(initiativeState.reconcile(
    [initiativeBefore], initiativeBefore.workspace_id,
  ).next[0]).toBe(initiativeBefore);
});

test("response-loss create proofs require a second nonce snapshot in both domains", async () => {
  const taskState = createTaskOptimisticMutationState();
  const pendingTask = taskRecord({ id: "pending-task", client_nonce: "task-nonce" });
  const canonicalTask = taskRecord({ id: "canonical-task", client_nonce: "task-nonce" });
  taskState.creates.set(pendingTask.workspace_id, pendingTask);
  let taskReads = 0;
  await runTaskTwoReadCanonicalProof(
    1,
    () => 1,
    async () => taskState.reconcile(
      ++taskReads === 1 ? [] : [canonicalTask], pendingTask.workspace_id,
    ),
    () => Boolean(taskState.canonicalCreate(pendingTask)),
  );
  expect(taskReads).toBe(2);
  expect(taskState.canonicalCreate(pendingTask)).toBe(canonicalTask);

  const initiativeState = createInitiativeOptimisticMutationState();
  const pendingInitiative = initiativeRecord({
    id: "pending-initiative", client_nonce: "initiative-nonce",
  });
  const canonicalInitiative = initiativeRecord({
    id: "canonical-initiative", client_nonce: "initiative-nonce",
  });
  initiativeState.creates.set(pendingInitiative.workspace_id, pendingInitiative);
  let initiativeReads = 0;
  await runInitiativeTwoReadCanonicalProof(
    1,
    () => 1,
    async () => initiativeState.reconcile(
      ++initiativeReads === 1 ? [] : [canonicalInitiative], pendingInitiative.workspace_id,
    ),
    () => Boolean(initiativeState.canonicalCreate(pendingInitiative)),
  );
  expect(initiativeReads).toBe(2);
  expect(initiativeState.canonicalCreate(pendingInitiative)).toBe(canonicalInitiative);
});

test("initiative link proof waits for canonical state and busy ownership cannot clear a successor", async () => {
  const linkedTask = taskRecord();
  const stale = initiativeRecord();
  const linked = initiativeRecord({ linked_tasks: [linkedTask] });
  let reads = 0;
  const proof = await runInitiativeTwoReadCanonicalProof(
    1,
    () => 1,
    async () => reconcileInitiativeSnapshot(
      [++reads === 1 ? stale : linked], stale.workspace_id, null, [],
    ),
    ({ next }) => next.some((initiative) => initiative.linked_tasks.some(
      ({ id }) => id === linkedTask.id,
    )),
  );
  expect(reads).toBe(2);
  expect(proof.result?.next[0]).toBe(linked);

  const busyEvents: boolean[] = [];
  const ownership = createInitiativeBusyOwnership((busy) => busyEvents.push(busy));
  const displaced = ownership.begin();
  ownership.clear();
  const current = ownership.begin();
  expect(ownership.finish(displaced)).toBe(false);
  expect(ownership.finish(current)).toBe(true);
  expect(busyEvents).toEqual([true, false, true, false]);
});

test("initiative failure cleanup matches only the displaced resource", () => {
  expect(initiativeFailureBelongsToResource(
    "initiative:update:workspace-one:initiative-one", "workspace-one", "initiative-one",
  )).toBe(true);
  expect(initiativeFailureBelongsToResource(
    "initiative:detach-channel:workspace-one:initiative-one:channel-one",
    "workspace-one", "initiative-one",
  )).toBe(true);
  expect(initiativeFailureBelongsToResource(
    "initiative:create:workspace-one", "workspace-one", "initiative-one",
  )).toBe(false);
  expect(initiativeFailureBelongsToResource(
    "initiative:update:workspace-one:initiative-two", "workspace-one", "initiative-one",
  )).toBe(false);
});

test("optimistic JSON equality ignores nested object insertion order", () => {
  expect(optimisticValueEqual(
    [{ metadata: { priority: "high", labels: { team: "core", lane: 2 } } }],
    [{ metadata: { labels: { lane: 2, team: "core" }, priority: "high" } }],
  )).toBe(true);
  expect(optimisticValueEqual(
    [{ metadata: { labels: ["core", "urgent"] } }],
    [{ metadata: { labels: ["urgent", "core"] } }],
  )).toBe(false);
});

test("every initiative mutation control is disabled while an update is pending", () => {
  expect(initiativeSurface).toContain('disabled={updating || creating}');
  expect(initiativeSurface).toContain("disabled={updating}");
  expect(occurrences(initiativeCreateForm, "disabled={disabled || creating}")).toBe(5);
  expect(initiativeCreateForm).toContain("disabled={disabled || !title.trim()}");

  expect(initiativeDetail).toMatch(/value=\{selected\.status\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/value=\{selected\.owner_user_id \|\| ""\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/value=\{selected\.target_date \|\| ""\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/value=\{taskToAttach\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/type="button" disabled=\{updating\} onClick=\{\(\) => onDetachTask/);
  expect(initiativeDetail).toMatch(/value=\{channelToAttach\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/type="button" disabled=\{updating\} onClick=\{\(\) => onDetachChannel/);
  expect(initiativeDetail).toMatch(/value=\{resourceType\}\s+disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/value=\{resourceLabel\} disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/value=\{resourceId\} disabled=\{updating\}/);
  expect(initiativeDetail).toMatch(/type="button"\s+disabled=\{updating\}\s+onClick=\{\(\) => onPatchInitiative/);
  expect(occurrences(initiativeDetail, "disabled={!taskToAttach || updating}")).toBe(1);
  expect(occurrences(initiativeDetail, "disabled={!channelToAttach || updating}")).toBe(1);
  expect(occurrences(initiativeDetail, "disabled={!resourceId.trim() || updating}")).toBe(1);
});
