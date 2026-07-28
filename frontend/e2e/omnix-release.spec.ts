import { expect, test, type Page, type Route } from "@playwright/test";
import {
  isCurrentWorkspaceChannelChange,
  isCurrentWorkspaceChannelLoad,
  incrementThreadReplyCount,
  mergeMessagePage,
  mergeWorkspaceChannelMessage,
  reconcileWorkspaceChannelChange,
  splitMessagePage,
} from "../components/conversations/conversationUtils";
import type { WorkspaceChannel, WorkspaceChannelMessage } from "../lib/workspace-types";

const axePath = `${process.cwd()}/node_modules/axe-core/axe.min.js`;

type AxeViolation = {
  id: string;
  help: string;
  impact?: string | null;
};

type AxeResults = {
  violations: AxeViolation[];
};

type AxeWindow = Window & {
  axe: {
    run: (root: Document, options: unknown) => Promise<AxeResults>;
  };
};

const userId = "user-e2e";
const workspaceOne = {
  id: "workspace-1",
  user_id: userId,
  name: "Acme Operations",
  description: "Release readiness workspace",
  parent_workspace_id: null,
  workspace_type: "super_workspace",
  is_global: false,
  workspace_focus: "engineering",
  ai_specialization: "engineering",
  expertise_area: "Product operations",
  ai_instructions: "",
  intelligence_preferences: { memory_enabled: true },
  current_user_role: "founder",
  member_count: 2,
  is_shared: true,
  members_preview: [
    { user_id: userId, full_name: "Release Tester", email: "tester@example.com", role: "founder" },
    { user_id: "user-2", full_name: "Taylor Ops", email: "taylor@example.com", role: "member" },
  ],
  subspaces: [],
  created_at: "2026-06-20T00:00:00Z",
  updated_at: "2026-06-20T00:00:00Z",
};
const workspaceTwo = {
  ...workspaceOne,
  id: "workspace-2",
  name: "Platform Lab",
  current_user_role: "member",
  members_preview: [],
};
const workspaces = [workspaceOne, workspaceTwo];
const members = [
  { user_id: userId, full_name: "Release Tester", email: "tester@example.com", role: "founder" },
  { user_id: "user-2", full_name: "Taylor Ops", email: "taylor@example.com", role: "member" },
];

let tasks: Array<Record<string, unknown>>;
let files: Array<Record<string, unknown>>;
let conversations: Array<Record<string, unknown>>;
let messagesByConversation: Record<string, Array<Record<string, unknown>>>;
let chatStreamFixture: string | null;
let decisionCandidateOffsets: number[];
let workspaceChannels: WorkspaceChannel[];
let workspaceChannelMessages: WorkspaceChannelMessage[];
let workspaceMessagePageRequests: Array<{ threadRootId: string | null; offset: number; limit: number }>;

function workspaceChannel(overrides: Partial<WorkspaceChannel> = {}): WorkspaceChannel {
  return {
    id: "channel-general",
    workspace_id: "workspace-1",
    name: "General",
    slug: "general",
    purpose: "Coordinate work",
    channel_type: "operational",
    visibility: "workspace",
    posting_policy: "members",
    is_archived: false,
    message_count: 1,
    last_message_preview: "Earlier update",
    last_message_at: "2026-06-20T00:00:00.000Z",
    created_at: "2026-06-20T00:00:00.000Z",
    updated_at: "2026-06-20T00:00:00.000Z",
    ...overrides,
  };
}

function workspaceChannelMessage(
  index: number,
  overrides: Partial<WorkspaceChannelMessage> = {},
): WorkspaceChannelMessage {
  const createdAt = new Date(Date.UTC(2026, 5, 20, 0, 0, index)).toISOString();
  return {
    id: `channel-message-${index}`,
    workspace_id: "workspace-1",
    channel_id: "channel-general",
    author_user_id: "user-2",
    parent_message_id: null,
    content: `Operational update ${index}`,
    context_links: [],
    metadata: {},
    created_at: createdAt,
    updated_at: createdAt,
    author_name: "Taylor Ops",
    author_avatar_label: "T",
    thread_reply_count: 0,
    ...overrides,
  };
}

function resetMockState() {
  conversations = [];
  messagesByConversation = {};
  chatStreamFixture = null;
  decisionCandidateOffsets = [];
  workspaceChannels = [];
  workspaceChannelMessages = [];
  workspaceMessagePageRequests = [];
  tasks = [
    {
      id: "task-1",
      workspace_id: "workspace-1",
      title: "Reduce upload latency",
      description: "Move extraction to workers.",
      status: "active",
      owner_user_id: userId,
      owner_name: "Release Tester",
      created_by: userId,
      created_by_name: "Release Tester",
      due_date: null,
      blockers: [],
      linked_context: [],
      activity_metadata: { origin: "manual" },
      momentum_metadata: {},
      mentions: [],
      initiative_id: null,
      client_nonce: null,
      linked_decisions: [],
      created_at: "2026-06-20T00:00:00Z",
      updated_at: "2026-06-20T00:00:00Z",
      decisions: [],
    },
  ];
  files = [
    {
      id: "file-1",
      user_id: userId,
      workspace_id: "workspace-1",
      file_name: "release-plan.md",
      file_type: "text/markdown",
      size_bytes: 2048,
      processing_status: "embedded",
      extraction_status: "searchable",
      extracted_character_count: 420,
      metadata: { processing_status: "embedded" },
      created_at: "2026-06-20T00:00:00Z",
    },
  ];
}

