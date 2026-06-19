"use client";

import { useEffect, useState, type FormEvent } from "react";
import { BadgeCheck, X } from "lucide-react";
import {
  type DecisionSource,
  decisionStatusLabels,
} from "@/components/conversations/conversationUtils";
import { MentionTextarea, mentionPayload } from "@/components/mentions/MentionTextarea";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Portal } from "@/components/ui/Portal";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
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
  onError: (message: string) => void;
  selectedChannelId: string | null;
  source: DecisionSource | null;
};

function decisionTitleFromMessage(message: WorkspaceChannelMessage) {
  const title = message.content.replace(/\s+/g, " ").trim();
  return title.length > 110 ? `${title.slice(0, 107).trim()}...` : title;
}

export function DecisionFromMessageModal({
  activeMembers,
  activeWorkspaceId,
  onClose,
  onCreated,
  onError,
  selectedChannelId,
  source,
}: DecisionFromMessageModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reason, setReason] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [status, setStatus] = useState<WorkspaceDecisionStatus>("accepted");
  const [creating, setCreating] = useState(false);

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
    setDescription(`Supporting evidence:\n${source.candidate.supporting_evidence.join("\n")}`);
    setMentions([]);
    setStatus("proposed");
  }, [source]);

  async function createDecision(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !selectedChannelId || !source || !title.trim()) return;
    try {
      setCreating(true);
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        decision_reason: reason.trim() || null,
        status,
        mentions: mentionPayload(mentions, `${reason}\n${description}`),
      };
      const created =
        source.kind === "message"
          ? await apiClient.post<WorkspaceDecision>(
              `/workspaces/${activeWorkspaceId}/decisions/from-message/${selectedChannelId}/${source.message.id}`,
              payload,
            )
          : await apiClient.post<WorkspaceDecision>(`/workspaces/${activeWorkspaceId}/decisions`, payload);
      onCreated(`Decision recorded: ${created.title}`);
      onClose();
    } catch (err) {
      logClientError("Failed to record decision from discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions` });
      onError("Unable to record decision from discussion. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!source) return null;

  return (
    <Portal>
      <div className="omnix-mobile-sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6">
        <form onSubmit={createDecision} className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to decision</p>
              <h2 className="mt-1 text-base font-semibold text-white">Record linked decision</h2>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/45 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" aria-label="Close decision conversion">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name the organizational choice" className="h-10 text-sm" autoFocus />
          <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem]">
            <MentionTextarea
              value={reason}
              onChange={setReason}
              members={activeMembers}
              mentions={mentions}
              onMentionsChange={setMentions}
              className="omnix-input min-h-[96px] w-full resize-none rounded-lg p-3 text-sm leading-6"
              placeholder="Reason, if explicitly known"
            />
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Status</span>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as WorkspaceDecisionStatus)}
                className="omnix-input h-10 w-full rounded-lg px-3 text-sm"
              >
                {Object.entries(decisionStatusLabels).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </label>
          </div>
          <MentionTextarea
            value={description}
            onChange={setDescription}
            members={activeMembers}
            mentions={mentions}
            onMentionsChange={setMentions}
            className="omnix-input mt-2 min-h-[92px] w-full resize-none rounded-lg p-3 text-sm leading-6"
            placeholder="Source description"
          />
          <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
            {source.kind === "message"
              ? "This creates one decision linked to the selected message, channel, and workspace. It does not infer agreement beyond what you record here."
              : "This suggestion is not a decision yet. Review the evidence and submit only if the workspace should record it."}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim()} leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}>
              Record decision
            </Button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
