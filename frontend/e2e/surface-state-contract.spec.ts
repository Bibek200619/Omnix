import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const stateCard = frontendSource("components/ui/SurfaceStateCard.tsx");
const taskSurface = frontendSource("components/tasks/WorkspaceTasksSurface.tsx");
const taskList = frontendSource("components/tasks/TaskList.tsx");
const initiativeSurface = frontendSource("components/initiatives/WorkspaceInitiativesSurface.tsx");
const decisionsSurface = frontendSource("components/decisions/WorkspaceDecisionsSurface.tsx");
const conversationSurface = frontendSource("components/conversations/WorkspaceConversationSurface.tsx");
const channelList = frontendSource("components/conversations/ChannelList.tsx");
const messageThread = frontendSource("components/conversations/MessageThread.tsx");
const threadPanel = frontendSource("components/conversations/ThreadPanel.tsx");

test("surface state card separates non-error loading, empty, and inaccessible states", () => {
  expect(stateCard).toContain('type SurfaceStateTone = "loading" | "empty" | "inaccessible"');
  expect(stateCard).toContain("data-surface-state={tone}");
  expect(stateCard).toContain('role={isLoading ? "status" : "note"}');
  expect(stateCard).toContain('aria-busy={isLoading ? "true" : undefined}');
});

test("core workspace surfaces use inaccessible states when no workspace is active", () => {
  for (const source of [taskSurface, initiativeSurface, decisionsSurface, conversationSurface]) {
    expect(source).toContain('tone="inaccessible"');
    expect(source).toContain('title="No Active Workspace"');
    expect(source).toContain("Choose an accessible workspace");
  }
});

test("core list surfaces expose loading and empty states without collapsing them into errors", () => {
  expect(taskList).toContain('aria-label="Loading tasks"');
  expect(taskList).toContain("Loading tasks…");
  expect(taskList).toContain('tone="empty"');
  expect(taskList).toContain('title="No tasks yet"');

  expect(initiativeSurface).toContain('tone="loading"');
  expect(initiativeSurface).toContain('title="Loading Initiatives"');
  expect(initiativeSurface).toContain('title="No initiatives yet"');

  expect(decisionsSurface).toContain("Loading decisions…");
  expect(decisionsSurface).toContain('title="No decisions recorded"');
  expect(decisionsSurface).toContain("Decisions are unavailable");
});

test("conversation surfaces separate no channel, no messages, no replies, and restricted posting", () => {
  expect(channelList).toContain("Loading channels…");
  expect(channelList).toContain('title="No Channels Yet"');
  expect(channelList).toContain("No accessible channels are available");

  expect(messageThread).toContain("Loading discussion…");
  expect(messageThread).toContain('title={selectedChannel ? "No Operational Discussion Yet" : "No Channel Selected"}');
  expect(messageThread).toContain("posting is restricted to workspace leads");

  expect(threadPanel).toContain("Loading thread replies…");
  expect(threadPanel).toContain('title="No Thread Replies Yet"');
  expect(threadPanel).toContain("replies are restricted to workspace leads");
});
