import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import {
  type ConversationMutationScope,
  type ConversationSourceScope,
  type DisplayMessage,
  conversationMutationScopeMatches,
  conversationSourceScopeMatches,
  hydrateConversationMessageAuthor,
  markOptimisticMessageFailed,
  mergeMessage,
  messageHasPersistedActions,
  messageMatchesConversationMutation,
  persistedMessageForNonce,
} from "../components/conversations/conversationUtils";
import type { WorkspaceMember } from "../lib/workspace-types";

function message(
  overrides: Partial<DisplayMessage> = {},
): DisplayMessage {
  return {
    id: "message-one",
    workspace_id: "workspace-one",
    channel_id: "channel-one",
    author_user_id: "user-one",
    parent_message_id: null,
    content: "Ship the release",
    context_links: [],
    metadata: {},
    mentions: [],
    client_nonce: "nonce-one",
    created_at: "2026-07-29T00:00:00.000Z",
    updated_at: "2026-07-29T00:00:00.000Z",
    author_avatar_label: "U",
    thread_reply_count: 0,
    ...overrides,
  };
}

test("an unchanged retry replaces the failed optimistic row by nonce", () => {
  const failed = message({
    id: "pending-nonce-one",
    delivery: "failed",
  });
  const retry = message({
    id: "pending-nonce-one",
    delivery: "sending",
  });

  const merged = mergeMessage([failed], retry);

  expect(merged).toHaveLength(1);
  expect(merged[0]).toMatchObject({
    id: "pending-nonce-one",
    client_nonce: "nonce-one",
    delivery: "sending",
  });
});

test("a late HTTP failure cannot relabel a realtime-committed row", () => {
  const committed = message({ id: "server-message-one" });
  const current = [committed];

  expect(persistedMessageForNonce(current, "nonce-one")).toBe(committed);
  expect(markOptimisticMessageFailed(current, "nonce-one")).toBe(current);
  expect(messageHasPersistedActions(committed)).toBe(true);
});

test("a raw realtime commit preserves optimistic display metadata until hydration", () => {
  const mention = {
    user_id: "user-two",
    display_name: "Taylor Ops",
    avatar_label: "T",
  };
  const optimistic = message({
    id: "pending-nonce-display",
    client_nonce: "nonce-display",
    delivery: "sending",
    author_name: "Release Tester",
    author_avatar_label: "R",
    mentions: [mention],
  });
  const committed = mergeMessage([optimistic], {
    id: "persisted-display",
    workspace_id: optimistic.workspace_id,
    channel_id: optimistic.channel_id,
    author_user_id: optimistic.author_user_id,
    parent_message_id: null,
    content: optimistic.content,
    context_links: [],
    metadata: { mentions: [mention] },
    client_nonce: optimistic.client_nonce,
    created_at: optimistic.created_at,
  } as unknown as DisplayMessage);

  expect(committed).toHaveLength(1);
  expect(committed[0]).toMatchObject({
    id: "persisted-display",
    author_name: optimistic.author_name,
    author_avatar_label: optimistic.author_avatar_label,
    mentions: optimistic.mentions,
    thread_reply_count: 0,
  });
  expect(committed[0].context_links).toEqual([]);
  expect(committed[0].delivery).toBeUndefined();
});

test("a raw realtime update preserves prior hydration while applying core fields", () => {
  const hydrated = message({
    id: "persisted-display",
    author_name: "Taylor Ops",
    author_email: "taylor@example.com",
    author_avatar_url: "https://example.com/avatar.png",
    author_avatar_label: "T",
    author_identity: { display_label: "Operator" },
    thread_reply_count: 3,
  });
  const [updated] = mergeMessage([hydrated], {
    id: hydrated.id,
    workspace_id: hydrated.workspace_id,
    channel_id: hydrated.channel_id,
    author_user_id: hydrated.author_user_id,
    parent_message_id: null,
    content: "Edited by realtime",
    context_links: [],
    metadata: {},
    client_nonce: hydrated.client_nonce,
    edited_at: "2026-07-29T00:01:00.000Z",
  } as unknown as DisplayMessage);

  expect(updated).toMatchObject({
    content: "Edited by realtime",
    author_name: "Taylor Ops",
    author_email: "taylor@example.com",
    author_avatar_url: "https://example.com/avatar.png",
    author_avatar_label: "T",
    author_identity: { display_label: "Operator" },
    thread_reply_count: 3,
  });
});

