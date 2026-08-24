"use client";

import { FormEvent, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleDot, Compass, Loader2, Plus } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { SurfaceErrorBoundary } from "@/components/layout/AppErrorBoundary";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { apiClient } from "@/lib/api";
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
import { realtimeRegistry } from "@/lib/realtime-registry";
import { useToast } from "@/lib/toast-context";
import { useWorkspaceCollaboration } from "@/lib/workspace-collaboration-context";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { WorkspaceChannel, WorkspaceInitiative, WorkspaceInitiativeResource,
  WorkspaceMember, WorkspaceTask } from "@/lib/workspace-types";
import { InitiativeCard } from "./InitiativeCard";
import { InitiativeCreateForm } from "./InitiativeCreateForm";
import { InitiativeDetailPanel } from "./InitiativeDetailPanel";
import { InitiativeSupportPanel } from "./InitiativeSupportPanel";
import {
  INITIATIVE_PATCH_SYNC_WARNING, INITIATIVE_PATCH_UNCONFIRMED_WARNING,
  type InitiativeCreateDraft, type OptimisticInitiativePatch,
  confirmedInitiativePatch, createInitiativeOptimisticMutationState,
  createOptimisticInitiative, initiativeCreateFingerprint,
  initiativeFailureBelongsToResource, initiativeMomentumSummary, initiativeProgress,
  invalidateInitiativeQueries, mergeInitiative, queueInitiativeCanonicalProof,
  reconciledInitiativeSelection, runInitiativeCanonicalProof,
  runInitiativeTwoReadCanonicalProof, sortInitiatives, useInitiativeAssistanceMutation,
  useInitiativeBusyState, useInitiativeMutationFailures,
} from "./initiativeSurfaceModel";

export const WorkspaceInitiativesSurface = memo(function WorkspaceInitiativesSurface() {
  return (
    <SurfaceErrorBoundary surfaceName="Initiatives">
      <WorkspaceInitiativesSurfaceContent />
    </SurfaceErrorBoundary>
  );
});

