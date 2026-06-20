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
  filesPage,
  sidebarNav,
  globalsCss,
  landingPage,
] = await Promise.all([
  read("app/(dashboard)/analytics/page.tsx"),
  read("components/conversations/WorkspaceConversationSurface.tsx"),
  read("app/(dashboard)/files/page.tsx"),
  read("components/layout/sidebar/SidebarNav.tsx"),
  read("styles/globals.css"),
  read("app/page.tsx"),
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

assertIncludes(filesPage, 'type SourceSection = "files" | "connectors"', "Sources tabs");
assertIncludes(filesPage, "activeSection", "Sources tabs");
assertIncludes(filesPage, "connectorSourceTypes", "Sources tabs");
assertIncludes(filesPage, 'activeSection === "files"', "Sources tabs");
assertIncludes(filesPage, 'activeSection === "connectors"', "Sources tabs");

for (const label of ["Core", "Execution", "Workspace", "System"]) {
  assertIncludes(sidebarNav, `label: "${label}"`, "Sidebar grouped navigation");
}
assertIncludes(sidebarNav, "navGroups", "Sidebar grouped navigation");

const landingFiles = await readdir(join(root, "components/landing"));
assert.deepEqual(landingFiles.sort(), ["LandingExperience.tsx", "LandingHeroScene.tsx"], "Only the active landing experience files should remain");
assertIncludes(landingPage, 'import { LandingExperience } from "@/components/landing/LandingExperience"', "Landing route");

console.log("UI audit integration checks passed.");