async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(
    ({ session, activeWorkspaceId }) => {
      window.localStorage.setItem("omnix.supabase.auth", JSON.stringify(session));
      window.localStorage.setItem("omnix.activeWorkspaceId", activeWorkspaceId);
      window.localStorage.setItem(`omnix.activeWorkspaceId.${session.user.id}`, activeWorkspaceId);
      window.localStorage.setItem(`omnix.onboarding.completed.${session.user.id}`, "true");
    },
    {
      activeWorkspaceId: "workspace-1",
      session: {
        access_token: "e2e-token",
        refresh_token: "e2e-refresh",
        token_type: "bearer",
        expires_in: 60 * 60,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "tester@example.com",
          app_metadata: {},
          user_metadata: { full_name: "Release Tester" },
          created_at: "2026-06-20T00:00:00Z",
          last_sign_in_at: "2026-06-20T00:10:00Z",
        },
      },
    },
  );
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

function workspaceById(id: string) {
  return workspaces.find((workspace) => workspace.id === id) ?? workspaceOne;
}

function presenceSnapshot(workspaceId = "workspace-1") {
  return {
    workspace_id: workspaceId,
    active_count: 1,
    online_members: [],
    active_members: [],
    recently_active_members: [],
    typing_members: [],
    updated_at: "2026-06-20T00:00:00Z",
  };
}

