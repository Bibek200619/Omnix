import { apiClient } from "./api";
import { invalidateQueries, queryGet } from "./query";
import { runExclusiveMutation } from "./mutation-lifecycle";
import type {
  Workspace,
  WorkspaceCreatePayload,
  WorkspaceFocus,
  WorkspaceRole,
  WorkspaceSubspaceCreatePayload,
  WorkspaceType,
} from "./workspace-types";
import { flattenWorkspaces } from "./workspace-utils";

export type WorkspaceApiRecord = Omit<Partial<Workspace>, "workspace_focus" | "ai_specialization" | "subspaces"> & {
  id: string;
  name?: string | null;
  workspace_focus?: unknown;
  ai_specialization?: unknown;
  subspaces?: WorkspaceApiRecord[];
};

export type WorkspaceMutationScope = Readonly<{ userId: string | null; generation: number }>;
export type WorkspaceScopedRequest<T> = Readonly<{
  request: Promise<T>;
  scope: WorkspaceMutationScope;
}>;
export type WorkspaceScopedRefresh<T> = WorkspaceScopedRequest<T> & Readonly<{ visible: boolean }>;
export type WorkspaceMutationProjection =
  | { active: boolean; kind: "delete"; workspaceId: string }
  | { active: boolean; kind: "rename"; patch: Partial<Workspace>; workspaceId: string };
export type WorkspaceMutationEntry = Readonly<{
  fingerprint: string;
  kind: "create" | "delete" | "rename";
  projection?: WorkspaceMutationProjection;
  relatedWorkspaceIds: readonly string[];
  request: Promise<unknown>;
  scope: WorkspaceMutationScope;
  workspaceId: string;
}>;

export function workspaceRequestIsCurrent<T>(
  registry: ReadonlyMap<string, WorkspaceScopedRequest<T>>,
  key: string,
  request: Promise<T>,
  requestScope: WorkspaceMutationScope,
  currentScope: WorkspaceMutationScope,
) {
  const owner = registry.get(key);
  return currentScope === requestScope && owner?.scope === requestScope && owner.request === request;
}

export function reuseWorkspaceRefresh<T>(
  registry: Map<string, WorkspaceScopedRefresh<T>>,
  key: string,
  scope: WorkspaceMutationScope,
  options?: { force?: boolean; silent?: boolean },
) {
  const active = registry.get(key);
  if (options?.force || active?.scope !== scope) return null;
  const becameVisible = options?.silent !== true && !active.visible;
  if (becameVisible) registry.set(key, { ...active, visible: true });
  return { becameVisible, request: active.request };
}

export function workspaceCreateMutationKey(
  scope: WorkspaceMutationScope,
  mutation:
    | Readonly<{ operation: "workspace"; payload: WorkspaceCreatePayload }>
    | Readonly<{ operation: "subspace"; parentId: string; payload: WorkspaceSubspaceCreatePayload }>,
) {
  const { operation, payload } = mutation;
  return JSON.stringify({
    operation,
    user_id: scope.userId,
    generation: scope.generation,
    name: payload.name.trim(),
    description: payload.description ?? null,
    parent_workspace_id: operation === "subspace"
      ? mutation.parentId.trim()
      : payload.parent_workspace_id ?? null,
    workspace_type: operation === "subspace"
      ? "subworkspace"
      : payload.workspace_type ?? "super_workspace",
    is_global: operation === "workspace" ? payload.is_global ?? false : false,
    workspace_focus: payload.workspace_focus ?? "general",
  });
}

export function prepareWorkspaceRenameMutation(
  workspaceId: string,
  payload: { name: string; description?: string | null },
) {
  const nextName = payload.name.trim();
  if (!nextName) throw new Error("Workspace name cannot be empty.");
  const hasDescription = payload.description !== undefined;
  const requestPayload: { name: string; description?: string } = { name: nextName };
  if (hasDescription) requestPayload.description = payload.description ?? "";
  const optimisticPatch: Partial<Workspace> = { name: nextName };
  if (hasDescription) optimisticPatch.description = requestPayload.description;
  const projection: WorkspaceMutationProjection = {
    active: false, kind: "rename", patch: optimisticPatch, workspaceId,
  };
  const fingerprint = JSON.stringify({
    operation: "rename", name: nextName,
    description: hasDescription ? requestPayload.description : { unchanged: true },
  });
  return { fingerprint, hasDescription, nextName, optimisticPatch, projection, requestPayload };
}

