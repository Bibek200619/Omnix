"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ClipboardCheck, X } from "lucide-react";
import type { TaskSource } from "@/components/conversations/conversationUtils";
import { MentionTextarea, mentionPayload } from "@/components/mentions/MentionTextarea";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Portal } from "@/components/ui/Portal";
import { apiClient } from "@/lib/api";
import { logClientError } from "@/lib/errors";
import type {
  WorkspaceChannelMessage,
  WorkspaceMentionMetadata,
  WorkspaceMember,
  WorkspaceTask,
} from "@/lib/workspace-types";

type TaskFromMessageModalProps = {
  activeMembers: WorkspaceMember[];
  activeWorkspaceId: string | null;
  onClose: () => void;
  onCreated: (message: string) => void;
  onError: (message: string) => void;
  selectedChannelId: string | null;
  source: TaskSource | null;
  threadRoot: WorkspaceChannelMessage | null;
};

function taskTitleFromMessage(message: WorkspaceChannelMessage) {
  const title = message.content.replace(/\s+/g, " ").trim();
  return title.length > 110 ? `${title.slice(0, 107).trim()}...` : title;
}

export function TaskFromMessageModal({
  activeMembers,
  activeWorkspaceId,
  onClose,
  onCreated,
  onError,
  selectedChannelId,
  source,
  threadRoot,
}: TaskFromMessageModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!source) {
      setTitle("");
      setDescription("");
      setMentions([]);
      return;
    }
    if (source.kind === "message") {
      setTitle(taskTitleFromMessage(source.message));
      setDescription(source.message.content);
      setMentions(source.message.mentions || []);
      return;
    }
    setTitle("");
    setDescription(source.assistance.content);
    setMentions([]);
  }, [source]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspaceId || !selectedChannelId || !source || !title.trim()) return;
    const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    try {
      setCreating(true);
      const created =
        source.kind === "message"
          ? await apiClient.post<WorkspaceTask>(
              `/workspaces/${activeWorkspaceId}/tasks/from-message/${selectedChannelId}/${source.message.id}`,
              {
                title: title.trim(),
                description: description.trim() || null,
                status: "idea",
                client_nonce: nonce,
                mentions: mentionPayload(mentions, description),
              },
            )
          : await apiClient.post<WorkspaceTask>(
              `/workspaces/${activeWorkspaceId}/tasks/from-assistance/${selectedChannelId}`,
              {
                title: title.trim(),
                description: description.trim() || null,
                assistance_text: source.assistance.content,
                thread_root_id: threadRoot?.id ?? null,
                status: "idea",
                client_nonce: nonce,
                mentions: mentionPayload(mentions, description),
              },
            );
      onCreated(`Task opened: ${created.title}`);
      onClose();
    } catch (err) {
      logClientError("Failed to open task from discussion", err, { endpoint: `/workspaces/${activeWorkspaceId}/tasks` });
      onError("Unable to open task from discussion. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  }

  if (!source) return null;

  return (
    <Portal>
      <div className="omnix-mobile-sheet-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6">
        <form onSubmit={createTask} className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to execution</p>
              <h2 className="mt-1 text-base font-semibold text-white">Open linked task</h2>
            </div>
            <button type="button" onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/45 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70" aria-label="Close task conversion">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name the specific next step" className="h-10 text-sm" autoFocus />
          <MentionTextarea
            value={description}
            onChange={setDescription}
            members={activeMembers}
            mentions={mentions}
            onMentionsChange={setMentions}
            className="omnix-input mt-2 min-h-[104px] w-full resize-none rounded-lg p-3 text-sm leading-6"
            placeholder="Carry forward the operational context"
          />
          <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
            This creates one Idea task linked to {source.kind === "message" ? "the source message" : "the selected AI extraction and channel"}. Ownership and dates remain unset unless recorded later.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim()} leftIcon={<ClipboardCheck className="h-3.5 w-3.5" />}>
              Open task
            </Button>
          </div>
        </form>
      </div>
    </Portal>
  );
}
