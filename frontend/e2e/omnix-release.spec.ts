import { expect, test, type Page, type Route } from "@playwright/test";
import {
  isCurrentWorkspaceChannelChange,
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
const focusedSearchFile = {
  id: "file-archive-1",
  user_id: userId,
  workspace_id: "workspace-1",
  file_name: "archived-rollout-brief.md",
  file_type: "text/markdown",
  size_bytes: 4096,
  processing_status: "searchable",
  extraction_status: "searchable",
  metadata: { processing_status: "searchable" },
  created_at: "2026-05-01T00:00:00Z",
};
const focusedSearchConnector = {
  id: "connector-archive-1",
  workspace_id: "workspace-1",
  user_id: userId,
  connector_type: "knowledge_link",
  display_name: "Archived roadmap source",
  status: "connected",
  config: { url: "https://example.com/roadmap" },
  created_at: "2026-05-01T00:00:00Z",
  updated_at: "2026-05-02T00:00:00Z",
};

let tasks: Array<Record<string, unknown>>;
let files: Array<Record<string, unknown>>;
let conversations: Array<Record<string, unknown>>;
let messagesByConversation: Record<string, Array<Record<string, unknown>>>;
let chatStreamFixture: string | null;
let mentionFixtures: Array<Record<string, unknown>>;
let mentionUnreadCount: number;
let workspaceActivity: Array<Record<string, unknown>>;
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

function workspaceInitiative(
  id: string,
  title: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    activity_metadata: {},
    created_at: "2026-06-20T00:00:00Z",
    id,
    initiative_context: null,
    linked_channels: [],
    linked_decisions: [],
    linked_resources: [],
    linked_tasks: [],
    momentum: {
      blocked_task_count: 0,
      channel_count: 0,
      complete_task_count: 0,
      discussion_message_count: 0,
      due_soon_count: 0,
      health: "quiet",
      last_movement_at: null,
      open_task_count: 0,
      overdue_count: 0,
      summary: "No active operational movement detected.",
      task_count: 0,
    },
    owner_user_id: null,
    status: "active",
    target_date: null,
    title,
    updated_at: "2026-06-20T00:00:00Z",
    workspace_id: "workspace-1",
    ...overrides,
  };
}

