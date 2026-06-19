import { apiClient } from "./api";
import { invalidateQueries, queryGet } from "./query";
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

export async function createWorkspaceRequest(payload: WorkspaceCreatePayload) {
  const created = await apiClient.post<WorkspaceApiRecord>("/workspaces", payload);
  invalidateWorkspaceTreeQueries();
  const [workspace] = normalizeWorkspaceForest([created]);
  if (!workspace) {
    throw new Error("Workspace could not be created. Refresh the workspace list and try again.");
  }
  return workspace;
}

export async function createSubspaceRequest(parentId: string, payload: WorkspaceSubspaceCreatePayload) {
  const endpoint = `/workspaces/${parentId}/subspaces`;
  const created = await apiClient.post<WorkspaceApiRecord>(endpoint, payload);
  invalidateWorkspaceTreeQueries(parentId);
  return normalizeWorkspaceRecord(created, parentId);
}

export function renameWorkspaceRequest(
  workspaceId: string,
  payload: { name: string; description?: string | null },
) {
  return apiClient.patch<Workspace>(`/workspaces/${workspaceId}`, payload).finally(() => {
    invalidateWorkspaceTreeQueries(workspaceId);
  });
}

export function deleteWorkspaceRequest(workspaceId: string) {
  return apiClient.delete(`/workspaces/${workspaceId}`).finally(() => {
    invalidateWorkspaceTreeQueries(workspaceId);
  });
}

export function invalidateWorkspaceTreeQueries(workspaceId?: string) {
  invalidateQueries("/workspaces/hierarchy");
  if (workspaceId) {
    invalidateQueries(`/workspaces/${workspaceId}`);
  }
}
