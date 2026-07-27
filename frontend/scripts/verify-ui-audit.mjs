import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

async function read(relativePath) {
  return readFile(join(root, relativePath), "utf8");
}

function assertIncludes(source, expected, label) {
  assert.ok(source.includes(expected), `${label} should include ${expected}`);
}

function assertExcludes(source, unexpected, label) {
  assert.ok(!source.includes(unexpected), `${label} should not include ${unexpected}`);
}

const [
  analyticsPage,
  conversationSurface,
  conversationSender,
  conversationUtils,
  filesPage,
  filesModel,
  pageSkeleton,
  appShell,
  sidebarNav,
  mobileDock,
  globalsCss,
  landingPage,
  ambientParticles,
  pageTransition,
  workspaceSelector,
  workspaceTreeNode,
  sidebarModals,
  inviteNotifications,
  markdownRenderer,
  workspaceTasksSurface,
  workspaceDecisionsSurface,
  workspaceInitiativesSurface,
  commandPaletteModel,
  modal,
  focusTrap,
  commandPalette,
  messageBubble,
  chatMessageUtils,
  chatStream,
  conversationAiPanel,
  decisionCandidatePanel,
] = await Promise.all([
  read("app/(dashboard)/analytics/page.tsx"),
  read("components/conversations/WorkspaceConversationSurface.tsx"),
  read("components/conversations/useWorkspaceConversationSender.ts"),
  read("components/conversations/conversationUtils.ts"),
  read("app/(dashboard)/files/page.tsx"),
  read("components/files/filesPageModel.ts"),
  read("components/ui/PageSkeleton.tsx"),
  read("components/layout/AppShell.tsx"),
  read("components/layout/sidebar/SidebarNav.tsx"),
  read("components/layout/MobileDock.tsx"),
  read("styles/globals.css"),
  read("app/page.tsx"),
  read("components/layout/AmbientParticles.tsx"),
  read("components/layout/PageTransition.tsx"),
  read("components/layout/sidebar/WorkspaceSelector.tsx"),
  read("components/layout/sidebar/WorkspaceTreeNode.tsx"),
  read("components/layout/sidebar/SidebarModals.tsx"),
  read("components/workspace/InviteNotifications.tsx"),
  read("components/chat/MarkdownRenderer.tsx"),
  read("components/tasks/WorkspaceTasksSurface.tsx"),
  read("components/decisions/WorkspaceDecisionsSurface.tsx"),
  read("components/initiatives/WorkspaceInitiativesSurface.tsx"),
  read("components/layout/command-palette/commandPaletteModel.ts"),
  read("components/ui/Modal.tsx"),
  read("lib/use-focus-trap.ts"),
  read("components/layout/CommandPalette.tsx"),
  read("components/chat/MessageBubble.tsx"),
  read("components/chat/chatMessageUtils.ts"),
  read("components/chat/useChatStream.ts"),
  read("components/conversations/ConversationAIPanel.tsx"),
  read("components/decisions/DecisionCandidatePanel.tsx"),
]);

assertIncludes(analyticsPage, "Runtime telemetry is unavailable.", "Analytics truthfulness");
assertIncludes(analyticsPage, "Runtime version not reported.", "Analytics truthfulness");
assertExcludes(analyticsPage, "v1.0", "Analytics truthfulness");
assertExcludes(analyticsPage, "Platform Port", "Analytics truthfulness");
assertExcludes(analyticsPage, "Data Residency", "Analytics truthfulness");
assertExcludes(analyticsPage, "activeInvites", "Analytics truthfulness");

