"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "./api";
import { useAuth } from "./auth-context";
import { isWorkspaceFounderRole } from "./workspace-roles";
import {
  getWorkspaceInviteId,
  type Workspace,
  type WorkspaceCreatePayload,
  type WorkspaceIntelligenceProfile,
  type WorkspaceIntelligenceUpdatePayload,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceRole,
  type WorkspaceSubspaceCreatePayload,
  type WorkspaceType,
} from "./workspace-types";

type RefreshOptions = {
  force?: boolean;
  silent?: boolean;
};

type WorkspaceContextType = {
  workspaces: Workspace[];
  loading: boolean;
  error: string | null;
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  activeRootWorkspace: Workspace | null;
  activeMembers: WorkspaceMember[];
  activeInvites: WorkspaceInvite[];
  pendingInvites: WorkspaceInvite[];
  activeWorkspaceIntelligence: WorkspaceIntelligenceProfile | null;
  membersLoading: boolean;
  invitesLoading: boolean;
  pendingInvitesLoading: boolean;
  intelligenceLoading: boolean;
  subspaceLoadingByParentId: Record<string, boolean>;
  subspaceErrorByParentId: Record<string, string | null>;
  setActiveWorkspace: (id: string | null) => void;
  refreshWorkspaces: (options?: RefreshOptions) => Promise<void>;
  refreshWorkspaceTree: (workspaceId: string, options?: RefreshOptions) => Promise<Workspace | null>;
  refreshWorkspaceSubspaces: (workspaceId: string, options?: RefreshOptions) => Promise<Workspace[]>;
  refreshActiveWorkspaceData: (options?: RefreshOptions) => Promise<void>;
  refreshWorkspaceIntelligence: (options?: RefreshOptions) => Promise<WorkspaceIntelligenceProfile | null>;
  updateWorkspaceIntelligence: (payload: WorkspaceIntelligenceUpdatePayload) => Promise<WorkspaceIntelligenceProfile>;
  refreshPendingInvites: (options?: RefreshOptions) => Promise<void>;
  createWorkspace: (payload: WorkspaceCreatePayload) => Promise<Workspace>;
  createSubspace: (parentId: string, payload: WorkspaceSubspaceCreatePayload) => Promise<Workspace>;
  renameWorkspace: (workspaceId: string, payload: { name: string; description?: string | null }) => Promise<Workspace>;
  deleteWorkspace: (workspaceId: string) => Promise<void>;
  inviteToActiveWorkspace: (target: string, role?: "co_owner" | "member") => Promise<void>;
  updateWorkspaceMemberRole: (userId: string, role: "co_owner" | "member") => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  revokeInvite: (inviteId: string) => Promise<void>;
  acceptInvite: (inviteId: string) => Promise<Workspace>;
  declineInvite: (inviteId: string) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function workspaceStorageKey() {
  return "omnix.activeWorkspaceId";
}

const WORKSPACE_SILENT_REFRESH_MIN_MS = 15_000;
const PENDING_INVITES_POLL_INTERVAL_MS = 60_000;
const PENDING_INVITES_SILENT_REFRESH_MIN_MS = 30_000;
const ACTIVE_WORKSPACE_DATA_MIN_MS = 45_000;

const inviteStatusRank: Record<WorkspaceInvite["status"], number> = {
  pending: 0,
  accepted: 1,
  declined: 2,
  revoked: 3,
};

function inviteTimestamp(invite: WorkspaceInvite) {
  return Date.parse(invite.updated_at || invite.created_at || "") || 0;
}

function sortWorkspaceInvites(invites: WorkspaceInvite[]) {
  return [...invites].sort((a, b) => {
    const statusDelta = inviteStatusRank[a.status] - inviteStatusRank[b.status];
    if (statusDelta !== 0) return statusDelta;
    return inviteTimestamp(b) - inviteTimestamp(a);
  });
}

function reconcileWorkspaceInvites(current: WorkspaceInvite[], incoming: WorkspaceInvite[]) {
  const incomingIds = new Set(incoming.map((invite) => getWorkspaceInviteId(invite)));
  const byId = new Map<string, WorkspaceInvite>();

  incoming.forEach((invite) => {
    byId.set(getWorkspaceInviteId(invite), invite);
  });

  current.forEach((invite) => {
    const inviteId = getWorkspaceInviteId(invite);
    if (invite.status === "pending" && !incomingIds.has(inviteId)) {
      byId.set(inviteId, invite);
    }
  });

  return sortWorkspaceInvites(Array.from(byId.values()));
}

type WorkspaceApiRecord = Partial<Workspace> & {
  id: string;
  name?: string | null;
};

function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
  if (role === "founder" || role === "owner" || role === "co_owner" || role === "member") {
    return role;
  }
  return "member";
}

