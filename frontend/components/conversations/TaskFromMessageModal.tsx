"use client";

import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ClipboardCheck, X } from "lucide-react";
import {
  type ConversationMutationScope,
  type TaskSource,
  conversationMutationScopeMatches,
  conversationSourceScopeMatches,
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
  WorkspaceMentionMetadata,
  WorkspaceMember,
  WorkspaceTask,
} from "@/lib/workspace-types";

type TaskFromMessageModalProps = {
  activeMembers: WorkspaceMember[];
  activeWorkspaceId: string | null;
  onClose: () => void;
  onCreated: (message: string) => void;
  onFailure: ReportConversationFailure;
  onFailureResolved: ResolveConversationFailure;
  selectedChannelId: string | null;
  source: TaskSource | null;
  currentThreadRootId: string | null;
};

const TASK_CONVERSION_ERROR_MESSAGE = "Unable to open task from discussion. Check your connection and try again.";

function taskTitleFromMessage(message: WorkspaceChannelMessage) {
  const title = message.content.replace(/\s+/g, " ").trim();
  return title.length > 110 ? `${title.slice(0, 107).trim()}...` : title;
}

function taskSourceScopeId(source: TaskSource | null) {
  if (!source) return null;
  const owner = `${source.scope.workspaceId}:${source.scope.channelId}:${source.scope.threadRootId || "channel"}`;
  if (source.kind === "message") return `${owner}:message:${source.message.id}`;
  return `${owner}:assistance:${source.assistance.mode}:${source.assistance.generated_at}`;
}

export function TaskFromMessageModal({
  activeMembers,
  activeWorkspaceId,
  onClose,
  onCreated,
  onFailure,
  onFailureResolved,
  selectedChannelId,
  source,
  currentThreadRootId,
}: TaskFromMessageModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [mentions, setMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [creating, setCreating] = useState(false);
  const mutationRegistryRef = useRef(new Map<string, Promise<unknown>>());
  const attemptsRef = useRef(new Map<string, MutationAttempt>());
  const attemptScopeRef = useRef(`${activeWorkspaceId}:${selectedChannelId}`);
  const failureScopeRef = useRef("");
  const failureTokensRef = useRef(new Map<string, string>());
  const requestRevisionRef = useRef(0);
  const pendingTokenRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const sourceScopeId = taskSourceScopeId(source);
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

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !source || !title.trim() || !sourceIsOwned
    ) return;
    const requestSource = source;
    const requestWorkspaceId = requestSource.scope.workspaceId;
    const requestChannelId = requestSource.scope.channelId;
    const requestThreadRootId = requestSource.scope.threadRootId;
    const requestSourceScopeId = taskSourceScopeId(requestSource);
    const requestScope: ConversationMutationScope = {
      workspaceId: requestWorkspaceId,
      channelId: requestChannelId,
      sourceId: requestSourceScopeId,
    };
    const requestTitle = title.trim();
    const requestDescription = description.trim() || null;
    const requestMentions = mentionPayload(mentions, description);
    const fingerprint = JSON.stringify({
      ...requestScope,
      title: requestTitle,
      description: requestDescription,
      mentions: requestMentions,
      assistanceText: requestSource.kind === "assistance"
        ? requestSource.assistance.content
        : null,
      threadRootId: requestThreadRootId,
    });
    const registryKey = `conversation:task:create:${requestWorkspaceId}:${requestChannelId}:${requestSourceScopeId}`;

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

      const resolveAttempt = (created: WorkspaceTask) => {
        if (attemptsRef.current.get(fingerprint) === attempt) {
          attemptsRef.current.delete(fingerprint);
        }
        failureTokensRef.current.delete(failureKey);
        onFailureResolved(failureKey, activationToken);
        onCreated(`Task opened: ${created.title}`);
        onClose();
      };

      try {
        const created =
          requestSource.kind === "message"
            ? await apiClient.post<WorkspaceTask>(
                `/workspaces/${requestWorkspaceId}/tasks/from-message/${requestChannelId}/${requestSource.message.id}`,
                {
                  title: requestTitle,
                  description: requestDescription,
                  status: "idea",
                  client_nonce: attempt.nonce,
                  mentions: requestMentions,
                },
              )
            : await apiClient.post<WorkspaceTask>(
                `/workspaces/${requestWorkspaceId}/tasks/from-assistance/${requestChannelId}`,
                {
                  title: requestTitle,
                  description: requestDescription,
                  assistance_text: requestSource.assistance.content,
                  thread_root_id: requestThreadRootId,
                  status: "idea",
                  client_nonce: attempt.nonce,
                  mentions: requestMentions,
                },
              );
        invalidateQueries(`/workspaces/${requestWorkspaceId}/tasks`);
        if (!isCurrentAttempt()) return;
        if (
          created.workspace_id !== requestWorkspaceId
          || created.client_nonce !== attempt.nonce
        ) {
          throw new Error("Task response did not match the active mutation.");
        }
        resolveAttempt(created);
      } catch (err) {
        if (!isCurrentAttempt()) return;
        let committed: WorkspaceTask | undefined;
        try {
          const canonical = await queryGet<WorkspaceTask[]>(
            `/workspaces/${requestWorkspaceId}/tasks`,
            { force: true },
          );
          committed = canonical.find((task) => (
            task.workspace_id === requestWorkspaceId
            && task.client_nonce === attempt.nonce
          ));
        } catch (reconciliationError) {
          logClientError("Failed to reconcile task conversion", reconciliationError, {
            endpoint: `/workspaces/${requestWorkspaceId}/tasks`,
          });
        }
        if (!isCurrentAttempt()) return;
        if (committed) {
          resolveAttempt(committed);
          return;
        }
        logClientError("Failed to open task from discussion", err, {
          endpoint: `/workspaces/${requestWorkspaceId}/tasks`,
        });
        failureTokensRef.current.set(failureKey, activationToken);
        onFailure(failureKey, activationToken, TASK_CONVERSION_ERROR_MESSAGE);
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
      title="Open linked task"
      description="Create one task linked to the selected discussion."
      closeDisabled={creating}
      backdropClassName="omnix-mobile-sheet-backdrop z-50 bg-black/65 px-4 py-6"
      className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border border-cyan-300/15 p-4 shadow-2xl sm:p-5"
    >
        <form onSubmit={createTask}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Discussion to execution</p>
              <h2 className="mt-1 text-base font-semibold text-white">Open linked task</h2>
            </div>
            <button type="button" onClick={onClose} disabled={creating} className="inline-flex h-11 w-11 items-center justify-center rounded-md text-white/45 hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Close task conversion">
              <X className="h-4 w-4" />
            </button>
          </div>
          <Input aria-label="Task title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name the specific next step" className="h-10 text-sm" autoFocus disabled={creating} />
          <MentionTextarea
            aria-label="Task description"
            value={description}
            onChange={setDescription}
            members={activeMembers}
            mentions={mentions}
            onMentionsChange={setMentions}
            className="omnix-input mt-2 min-h-[104px] w-full resize-none rounded-lg p-3 text-sm leading-6"
            placeholder="Carry forward the operational context"
            disabled={creating}
          />
          <p className="mt-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">
            This creates one Idea task linked to {source.kind === "message" ? "the source message" : "the selected AI extraction and channel"}. Ownership and dates remain unset unless recorded later.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={onClose} disabled={creating}>Cancel</Button>
            <Button type="submit" size="sm" isLoading={creating} disabled={!title.trim() || creating} leftIcon={<ClipboardCheck className="h-3.5 w-3.5" />}>
              Open task
            </Button>
          </div>
        </form>
    </Modal>
  );
}
