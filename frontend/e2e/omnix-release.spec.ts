import { expect, test, type Page, type Route } from "@playwright/test";

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

function resetMockState() {
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
    if (channelsMatch) return fulfillJson(route, []);
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
    if (path === "/conversations") return fulfillJson(route, []);

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

  test("opens command palette, searches, and activates a result", async ({ page }) => {
    await page.goto("/dashboard");
    await page.getByRole("button", { name: "Open command palette" }).first().click();
    const search = page.getByRole("textbox", { name: "Search Omnix commands and workspace results" });
    await expect(search).toBeVisible();
    await search.fill("latency");
    await expect(page.getByRole("button", { name: /Reduce upload latency/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tasks\?id=task-1/);
  });

  test("command palette supports keyboard navigation and focus return", async ({ page }) => {
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
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("button", { name: /^Create Decision\./ })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(dialog.getByRole("button", { name: /^Create Task\./ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/tasks\?create=task&palette=/);
  });

  test("keyboard shortcuts modal restores focus on close", async ({ page }) => {
    await page.goto("/dashboard");
    const trigger = page.getByRole("button", { name: "Open command palette" }).first();
    await trigger.focus();
    await page.keyboard.type("?");

    const dialog = page.getByRole("dialog", { name: "Keyboard shortcuts" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close keyboard shortcuts" })).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
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

  test("mobile navigation renders core routes and command palette", async ({ page, isMobile }) => {
    test.skip(!isMobile, "mobile project only");
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open command palette" })).toBeVisible();
    await page.goto("/files");
    await expect(page.getByText("Workspace files")).toBeVisible();
    await page.goto("/tasks");
    await expect(page.getByRole("button", { name: "Record Task" })).toBeVisible();
    await page.goto("/decisions");
    await expect(page.getByRole("heading", { name: "Workspace Decisions" })).toBeVisible();
    await page.goto("/notifications");
    await expect(page.getByText("Notifications").first()).toBeVisible();
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