export function workspaceSelectionRollbackOwned(
  activeWorkspaceId: string | null,
  optimisticWorkspaceId: string | null,
  currentRevision: number,
  optimisticRevision: number | null,
) {
  return activeWorkspaceId === optimisticWorkspaceId &&
    optimisticRevision !== null && currentRevision === optimisticRevision;
}

export function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
  if (
    role === "founder" ||
    role === "owner" ||
    role === "co_owner" ||
    role === "member" ||
    role === "super_founder" ||
    role === "sub_leader" ||
    role === "team_lead" ||
    role === "sub_member"
  ) {
    return role;
  }
  return "member";
}

function normalizeWorkspaceType(value: unknown, parentWorkspaceId?: string | null): WorkspaceType {
  if (value === "super_workspace" || value === "super") return "super_workspace";
  if (value === "subworkspace" || value === "sub") return "subworkspace";
  if (value === "global_workspace") return "global_workspace";
  if (value === "workspace") return "super_workspace";
  return parentWorkspaceId ? "subworkspace" : "super_workspace";
}

function normalizeWorkspaceFocus(value: unknown): WorkspaceFocus {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]/g, "_");
  if (
    normalized === "general" ||
    normalized === "engineering" ||
    normalized === "design" ||
    normalized === "research" ||
    normalized === "strategy"
  ) {
    return normalized;
  }
  if (["coding", "code", "dev", "development", "technical"].includes(normalized)) {
    return "engineering";
  }
  if (["analytics", "analysis", "data"].includes(normalized)) {
    return "research";
  }
  if (["product", "planning"].includes(normalized)) {
    return "strategy";
  }
  return "general";
}

export function normalizeWorkspaceRecord(record: WorkspaceApiRecord, parentFromTree?: string | null): Workspace {
  const parentWorkspaceId =
    record.parent_workspace_id === undefined
      ? parentFromTree ?? null
      : record.parent_workspace_id || null;
  const membersPreview = Array.isArray(record.members_preview) ? record.members_preview : [];
  const memberCount =
    typeof record.member_count === "number"
      ? record.member_count
      : membersPreview.length;
  const workspaceFocus = normalizeWorkspaceFocus(record.workspace_focus ?? record.ai_specialization);

  return {
    id: String(record.id),
    user_id: String(record.user_id ?? ""),
    name: String(record.name || "Untitled workspace"),
    description: record.description ?? null,
    parent_workspace_id: parentWorkspaceId,
    workspace_type: normalizeWorkspaceType(record.workspace_type, parentWorkspaceId),
    is_global: Boolean(record.is_global),
    expertise_area: record.expertise_area ?? null,
    workspace_focus: workspaceFocus,
    ai_specialization: workspaceFocus,
    ai_instructions: record.ai_instructions ?? null,
    intelligence_preferences:
      record.intelligence_preferences && typeof record.intelligence_preferences === "object"
        ? record.intelligence_preferences
        : {},
    current_user_role: normalizeWorkspaceRole(record.current_user_role),
    member_count: memberCount,
    is_shared: Boolean(record.is_shared ?? memberCount > 1),
    members_preview: membersPreview,
    created_at: record.created_at ?? null,
    updated_at: record.updated_at ?? null,
    subspaces: [],
  };
}

export function parseWorkspaceRenameResponse(
  response: unknown, workspaceId: string, payload?: { name: string; description?: string | null },
): Workspace {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    throw new Error("Workspace rename returned an invalid response.");
  }
  const record = response as WorkspaceApiRecord;
  if (
    record.id !== workspaceId ||
    typeof record.name !== "string" ||
    !record.name.trim() ||
    (record.description != null && typeof record.description !== "string") ||
    (payload && record.name.trim() !== payload.name.trim()) ||
    (payload && payload.description !== undefined &&
      (record.description ?? null) !== (payload.description ?? ""))
  ) {
    throw new Error("Workspace rename response did not match its requested resource.");
  }
  return normalizeWorkspaceRecord({ ...record, name: record.name.trim() });
}

function workspaceTimestamp(workspace: Workspace) {
  return Date.parse(workspace.created_at || workspace.updated_at || "") || 0;
}

export function sortSubspaces(subspaces: Workspace[]) {
  return [...subspaces].sort((a, b) => {
    if (a.is_global !== b.is_global) {
      return a.is_global ? -1 : 1;
    }

    const timeDelta = workspaceTimestamp(a) - workspaceTimestamp(b);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return a.name.localeCompare(b.name);
  });
}

function isGlobalWorkspace(workspace: Workspace) {
  return workspace.is_global || workspace.workspace_type === "global_workspace";
}

