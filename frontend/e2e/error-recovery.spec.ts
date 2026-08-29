import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const appErrorBoundary = frontendSource("components/layout/AppErrorBoundary.tsx");
const chatInput = frontendSource("components/chat/ChatInput.tsx");
const chatInterface = frontendSource("components/chat/ChatInterface.tsx");
const conversationSurface = frontendSource("components/conversations/WorkspaceConversationSurface.tsx");
const conversationSender = frontendSource("components/conversations/useWorkspaceConversationSender.ts");
const taskSurface = frontendSource("components/tasks/WorkspaceTasksSurface.tsx");
const initiativeSurface = frontendSource("components/initiatives/WorkspaceInitiativesSurface.tsx");
const recoverableDraft = frontendSource("lib/recoverable-draft.ts");

test("application recovery retries in place before offering a page reload", () => {
  expect(appErrorBoundary).toContain("Try recovering first.");
  expect(appErrorBoundary).toContain("Drafts in active composers are restored");
  expect(appErrorBoundary).toContain("onClick={this.reset}");
  expect(appErrorBoundary).toContain("Reload page");
  expect(appErrorBoundary).toContain("window.location.reload()");
  expect(appErrorBoundary).toContain("active composer drafts are restored when it remounts");
});

test("recoverable drafts are session-scoped and clear on default values", () => {
  expect(recoverableDraft).toContain('const draftStoragePrefix = "omnix.draft.v1"');
  expect(recoverableDraft).toContain("window.sessionStorage");
  expect(recoverableDraft).toContain("encodeURIComponent(text)");
  expect(recoverableDraft).toContain("store.removeItem(key)");
  expect(recoverableDraft).toContain("useRecoverableTextDraft");
});

test("chat and conversation composers persist draft text by active scope", () => {
  expect(chatInput).toContain("useRecoverableTextDraft(draftStorageKey)");
  expect(chatInput).toContain("clearValue()");
  expect(chatInterface).toContain("draftStorageKey={chatDraftStorageKey}");
  expect(chatInterface).toContain('"chat"');
  expect(chatInterface).toContain("chatMessages.currentConversation || conversationId || \"new\"");

  expect(conversationSender).toContain('"workspace-conversation"');
  expect(conversationSender).toContain('"main"');
  expect(conversationSender).toContain('"thread"');
  expect(conversationSender).toContain("useRecoverableTextDraft(mainDraftStorageKey)");
  expect(conversationSender).toContain("useRecoverableTextDraft(threadDraftStorageKey)");
  expect(conversationSender).not.toContain('setDraft("");\n    setDraftMentions([]);\n    setThreadDraft("");');
  expect(conversationSurface).not.toContain('sender.setThreadDraft("");');
});

test("task and initiative creation drafts persist and clear after successful create", () => {
  expect(taskSurface).toContain('"task-create"');
  expect(taskSurface).toContain("useRecoverableTextDraft(createDraftKey(\"title\"))");
  expect(taskSurface).toContain("useRecoverableTextDraft(createDraftKey(\"description\"))");
  expect(taskSurface).toContain("useRecoverableTextDraft(createDraftKey(\"status\"), \"idea\")");
  expect(taskSurface).toContain('setStatusDraft("idea")');
  expect(taskSurface).toContain("onStatusChange={setStatusDraft}");

  expect(initiativeSurface).toContain('"initiative-create"');
  expect(initiativeSurface).toContain("useRecoverableTextDraft(createDraftKey(\"title\"))");
  expect(initiativeSurface).toContain("useRecoverableTextDraft(createDraftKey(\"description\"))");
  expect(initiativeSurface).toContain("useRecoverableTextDraft(createDraftKey(\"context\"))");
  expect(initiativeSurface).toContain('setTitle(""); setDescription(""); setOwnerId("");');
  expect(initiativeSurface).toContain('setTargetDate(""); setContext(""); setCreateOpen(false);');
});