async function mockApi(page: Page) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();

    if (path === "/profile") {
      return fulfillJson(route, {
        user_id: userId,
        email: "tester@example.com",
        display_name: "Release Tester",
        username: "release-tester",
        phone_number: "+15551234567",
      });
    }
    if (path === "/workspaces/hierarchy") return fulfillJson(route, workspaces);
    if (path === "/workspaces/status") {
      return fulfillJson(route, workspaces.map((workspace) => ({ workspace_id: workspace.id, status: "online" })));
    }
    const hierarchyMatch = path.match(/^\/workspaces\/([^/]+)\/hierarchy$/);
    if (hierarchyMatch) return fulfillJson(route, workspaceById(hierarchyMatch[1]));
    const subspaceMatch = path.match(/^\/workspaces\/([^/]+)\/subspaces$/);
    if (subspaceMatch) return fulfillJson(route, []);
    const intelligenceMatch = path.match(/^\/workspaces\/([^/]+)\/intelligence$/);
    if (intelligenceMatch) {
      return fulfillJson(route, {
        workspace_id: intelligenceMatch[1],
        workspace_name: workspaceById(intelligenceMatch[1]).name,
        workspace_type: "super_workspace",
        is_global: false,
        workspace_focus: "engineering",
        ai_specialization: "engineering",
        intelligence_preferences: { memory_enabled: true },
        source_count: files.length,
        conversation_count: 0,
        member_count: members.length,
        active_domains: [],
        connected_sources: [],
        recent_insights: [],
        retrieval_scope: "workspace",
        scope_workspace_ids: [intelligenceMatch[1]],
        context_summary: "E2E workspace context",
      });
    }
    const presenceMatch = path.match(/^\/workspaces\/([^/]+)\/presence(?:\/heartbeat)?$/);
    if (presenceMatch) return fulfillJson(route, presenceSnapshot(presenceMatch[1]));
    const activityMatch = path.match(/^\/workspaces\/([^/]+)\/activity$/);
    if (activityMatch) return fulfillJson(route, []);
    const membersMatch = path.match(/^\/workspaces\/([^/]+)\/members$/);
    if (membersMatch) return fulfillJson(route, members);
    const timelineMatch = path.match(/^\/workspaces\/([^/]+)\/timeline$/);
    if (timelineMatch) return fulfillJson(route, []);
    const continuityMatch = path.match(/^\/workspaces\/([^/]+)\/continuity\/unresolved$/);
    if (continuityMatch) return fulfillJson(route, []);
    const initiativesMatch = path.match(/^\/workspaces\/([^/]+)\/initiatives$/);
    if (initiativesMatch) return fulfillJson(route, []);
    const momentumMatch = path.match(/^\/workspaces\/([^/]+)\/tasks\/momentum$/);
    if (momentumMatch) {
      return fulfillJson(route, {
        flow_counts: { idea: 0, planned: 0, active: tasks.length, review: 0, complete: 0 },
        blocker_count: 0,
        due_soon_count: 0,
        completed_this_week: 0,
        recent_updates: [],
      });
    }
    const tasksMatch = path.match(/^\/workspaces\/([^/]+)\/tasks$/);
    if (tasksMatch && method === "GET") return fulfillJson(route, tasks);
    if (tasksMatch && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = {
        id: `task-${tasks.length + 1}`,
        workspace_id: tasksMatch[1],
        status: body.status || "idea",
        title: body.title,
        description: body.description || "",
        owner_user_id: body.owner_user_id || null,
        created_by: userId,
        created_by_name: "Release Tester",
        due_date: body.due_date || null,
        blockers: Array.isArray(body.blockers) ? body.blockers : [],
        linked_context: Array.isArray(body.linked_context) ? body.linked_context : [],
        activity_metadata: { origin: "manual" },
        momentum_metadata: {},
        mentions: [],
        initiative_id: body.initiative_id || null,
        client_nonce: body.client_nonce || null,
        linked_decisions: [],
        created_at: "2026-06-20T00:00:00Z",
        updated_at: "2026-06-20T00:00:00Z",
        decisions: [],
      };
      tasks = [created, ...tasks];
      return fulfillJson(route, created, 201);
    }
    const channelsMatch = path.match(/^\/workspaces\/([^/]+)\/channels$/);
    if (channelsMatch && method === "GET") {
      return fulfillJson(route, workspaceChannels.filter((channel) => channel.workspace_id === channelsMatch[1]));
    }
    const channelMessagesMatch = path.match(/^\/workspaces\/([^/]+)\/channels\/([^/]+)\/messages$/);
    if (channelMessagesMatch && method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "60");
      const offset = Number(url.searchParams.get("offset") ?? "0");
      const threadRootId = url.searchParams.get("thread_root_id");
      workspaceMessagePageRequests.push({ threadRootId, offset, limit });
      const channelMessages = workspaceChannelMessages.filter(
        (message) => message.workspace_id === channelMessagesMatch[1] && message.channel_id === channelMessagesMatch[2],
      );
      if (threadRootId) {
        const root = channelMessages.find((message) => message.id === threadRootId && !message.parent_message_id);
        const replies = channelMessages
          .filter((message) => message.parent_message_id === threadRootId)
          .sort((left, right) => Date.parse(left.created_at ?? "") - Date.parse(right.created_at ?? ""));
        return fulfillJson(route, root ? [root, ...replies.slice(offset, offset + limit)] : []);
      }
      const roots = channelMessages
        .filter((message) => !message.parent_message_id)
        .sort((left, right) => Date.parse(right.created_at ?? "") - Date.parse(left.created_at ?? ""))
        .slice(offset, offset + limit)
        .reverse();
      return fulfillJson(route, roots);
    }
    const documentCandidatesMatch = path.match(/^\/workspaces\/([^/]+)\/decisions\/candidates\/document\/([^/]+)$/);
    if (documentCandidatesMatch && method === "POST") {
      const sourceOffset = Number(url.searchParams.get("source_offset") ?? "0");
      decisionCandidateOffsets.push(sourceOffset);
      const isContinuation = sourceOffset === 40;
      return fulfillJson(route, {
        candidates: [
          {
            id: isContinuation ? "candidate-later" : "candidate-first",
            title: isContinuation ? "Later source decision" : "Initial source decision",
            reason: "The source window contains a reviewed decision.",
            confidence: "medium",
            source_type: "document",
            source_id: documentCandidatesMatch[2],
            supporting_evidence: [
              {
                kind: "document_chunk",
                channel_id: null,
                message_id: null,
                file_id: documentCandidatesMatch[2],
                chunk_id: isContinuation ? "chunk-41" : "chunk-1",
                chunk_index: isContinuation ? 40 : 0,
                page: 1,
                char_start: 0,
                char_end: 8,
                quote: "Decision",
                quote_sha256: "a".repeat(64),
                source_content_hash: "b".repeat(64),
                source_updated_at: "2026-06-20T00:00:00Z",
              },
            ],
          },
        ],
        candidate_count: 1,
        source_type: "document",
        source_id: documentCandidatesMatch[2],
        generated_at: "2026-06-20T00:00:00Z",
        source_coverage: isContinuation
          ? {
              source_offset: 40,
              loaded_record_count: 1,
              selected_record_count: 1,
              prompt_record_count: 1,
              context_limited: false,
              has_additional_records: false,
              next_source_offset: null,
            }
          : {
              source_offset: 0,
              loaded_record_count: 41,
              selected_record_count: 40,
              prompt_record_count: 37,
              context_limited: true,
              has_additional_records: true,
              next_source_offset: 40,
            },
      });
    }
    const decisionsMatch = path.match(/^\/workspaces\/([^/]+)\/decisions$/);
    if (decisionsMatch) return fulfillJson(route, []);
    const mentionsMatch = path.match(/^\/workspaces\/([^/]+)\/mentions(?:\/unread-count)?$/);
    if (mentionsMatch) {
      return path.endsWith("/unread-count") ? fulfillJson(route, { unread_count: 0 }) : fulfillJson(route, []);
    }
    const searchMatch = path.match(/^\/workspaces\/([^/]+)\/search$/);
    if (searchMatch) {
      const query = url.searchParams.get("q")?.toLowerCase() || "";
      const taskResults = query.includes("latency")
        ? [
            {
              id: "task-1",
              type: "task",
              title: "Reduce upload latency",
              preview: "Move extraction to background workers.",
              url: "/tasks?id=task-1",
            },
          ]
        : [];
      return fulfillJson(route, {
        conversations: [],
        tasks: taskResults,
        initiatives: [],
        decisions: [],
        files: [],
        documents: [],
        sources: [],
        members: [],
        mentions: [],
        workspaces: [],
        automations: [],
        activity: [],
        jobs: [],
        items: taskResults,
      });
    }
    if (path === "/files" && method === "GET") return fulfillJson(route, files);
    if (path === "/connectors" && method === "GET") return fulfillJson(route, []);
    if (path === "/upload" && method === "POST") {
      const uploaded = {
        id: `file-${files.length + 1}`,
        user_id: userId,
        workspace_id: "workspace-1",
        file_name: "e2e-upload.md",
        file_type: "text/markdown",
        size_bytes: 128,
        processing_status: "queued",
        extraction_status: "processing",
        metadata: { processing_status: "queued" },
        created_at: "2026-06-20T00:00:00Z",
      };
      files = [uploaded, ...files];
      return fulfillJson(route, uploaded, 201);
    }
    const conversationMessagesMatch = path.match(/^\/conversations\/([^/]+)\/messages$/);
    if (conversationMessagesMatch && method === "GET") {
      return fulfillJson(route, messagesByConversation[conversationMessagesMatch[1]] ?? []);
    }
    if (path === "/chat/stream" && method === "POST" && chatStreamFixture) {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: chatStreamFixture });
    }
    if (path === "/conversations") return fulfillJson(route, conversations);

    return fulfillJson(route, method === "GET" ? [] : {});
  });
}