assertIncludes(conversationSurface, "omnix-container-responsive", "Conversation responsive layout");
assertIncludes(conversationSurface, "omnix-conversation-workbench", "Conversation responsive layout");
assertIncludes(conversationSurface, "data-thread", "Conversation responsive layout");
assertIncludes(conversationSurface, "data-view", "Conversation responsive layout");
assertIncludes(globalsCss, ".omnix-conversation-workbench", "Conversation responsive CSS");
assertIncludes(globalsCss, '@container (min-width: 48rem)', "Conversation responsive CSS");
assertIncludes(globalsCss, 'data-thread="open"', "Conversation responsive CSS");
assertIncludes(conversationSurface, "applyChannelRealtimeChange", "Conversation realtime reconciliation");
assertIncludes(conversationSurface, "}, applyChannelRealtimeChange)", "Conversation realtime callback");
assertIncludes(conversationSurface, "channelStateRevisionRef", "Conversation realtime snapshot freshness");
assertIncludes(conversationSurface, "isCurrentWorkspaceChannelChange(payload, activeWorkspaceId, workspaceRef.current)", "Conversation realtime workspace isolation");
assertIncludes(conversationSurface, "isCurrentWorkspaceChannelLoad({", "Conversation realtime snapshot freshness");
assertIncludes(conversationSurface, "void loadChannelsRef.current?.()", "Conversation stale snapshot recovery");
assertIncludes(conversationSender, "onChannelMessageCreated(created)", "Conversation sender summary projection");
assertExcludes(conversationSender, "loadChannels", "Conversation sender channel reload");
assertIncludes(conversationUtils, "reconcileWorkspaceChannelChange", "Conversation realtime helper");
assertIncludes(conversationUtils, "mergeWorkspaceChannelMessage", "Conversation message summary helper");
assertIncludes(conversationUtils, "isCurrentWorkspaceChannelChange", "Conversation realtime workspace helper");
assertIncludes(conversationUtils, "isCurrentWorkspaceChannelLoad", "Conversation realtime snapshot helper");
assertIncludes(conversationUtils, "splitMessagePage", "Conversation message pagination helper");
assertIncludes(conversationUtils, "incrementThreadReplyCount", "Conversation thread reply reconciliation");
assertIncludes(conversationSurface, "loadOlderMessages", "Conversation history continuation");
assertIncludes(conversationSurface, "loadNewerThreadReplies", "Thread reply continuation");
assertIncludes(conversationSurface, "limit=${MESSAGE_PAGE_SIZE + 1}&offset=${offset}", "Conversation pagination probe");
assertIncludes(conversationSurface, "applyThreadReplyCount(incoming)", "Conversation realtime page preservation");
assertIncludes(conversationSurface, "setThreadMessages((current) => mergeMessage(current, incoming))", "Conversation realtime page preservation");
assertIncludes(conversationSender, "onThreadReplyCreated(created)", "Thread reply preserves paged history");
assertExcludes(conversationSender, "loadMessages", "Thread reply preserves paged history");

for (const [source, label] of [
  [ambientParticles, "Ambient particles"],
  [pageTransition, "Page transition"],
  [workspaceSelector, "Workspace selector"],
  [workspaceTreeNode, "Workspace tree"],
  [sidebarModals, "Sidebar modals"],
  [inviteNotifications, "Invite notifications"],
]) {
  assertExcludes(source, "framer-motion", `${label} global shell dependency`);
}
assertIncludes(ambientParticles, "omnix-shell-particle", "Ambient particles CSS motion");
assertIncludes(appShell, 'const showDashboardAmbient = pathname === "/dashboard"', "Ambient route isolation");
assertIncludes(appShell, "omnix-dashboard-ambient", "Ambient route isolation");
assertIncludes(appShell, "{showDashboardAmbient ? (", "Ambient route isolation");
assertIncludes(globalsCss, ".omnix-app-bg.omnix-dashboard-ambient::before", "Ambient route isolation");
assertIncludes(pageTransition, "omnix-shell-page-enter", "Page transition CSS motion");
assertIncludes(workspaceSelector, "omnix-shell-popover-enter", "Workspace selector CSS motion");
assertIncludes(workspaceTreeNode, "omnix-shell-list-enter", "Workspace tree CSS motion");
assertIncludes(sidebarModals, "omnix-shell-expand-enter", "Sidebar modal CSS motion");
assertIncludes(inviteNotifications, "omnix-shell-invite-enter", "Invite notification CSS motion");
for (const className of [
  ".omnix-shell-page-enter",
  ".omnix-shell-particle",
  ".omnix-shell-popover-enter",
  ".omnix-shell-list-enter",
  ".omnix-shell-expand-enter",
  ".omnix-shell-invite-enter",
]) {
  assertIncludes(globalsCss, className, "Global shell CSS motion");
}

assertExcludes(markdownRenderer, 'from "react-syntax-highlighter"', "Chat syntax highlighter eager import");
assertIncludes(markdownRenderer, 'import("react-syntax-highlighter/dist/esm/prism")', "Chat syntax highlighter deferred runtime");
assertIncludes(markdownRenderer, 'import("react-syntax-highlighter/dist/esm/styles/prism")', "Chat syntax highlighter deferred theme");
assertIncludes(markdownRenderer, "loadSyntaxHighlighter", "Chat syntax highlighter code-block boundary");
assertIncludes(markdownRenderer, "PlainCode", "Chat syntax highlighter fallback");

assertIncludes(commandPaletteModel, 'href: "/tasks?create=task"', "Task creation quick action");
assertIncludes(commandPaletteModel, 'href: "/decisions?create=decision"', "Decision creation quick action");
assertIncludes(commandPaletteModel, 'href: "/initiatives?create=initiative"', "Initiative creation quick action");
assertIncludes(workspaceTasksSurface, "[routeCreateTask, routeCreateTaskToken]", "Task creation replay token");
assertIncludes(workspaceDecisionsSurface, "routeCreateDecision", "Decision creation route");
assertIncludes(workspaceInitiativesSurface, "[routeCreateInitiative, routeCreateInitiativeToken]", "Initiative creation replay token");
assertIncludes(workspaceInitiativesSurface, ">Create Initiative</Button>", "Initiative creation CTA");

