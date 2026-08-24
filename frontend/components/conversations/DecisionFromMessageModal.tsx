"use client";

import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { BadgeCheck, X } from "lucide-react";
import {
  type ConversationMutationScope,
  type DecisionSource,
  conversationMutationScopeMatches,
  conversationSourceScopeMatches,
  decisionStatusLabels,
} from "@/components/conversations/conversationUtils";
import type {
  ReportConversationFailure,
  ResolveConversationFailure,
} from "@/components/conversations/useConversationFailures";
import { MentionTextarea, mentionPayload } from "@/components/mentions/MentionTextarea";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import {
  type MutationAttempt,
  mutationAttempt,
  releaseExclusiveMutations,
  runExclusiveMutation,
} from "@/lib/mutation-lifecycle";
import { invalidateQueries, queryGet } from "@/lib/query";
import type {
  WorkspaceChannelMessage,
  WorkspaceDecision,
  WorkspaceDecisionStatus,
  WorkspaceMentionMetadata,
  WorkspaceMember,
} from "@/lib/workspace-types";

type DecisionFromMessageModalProps = {
  activeMembers: WorkspaceMember[];
  activeWorkspaceId: string | null;
  onClose: () => void;
  onCreated: (message: string) => void;
  onFailure: ReportConversationFailure;
  onFailureResolved: ResolveConversationFailure;
  selectedChannelId: string | null;
  source: DecisionSource | null;
  currentThreadRootId: string | null;
};

const DECISION_CONVERSION_ERROR_MESSAGE = "Unable to record decision from discussion. Check your connection and try again.";

function decisionTitleFromMessage(message: WorkspaceChannelMessage) {
  const title = message.content.replace(/\s+/g, " ").trim();
  return title.length > 110 ? `${title.slice(0, 107).trim()}...` : title;
}

function decisionSourceScopeId(source: DecisionSource | null) {
  if (!source) return null;
  const owner = `${source.scope.workspaceId}:${source.scope.channelId}:${source.scope.threadRootId || "channel"}`;
  return source.kind === "message" ? `${owner}:message:${source.message.id}` : `${owner}:candidate:${source.candidate.id}`;
}

