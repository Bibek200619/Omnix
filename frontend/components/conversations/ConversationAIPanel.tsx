"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck, Loader2, Sparkles, X } from "lucide-react";
import { DecisionCandidatePanel } from "@/components/decisions/DecisionCandidatePanel";
import type { DecisionSource, TaskSource } from "@/components/conversations/conversationUtils";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import type {
  DecisionCandidate,
  DecisionCandidateList,
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

type ConversationAIPanelProps = {
  activeWorkspaceId: string | null;
  messagesCount: number;
  onError: (message: string) => void;
  onOpenDecision: (source: DecisionSource) => void;
  onOpenTask: (source: TaskSource) => void;
  selectedChannelId: string | null;
  threadRoot: WorkspaceChannelMessage | null;
};

export function ConversationAIPanel({
  activeWorkspaceId,
  messagesCount,
  onError,
  onOpenDecision,
  onOpenTask,
  selectedChannelId,
  threadRoot,
}: ConversationAIPanelProps) {
  const [assistance, setAssistance] = useState<WorkspaceConversationAssistance | null>(null);
  const [assistanceLoading, setAssistanceLoading] = useState<WorkspaceConversationAssistanceMode | null>(null);
  const [decisionCandidatesCollapsed, setDecisionCandidatesCollapsed] = useState(true);
  const [decisionCandidates, setDecisionCandidates] = useState<DecisionCandidate[]>([]);
  const [decisionCandidatesLoading, setDecisionCandidatesLoading] = useState(false);
  const [decisionCandidatesError, setDecisionCandidatesError] = useState<string | null>(null);

  useEffect(() => {
    setAssistance(null);
  }, [selectedChannelId]);

  async function requestAssistance(mode: WorkspaceConversationAssistanceMode) {
    if (!activeWorkspaceId || !selectedChannelId) return;
    try {
      setAssistanceLoading(mode);
      setAssistance(
        await apiClient.post<WorkspaceConversationAssistance>(
          `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/assist`,
          { mode, thread_root_id: threadRoot?.id ?? null },
        ),
      );
    } catch (err) {
      logClientError("Failed to load conversation assistance", err, { endpoint: `/workspaces/${activeWorkspaceId}/channels/${selectedChannelId}/assist` });
      onError("Conversation assistance is temporarily unavailable. Please try again in a moment.");
    } finally {
      setAssistanceLoading(null);
    }
  }

  async function scanDecisionCandidates() {
    if (!activeWorkspaceId || !selectedChannelId) return;
    setDecisionCandidatesCollapsed(false);
    setDecisionCandidatesLoading(true);
    setDecisionCandidatesError(null);
    try {
      const result = await apiClient.post<DecisionCandidateList>(
        `/workspaces/${activeWorkspaceId}/decisions/candidates/conversation/${selectedChannelId}`,
        {},
      );
      setDecisionCandidates(result.candidates);
    } catch (err) {
      logClientError("Failed to extract decision candidates", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions/candidates/conversation/${selectedChannelId}` });
      setDecisionCandidatesError("Unable to scan this conversation for decision candidates. Please try again in a moment.");
    } finally {
      setDecisionCandidatesLoading(false);
    }
  }

  function openCandidateDecision(candidate: DecisionCandidate) {
    onOpenDecision({ kind: "candidate", candidate });
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
          onToggle={() => {
            setDecisionCandidatesCollapsed((collapsed) => !collapsed);
            if (decisionCandidatesCollapsed && decisionCandidates.length === 0 && !decisionCandidatesLoading) {
              void scanDecisionCandidates();
            }
          }}
          onRefresh={() => void scanDecisionCandidates()}
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
                onClick={() => onOpenTask({ kind: "assistance", assistance })}
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
