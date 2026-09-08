import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  applyWorkspaceMutationProjections,
  findWorkspaceSubtree,
  findWorkspaceMatchingRename,
  parseWorkspaceRenameResponse,
  prepareWorkspaceRenameMutation,
  rebaseWorkspaceCanonicalSnapshot,
  removeWorkspaceFromTree,
  restoreWorkspaceSubtree,
  reuseWorkspaceRefresh,
  runWorkspaceCreateMutation,
  runWorkspaceTreeMutation,
  updateWorkspaceSubspaces,
  upsertWorkspaceTree,
  type WorkspaceMutationEntry,
  type WorkspaceMutationProjection,
  type WorkspaceMutationScope,
  type WorkspaceScopedRequest,
  type WorkspaceScopedRefresh,
  workspaceCreateMutationKey,
  workspaceRefreshIsVisible,
  workspaceRequestIsCurrent,
  workspaceSelectionRollbackOwned,
  workspaceSubtreeIds,
} from "../lib/workspace-tree";
import { workspaceSelectionIsCurrent } from "../lib/workspace-active-selection";
import { isQueryCancellation } from "../lib/query";
import type { Workspace } from "../lib/workspace-types";

function workspace(
  id: string,
  name: string,
  subspaces: Workspace[] = [],
  parentWorkspaceId: string | null = null,
): Workspace {
  return {
    id,
    user_id: "owner-one",
    name,
    description: null,
    parent_workspace_id: parentWorkspaceId,
    workspace_type: parentWorkspaceId ? "subworkspace" : "super_workspace",
    is_global: false,
    workspace_focus: "general",
    ai_specialization: "general",
    intelligence_preferences: {},
    current_user_role: "owner",
    member_count: 1,
    is_shared: false,
    members_preview: [],
    subspaces,
  };
}

test("delete rollback restores only the removed subtree at its original hierarchy index", () => {
  const alpha = workspace("alpha", "Alpha", [], "root");
  const target = workspace("target", "Target", [workspace("nested", "Nested", [], "target")], "root");
  const omega = workspace("omega", "Omega", [], "root");
  const before = [workspace("root", "Root", [alpha, target, omega])];
  const removed = findWorkspaceSubtree(before, target.id);

  expect(removed).not.toBeNull();
  const optimistic = removeWorkspaceFromTree(before, target.id);
  const realtime = workspace("realtime", "Realtime", [], "root");
  const concurrent = [
    {
      ...optimistic[0],
      description: "Refetched parent",
      subspaces: [
        { ...alpha, name: "Alpha from realtime" },
        realtime,
        omega,
      ],
    },
    workspace("new-root", "Concurrent root"),
  ];

  const restored = restoreWorkspaceSubtree(concurrent, removed!);

  expect(restored.map((item) => item.id)).toEqual(["root", "new-root"]);
  expect(restored[0].description).toBe("Refetched parent");
  expect(restored[0].subspaces?.map((item) => item.id)).toEqual([
    "alpha",
    "target",
    "realtime",
    "omega",
  ]);
  expect(restored[0].subspaces?.[0].name).toBe("Alpha from realtime");
  expect(restored[0].subspaces?.[1]).toBe(target);
});

test("delete rollback leaves an already-refetched subtree untouched", () => {
  const target = workspace("target", "Original target", [], "root");
  const before = [workspace("root", "Root", [target])];
  const removed = findWorkspaceSubtree(before, target.id);
  const refetched = [
    workspace("root", "Root", [
      { ...target, name: "Canonical target" },
    ]),
  ];

  expect(removed).not.toBeNull();
  expect(restoreWorkspaceSubtree(refetched, removed!)).toBe(refetched);
  expect(refetched[0].subspaces?.[0].name).toBe("Canonical target");
});