export function normalizeWorkspaceForest(records: WorkspaceApiRecord[] | null | undefined) {
  if (!Array.isArray(records)) {
    return [];
  }

  const byId = new Map<string, Workspace>();

  function visit(record: WorkspaceApiRecord, parentFromTree?: string | null) {
    if (!record?.id) {
      return;
    }

    const workspace = normalizeWorkspaceRecord(record, parentFromTree);
    byId.set(workspace.id, workspace);

    if (Array.isArray(record.subspaces)) {
      record.subspaces.forEach((subspace) => visit(subspace as WorkspaceApiRecord, workspace.id));
    }
  }

  records.forEach((record) => visit(record));

  const childrenByParentId = new Map<string, Workspace[]>();
  const roots: Workspace[] = [];

  for (const workspace of byId.values()) {
    const parentId = workspace.parent_workspace_id;
    if (parentId && byId.has(parentId)) {
      childrenByParentId.set(parentId, [...(childrenByParentId.get(parentId) ?? []), workspace]);
      continue;
    }

    if (!isGlobalWorkspace(workspace)) {
      roots.push(workspace);
    }
  }

  function attachChildren(workspace: Workspace, seen = new Set<string>()): Workspace {
    if (seen.has(workspace.id)) {
      return { ...workspace, subspaces: [] };
    }

    const nextSeen = new Set(seen);
    nextSeen.add(workspace.id);

    return {
      ...workspace,
      subspaces: sortSubspaces(childrenByParentId.get(workspace.id) ?? []).map((child) =>
        attachChildren(child, nextSeen),
      ),
    };
  }

  return roots.map((workspace) => attachChildren(workspace));
}

export function findWorkspaceById(workspaces: Workspace[], workspaceId: string | null) {
  if (!workspaceId) {
    return null;
  }

  return flattenWorkspaces(workspaces).find((workspace) => workspace.id === workspaceId) ?? null;
}

export function findWorkspaceMatchingRename(
  workspaces: Workspace[], workspaceId: string, payload: { name: string; description?: string | null },
) {
  const workspace = findWorkspaceById(workspaces, workspaceId);
  if (!workspace || workspace.name !== payload.name) return null;
  return payload.description === undefined ||
    (workspace.description ?? null) === (payload.description ?? "") ? workspace : null;
}

export function findRootWorkspaceById(workspaces: Workspace[], workspaceId: string | null) {
  if (!workspaceId) {
    return null;
  }

  for (const workspace of workspaces) {
    if (workspace.id === workspaceId) {
      return workspace;
    }

    if (workspace.subspaces?.some((subspace) => findWorkspaceById([subspace], workspaceId))) {
      return workspace;
    }
  }

  return null;
}

export function upsertWorkspaceTree(workspaces: Workspace[], tree: Workspace) {
  const withoutTree = workspaces.filter((workspace) => workspace.id !== tree.id);
  const existingIndex = workspaces.findIndex((workspace) => workspace.id === tree.id);
  if (existingIndex === -1) {
    return [tree, ...withoutTree];
  }

  return workspaces.map((workspace) => (workspace.id === tree.id ? tree : workspace));
}

export function updateWorkspaceSubspaces(workspaces: Workspace[], parentId: string, subspaces: Workspace[]): Workspace[] {
  return workspaces.map((workspace) => {
    if (workspace.id === parentId) {
      return { ...workspace, subspaces: sortSubspaces(subspaces) };
    }

    if (workspace.subspaces?.length) {
      return {
        ...workspace,
        subspaces: updateWorkspaceSubspaces(workspace.subspaces, parentId, subspaces),
      };
    }

    return workspace;
  });
}

export function patchWorkspaceInTree(
  workspaces: Workspace[],
  workspaceId: string,
  patcher: (workspace: Workspace) => Workspace,
): Workspace[] {
  return workspaces.map((workspace) => {
    if (workspace.id === workspaceId) {
      return patcher(workspace);
    }

    if (workspace.subspaces?.length) {
      return {
        ...workspace,
        subspaces: patchWorkspaceInTree(workspace.subspaces, workspaceId, patcher),
      };
    }

    return workspace;
  });
}

export function removeWorkspaceFromTree(workspaces: Workspace[], workspaceId: string): Workspace[] {
  return workspaces
    .filter((workspace) => workspace.id !== workspaceId)
    .map((workspace) => ({
      ...workspace,
      subspaces: workspace.subspaces?.length
        ? removeWorkspaceFromTree(workspace.subspaces, workspaceId)
        : [],
    }));
}

export type RemovedWorkspaceSubtree = Readonly<{
  index: number;
  parentId: string | null;
  subtree: Workspace;
}>;