export function DecisionFromMessageModal({
  activeMembers,
  activeWorkspaceId,
  onClose,
  onCreated,
  onFailure,
  onFailureResolved,
  selectedChannelId,
  source,
  currentThreadRootId,
}: DecisionFromMessageModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [status, setStatus] = useState<WorkspaceDecisionStatus>("accepted");
  const [creating, setCreating] = useState(false);
  const mutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const attemptsRef = useRef(new Map<string, MutationAttempt>());
  const attemptScopeRef = useRef(`${activeWorkspaceId}:${selectedChannelId}`);
  const failureScopeRef = useRef("");
  const failureTokensRef = useRef(new Map<string, string>());
  const requestRevisionRef = useRef(0);
  const pendingTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const sourceScopeId = decisionSourceScopeId(source);
  const sourceIsOwned = Boolean(source && conversationSourceScopeMatches(
    source.scope,
    activeWorkspaceId,
    selectedChannelId,
    currentThreadRootId,
  ));
  const scopeRef = useRef<ConversationMutationScope>({
    workspaceId: activeWorkspaceId,
    channelId: selectedChannelId,
    sourceId: sourceIsOwned ? sourceScopeId : null,
  });
  useLayoutEffect(() => {
    scopeRef.current = {
      workspaceId: activeWorkspaceId,
      channelId: selectedChannelId,
      sourceId: sourceIsOwned ? sourceScopeId : null,
    };
    if (source && !sourceIsOwned) onClose();
  }, [activeWorkspaceId, onClose, selectedChannelId, source, sourceIsOwned, sourceScopeId]);

  useEffect(() => {
    if (!source) {
      setTitle("");
      setDescription("");
      setReason("");
      setMentions([]);
      setStatus("accepted");
      return;
    }
    if (source.kind === "message") {
      setTitle(decisionTitleFromMessage(source.message));
      setDescription(source.message.content);
      setReason("");
      setMentions(source.message.mentions || []);
      setStatus("accepted");
      return;
    }
    setTitle(source.candidate.title);
    setReason(source.candidate.reason);
    setDescription(`Supporting evidence:\n${source.candidate.supporting_evidence.map((evidence) => evidence.quote).join("\n")}`);
    setMentions([]);
    setStatus("proposed");
  }, [source]);

  useEffect(() => {
    const mutationRegistry = mutationRegistryRef.current;
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      pendingTokenRef.current = null;
      releaseExclusiveMutations(mutationRegistry, () => true);
    };
  }, []);

  useEffect(() => {
    releaseExclusiveMutations(mutationRegistryRef.current, () => true);
    pendingTokenRef.current = null;
    setCreating(false);
  }, [activeWorkspaceId, selectedChannelId, sourceScopeId]);

  useEffect(() => {
    const nextScope = `${activeWorkspaceId}:${selectedChannelId}`;
    if (attemptScopeRef.current === nextScope) return;
    attemptsRef.current.clear();
    attemptScopeRef.current = nextScope;
  }, [activeWorkspaceId, selectedChannelId]);

  useEffect(() => {
    const nextScope = `${activeWorkspaceId}:${selectedChannelId}:${sourceScopeId}`;
    if (failureScopeRef.current === nextScope) return;
    for (const [key, token] of failureTokensRef.current) onFailureResolved(key, token);
    failureTokensRef.current.clear();
    failureScopeRef.current = nextScope;
  }, [activeWorkspaceId, onFailureResolved, selectedChannelId, sourceScopeId]);

  async function createDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !source || !title.trim() || !sourceIsOwned
    ) return;
    const requestSource = source;
    const requestWorkspaceId = requestSource.scope.workspaceId;
    const requestChannelId = requestSource.scope.channelId;
    const requestSourceScopeId = decisionSourceScopeId(requestSource);
    const requestScope: ConversationMutationScope = {
      workspaceId: requestWorkspaceId,
      channelId: requestChannelId,
      sourceId: requestSourceScopeId,
    };
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      decision_reason: reason.trim() || null,
      status,
      ...(requestSource.kind === "candidate"
        ? {
            source_type: requestSource.candidate.source_type,
            source_id: requestSource.candidate.source_id,
            candidate_id: requestSource.candidate.id,
            source_evidence: requestSource.candidate.supporting_evidence,
          }
        : {}),
      mentions: mentionPayload(mentions, `${reason}\n${description}`),
    };
    const fingerprint = JSON.stringify({ ...requestScope, payload });
    const registryKey = `conversation:decision:create:${requestWorkspaceId}:${requestChannelId}:${requestSourceScopeId}`;

    await runExclusiveMutation(mutationRegistryRef.current, registryKey, async () => {
      if (
        !mountedRef.current
        || !conversationMutationScopeMatches(requestScope, scopeRef.current)
      ) {
        return;
      }
      const attempt = mutationAttempt(
        attemptsRef.current.get(fingerprint) ?? null,
        fingerprint,
      );
      attemptsRef.current.set(fingerprint, attempt);
      const activationToken = `${attempt.nonce}:${++requestRevisionRef.current}`;
      const failureKey = registryKey;
      const previousFailureToken = failureTokensRef.current.get(failureKey);
      if (previousFailureToken) {
        onFailureResolved(failureKey, previousFailureToken);
        failureTokensRef.current.delete(failureKey);
      }
      pendingTokenRef.current = activationToken;
      setCreating(true);

      const isCurrentAttempt = () => mountedRef.current
        && pendingTokenRef.current === activationToken
        && conversationMutationScopeMatches(requestScope, scopeRef.current);

      const resolveAttempt = (created: WorkspaceDecision) => {
        if (attemptsRef.current.get(fingerprint) === attempt) attemptsRef.current.delete(fingerprint);
        failureTokensRef.current.delete(failureKey);
        onFailureResolved(failureKey, activationToken);
        onCreated(`Decision recorded: ${created.title}`);
        onClose();
      };

      try {
        const created =
          requestSource.kind === "message"
            ? await apiClient.post<WorkspaceDecision>(
                `/workspaces/${requestWorkspaceId}/decisions/from-message/${requestChannelId}/${requestSource.message.id}`,
                { ...payload, client_nonce: attempt.nonce },
              )
            : await apiClient.post<WorkspaceDecision>(
                `/workspaces/${requestWorkspaceId}/decisions/candidates/accept`,
                { ...payload, client_nonce: attempt.nonce },
              );
        invalidateQueries(`/workspaces/${requestWorkspaceId}/decisions`);
        if (!isCurrentAttempt()) return;
        if (
          created.workspace_id !== requestWorkspaceId
          || created.client_nonce !== attempt.nonce
        ) {
          throw new Error("Decision response did not match the active mutation.");
        }
        resolveAttempt(created);
      } catch (err) {
        invalidateQueries(`/workspaces/${requestWorkspaceId}/decisions`);
        if (!isCurrentAttempt()) return;
        let committed: WorkspaceDecision | undefined;
        try {
          const canonical = await queryGet<WorkspaceDecision[]>(
            `/workspaces/${requestWorkspaceId}/decisions`,
            { force: true },
          );
          committed = canonical.find((decision) => (
            decision.workspace_id === requestWorkspaceId
            && decision.client_nonce === attempt.nonce
          ));
        } catch (reconciliationError) {
          logClientError("Failed to reconcile decision conversion", reconciliationError, {
            endpoint: `/workspaces/${requestWorkspaceId}/decisions`,
          });
        }
        if (!isCurrentAttempt()) return;
        if (committed) {
          resolveAttempt(committed);
          return;
        }
        logClientError("Failed to record decision from discussion", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/decisions`,
        });
        failureTokensRef.current.set(failureKey, activationToken);
        onFailure(failureKey, activationToken, DECISION_CONVERSION_ERROR_MESSAGE);
      } finally {
        if (isCurrentAttempt()) {
          pendingTokenRef.current = null;
          setCreating(false);
        }
      }
    });
  }

  if (
    !source || !sourceIsOwned
  ) return null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record linked decision"
      description="Record one decision linked to the selected discussion."
      closeDisabled={creating}
      backdropClassName="omnix-mobile-sheet-backdrop z-50 bg-black/65 px-4 py-6"
      className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5"
    >
        <form onSubmit={createDecision}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to decision</p>
              <h2 className="mt-1 text-base font-semibold text-white">Record linked decision</h2>
            </div>
            <button type="button" onClick={onClose} disabled={creating} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/45 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Close decision conversion">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input aria-label="Decision title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name the organizational choice" className="h-10 text-sm" autoFocus disabled={creating} />
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <MentionTextarea
              aria-label="Decision reason"
              value={reason}
              onChange={setReason}
              members={activeMembers}
              mentions={mentions}
              onMentionsChange={setMentions}
              className="omnix-input min-h-[96px] w-full resize-none rounded-lg p-3 text-sm leading-6"
              placeholder="Reason, if explicitly known"
              disabled={creating}
            />
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Status</span>
              <select
                aria-label="Decision status"
                value={status}
                onChange={(event) => setStatus(event.target.value as WorkspaceDecisionStatus)}
                disabled={creating}
                className="omnix-input h-10 w-full rounded-lg px-3 text-sm"
              >
                {Object.entries(decisionStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <MentionTextarea
            aria-label="Decision description"
            value={description}
            onChange={setDescription}
            members={activeMembers}
            mentions={mentions}
            onMentionsChange={setMentions}
            className="omnix-input mt-2 min-h-[92px] w-full resize-none rounded-lg p-3 text-sm leading-6"
            placeholder="Source description"
            disabled={creating}
          />
          <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
            {source.kind === "message"
              ? "This creates one decision linked to the selected message, channel, and workspace. It does not infer agreement beyond what you record here."
              : "This suggestion is not a decision yet. Review the evidence and submit only if the workspace should record it."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim() || creating} leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}>
              Record decision
            </Button>
          </div>
        </form>
    </Modal>
  );
}