assertIncludes(modal, "useId", "Modal accessible naming");
assertIncludes(modal, "aria-labelledby={titleId}", "Modal accessible naming");
assertIncludes(modal, '<span id={titleId} className="sr-only">{title}</span>', "Modal accessible naming");
assertExcludes(modal, "aria-label={label}", "Modal accessible naming");
assertIncludes(modal, "isolateBackground: true", "Modal background isolation");
assertIncludes(focusTrap, "isolateBackground", "Focus trap background isolation");
assertIncludes(focusTrap, "aria-hidden", "Focus trap background isolation");
assertIncludes(focusTrap, ".inert = true", "Focus trap background isolation");
assertIncludes(commandPalette, "isolateBackground: true", "Command palette background isolation");

assertIncludes(messageBubble, "citationNoticeFor", "Citation validation notice");
assertIncludes(messageBubble, 'data-testid="citation-validation-notice"', "Citation validation notice");
assertIncludes(chatMessageUtils, "normalizeCitationValidation", "Citation validation payload parsing");
assertIncludes(chatStream, "citationValidation: citationValidation ?? message.citationValidation", "Citation validation stream reconciliation");
assertIncludes(chatStream, "content: typeof obj.content === \"string\" ? obj.content : message.content", "Citation validation stream reconciliation");

assertIncludes(conversationAiPanel, "source_offset=${sourceOffset}", "Conversation decision source windows");
assertIncludes(conversationAiPanel, "sourceCoverage={decisionCandidateCoverage}", "Conversation decision source coverage");
assertIncludes(filesPage, "source_offset=${sourceOffset}", "Document decision source windows");
assertIncludes(filesPage, "sourceCoverage={decisionCandidateCoverage}", "Document decision source coverage");
assertIncludes(decisionCandidatePanel, 'data-testid="decision-source-coverage"', "Decision source coverage disclosure");
assertIncludes(decisionCandidatePanel, "Scan Earlier Messages", "Conversation decision source continuation");
assertIncludes(decisionCandidatePanel, "Scan Next Document Section", "Document decision source continuation");

assertIncludes(filesModel, 'type SourceSection = "files" | "connectors"', "Sources tabs");
assertIncludes(filesPage, "activeSection", "Sources tabs");
assertIncludes(filesPage, "connectorSourceTypes", "Sources tabs");
assertIncludes(filesPage, 'activeSection === "files"', "Sources tabs");
assertIncludes(filesPage, 'activeSection === "connectors"', "Sources tabs");
assertIncludes(filesModel, "ocr_pages_processed", "OCR coverage disclosure");
assertIncludes(filesModel, "not processed because of the OCR limit", "OCR coverage disclosure");
assertIncludes(pageSkeleton, 'role="status"', "Page loading announcement");
assertIncludes(pageSkeleton, 'aria-live="polite"', "Page loading announcement");
assertIncludes(pageSkeleton, 'aria-atomic="true"', "Page loading announcement");
assertIncludes(pageSkeleton, "Loading page…", "Page loading announcement");
assertIncludes(pageSkeleton, 'aria-hidden="true"', "Page loading skeleton decoration");

for (const label of ["Core", "Execution", "Workspace", "System"]) {
  assertIncludes(sidebarNav, `label: "${label}"`, "Sidebar grouped navigation");
}
assertIncludes(sidebarNav, "navGroups", "Sidebar grouped navigation");

for (const href of ["/dashboard", "/chat", "/tasks", "/files", "/decisions", "/initiatives", "/settings"]) {
  assertIncludes(mobileDock, `href: "${href}"`, "Mobile navigation coverage");
}
assertIncludes(mobileDock, "grid-cols-7 gap-px", "Mobile navigation target width");
assertIncludes(mobileDock, "min-h-[48px]", "Mobile navigation target height");
assertIncludes(mobileDock, "safe-area-inset-bottom", "Mobile navigation safe area");
assertIncludes(mobileDock, "touch-manipulation", "Mobile navigation touch behavior");
assertIncludes(mobileDock, "focus-visible:ring-2", "Mobile navigation focus behavior");
assertIncludes(mobileDock, "max-w-full truncate", "Mobile navigation long labels");
assertExcludes(mobileDock, "MoreHorizontal", "Mobile navigation indirect domain access");
assertExcludes(mobileDock, "Open more navigation", "Mobile navigation indirect domain access");

const landingFiles = await readdir(join(root, "components/landing"));
assert.deepEqual(
  landingFiles.sort(),
  ["LandingAppScreenshots.tsx", "LandingExperience.tsx", "LandingHeroScene.tsx", "LandingPrimitives.tsx"],
  "Only the active landing experience files should remain",
);
assertIncludes(landingPage, 'import { LandingExperience } from "@/components/landing/LandingExperience"', "Landing route");

console.log("UI audit integration checks passed.");