test("canonical hierarchy snapshots retain every active same-scope mutation projection", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const otherScope: WorkspaceMutationScope = { userId: "owner-two", generation: 2 };
  const request = Promise.resolve();
  const entries: WorkspaceMutationEntry[] = [
    {
      fingerprint: "rename:Projected:unchanged",
      kind: "rename",
      projection: { active: true, kind: "rename", patch: { name: "Projected" }, workspaceId: "alpha" },
      relatedWorkspaceIds: ["alpha"], request, scope, workspaceId: "alpha",
    },
    {
      fingerprint: "delete",
      kind: "delete",
      projection: { active: true, kind: "delete", workspaceId: "beta" },
      relatedWorkspaceIds: ["beta"], request, scope, workspaceId: "beta",
    },
    {
      fingerprint: "rename:Inactive:unchanged",
      kind: "rename",
      projection: { active: false, kind: "rename", patch: { name: "Inactive" }, workspaceId: "gamma" },
      relatedWorkspaceIds: ["gamma"], request, scope, workspaceId: "gamma",
    },
    {
      fingerprint: "rename:Other user:unchanged",
      kind: "rename",
      projection: { active: true, kind: "rename", patch: { name: "Other user" }, workspaceId: "gamma" },
      relatedWorkspaceIds: ["gamma"], request, scope: otherScope, workspaceId: "gamma",
    },
  ];
  const projected = applyWorkspaceMutationProjections([
    workspace("alpha", "Canonical Alpha"),
    workspace("beta", "Canonical Beta"),
    workspace("gamma", "Canonical Gamma"),
  ], entries, scope);

  expect(projected.map((item) => [item.id, item.name])).toEqual([
    ["alpha", "Projected"],
    ["gamma", "Canonical Gamma"],
  ]);
});

test("tree and subspace snapshots retain pending same-scope rename and delete projections", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const request = Promise.resolve();
  const entries: WorkspaceMutationEntry[] = [
    {
      fingerprint: "rename:Projected:unchanged",
      kind: "rename",
      projection: { active: true, kind: "rename", patch: { name: "Projected" }, workspaceId: "alpha" },
      relatedWorkspaceIds: ["root", "alpha"], request, scope, workspaceId: "alpha",
    },
    {
      fingerprint: "delete",
      kind: "delete",
      projection: { active: true, kind: "delete", workspaceId: "beta" },
      relatedWorkspaceIds: ["root", "beta"], request, scope, workspaceId: "beta",
    },
  ];
  const canonicalRoot = workspace("root", "Canonical Root", [
    workspace("alpha", "Canonical Alpha", [], "root"),
    workspace("beta", "Canonical Beta", [], "root"),
  ]);
  const current = [workspace("root", "Stale Root")];
  const snapshots = [
    upsertWorkspaceTree(current, canonicalRoot),
    updateWorkspaceSubspaces(current, "root", canonicalRoot.subspaces ?? []),
  ];

  for (const snapshot of snapshots) {
    const projected = applyWorkspaceMutationProjections(snapshot, entries, scope);
    expect(projected[0].subspaces?.map((item) => [item.id, item.name])).toEqual([
      ["alpha", "Projected"],
    ]);
  }
});

test("retiring a rename after final reconciliation failure reveals the latest canonical shadow", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const request = Promise.resolve();
  const renameProjection: WorkspaceMutationProjection = {
    active: true, kind: "rename", patch: { name: "Requested Rename" }, workspaceId: "alpha",
  };
  const entries: WorkspaceMutationEntry[] = [
    {
      fingerprint: "rename:Requested Rename:unchanged", projection: renameProjection,
      kind: "rename",
      relatedWorkspaceIds: ["alpha"], request, scope, workspaceId: "alpha",
    },
    {
      fingerprint: "delete", projection: { active: true, kind: "delete", workspaceId: "beta" },
      kind: "delete",
      relatedWorkspaceIds: ["beta"], request, scope, workspaceId: "beta",
    },
  ];
  const initial = [
    workspace("alpha", "Original Alpha"),
    workspace("beta", "Pending Delete"),
  ];
  const rebased = rebaseWorkspaceCanonicalSnapshot(initial, (current) => current.map((item) =>
    item.id === "alpha" ? { ...item, name: "Collaborator Canonical Rename", description: "New evidence" } : item),
  entries, scope);

  expect(rebased.projected.map((item) => item.name))
    .toEqual(["Requested Rename"]);
  renameProjection.active = false;
  const retired = rebaseWorkspaceCanonicalSnapshot(rebased.canonical, (current) => current, entries, scope);
  expect(retired.projected.map((item) => [item.name, item.description]))
    .toEqual([["Collaborator Canonical Rename", "New evidence"]]);
});