async function runAxe(page: Page) {
  await page.addScriptTag({ path: axePath });
  const results = await page.evaluate(async () => {
    return await (window as unknown as AxeWindow).axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
    });
  });
  const severe = results.violations.filter((violation: AxeViolation) => ["critical", "serious"].includes(violation.impact || ""));
  expect(severe, severe.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
}

test("reconciles realtime channel rows without a reload", () => {
  const general = workspaceChannel();
  const announcements = workspaceChannel({
    id: "channel-announcements",
    name: "Announcements",
    slug: "announcements",
    channel_type: "announcement",
  });
  const planning = workspaceChannel({
    id: "channel-planning",
    name: "alpha planning",
    slug: "alpha-planning",
  });

  const inserted = reconcileWorkspaceChannelChange([general, announcements], {
    eventType: "INSERT",
    new: planning,
  });
  expect(inserted.map((channel) => channel.id)).toEqual([
    "channel-announcements",
    "channel-planning",
    "channel-general",
  ]);

  const updated = reconcileWorkspaceChannelChange(inserted, {
    eventType: "UPDATE",
    new: {
      ...general,
      message_count: 4,
      last_message_preview: "Authoritative update",
      last_message_at: "2026-06-20T00:01:00.000Z",
    },
  });
  expect(updated.find((channel) => channel.id === general.id)).toMatchObject({
    message_count: 4,
    last_message_preview: "Authoritative update",
    last_message_at: "2026-06-20T00:01:00.000Z",
  });

  expect(isCurrentWorkspaceChannelChange(
    { eventType: "UPDATE", new: general },
    "workspace-1",
    "workspace-1",
  )).toBe(true);
  expect(isCurrentWorkspaceChannelChange(
    { eventType: "UPDATE", new: general },
    "workspace-1",
    "workspace-2",
  )).toBe(false);
  expect(isCurrentWorkspaceChannelChange(
    { eventType: "UPDATE", new: { ...general, workspace_id: "workspace-2" } },
    "workspace-1",
    "workspace-1",
  )).toBe(false);
  expect(isCurrentWorkspaceChannelChange(
    { eventType: "DELETE", old: { id: general.id } },
    "workspace-1",
    "workspace-1",
  )).toBe(true);
  expect(isCurrentWorkspaceChannelChange(
    { eventType: "DELETE", old: { id: general.id, workspace_id: "workspace-2" } },
    "workspace-1",
    "workspace-1",
  )).toBe(false);

  const loadState = {
    requestId: 3,
    latestRequestId: 3,
    requestWorkspaceId: "workspace-1",
    activeWorkspaceId: "workspace-1",
    stateRevision: 8,
    currentStateRevision: 8,
  };
  expect(isCurrentWorkspaceChannelLoad(loadState)).toBe(true);
  expect(isCurrentWorkspaceChannelLoad({ ...loadState, currentStateRevision: 9 })).toBe(false);
  expect(isCurrentWorkspaceChannelLoad({ ...loadState, activeWorkspaceId: "workspace-2" })).toBe(false);

  const createdMessage = {
    id: "message-1",
    workspace_id: "workspace-1",
    channel_id: general.id,
    author_user_id: userId,
    parent_message_id: null,
    content: "A local message\nwith concise context",
    context_links: [],
    metadata: {},
    created_at: "2026-06-20T00:02:00.000Z",
    updated_at: "2026-06-20T00:02:00.000Z",
    author_avatar_label: "R",
    thread_reply_count: 0,
  } satisfies WorkspaceChannelMessage;
  const projected = mergeWorkspaceChannelMessage(updated, createdMessage);
  expect(projected.find((channel) => channel.id === general.id)).toMatchObject({
    message_count: 4,
    last_message_preview: "A local message with concise context",
    last_message_at: "2026-06-20T00:02:00.000Z",
  });
  expect(mergeWorkspaceChannelMessage(projected, createdMessage)).toEqual(projected);
  expect(mergeWorkspaceChannelMessage(projected, {
    ...createdMessage,
    id: "message-older",
    content: "An older local message",
    created_at: "2026-06-20T00:01:30.000Z",
    updated_at: "2026-06-20T00:01:30.000Z",
  })).toEqual(projected);

  expect(
    reconcileWorkspaceChannelChange(updated, { eventType: "DELETE", old: { id: planning.id } }),
  ).not.toContainEqual(expect.objectContaining({ id: planning.id }));
  expect(
    reconcileWorkspaceChannelChange(updated, { eventType: "UPDATE", new: { ...general, is_archived: true } }),
  ).not.toContainEqual(expect.objectContaining({ id: general.id }));
});

