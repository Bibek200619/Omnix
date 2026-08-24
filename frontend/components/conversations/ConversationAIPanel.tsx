"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ClipboardCheck, Loader2, Sparkles, X } from "lucide-react";
import { DecisionCandidatePanel } from "@/components/decisions/DecisionCandidatePanel";
import {
  type ConversationSourceScope,
  type ConversationMutationScope,
  type DecisionSource,
  type TaskSource,
  conversationMutationScopeMatches,
} from "@/components/conversations/conversationUtils";
import type {
  ReportConversationFailure,
  ResolveConversationFailure,
} from "@/components/conversations/useConversationFailures";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import type {
  DecisionCandidate,
  DecisionCandidateList,
  DecisionCandidateSourceCoverage,
  WorkspaceChannelMessage,
  WorkspaceConversationAssistance,
  WorkspaceConversationAssistanceMode,
} from "@/lib/workspace-types";

const assistanceLabels: Record<WorkspaceConversationAssistanceMode, string> = {
  summary: "Summarize",
  decisions: "Decisions",
  actions: "Actions",
  blockers: "Blockers",
};
const ASSISTANCE_FAILURE_KEY = "conversation:assistance";
const ASSISTANCE_ERROR_MESSAGE = "Conversation assistance is temporarily unavailable. Please try again in a moment.";
const CANDIDATE_ERROR_MESSAGE = "Unable to scan this conversation for decision candidates. Please try again in a moment.";

function mergeDecisionCandidates(current: DecisionCandidate[], incoming: DecisionCandidate[]) {
  const knownIds = new Set(current.map((candidate) => candidate.id));
  return [...current, ...incoming.filter((candidate) => !knownIds.has(candidate.id))];
}

type ConversationAIPanelProps = {
  activeWorkspaceId: string | null;
  messagesCount: number;
  onFailure: ReportConversationFailure;
  onFailureResolved: ResolveConversationFailure;
  onOpenDecision: (source: DecisionSource) => void;
  onOpenTask: (source: TaskSource) => void;
  selectedChannelId: string | null;
  threadRoot: WorkspaceChannelMessage | null;
};

