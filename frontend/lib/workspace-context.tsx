"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { apiClient, setApiWorkspaceId } from "./api";
import { useAuth } from "./auth-context";
import { logClientError } from "./errors";
import { logger } from "./logger";
import { isWorkspaceFounderRole } from "./workspace-roles";
import {
  getWorkspaceInviteId,
  type Workspace,
  type WorkspaceCreatePayload,
  type WorkspaceIntelligenceProfile,
  type WorkspaceIntelligenceUpdatePayload,
  type WorkspaceInvite,
  type WorkspaceMember,
  type WorkspaceMemberAssign,
  type WorkspaceRole,
  type WorkspaceSubspaceCreatePayload,
  type WorkspaceType,
  type WorkspaceFocus,
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
  intelligenceError: string | null;
  membersError: string | null;
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
  inviteToActiveWorkspace: (target: string, role?: WorkspaceRole) => Promise<void>;
  updateWorkspaceMemberRole: (userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  removeWorkspaceMember: (userId: string) => Promise<void>;
  assignWorkspaceMember: (payload: WorkspaceMemberAssign) => Promise<WorkspaceMember>;
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

type WorkspaceApiRecord = Omit<Partial<Workspace>, "workspace_focus" | "ai_specialization" | "subspaces"> & {
  id: string;
  name?: string | null;
  workspace_focus?: unknown;
  ai_specialization?: unknown;
  subspaces?: WorkspaceApiRecord[];
};

function normalizeWorkspaceRole(role: unknown): WorkspaceRole {
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
  const userId = user?.id ?? null;
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeMembers, setActiveMembers] = useState<WorkspaceMember[]>([]);
  const [activeInvites, setActiveInvites] = useState<WorkspaceInvite[]>([]);
  const [pendingInvites, setPendingInvites] = useState<WorkspaceInvite[]>([]);
  const [activeWorkspaceIntelligence, setActiveWorkspaceIntelligence] = useState<WorkspaceIntelligenceProfile | null>(null);
  const [intelligenceError, setIntelligenceError] = useState<string | null>(null);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [pendingInvitesLoading, setPendingInvitesLoading] = useState(false);
  const [intelligenceLoading, setIntelligenceLoading] = useState(false);
  const [subspaceLoadingByParentId, setSubspaceLoadingByParentId] = useState<Record<string, boolean>>({});
  const [subspaceErrorByParentId, setSubspaceErrorByParentId] = useState<Record<string, string | null>>({});
  
  const requestGenerationRef = useRef(0);
  const workspaceFetchIdRef = useRef(0);
  
  const createWorkspaceInFlightRef = useRef<Map<string, Promise<Workspace>>>(new Map());
  const workspaceRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const workspaceTreeRefreshInFlightRef = useRef<Map<string, Promise<Workspace | null>>>(new Map());
  const subspaceRefreshInFlightRef = useRef<Map<string, Promise<Workspace[]>>>(new Map());
  const pendingInvitesInFlightRef = useRef<Promise<void> | null>(null);
  const activeWorkspaceDataInFlightRef = useRef<{ 
    workspaceId: string; 
    generation: number;
    request: Promise<void> 
  } | null>(null);
  const workspaceIntelligenceInFlightRef = useRef<{
    workspaceId: string;
    generation: number;
    request: Promise<WorkspaceIntelligenceProfile | null>;
  } | null>(null);
  const activeWorkspaceIdRef = useRef<string | null>(activeWorkspaceId);
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

  useEffect(() => {
    activeWorkspaceIdRef.current = activeWorkspaceId;
    requestGenerationRef.current += 1; // Increment generation on workspace switch
  }, [activeWorkspaceId]);

  const setActiveWorkspace = useCallback((id: string | null) => {
    logger.debug("[workspace] set active workspace", { id });
    if (id !== activeWorkspaceIdRef.current) {
      requestGenerationRef.current += 1;
    }
    setActiveWorkspaceId(id);
    setApiWorkspaceId(id);
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
        const data = await apiClient.get<WorkspaceApiRecord[]>("/workspaces/hierarchy");
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
        logClientError("[workspace] failed to load hierarchy", err, { endpoint: "/workspaces/hierarchy" });
        setError("Unable to load workspaces.");
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
          logClientError("[workspace] failed to load workspace hierarchy", err, { endpoint: `/workspaces/${normalizedWorkspaceId}/hierarchy` });
          setError("Unable to load workspaces.");
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
        setSubspaceErrorByParentId((current) => ({ ...current, [normalizedWorkspaceId]: "Unable to load subspaces." }));
        if (!options?.silent) {
          logClientError("Failed to load workspace subspaces", err, { endpoint: `/workspaces/${normalizedWorkspaceId}/subspaces` });
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
    if (!userId) {
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
        logClientError("Failed to load pending invites", err, { endpoint: "/workspace-invites" });
      } finally {
        if (!options?.silent) {
          setPendingInvitesLoading(false);
        }
        pendingInvitesInFlightRef.current = null;
      }
    })();

    pendingInvitesInFlightRef.current = request;
    return request;
  }, [userId]);

  const refreshActiveWorkspaceData = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveMembers([]);
      setMembersError(null);
      setActiveInvites([]);
      return;
    }

    if (!activeWorkspace) {
      setActiveMembers([]);
      setMembersError(null);
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

    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;
    
    if (
      activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId &&
      activeWorkspaceDataInFlightRef.current?.generation === generation
    ) {
      return activeWorkspaceDataInFlightRef.current.request;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setMembersLoading(true);
        }
        const members = await apiClient.get<WorkspaceMember[]>(`/workspaces/${requestWorkspaceId}/members`);
        
        // Discard if workspace or generation changed
        if (
          activeWorkspaceIdRef.current !== requestWorkspaceId || 
          requestGenerationRef.current !== generation
        ) {
          return;
        }
        
        setActiveMembers(members || []);
        setMembersError(null);
      } catch (err) {
        logClientError("Failed to load workspace members", err, { endpoint: `/workspaces/${requestWorkspaceId}/members` });
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveMembers([]);
          setMembersError("Unable to load team members.");
        }
      } finally {
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setMembersLoading(false);
        }
      }

      if (!isWorkspaceFounderRole(activeWorkspace.current_user_role)) {
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveInvites([]);
        }
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
        if (activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId) {
          activeWorkspaceDataInFlightRef.current = null;
        }
        return;
      }

      try {
        if (!options?.silent) {
          setInvitesLoading(true);
        }
        const invites = await apiClient.get<WorkspaceInvite[]>(`/workspaces/${requestWorkspaceId}/invites`);
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveInvites((current) => reconcileWorkspaceInvites(current, invites || []));
        }
        lastActiveWorkspaceDataRefreshAtRef.current = Date.now();
      } catch (err) {
        logClientError("Failed to load workspace invites", err, { endpoint: `/workspaces/${requestWorkspaceId}/invites` });
      } finally {
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setInvitesLoading(false);
        }
        if (activeWorkspaceDataInFlightRef.current?.workspaceId === requestWorkspaceId) {
          activeWorkspaceDataInFlightRef.current = null;
        }
      }
    })();

    activeWorkspaceDataInFlightRef.current = { workspaceId: requestWorkspaceId, generation, request };
    return request;
  }, [activeWorkspace, activeWorkspaceId]);

  const refreshWorkspaceIntelligence = useCallback(async (options?: RefreshOptions) => {
    if (!activeWorkspaceId) {
      setActiveWorkspaceIntelligence(null);
      setIntelligenceError(null);
      return null;
    }

    const requestWorkspaceId = activeWorkspaceId;
    const generation = requestGenerationRef.current;

    if (
      workspaceIntelligenceInFlightRef.current?.workspaceId === requestWorkspaceId &&
      workspaceIntelligenceInFlightRef.current?.generation === generation
    ) {
      return workspaceIntelligenceInFlightRef.current.request;
    }

    const request = (async () => {
      try {
        if (!options?.silent) {
          setIntelligenceLoading(true);
        }
        const profile = await apiClient.get<WorkspaceIntelligenceProfile>(`/workspaces/${requestWorkspaceId}/intelligence`);
        if (
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveWorkspaceIntelligence(profile);
          setIntelligenceError(null);
        }
        return profile;
      } catch (err) {
        logClientError("Failed to load workspace intelligence", err, { endpoint: `/workspaces/${requestWorkspaceId}/intelligence` });
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setActiveWorkspaceIntelligence(null);
          setIntelligenceError("Unable to load workspace intelligence.");
        }
        return null;
      } finally {
        if (
          !options?.silent && 
          activeWorkspaceIdRef.current === requestWorkspaceId &&
          requestGenerationRef.current === generation
        ) {
          setIntelligenceLoading(false);
        }
        if (workspaceIntelligenceInFlightRef.current?.workspaceId === requestWorkspaceId) {
          workspaceIntelligenceInFlightRef.current = null;
        }
      }
    })();

    workspaceIntelligenceInFlightRef.current = { workspaceId: requestWorkspaceId, generation, request };
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
        workspace_focus: profile.workspace_focus,
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
      logger.debug("[workspace] create deduped while request is in flight", { name: normalizedPayload.name });
      return inFlight;
    }

    logger.debug("[workspace] explicit create requested", { name: normalizedPayload.name });
    const request = apiClient
      .post<WorkspaceApiRecord>("/workspaces", normalizedPayload)
      .then((created) => {
        const [workspace] = normalizeWorkspaceForest([created]);
        if (!workspace) {
          throw new Error("Workspace could not be created.");
        }
        logger.debug("[workspace] create success", { id: workspace.id, name: workspace.name });
        setWorkspaces((current) => [workspace, ...current.filter((item) => item.id !== workspace.id)]);
        if (workspace.workspace_type === "super_workspace") {
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

    logger.debug("[workspace] rename requested", { workspaceId, nextName });
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
      logger.debug("[workspace] rename success", { workspaceId, name: updated.name });
      void refreshWorkspaces({ force: true, silent: true });
      return updated;
    } catch (err) {
      logger.debug("[workspace] rename failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      throw err;
    }
  }, [workspaces, refreshWorkspaces]);

  const deleteWorkspace = useCallback(async (workspaceId: string) => {
    logger.debug("[workspace] delete requested", { workspaceId });
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
      logger.debug("[workspace] delete success", { workspaceId });
      await refreshWorkspaces({ force: true });
    } catch (err) {
      logger.debug("[workspace] delete failed; rolling back", { workspaceId, err });
      setWorkspaces(previousWorkspaces);
      if (activeWorkspaceId === workspaceId) {
        setActiveWorkspace(workspaceId);
      }
      throw err;
    }
  }, [activeWorkspaceId, refreshWorkspaces, setActiveWorkspace, workspaces]);

  const inviteToActiveWorkspace = useCallback(
    async (target: string, role: WorkspaceRole = "member") => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const invite = await apiClient.post<WorkspaceInvite>(`/workspaces/${requestWorkspaceId}/invites`, {
        email: target,
        role,
      });
      const nextInviteId = getWorkspaceInviteId(invite);
      if (activeWorkspaceIdRef.current === requestWorkspaceId) {
        setActiveInvites((current) =>
          sortWorkspaceInvites([
            invite,
            ...current.filter((item) => getWorkspaceInviteId(item) !== nextInviteId),
          ]),
        );
        await refreshActiveWorkspaceData({ force: true, silent: true });
      }
    },
    [activeWorkspaceId, refreshActiveWorkspaceData],
  );

  const removeWorkspaceMember = useCallback(
    async (userId: string) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;

      setActiveMembers((current) => current.filter((member) => member.user_id !== userId));

      try {
        await apiClient.delete(`/workspaces/${requestWorkspaceId}/members/${userId}`);
        await refreshWorkspaces({ force: true, silent: true });
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
      } catch (err) {
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [activeMembers, activeWorkspaceId, refreshActiveWorkspaceData, refreshWorkspaces],
  );

  const updateWorkspaceMemberRole = useCallback(
    async (userId: string, role: WorkspaceRole) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      if (activeWorkspaceIdRef.current === requestWorkspaceId) {
        setActiveMembers((current) =>
          current.map((member) =>
            member.user_id === userId
              ? { ...member, role, updated_at: new Date().toISOString() }
              : member,
          ),
        );
      }

      try {
        const updated = await apiClient.patch<WorkspaceMember>(
          `/workspaces/${requestWorkspaceId}/members/${userId}`,
          { role },
        );
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers((current) =>
            current.map((member) => (member.user_id === userId ? updated : member)),
          );
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        await refreshWorkspaces({ force: true, silent: true });
        return updated;
      } catch (err) {
        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [activeMembers, activeWorkspaceId, refreshActiveWorkspaceData, refreshWorkspaces],
  );

  const assignWorkspaceMember = useCallback(
    async (payload: WorkspaceMemberAssign) => {
      if (!activeWorkspaceId) {
        throw new Error("Select a workspace first.");
      }

      const requestWorkspaceId = activeWorkspaceId;
      const previousMembers = activeMembers;
      const shouldApplyActiveUpdate = activeWorkspaceIdRef.current === requestWorkspaceId;

      // Optimistic member count update in tree
      setWorkspaces((current) =>
        patchWorkspaceInTree(current, requestWorkspaceId, (workspace) => ({
          ...workspace,
          member_count: workspace.member_count + 1,
        })),
      );

      try {
        const member = await apiClient.post<WorkspaceMember>(
          `/workspaces/${requestWorkspaceId}/members/assign`,
          payload,
        );

        if (activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers((current) => {
            const exists = current.some((m) => m.user_id === member.user_id);
            if (exists) return current;
            return [...current, member];
          });
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }

        await refreshWorkspaces({ force: true, silent: true });
        return member;
      } catch (err) {
        // Rollback on failure
        setWorkspaces((current) =>
          patchWorkspaceInTree(current, requestWorkspaceId, (workspace) => ({
            ...workspace,
            member_count: Math.max(0, workspace.member_count - 1),
          })),
        );
        if (shouldApplyActiveUpdate && activeWorkspaceIdRef.current === requestWorkspaceId) {
          setActiveMembers(previousMembers);
          await refreshActiveWorkspaceData({ force: true, silent: true });
        }
        throw err;
      }
    },
    [activeWorkspaceId, activeMembers, refreshActiveWorkspaceData, refreshWorkspaces],
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
    if (!userId) {
      workspaceFetchIdRef.current += 1;
      createWorkspaceInFlightRef.current.clear();
      workspaceTreeRefreshInFlightRef.current.clear();
      subspaceRefreshInFlightRef.current.clear();
      activeWorkspaceDataInFlightRef.current = null;
      workspaceIntelligenceInFlightRef.current = null;
      setWorkspaces([]);
      setActiveWorkspace(null);
      setActiveMembers([]);
      setActiveInvites([]);
      setPendingInvites([]);
      setActiveWorkspaceIntelligence(null);
      setIntelligenceError(null);
      setMembersError(null);
      setSubspaceLoadingByParentId({});
      setSubspaceErrorByParentId({});
      setLoading(false);
      return;
    }

    refreshWorkspaces({ force: true });
    refreshPendingInvites({ force: true });

    try {
      const saved = typeof window !== "undefined" ? window.localStorage.getItem(workspaceStorageKey()) : null;
      logger.debug("[workspace] hydration read saved active workspace", { saved });
      setApiWorkspaceId(saved);
      if (saved) {
        setActiveWorkspaceId(saved);
      }
    } catch {
      // ignore
    }
  }, [refreshPendingInvites, refreshWorkspaces, setActiveWorkspace, userId]);

  useEffect(() => {
    if (!userId) {
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
  }, [refreshPendingInvites, userId]);

  useEffect(() => {
    if (!userId || loading) {
      return;
    }

    if (error && workspaces.length === 0) {
      logger.debug("[workspace] fetch failed; preserving active workspace id during failure state");
      return;
    }

    if (workspaces.length === 0) {
      logger.debug("[workspace] no workspaces after verified fetch; waiting for explicit create");
      if (activeWorkspaceId) {
        setActiveWorkspace(null);
      }
      return;
    }

    const activeExists = Boolean(findWorkspaceById(workspaces, activeWorkspaceId));
    if (!activeExists) {
      const nextWorkspaceId = flattenWorkspaces(workspaces)[0]?.id ?? null;
      logger.debug("[workspace] saved active workspace missing; selecting first available workspace", {
        activeWorkspaceId,
        nextWorkspaceId,
      });
      setActiveWorkspace(nextWorkspaceId);
    }
  }, [activeWorkspaceId, error, loading, setActiveWorkspace, userId, workspaces]);

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
      intelligenceError,
      membersError,
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
      assignWorkspaceMember,
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
      intelligenceError,
      membersError,
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
      assignWorkspaceMember,
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