test("explicit hydrated empty values win and unmatched realtime rows are safe", () => {
  const hydrated = message({
    author_name: "Taylor Ops",
    author_email: "taylor@example.com",
    mentions: [{ user_id: "user-two", avatar_label: "T" }],
    thread_reply_count: 4,
  });
  const [cleared] = mergeMessage([hydrated], {
    ...hydrated,
    author_name: null,
    author_email: null,
    author_avatar_url: null,
    author_identity: null,
    mentions: [],
    thread_reply_count: 0,
  });
  expect(cleared).toMatchObject({
    author_name: null,
    author_email: null,
    author_avatar_url: null,
    author_identity: null,
    mentions: [],
    thread_reply_count: 0,
  });

  const [unmatched] = mergeMessage([], {
    id: "raw-only",
    workspace_id: "workspace-one",
    channel_id: "channel-one",
    author_user_id: "user-one",
    parent_message_id: null,
    content: "Raw message",
    context_links: [],
    metadata: {},
  } as unknown as DisplayMessage);
  expect(unmatched).toMatchObject({
    author_avatar_label: "U",
    mentions: [],
    thread_reply_count: 0,
  });
});

test("a realtime row can be rehydrated after membership arrives", () => {
  const raw = message({
    author_name: undefined,
    author_email: undefined,
    author_identity: undefined,
  });
  const member: WorkspaceMember = {
    workspace_id: raw.workspace_id,
    user_id: raw.author_user_id,
    role: "team_lead",
    email: "taylor@example.com",
    full_name: "Taylor Ops",
    avatar_label: "T",
    operational_label: "Release captain",
  };

  expect(hydrateConversationMessageAuthor(raw, [])).toBe(raw);
  expect(hydrateConversationMessageAuthor(raw, [member])).toMatchObject({
    author_name: "Taylor Ops",
    author_email: "taylor@example.com",
    author_avatar_label: "T",
    author_identity: { display_label: "Team Lead • Release captain" },
  });
});

test("only the matching synthetic sending row is marked failed", () => {
  const pending = message({
    id: "pending-nonce-one",
    delivery: "sending",
  });
  const failed = markOptimisticMessageFailed([pending], "nonce-one");

  expect(failed).toEqual([
    expect.objectContaining({
      id: "pending-nonce-one",
      delivery: "failed",
    }),
  ]);
  expect(messageHasPersistedActions(failed[0])).toBe(false);
  expect(messageHasPersistedActions(pending)).toBe(false);
});

test("message responses must match workspace, channel, thread, and nonce", () => {
  const scope: ConversationMutationScope = {
    workspaceId: "workspace-one",
    channelId: "channel-one",
    sourceId: "root-one",
  };
  const created = message({
    id: "server-reply-one",
    parent_message_id: "root-one",
  });

  expect(messageMatchesConversationMutation(
    created,
    scope,
    "nonce-one",
    "root-one",
  )).toBe(true);
  expect(messageMatchesConversationMutation(
    { ...created, workspace_id: "workspace-two" },
    scope,
    "nonce-one",
    "root-one",
  )).toBe(false);
  expect(messageMatchesConversationMutation(
    { ...created, channel_id: "channel-two" },
    scope,
    "nonce-one",
    "root-one",
  )).toBe(false);
  expect(messageMatchesConversationMutation(
    { ...created, parent_message_id: "root-two" },
    scope,
    "nonce-one",
    "root-one",
  )).toBe(false);
  expect(messageMatchesConversationMutation(
    created,
    scope,
    "nonce-two",
    "root-one",
  )).toBe(false);
});

test("mutation scopes reject stale workspace, channel, and source completions", () => {
  const request: ConversationMutationScope = {
    workspaceId: "workspace-one",
    channelId: "channel-one",
    sourceId: "message-one",
  };

  expect(conversationMutationScopeMatches(request, { ...request })).toBe(true);
  expect(conversationMutationScopeMatches(request, {
    ...request,
    workspaceId: "workspace-two",
  })).toBe(false);
  expect(conversationMutationScopeMatches(request, {
    ...request,
    channelId: "channel-two",
  })).toBe(false);
  expect(conversationMutationScopeMatches(request, {
    ...request,
    sourceId: "message-two",
  })).toBe(false);
  expect(conversationMutationScopeMatches(
    { workspaceId: "workspace-one" },
    { workspaceId: "workspace-one", channelId: "channel-two" },
  )).toBe(true);
});