export function findWorkspaceSubtree(
  workspaces: Workspace[],
  workspaceId: string,
  parentId: string | null = null,
): RemovedWorkspaceSubtree | null {
  for (let index = 0; index < workspaces.length; index += 1) {
    const workspace = workspaces[index];
    if (workspace.id === workspaceId) {
      return { index, parentId, subtree: workspace };
    }
    const nested = findWorkspaceSubtree(workspace.subspaces ?? [], workspaceId, workspace.id);
    if (nested) return nested;
  }
  return null;
}

export function restoreWorkspaceSubtree(workspaces: Workspace[], removed: RemovedWorkspaceSubtree) {
  if (findWorkspaceById(workspaces, removed.subtree.id)) return workspaces;
  const insertAt = (items: Workspace[]) => {
    const index = Math.min(removed.index, items.length);
    return [...items.slice(0, index), removed.subtree, ...items.slice(index)];
  };
  if (!removed.parentId) return insertAt(workspaces);
  if (!findWorkspaceById(workspaces, removed.parentId)) return workspaces;
  return patchWorkspaceInTree(workspaces, removed.parentId, (parent) => ({
    ...parent,
    subspaces: insertAt(parent.subspaces ?? []),
  }));
}

export function applyWorkspaceMutationProjections(
  workspaces: Workspace[],
  entries: Iterable<WorkspaceMutationEntry>,
  scope: WorkspaceMutationScope,
) {
  let projected = workspaces;
  for (const entry of entries) {
    const projection = entry.projection;
    if (entry.scope !== scope || !projection?.active) continue;
    projected = projection.kind === "delete"
      ? removeWorkspaceFromTree(projected, projection.workspaceId)
      : patchWorkspaceInTree(projected, projection.workspaceId, (workspace) => ({
          ...workspace,
          ...projection.patch,
        }));
  }
  return projected;
}

export function rebaseWorkspaceCanonicalSnapshot(
  canonical: Workspace[],
  update: (current: Workspace[]) => Workspace[],
  entries: Iterable<WorkspaceMutationEntry>,
  scope: WorkspaceMutationScope,
) {
  const nextCanonical = update(canonical);
  return {
    canonical: nextCanonical,
    projected: applyWorkspaceMutationProjections(nextCanonical, entries, scope),
  };
}

export function workspaceRefreshIsVisible(
  silent: boolean | undefined,
  active: { scope: WorkspaceMutationScope; visible: boolean } | null,
  scope: WorkspaceMutationScope,
) {
  return silent !== true || Boolean(active?.scope === scope && active.visible);
}

function workspaceMutationRelationIds(
  workspaces: Workspace[], workspaceId: string, kind: WorkspaceMutationEntry["kind"],
) {
  if (kind !== "delete") return [workspaceId];
  const target = findWorkspaceById(workspaces, workspaceId);
  return target ? flattenWorkspaces([target]).map((item) => item.id) : [workspaceId];
}

function relatedDeleteInFlight(
  entries: Iterable<WorkspaceMutationEntry>, scope: WorkspaceMutationScope,
  kind: WorkspaceMutationEntry["kind"], relatedWorkspaceIds: readonly string[],
) {
  return [...entries].some((entry) => entry.scope === scope &&
    (kind === "delete" || entry.kind === "delete") &&
    entry.relatedWorkspaceIds.some((workspaceId) => relatedWorkspaceIds.includes(workspaceId)));
}

export function runWorkspaceTreeMutation<T>(
  registry: Map<string, Promise<unknown>>, entries: Map<string, WorkspaceMutationEntry>,
  scope: WorkspaceMutationScope, workspaces: Workspace[], workspaceId: string,
  fingerprint: string, operation: () => Promise<T>, projection?: WorkspaceMutationProjection,
): Promise<T> {
  const key = `workspace:${scope.userId ?? "signed-out"}:${scope.generation}:${workspaceId}`;
  const existing = entries.get(key);
  if (existing) {
    if (existing.fingerprint === fingerprint) return existing.request as Promise<T>;
    return Promise.reject(new Error("Another change for this workspace is already in progress."));
  }
  const kind = fingerprint === "delete" ? "delete" : "rename";
  const relatedWorkspaceIds = workspaceMutationRelationIds(workspaces, workspaceId, kind);
  if (relatedDeleteInFlight(entries.values(), scope, kind, relatedWorkspaceIds)) {
    return Promise.reject(new Error("A related workspace deletion is already in progress."));
  }
  const request = runExclusiveMutation(
    registry,
    key,
    () => Promise.resolve().then(operation),
  );
  entries.set(key, { fingerprint, kind, projection, relatedWorkspaceIds, request, scope, workspaceId });
  const release = () => {
    if (entries.get(key)?.request === request) entries.delete(key);
  };
  void request.then(release, release);
  return request;
}