function WorkspaceInitiativesSurfaceContent() {
  const { session } = useAuth();
  const { showToast } = useToast();
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { presence, realtimeStatus } = useWorkspaceCollaboration();
  const searchParams = useSearchParams();
  const routeInitiativeId = searchParams?.get("id") ?? null;
  const routeCreateInitiative = searchParams?.get("create") === "initiative";
  const routeCreateInitiativeToken = searchParams?.get("palette") ?? null;
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [channels, setChannels] = useState<WorkspaceChannel[]>([]);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [context, setContext] = useState("");
  const [creating, setCreating] = useState(false);
  const [taskToAttach, setTaskToAttach] = useState("");
  const [channelToAttach, setChannelToAttach] = useState("");
  const [resourceType, setResourceType] = useState<WorkspaceInitiativeResource["resource_type"]>("decision");
  const [resourceLabel, setResourceLabel] = useState("");
  const [resourceId, setResourceId] = useState("");
  const [mobileTab, setMobileTab] = useState<"brief" | "plan" | "assist">("brief");
  const liveRegionRef = useRef<HTMLDivElement | null>(null);
  const liveAnnouncementRef = useRef("");
  const workspaceRef = useRef(activeWorkspaceId);
  const workspaceEpochRef = useRef(0);
  const requestRef = useRef(0);
  const refreshTimerRef = useRef<number | null>(null);
  const mutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const canonicalRefreshRegistryRef = useRef(new Map<string, Promise<void>>());
  const [optimisticState] = useState(createInitiativeOptimisticMutationState);
  const createAttemptsRef = useRef(new Map<string, MutationAttempt>());
  const { beginMutation, dismissMutationFailure, failMutation, finishMutation,
    mutationError, ownsMutation, resolveMutationFailure, resolveMutationFailures,
    resetMutationFailures,
  } = useInitiativeMutationFailures();
  const { beginUpdating, clearUpdating, finishUpdating, updating } = useInitiativeBusyState();
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
  useLayoutEffect(() => {
    if (workspaceRef.current === activeWorkspaceId) return;
    const previousWorkspaceId = workspaceRef.current;
    if (previousWorkspaceId) releaseExclusiveMutations(
      mutationRegistryRef.current,
      (key) => key === `initiative:create:${previousWorkspaceId}`,
    );
    workspaceRef.current = activeWorkspaceId;
    workspaceEpochRef.current += 1;
  }, [activeWorkspaceId]);
  const [liveAnnouncementVersion, setLiveAnnouncementVersion] = useState(0);
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

  const sortedInitiatives = useMemo(() => sortInitiatives(initiatives), [initiatives]);

  const selected = sortedInitiatives.find((initiative) => initiative.id === selectedId) ?? sortedInitiatives[0] ?? null;
  const selectedInitiativeRef = useRef<string | null>(selectedId);
  const selectInitiative = useCallback((next: string | null) => {
    const previous = selectedInitiativeRef.current;
    if (previous && previous !== next) {
      clearUpdating();
      if (activeWorkspaceId) {
        resolveMutationFailures((key) => initiativeFailureBelongsToResource(key, activeWorkspaceId, previous));
      }
    }
    selectedInitiativeRef.current = next;
    setSelectedId(next);
  }, [activeWorkspaceId, clearUpdating, resolveMutationFailures]);
  const { abandonAssistance, assistance, assisting, requestAssistance } = useInitiativeAssistanceMutation({
    activeWorkspaceId, beginMutation, failMutation, finishMutation, mountedRef, ownsMutation,
    resolveMutationFailure, selectedInitiativeId: selected?.id ?? null,
    selectedInitiativeRef, workspaceEpochRef, workspaceRef,
  });
  const isCurrentInitiativeMutation = (workspaceId: string, workspaceEpoch: number, initiativeId: string) =>
    isCurrentWorkspaceMutation(workspaceId, workspaceEpoch) && selectedInitiativeRef.current === initiativeId;

  const loadInitiatives = useCallback(async (includeOptions = false) => {
    if (!activeWorkspaceId) {
      setInitiatives([]);
      setTasks([]);
      setChannels([]);
      setMembers([]);
      setLoading(false);
      return;
    }
    const requestId = ++requestRef.current;
    setLoading(true);
    try {
      const [incoming, taskOptions, channelOptions, memberOptions] = await Promise.all([
        queryGet<WorkspaceInitiative[]>(`/workspaces/${activeWorkspaceId}/initiatives`),
        includeOptions ? queryGet<WorkspaceTask[]>(`/workspaces/${activeWorkspaceId}/tasks`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceChannel[]>(`/workspaces/${activeWorkspaceId}/channels`) : Promise.resolve(null),
        includeOptions ? apiClient.get<WorkspaceMember[]>(`/workspaces/${activeWorkspaceId}/members`) : Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current || workspaceRef.current !== activeWorkspaceId) return;
      const reconciled = optimisticState.reconcile(incoming, activeWorkspaceId);
      setInitiatives(reconciled.next);
      selectInitiative(reconciledInitiativeSelection(
        selectedInitiativeRef.current, routeInitiativeId, reconciled,
      ));
      if (taskOptions) setTasks(taskOptions);
      if (channelOptions) setChannels(channelOptions);
      if (memberOptions) setMembers(memberOptions);
      setLoadError(null);
    } catch (err) {
      if (
        requestId === requestRef.current &&
        workspaceRef.current === activeWorkspaceId
      ) {
        logClientError("Failed to load initiatives", err, { endpoint: `/workspaces/${activeWorkspaceId}/initiatives` });
        setLoadError("Unable to load initiatives. Check your connection and try again.");
      }
    } finally {
      if (
        requestId === requestRef.current &&
        workspaceRef.current === activeWorkspaceId
      ) {
        setLoading(false);
      }
    }
  }, [activeWorkspaceId, optimisticState, routeInitiativeId, selectInitiative]);

  const reconcileInitiativeMutation = useCallback((workspaceId: string, workspaceEpoch: number,
    canonicalProofKey: string | null = null) => {
    const isCurrent = () => mountedRef.current && workspaceRef.current === workspaceId
      && workspaceEpochRef.current === workspaceEpoch;
    if (!isCurrent()) return Promise.resolve(null);
    return queueInitiativeCanonicalProof(canonicalRefreshRegistryRef.current, workspaceId, async () => {
      if (!isCurrent()) return null;
      const incoming = await apiClient.get<WorkspaceInitiative[]>(`/workspaces/${workspaceId}/initiatives`,
        { dedupe: false });
      if (!isCurrent()) return null;
      const reconciled = optimisticState.reconcile(incoming, workspaceId, canonicalProofKey);
      invalidateInitiativeQueries(workspaceId);
      requestRef.current += 1;
      setInitiatives(reconciled.next);
      selectInitiative(reconciledInitiativeSelection(
        selectedInitiativeRef.current, routeInitiativeId, reconciled,
      ));
      setLoadError(null);
      return reconciled;
    });
  }, [optimisticState, routeInitiativeId, selectInitiative]);
  const proveInitiativeMutation = useCallback((workspaceId: string, workspaceEpoch: number,
    canonicalProofKey: string | null = null) => runInitiativeCanonicalProof(
    workspaceEpoch,
    canonicalProofKey,
    () => mountedRef.current && workspaceRef.current === workspaceId ? workspaceEpochRef.current : null,
    (epoch) => reconcileInitiativeMutation(workspaceId, epoch, canonicalProofKey),
  ), [reconcileInitiativeMutation]);
  const scheduleInitiativeReconciliation = useCallback((workspaceId: string, workspaceEpoch: number) => {
    void proveInitiativeMutation(workspaceId, workspaceEpoch).catch(() => invalidateInitiativeQueries(workspaceId));
  }, [proveInitiativeMutation]);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current !== null) return;
    refreshTimerRef.current = window.setTimeout(() => {
      refreshTimerRef.current = null;
      if (activeWorkspaceId) {
        invalidateInitiativeQueries(activeWorkspaceId);
      }
      void loadInitiatives(true);
    }, 120);
  }, [activeWorkspaceId, loadInitiatives]);

  useEffect(() => {
    setCreating(false);
    clearUpdating();
    setLoadError(null);
    resetMutationFailures();
  }, [activeWorkspaceId, clearUpdating, resetMutationFailures]);

  useEffect(() => {
    setInitiatives([]);
    selectInitiative(null);
    setCreateOpen(false);
    setTaskToAttach("");
    setChannelToAttach("");
    setResourceId("");
    setResourceLabel("");
    void loadInitiatives(true);
  }, [activeWorkspaceId, loadInitiatives, selectInitiative]);

  useEffect(() => {
    if (routeCreateInitiative) {
      setCreateOpen(true);
    }
  }, [routeCreateInitiative, routeCreateInitiativeToken]);

  useEffect(() => {
    if (!activeWorkspaceId || !session?.user.id) return;
    realtimeRegistry.subscribe(
      { type: "initiatives", workspaceId: activeWorkspaceId },
      (channel) =>
        channel
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_initiatives", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_initiative_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_tasks", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh)
          .on("postgres_changes", { event: "*", schema: "public", table: "workspace_channels", filter: `workspace_id=eq.${activeWorkspaceId}` }, scheduleRefresh),
    );
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      realtimeRegistry.unsubscribe({ type: "initiatives", workspaceId: activeWorkspaceId });
    };
  }, [activeWorkspaceId, scheduleRefresh, session?.user.id]);

  const availableTasks = useMemo(
    () => tasks.filter((task) => task.initiative_id !== selected?.id),
    [selected?.id, tasks],
  );
  const availableChannels = useMemo(
    () => channels.filter((channel) => !selected?.linked_channels.some((linked) => linked.id === channel.id)),
    [channels, selected?.linked_channels],
  );

  const simplifiedMomentum = useMemo(() => initiativeMomentumSummary(selected), [selected]);
  const progressPercentage = useMemo(() => initiativeProgress(selected), [selected]);
  const completeVisibleInitiativeCreate = (created: WorkspaceInitiative, pendingId: string) => {
    setInitiatives((current) => mergeInitiative(current, created));
    if (selectedInitiativeRef.current === pendingId) selectInitiative(created.id);
    setTitle(""); setDescription(""); setOwnerId("");
    setTargetDate(""); setContext(""); setCreateOpen(false);
    announceMutation(`Initiative ${created.title} created.`);
    showToast({ title: "Initiative created", message: created.title });
  };

  async function createInitiative(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !title.trim()) return;

    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const mutationKey = `initiative:create:${requestWorkspaceId}`;
    const failureKey = `initiative:create:${requestWorkspaceId}`;
    if (mutationRegistryRef.current.has(mutationKey)) {
      return;
    }
    const draft: InitiativeCreateDraft = {
      title: title.trim(),
      description: description.trim(),
      ownerId: ownerId || null,
      targetDate: targetDate || null,
      context: context.trim(),
    };
    const fingerprint = initiativeCreateFingerprint(requestWorkspaceId, draft);
    const attempt = mutationAttempt(createAttemptsRef.current.get(requestWorkspaceId) ?? null, fingerprint);
    createAttemptsRef.current.set(requestWorkspaceId, attempt);
    const mutationToken = beginMutation(failureKey);

    await runExclusiveMutation(
      mutationRegistryRef.current,
      mutationKey,
      async () => {
        const optimistic = createOptimisticInitiative(
          requestWorkspaceId,
          attempt.nonce,
          session?.user.id || null,
          members.find((member) => member.user_id === draft.ownerId)?.full_name ?? null,
          draft,
        );
        setCreating(true);
        const previousCreate = optimisticState.creates.get(requestWorkspaceId);
        optimisticState.creates.set(requestWorkspaceId, optimistic);
        setInitiatives((current) => mergeInitiative(
          previousCreate?.id.startsWith("pending-")
            ? current.filter((initiative) => initiative.id !== previousCreate.id)
            : current,
          optimistic,
        ));
        selectInitiative(optimistic.id);
        try {
          const created = await apiClient.post<WorkspaceInitiative>(`/workspaces/${requestWorkspaceId}/initiatives`, {
            title: optimistic.title,
            description: optimistic.description,
            owner_user_id: optimistic.owner_user_id,
            target_date: optimistic.target_date,
            initiative_context: optimistic.initiative_context,
            client_nonce: attempt.nonce,
          });
          if (
            created.workspace_id !== requestWorkspaceId ||
            created.client_nonce !== attempt.nonce
          ) {
            throw new Error("Initiative creation response did not match its mutation attempt.");
          }
          if (optimisticState.creates.get(requestWorkspaceId) === optimistic) {
            optimisticState.creates.set(requestWorkspaceId, created);
          }
          try {
            await proveInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch);
          } catch {
            invalidateInitiativeQueries(requestWorkspaceId);
          }
          if (ownsMutation(failureKey, mutationToken) && createAttemptsRef.current.get(requestWorkspaceId) === attempt) {
            createAttemptsRef.current.delete(requestWorkspaceId);
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(failureKey, mutationToken)) {
            if (optimisticState.creates.get(requestWorkspaceId) === created) {
              optimisticState.creates.delete(requestWorkspaceId);
            }
            return;
          }
          completeVisibleInitiativeCreate(created, optimistic.id);
        } catch (err) {
          try {
            await runInitiativeTwoReadCanonicalProof(
              requestWorkspaceEpoch,
              () => mountedRef.current && workspaceRef.current === requestWorkspaceId ? workspaceEpochRef.current : null,
              (epoch) => reconcileInitiativeMutation(requestWorkspaceId, epoch),
              () => Boolean(optimisticState.canonicalCreate(optimistic)),
            );
          } catch {
            invalidateInitiativeQueries(requestWorkspaceId);
          }
          const canonical = optimisticState.canonicalCreate(optimistic);
          if (optimisticState.creates.get(requestWorkspaceId) === optimistic) {
            optimisticState.creates.delete(requestWorkspaceId);
          }
          if (canonical) {
            if (ownsMutation(failureKey, mutationToken) && createAttemptsRef.current.get(requestWorkspaceId) === attempt) {
              createAttemptsRef.current.delete(requestWorkspaceId);
            }
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(failureKey, mutationToken)) {
              completeVisibleInitiativeCreate(canonical, optimistic.id);
            }
            return;
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(failureKey, mutationToken)) {
            return;
          }
          setInitiatives((current) => current.filter((initiative) => initiative.id !== optimistic.id));
          logClientError("Failed to open initiative", err, { endpoint: `/workspaces/${requestWorkspaceId}/initiatives` });
          failMutation(failureKey, mutationToken, "Unable to open initiative. Check your connection and try again.");
        } finally {
          if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(failureKey, mutationToken)) {
            setCreating(false);
          }
          finishMutation(failureKey, mutationToken);
        }
      },
    );
  }

  async function patchInitiative(
    payload: Partial<WorkspaceInitiative>,
  ): Promise<boolean> {
    if (!activeWorkspaceId || !selected || selected.id.startsWith("pending-")) {
      return false;
    }
    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const requestInitiativeId = selected.id;
    const mutationKey = `initiative:update:${requestWorkspaceId}:${requestInitiativeId}`;
    if (mutationRegistryRef.current.has(mutationKey)) {
      return false;
    }
    const before = selected;
    const optimisticPatch = { ...payload };
    const previousOptimistic = optimisticState.patches.get(mutationKey);
    const optimistic: OptimisticInitiativePatch = {
      before: previousOptimistic?.before ?? before,
      initiativeId: requestInitiativeId,
      patch: { ...previousOptimistic?.patch, ...optimisticPatch },
      workspaceId: requestWorkspaceId,
    };
    const mutationToken = beginMutation(mutationKey);
    return runExclusiveMutation(
      mutationRegistryRef.current,
      mutationKey,
      async () => {
        optimisticState.patches.set(mutationKey, optimistic);
        const updatingOwner = beginUpdating();
        setInitiatives((current) => current.map((item) => (
          item.id === requestInitiativeId ? { ...item, ...optimisticPatch } : item
        )));
        try {
          const changed = await apiClient.patch<WorkspaceInitiative>(
            `/workspaces/${requestWorkspaceId}/initiatives/${requestInitiativeId}`,
            payload,
          );
          if (
            changed.id !== requestInitiativeId ||
            changed.workspace_id !== requestWorkspaceId
          ) {
            throw new Error("Initiative update response did not match its requested resource.");
          }

          const canonicalOptimistic = confirmedInitiativePatch(optimistic, changed);
          if (optimisticState.patches.get(mutationKey) === optimistic) {
            optimisticState.patches.set(mutationKey, canonicalOptimistic);
          }
          let syncConflict = false;
          try {
            const { result: reconciled } = await proveInitiativeMutation(
              requestWorkspaceId, requestWorkspaceEpoch, mutationKey,
            );
            syncConflict = Boolean(
              reconciled?.conflictedPatches.some(([key]) => key === mutationKey),
            );
          } catch (reconciliationError) {
            optimisticState.patches.delete(mutationKey);
            invalidateInitiativeQueries(requestWorkspaceId);
            syncConflict = true;
            if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch)) {
              setInitiatives((current) => current.map((item) => item.id === requestInitiativeId ? changed : item));
              logClientError("Failed to verify successful initiative update", reconciliationError, { endpoint: `/workspaces/${requestWorkspaceId}/initiatives` });
            }
          }
          if (!isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) || !ownsMutation(mutationKey, mutationToken)) {
            optimisticState.patches.delete(mutationKey);
            return !syncConflict;
          }

          if (syncConflict) {
            if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)) {
              failMutation(mutationKey, mutationToken, INITIATIVE_PATCH_SYNC_WARNING);
            }
            return false;
          }

          if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)) {
            announceMutation(`Initiative ${changed.title} updated.`);
            showToast({ title: "Initiative updated", message: changed.title });
          }
          return true;
        } catch (err) {
          let canonicalProof = null;
          try {
            canonicalProof = (await proveInitiativeMutation(
              requestWorkspaceId, requestWorkspaceEpoch, mutationKey,
            )).result;
          } catch {
            invalidateInitiativeQueries(requestWorkspaceId);
          }
          if (optimisticState.canonicalPatchWasObserved(optimistic)) {
            if (optimisticState.patches.get(mutationKey) === optimistic) {
              optimisticState.patches.delete(mutationKey);
            }
            if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId) && ownsMutation(mutationKey, mutationToken)) {
              announceMutation(`Initiative ${before.title} updated.`);
              showToast({ title: "Initiative updated", message: before.title });
            }
            return true;
          }
          if (canonicalProof?.conflictedPatches.some(([key]) => key === mutationKey)) {
            if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)) {
              failMutation(mutationKey, mutationToken, INITIATIVE_PATCH_UNCONFIRMED_WARNING);
            }
            return false;
          }
          optimisticState.restorePatch(mutationKey, optimistic, previousOptimistic ?? null);
          invalidateInitiativeQueries(requestWorkspaceId);
          if (isCurrentWorkspaceMutation(requestWorkspaceId, requestWorkspaceEpoch) && ownsMutation(mutationKey, mutationToken)) {
            setInitiatives((current) => current.map((item) => (
              item.id === requestInitiativeId
                ? rollbackOptimisticPatch(item, before, optimisticPatch)
                : item
            )));
            if (selectedInitiativeRef.current === requestInitiativeId) {
              logClientError("Failed to update initiative", err, { endpoint: `/workspaces/${requestWorkspaceId}/initiatives/${requestInitiativeId}` });
              failMutation(mutationKey, mutationToken, "Unable to update initiative. Your session may have expired; refresh and try again.");
            }
          }
          return false;
        } finally {
          finishUpdating(updatingOwner, mountedRef.current);
          finishMutation(mutationKey, mutationToken);
        }
      },
    );
  }

  async function mutateInitiativeLink(
    requestInitiative: WorkspaceInitiative,
    failureKey: string,
    endpoint: string,
    request: (workspaceId: string, initiativeId: string) => Promise<void>,
    canonicalMatches: (initiative: WorkspaceInitiative) => boolean,
    complete: (initiative: WorkspaceInitiative) => void,
    errorLabel: string,
    errorMessage: string,
  ) {
    if (!activeWorkspaceId || requestInitiative.workspace_id !== activeWorkspaceId
      || requestInitiative.id.startsWith("pending-")) return;
    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const requestInitiativeId = requestInitiative.id;
    const mutationKey = `initiative:update:${requestWorkspaceId}:${requestInitiativeId}`;
    if (mutationRegistryRef.current.has(mutationKey)) return;
    const mutationToken = beginMutation(failureKey);
    await runExclusiveMutation(mutationRegistryRef.current, mutationKey, async () => {
      const updatingOwner = beginUpdating();
      try {
        await request(requestWorkspaceId, requestInitiativeId);
        scheduleInitiativeReconciliation(requestWorkspaceId, requestWorkspaceEpoch);
        if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)
          && ownsMutation(failureKey, mutationToken)) complete(requestInitiative);
      } catch (err) {
        let canonical: WorkspaceInitiative | null = null;
        try {
          const { result } = await runInitiativeTwoReadCanonicalProof(
            requestWorkspaceEpoch,
            () => mountedRef.current && workspaceRef.current === requestWorkspaceId ? workspaceEpochRef.current : null,
            (epoch) => reconcileInitiativeMutation(requestWorkspaceId, epoch),
            ({ next }) => next.some((item) => item.id === requestInitiativeId && canonicalMatches(item)),
          );
          canonical = result?.next.find((item) => item.id === requestInitiativeId && canonicalMatches(item)) ?? null;
        } catch {
          invalidateInitiativeQueries(requestWorkspaceId);
        }
        if (canonical) {
          if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)
            && ownsMutation(failureKey, mutationToken)) complete(canonical);
          resolveMutationFailure(failureKey, mutationToken);
          return;
        }
        if (isCurrentInitiativeMutation(requestWorkspaceId, requestWorkspaceEpoch, requestInitiativeId)
          && ownsMutation(failureKey, mutationToken)) {
          logClientError(errorLabel, err, { endpoint });
          failMutation(failureKey, mutationToken, errorMessage);
        }
      } finally {
        finishUpdating(updatingOwner, mountedRef.current);
        finishMutation(failureKey, mutationToken);
      }
    });
  }

  async function attachTask() {
    if (!activeWorkspaceId || !selected || !taskToAttach) return;
    const taskId = taskToAttach;
    const endpoint = `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/tasks/${taskId}`;
    await mutateInitiativeLink(
      selected, `initiative:attach-task:${activeWorkspaceId}:${selected.id}:${taskId}`, endpoint,
      async (workspaceId, initiativeId) => {
        const changed = await apiClient.post<WorkspaceInitiative>(
          `/workspaces/${workspaceId}/initiatives/${initiativeId}/tasks/${taskId}`,
        );
        if (changed.id !== initiativeId || changed.workspace_id !== workspaceId) {
          throw new Error("Task-link response did not match its requested initiative.");
        }
      },
      (initiative) => initiative.linked_tasks.some(({ id }) => id === taskId),
      (initiative) => {
        setTaskToAttach("");
        announceMutation(`Task attached to ${initiative.title}.`);
        showToast({ title: "Task linked", message: initiative.title });
      },
      "Failed to attach task to initiative",
      "Unable to attach task. Check your connection and try again.",
    );
  }

  async function detachTask(task: WorkspaceTask) {
    if (!activeWorkspaceId || !selected) return;
    const endpoint = `/workspaces/${activeWorkspaceId}/tasks/${task.id}`;
    await mutateInitiativeLink(
      selected, `initiative:detach-task:${activeWorkspaceId}:${selected.id}:${task.id}`, endpoint,
      async (workspaceId) => {
        const changed = await apiClient.patch<WorkspaceTask>(endpoint, { initiative_id: null });
        if (changed.id !== task.id || changed.workspace_id !== workspaceId) {
          throw new Error("Task-unlink response did not match its requested resource.");
        }
      },
      (initiative) => !initiative.linked_tasks.some(({ id }) => id === task.id),
      () => {
        announceMutation(`Task ${task.title} detached from initiative.`);
        showToast({ title: "Task unlinked", message: task.title });
      },
      "Failed to detach task from initiative",
      "Unable to detach task. Check your connection and try again.",
    );
  }

  async function attachChannel() {
    if (!activeWorkspaceId || !selected || !channelToAttach) return;
    const channelId = channelToAttach;
    const endpoint = `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels`;
    await mutateInitiativeLink(
      selected, `initiative:attach-channel:${activeWorkspaceId}:${selected.id}:${channelId}`, endpoint,
      async (workspaceId, initiativeId) => {
        const changed = await apiClient.post<WorkspaceInitiative>(
          `/workspaces/${workspaceId}/initiatives/${initiativeId}/channels`, { channel_id: channelId },
        );
        if (changed.id !== initiativeId || changed.workspace_id !== workspaceId) {
          throw new Error("Channel-link response did not match its requested initiative.");
        }
      },
      (initiative) => initiative.linked_channels.some(({ id }) => id === channelId),
      (initiative) => {
        setChannelToAttach("");
        announceMutation(`Conversation attached to ${initiative.title}.`);
        showToast({ title: "Conversation linked", message: initiative.title });
      },
      "Failed to attach conversation to initiative",
      "Unable to attach conversation. Check your connection and try again.",
    );
  }

  async function detachChannel(channelId: string) {
    if (!activeWorkspaceId || !selected) return;
    const endpoint = `/workspaces/${activeWorkspaceId}/initiatives/${selected.id}/channels/${channelId}`;
    await mutateInitiativeLink(
      selected, `initiative:detach-channel:${activeWorkspaceId}:${selected.id}:${channelId}`, endpoint,
      async (workspaceId, initiativeId) => {
        const changed = await apiClient.delete<WorkspaceInitiative>(
          `/workspaces/${workspaceId}/initiatives/${initiativeId}/channels/${channelId}`,
        );
        if (changed.id !== initiativeId || changed.workspace_id !== workspaceId) {
          throw new Error("Channel-unlink response did not match its requested initiative.");
        }
      },
      (initiative) => !initiative.linked_channels.some(({ id }) => id === channelId),
      (initiative) => {
        announceMutation(`Conversation detached from ${initiative.title}.`);
        showToast({ title: "Conversation unlinked", message: initiative.title });
      },
      "Failed to detach conversation from initiative",
      "Unable to detach conversation. Check your connection and try again.",
    );
  }

  async function addResource(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !selected || !resourceId.trim()) return;
    const requestWorkspaceId = activeWorkspaceId;
    const requestWorkspaceEpoch = workspaceEpochRef.current;
    const requestInitiativeId = selected.id;
    const resource: WorkspaceInitiativeResource = {
      resource_type: resourceType,
      resource_id: resourceId.trim(),
      label: resourceLabel.trim() || null,
      metadata: {},
    };
    const succeeded = await patchInitiative({
      linked_resources: [...selected.linked_resources, resource],
    });
    if (
      succeeded &&
      isCurrentInitiativeMutation(
        requestWorkspaceId,
        requestWorkspaceEpoch,
        requestInitiativeId,
      )
    ) {
      setResourceId("");
      setResourceLabel("");
    }
  }

  if (!activeWorkspaceId) {
    return (
      <section className="omnix-page-frame flex items-center justify-center">
        <p className="text-sm text-[var(--omnix-text-2)]">Select a workspace to orient shared initiatives.</p>
      </section>
    );
  }

  return (
    <section className="omnix-container-responsive omnix-scrollbar flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto px-3 pb-3 pt-3 sm:px-5 sm:pb-5 xl:overflow-hidden">
      <div ref={liveRegionRef} aria-live="polite" aria-atomic="true" className="sr-only" />
      <header className="mb-4 flex shrink-0 flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--omnix-border)] bg-[var(--omnix-rgba-0-255-255-0-025)] px-4 py-3 sm:px-5 sm:py-4">
        <div>
          <p className="mb-1 inline-flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-100/70">
            <Compass className="h-3.5 w-3.5" /> Strategy layer
          </p>
          <h1 className="omnix-display text-xl font-semibold text-white">Initiatives</h1>
          <p className="mt-1 hidden text-sm text-[var(--omnix-text-2)] md:block">{activeWorkspace?.name} shared operational direction.</p>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[var(--omnix-border)] bg-black/15 px-3 py-1.5 text-xs text-[var(--omnix-text-2)]">
          <CircleDot className={cn("h-3.5 w-3.5", realtimeStatus === "connected" ? "text-emerald-300" : "text-amber-200")} />
          {presence?.active_count ?? 0} active <span className="text-[var(--omnix-text-3)]">/</span> {realtimeStatus === "connected" ? "synced" : "recovering"}
        </div>
      </header>

      {mutationError || loadError ? (
        <OmnixErrorState
          compact
          className="mb-4"
          title={mutationError ? "Initiative action needs attention" : "Initiatives are unavailable"}
          message={mutationError ?? loadError ?? ""}
          onRetry={!mutationError && loadError ? () => void loadInitiatives(true) : undefined}
          isRetrying={loading}
          onDismiss={mutationError ? dismissMutationFailure : () => setLoadError(null)}
        />
      ) : null}

      <div className="omnix-initiative-workbench shrink-0">
        <aside className={cn(
          "omnix-panel order-1 flex shrink-0 flex-col rounded-xl p-3 lg:order-none lg:min-h-[16rem]",
          selectedId && "hidden xl:flex"
        )}>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Direction</p>
            <Button size="sm" variant="ghost" disabled={updating || creating} onClick={() => setCreateOpen((open) => !open)} leftIcon={<Plus className="h-3.5 w-3.5" />}>Create Initiative</Button>
          </div>
          {createOpen ? (
            <InitiativeCreateForm
              title={title}
              description={description}
              ownerId={ownerId}
              targetDate={targetDate}
              context={context}
              members={members}
              creating={creating}
              disabled={updating}
              onSubmit={createInitiative}
              onTitleChange={setTitle}
              onDescriptionChange={setDescription}
              onOwnerChange={setOwnerId}
              onTargetDateChange={setTargetDate}
              onContextChange={setContext}
            />
          ) : null}
          <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-2 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
            {loading ? <Loader2 className="mx-auto mt-8 h-5 w-5 animate-spin text-cyan-100/50" /> : null}
            {!loading && initiatives.length === 0 ? (
              <EmptyState
                icon={Compass}
                title="No initiatives yet"
                description="Initiatives track strategic direction across your workspace"
                action={{ label: "Create Initiative", onClick: () => setCreateOpen(true) }}
                className="min-w-[min(17rem,78vw)] lg:min-w-0"
              />
            ) : null}
            {sortedInitiatives.map((initiative) => (
              <InitiativeCard
                key={initiative.id}
                initiative={initiative}
                selected={selected?.id === initiative.id}
                onSelect={() => {
                  abandonAssistance();
                  selectInitiative(initiative.id);
                }}
              />
            ))}
          </div>
        </aside>

        <InitiativeDetailPanel
          selected={selected}
          selectedId={selectedId}
          mobileTab={mobileTab}
          updating={updating}
          members={members}
          availableTasks={availableTasks}
          availableChannels={availableChannels}
          taskToAttach={taskToAttach}
          channelToAttach={channelToAttach}
          resourceType={resourceType}
          resourceLabel={resourceLabel}
          resourceId={resourceId}
          simplifiedMomentum={simplifiedMomentum}
          progressPercentage={progressPercentage}
          assistance={assistance}
          assisting={assisting}
          onBack={() => {
            abandonAssistance();
            selectInitiative(null);
          }}
          onMobileTabChange={setMobileTab}
          onPatchInitiative={(payload) => void patchInitiative(payload)}
          onTaskToAttachChange={setTaskToAttach}
          onAttachTask={() => void attachTask()}
          onDetachTask={(task) => void detachTask(task)}
          onChannelToAttachChange={setChannelToAttach}
          onAttachChannel={() => void attachChannel()}
          onDetachChannel={(channelId) => void detachChannel(channelId)}
          onResourceTypeChange={setResourceType}
          onResourceLabelChange={setResourceLabel}
          onResourceIdChange={setResourceId}
          onAddResource={addResource}
          onRequestAssistance={(mode) => void requestAssistance(mode)}
        />

        <InitiativeSupportPanel
          assistance={assistance}
          assisting={assisting}
          onRequestAssistance={(mode) => void requestAssistance(mode)}
          selected={selected}
          selectedId={selectedId}
        />
      </div>
    </section>
  );
}