test("modal source ownership follows its opening channel and optional thread", () => {
  const channelSource: ConversationSourceScope = {
    workspaceId: "workspace-one",
    channelId: "channel-one",
    threadRootId: null,
  };
  const threadSource: ConversationSourceScope = {
    ...channelSource,
    threadRootId: "root-one",
  };

  expect(conversationSourceScopeMatches(
    channelSource,
    "workspace-one",
    "channel-one",
    "root-two",
  )).toBe(true);
  expect(conversationSourceScopeMatches(
    threadSource,
    "workspace-one",
    "channel-one",
    "root-one",
  )).toBe(true);
  expect(conversationSourceScopeMatches(
    threadSource,
    "workspace-one",
    "channel-one",
    null,
  )).toBe(false);
  expect(conversationSourceScopeMatches(
    threadSource,
    "workspace-one",
    "channel-two",
    "root-one",
  )).toBe(false);
});

test("conversation mutation surfaces use exclusive guards and scoped attempts", () => {
  const frontendRoot = process.cwd().endsWith("frontend")
    ? process.cwd()
    : resolve(process.cwd(), "frontend");
  const sender = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/useWorkspaceConversationSender.ts",
    ),
    "utf8",
  );
  const surface = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/WorkspaceConversationSurface.tsx",
    ),
    "utf8",
  );
  const channelList = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/ChannelList.tsx",
    ),
    "utf8",
  );
  const taskModal = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/TaskFromMessageModal.tsx",
    ),
    "utf8",
  );
  const decisionModal = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/DecisionFromMessageModal.tsx",
    ),
    "utf8",
  );
  const aiPanel = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/ConversationAIPanel.tsx",
    ),
    "utf8",
  );
  const mentionTextarea = readFileSync(
    resolve(
      frontendRoot,
      "components/mentions/MentionTextarea.tsx",
    ),
    "utf8",
  );
  const failureHook = readFileSync(
    resolve(
      frontendRoot,
      "components/conversations/useConversationFailures.ts",
    ),
    "utf8",
  );

  expect(sender).toContain("runExclusiveMutation");
  expect(sender).toContain("mutationAttempt(attemptRef.current, fingerprint)");
  expect(sender).toContain("persistedMessageForNonce");
  expect(sender).toContain("queryGet<WorkspaceChannelMessage[]>");
  expect(sender).toContain("{ force: true }");
  expect(sender).toContain("canonicalMessageEndpoint(");
  expect(sender).toContain("messageMatchesConversationMutation(");
  expect(sender).toContain("draftRevisionRef.current !== clearedRevision");
  expect(sender).toContain("reconcileCommittedMessage");
  expect(sender).toContain("releaseExclusiveMutation(mutationRegistryRef.current, details.registryKey)");
  expect(sender).not.toContain("abandonedMutationKeysRef");
  expect(sender).toContain("onFailureResolved(`conversation:delivery:${nonce}`, nonce)");
  expect(sender).toContain("onFailure(");
  expect(sender).toContain("mutationRevisionStillOwned(");
  expect(sender).toContain("attemptDetailsRef.current.restoredDraftRevision = restoredDraftRevision");
  expect(sender).toContain("previousAttempt && previousAttempt !== attempt");
  expect(sender).toContain("message.delivery === \"failed\"");
  expect(surface).toContain("reconcileCommittedMessage(incoming)");
  expect(surface).toContain("channelCreatePendingTokenRef");
  expect(surface).toContain("runExclusiveMutation(channelMutationRegistryRef.current");
  expect(surface).toContain("const refreshedChannels = await refreshChannels()");
  expect(surface).toContain("!knownChannelIds.has(channel.id)");
  expect(surface).toContain("useConversationFailures()");
  expect(surface).toContain("channelSelectionRevisionRef.current");
  expect(surface).toContain("resolveScopedFailure(DISCUSSION_FAILURE_KEY, discussionFailureTokenRef)");
  expect(surface).toContain("resolveScopedFailure(THREAD_FAILURE_KEY, threadFailureTokenRef)");
  expect(surface).toContain("updateMessages([]);\n    void loadMessages(selectedChannelId)");
  expect(surface).toContain("updateMessages((current) => mergeMessage(current, reconciledRoot))");
  expect(surface).toContain("current.map(hydrateRealtimeMessage)");
  expect(channelList).toContain("disabled={creatingChannel}");
  expect(channelList).toContain("disabled={!channelName.trim() || creatingChannel}");
  expect(taskModal).toContain("attemptsRef.current.get(fingerprint) ?? null");
  expect(taskModal).toContain("const activationToken = `${attempt.nonce}:${++requestRevisionRef.current}`");
  expect(taskModal).toContain("releaseExclusiveMutations(mutationRegistryRef.current, () => true)");
  expect(taskModal).toContain("{ force: true }");
  expect(taskModal).toContain("task.client_nonce === attempt.nonce");
  expect(taskModal).toContain("conversationMutationScopeMatches(requestScope, scopeRef.current)");
  expect(taskModal).toContain("invalidateQueries(`/workspaces/${requestWorkspaceId}/tasks`)");
  expect(taskModal).toContain("disabled={creating}");
  expect(taskModal).toContain("onFailure: ReportConversationFailure");
  expect(taskModal).toContain("failureScopeRef.current === nextScope");
  expect(taskModal).toContain("conversationSourceScopeMatches(");
  expect(taskModal).toContain("sourceId: sourceIsOwned ? sourceScopeId : null");
  expect(decisionModal).toContain("runExclusiveMutation(mutationRegistryRef.current");
  expect(decisionModal).toContain("releaseExclusiveMutations(mutationRegistryRef.current, () => true)");
  expect(decisionModal).toContain("attemptsRef.current.get(fingerprint) ?? null");
  expect(decisionModal).toContain("client_nonce: attempt.nonce");
  expect(decisionModal).toContain("queryGet<WorkspaceDecision[]>");
  expect(decisionModal).toContain("decision.client_nonce === attempt.nonce");
  expect(decisionModal).toContain("failureScopeRef.current === nextScope");
  expect(decisionModal).toContain("conversationSourceScopeMatches(");
  expect(decisionModal).toContain("sourceId: sourceIsOwned ? sourceScopeId : null");
  expect(decisionModal).toContain("invalidateQueries(`/workspaces/${requestWorkspaceId}/decisions`)");
  expect(decisionModal).toContain("disabled={creating}");
  expect(decisionModal).toContain("onFailure: ReportConversationFailure");
  expect(aiPanel).toContain("assistanceRequestTokenRef.current");
  expect(aiPanel).toContain("candidateRequestTokenRef.current");
  expect(aiPanel).toContain("assistanceScopeRevisionRef.current === requestRevision");
  expect(aiPanel).toContain("channelScopeRevisionRef.current === requestRevision");
  expect(aiPanel).toContain("conversationMutationScopeMatches(requestScope, scopeRef.current)");
  expect(aiPanel).toContain("onFailure(ASSISTANCE_FAILURE_KEY, requestToken");
  expect(aiPanel).toContain("onFailureResolved(ASSISTANCE_FAILURE_KEY, token)");
  expect(aiPanel).toContain("onOpenDecision({ kind: \"candidate\", candidate, scope })");
  expect(aiPanel).toContain("onOpenTask({ kind: \"assistance\", assistance, scope })");
  expect(surface).toContain("threadRootId: threadRoot?.id ?? null");
  expect(surface).toContain("currentThreadRootId={threadRoot?.id ?? null}");
  expect(surface).toContain("onFailure={reportFailure} onFailureResolved={resolveFailure}");
  expect(failureHook).toContain("recordOwnedMutationFailure");
  expect(failureHook).toContain("resolveOwnedMutationFailure");
  expect(failureHook).toContain("latestOwnedMutationFailure");
  expect(mentionTextarea).toContain("const pickerOpen = Boolean(!disabled && trigger && candidates.length)");
  expect(mentionTextarea.match(/disabled=\{disabled\}/g)).toHaveLength(2);
});