export function runWorkspaceCreateMutation<T>(
  registry: Map<string, Promise<unknown>>, entries: Map<string, WorkspaceMutationEntry>,
  scope: WorkspaceMutationScope, mutationKey: string, parentId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const existing = registry.get(mutationKey) as Promise<T> | undefined;
  if (existing) return existing;
  const relatedWorkspaceIds = [parentId];
  if (relatedDeleteInFlight(entries.values(), scope, "create", relatedWorkspaceIds)) {
    return Promise.reject(new Error("A related workspace deletion is already in progress."));
  }
  const request = runExclusiveMutation(registry, mutationKey,
    () => Promise.resolve().then(operation));
  const entryKey = `create:${mutationKey}`;
  entries.set(entryKey, {
    fingerprint: mutationKey, kind: "create", relatedWorkspaceIds,
    request, scope, workspaceId: parentId,
  });
  const release = () => {
    if (entries.get(entryKey)?.request === request) entries.delete(entryKey);
  };
  void request.then(release, release);
  return request;
}

type WorkspaceTreeQueryOptions = {
  force?: boolean;
};

export async function fetchWorkspaceHierarchy(options?: WorkspaceTreeQueryOptions) {
  const data = await queryGet<WorkspaceApiRecord[]>("/workspaces/hierarchy", { force: options?.force });
  return normalizeWorkspaceForest(data);
}

export async function fetchWorkspaceTree(workspaceId: string, options?: WorkspaceTreeQueryOptions) {
  const data = await queryGet<WorkspaceApiRecord>(`/workspaces/${workspaceId}/hierarchy`, { force: options?.force });
  const [tree] = normalizeWorkspaceForest([data]);
  return tree ?? null;
}

export async function fetchWorkspaceSubspaces(workspaceId: string, options?: WorkspaceTreeQueryOptions) {
  const data = await queryGet<WorkspaceApiRecord[]>(`/workspaces/${workspaceId}/subspaces`, { force: options?.force });
  return sortSubspaces(
    (data || []).map((record) => normalizeWorkspaceRecord(record, workspaceId)),
  );
}

export async function createWorkspaceRequest(
  payload: WorkspaceCreatePayload, options?: { invalidate?: boolean },
) {
  const created = await apiClient.post<WorkspaceApiRecord>("/workspaces", payload);
  if (options?.invalidate !== false) invalidateWorkspaceTreeQueries();
  const [workspace] = normalizeWorkspaceForest([created]);
  if (!workspace) {
    throw new Error("Workspace could not be created. Refresh the workspace list and try again.");
  }
  return workspace;
}

export async function createSubspaceRequest(
  parentId: string, payload: WorkspaceSubspaceCreatePayload, options?: { invalidate?: boolean },
) {
  const endpoint = `/workspaces/${parentId}/subspaces`;
  const created = await apiClient.post<WorkspaceApiRecord>(endpoint, payload);
  if (options?.invalidate !== false) invalidateWorkspaceTreeQueries(parentId);
  return normalizeWorkspaceRecord(created, parentId);
}

export async function renameWorkspaceRequest(
  workspaceId: string,
  payload: { name: string; description?: string | null },
) {
  const updated = await apiClient.patch<unknown>(`/workspaces/${workspaceId}`, payload);
  return parseWorkspaceRenameResponse(updated, workspaceId, payload);
}

export function deleteWorkspaceRequest(workspaceId: string) {
  return apiClient.delete(`/workspaces/${workspaceId}`);
}

export function invalidateWorkspaceTreeQueries(workspaceId?: string) {
  invalidateQueries("/workspaces/hierarchy");
  if (workspaceId) invalidateWorkspaceDetailQueries(workspaceId);
}

export function invalidateWorkspaceDetailQueries(workspaceId: string) {
  invalidateQueries(`/workspaces/${workspaceId}`);
}

export function workspaceSubtreeIds(workspaceId: string, subtree?: Workspace | null) {
  return [...new Set([workspaceId, ...(subtree ? flattenWorkspaces([subtree]).map((item) => item.id) : [])])];
}

export function invalidateWorkspaceSubtreeDetailQueries(workspaceId: string, subtree?: Workspace | null) {
  workspaceSubtreeIds(workspaceId, subtree).forEach(invalidateWorkspaceDetailQueries);
}
