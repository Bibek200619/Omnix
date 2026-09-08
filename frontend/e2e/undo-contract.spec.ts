import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const toastContext = frontendSource("lib/toast-context.tsx");
const undoToast = frontendSource("lib/undo-toast.ts");
const conversationHistory = frontendSource("lib/conversation-history-context.tsx");
const historyList = frontendSource("components/chat/HistoryList.tsx");
const actionsMenu = frontendSource("components/actions/ActionsMenu.tsx");
const workspaceSelector = frontendSource("components/layout/sidebar/WorkspaceSelector.tsx");

test("toast layer exposes a reusable bounded action slot for undo", () => {
  expect(toastContext).toContain("action?:");
  expect(toastContext).toContain("runToastAction");
  expect(toastContext).toContain("dismissToast(toast.id)");
  expect(undoToast).toContain("showUndoToast");
  expect(undoToast).toContain('label: "Undo"');
  expect(undoToast).toContain("durationMs = 8000");
});

test("conversation archive is reversible through a restore mutation", () => {
  expect(conversationHistory).toContain("archiveConversation: (conversationId: string) => Promise<ConversationSummary | null>");
  expect(conversationHistory).toContain("{ is_archived: true }");
  expect(conversationHistory).toContain("restoreConversation: (conversation: ConversationSummary) => Promise<void>");
  expect(conversationHistory).toContain("{ is_archived: false }");
  expect(conversationHistory).toContain("sortConversations([");
});

test("delete conversation affordances offer the shared undo action", () => {
  for (const source of [historyList, actionsMenu]) {
    expect(source).toContain("showUndoToast(showToast");
    expect(source).toContain("await restoreConversation(archived)");
    expect(source).toContain('title: "Conversation deleted"');
  }
});

test("irreversible workspace deletion remains confirmation-only and does not advertise undo", () => {
  expect(workspaceSelector).toContain("deleteConfirmText !== active.name");
  expect(workspaceSelector).toContain("await deleteWorkspace(active.id)");
  expect(workspaceSelector).not.toContain("showUndoToast");
});