test("retiring a failed delete restores the latest canonical subtree rather than its original copy", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const projection: WorkspaceMutationProjection = { active: true, kind: "delete", workspaceId: "child" };
  const entries: WorkspaceMutationEntry[] = [{
    fingerprint: "delete", kind: "delete", projection,
    relatedWorkspaceIds: ["child"], request: Promise.resolve(), scope, workspaceId: "child",
  }];
  const initial = [workspace("root", "Root", [workspace("child", "Original Child", [], "root")])];
  const rebased = rebaseWorkspaceCanonicalSnapshot(initial, (current) => updateWorkspaceSubspaces(
    current, "root", [{ ...workspace("child", "Collaborator Child", [], "root"), description: "Fresh" }],
  ), entries, scope);

  expect(rebased.projected[0].subspaces).toEqual([]);
  projection.active = false;
  const retired = rebaseWorkspaceCanonicalSnapshot(rebased.canonical, (current) => current, entries, scope);
  expect(retired.projected[0].subspaces?.map((item) => [item.name, item.description]))
    .toEqual([["Collaborator Child", "Fresh"]]);
});

test("auth ABA ownership rejects a late request and preserves its exact replacement", () => {
  const scopeA1: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const scopeB: WorkspaceMutationScope = { userId: "owner-two", generation: 2 };
  const scopeA2: WorkspaceMutationScope = { userId: "owner-one", generation: 3 };
  const key = "root";
  const lateA = Promise.resolve("late-a");
  const replacementA = Promise.resolve("replacement-a");
  const registry = new Map<string, WorkspaceScopedRequest<string>>([
    [key, { request: lateA, scope: scopeA1 }],
  ]);

  expect(workspaceRequestIsCurrent(registry, key, lateA, scopeA1, scopeA1)).toBe(true);
  expect(workspaceRequestIsCurrent(registry, key, lateA, scopeA1, scopeB)).toBe(false);
  registry.set(key, { request: replacementA, scope: scopeA2 });
  if (workspaceRequestIsCurrent(registry, key, lateA, scopeA1, scopeA2)) registry.delete(key);

  expect(registry.get(key)?.request).toBe(replacementA);
  expect(workspaceRequestIsCurrent(registry, key, lateA, scopeA1, scopeA2)).toBe(false);
  expect(workspaceRequestIsCurrent(registry, key, replacementA, scopeA2, scopeA2)).toBe(true);
});

test("partial refresh reuse promotes visibility while force requires a replacement owner", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const request = Promise.resolve("silent");
  const registry = new Map<string, WorkspaceScopedRefresh<string>>([
    ["root", { request, scope, visible: false }],
  ]);

  const promoted = reuseWorkspaceRefresh(registry, "root", scope, { silent: false });
  expect(promoted).toEqual({ becameVisible: true, request });
  expect(registry.get("root")?.visible).toBe(true);
  expect(reuseWorkspaceRefresh(registry, "root", scope, { force: true, silent: true })).toBeNull();

  const replacement = Promise.resolve("forced");
  const inheritedVisible = workspaceRefreshIsVisible(true, registry.get("root") ?? null, scope);
  registry.set("root", { request: replacement, scope, visible: inheritedVisible });
  if (workspaceRequestIsCurrent(registry, "root", request, scope, scope)) registry.delete("root");
  expect(registry.get("root")).toEqual({ request: replacement, scope, visible: true });
});