test("merges message pages while excluding each pagination probe", () => {
  const root = workspaceChannelMessage(0, { id: "root" });
  const mainPage = splitMessagePage([root, workspaceChannelMessage(1), workspaceChannelMessage(2)], 2, "start");
  expect(mainPage).toMatchObject({
    hasMore: true,
    records: [expect.objectContaining({ id: "channel-message-1" }), expect.objectContaining({ id: "channel-message-2" })],
  });

  const replyPage = splitMessagePage([workspaceChannelMessage(3), workspaceChannelMessage(4), workspaceChannelMessage(5)], 2, "end");
  expect(replyPage).toMatchObject({
    hasMore: true,
    records: [expect.objectContaining({ id: "channel-message-3" }), expect.objectContaining({ id: "channel-message-4" })],
  });

  const merged = mergeMessagePage(mainPage.records, [workspaceChannelMessage(1, { content: "Hydrated update" })]);
  expect(merged).toHaveLength(2);
  expect(merged.find((message) => message.id === "channel-message-1")).toMatchObject({ content: "Hydrated update" });

  const counted = incrementThreadReplyCount(
    [root],
    workspaceChannelMessage(6, { parent_message_id: "root" }),
  );
  expect(counted).toMatchObject([{ id: "root", thread_reply_count: 1 }]);
});

test.describe("public auth pages", () => {
  test("render login and register pages", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  });
});