function normalizeWorkspaceType(value: unknown, parentWorkspaceId?: string | null): WorkspaceType {
  if (value === "workspace" || value === "super" || value === "sub") {
    return value;
  }
  return parentWorkspaceId ? "sub" : "workspace";
}

function normalizeWorkspaceRecord(record: WorkspaceApiRecord, parentFromTree?: string | null): Workspace {
  const parentWorkspaceId =
    record.parent_workspace_id === undefined
      ? parentFromTree ?? null
      : record.parent_workspace_id || null;
  const membersPreview = Array.isArray(record.members_preview) ? record.members_preview : [];
  const memberCount =
    typeof record.member_count === "number"
      ? record.member_count
      : membersPreview.length;

  return {
    id: String(record.id),
    user_id: String(record.user_id ?? ""),
    name: String(record.name || "Untitled workspace"),
    description: record.description ?? null,
    parent_workspace_id: parentWorkspaceId,
    workspace_type: normalizeWorkspaceType(record.workspace_type, parentWorkspaceId),
    is_global: Boolean(record.is_global),
    expertise_area: record.expertise_area ?? null,
    ai_specialization:
      record.ai_specialization === "research" ||
      record.ai_specialization === "coding" ||
      record.ai_specialization === "design" ||
      record.ai_specialization === "strategy" ||
      record.ai_specialization === "analytics" ||
      record.ai_specialization === "general"
        ? record.ai_specialization
        : "general",
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

function sortSubspaces(subspaces: Workspace[]) {
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

function normalizeWorkspaceForest(records: WorkspaceApiRecord[] | null | undefined) {
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

    roots.push(workspace);
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

function flattenWorkspaces(workspaces: Workspace[]) {
  const flattened: Workspace[] = [];

  function visit(workspace: Workspace) {
    flattened.push(workspace);
    workspace.subspaces?.forEach(visit);
  }

  workspaces.forEach(visit);
  return flattened;
}

function findWorkspaceById(workspaces: Workspace[], workspaceId: string | null) {
  if (!workspaceId) {
    return null;
  }

  return flattenWorkspaces(workspaces).find((workspace) => workspace.id === workspaceId) ?? null;
}

function findRootWorkspaceById(workspaces: Workspace[], workspaceId: string | null) {
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

function upsertWorkspaceTree(workspaces: Workspace[], tree: Workspace) {
  const withoutTree = workspaces.filter((workspace) => workspace.id !== tree.id);
  const existingIndex = workspaces.findIndex((workspace) => workspace.id === tree.id);
  if (existingIndex === -1) {
    return [tree, ...withoutTree];
  }

  return workspaces.map((workspace) => (workspace.id === tree.id ? tree : workspace));
}

function updateWorkspaceSubspaces(workspaces: Workspace[], parentId: string, subspaces: Workspace[]): Workspace[] {
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

function patchWorkspaceInTree(
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

function removeWorkspaceFromTree(workspaces: Workspace[], workspaceId: string): Workspace[] {
  return workspaces
    .filter((workspace) => workspace.id !== workspaceId)
    .map((workspace) => ({
      ...workspace,
      subspaces: workspace.subspaces?.length
        ? removeWorkspaceFromTree(workspace.subspaces, workspaceId)
        : [],
    }));
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeMembers, setActiveMembers] = useState<WorkspaceMember[]>([]);
  const [activeInvites, setActiveInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [activeWorkspaceIntelligence, setActiveWorkspaceIntelligence] = useState<WorkspaceIntelligenceProfile | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [subspaceLoadingByParentId, setSubspaceLoadingByParentId] = useState<Record<string, boolean>>({});
  const [subspaceErrorByParentId, setSubspaceErrorByParentId] = useState<Record<string, string | null>>({});
  const workspaceFetchIdRef = useRef(0);
  const createWorkspaceInFlightRef = useRef<Map<string, Promise<Workspace>>>(new Map());
  const workspaceRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const workspaceTreeRefreshInFlightRef = useRef<Map<string, Promise<Workspace | null>>>(new Map());
  const subspaceRefreshInFlightRef = useRef<Map<string, Promise<Workspace[]>>>(new Map());
  const pendingInvitesInFlightRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceDataInFlightRef = useRef<Promise<void> | null>(null);
  const workspaceIntelligenceInFlightRef = useRef<Promise<WorkspaceIntelligenceProfile | null> | null>(null);
  const lastWorkspaceRefreshAtRef = useRef(0);
  const lastPendingInvitesRefreshAtRef = useRef(0);
  const lastActiveWorkspaceDataRefreshAtRef = useRef(0);

  const activeWorkspace = useMemo(
    () => findWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const activeRootWorkspace = useMemo(
    () => findRootWorkspaceById(workspaces, activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  const setActiveWorkspace = useCallback((id: string | null) => {
    console.debug("[workspace] set active workspace", { id });
    setActiveWorkspaceId(id);
    try {
      if (typeof window !== "undefined") {
        if (id) {
          window.localStorage.setItem(workspaceStorageKey(), id);
        } else {
          window.localStorage.removeItem(workspaceStorageKey());
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const refreshWorkspaces = useCallback(async (options?: RefreshOptions) => {
    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastWorkspaceRefreshAtRef.current < WORKSPACE_SILENT_REFRESH_MIN_MS
    ) {
      return;
    }

    if (workspaceRefreshInFlightRef.current) {
      return workspaceRefreshInFlightRef.current;
    }

    const requestId = workspaceFetchIdRef.current + 1;
    workspaceFetchIdRef.current = requestId;

    const request = (async () => {
      try {
        if (!options?.silent) {
          setLoading(true);
        }
        let data: WorkspaceApiRecord[] = [];
        try {
          data = await apiClient.get<WorkspaceApiRecord[]>("/workspaces/hierarchy");
        } catch (hierarchyError) {
          console.warn("[workspace] hierarchy fetch failed; falling back to flat workspaces", hierarchyError);
          data = await apiClient.get<WorkspaceApiRecord[]>("/workspaces");
        }
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        setWorkspaces(normalizeWorkspaceForest(data));
        setError(null);
        lastWorkspaceRefreshAtRef.current = Date.now();
      } catch (err) {
        if (workspaceFetchIdRef.current !== requestId) {
          return;
        }
        setError(err instanceof Error ? err.message : "Failed to load workspaces");
        if (!options?.silent) {
          setWorkspaces([]);
        }
      } finally {
        if (workspaceFetchIdRef.current === requestId && !options?.silent) {
          setLoading(false);
        }
        workspaceRefreshInFlightRef.current = null;
      }
    })();

    workspaceRefreshInFlightRef.current = request;
    return request;
  }, []);

  const refreshWorkspaceTree = useCallback(async (workspaceId: string, options?: RefreshOptions) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return null;
    }

    const inFlight = workspaceTreeRefreshInFlightRef.current.get(normalizedWorkspaceId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        const data = await apiClient.get<WorkspaceApiRecord>(`/workspaces/${normalizedWorkspaceId}/hierarchy`);
        const [tree] = normalizeWorkspaceForest([data]);
        if (tree) {
          setWorkspaces((current) => upsertWorkspaceTree(current, tree));
        }
        return tree ?? null;
      } catch (err) {
        if (!options?.silent) {
          setError(err instanceof Error ? err.message : "Failed to load workspace hierarchy");
        }
        return null;
      } finally {
        workspaceTreeRefreshInFlightRef.current.delete(normalizedWorkspaceId);
      }
    })();

    workspaceTreeRefreshInFlightRef.current.set(normalizedWorkspaceId, request);
    return request;
  }, []);

  const refreshWorkspaceSubspaces = useCallback(async (workspaceId: string, options?: RefreshOptions) => {
    const normalizedWorkspaceId = workspaceId.trim();
    if (!normalizedWorkspaceId) {
      return [];
    }

    const inFlight = subspaceRefreshInFlightRef.current.get(normalizedWorkspaceId);
    if (inFlight) {
      return inFlight;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: true }));
        }
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: null }));
        const data = await apiClient.get<WorkspaceApiRecord[]>(`/workspaces/${normalizedWorkspaceId}/subspaces`);
        const subspaces = sortSubspaces(
          (data || []).map((record) => normalizeWorkspaceRecord(record, normalizedWorkspaceId)),
        );
        setWorkspaces((current) => updateWorkspaceSubspaces(current, normalizedWorkspaceId, subspaces));
        return subspaces;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to load subspaces";
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: message }));
        if (!options?.silent) {
          console.error("Failed to load workspace subspaces", err);
        }
        return [];
      } finally {
        if (!options?.silent) {
          setSubspaceLoadingByParentId((current) => ({ ...current, [normalizedWorkspaceId]: false }));
        }
        subspaceRefreshInFlightRef.current.delete(normalizedWorkspaceId);
      }
    })();

    subspaceRefreshInFlightRef.current.set(normalizedWorkspaceId, request);
    return request;
  }, []);

  const refreshPendingInvites = useCallback(async (options?: RefreshOptions) => {
    if (!user) {
      setPendingInvites([]);
      return;
    }

    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastPendingInvitesRefreshAtRef.current < PENDING_INVITES_SILENT_REFRESH_MIN_MS
    ) {
      return;
    }

    if (pendingInvitesInFlightRef.current) {
      return pendingInvitesInFlightRef.current;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setPendingInvitesLoading(true);
        }
        const data = await apiClient.get<WorkspaceInvite[]>("/workspace-invites");
        setPendingInvites(sortWorkspaceInvites(data || []));
        lastPendingInvitesRefreshAtRef.current = Date.now();
      } catch (err) {
        console.error("Failed to load pending invites", err);
      } finally {
        if (!options?.silent) {
          setPendingInvitesLoading(false);
        }
        pendingInvitesInFlightRef.current = null;
      }
    })();

    pendingInvitesInFlightRef.current = request;
    return request;
  }, [user]);

  const refreshActiveWorkspaceData = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveMembers([]);
      setActiveInvites([]);
      return;
    }

    if (!activeWorkspace) {
      setActiveMembers([]);
      return;
    }

    const now = Date.now();
    if (
      options?.silent &&
      !options.force &&
      now - lastActiveWorkspaceDataRefreshAtRef.current < ACTIVE_WORKSPACE_DATA_MIN_MS
    ) {
      return;
    }

    if (activeWorkspaceDataInFlightRef.current) {
      return activeWorkspaceDataInFlightRef.current;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setMembersLoading(true);
        }
        const members = await apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`);
        setActiveMembers(members || []);
      } catch (err) {
        console.error("Failed to load workspace members", err);
        if (!options?.silent) {
          setActiveMembers([]);
        }
      } finally {
        if (!options?.silent) {
          setMembersLoading(false);
        }
      }

      if (!isWorkspaceFounderRole(activeWorkspace.current_user_role)) {
        setActiveInvites([]);
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
        activeWorkspaceDataInFlightRef.current = null;
        return;
      }

      try {
        if (!options?.silent) {
          setInvitesLoading(true);
        }
        const invites = await apiClient.get<WorkspaceInvite[]>(`/workspaces/${activeWorkspaceId}/invites`);
        setActiveInvites((current) => reconcileWorkspaceInvites(current, invites || []));
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
      } catch (err) {
        console.error("Failed to load workspace invites", err);
      } finally {
        if (!options?.silent) {
          setInvitesLoading(false);
        }
        activeWorkspaceDataInFlightRef.current = null;
      }
    })();

    activeWorkspaceDataInFlightRef.current = request;
    return request;
  }, [activeWorkspace, activeWorkspaceId]);

  const refreshWorkspaceIntelligence = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveWorkspaceIntelligence(null);
      return null;
    }

    if (workspaceIntelligenceInFlightRef.current) {
      return workspaceIntelligenceInFlightRef.current;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setIntelligenceLoading(true);
        }
        const profile = await apiClient.get<WorkspaceIntelligenceProfile>(`/workspaces/${activeWorkspaceId}/intelligence`);
        setActiveWorkspaceIntelligence(profile);
        return profile;
      } catch (err) {
        console.error("Failed to load workspace intelligence", err);
        if (!options?.silent) {
          setActiveWorkspaceIntelligence(null);
        }
        return null;
      } finally {
        if (!options?.silent) {
          setIntelligenceLoading(false);
        }
        workspaceIntelligenceInFlightRef.current = null;
      }
    })();

    workspaceIntelligenceInFlightRef.current = request;
    return request;
  }, [activeWorkspaceId]);

  const updateWorkspaceIntelligence = useCallback(async (payload: WorkspaceIntelligenceUpdatePayload) => {
    if (!activeWorkspaceId) {
      throw new Error("Select a workspace first.");
    }
    const profile = await apiClient.patch<WorkspaceIntelligenceProfile>(
      `/workspaces/${activeWorkspaceId}/intelligence`,
      payload,
    );
    setActiveWorkspaceIntelligence(profile);
    setWorkspaces((current) =>
      patchWorkspaceInTree(current, activeWorkspaceId, (workspace) => ({
        ...workspace,
        expertise_area: profile.expertise_area ?? null,
        ai_specialization: profile.ai_specialization,
        ai_instructions: profile.ai_instructions ?? null,
        intelligence_preferences: profile.intelligence_preferences ?? {},
      })),
    );
    return profile;
  }, [activeWorkspaceId]);

  const createWorkspace = useCallback(async (payload: WorkspaceCreatePayload) => {
    const normalizedPayload = {
      ...payload,
      name: payload.name.trim(),
    };
    const inFlightKey = `${normalizedPayload.name.toLowerCase()}::${normalizedPayload.description ?? ""}::${normalizedPayload.workspace_type ?? "workspace"}::${normalizedPayload.parent_workspace_id ?? ""}`;
    const inFlight = createWorkspaceInFlightRef.current.get(inFlightKey);
    if (inFlight) {
      console.debug("[workspace] create deduped while request is in flight", { name: normalizedPayload.name });
      return inFlight;
    }

    console.debug("[workspace] explicit create requested", { name: normalizedPayload.name });
    const request = apiClient
      .post<WorkspaceApiRecord>("/workspaces", normalizedPayload)
      .then((created) => {
        const [workspace] = normalizeWorkspaceForest([created]);
        if (!workspace) {
          throw new Error("Workspace could not be created.");
        }
        console.debug("[workspace] create success", { id: workspace.id, name: workspace.name });
        setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
        if (workspace.workspace_type === "super") {
          void refreshWorkspaceTree(workspace.id, { silent: true });
        }
        return workspace;
      })
      .finally(() => {
        createWorkspaceInFlightRef.current.delete(inFlightKey);
      });

    createWorkspaceInFlightRef.current.set(inFlightKey, request);
    return request;
  }, [refreshWorkspaceTree]);

  const createSubspace = useCallback(async (parentId: string, payload: WorkspaceSubspaceCreatePayload) => {
    const normalizedPayload = { ...payload, name: payload.name.trim() };
    if (!normalizedPayload.name) {
      throw new Error("Subspace name cannot be empty.");
    }
    const endpoint = `/workspaces/${parentId}/subspaces`;
    const created = await apiClient.post<WorkspaceApiRecord>(endpoint, normalizedPayload);
    const workspace = normalizeWorkspaceRecord(created, parentId);
    setWorkspaces((current) =>
      updateWorkspaceSubspaces(
        current,
        parentId,
        sortSubspaces([workspace, ...(findWorkspaceById(current, parentId)?.subspaces ?? [])].filter((item, index, items) =>
          items.findIndex((candidate) => candidate.id === item.id) === index,
        )),
      ),
    );
    const refreshed = await refreshWorkspaceTree(parentId, { force: true, silent: true });
    if (!refreshed) {
      await refreshWorkspaces({ force: true, silent: true });
    }
    return workspace;
  }, [refreshWorkspaceTree, refreshWorkspaces]);

  const renameWorkspace = useCallback(async (workspaceId: string, payload: { name: string; description?: string | null }) => {
    const nextName = payload.name.trim();
    if (!nextName) {
      throw new Error("Workspace name cannot be empty.");
    }

    console.debug("[workspace] rename requested", { workspaceId, nextName });
    const previousWorkspaces = workspaces;

    setWorkspaces((current) =>
      patchWorkspaceInTree(current, workspaceId, (workspace) => ({
        ...workspace,
        name: nextName,
        description: payload.description ?? workspace.description,
      })),
    );

    try {
      const updated = await apiClient.patch<Workspace>(`/workspaces/${workspaceId}`, {
        ...payload,
        name: nextName,
      });
      console.debug("[workspace] rename success", { workspaceId, name: updated.name });
      void refreshWorkspaces({ force: true, silent: true });
      return updated;
    } catch (err) {
      console.debug("[workspace] rename failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      throw err;
    }
  }, [workspaces, refreshWorkspaces]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    console.debug("[workspace] delete requested", { workspaceId });
    const previousWorkspaces = workspaces;
    const remainingWorkspaces = removeWorkspaceFromTree(workspaces, workspaceId);
    setWorkspaces(remainingWorkspaces);

    if (!findWorkspaceById(remainingWorkspaces, activeWorkspaceId)) {
      setActiveWorkspace(flattenWorkspaces(remainingWorkspaces)[0]?.id ?? null);
      setActiveMembers([]);
      setActiveInvites([]);
    }

    try {
      await apiClient.delete(`/workspaces/${workspaceId}`);
      console.debug("[workspace] delete success", { workspaceId });
      await refreshWorkspaces({ force: true });
    } catch (err) {
      console.debug("[workspace] delete failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspace(workspaceId);
      }
      throw err;
    }
  }, [activeWorkspaceId, refreshWorkspaces, setActiveWorkspace, workspaces]);

  const inviteToActiveWorkspace = useCallback(
    async (target: string, role: "co_owner" | "member" = "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const invite = await apiClient.post<WorkspaceInvite>(`/workspaces/${activeWorkspaceId}/invites`, {
        email: target,
        role,
      });
      const nextInviteId = getWorkspaceInviteId(invite);
      setActiveInvites((current) =>
        sortWorkspaceInvites([
          invite,
          ...current.filter((item) => getWorkspaceInviteId(item) !== nextInviteId),
        ]),
      );
    },
    [activeWorkspaceId],
  );

  const removeWorkspaceMember = useCallback(
    async (userId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      await apiClient.delete(`/workspaces/${activeWorkspaceId}/members/${userId}`);
      setActiveMembers((current) => current.filter((member) => member.user_id !== userId));
      await refreshWorkspaces({ force: true });
    },
    [activeWorkspaceId, refreshWorkspaces],
  );

  const updateWorkspaceMemberRole = useCallback(
    async (userId: string, role: "co_owner" | "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const previousMembers = activeMembers;
      setActiveMembers((current) =>
        current.map((member) =>
          member.user_id === userId
            ? { ...member, role, updated_at: new Date().toISOString() }
            : member,
        ),
      );

      try {
        const updated = await apiClient.patch<WorkspaceMember>(
          `/workspaces/${activeWorkspaceId}/members/${userId}`,
          { role },
        );
        setActiveMembers((current) =>
          current.map((member) => (member.user_id === userId ? updated : member)),
        );
        await refreshWorkspaces({ force: true, silent: true });
        return updated;
      } catch (err) {
        setActiveMembers(previousMembers);
        throw err;
      }
    },
    [activeMembers, activeWorkspaceId, refreshWorkspaces],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      await apiClient.delete(`/workspaces/${activeWorkspaceId}/invites/${inviteId}`);
      setActiveInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
    },
    [activeWorkspaceId],
  );

  const acceptInvite = useCallback(
    async (inviteId: string) => {
      const created = await apiClient.post<WorkspaceApiRecord>(`/workspace-invites/${inviteId}/accept`);
      const [workspace] = normalizeWorkspaceForest([created]);
      if (!workspace) {
        throw new Error("Invite was accepted, but the workspace could not be loaded.");
      }
      setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
      setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
      setActiveWorkspace(workspace.id);
      await refreshWorkspaces({ force: true });
      return workspace;
    },
    [refreshWorkspaces, setActiveWorkspace],
  );

  const declineInvite = useCallback(
    async (inviteId: string) => {
      await apiClient.post(`/workspace-invites/${inviteId}/decline`);
      setPendingInvites((current) => current.filter((invite) => getWorkspaceInviteId(invite) !== inviteId));
    },
    [],
  );

  useEffect(() => {
    if (!user) {
      workspaceFetchIdRef.current += 1;
      createWorkspaceInFlightRef.current.clear();
      workspaceTreeRefreshInFlightRef.current.clear();
      subspaceRefreshInFlightRef.current.clear();
      setWorkspaces([]);
      setActiveWorkspace(null);
      setActiveMembers([]);
      setActiveInvites([]);
      setPendingInvites([]);
      setActiveWorkspaceIntelligence(null);
      setSubspaceLoadingByParentId({});
      setSubspaceErrorByParentId({});
      setLoading(false);
      return;
    }

    refreshWorkspaces({ force: true });
    refreshPendingInvites({ force: true });

    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(workspaceStorageKey()) : null;
      console.debug("[workspace] hydration read saved active workspace", { saved });
      if (saved) {
        setActiveWorkspaceId(saved);
      }
    } catch {
      // ignore
    }
  }, [refreshPendingInvites, refreshWorkspaces, setActiveWorkspace, user]);

  useEffect(() => {
    if (!user) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "hidden") {
        void refreshPendingInvites({ silent: true });
      }
    }, PENDING_INVITES_POLL_INTERVAL_MS);

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void refreshPendingInvites({ silent: true });
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPendingInvites, user]);

  useEffect(() => {
    if (!user || loading) {
      return;
    }

    if (error && workspaces.length === 0) {
      console.debug("[workspace] fetch failed; preserving active workspace id during failure state");
      return;
    }

    if (workspaces.length === 0) {
      console.debug("[workspace] no workspaces after verified fetch; waiting for explicit create");
      if (activeWorkspaceId) {
        setActiveWorkspace(null);
      }
      return;
    }

    const activeExists = Boolean(findWorkspaceById(workspaces, activeWorkspaceId));
    if (!activeExists) {
      const nextWorkspaceId = flattenWorkspaces(workspaces)[0]?.id ?? null;
      console.debug("[workspace] saved active workspace missing; selecting first available workspace", {
        activeWorkspaceId,
        nextWorkspaceId,
      });
      setActiveWorkspace(nextWorkspaceId);
    }
  }, [activeWorkspaceId, error, loading, setActiveWorkspace, user, workspaces]);

  useEffect(() => {
    lastActiveWorkspaceDataRefreshAtRef.current = 0;
    activeWorkspaceDataInFlightRef.current = null;
    void refreshActiveWorkspaceData({ force: true });
  }, [refreshActiveWorkspaceData]);

  useEffect(() => {
    workspaceIntelligenceInFlightRef.current = null;
    void refreshWorkspaceIntelligence({ force: true });
  }, [refreshWorkspaceIntelligence]);

  const value = useMemo(
    () => ({
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeRootWorkspace,
      activeMembers,
      activeInvites,
      pendingInvites,
      activeWorkspaceIntelligence,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      intelligenceLoading,
      subspaceLoadingByParentId,
      subspaceErrorByParentId,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshWorkspaceTree,
      refreshWorkspaceSubspaces,
      refreshActiveWorkspaceData,
      refreshWorkspaceIntelligence,
      updateWorkspaceIntelligence,
      refreshPendingInvites,
      createWorkspace,
      createSubspace,
      renameWorkspace,
      deleteWorkspace,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    }),
    [
      workspaces,
      loading,
      error,
      activeWorkspaceId,
      activeWorkspace,
      activeRootWorkspace,
      activeMembers,
      activeInvites,
      pendingInvites,
      activeWorkspaceIntelligence,
      membersLoading,
      invitesLoading,
      pendingInvitesLoading,
      intelligenceLoading,
      subspaceLoadingByParentId,
      subspaceErrorByParentId,
      setActiveWorkspace,
      refreshWorkspaces,
      refreshWorkspaceTree,
      refreshWorkspaceSubspaces,
      refreshActiveWorkspaceData,
      refreshWorkspaceIntelligence,
      updateWorkspaceIntelligence,
      refreshPendingInvites,
      createWorkspace,
      createSubspace,
      renameWorkspace,
      deleteWorkspace,
      inviteToActiveWorkspace,
      updateWorkspaceMemberRole,
      removeWorkspaceMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