test("workspace and subspace create keys are scoped, complete, default-aware, and delimiter-safe", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const base = { name: "Alpha", description: "Beta", workspace_type: "super_workspace" as const };
  const key = workspaceCreateMutationKey(scope, { operation: "workspace", payload: base });
  const workspaceKey = (payload: Parameters<typeof workspaceCreateMutationKey>[1] & { operation: "workspace" }) =>
    workspaceCreateMutationKey(scope, payload);

  expect(workspaceKey({ operation: "workspace", payload: { ...base, name: "alpha" } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { ...base, description: "Different" } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { ...base, parent_workspace_id: "parent" } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { ...base, workspace_type: "global_workspace" } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { ...base, is_global: true } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { ...base, workspace_focus: "research" } })).not.toBe(key);
  expect(workspaceKey({ operation: "workspace", payload: { name: "Alpha::Beta", description: "Gamma" } }))
    .not.toBe(workspaceKey({ operation: "workspace", payload: { name: "Alpha", description: "Beta::Gamma" } }));
  expect(workspaceKey({ operation: "workspace", payload: { name: "Defaults" } })).toBe(workspaceKey({
    operation: "workspace", payload: {
      name: "Defaults", description: undefined, parent_workspace_id: null,
      workspace_type: "super_workspace", is_global: false, workspace_focus: "general",
    },
  }));
  expect(workspaceCreateMutationKey({ userId: "owner-one", generation: 2 }, {
    operation: "workspace", payload: base,
  })).not.toBe(key);
  expect(workspaceCreateMutationKey({ userId: "owner-two", generation: 1 }, {
    operation: "workspace", payload: base,
  })).not.toBe(key);

  const subspaceKey = workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "root", payload: { name: "Child", workspace_focus: "general" },
  });
  expect(workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "other", payload: { name: "Child", workspace_focus: "general" },
  })).not.toBe(subspaceKey);
  expect(workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "root", payload: { name: "Other child", workspace_focus: "general" },
  })).not.toBe(subspaceKey);
  expect(workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "root", payload: { name: "Child", description: "Different" },
  })).not.toBe(subspaceKey);
  expect(workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "root", payload: { name: "Child", workspace_focus: "research" },
  })).not.toBe(subspaceKey);
  expect(workspaceCreateMutationKey(scope, {
    operation: "workspace", payload: { name: "Child", parent_workspace_id: "root", workspace_type: "subworkspace" },
  })).not.toBe(subspaceKey);
  expect(workspaceCreateMutationKey(scope, {
    operation: "subspace", parentId: "root", payload: { name: "Child" },
  })).toBe(subspaceKey);
});

test("visible refresh ownership transfers only to a same-scope silent successor", () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const otherScope: WorkspaceMutationScope = { userId: "owner-two", generation: 2 };

  expect(workspaceRefreshIsVisible(true, { scope, visible: true }, scope)).toBe(true);
  expect(workspaceRefreshIsVisible(true, { scope, visible: false }, scope)).toBe(false);
  expect(workspaceRefreshIsVisible(true, { scope, visible: true }, otherScope)).toBe(false);
  expect(workspaceRefreshIsVisible(false, null, scope)).toBe(true);
});

test("expected query cancellation is neutral and active selection rejects A-B-A reuse", () => {
  const abort = new Error("request aborted");
  abort.name = "AbortError";

  expect(isQueryCancellation(abort)).toBe(true);
  expect(isQueryCancellation(new Error("CancelledError"))).toBe(true);
  expect(isQueryCancellation(new Error("network unavailable"))).toBe(false);
  expect(workspaceSelectionIsCurrent(
    { workspaceId: "workspace-a", generation: 4 }, "workspace-a", 4,
  )).toBe(true);
  expect(workspaceSelectionIsCurrent(
    { workspaceId: "workspace-a", generation: 4 }, "workspace-a", 6,
  )).toBe(false);
});