test.describe("authenticated Omnix shell", () => {
  test.beforeEach(async ({ page }) => {
    resetMockState();
    await seedAuthenticatedSession(page);
    await mockApi(page);
  });

  test("loads the dashboard shell with mocked auth", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText("Acme Operations").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Open command palette" }).first()).toBeVisible();
  });

  test("keeps shell motion CSS-only and honors reduced motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");

    const pageTransition = page.locator(".omnix-shell-page-enter");
    const particles = page.locator(".omnix-shell-particle");
    await expect(pageTransition).toHaveCSS("animation-name", "none");
    await expect(particles).toHaveCount(30);
    await expect(particles.first()).toHaveCSS("animation-name", "none");

    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await expect(page.locator(".omnix-shell-popover-enter")).toHaveCSS("animation-name", "none");
  });

  test("runs ambient shell effects only on the dashboard", async ({ page }) => {
    const appShell = page.locator(".omnix-app-bg.omnix-auth-shell");
    const gridAnimationName = () => appShell.evaluate((element) => getComputedStyle(element, "::before").animationName);

    await page.goto("/dashboard");
    await expect(appShell).toHaveClass(/omnix-dashboard-ambient/);
    await expect(page.locator(".omnix-ambient-layer")).toHaveCount(1);
    await expect(page.locator(".omnix-shell-particle")).toHaveCount(30);
    await expect.poll(gridAnimationName).toBe("omnix-grid-drift");

    await page.goto("/chat");
    await expect(appShell).not.toHaveClass(/omnix-dashboard-ambient/);
    await expect(page.locator(".omnix-ambient-layer")).toHaveCount(0);
    await expect(page.locator(".omnix-shell-particle")).toHaveCount(0);
    await expect.poll(gridAnimationName).toBe("none");
  });

  test("opens command palette, searches, and activates a result", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    const search = page.getByRole("textbox", { name: "Search Omnix commands and workspace results" });
    await expect(search).toBeVisible();
    await search.fill("latency");
    await expect(page.getByRole("button", { name: /Reduce upload latency/ })).toBeVisible();
    await search.focus();
    await expect(search).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tasks\?id=task-1/);
  });

  test("command palette supports keyboard navigation and focus return", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop hardware keyboard flow only");
    await page.goto("/dashboard");
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await trigger.focus();
    await page.keyboard.press("Control+K");

    const dialog = page.getByRole("dialog", { name: "Omnix command palette" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search Omnix commands and workspace results" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Control+K");
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Search Omnix commands and workspace results" })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("button", { name: /^Create Decision\./ })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(dialog.getByRole("button", { name: /^Create Task\./ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tasks\?create=task&palette=/);
  });

  test("keyboard shortcuts modal restores focus on close", async ({ page }) => {
    async function mainContentHasIsolatedAncestor() {
      return page.locator("#main-content").evaluate((mainContent) => {
        for (let ancestor = mainContent.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor.getAttribute("aria-hidden") === "true" && ancestor.inert) {
            return true;
          }
        }
        return false;
      });
    }

    await page.goto("/dashboard");
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await trigger.focus();
    await page.keyboard.type("?");

    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();
    await expect.poll(mainContentHasIsolatedAncestor).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(mainContentHasIsolatedAncestor).toBe(false);
  });

  test("announces command palette no-result state", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    const search = page.getByRole("textbox", { name: "Search Omnix commands and workspace results" });
    await search.fill("unmatched-release-query");
    await expect(page.getByText("No command or workspace match.")).toBeVisible();
    await expect(page.locator("#omnix-command-palette-status")).toContainText("No command or workspace results");
  });

  test("switches workspace from the sidebar", async ({ page, isMobile }) => {
    await page.goto("/dashboard");
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();
    await expect(page.getByText("Platform Lab").first()).toBeVisible();
    await expect(await page.evaluate(() => window.localStorage.getItem("omnix.activeWorkspaceId.user-e2e"))).toBe("workspace-2");
  });

  test("creates a task record", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByText("Reduce upload latency")).toBeVisible();
    await page.getByRole("button", { name: "Record Task" }).click();
    const titleInput = page.getByPlaceholder("Operational next step");
    await expect(titleInput).toBeVisible();
    await titleInput.fill("Verify release checklist");
    await page.getByRole("button", { name: "Create record" }).click();
    await expect(page.locator("#main-content").getByText("Verify release checklist").first()).toBeVisible();
  });

  test("keeps initiative creation explicit and replays palette create requests", async ({ page }) => {
    async function selectCreateAction(label: "Create Task" | "Create Decision" | "Create Initiative") {
      await page.getByRole("button", { name: "Open command palette" }).first().click();
      await page.getByRole("button", { name: new RegExp(`^${label}\\.`) }).click();
    }

    await page.goto("/initiatives");
    const initiativeTitle = page.getByPlaceholder("Investor demo");
    const directInitiativeCreate = page.getByRole("button", { name: "Create Initiative" }).first();
    await expect(directInitiativeCreate).toBeVisible();
    await directInitiativeCreate.click();
    await expect(initiativeTitle).toBeVisible();

    await page.goto("/dashboard");
    await selectCreateAction("Create Task");
    await expect(page).toHaveURL(/\/tasks\?create=task&palette=/);
    const taskTitle = page.getByPlaceholder("Operational next step");
    await expect(taskTitle).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(taskTitle).toBeHidden();

    await selectCreateAction("Create Task");
    await expect(taskTitle).toBeVisible();

    await page.goto("/dashboard");
    await selectCreateAction("Create Decision");
    await expect(page).toHaveURL(/\/decisions\?create=decision&palette=/);
    await expect(page.getByRole("dialog", { name: "Record New Decision" })).toBeVisible();

    await page.goto("/dashboard");
    await selectCreateAction("Create Initiative");
    await expect(page).toHaveURL(/\/initiatives\?create=initiative&palette=/);
    await expect(initiativeTitle).toBeVisible();
    await page.getByRole("button", { name: "Create Initiative" }).first().click();
    await expect(initiativeTitle).toBeHidden();

    await selectCreateAction("Create Initiative");
    await expect(initiativeTitle).toBeVisible();
  });

  test("shows file upload shell and queued upload state", async ({ page }) => {
    await page.goto("/files");
    await expect(page.getByText("Workspace files")).toBeVisible();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "e2e-upload.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# E2E upload\n\nQueued processing."),
    });
    await expect(page.getByText("Queued").first()).toBeVisible();
  });

  test("discloses bounded OCR coverage for searchable files", async ({ page }) => {
    files = [
      {
        id: "file-ocr-bounded",
        user_id: userId,
        workspace_id: "workspace-1",
        file_name: "scanned-contract.pdf",
        file_type: "application/pdf",
        size_bytes: 2048,
        processing_status: "searchable",
        extraction_status: "searchable",
        metadata: {
          processing_status: "searchable",
          ocr_used: true,
          ocr_character_count: 1234,
          page_count: 30,
          ocr_pages_processed: 25,
          ocr_pages_omitted: 5,
          ocr_coverage_complete: false,
        },
        created_at: "2026-06-20T00:00:00Z",
      },
      ...files,
    ];

    await page.goto("/files");

    await expect(
      page.getByText(
        "OCR indexed the first 25 of 30 pages and extracted 1,234 characters. 5 pages were not processed because of the OCR limit.",
        { exact: true },
      ),
    ).toBeVisible();
  });

  test("discloses decision source coverage and scans a document continuation", async ({ page }) => {
    await page.goto("/files");
    await page.getByRole("button", { name: "Decisions" }).first().click();

    const coverage = page.getByTestId("decision-source-coverage");
    await expect(coverage).toContainText("Reviewed 40 document chunks in this scan.");
    await expect(coverage).toContainText("37 of those document chunks fit the analysis context.");
    await page.getByRole("button", { name: "Scan Next Document Section" }).click();

    await expect(coverage).toContainText("Reviewed 1 document chunk in this scan.");
    expect(decisionCandidateOffsets).toEqual([0, 40]);
  });

  test("paginates channel history and thread replies without hiding messages", async ({ page, isMobile }) => {
    const rootMessages = Array.from({ length: 161 }, (_, index) => workspaceChannelMessage(index, {
      id: `root-message-${index}`,
      content: `Root update ${index}`,
      thread_reply_count: index === 160 ? 161 : 0,
    }));
    const threadReplies = Array.from({ length: 161 }, (_, index) => workspaceChannelMessage(index + 161, {
      id: `thread-reply-${index}`,
      parent_message_id: "root-message-160",
      content: `Thread reply ${index}`,
      thread_reply_count: 0,
    }));
    workspaceChannels = [workspaceChannel({ message_count: rootMessages.length })];
    workspaceChannelMessages = [...rootMessages, ...threadReplies];

    await page.goto("/conversations");
    if (isMobile) await page.getByRole("button", { name: /^General\b/ }).click();

    await expect(page.getByText("Root update 81", { exact: true })).toBeVisible();
    await expect(page.getByText("Root update 80", { exact: true })).toHaveCount(0);
    const olderMessages = page.getByRole("button", { name: "Load Earlier Messages" });
    await expect(olderMessages).toBeVisible();
    await olderMessages.click();
    await expect(page.getByText("Root update 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Root update 0", { exact: true })).toHaveCount(0);
    await olderMessages.click();
    await expect(page.getByText("Root update 0", { exact: true })).toBeVisible();
    await expect(olderMessages).toHaveCount(0);

    await page.getByRole("button", { name: "161 thread replies" }).click();
    await expect(page.getByText("Thread reply 0", { exact: true })).toBeVisible();
    await expect(page.getByText("Thread reply 80", { exact: true })).toHaveCount(0);
    const newerReplies = page.getByRole("button", { name: "Load Newer Replies" });
    await expect(newerReplies).toBeVisible();
    await newerReplies.click();
    await expect(page.getByText("Thread reply 80", { exact: true })).toBeVisible();
    await expect(page.getByText("Thread reply 160", { exact: true })).toHaveCount(0);
    await newerReplies.click();
    await expect(page.getByText("Thread reply 160", { exact: true })).toBeVisible();
    await expect(newerReplies).toHaveCount(0);

    expect(workspaceMessagePageRequests).toEqual(expect.arrayContaining([
      { threadRootId: null, offset: 0, limit: 81 },
      { threadRootId: null, offset: 80, limit: 81 },
      { threadRootId: null, offset: 160, limit: 81 },
      { threadRootId: "root-message-160", offset: 0, limit: 81 },
      { threadRootId: "root-message-160", offset: 80, limit: 81 },
      { threadRootId: "root-message-160", offset: 160, limit: 81 },
    ]));
  });

  test("mobile conversation threads replace messages and return to the channel", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    const root = workspaceChannelMessage(0, {
      id: "mobile-thread-root",
      content: "Mobile root update",
      thread_reply_count: 1,
    });
    workspaceChannels = [workspaceChannel({ message_count: 2 })];
    workspaceChannelMessages = [
      root,
      workspaceChannelMessage(1, {
        id: "mobile-thread-reply",
        parent_message_id: root.id,
        content: "Mobile follow-through",
      }),
    ];

    for (const width of [375, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/conversations");
      await page.getByRole("button", { name: /^General\b/ }).click();

      const workbench = page.locator(".omnix-conversation-workbench");
      const messagesPane = page.locator(".omnix-conversation-messages");
      const threadPane = page.locator(".omnix-conversation-thread");
      await expect(messagesPane).toBeVisible();
      await expect(threadPane).toBeHidden();

      await messagesPane.getByRole("button", { name: "1 thread replies" }).click();
      await expect(workbench).toHaveAttribute("data-thread", "open");
      await expect(messagesPane).toBeHidden();
      await expect(threadPane).toBeVisible();
      await expect(threadPane.getByText("Mobile follow-through", { exact: true })).toBeVisible();

      await threadPane.getByRole("button", { name: "Close thread" }).click();
      await expect(workbench).toHaveAttribute("data-thread", "closed");
      await expect(threadPane).toBeHidden();
      await expect(messagesPane).toBeVisible();
      await expect(messagesPane.getByText("Mobile root update", { exact: true })).toBeVisible();
    }
  });

  test("loads syntax highlighting only for fenced chat code blocks", async ({ page }) => {
    conversations = [
      {
        id: "code-sample",
        workspace_id: "workspace-1",
        title: "Code sample",
        preview: "A fenced TypeScript example",
        latest_message_role: "assistant",
        latest_message_at: "2026-06-20T00:00:00Z",
      },
    ];
    messagesByConversation = {
      "code-sample": [
        {
          id: "message-code-sample",
          conversation_id: "code-sample",
          role: "assistant",
          content: ["```ts", 'const greeting = "hello";', "```"].join("\n"),
          status: "completed",
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
    };

    await page.goto("/chat?conversation=code-sample");

    const codeBlock = page.getByTestId("chat-code-block");
    await expect(codeBlock).toContainText('const greeting = "hello";');
    await expect(codeBlock.getByRole("button", { name: "Copy code" })).toBeVisible();
  });

  test("replaces streamed text with the validated citation result", async ({ page }) => {
    conversations = [
      {
        id: "citation-stream",
        workspace_id: "workspace-1",
        title: "Citation validation",
        preview: "Validate generated references",
        latest_message_role: "assistant",
        latest_message_at: "2026-06-20T00:00:00Z",
      },
    ];
    messagesByConversation = { "citation-stream": [] };
    chatStreamFixture = [
      {
        type: "init",
        conversation_id: "citation-stream",
        user_message_id: "user-citation-stream",
        assistant_message_id: "assistant-citation-stream",
        sources: [],
      },
      {
        type: "sources",
        sources: [{ label: "S1", type: "retrieval", title: "Release plan", excerpt: "Release is ready." }],
        retrieval: { outcome: "sources_found", source_count: 1 },
      },
      { type: "token", text: "Release is ready [S1] and [S99]." },
      {
        type: "done",
        conversation_id: "citation-stream",
        content: "Release is ready [S1] and.",
        citations: ["S1"],
        citation_validation: {
          status: "incomplete",
          source_count: 1,
          cited_source_count: 1,
          invalid_citation_count: 1,
        },
      },
    ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

    await page.goto("/chat?conversation=citation-stream");
    const input = page.getByPlaceholder("Type a message or '/' for commands...");
    await input.fill("Is the release ready?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("Release is ready [S1] and.")).toBeVisible();
    await expect(page.getByTestId("citation-validation-notice")).toContainText("Citation coverage is incomplete");
    await expect(page.getByText("[S99]", { exact: false })).toHaveCount(0);
  });

  test("mobile file upload surface queues a selected file", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/files");
    await expect(page.getByText("Workspace files")).toBeVisible();
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles({
      name: "mobile-upload.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Mobile upload\n\nQueued from a touch viewport."),
    });
    await expect(page.getByText("Queued").first()).toBeVisible();
  });

  test("mobile navigation exposes core domains directly at phone and tablet widths", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");

    const directRoutes = [
      ["Decisions", "/decisions"],
      ["Initiatives", "/initiatives"],
      ["Settings", "/settings"],
    ] as const;

    for (const width of [375, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/dashboard");
      const dock = page.getByRole("navigation", { name: "Primary mobile navigation" });
      await expect(dock).toBeVisible();

      for (const [label, route] of directRoutes) {
        const link = dock.getByRole("link", { name: label });
        await expect(link).toBeVisible();
        await expect(link).toHaveCSS("min-height", "48px");
        await link.click();
        await expect(page).toHaveURL(new RegExp(`${route}$`));
      }

      await page.goto("/dashboard");
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("link", { name: "Team" }).click();
      await expect(page).toHaveURL(/\/team$/);
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("link", { name: "Analytics" }).click();
      await expect(page).toHaveURL(/\/analytics$/);
    }
  });

  test("mobile shell lets dense task forms scroll", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.setViewportSize({ width: 390, height: 520 });
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Record Task" }).click();

    await expect(page.locator("#main-content")).toBeVisible();

    const metrics = await page.evaluate(() => {
      const shell = document.querySelector(".omnix-auth-shell") as HTMLElement | null;
      const main = document.querySelector("#main-content") as HTMLElement | null;
      return {
        documentScrollHeight: document.scrollingElement?.scrollHeight ?? 0,
        mainOverflowY: main ? window.getComputedStyle(main).overflowY : "",
        shellOverflowY: shell ? window.getComputedStyle(shell).overflowY : "",
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.shellOverflowY).not.toBe("hidden");
    expect(metrics.mainOverflowY).not.toBe("hidden");
    expect(metrics.documentScrollHeight).toBeGreaterThan(metrics.viewportHeight);

    await page.evaluate(() => window.scrollTo(0, 320));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("mobile task creation does not autofocus the title field", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/tasks");
    await page.getByRole("button", { name: "Record Task" }).click();
    const titleInput = page.getByPlaceholder("Operational next step");

    await expect(titleInput).toBeVisible();
    await expect(titleInput).not.toBeFocused();
  });

  test("touch tablet task cards keep hover-revealed controls visible", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto("/tasks");

    const secondaryControls = page.getByTestId("task-card-secondary-controls").first();
    const blockerControls = page.getByTestId("task-card-blocker-controls").first();

    await expect(secondaryControls).toBeVisible();
    await expect(blockerControls).toBeVisible();
    await expect(secondaryControls).toHaveCSS("opacity", "1");
    await expect(blockerControls).toHaveCSS("opacity", "1");
  });

  for (const route of ["/dashboard", "/files", "/tasks", "/decisions", "/notifications"]) {
    test(`has no critical or serious axe violations on ${route}`, async ({ page }) => {
      await page.goto(route);
      await runAxe(page);
    });
  }

  test("command palette has no critical or serious axe violations", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    await expect(page.getByRole("dialog", { name: "Omnix command palette" })).toBeVisible();
    await runAxe(page);
  });
});