function resetMockState() {
  conversations = [];
  messagesByConversation = {};
  chatStreamFixture = null;
  mentionFixtures = [];
  mentionUnreadCount = 0;
  workspaceActivity = [];
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
    if (activityMatch) return fulfillJson(route, workspaceActivity);
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
    if (channelMessagesMatch && method === "POST") {
      const body = request.postDataJSON() as Record<string, unknown>;
      const created = workspaceChannelMessage(
        workspaceChannelMessages.length + 1,
        {
          id: `channel-message-${workspaceChannelMessages.length + 1}`,
          workspace_id: channelMessagesMatch[1],
          channel_id: channelMessagesMatch[2],
          author_user_id: userId,
          parent_message_id:
            typeof body.parent_message_id === "string"
              ? body.parent_message_id
              : null,
          content: String(body.content ?? ""),
          client_nonce:
            typeof body.client_nonce === "string"
              ? body.client_nonce
              : null,
          author_name: "Release Tester",
          author_avatar_label: "R",
        },
      );
      workspaceChannelMessages = [...workspaceChannelMessages, created];
      return fulfillJson(route, created, 201);
    }
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
      return path.endsWith("/unread-count")
        ? fulfillJson(route, { unread_count: mentionUnreadCount })
        : fulfillJson(route, mentionFixtures);
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
      const fileResults = query.includes("archived rollout")
        ? [
            {
              id: focusedSearchFile.id,
              workspace_id: "workspace-1",
              type: "file",
              title: "Archived rollout brief",
              preview: focusedSearchFile.file_name,
              url: `/files?id=${focusedSearchFile.id}`,
            },
          ]
        : [];
      const sourceResults = query.includes("archived roadmap")
        ? [
            {
              id: focusedSearchConnector.id,
              workspace_id: "workspace-1",
              type: "source",
              title: focusedSearchConnector.display_name,
              preview: "Knowledge link",
              url: `/sources?source=${focusedSearchConnector.id}`,
            },
          ]
        : [];
      return fulfillJson(route, {
        conversations: [],
        tasks: taskResults,
        initiatives: [],
        decisions: [],
        files: fileResults,
        documents: [],
        sources: sourceResults,
        members: [],
        mentions: [],
        workspaces: [],
        automations: [],
        activity: [],
        jobs: [],
        items: [...taskResults, ...fileResults, ...sourceResults],
      });
    }
    if (path === "/files" && method === "GET") return fulfillJson(route, files);
    const focusedFileMatch = path.match(/^\/files\/([^/]+)$/);
    if (focusedFileMatch && method === "GET") {
      const file = focusedFileMatch[1] === focusedSearchFile.id
        ? focusedSearchFile
        : files.find((item) => item.id === focusedFileMatch[1]);
      return file
        ? fulfillJson(route, file)
        : fulfillJson(route, { detail: "File not found." }, 404);
    }
    if (path === "/connectors" && method === "GET") return fulfillJson(route, [focusedSearchConnector]);
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
  const countedFromRawRoot = incrementThreadReplyCount(
    [{ ...root, thread_reply_count: undefined } as unknown as WorkspaceChannelMessage],
    workspaceChannelMessage(7, { parent_message_id: "root" }),
  );
  expect(countedFromRawRoot).toMatchObject([{ id: "root", thread_reply_count: 1 }]);
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

  test("keeps shell motion CSS-only and honors reduced motion", async ({ page, isMobile }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/dashboard");

    const pageTransition = page.locator(".omnix-shell-page-enter");
    const particles = page.locator(".omnix-shell-particle");
    await expect(pageTransition).toHaveCSS("animation-name", "none");
    await expect(particles).toHaveCount(30);
    await expect(particles.first()).toHaveCSS("animation-name", "none");

    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
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

  test("hydrates and focuses a file selected from workspace search", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    const search = page.getByRole("textbox", { name: "Search Omnix commands and workspace results" });
    await search.fill("archived rollout");
    await page.getByRole("button", { name: /Archived rollout brief/ }).click();

    await expect(page).toHaveURL(/\/files\?id=file-archive-1/);
    const focusedFile = page.locator('[data-search-focused="true"]');
    await expect(focusedFile).toContainText("archived-rollout-brief.md");
    await expect(focusedFile).toBeFocused();
  });

  test("opens and focuses a connector selected from workspace search", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    const search = page.getByRole("textbox", { name: "Search Omnix commands and workspace results" });
    await search.fill("archived roadmap");
    await page.getByRole("button", { name: /Archived roadmap source/ }).click();

    await expect(page).toHaveURL(/\/sources\?source=connector-archive-1/);
    const focusedSource = page.locator('[data-search-focused="true"]');
    await expect(focusedSource).toContainText("Archived roadmap source");
    await expect(focusedSource).toBeFocused();
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
    await expect(dialog).toHaveAccessibleDescription("Review the keyboard commands available throughout Omnix.");
    await expect(dialog.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();
    await expect.poll(mainContentHasIsolatedAncestor).toBe(true);
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();
    await runAxe(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect.poll(mainContentHasIsolatedAncestor).toBe(false);

    await page.keyboard.type("?");
    await expect(dialog).toBeVisible();
    await page.locator(".omnix-modal-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("decision modal exposes semantics and keeps every dismissal route disabled while saving", async ({ page }) => {
    let releaseDecision!: () => void;
    const decisionGate = new Promise<void>((resolve) => {
      releaseDecision = resolve;
    });
    await page.route("**/api/workspaces/workspace-1/decisions", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      await decisionGate;
      return fulfillJson(route, {
        id: "decision-modal-accessibility",
        workspace_id: "workspace-1",
        title: body.title,
        decision_reason: body.decision_reason,
        status: body.status,
        created_by: userId,
        mentions: [],
        linked_tasks: [],
      }, 201);
    });

    await page.goto("/decisions?create=decision&palette=modal-accessibility");
    const dialog = page.getByRole("dialog", { name: "Record New Decision" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription("Capture an organizational choice, its rationale, status, and linked work.");
    await runAxe(page);
    await page.getByRole("textbox", { name: "Title" }).fill("Keep modal state stable");
    await page.getByRole("textbox", { name: "Reason" }).fill("A pending save must keep its context available.");
    await dialog.getByRole("button", { name: "Record Decision" }).click();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close decision modal" })).toBeDisabled();

    await page.keyboard.press("Escape");
    await page.locator(".omnix-modal-backdrop").click({ position: { x: 2, y: 2 } });
    await expect(dialog).toBeVisible();

    releaseDecision();
    await expect(dialog).toBeHidden();
  });

  test("workspace creation dialogs isolate the page and restore their launch controls", async ({ page }) => {
    await page.goto("/workspace");

    const workspaceTrigger = page.getByRole("button", { name: "New workspace" });
    await workspaceTrigger.click();
    const workspaceDialog = page.getByRole("dialog", { name: "Create workspace" });
    await expect(workspaceDialog).toBeVisible();
    await expect(workspaceDialog).toHaveAccessibleDescription("Add a new root workspace to the Omnix hierarchy.");
    await expect(page.getByRole("textbox", { name: "Workspace name" })).toBeFocused();
    await runAxe(page);
    await page.keyboard.press("Escape");
    await expect(workspaceDialog).toBeHidden();
    await expect(workspaceTrigger).toBeFocused();

    const subspaceTrigger = page.getByRole("button", { name: "New subworkspace" });
    await subspaceTrigger.click();
    const subspaceDialog = page.getByRole("dialog", { name: "Create subworkspace" });
    await expect(subspaceDialog).toBeVisible();
    await expect(subspaceDialog).toHaveAccessibleDescription("Add a child workspace under an existing parent workspace.");
    await expect(page.getByRole("textbox", { name: "Subworkspace name" })).toBeFocused();
    await runAxe(page);
    await page.keyboard.press("Escape");
    await expect(subspaceDialog).toBeHidden();
    await expect(subspaceTrigger).toBeFocused();
  });

  test("file connector and document suggestion overlays use the shared dialog contract", async ({ page }) => {
    await page.goto("/files");
    await page.getByRole("button", { name: /^Connectors/ }).click();
    const connectorTrigger = page.getByRole("button", { name: /Knowledge link/ });
    await connectorTrigger.click();
    const connectorDialog = page.getByRole("dialog", { name: "Knowledge link" });
    await expect(connectorDialog).toHaveAccessibleDescription("Docs, wiki, or policy URL");
    await runAxe(page);
    await page.keyboard.press("Escape");
    await expect(connectorDialog).toBeHidden();
    await expect(connectorTrigger).toBeFocused();

    await page.getByRole("button", { name: /^Files/ }).click();
    const fileCard = page.locator("[data-search-focused], .omnix-source-card").filter({ hasText: "release-plan.md" });
    const suggestionTrigger = fileCard.getByRole("button", { name: "Decisions" });
    await suggestionTrigger.click();
    const suggestionDialog = page.getByRole("dialog", { name: "release-plan.md" });
    await expect(suggestionDialog).toHaveAccessibleDescription("Review evidence-backed decision suggestions extracted from this document.");
    await runAxe(page);
    await suggestionDialog.getByRole("button", { name: "Close document decision suggestions" }).click();
    await expect(suggestionDialog).toBeHidden();
    await expect(suggestionTrigger).toBeFocused();
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

  test("cancels a stale channel snapshot when the workspace changes", async ({ page, isMobile }) => {
    let releaseWorkspaceOne!: () => void;
    const workspaceOneGate = new Promise<void>((resolve) => {
      releaseWorkspaceOne = resolve;
    });
    const requests: Array<{ header: string | undefined; workspaceId: string }> = [];

    await page.route("**/api/workspaces/*/channels", async (route) => {
      const match = new URL(route.request().url()).pathname.match(
        /\/workspaces\/([^/]+)\/channels$/,
      );
      const workspaceId = match?.[1] ?? "";
      requests.push({
        header: route.request().headers()["x-omnix-workspace"],
        workspaceId,
      });
      if (workspaceId === "workspace-1") {
        await workspaceOneGate;
      }
      const channel = workspaceChannel({
        id: `channel-${workspaceId}`,
        name: workspaceId === "workspace-1"
          ? "Stale Acme channel"
          : "Platform coordination",
        workspace_id: workspaceId,
      });
      await fulfillJson(route, [channel]).catch(() => undefined);
    });

    await page.goto("/conversations");
    await expect.poll(
      () => requests.filter((request) => request.workspaceId === "workspace-1").length,
    ).toBe(1);
    const workspaceOneRequestOutcome = Promise.race([
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
          "/api/workspaces/workspace-1/channels",
      ),
      page.waitForEvent("requestfailed", {
        predicate: (request) =>
          new URL(request.url()).pathname ===
          "/api/workspaces/workspace-1/channels",
      }),
    ]);
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();

    await expect(page.getByRole("button", { name: /^Platform coordination/ })).toBeVisible();
    releaseWorkspaceOne();
    await workspaceOneRequestOutcome;
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() =>
        window.requestAnimationFrame(() => resolve()));
    }));
    await expect(page.getByText("Stale Acme channel", { exact: true })).toHaveCount(0);
    expect(requests).toContainEqual({
      header: "workspace-1",
      workspaceId: "workspace-1",
    });
    expect(requests).toContainEqual({
      header: "workspace-2",
      workspaceId: "workspace-2",
    });
  });

  test("retries one transient channel snapshot failure", async ({ page }) => {
    workspaceChannels = [
      workspaceChannel({ name: "Recovered coordination" }),
    ];
    let channelRequests = 0;
    await page.route(
      "**/api/workspaces/workspace-1/channels",
      async (route) => {
        channelRequests += 1;
        if (channelRequests === 1) {
          return fulfillJson(
            route,
            { detail: "Temporary channel outage" },
            503,
          );
        }
        await route.fallback();
      },
    );

    await page.goto("/conversations");

    await expect(page.getByRole("button", { name: /^Recovered coordination/ })).toBeVisible();
    expect(channelRequests).toBe(2);
  });

  test("reconciles a channel that committed before its response was lost", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    let createRequests = 0;
    await page.route(
      "**/api/workspaces/workspace-1/channels",
      async (route) => {
        if (route.request().method() !== "POST") {
          return route.fallback();
        }
        createRequests += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        workspaceChannels = [
          ...workspaceChannels,
          workspaceChannel({
            id: "channel-release",
            name: String(body.name),
            slug: "release-coordination",
            purpose: String(body.purpose),
          }),
        ];
        return fulfillJson(route, { detail: "Response lost after commit" }, 503);
      },
    );

    await page.goto("/conversations");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Release coordination");
    await page.getByRole("textbox", { name: "Channel purpose" }).fill("Coordinate release");
    await page.getByRole("button", { name: "Open", exact: true }).click();

    await expect(page.getByRole("heading", { name: "Release coordination" })).toBeVisible();
    await expect(page.getByText(
      "Unable to create operational channel. Your session may have expired; refresh and try again.",
      { exact: true },
    )).toHaveCount(0);
    expect(createRequests).toBe(1);
  });

  test("a changed channel retry clears the prior attempt's failure banner", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    let createRequests = 0;
    let channelGetRequests = 0;
    await page.route(
      "**/api/workspaces/workspace-1/channels",
      async (route) => {
        if (route.request().method() !== "POST") {
          channelGetRequests += 1;
          return fulfillJson(route, workspaceChannels);
        }
        createRequests += 1;
        if (createRequests === 1) {
          return fulfillJson(route, { detail: "Temporary channel failure" }, 503);
        }
        const body = route.request().postDataJSON() as Record<string, unknown>;
        const created = workspaceChannel({
          id: "channel-retry",
          name: String(body.name),
          slug: "retry-coordination",
          purpose: String(body.purpose),
        });
        workspaceChannels = [...workspaceChannels, created];
        return fulfillJson(route, created, 201);
      },
    );

    await page.goto("/conversations");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Retry coordination");
    await page.getByRole("textbox", { name: "Channel purpose" }).fill("Retry safely");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect.poll(() => createRequests).toBe(1);
    await expect.poll(() => channelGetRequests).toBeGreaterThan(1);
    const createError = page.getByText(
      "Unable to create operational channel. Your session may have expired; refresh and try again.",
      { exact: true },
    );
    await expect(createError).toBeVisible();

    await page.getByPlaceholder("backend").fill("Changed retry coordination");
    await page.getByRole("textbox", { name: "Channel purpose" }).fill("Changed retry safely");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Changed retry coordination" })).toBeVisible();
    await expect(createError).toHaveCount(0);
    expect(createRequests).toBe(2);
  });

  test("a channel create lane is reusable after an A-B-A workspace change", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({
        id: "channel-platform",
        name: "Platform coordination",
        slug: "platform-coordination",
        workspace_id: "workspace-2",
      }),
    ];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    let createAttempts = 0;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    await page.route("**/api/workspaces/workspace-1/channels", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      createAttempts += 1;
      const attemptNumber = createAttempts;
      const body = route.request().postDataJSON() as Record<string, unknown>;
      if (attemptNumber === 1) {
        markFirstStarted();
        await firstGate;
      }
      const created = workspaceChannel({
        id: attemptNumber === 1 ? "channel-old-scope" : "channel-returned-scope",
        name: String(body.name),
        slug: attemptNumber === 1 ? "old-scope" : "returned-scope",
        purpose: String(body.purpose),
      });
      if (attemptNumber === 2) workspaceChannels = [...workspaceChannels, created];
      return fulfillJson(route, created, 201);
    });

    await page.goto("/conversations");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Old scope channel");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await firstStarted;
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Platform Lab/ }).click();
    await page.getByRole("button", { name: "Switch to Acme Operations" }).click();

    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Returned scope channel");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Returned scope channel" })).toBeVisible();
    releaseFirst();
    await page.evaluate(() => new Promise<void>((resolve) =>
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
    ));
    await expect(page.getByRole("heading", { name: "Old scope channel" })).toHaveCount(0);
    expect(createAttempts).toBe(2);
  });

  test("a slow channel create does not replace a newer channel selection", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    let releaseCreate!: () => void;
    let markCreateStarted!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const createStarted = new Promise<void>((resolve) => { markCreateStarted = resolve; });
    await page.route("**/api/workspaces/workspace-1/channels", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      markCreateStarted();
      await createGate;
      const created = workspaceChannel({
        id: "channel-slow-create",
        name: String(body.name),
        slug: "slow-create",
        purpose: String(body.purpose),
      });
      workspaceChannels = [...workspaceChannels, created];
      return fulfillJson(route, created, 201);
    });

    await page.goto("/conversations");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Slow create");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await createStarted;
    await page.getByRole("button", { name: /^Planning/ }).click();
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();

    releaseCreate();
    await expect(page.getByRole("button", { name: /^Slow create/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Planning" })).toBeVisible();
  });

  test("resolving a newer delivery failure reveals an older channel failure", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    let messageAttempts = 0;
    await page.route("**/api/workspaces/workspace-1/channels", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      return fulfillJson(route, { detail: "Channel create failed" }, 503);
    });
    await page.route("**/api/workspaces/workspace-1/channels/channel-general/messages", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      messageAttempts += 1;
      if (messageAttempts === 1) return fulfillJson(route, { detail: "Message failed" }, 503);
      return route.fallback();
    });

    await page.goto("/conversations");
    await page.getByRole("button", { name: "Create channel" }).click();
    await page.getByPlaceholder("backend").fill("Failure ordering");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    const channelError = page.getByText(
      "Unable to create operational channel. Your session may have expired; refresh and try again.",
      { exact: true },
    );
    await expect(channelError).toBeVisible();

    const composer = page.getByPlaceholder("Write an operational update...");
    await composer.fill("Failure ordering update");
    await page.getByRole("button", { name: "Send" }).click();
    const deliveryError = page.getByText("Unable to deliver message. Check your connection and try again.", { exact: true });
    await expect(deliveryError).toBeVisible();
    await expect(channelError).toHaveCount(0);

    await page.getByRole("button", { name: "Send" }).click();
    await expect(deliveryError).toHaveCount(0);
    await expect(channelError).toBeVisible();
  });

  test("deduplicates a failed message submit and reuses its nonce on retry", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    const attempts: Array<Record<string, unknown>> = [];
    let releaseFailure!: () => void;
    let markStarted!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages",
      async (route) => {
        if (route.request().method() !== "POST") {
          return route.fallback();
        }
        attempts.push(route.request().postDataJSON() as Record<string, unknown>);
        if (attempts.length === 1) {
          markStarted();
          await failureGate;
          return fulfillJson(route, { detail: "Temporary send failure" }, 503);
        }
        await route.fallback();
      },
    );

    await page.goto("/conversations");
    const composer = page.getByPlaceholder("Write an operational update...");
    await expect(page.getByRole("button", { name: /^General/ })).toBeVisible();
    await page.getByRole("button", { name: /^General/ }).click();
    await expect(composer).toBeVisible();
    await composer.fill("Retry-safe operational update");
    const composerForm = page.locator("form").filter({ has: composer });
    await composerForm.evaluate((form) => {
      const composerElement = form as HTMLFormElement;
      composerElement.requestSubmit();
      composerElement.requestSubmit();
    });

    await started;
    await expect.poll(() => attempts.length).toBe(1);
    releaseFailure();

    const deliveryError = page.getByText("Unable to deliver message. Check your connection and try again.");
    await expect(deliveryError).toBeVisible();
    await expect(composer).toHaveValue("Retry-safe operational update");
    const failedMessage = page.locator("article").filter({ hasText: "Retry-safe operational update" });
    await expect(failedMessage.getByText("delivery failed")).toBeVisible();
    await expect(failedMessage.getByRole("button", { name: "Track as task" })).toHaveCount(0);
    await expect(failedMessage.getByRole("button", { name: "Convert to Decision" })).toHaveCount(0);

    await page.getByRole("button", { name: "Send" }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]?.client_nonce).toBe(attempts[0]?.client_nonce);
    await expect(composer).toHaveValue("");
    await expect(deliveryError).toHaveCount(0);
    await expect(failedMessage.getByText("delivery failed")).toHaveCount(0);
    await expect(failedMessage.getByRole("button", { name: "Track as task" })).toBeVisible();
  });

  test("a forced canonical snapshot reconciles a response-loss message without reload", async ({ page, isMobile }) => {
    workspaceChannels = [workspaceChannel()];
    let canonical: WorkspaceChannelMessage | null = null;
    let postAttempts = 0;
    let getAttempts = 0;

    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages*",
      async (route) => {
        if (route.request().method() === "GET") {
          getAttempts += 1;
          return fulfillJson(route, canonical ? [canonical] : []);
        }
        if (route.request().method() === "POST") {
          postAttempts += 1;
          const body = route.request().postDataJSON() as Record<string, unknown>;
          canonical = workspaceChannelMessage(21, {
            id: "message-response-loss",
            author_user_id: userId,
            author_name: "Release Tester",
            author_avatar_label: "R",
            client_nonce: String(body.client_nonce),
            content: String(body.content),
          });
          return fulfillJson(route, { detail: "Response lost after commit" }, 503);
        }
        return route.fallback();
      },
    );

    await page.goto("/conversations");
    if (isMobile) await page.getByRole("button", { name: /^General/ }).click();
    const composer = page.getByPlaceholder("Write an operational update...");
    await expect(composer).toBeVisible();
    await composer.fill("Snapshot-reconciled update");
    await page.getByRole("button", { name: "Send" }).click();
    const deliveryError = page.getByText(
      "Unable to deliver message. Check your connection and try again.",
      { exact: true },
    );
    const committed = page.locator("article").filter({ hasText: "Snapshot-reconciled update" });
    await expect.poll(() => postAttempts).toBe(1);
    await expect.poll(() => getAttempts).toBeGreaterThan(1);
    await expect(committed).toHaveCount(1);
    await expect(committed.getByText("sending")).toHaveCount(0);
    await expect(committed.getByText("delivery failed")).toHaveCount(0);
    await expect(deliveryError).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });

  test("a forced thread snapshot reconciles a response-loss reply without reload", async ({ page, isMobile }) => {
    const root = workspaceChannelMessage(1, {
      id: "response-loss-thread-root",
      content: "Coordinate the response-loss follow-through",
      thread_reply_count: 0,
    });
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [root];
    let canonicalReply: WorkspaceChannelMessage | null = null;
    let postAttempts = 0;
    let threadGetAttempts = 0;

    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages*",
      async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() === "GET") {
          const canonicalRoot = {
            ...root,
            thread_reply_count: canonicalReply ? 1 : 0,
          };
          if (url.searchParams.get("thread_root_id") === root.id) {
            threadGetAttempts += 1;
            return fulfillJson(route, canonicalReply
              ? [canonicalRoot, canonicalReply]
              : [canonicalRoot]);
          }
          return fulfillJson(route, [canonicalRoot]);
        }
        if (route.request().method() === "POST") {
          postAttempts += 1;
          const body = route.request().postDataJSON() as Record<string, unknown>;
          canonicalReply = workspaceChannelMessage(2, {
            id: "response-loss-thread-reply",
            author_user_id: userId,
            author_name: "Release Tester",
            author_avatar_label: "R",
            parent_message_id: root.id,
            client_nonce: String(body.client_nonce),
            content: String(body.content),
          });
          return fulfillJson(route, { detail: "Response lost after commit" }, 503);
        }
        return route.fallback();
      },
    );

    await page.goto("/conversations");
    if (isMobile) await page.getByRole("button", { name: /^General/ }).click();
    const rootRow = page.locator("article").filter({
      hasText: "Coordinate the response-loss follow-through",
    });
    await rootRow.getByRole("button", { name: "Open thread" }).click();
    const composer = page.getByPlaceholder("Add focused follow-through...");
    await composer.fill("Canonical response-loss reply");
    await page.getByRole("button", { name: "Reply in thread" }).click();

    const committed = page.locator(".omnix-conversation-thread article").filter({
      hasText: "Canonical response-loss reply",
    });
    await expect.poll(() => postAttempts).toBe(1);
    await expect.poll(() => threadGetAttempts).toBeGreaterThan(1);
    await expect(committed).toHaveCount(1);
    await expect(committed.getByText("sending")).toHaveCount(0);
    await expect(committed.getByText("delivery failed")).toHaveCount(0);
    await expect(page.getByText(
      "Unable to deliver message. Check your connection and try again.",
      { exact: true },
    )).toHaveCount(0);
    await expect(composer).toHaveValue("");
  });

  test("conversation conversion retries clear their owned failure banners", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [workspaceChannelMessage(1, {
      id: "message-conversion-source",
      content: "Approve the retry-safe rollout",
    })];
    let taskAttempts = 0;
    let decisionAttempts = 0;
    const taskNonces: string[] = [];
    const decisionNonces: string[] = [];

    await page.route(
      "**/api/workspaces/workspace-1/tasks/from-message/channel-general/message-conversion-source",
      async (route) => {
        taskAttempts += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        taskNonces.push(String(body.client_nonce));
        if (taskAttempts === 1) {
          return fulfillJson(route, { detail: "Temporary task conversion failure" }, 503);
        }
        return fulfillJson(route, {
          id: "task-from-conversation",
          workspace_id: "workspace-1",
          title: body.title,
          client_nonce: body.client_nonce,
        }, 201);
      },
    );
    await page.route(
      "**/api/workspaces/workspace-1/decisions/from-message/channel-general/message-conversion-source",
      async (route) => {
        decisionAttempts += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        decisionNonces.push(String(body.client_nonce));
        if (decisionAttempts === 1) {
          return fulfillJson(route, { detail: "Temporary decision conversion failure" }, 503);
        }
        return fulfillJson(route, {
          id: "decision-from-conversation",
          workspace_id: "workspace-1",
          title: body.title,
          client_nonce: body.client_nonce,
        }, 201);
      },
    );

    await page.goto("/conversations");
    const sourceMessage = page.locator("article").filter({
      hasText: "Approve the retry-safe rollout",
    });
    await expect(sourceMessage).toBeVisible();

    await sourceMessage.getByRole("button", { name: "Track as task" }).click();
    const taskDialog = page.getByRole("dialog", { name: "Open linked task" });
    await expect(taskDialog).toHaveAccessibleDescription("Create one task linked to the selected discussion.");
    await runAxe(page);
    await page.getByRole("button", { name: "Open task" }).click();
    const taskError = page.getByText(
      "Unable to open task from discussion. Check your connection and try again.",
      { exact: true },
    );
    await expect(taskError).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await sourceMessage.getByRole("button", { name: "Track as task" }).click();
    await page.getByRole("button", { name: "Open task" }).click();
    await expect(page.getByText(/Task opened: Approve the retry-safe rollout/)).toBeVisible();
    await expect(taskError).toHaveCount(0);

    await sourceMessage.getByRole("button", { name: "Convert to Decision" }).click();
    const decisionDialog = page.getByRole("dialog", { name: "Record linked decision" });
    await expect(decisionDialog).toHaveAccessibleDescription("Record one decision linked to the selected discussion.");
    await runAxe(page);
    await page.getByRole("button", { name: "Record decision" }).click();
    const decisionError = page.getByText(
      "Unable to record decision from discussion. Check your connection and try again.",
      { exact: true },
    );
    await expect(decisionError).toBeVisible();
    await page.getByRole("button", { name: "Record decision" }).click();
    await expect(page.getByText(/Decision recorded: Approve the retry-safe rollout/)).toBeVisible();
    await expect(decisionError).toHaveCount(0);
    expect(taskAttempts).toBe(2);
    expect(taskNonces[1]).toBe(taskNonces[0]);
    expect(decisionAttempts).toBe(2);
    expect(decisionNonces[1]).toBe(decisionNonces[0]);
  });

  test("task conversion reconciles a canonical commit after response loss", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [workspaceChannelMessage(1, {
      id: "message-task-response-loss",
      content: "Preserve the canonical task",
    })];
    let postAttempts = 0;
    await page.route(
      "**/api/workspaces/workspace-1/tasks/from-message/channel-general/message-task-response-loss",
      async (route) => {
        postAttempts += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        tasks = [{
          id: "task-response-loss",
          workspace_id: "workspace-1",
          title: body.title,
          client_nonce: body.client_nonce,
        }, ...tasks];
        return fulfillJson(route, { detail: "Response lost after commit" }, 503);
      },
    );

    await page.goto("/conversations");
    const source = page.locator("article").filter({ hasText: "Preserve the canonical task" });
    await source.getByRole("button", { name: "Track as task" }).click();
    await page.getByRole("button", { name: "Open task" }).click();

    await expect(page.getByText(/Task opened: Preserve the canonical task/)).toBeVisible();
    await expect(page.getByText(
      "Unable to open task from discussion. Check your connection and try again.",
      { exact: true },
    )).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open task" })).toHaveCount(0);
    expect(postAttempts).toBe(1);
  });

  test("decision conversion reconciles a canonical commit after response loss", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [workspaceChannelMessage(1, {
      id: "message-decision-response-loss",
      content: "Preserve the canonical decision",
    })];
    let canonicalDecision: Record<string, unknown> | null = null;
    let postAttempts = 0;
    let listAttempts = 0;
    let submittedNonce = "";
    await page.route(
      "**/api/workspaces/workspace-1/decisions",
      async (route) => {
        listAttempts += 1;
        return fulfillJson(route, canonicalDecision ? [canonicalDecision] : []);
      },
    );
    await page.route(
      "**/api/workspaces/workspace-1/decisions/from-message/channel-general/message-decision-response-loss",
      async (route) => {
        postAttempts += 1;
        const body = route.request().postDataJSON() as Record<string, unknown>;
        submittedNonce = String(body.client_nonce);
        canonicalDecision = {
          id: "decision-response-loss",
          workspace_id: "workspace-1",
          title: body.title,
          client_nonce: body.client_nonce,
        };
        return fulfillJson(route, { detail: "Response lost after commit" }, 503);
      },
    );

    await page.goto("/conversations");
    const source = page.locator("article").filter({ hasText: "Preserve the canonical decision" });
    await source.getByRole("button", { name: "Convert to Decision" }).click();
    await page.getByRole("button", { name: "Record decision" }).click();

    await expect(page.getByText(/Decision recorded: Preserve the canonical decision/)).toBeVisible();
    await expect(page.getByText(
      "Unable to record decision from discussion. Check your connection and try again.",
      { exact: true },
    )).toHaveCount(0);
    expect(postAttempts).toBe(1);
    expect(listAttempts).toBeGreaterThan(0);
    expect(submittedNonce).not.toBe("");
  });

  test("changing a source in the same channel clears only its owned conversion failure", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { id: "message-failure-a", content: "Failed source A" }),
      workspaceChannelMessage(2, { id: "message-failure-b", content: "Replacement source B" }),
    ];
    await page.route(
      "**/api/workspaces/workspace-1/tasks/from-message/channel-general/message-failure-a",
      (route) => fulfillJson(route, { detail: "Temporary conversion failure" }, 503),
    );

    await page.goto("/conversations");
    const sourceA = page.locator("article").filter({ hasText: "Failed source A" });
    const sourceB = page.locator("article").filter({ hasText: "Replacement source B" });
    await sourceA.getByRole("button", { name: "Track as task" }).click();
    await page.getByRole("button", { name: "Open task" }).click();
    const failure = page.getByText(
      "Unable to open task from discussion. Check your connection and try again.",
      { exact: true },
    );
    await expect(failure).toBeVisible();

    await sourceB.getByRole("button", { name: "Track as task", includeHidden: true }).dispatchEvent("click");
    await expect(page.getByPlaceholder("Name the specific next step")).toHaveValue("Replacement source B");
    await expect(failure).toHaveCount(0);
  });

  test("a message conversion source is retired when its channel changes", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    workspaceChannelMessages = [workspaceChannelMessage(1, {
      id: "message-owned-by-general",
      content: "General-only decision source",
    })];

    await page.goto("/conversations");
    const source = page.locator("article").filter({ hasText: "General-only decision source" });
    await source.getByRole("button", { name: "Convert to Decision" }).click();
    await expect(page.getByPlaceholder("Name the organizational choice")).toBeVisible();

    await page.getByRole("button", { name: /^Planning/, includeHidden: true }).dispatchEvent("click");
    await expect(page.getByPlaceholder("Name the organizational choice")).toHaveCount(0);
    await page.getByRole("button", { name: /^General/ }).click();
    await expect(page.getByPlaceholder("Name the organizational choice")).toHaveCount(0);
  });

  test("a thread assistance source is retired when its thread closes", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    const root = workspaceChannelMessage(1, {
      id: "assistance-thread-root",
      content: "Thread-scoped action source",
      thread_reply_count: 1,
    });
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [
      root,
      workspaceChannelMessage(2, {
        id: "assistance-thread-reply",
        content: "Follow through on the thread action",
        parent_message_id: root.id,
      }),
    ];
    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/assist",
      (route) => fulfillJson(route, {
        mode: "actions",
        content: "Open the thread-scoped follow-through task.",
        source_message_count: 2,
        generated_at: "2026-08-24T00:00:00.000Z",
      }),
    );

    await page.goto("/conversations");
    const rootRow = page.locator("article").filter({ hasText: "Thread-scoped action source" });
    await rootRow.getByRole("button", { name: "1 thread replies" }).click();
    const actionsButton = page.locator("button").filter({ hasText: /^Actions$/ });
    await expect(actionsButton).toHaveCount(1);
    await actionsButton.evaluate((button) => (button as HTMLButtonElement).click());
    const convertButton = page.locator("button").filter({ hasText: "Convert selected action" });
    await expect(convertButton).toHaveCount(1);
    await convertButton.evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page.getByPlaceholder("Name the specific next step")).toBeVisible();

    await page.getByRole("button", { name: "Close thread", includeHidden: true }).dispatchEvent("click");
    await expect(page.getByPlaceholder("Name the specific next step")).toHaveCount(0);
    await rootRow.getByRole("button", { name: "1 thread replies" }).click();
    await expect(page.getByPlaceholder("Name the specific next step")).toHaveCount(0);
  });

  test("task conversion releases an A-B-A lane while preserving its semantic nonce", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { id: "message-task-a", content: "Task source A" }),
      workspaceChannelMessage(2, { id: "message-task-b", content: "Task source B" }),
    ];
    const requests: Array<Record<string, unknown>> = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    let markFirstFinished!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstFinished = new Promise<void>((resolve) => { markFirstFinished = resolve; });
    await page.route(
      "**/api/workspaces/workspace-1/tasks/from-message/channel-general/message-task-a",
      async (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        requests.push(body);
        const attempt = requests.length;
        if (attempt === 1) {
          markFirstStarted();
          await firstGate;
        }
        await fulfillJson(route, {
          id: attempt === 1 ? "task-old-activation" : "task-current-activation",
          workspace_id: "workspace-1",
          title: attempt === 1 ? "Old activation" : "Current activation",
          client_nonce: body.client_nonce,
        }, 201);
        if (attempt === 1) markFirstFinished();
      },
    );

    await page.goto("/conversations");
    const sourceA = page.locator("article").filter({ hasText: "Task source A" });
    const sourceB = page.locator("article").filter({ hasText: "Task source B" });
    await sourceA.getByRole("button", { name: "Track as task" }).click();
    await page.getByRole("button", { name: "Open task" }).click();
    await firstStarted;

    await sourceB.getByRole("button", { name: "Track as task", includeHidden: true }).dispatchEvent("click");
    await expect(page.getByPlaceholder("Name the specific next step")).toHaveValue("Task source B");
    await sourceA.getByRole("button", { name: "Track as task", includeHidden: true }).dispatchEvent("click");
    await expect(page.getByPlaceholder("Name the specific next step")).toHaveValue("Task source A");
    await page.getByRole("button", { name: "Open task" }).click();

    await expect(page.getByText(/Task opened: Current activation/)).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.client_nonce).toBe(requests[0]?.client_nonce);
    releaseFirst();
    await firstFinished;
    await expect(page.getByText(/Task opened: Old activation/)).toHaveCount(0);
  });

  test("does not apply a slow message completion after an A-B-A channel scope change", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({
        id: "channel-platform",
        name: "Platform coordination",
        slug: "platform-coordination",
        workspace_id: "workspace-2",
      }),
    ];
    let releaseSend!: () => void;
    let markStarted!: () => void;
    let sendAttempts = 0;
    const sendGate = new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages",
      async (route) => {
        if (route.request().method() !== "POST") {
          return route.fallback();
        }
        const body = route.request().postDataJSON() as Record<string, unknown>;
        sendAttempts += 1;
        const attemptNumber = sendAttempts;
        if (attemptNumber === 1) {
          markStarted();
          await sendGate;
        }
        return fulfillJson(route, workspaceChannelMessage(20, {
          id: attemptNumber === 1 ? "message-from-old-channel" : "message-from-returned-channel",
          author_user_id: userId,
          author_name: "Release Tester",
          author_avatar_label: "R",
          client_nonce: String(body.client_nonce),
          content: String(body.content),
        }), 201);
      },
    );

    await page.goto("/conversations");
    const firstComposer = page.getByPlaceholder("Write an operational update...");
    await firstComposer.fill("Old channel mutation");
    await page.getByRole("button", { name: "Send" }).click();
    await started;

    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();
    await expect(page.getByRole("heading", { name: "Platform coordination" })).toBeVisible();
    const currentComposer = page.getByPlaceholder("Write an operational update...");
    await currentComposer.fill("Current channel draft");

    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Platform Lab/ }).click();
    await page.getByRole("button", { name: "Switch to Acme Operations" }).click();
    await expect(page.getByRole("heading", { name: "general" })).toBeVisible();
    const returnedComposer = page.getByPlaceholder("Write an operational update...");
    await returnedComposer.fill("Returned channel mutation");
    const returnedChannelResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/workspaces/workspace-1/channels/channel-general/messages" &&
        response.request().method() === "POST" &&
        response.request().postDataJSON()?.content === "Returned channel mutation",
    );
    await page.getByRole("button", { name: "Send" }).click();
    await returnedChannelResponse;
    const returnedMessage = page.locator("article").filter({ hasText: "Returned channel mutation" });
    await expect(returnedMessage).toBeVisible();

    const oldChannelResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/workspaces/workspace-1/channels/channel-general/messages" &&
        response.request().method() === "POST",
    );
    releaseSend();
    await oldChannelResponse;
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));

    expect(sendAttempts).toBe(2);
    await expect(returnedMessage).toBeVisible();
    await expect(page.getByText("Old channel mutation", { exact: true })).toHaveCount(0);
  });

  test("replaces channel messages when the selected channel changes", async ({ page, isMobile }) => {
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({
        id: "channel-planning",
        name: "Planning",
        slug: "planning",
        last_message_preview: "Planning-only update",
      }),
    ];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { content: "General-only update" }),
      workspaceChannelMessage(2, {
        id: "planning-message",
        channel_id: "channel-planning",
        content: "Planning-only update",
      }),
    ];

    await page.goto("/conversations");
    const messagesPane = page.locator(".omnix-conversation-messages");
    await page.getByRole("button", { name: /^General\b/ }).click();
    await expect(messagesPane.getByText("General-only update", { exact: true })).toBeVisible();

    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^Planning\b/ }).click();
    await expect(messagesPane.getByText("Planning-only update", { exact: true })).toBeVisible();
    await expect(messagesPane.getByText("General-only update", { exact: true })).toHaveCount(0);
  });

  test("resolves the exact discussion failure when channel selection changes", async ({ page }) => {
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    let releasePlanning!: () => void;
    const planningGate = new Promise<void>((resolve) => { releasePlanning = resolve; });
    await page.route(
      "**/api/workspaces/workspace-1/channels/*/messages*",
      async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes("/channel-general/")) {
          return fulfillJson(route, { detail: "General discussion failed" }, 503);
        }
        await planningGate;
        return fulfillJson(route, []);
      },
    );

    await page.goto("/conversations");
    const discussionError = page.getByText(
      "Unable to load discussion. Check your connection and try again.",
      { exact: true },
    );
    await expect(discussionError).toBeVisible();
    await page.getByRole("button", { name: /^Planning/ }).click();
    await expect(discussionError).toHaveCount(0);
    releasePlanning();
  });

  test("resolves the exact thread failure when the thread closes", async ({ page, isMobile }) => {
    const root = workspaceChannelMessage(1, {
      id: "failing-thread-root",
      content: "Thread with a scoped load failure",
      thread_reply_count: 1,
    });
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [root];
    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages*",
      async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get("thread_root_id") === root.id) {
          return fulfillJson(route, { detail: "Thread failed" }, 503);
        }
        return route.fallback();
      },
    );

    await page.goto("/conversations");
    if (isMobile) await page.getByRole("button", { name: /^General/ }).click();
    const rootRow = page.locator("article").filter({ hasText: root.content });
    await rootRow.getByRole("button", { name: "1 thread replies" }).click();
    const threadError = page.getByText(
      "Unable to open thread. Check your connection and try again.",
      { exact: true },
    );
    await expect(threadError).toBeVisible();
    await page.getByRole("button", { name: "Close thread" }).click();
    await expect(threadError).toHaveCount(0);
  });

  test("keeps stale assistance results out of an A-B-A channel scope", async ({ page, isMobile }) => {
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { content: "General assistance source" }),
      workspaceChannelMessage(2, {
        id: "planning-assistance-source",
        channel_id: "channel-planning",
        content: "Planning assistance source",
      }),
    ];
    let releaseStale!: () => void;
    let markStaleStarted!: () => void;
    let markStaleFinished!: () => void;
    let assistAttempts = 0;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
    const staleFinished = new Promise<void>((resolve) => { markStaleFinished = resolve; });
    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/assist",
      async (route) => {
        const attempt = ++assistAttempts;
        if (attempt === 1) {
          markStaleStarted();
          await staleGate;
        }
        await fulfillJson(route, {
          mode: "summary",
          content: attempt === 1
            ? "Stale general assistance"
            : "Current general assistance",
          source_message_count: 1,
          generated_at: "2026-06-20T00:00:00Z",
        });
        if (attempt === 1) markStaleFinished();
      },
    );

    await page.goto("/conversations");
    await page.getByRole("button", { name: /^General/ }).click();
    const summarize = page.getByRole("button", { name: "Summarize" });
    await summarize.evaluate((button) => {
      (button as HTMLButtonElement).click();
      (button as HTMLButtonElement).click();
    });
    await staleStarted;
    expect(assistAttempts).toBe(1);

    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^Planning/ }).click();
    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^General/ }).click();
    await page.getByRole("button", { name: "Summarize" }).click();
    await expect(page.getByText("Current general assistance", { exact: true })).toBeVisible();

    releaseStale();
    await staleFinished;
    await expect(page.getByText("Stale general assistance", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Current general assistance", { exact: true })).toBeVisible();
    expect(assistAttempts).toBe(2);
  });

  test("keeps stale assistance failures out of an A-B-A channel scope", async ({ page, isMobile }) => {
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { content: "General assistance source" }),
      workspaceChannelMessage(2, {
        id: "planning-assistance-source",
        channel_id: "channel-planning",
        content: "Planning assistance source",
      }),
    ];
    let releaseStale!: () => void;
    let markStaleStarted!: () => void;
    let markStaleFinished!: () => void;
    let assistAttempts = 0;
    const staleGate = new Promise<void>((resolve) => { releaseStale = resolve; });
    const staleStarted = new Promise<void>((resolve) => { markStaleStarted = resolve; });
    const staleFinished = new Promise<void>((resolve) => { markStaleFinished = resolve; });
    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/assist",
      async (route) => {
        assistAttempts += 1;
        if (assistAttempts === 1) {
          markStaleStarted();
          await staleGate;
          await fulfillJson(route, { detail: "Stale assistance failure" }, 503);
          markStaleFinished();
          return;
        }
        await fulfillJson(route, {
          mode: "summary",
          content: "Current assistance after returning",
          source_message_count: 1,
          generated_at: "2026-06-20T00:00:00Z",
        });
      },
    );

    await page.goto("/conversations");
    await page.getByRole("button", { name: /^General/ }).click();
    await page.getByRole("button", { name: "Summarize" }).click();
    await staleStarted;
    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^Planning/ }).click();
    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^General/ }).click();
    await page.getByRole("button", { name: "Summarize" }).click();
    await expect(page.getByText("Current assistance after returning", { exact: true })).toBeVisible();

    releaseStale();
    await staleFinished;
    await expect(page.getByText(
      "Conversation assistance is temporarily unavailable. Please try again in a moment.",
      { exact: true },
    )).toHaveCount(0);
    await expect(page.getByText("Current assistance after returning", { exact: true })).toBeVisible();
    expect(assistAttempts).toBe(2);
  });

  test("keeps stale decision-candidate scans out of the selected channel", async ({ page, isMobile }) => {
    workspaceChannels = [
      workspaceChannel(),
      workspaceChannel({ id: "channel-planning", name: "Planning", slug: "planning" }),
    ];
    workspaceChannelMessages = [
      workspaceChannelMessage(1, { content: "General decision source" }),
      workspaceChannelMessage(2, {
        id: "planning-decision-source",
        channel_id: "channel-planning",
        content: "Planning decision source",
      }),
    ];
    let releaseGeneral!: () => void;
    let markGeneralStarted!: () => void;
    let markGeneralFinished!: () => void;
    const generalGate = new Promise<void>((resolve) => { releaseGeneral = resolve; });
    const generalStarted = new Promise<void>((resolve) => { markGeneralStarted = resolve; });
    const generalFinished = new Promise<void>((resolve) => { markGeneralFinished = resolve; });
    await page.route(
      "**/api/workspaces/workspace-1/decisions/candidates/conversation/*",
      async (route) => {
        const channelId = new URL(route.request().url()).pathname.split("/").at(-1) ?? "";
        if (channelId === "channel-general") {
          markGeneralStarted();
          await generalGate;
        }
        await fulfillJson(route, {
          candidates: [{
            id: `candidate-${channelId}`,
            title: channelId === "channel-general"
              ? "Stale general candidate"
              : "Current planning candidate",
            reason: "Verified channel evidence",
            confidence: "medium",
            source_type: "conversation",
            source_id: channelId,
            supporting_evidence: [{
              kind: "conversation_message",
              channel_id: channelId,
              message_id: channelId === "channel-general"
                ? "channel-message-1"
                : "planning-decision-source",
              file_id: null,
              chunk_id: null,
              chunk_index: null,
              page: null,
              char_start: 0,
              char_end: 8,
              quote: "Decision",
              quote_sha256: "a".repeat(64),
              source_content_hash: "b".repeat(64),
              source_updated_at: "2026-06-20T00:00:00Z",
            }],
          }],
          candidate_count: 1,
          source_type: "conversation",
          source_id: channelId,
          generated_at: "2026-06-20T00:00:00Z",
          source_coverage: {
            source_offset: 0,
            loaded_record_count: 1,
            selected_record_count: 1,
            prompt_record_count: 1,
            context_limited: false,
            has_additional_records: false,
            next_source_offset: null,
          },
        });
        if (channelId === "channel-general") markGeneralFinished();
      },
    );

    await page.goto("/conversations");
    await page.getByRole("button", { name: /^General/ }).click();
    await page.getByRole("button", { name: /Potential Decisions/ }).click();
    await generalStarted;
    if (isMobile) await page.getByRole("button", { name: "Channels" }).click();
    await page.getByRole("button", { name: /^Planning/ }).click();
    await page.getByRole("button", { name: /Potential Decisions/ }).click();
    await expect(page.getByText("Current planning candidate", { exact: true })).toBeVisible();

    releaseGeneral();
    await generalFinished;
    await expect(page.getByText("Stale general candidate", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Current planning candidate", { exact: true })).toBeVisible();
  });

  test("ignores a delayed discussion failure after a workspace switch", async ({ page, isMobile }) => {
    workspaceChannels = [workspaceChannel()];
    let releaseDiscussion!: () => void;
    let markDiscussionStarted!: () => void;
    const discussionGate = new Promise<void>((resolve) => {
      releaseDiscussion = resolve;
    });
    const discussionStarted = new Promise<void>((resolve) => {
      markDiscussionStarted = resolve;
    });
    let discussionWorkspaceHeader: string | undefined;

    await page.route(
      "**/api/workspaces/workspace-1/channels/channel-general/messages*",
      async (route) => {
        discussionWorkspaceHeader =
          route.request().headers()["x-omnix-workspace"];
        markDiscussionStarted();
        await discussionGate;
        await fulfillJson(
          route,
          { detail: "Stale discussion failure" },
          503,
        );
      },
    );

    await page.goto("/conversations");
    await discussionStarted;
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();

    const staleResponse = page.waitForResponse(
      (response) =>
        response.url().includes(
          "/workspaces/workspace-1/channels/channel-general/messages",
        ) && response.status() === 503,
    );
    releaseDiscussion();
    await staleResponse;
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));

    await expect(page.getByText(
      "Unable to load discussion. Check your connection and try again.",
      { exact: true },
    )).toHaveCount(0);
    expect(discussionWorkspaceHeader).toBe("workspace-1");
  });

  test("loads initiatives for the newly selected workspace", async ({ page, isMobile }) => {
    await page.route("**/api/workspaces/*/initiatives", async (route) => {
      const match = new URL(route.request().url()).pathname.match(
        /\/workspaces\/([^/]+)\/initiatives$/,
      );
      const workspaceId = match?.[1] ?? "";
      const title = workspaceId === "workspace-1"
        ? "Acme initiative"
        : "Platform initiative";
      await fulfillJson(route, [{
        activity_metadata: {},
        created_at: "2026-06-20T00:00:00Z",
        id: `initiative-${workspaceId}`,
        initiative_context: null,
        linked_channels: [],
        linked_decisions: [],
        linked_resources: [],
        linked_tasks: [],
        momentum: {
          blocked_task_count: 0,
          channel_count: 0,
          complete_task_count: 0,
          discussion_message_count: 0,
          due_soon_count: 0,
          health: "quiet",
          last_movement_at: null,
          open_task_count: 0,
          overdue_count: 0,
          summary: "No active operational movement detected.",
          task_count: 0,
        },
        owner_user_id: null,
        status: "active",
        target_date: null,
        title,
        updated_at: "2026-06-20T00:00:00Z",
        workspace_id: workspaceId,
      }]);
    });

    await page.goto("/initiatives");
    await expect(page.getByRole("heading", { name: "Acme initiative", exact: true }).last()).toBeVisible();
    if (isMobile) {
      await page.getByRole("button", { name: "Open navigation" }).click();
    }
    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();

    await expect(page.getByRole("heading", { name: "Platform initiative", exact: true }).last()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Acme initiative", exact: true })).toHaveCount(0);
  });

  test("a slow initiative create preserves a newer user selection", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    const first = workspaceInitiative("initiative-first", "First initiative");
    const second = workspaceInitiative("initiative-second", "Second initiative");
    let initiativeRows = [first, second];
    let releaseCreate!: () => void;
    let markStarted!: () => void;
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    await page.route("**/api/workspaces/workspace-1/initiatives", async (route) => {
      if (route.request().method() === "GET") return fulfillJson(route, initiativeRows);
      const body = route.request().postDataJSON() as Record<string, unknown>;
      const created = workspaceInitiative(
        "initiative-created",
        String(body.title),
        { client_nonce: body.client_nonce },
      );
      markStarted();
      await createGate;
      initiativeRows = [created, ...initiativeRows];
      return fulfillJson(route, created, 201);
    });

    await page.goto("/initiatives");
    await page.getByRole("button", { name: "Create Initiative", exact: true }).click();
    await page.getByPlaceholder("Investor demo").fill("Slow created initiative");
    await page.getByRole("button", { name: "Create initiative", exact: true }).click();
    await started;
    await page.getByRole("button", { name: /Second initiative/ }).click();
    await expect(page.getByRole("heading", { name: "Second initiative", exact: true }).last()).toBeVisible();

    releaseCreate();
    await expect(page.getByText("Initiative created", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Second initiative", exact: true }).last()).toBeVisible();
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

  test("deduplicates a failed task submit and reuses its nonce on retry", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    const attempts: Array<Record<string, unknown>> = [];
    let releaseFailure!: () => void;
    let markStarted!: () => void;
    const failureGate = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    await page.route(
      "**/api/workspaces/workspace-1/tasks",
      async (route) => {
        if (route.request().method() !== "POST") {
          return route.fallback();
        }
        attempts.push(route.request().postDataJSON() as Record<string, unknown>);
        if (attempts.length === 1) {
          markStarted();
          await failureGate;
          return fulfillJson(route, { detail: "Temporary task failure" }, 503);
        }
        await route.fallback();
      },
    );

    await page.goto("/tasks");
    await page.getByRole("button", { name: "Record Task" }).click();
    const titleInput = page.getByPlaceholder("Operational next step");
    await titleInput.fill("Retry-safe release task");
    const createForm = page.locator("form").filter({ has: titleInput });
    await createForm.evaluate((form) => {
      const formElement = form as HTMLFormElement;
      formElement.requestSubmit();
      formElement.requestSubmit();
    });

    await started;
    await expect.poll(() => attempts.length).toBe(1);
    releaseFailure();

    const createError = page.getByText("Unable to open task. Check your connection and try again.");
    await expect(createError).toBeVisible();
    await expect(titleInput).toHaveValue("Retry-safe release task");
    await expect(
      page.locator("article").filter({ hasText: "Retry-safe release task" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Create record" }).click();
    await expect.poll(() => attempts.length).toBe(2);
    expect(attempts[1]?.client_nonce).toBe(attempts[0]?.client_nonce);
    await expect(createError).toHaveCount(0);
    await expect(
      page.locator("article").filter({ hasText: "Retry-safe release task" }),
    ).toBeVisible();
  });

  test("does not apply a slow task completion to a newly selected workspace", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    let releaseCreate!: () => void;
    let markStarted!: () => void;
    const createGate = new Promise<void>((resolve) => {
      releaseCreate = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    await page.route("**/api/workspaces/*/tasks", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const match = path.match(/\/workspaces\/([^/]+)\/tasks$/);
      const workspaceId = match?.[1] ?? "";
      if (request.method() === "GET" && workspaceId === "workspace-2") {
        return fulfillJson(route, []);
      }
      if (request.method() !== "POST" || workspaceId !== "workspace-1") {
        return route.fallback();
      }

      const body = request.postDataJSON() as Record<string, unknown>;
      markStarted();
      await createGate;
      return fulfillJson(route, {
        activity_metadata: { origin: "manual" },
        blockers: [],
        client_nonce: body.client_nonce,
        created_at: "2026-06-20T00:00:00Z",
        created_by: userId,
        decisions: [],
        description: body.description ?? null,
        due_date: null,
        id: "task-from-old-workspace",
        initiative_id: null,
        linked_context: [],
        linked_decisions: [],
        mentions: [],
        momentum_metadata: {},
        owner_name: null,
        owner_user_id: null,
        status: "idea",
        title: body.title,
        updated_at: "2026-06-20T00:00:00Z",
        workspace_id: "workspace-1",
      }, 201);
    });

    await page.goto("/tasks");
    await page.getByRole("button", { name: "Record Task" }).click();
    const titleInput = page.getByPlaceholder("Operational next step");
    await titleInput.fill("Old workspace mutation");
    await page.getByRole("button", { name: "Create record" }).click();
    await started;

    await page.getByRole("button", { name: /Switch workspace\. Current workspace: Acme Operations/ }).click();
    await page.getByRole("button", { name: "Switch to Platform Lab" }).click();
    await expect(page.getByText("Platform Lab").first()).toBeVisible();
    await expect(titleInput).toBeHidden();
    await page.getByRole("button", { name: "Record Task" }).click();
    const currentTitleInput = page.getByPlaceholder("Operational next step");
    await expect(currentTitleInput).toBeEnabled();
    await currentTitleInput.fill("Platform workspace draft");

    const oldWorkspaceResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/workspaces/workspace-1/tasks" &&
        response.request().method() === "POST",
    );
    releaseCreate();
    await oldWorkspaceResponse;
    await page.evaluate(() => new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    }));

    await expect(currentTitleInput).toHaveValue("Platform workspace draft");
    await expect(page.getByText("Old workspace mutation", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Task created", { exact: true })).toHaveCount(0);
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

  test("projects a canonical thread-root reply count back into the channel", async ({ page, isMobile }) => {
    test.skip(isMobile, "desktop interaction contract");
    const root = workspaceChannelMessage(1, {
      id: "canonical-thread-root",
      content: "Canonical thread count",
      thread_reply_count: 0,
    });
    workspaceChannels = [workspaceChannel()];
    workspaceChannelMessages = [root];

    await page.goto("/conversations");
    const rootRow = page.locator("article").filter({ hasText: "Canonical thread count" });
    await expect(rootRow.getByRole("button", { name: "Open thread" })).toBeVisible();
    workspaceChannelMessages = [
      { ...root, thread_reply_count: 2 },
      workspaceChannelMessage(2, { parent_message_id: root.id, content: "Canonical reply one" }),
      workspaceChannelMessage(3, { parent_message_id: root.id, content: "Canonical reply two" }),
    ];

    await rootRow.getByRole("button", { name: "Open thread" }).click();
    await expect(page.getByText("Canonical reply two", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close thread" }).click();
    await expect(rootRow.getByRole("button", { name: "2 thread replies" })).toBeVisible();
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

    for (const width of [375, 390, 768, 820]) {
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

  test("replaces streamed text with the validated citation result", async ({ page, isMobile }) => {
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
    if (isMobile) {
      await page.getByRole("button", { name: "Close history" }).click();
    }
    const input = page.getByPlaceholder("Type a message or '/' for commands...");
    await input.fill("Is the release ready?");
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page.getByText("Release is ready [S1] and.")).toBeVisible();
    await expect(page.getByTestId("citation-validation-notice")).toContainText("Citation coverage is incomplete");
    await expect(page.getByText("[S99]", { exact: false })).toHaveCount(0);
    await expect(page.locator('[role="status"][aria-live="polite"]').filter({ hasText: "Response complete." })).toHaveCount(1);
    await expect(page.locator('[role="status"][aria-live="polite"]').filter({ hasText: "Release is ready" })).toHaveCount(0);
  });

  test("exposes conversation loading outside decorative skeletons", async ({ page, isMobile }) => {
    conversations = [
      {
        id: "loading-conversation",
        workspace_id: "workspace-1",
        title: "Loading state",
        preview: "Waiting for messages",
        latest_message_role: "assistant",
        latest_message_at: "2026-06-20T00:00:00Z",
      },
    ];
    let releaseMessages!: () => void;
    const messagesGate = new Promise<void>((resolve) => {
      releaseMessages = resolve;
    });
    await page.route("**/api/conversations/loading-conversation/messages", async (route) => {
      await messagesGate;
      await fulfillJson(route, []);
    });

    await page.goto("/chat?conversation=loading-conversation");
    if (isMobile) {
      await page.getByRole("button", { name: "Close history" }).click();
    }
    const loadingStatus = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: "Loading conversation…" });
    await expect(loadingStatus).toHaveCount(1);
    await expect(loadingStatus).not.toHaveAttribute("aria-hidden", "true");
    await expect(loadingStatus.locator("xpath=following-sibling::*[1]")).toHaveAttribute("aria-hidden", "true");

    releaseMessages();
    await expect(loadingStatus).toHaveCount(0);
  });

  test("announces upload start and queued processing with semantic progress", async ({ page }) => {
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((resolve) => {
      releaseUpload = resolve;
    });
    await page.route("**/api/upload", async (route) => {
      await uploadGate;
      await fulfillJson(route, {
        id: "file-announcement",
        user_id: userId,
        workspace_id: "workspace-1",
        file_name: "screen-reader-upload.md",
        file_type: "text/markdown",
        size_bytes: 96,
        processing_status: "queued",
        extraction_status: "processing",
        metadata: { processing_status: "queued" },
        created_at: "2026-06-20T00:00:00Z",
      }, 201);
    });

    await page.goto("/files");
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "screen-reader-upload.md",
      mimeType: "text/markdown",
      buffer: Buffer.from("# Accessible upload"),
    });

    await expect(page.locator('[role="status"]').filter({ hasText: "screen-reader-upload.md upload started." })).toHaveCount(1);
    const progress = page.getByRole("progressbar", { name: "Uploading screen-reader-upload.md" });
    await expect(progress).toHaveAttribute("aria-valuemin", "0");
    await expect(progress).toHaveAttribute("aria-valuemax", "100");
    await expect(progress).toHaveAttribute("aria-valuenow", /\d+/);
    await expect(progress).toHaveAttribute("aria-valuetext", /\d+% uploaded/);

    releaseUpload();
    await expect(page.locator('[role="status"]').filter({ hasText: "screen-reader-upload.md uploaded and queued for processing." })).toHaveCount(1);
    await expect(page.getByText("Queued").first()).toBeVisible();
  });

  test("announces a newly delivered mention without relying on the bell label", async ({ page }) => {
    await page.goto("/notifications");
    await expect(page.getByRole("button", { name: "Mention notifications, 0 unread" })).toBeVisible();
    await expect(page.getByText("No unread mentions right now.")).toBeVisible();

    mentionFixtures = [
      {
        id: "mention-announcement",
        workspace_id: "workspace-1",
        mentioned_user_id: userId,
        mentioned_by_user_id: "user-2",
        mentioned_by_name: "Taylor Ops",
        mentioned_by_email: "taylor@example.com",
        source_type: "conversation_message",
        source_id: "message-announcement",
        source_title: "Release coordination",
        source_preview: "Please review the launch checklist.",
        source_url: "/conversations?channel=channel-general",
        read_at: null,
        created_at: "2026-06-20T00:05:00Z",
      },
    ];
    mentionUnreadCount = 1;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));

    const mentionToast = page.locator('[role="status"][aria-live="polite"]').filter({ hasText: "New mention" });
    await expect(mentionToast).toContainText("Taylor Ops mentioned you in Release coordination.");
    await expect(page.getByText("1 unread mention in Acme Operations.")).toBeVisible();
  });

  test("notification center composes mentions with authoritative workspace activity", async ({ page }) => {
    mentionFixtures = [{
      id: "mention-inbox",
      workspace_id: "workspace-1",
      mentioned_user_id: userId,
      mentioned_by_user_id: "user-2",
      mentioned_by_name: "Taylor Ops",
      mentioned_by_avatar_label: "T",
      source_type: "task",
      source_id: "task-1",
      source_title: "Reduce upload latency",
      source_preview: "Please review the worker plan.",
      source_url: "/tasks?task=task-1",
      read_at: null,
      created_at: "2026-06-20T00:04:00Z",
    }];
    mentionUnreadCount = 1;
    workspaceActivity = [{
      id: "activity-decision",
      workspace_id: "workspace-1",
      actor_user_id: "user-2",
      actor_name: "Taylor Ops",
      actor_avatar_label: "T",
      event_type: "decision.created",
      summary: "Release approach decision recorded",
      metadata: {},
      created_at: "2026-06-20T00:05:00Z",
    }];

    await page.goto("/notifications");
    await expect(page.getByText("Release approach decision recorded")).toBeVisible();
    await expect(page.getByText(/Taylor Ops mentioned you in Task: Reduce upload latency/)).toBeVisible();

    await page.getByRole("button", { name: /^activity$/i }).click();
    await expect(page.getByText("Release approach decision recorded")).toBeVisible();
    await expect(page.getByText(/mentioned you in/)).toHaveCount(0);
    await page.getByRole("article").filter({ hasText: "Release approach decision recorded" }).getByRole("link", { name: "Open" }).click();
    await expect(page).toHaveURL(/\/decisions$/);
  });

  test("keyboard cancellation announces a stopped response", async ({ page, isMobile }) => {
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await page.route("**/api/chat/stream", async (route) => {
      await streamGate;
      try {
        await route.fulfill({
          status: 200,
          contentType: "text/event-stream",
          body: `data: ${JSON.stringify({ type: "done", conversation_id: "cancelled-stream", content: "Late response" })}\n\n`,
        });
      } catch {
        // The keyboard-initiated abort can close the mocked request before release.
      }
    });

    await page.goto("/chat");
    if (isMobile) {
      await page.getByRole("button", { name: "Close history" }).click();
    }
    await page.getByPlaceholder("Type a message or '/' for commands...").fill("Draft a release note.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: "Omnix is responding." })).toHaveCount(1);

    const stop = page.getByRole("button", { name: "Stop generating" });
    await stop.focus();
    await expect(stop).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator('[role="status"]').filter({ hasText: "Response stopped." })).toHaveCount(1);
    await expect(page.getByText("Unable to send message. Check your connection and try again.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    releaseStream();
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
    test.setTimeout(45_000);

    const directRoutes = [
      ["Decisions", "/decisions"],
      ["Initiatives", "/initiatives"],
      ["Settings", "/settings"],
    ] as const;

    for (const width of [375, 390, 768, 820]) {
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

    const taskSurface = page.locator("#main-content .omnix-container-responsive.omnix-scrollbar");
    const metrics = await taskSurface.evaluate((surface) => {
      const shell = document.querySelector(".omnix-auth-shell") as HTMLElement | null;
      return {
        shellOverflowY: shell ? window.getComputedStyle(shell).overflowY : "",
        surfaceClientHeight: surface.clientHeight,
        surfaceOverflowY: window.getComputedStyle(surface).overflowY,
        surfaceScrollHeight: surface.scrollHeight,
      };
    });

    expect(metrics.shellOverflowY).toBe("hidden");
    expect(metrics.surfaceOverflowY).not.toBe("hidden");
    expect(metrics.surfaceScrollHeight).toBeGreaterThan(metrics.surfaceClientHeight);

    await taskSurface.evaluate((element) => element.scrollTo(0, 320));
    await expect.poll(() => taskSurface.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  });

  test("mobile viewport keeps the focused chat composer above the dock after keyboard shrink", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/chat");
    await page.getByRole("button", { name: "Close history" }).click();

    const viewportMeta = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(viewportMeta).toContain("viewport-fit=cover");
    expect(viewportMeta).toContain("interactive-widget=resizes-content");

    const composer = page.getByRole("textbox", { name: "Message composer" });
    await composer.focus();
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(composer).toBeFocused();

    const metrics = await page.evaluate(() => {
      const sendButton = document.querySelector('button[aria-label="Send message"]');
      const dock = document.querySelector('nav[aria-label="Primary mobile navigation"]');
      const sendRect = sendButton?.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      return {
        dockBottom: dockRect?.bottom ?? Number.POSITIVE_INFINITY,
        dockTop: dockRect?.top ?? 0,
        documentWidth: document.scrollingElement?.scrollWidth ?? 0,
        sendBottom: sendRect?.bottom ?? Number.POSITIVE_INFINITY,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });

    expect(metrics.sendBottom).toBeLessThanOrEqual(metrics.dockTop + 1);
    expect(metrics.dockBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  });

  test("long task titles stay contained from narrow phones through touch tablets", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    const longTitle = "Coordinate the cross-functional release readiness review without widening the mobile workspace";
    tasks = [{ ...tasks[0], title: longTitle }, ...tasks.slice(1)];

    for (const width of [375, 390, 768, 820]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto("/tasks");
      await expect(page.getByText(longTitle, { exact: true })).toBeVisible();
      const metrics = await page.evaluate(() => ({
        documentWidth: document.scrollingElement?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      }));
      expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
    }
  });

  test("wide chat tables scroll locally without widening the phone layout", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    conversations = [
      {
        id: "wide-table",
        workspace_id: "workspace-1",
        title: "Release matrix",
        preview: "A wide comparison table",
        latest_message_role: "assistant",
        latest_message_at: "2026-06-20T00:00:00Z",
      },
    ];
    messagesByConversation = {
      "wide-table": [
        {
          id: "message-wide-table",
          conversation_id: "wide-table",
          role: "assistant",
          content: [
            "| Workstream | Owner | Dependency | Verification |",
            "| --- | --- | --- | --- |",
            "| Mobile release readiness | CrossFunctionalOperationsOwner | AuthenticationAndWorkspaceIsolationDependency | DesktopMobileIntegrationVerification |",
          ].join("\n"),
          status: "completed",
          created_at: "2026-06-20T00:00:00Z",
        },
      ],
    };

    await page.setViewportSize({ width: 375, height: 844 });
    await page.goto("/chat?conversation=wide-table");
    await page.getByRole("button", { name: "Close history" }).click();
    const table = page.getByRole("table");
    await expect(table).toBeVisible();
    const metrics = await table.evaluate((element) => {
      const scroller = element.parentElement;
      return {
        documentWidth: document.scrollingElement?.scrollWidth ?? 0,
        scrollerClientWidth: scroller?.clientWidth ?? 0,
        scrollerScrollWidth: scroller?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      };
    });
    expect(metrics.scrollerScrollWidth).toBeGreaterThan(metrics.scrollerClientWidth);
    expect(metrics.documentWidth).toBeLessThanOrEqual(metrics.viewportWidth);
  });

  test("short mobile viewports keep modal header and footer fixed around a scrollable body", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.setViewportSize({ width: 390, height: 520 });
    await page.goto("/decisions?create=decision&palette=mobile-scroll");

    const dialog = page.getByRole("dialog", { name: "Record New Decision" });
    const body = dialog.locator(":scope > form > .omnix-scrollbar");
    const submit = dialog.getByRole("button", { name: "Record Decision" });
    await expect(dialog).toBeVisible();
    await expect(body).toBeVisible();
    await expect(submit).toBeVisible();

    const metrics = await dialog.evaluate((element) => {
      const bodyElement = element.querySelector(":scope > form > .omnix-scrollbar");
      const submitButton = element.querySelector('button[form][type="submit"]');
      const dialogRect = element.getBoundingClientRect();
      const submitRect = submitButton?.getBoundingClientRect();
      return {
        bodyClientHeight: bodyElement?.clientHeight ?? 0,
        bodyOverflowY: bodyElement ? getComputedStyle(bodyElement).overflowY : "",
        bodyScrollHeight: bodyElement?.scrollHeight ?? 0,
        dialogBottom: dialogRect.bottom,
        dialogTop: dialogRect.top,
        submitBottom: submitRect?.bottom ?? Number.POSITIVE_INFINITY,
        viewportHeight: window.innerHeight,
      };
    });

    expect(metrics.bodyOverflowY).toBe("auto");
    expect(metrics.bodyScrollHeight).toBeGreaterThan(metrics.bodyClientHeight);
    expect(metrics.dialogTop).toBeGreaterThanOrEqual(0);
    expect(metrics.dialogBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);
    expect(metrics.submitBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1);

    await body.evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
    await expect(dialog.getByRole("heading", { name: "Record New Decision" })).toBeVisible();
    await expect(submit).toBeVisible();
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