test("active selection rollback rejects fallback-other-fallback ABA ownership", () => {
  expect(workspaceSelectionRollbackOwned("fallback", "fallback", 7, 7)).toBe(true);
  expect(workspaceSelectionRollbackOwned("fallback", "fallback", 9, 7)).toBe(false);
  expect(workspaceSelectionRollbackOwned("other", "fallback", 7, 7)).toBe(false);
});

test("subtree invalidation ids cover the removed workspace and every descendant", () => {
  const subtree = workspace("root", "Root", [
    workspace("child", "Child", [workspace("grandchild", "Grandchild", [], "child")], "root"),
  ]);

  expect(workspaceSubtreeIds("root", subtree)).toEqual(["root", "child", "grandchild"]);
  expect(workspaceSubtreeIds("missing")).toEqual(["missing"]);
});

test("rename responses are validated and normalized at the request boundary", () => {
  const parsed = parseWorkspaceRenameResponse(
    { id: "target", name: "  Canonical name  ", description: null },
    "target",
  );

  expect(parsed.name).toBe("Canonical name");
  expect(parsed.description).toBeNull();
  expect(() => parseWorkspaceRenameResponse({ id: "other", name: "Wrong" }, "target")).toThrow();
  expect(() => parseWorkspaceRenameResponse({ id: "target" }, "target")).toThrow();
  expect(() => parseWorkspaceRenameResponse({ id: "target", name: "Valid", description: 42 }, "target")).toThrow();
  expect(() => parseWorkspaceRenameResponse(
    { id: "target", name: "Stale" }, "target", { name: "Requested" },
  )).toThrow();
  const cleared = prepareWorkspaceRenameMutation("target", { name: "Cleared", description: null });
  const empty = prepareWorkspaceRenameMutation("target", { name: "Cleared", description: "" });
  const unchanged = prepareWorkspaceRenameMutation("target", { name: "Cleared", description: undefined });
  expect(cleared.requestPayload).toEqual({ name: "Cleared", description: "" });
  expect(cleared.optimisticPatch.description).toBe("");
  expect(cleared.fingerprint).toBe(empty.fingerprint);
  expect(cleared.fingerprint).not.toBe(unchanged.fingerprint);
  expect(unchanged.requestPayload).toEqual({ name: "Cleared" });
  expect(parseWorkspaceRenameResponse(
    { id: "target", name: "Cleared", description: "" }, "target", cleared.requestPayload,
  ).description).toBe("");
  expect(() => parseWorkspaceRenameResponse(
    { id: "target", name: "Cleared", description: null }, "target", cleared.requestPayload,
  )).toThrow();
  const forest = [workspace("target", "Canonical name")];
  expect(findWorkspaceMatchingRename(forest, "target", { name: "Canonical name" })?.id).toBe("target");
  expect(findWorkspaceMatchingRename(forest, "target", { name: "Canonical name", description: "Different" })).toBeNull();
  expect(findWorkspaceMatchingRename([
    { ...workspace("target", "Cleared"), description: "" },
  ], "target", { name: "Cleared", description: null })?.id).toBe("target");
});

test("exact mutation dedupe is isolated by auth generation", async () => {
  const registry = new Map<string, Promise<unknown>>();
  const entries = new Map<string, WorkspaceMutationEntry>();
  const forest = [workspace("target", "Target")];
  const scopeA: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const scopeB: WorkspaceMutationScope = { userId: "owner-two", generation: 2 };
  let release!: () => void;
  let calls = 0;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const first = runWorkspaceTreeMutation(
    registry, entries, scopeA, forest, "target", "rename:Next:unchanged",
    async () => { calls += 1; await pending; return "owner-one"; },
  );
  const duplicate = runWorkspaceTreeMutation(
    registry, entries, scopeA, forest, "target", "rename:Next:unchanged",
    async () => { calls += 1; return "duplicate"; },
  );
  const otherUser = runWorkspaceTreeMutation(
    registry, entries, scopeB, forest, "target", "rename:Next:unchanged",
    async () => { calls += 1; return "owner-two"; },
  );

  expect(duplicate).toBe(first);
  await expect(otherUser).resolves.toBe("owner-two");
  await expect(runWorkspaceTreeMutation(
    registry, entries, scopeA, forest, "target", "rename:Different:unchanged",
    async () => "conflict",
  )).rejects.toThrow("already in progress");
  release();
  await expect(first).resolves.toBe("owner-one");
  expect(calls).toBe(2);
});