export function ConversationAIPanel({
  activeWorkspaceId,
  messagesCount,
  onFailure,
  onFailureResolved,
  onOpenDecision,
  onOpenTask,
  selectedChannelId,
  threadRoot,
}: ConversationAIPanelProps) {
  const [assistance, setAssistance] = useState<WorkspaceConversationAssistance | null>(null);
  const [assistanceLoading, setAssistanceLoading] = useState<WorkspaceConversationAssistanceMode | null>(null);
  const [decisionCandidatesCollapsed, setDecisionCandidatesCollapsed] = useState(true);
  const [decisionCandidates, setDecisionCandidates] = useState<DecisionCandidate[]>([]);
  const [decisionCandidateCoverage, setDecisionCandidateCoverage] = useState<DecisionCandidateSourceCoverage | null>(null);
  const [decisionCandidatesLoading, setDecisionCandidatesLoading] = useState(false);
  const [decisionCandidatesError, setDecisionCandidatesError] = useState<string | null>(null);
  const nextDecisionSourceOffset = decisionCandidateCoverage?.next_source_offset;
  const threadRootId = threadRoot?.id ?? null;
  const mountedRef = useRef(true);
  const scopeRef = useRef<ConversationMutationScope>({
    workspaceId: activeWorkspaceId,
    channelId: selectedChannelId,
    sourceId: threadRootId,
  });
  const channelScopeRevisionRef = useRef(0);
  const assistanceScopeRevisionRef = useRef(0);
  const requestSequenceRef = useRef(0);
  const assistanceRequestTokenRef = useRef<string | null>(null);
  const candidateRequestTokenRef = useRef<string | null>(null);
  const assistanceFailureTokenRef = useRef<string | null>(null);

  const resolveAssistanceFailure = useCallback((ownedToken?: string | null) => {
    const token = ownedToken ?? assistanceFailureTokenRef.current;
    if (!token || assistanceFailureTokenRef.current !== token) return;
    assistanceFailureTokenRef.current = null;
    onFailureResolved(ASSISTANCE_FAILURE_KEY, token);
  }, [onFailureResolved]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      assistanceRequestTokenRef.current = null;
      candidateRequestTokenRef.current = null;
      resolveAssistanceFailure();
    };
  }, [resolveAssistanceFailure]);

  useLayoutEffect(() => {
    const previous = scopeRef.current;
    const next: ConversationMutationScope = {
      workspaceId: activeWorkspaceId,
      channelId: selectedChannelId,
      sourceId: threadRootId,
    };
    const channelChanged = previous.workspaceId !== next.workspaceId
      || previous.channelId !== next.channelId;
    const assistanceChanged = channelChanged || previous.sourceId !== next.sourceId;
    scopeRef.current = next;
    if (channelChanged) {
      channelScopeRevisionRef.current += 1;
      candidateRequestTokenRef.current = null;
      setDecisionCandidatesCollapsed(true);
      setDecisionCandidates([]);
      setDecisionCandidateCoverage(null);
      setDecisionCandidatesLoading(false);
      setDecisionCandidatesError(null);
    }
    if (assistanceChanged) {
      assistanceScopeRevisionRef.current += 1;
      assistanceRequestTokenRef.current = null;
      resolveAssistanceFailure();
      setAssistance(null);
      setAssistanceLoading(null);
    }
  }, [activeWorkspaceId, resolveAssistanceFailure, selectedChannelId, threadRootId]);

  async function requestAssistance(mode: WorkspaceConversationAssistanceMode) {
    const requestScope = { ...scopeRef.current };
    if (
      !requestScope.workspaceId
      || !requestScope.channelId
      || assistanceRequestTokenRef.current
    ) return;
    const requestRevision = assistanceScopeRevisionRef.current;
    const requestToken = `assistance:${requestRevision}:${++requestSequenceRef.current}`;
    const endpoint = `/workspaces/${requestScope.workspaceId}/channels/${requestScope.channelId}/assist`;
    assistanceRequestTokenRef.current = requestToken;
    resolveAssistanceFailure();
    setAssistanceLoading(mode);
    const isCurrentRequest = () => mountedRef.current
      && assistanceRequestTokenRef.current === requestToken
      && assistanceScopeRevisionRef.current === requestRevision
      && conversationMutationScopeMatches(requestScope, scopeRef.current);
    try {
      const result = await apiClient.post<WorkspaceConversationAssistance>(
        endpoint,
        { mode, thread_root_id: requestScope.sourceId ?? null },
      );
      if (!isCurrentRequest()) return;
      if (result.mode !== mode) throw new Error("Assistance response mode did not match the request.");
      setAssistance(result);
      onFailureResolved(ASSISTANCE_FAILURE_KEY, requestToken);
    } catch (err) {
      if (!isCurrentRequest()) return;
      logClientError("Failed to load conversation assistance", err, { endpoint });
      assistanceFailureTokenRef.current = requestToken;
      onFailure(ASSISTANCE_FAILURE_KEY, requestToken, ASSISTANCE_ERROR_MESSAGE);
    } finally {
      if (isCurrentRequest()) {
        assistanceRequestTokenRef.current = null;
        setAssistanceLoading(null);
      }
    }
  }

  async function scanDecisionCandidates(sourceOffset = 0, append = false) {
    const requestScope: ConversationMutationScope = {
      workspaceId: scopeRef.current.workspaceId,
      channelId: scopeRef.current.channelId,
    };
    if (
      !requestScope.workspaceId
      || !requestScope.channelId
      || candidateRequestTokenRef.current
    ) return;
    const requestRevision = channelScopeRevisionRef.current;
    const requestToken = `candidates:${requestRevision}:${++requestSequenceRef.current}`;
    const endpoint = `/workspaces/${requestScope.workspaceId}/decisions/candidates/conversation/${requestScope.channelId}`;
    candidateRequestTokenRef.current = requestToken;
    setDecisionCandidatesCollapsed(false);
    setDecisionCandidatesLoading(true);
    setDecisionCandidatesError(null);
    const isCurrentRequest = () => mountedRef.current
      && candidateRequestTokenRef.current === requestToken
      && channelScopeRevisionRef.current === requestRevision
      && conversationMutationScopeMatches(requestScope, scopeRef.current);
    try {
      const result = await apiClient.post<DecisionCandidateList>(
        `${endpoint}?source_offset=${sourceOffset}`,
        {},
      );
      if (!isCurrentRequest()) return;
      if (result.source_type !== "conversation" || result.source_id !== requestScope.channelId) {
        throw new Error("Decision-candidate response did not match the requested conversation.");
      }
      setDecisionCandidates((current) => (append ? mergeDecisionCandidates(current, result.candidates) : result.candidates));
      setDecisionCandidateCoverage(result.source_coverage);
    } catch (err) {
      if (!isCurrentRequest()) return;
      logClientError("Failed to extract decision candidates", err, { endpoint });
      setDecisionCandidatesError(CANDIDATE_ERROR_MESSAGE);
    } finally {
      if (isCurrentRequest()) {
        candidateRequestTokenRef.current = null;
        setDecisionCandidatesLoading(false);
      }
    }
  }

  function sourceScope(threadRootId: string | null): ConversationSourceScope | null {
    if (!activeWorkspaceId || !selectedChannelId) return null;
    return { workspaceId: activeWorkspaceId, channelId: selectedChannelId, threadRootId };
  }

  function openCandidateDecision(candidate: DecisionCandidate) {
    const scope = sourceScope(null);
    if (scope) onOpenDecision({ kind: "candidate", candidate, scope });
  }

  function openAssistanceTask() {
    const scope = sourceScope(threadRootId);
    if (scope && assistance) onOpenTask({ kind: "assistance", assistance, scope });
  }

  async function dismissDecisionCandidate(candidate: DecisionCandidate) {
    setDecisionCandidates((current) => current.filter((item) => item.id !== candidate.id));
    if (!activeWorkspaceId) return;
    try {
      await apiClient.post(`/workspaces/${activeWorkspaceId}/decisions/candidates/metrics`, {
        action: "dismiss",
        candidate_id: candidate.id,
        source_type: candidate.source_type,
        source_id: candidate.source_id,
      });
    } catch (err) {
      logClientError("Failed to log decision candidate dismissal", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions/candidates/metrics` });
    }
  }

  if (!selectedChannelId) return null;

  return (
    <>
      <div className="flex flex-wrap gap-1 border-b border-[var(--omnix-border)] px-4 py-2">
        {Object.entries(assistanceLabels).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => void requestAssistance(mode as WorkspaceConversationAssistanceMode)}
            disabled={Boolean(assistanceLoading) || messagesCount === 0}
            className="inline-flex min-h-11 items-center gap-1 rounded-md border border-cyan-300/12 bg-cyan-300/[0.04] px-3 text-[11px] text-cyan-100/80 transition hover:bg-cyan-300/10 disabled:opacity-40"
          >
            {assistanceLoading === mode ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {label}
          </button>
        ))}
      </div>

      <div className="mx-4 mt-3">
        <DecisionCandidatePanel
          candidates={decisionCandidates}
          collapsed={decisionCandidatesCollapsed}
          loading={decisionCandidatesLoading}
          error={decisionCandidatesError}
          sourceCoverage={decisionCandidateCoverage}
          sourceType="conversation"
          onToggle={() => {
            setDecisionCandidatesCollapsed((collapsed) => !collapsed);
            if (decisionCandidatesCollapsed && decisionCandidateCoverage === null && !decisionCandidatesLoading) {
              void scanDecisionCandidates();
            }
          }}
          onRefresh={() => void scanDecisionCandidates()}
          onScanMore={
            typeof nextDecisionSourceOffset !== "number"
              ? undefined
              : () => void scanDecisionCandidates(nextDecisionSourceOffset, true)
          }
          onCreate={(candidate) => void openCandidateDecision(candidate)}
          onDismiss={(candidate) => void dismissDecisionCandidate(candidate)}
        />
      </div>

      {assistance ? (
        <div className="mx-4 mt-3 rounded-xl border border-purple-300/15 bg-purple-300/[0.045] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-purple-100/80">
              <Sparkles className="h-3.5 w-3.5" /> Ambient assistance / {assistance.mode}
            </p>
            <button type="button" onClick={() => setAssistance(null)} aria-label="Dismiss assistance" title="Dismiss assistance" className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/30 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[10px] text-[var(--omnix-text-3)]">Derived from {assistance.source_message_count} discussion messages. Not posted into the channel.</p>
            {assistance.mode === "actions" ? (
              <button
                type="button"
                onClick={openAssistanceTask}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-purple-300/15 px-3 text-[11px] text-purple-100/85 transition hover:bg-purple-300/[0.08]"
              >
                <ClipboardCheck className="h-3.5 w-3.5" /> Convert selected action
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