test("related ancestor and descendant deletes cannot overlap", async () => {
  const registry = new Map<string, Promise<unknown>>();
  const entries = new Map<string, WorkspaceMutationEntry>();
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const forest = [workspace("root", "Root", [workspace("child", "Child", [], "root")])];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const childDelete = runWorkspaceTreeMutation(
    registry, entries, scope, forest, "child", "delete", async () => pending,
  );

  await expect(runWorkspaceTreeMutation(
    registry, entries, scope, forest, "root", "delete", async () => undefined,
  )).rejects.toThrow("related workspace deletion");
  release();
  await childDelete;
});

test("parent delete exclusion is symmetric with descendant rename and subspace creation", async () => {
  const scope: WorkspaceMutationScope = { userId: "owner-one", generation: 1 };
  const forest = [workspace("root", "Root", [workspace("child", "Child", [], "root")])];

  {
    const registry = new Map<string, Promise<unknown>>();
    const entries = new Map<string, WorkspaceMutationEntry>();
    let release!: () => void;
    const rename = runWorkspaceTreeMutation(registry, entries, scope, forest, "child", "rename",
      async () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(runWorkspaceTreeMutation(
      registry, entries, scope, forest, "root", "delete", async () => undefined,
    )).rejects.toThrow("related workspace deletion");
    release();
    await rename;
  }

  {
    const registry = new Map<string, Promise<unknown>>();
    const entries = new Map<string, WorkspaceMutationEntry>();
    let release!: () => void;
    const deletion = runWorkspaceTreeMutation(registry, entries, scope, forest, "root", "delete",
      async () => new Promise<void>((resolve) => { release = resolve; }));
    await expect(runWorkspaceTreeMutation(
      registry, entries, scope, forest, "child", "rename", async () => undefined,
    )).rejects.toThrow("related workspace deletion");
    release();
    await deletion;
  }

  {
    const registry = new Map<string, Promise<unknown>>();
    const entries = new Map<string, WorkspaceMutationEntry>();
    let release!: () => void;
    const mutationKey = workspaceCreateMutationKey(scope, {
      operation: "subspace", parentId: "child", payload: { name: "Nested" },
    });
    const create = runWorkspaceCreateMutation(registry, entries, scope, mutationKey, "child",
      async () => new Promise<void>((resolve) => { release = resolve; }));
    const duplicate = runWorkspaceCreateMutation(
      registry, entries, scope, mutationKey, "child", async () => undefined,
    );
    expect(duplicate).toBe(create);
    await expect(runWorkspaceTreeMutation(
      registry, entries, scope, forest, "root", "delete", async () => undefined,
    )).rejects.toThrow("related workspace deletion");
    release();
    await create;
  }

  {
    const registry = new Map<string, Promise<unknown>>();
    const entries = new Map<string, WorkspaceMutationEntry>();
    let release!: () => void;
    const deletion = runWorkspaceTreeMutation(registry, entries, scope, forest, "root", "delete",
      async () => new Promise<void>((resolve) => { release = resolve; }));
    const mutationKey = workspaceCreateMutationKey(scope, {
      operation: "subspace", parentId: "child", payload: { name: "Nested" },
    });
    await expect(runWorkspaceCreateMutation(
      registry, entries, scope, mutationKey, "child", async () => undefined,
    )).rejects.toThrow("related workspace deletion");
    release();
    await deletion;
  }
});

test("workspace mutation callers gate A-B-A completions with the exact active-selection generation", () => {
  const frontendRoot = process.cwd().endsWith("frontend")
    ? process.cwd()
    : resolve(process.cwd(), "frontend");
  const guardedFiles = [
    "components/settings/WorkspaceSettingsPanel.tsx",
    "components/layout/sidebar/WorkspaceSelector.tsx",
    "app/(dashboard)/workspace/page.tsx",
    "components/workspace/WorkspaceOnboardingGate.tsx",
  ];

  for (const relativePath of guardedFiles) {
    const source = readFileSync(resolve(frontendRoot, relativePath), "utf-8");
    expect(source).toContain("captureActiveWorkspaceSelection");
    expect(source).toContain("owner.isCurrent()");
  }
  const settings = readFileSync(
    resolve(frontendRoot, "components/settings/WorkspaceSettingsPanel.tsx"), "utf-8",
  );
  const onboarding = readFileSync(
    resolve(frontendRoot, "components/workspace/WorkspaceOnboardingGate.tsx"), "utf-8",
  );
  const intelligence = readFileSync(
    resolve(frontendRoot, "lib/workspace-intelligence-state.ts"), "utf-8",
  );
  expect(settings).toContain("description: description.trim()");
  expect(settings).not.toContain("description: description.trim() || null");
  expect(onboarding.match(/owner = captureActiveWorkspaceSelection\(\)/g)).toHaveLength(4);
  expect(intelligence).toContain("requestGenerationRef.current !== generation");
});

test("provider scopes completions and retires projections onto its canonical shadow", () => {
  const frontendRoot = process.cwd().endsWith("frontend")
    ? process.cwd()
    : resolve(process.cwd(), "frontend");
  const source = readFileSync(
    resolve(frontendRoot, "lib/workspace-provider.tsx"),
    "utf-8",
  );
  const treeSource = readFileSync(resolve(frontendRoot, "lib/workspace-tree.tsx"), "utf-8");
  const treeRefresh = source.slice(
    source.indexOf("const refreshWorkspaceTree ="),
    source.indexOf("const refreshWorkspaceSubspaces ="),
  );
  const subspaceRefresh = source.slice(
    source.indexOf("const refreshWorkspaceSubspaces ="),
    source.indexOf("const createWorkspace ="),
  );
  const creation = source.slice(
    source.indexOf("const createWorkspace ="),
    source.indexOf("const renameWorkspace ="),
  );
  const rename = source.slice(
    source.indexOf("const renameWorkspace ="),
    source.indexOf("const deleteWorkspace ="),
  );
  const deletion = source.slice(
    source.indexOf("const deleteWorkspace ="),
    source.indexOf("useEffect(() =>", source.indexOf("const deleteWorkspace =")),
  );
  const deletionSuccessStart = deletion.lastIndexOf(
    "invalidateWorkspaceSubtreeDetailQueries(workspaceId, removed?.subtree)",
  );
  const deletionSuccess = deletion.slice(deletionSuccessStart, deletion.indexOf("}, [", deletionSuccessStart));

  expect(treeSource).toContain('const key = `workspace:${scope.userId ?? "signed-out"}:${scope.generation}:${workspaceId}`');
  expect(source).toContain("return authoritativeResult()");
  expect(source).toContain("workspaceRefreshInFlightRef.current?.scope === requestScope");
  expect(source).toContain("workspaceRefreshIsVisible(");
  expect(source).toContain("canonicalWorkspacesRef.current");
  expect(source).toContain("rebaseWorkspaceCanonicalSnapshot(canonical, update");
  expect(source).toContain("commitWorkspaceSnapshot(requestScope, () => data)");
  expect(source).not.toContain("setWorkspaces(data)");
  expect(treeRefresh).toContain("workspaceRequestIsCurrent(");
  expect(treeRefresh).toContain("if (!isCurrent()) return null");
  expect(treeRefresh).toContain("commitWorkspaceSnapshot(requestScope");
  expect(treeRefresh).toContain("if (isQueryCancellation(err)) return null");
  expect(treeRefresh).toContain("setError(null)");
  expect(treeRefresh).toContain(".finally(() => { if (isCurrent())");
  expect(subspaceRefresh).toContain("workspaceRequestIsCurrent(");
  expect(subspaceRefresh.match(/if \(!isCurrent\(\)\) return \[\]/g)).toHaveLength(2);
  expect(subspaceRefresh).toContain("commitWorkspaceSnapshot(requestScope");
  expect(subspaceRefresh).toContain("if (isQueryCancellation(err)) return []");
  expect(subspaceRefresh).toContain("[normalizedWorkspaceId]: null");
  expect(subspaceRefresh).toContain("if (!isCurrent()) return;");
  expect(creation.match(/workspaceCreateMutationKey\(requestScope/g)).toHaveLength(2);
  expect(creation.match(/runExclusiveMutation\(workspaceMutationInFlightRef\.current, mutationKey/g)).toHaveLength(1);
  expect(creation).toContain("runWorkspaceCreateMutation(");
  expect(creation).toContain('operation: "workspace"');
  expect(creation).toContain('operation: "subspace"');
  expect(creation.match(/\{ invalidate: false \}/g)).toHaveLength(2);
  expect(creation).toMatch(
    /await createWorkspaceRequest\(normalizedPayload, \{ invalidate: false \}\);\s+if \(workspaceMutationScopeRef\.current !== requestScope\) throw [^;]+;\s+invalidateWorkspaceTreeQueries\(\);/,
  );
  expect(creation).toMatch(
    /await createSubspaceRequest\(normalizedParentId, normalizedPayload, \{ invalidate: false \}\);\s+if \(workspaceMutationScopeRef\.current !== requestScope\) throw [^;]+;\s+invalidateWorkspaceTreeQueries\(normalizedParentId\);/,
  );
  expect(creation).toContain("invalidateWorkspaceTreeQueries(normalizedParentId)");
  expect(creation).toContain("refreshWorkspaceTree(normalizedParentId, { force: true, silent: true }, requestScope)");
  expect(rename).toContain("renameWorkspaceRequest(workspaceId, requestPayload)");
  expect(rename).not.toContain("rollbackOptimisticPatch(");
  expect(rename).toContain("name: updated.name");
  expect(rename).not.toContain("setWorkspaces(previousWorkspaces)");
  expect(rename).toContain("workspaceMutationScopeRef.current !== requestScope");
  expect(rename).toContain("rename reconciled as committed");
  expect(rename.match(/await refreshWorkspaceHierarchy\(\{ force: true, silent: true \}, requestScope\)/g)).toHaveLength(2);
  expect((rename.match(/projection\.active = false;[\s\S]*?commitWorkspaceSnapshot\(requestScope, \(current\) => current\)/g) ?? []).length)
    .toBeGreaterThanOrEqual(2);
  expect(deletion).not.toContain("restoreWorkspaceSubtree(current, removed)");
  expect(deletion).toContain("workspaceSelectionRollbackOwned(");
  expect(deletion).toContain("invalidateWorkspaceSubtreeDetailQueries(workspaceId, removed?.subtree)");
  expect(deletion).not.toContain("setWorkspaces(previousWorkspaces)");
  expect(deletion).toContain("delete reconciled as committed");
  expect(deletion.match(/await refreshWorkspaceHierarchy\(\{ force: true, silent: true \}, requestScope\)/g)).toHaveLength(2);
  expect(deletionSuccess).toContain("commitWorkspaceSnapshot(requestScope, (current) => removeWorkspaceFromTree");
  expect(deletion).toMatch(
    /await refreshWorkspaceHierarchy\(\{ force: true, silent: true \}, requestScope\);\s+projection\.active = false;\s+if \(workspaceMutationScopeRef\.current !== requestScope\) return;\s+commitWorkspaceSnapshot\(requestScope, \(current\) => current\);\s+showToast/,
  );
  expect(treeSource.slice(treeSource.indexOf("export async function renameWorkspaceRequest"))).not.toContain(".finally(() =>");
  expect(source).toContain("workspaceMutationScopeRef.current !== requestScope");
  expect(source).toContain("workspaceMutationScopeRef.current === requestScope");
});
