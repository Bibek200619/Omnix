import { expect, test, type Page, type Route } from "@playwright/test";

const userId = "optimistic-user";
const workspaceId = "workspace-optimistic";
const otherWorkspaceId = "workspace-optimistic-other";

type JsonRecord = Record<string, unknown>;

type MutationApiState = {
  initiativeGets: number;
  initiativeLinkPosts: number;
  initiatives: JsonRecord[];
  onInitiativeAssist?: (route: Route, body: JsonRecord, initiativeId: string) => Promise<void>;
  onInitiativeCreate?: (route: Route, body: JsonRecord) => Promise<void>;
  onInitiativeGet?: (route: Route, requestedWorkspaceId: string) => Promise<boolean>;
  onInitiativePatch?: (route: Route, body: JsonRecord, initiativeId: string) => Promise<void>;
  onInitiativeTaskAttach?: (route: Route, initiativeId: string, taskId: string) => Promise<void>;
  onTaskCreate?: (route: Route, body: JsonRecord, requestedWorkspaceId: string) => Promise<void>;
  onTaskAssist?: (route: Route, body: JsonRecord, requestedWorkspaceId: string) => Promise<void>;
  onTaskGet?: (route: Route, requestedWorkspaceId: string) => Promise<boolean>;
  onTaskPatch?: (route: Route, body: JsonRecord, taskId: string) => Promise<void>;
  taskGets: number;
  tasks: JsonRecord[];
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function workspace(id = workspaceId, name = "Optimistic Workspace") {
  return {
    id,
    user_id: userId,
    name,
    description: "Mutation lifecycle verification",
    parent_workspace_id: null,
    workspace_type: "super_workspace",
    is_global: false,
    workspace_focus: "engineering",
    ai_specialization: "engineering",
    intelligence_preferences: { memory_enabled: true },
    current_user_role: "founder",
    member_count: 1,
    is_shared: false,
    members_preview: [member()],
    subspaces: [],
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
  };
}

function member() {
  return {
    user_id: userId,
    full_name: "Optimistic Tester",
    email: "optimistic@example.com",
    role: "founder",
  };
}

function taskRecord(overrides: JsonRecord = {}) {
  return {
    id: "task-one",
    workspace_id: workspaceId,
    title: "Ship the guarded release",
    description: "Verify mutation ownership.",
    status: "active",
    owner_user_id: userId,
    owner_name: "Optimistic Tester",
    created_by: userId,
    due_date: null,
    blockers: [],
    linked_context: [],
    activity_metadata: { origin: "manual" },
    momentum_metadata: {},
    mentions: [],
    initiative_id: null,
    client_nonce: null,
    linked_decisions: [],
    decisions: [],
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function quietMomentum() {
  return {
    health: "quiet",
    summary: "No active operational movement detected.",
    task_count: 0,
    open_task_count: 0,
    complete_task_count: 0,
    blocked_task_count: 0,
    due_soon_count: 0,
    overdue_count: 0,
    channel_count: 0,
    discussion_message_count: 0,
    last_movement_at: null,
  };
}

function initiativeRecord(overrides: JsonRecord = {}) {
  return {
    id: "initiative-one",
    workspace_id: workspaceId,
    title: "Guarded initiative",
    description: "Keep strategy aligned.",
    status: "active",
    owner_user_id: null,
    target_date: null,
    initiative_context: null,
    linked_resources: [],
    linked_tasks: [],
    linked_channels: [],
    linked_decisions: [],
    activity_metadata: { origin: "manual" },
    client_nonce: null,
    momentum: quietMomentum(),
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload),
  });
}

async function seedAuthenticatedSession(page: Page) {
  await page.addInitScript(
    ({ session, selectedWorkspaceId }) => {
      window.localStorage.setItem("omnix.supabase.auth", JSON.stringify(session));
      window.localStorage.setItem("omnix.activeWorkspaceId", selectedWorkspaceId);
      window.localStorage.setItem(
        `omnix.activeWorkspaceId.${session.user.id}`,
        selectedWorkspaceId,
      );
      window.localStorage.setItem(
        `omnix.onboarding.completed.${session.user.id}`,
        "true",
      );
    },
    {
      selectedWorkspaceId: workspaceId,
      session: {
        access_token: "optimistic-token",
        refresh_token: "optimistic-refresh",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "optimistic@example.com",
          app_metadata: {},
          user_metadata: { full_name: "Optimistic Tester" },
          created_at: "2026-08-01T00:00:00.000Z",
        },
      },
    },
  );
}

async function switchWorkspace(
  page: Page,
  isMobile: boolean,
  currentName: string,
  targetName: string,
  targetId: string,
) {
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", {
    name: new RegExp(`Switch workspace\\. Current workspace: ${currentName}`),
  }).click();
  await page.getByRole("button", { name: `Switch to ${targetName}` }).click();
  await expect.poll(() => page.evaluate((currentUserId) => (
    window.localStorage.getItem(`omnix.activeWorkspaceId.${currentUserId}`)
  ), userId)).toBe(targetId);
}

async function revealInitiativeList(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: /Back/ }).click();
}

async function installMutationApi(page: Page, state: MutationApiState) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();

    if (path === "/profile") {
      return fulfillJson(route, {
        user_id: userId,
        email: "optimistic@example.com",
        display_name: "Optimistic Tester",
        username: "optimistic-tester",
        phone_number: "+15551234567",
      });
    }
    if (path === "/workspaces/hierarchy") {
      return fulfillJson(route, [
        workspace(),
        workspace(otherWorkspaceId, "Optimistic Lab"),
      ]);
    }
    if (path === "/workspaces/status") {
      return fulfillJson(route, [
        { workspace_id: workspaceId, status: "online" },
        { workspace_id: otherWorkspaceId, status: "online" },
      ]);
    }
    const hierarchyMatch = path.match(/^\/workspaces\/([^/]+)\/hierarchy$/);
    if (hierarchyMatch) {
      const requestedWorkspaceId = hierarchyMatch[1];
      return fulfillJson(route, workspace(
        requestedWorkspaceId,
        requestedWorkspaceId === workspaceId ? "Optimistic Workspace" : "Optimistic Lab",
      ));
    }
    if (/^\/workspaces\/[^/]+\/subspaces$/.test(path)) return fulfillJson(route, []);
    if (/^\/workspaces\/[^/]+\/members$/.test(path)) return fulfillJson(route, [member()]);
    if (/^\/workspaces\/[^/]+\/invites$/.test(path)) return fulfillJson(route, []);
    if (path === "/workspace-invites") return fulfillJson(route, []);
    if (/^\/workspaces\/[^/]+\/channels$/.test(path)) return fulfillJson(route, []);
    if (/^\/workspaces\/[^/]+\/activity$/.test(path)) return fulfillJson(route, []);
    if (/^\/workspaces\/[^/]+\/timeline$/.test(path)) return fulfillJson(route, []);
    if (/^\/workspaces\/[^/]+\/continuity\/unresolved$/.test(path)) return fulfillJson(route, []);
    const presenceMatch = path.match(/^\/workspaces\/([^/]+)\/presence(?:\/heartbeat)?$/);
    if (presenceMatch) {
      return fulfillJson(route, {
        workspace_id: presenceMatch[1],
        active_count: 1,
        online_members: [],
        active_members: [],
        recently_active_members: [],
        typing_members: [],
        updated_at: "2026-08-01T00:00:00.000Z",
      });
    }
    const intelligenceMatch = path.match(/^\/workspaces\/([^/]+)\/intelligence$/);
    if (intelligenceMatch) {
      const requestedWorkspaceId = intelligenceMatch[1];
      return fulfillJson(route, {
        workspace_id: requestedWorkspaceId,
        workspace_name: requestedWorkspaceId === workspaceId ? "Optimistic Workspace" : "Optimistic Lab",
        workspace_type: "super_workspace",
        is_global: false,
        workspace_focus: "engineering",
        ai_specialization: "engineering",
        intelligence_preferences: { memory_enabled: true },
        source_count: 0,
        conversation_count: 0,
        member_count: 1,
        active_domains: [],
        connected_sources: [],
        recent_insights: [],
        retrieval_scope: "workspace",
        scope_workspace_ids: [requestedWorkspaceId],
        context_summary: "Mutation lifecycle verification",
      });
    }
    if (/^\/workspaces\/[^/]+\/mentions\/unread-count$/.test(path)) {
      return fulfillJson(route, { unread_count: 0 });
    }
    if (/^\/workspaces\/[^/]+\/mentions$/.test(path)) return fulfillJson(route, []);
    const taskMomentumMatch = path.match(/^\/workspaces\/([^/]+)\/tasks\/momentum$/);
    if (taskMomentumMatch) {
      const taskCount = taskMomentumMatch[1] === workspaceId ? state.tasks.length : 0;
      return fulfillJson(route, {
        flow_counts: { idea: 0, planned: 0, active: taskCount, review: 0, complete: 0 },
        open_count: taskCount,
        blocker_count: 0,
        due_soon_count: 0,
        completed_this_week: 0,
        recent_updates: [],
      });
    }

    const taskAssistMatch = path.match(/^\/workspaces\/([^/]+)\/tasks\/assist$/);
    if (taskAssistMatch && method === "POST") {
      const body = request.postDataJSON() as JsonRecord;
      if (state.onTaskAssist) return state.onTaskAssist(route, body, taskAssistMatch[1]);
    }
    const taskMatch = path.match(/^\/workspaces\/([^/]+)\/tasks\/([^/]+)$/);
    if (taskMatch && method === "PATCH") {
      const body = request.postDataJSON() as JsonRecord;
      if (state.onTaskPatch) return state.onTaskPatch(route, body, taskMatch[2]);
      const changed = { ...state.tasks.find((task) => task.id === taskMatch[2]), ...body };
      state.tasks = state.tasks.map((task) => task.id === taskMatch[2] ? changed : task);
      return fulfillJson(route, changed);
    }
    const taskCollectionMatch = path.match(/^\/workspaces\/([^/]+)\/tasks$/);
    if (taskCollectionMatch && method === "POST") {
      const requestedWorkspaceId = taskCollectionMatch[1];
      const body = request.postDataJSON() as JsonRecord;
      if (state.onTaskCreate) return state.onTaskCreate(route, body, requestedWorkspaceId);
      const created = taskRecord({
        id: "task-created",
        workspace_id: requestedWorkspaceId,
        title: body.title,
        client_nonce: body.client_nonce,
      });
      if (requestedWorkspaceId === workspaceId) state.tasks = [created, ...state.tasks];
      return fulfillJson(route, created, 201);
    }
    if (taskCollectionMatch && method === "GET") {
      if (taskCollectionMatch[1] === workspaceId) state.taskGets += 1;
      if (state.onTaskGet && await state.onTaskGet(route, taskCollectionMatch[1])) return;
      return fulfillJson(route, taskCollectionMatch[1] === workspaceId ? state.tasks : []);
    }

    const initiativeAssistMatch = path.match(/^\/workspaces\/([^/]+)\/initiatives\/([^/]+)\/assist$/);
    if (initiativeAssistMatch && method === "POST") {
      const body = request.postDataJSON() as JsonRecord;
      if (state.onInitiativeAssist) {
        return state.onInitiativeAssist(route, body, initiativeAssistMatch[2]);
      }
    }
    const initiativeTaskAttachMatch = path.match(
      /^\/workspaces\/([^/]+)\/initiatives\/([^/]+)\/tasks\/([^/]+)$/,
    );
    if (initiativeTaskAttachMatch && method === "POST") {
      state.initiativeLinkPosts += 1;
      if (state.onInitiativeTaskAttach) {
        return state.onInitiativeTaskAttach(
          route, initiativeTaskAttachMatch[2], initiativeTaskAttachMatch[3],
        );
      }
      const changed = {
        ...state.initiatives.find(({ id }) => id === initiativeTaskAttachMatch[2]),
        linked_tasks: state.tasks.filter(({ id }) => id === initiativeTaskAttachMatch[3]),
      };
      state.initiatives = state.initiatives.map((initiative) => (
        initiative.id === initiativeTaskAttachMatch[2] ? changed : initiative
      ));
      return fulfillJson(route, changed);
    }
    const initiativeMatch = path.match(/^\/workspaces\/([^/]+)\/initiatives\/([^/]+)$/);
    if (initiativeMatch && method === "PATCH") {
      const body = request.postDataJSON() as JsonRecord;
      if (state.onInitiativePatch) {
        return state.onInitiativePatch(route, body, initiativeMatch[2]);
      }
      const changed = {
        ...state.initiatives.find((initiative) => initiative.id === initiativeMatch[2]),
        ...body,
      };
      state.initiatives = state.initiatives.map((initiative) => (
        initiative.id === initiativeMatch[2] ? changed : initiative
      ));
      return fulfillJson(route, changed);
    }
    const initiativeCollectionMatch = path.match(/^\/workspaces\/([^/]+)\/initiatives$/);
    if (initiativeCollectionMatch && method === "POST") {
      const body = request.postDataJSON() as JsonRecord;
      if (state.onInitiativeCreate) return state.onInitiativeCreate(route, body);
      const created = initiativeRecord({
        id: "initiative-created",
        workspace_id: initiativeCollectionMatch[1],
        title: body.title,
        client_nonce: body.client_nonce,
      });
      if (initiativeCollectionMatch[1] === workspaceId) {
        state.initiatives = [created, ...state.initiatives];
      }
      return fulfillJson(route, created, 201);
    }
    if (initiativeCollectionMatch && method === "GET") {
      if (initiativeCollectionMatch[1] === workspaceId) state.initiativeGets += 1;
      if (
        state.onInitiativeGet
        && await state.onInitiativeGet(route, initiativeCollectionMatch[1])
      ) return;
      return fulfillJson(route, initiativeCollectionMatch[1] === workspaceId ? state.initiatives : []);
    }

    return fulfillJson(route, method === "GET" ? [] : {});
  });
}

function createState(): MutationApiState {
  return {
    initiativeGets: 0,
    initiativeLinkPosts: 0,
    initiatives: [initiativeRecord()],
    taskGets: 0,
    tasks: [taskRecord()],
  };
}

test.beforeEach(async ({ page }) => {
  await seedAuthenticatedSession(page);
});

test("task overlay survives one stale proof and yields to a newer canonical revision", async ({ page }) => {
  const state = createState();
  const secondProofStarted = deferred();
  const releaseSecondProof = deferred();
  let patchResponded = false;
  let proofGets = 0;
  state.onTaskPatch = async (route, body, taskId) => {
    patchResponded = true;
    return fulfillJson(route, taskRecord({
      id: taskId,
      ...body,
      updated_at: "2026-08-01T00:01:00.000Z",
    }));
  };
  state.onTaskGet = async (route, requestedWorkspaceId) => {
    if (!patchResponded || requestedWorkspaceId !== workspaceId) return false;
    proofGets += 1;
    if (proofGets === 1) {
      await fulfillJson(route, [taskRecord()]);
      return true;
    }
    secondProofStarted.resolve();
    await releaseSecondProof.promise;
    await fulfillJson(route, [taskRecord({
      status: "review",
      updated_at: "2026-08-01T00:02:00.000Z",
    })]);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  const status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await expect(status).toHaveValue("active");
  await status.selectOption("planned");
  await secondProofStarted.promise;
  await expect(status).toHaveValue("planned");
  await expect(status).toBeDisabled();

  releaseSecondProof.resolve();
  await expect(status).toHaveValue("review");
  await expect(status).toBeEnabled();
  await expect(page.getByText(/latest server state could not be verified/i)).toHaveCount(0);
});

test("task response loss accepts the original patch after stale then exact proofs", async ({ page }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  const staleTasks = [...state.tasks];
  let responseLost = false;
  let proofReads = 0;
  state.onTaskPatch = async (route, body, taskId) => {
    state.tasks = [taskRecord({
      id: taskId,
      ...body,
      updated_at: "2026-08-01T00:01:00.000Z",
    })];
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onTaskGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads !== 1) return false;
    await fulfillJson(route, staleTasks);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  const status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await status.selectOption("planned");
  await started.promise;
  await expect(status).toHaveValue("planned");
  await expect(status).toBeDisabled();

  const getsBeforeProof = state.taskGets;
  release.resolve();
  await expect.poll(() => state.taskGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  expect(proofReads).toBe(2);
  await expect(status).toHaveValue("planned");
  await expect(status).toBeEnabled();
  await expect(page.getByText(
    "Unable to update task. Your session may have expired; refresh and try again.",
    { exact: true },
  )).toHaveCount(0);
});

test("task response loss performs two exact reads before yielding to canonical state", async ({ page }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  state.onTaskPatch = async (route) => {
    started.resolve();
    await release.promise;
    await route.abort("connectionreset");
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  const status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await status.selectOption("planned");
  await started.promise;
  const getsBeforeProof = state.taskGets;
  release.resolve();

  await expect.poll(() => state.taskGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  await expect(status).toHaveValue("active");
  await expect(status).toBeEnabled();
  await expect(page.getByText(
    "The task update response was lost and the latest server state did not confirm it. Canonical values were restored; review them and try again.",
    { exact: true },
  )).toBeVisible();
});

test("task second-read failure cannot orphan its deferred overlay", async ({ page, isMobile }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  let responseLost = false;
  let proofReads = 0;
  state.onTaskPatch = async (route) => {
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onTaskGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads === 1) {
      await fulfillJson(route, state.tasks);
      return true;
    }
    if (proofReads === 2) {
      await fulfillJson(route, { detail: "Second proof unavailable" }, 503);
      return true;
    }
    return false;
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  let status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await status.selectOption("planned");
  await started.promise;
  release.resolve();
  await expect.poll(() => proofReads).toBe(2);
  await expect(status).toHaveValue("active");
  await expect(status).toBeEnabled();

  await switchWorkspace(page, isMobile, "Optimistic Workspace", "Optimistic Lab", otherWorkspaceId);
  await switchWorkspace(page, isMobile, "Optimistic Lab", "Optimistic Workspace", workspaceId);
  status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await expect(status).toHaveValue("active");
});

test("task assistance retry clears only its exact prior mode failure", async ({ page }) => {
  const state = createState();
  state.onTaskAssist = async (route, body) => {
    if (body.mode === "blockers") {
      return fulfillJson(route, { detail: "Temporary assistance failure" }, 503);
    }
    return fulfillJson(route, {
      mode: body.mode,
      content: "Current next-action guidance",
      source_task_count: 1,
      generated_at: "2026-08-01T00:05:00.000Z",
    });
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Surface blockers" }).click();
  await expect(page.getByText(
    "Execution assistance is temporarily unavailable. Please try again in a moment.",
    { exact: true },
  )).toBeVisible();
  await page.getByRole("button", { name: "Next actions" }).click();
  await expect(page.getByText("Current next-action guidance", { exact: true })).toBeVisible();
  await expect(page.getByText(
    "Execution assistance is temporarily unavailable. Please try again in a moment.",
    { exact: true },
  )).toHaveCount(0);
});

test("task create response loss waits through a stale nonce snapshot", async ({ page }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  const staleTasks = [...state.tasks];
  let responseLost = false;
  let proofReads = 0;
  state.onTaskCreate = async (route, body, requestedWorkspaceId) => {
    state.tasks = [taskRecord({
      id: "task-response-loss",
      workspace_id: requestedWorkspaceId,
      title: body.title,
      client_nonce: body.client_nonce,
    }), ...state.tasks];
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onTaskGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads !== 1) return false;
    await fulfillJson(route, staleTasks);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Record Task" }).click();
  await page.getByPlaceholder("Operational next step").fill("Committed response-loss task");
  await page.getByRole("button", { name: "Create record" }).click();
  await started.promise;
  const getsBeforeProof = state.taskGets;
  release.resolve();

  await expect.poll(() => state.taskGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  expect(proofReads).toBe(2);
  await expect(page.getByText("Committed response-loss task", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Unable to open task. Check your connection and try again.", { exact: true })).toHaveCount(0);
});

test("task create reuses its nonce after an A-B-A workspace return", async ({ page, isMobile }) => {
  const state = createState();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const attempts: JsonRecord[] = [];
  state.onTaskCreate = async (route, body, requestedWorkspaceId) => {
    attempts.push(body);
    if (attempts.length === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
      return fulfillJson(route, { detail: "Late first attempt" }, 503);
    }
    const created = taskRecord({
      id: "task-returned-scope",
      workspace_id: requestedWorkspaceId,
      title: body.title,
      client_nonce: body.client_nonce,
    });
    state.tasks = [created, ...state.tasks];
    return fulfillJson(route, created, 201);
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  await page.getByRole("button", { name: "Record Task" }).click();
  const title = page.getByPlaceholder("Operational next step");
  await title.fill("Returned scope task");
  await page.getByRole("button", { name: "Create record" }).click();
  await firstStarted.promise;
  await expect(title).toBeDisabled();

  await switchWorkspace(page, isMobile, "Optimistic Workspace", "Optimistic Lab", otherWorkspaceId);
  await switchWorkspace(page, isMobile, "Optimistic Lab", "Optimistic Workspace", workspaceId);
  await page.getByRole("button", { name: "Record Task" }).click();
  await expect(page.getByPlaceholder("Operational next step")).toHaveValue("Returned scope task");
  await page.getByRole("button", { name: "Create record" }).click();

  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1].client_nonce).toBe(attempts[0].client_nonce);
  await expect(page.getByText("Returned scope task", { exact: true }).last()).toBeVisible();
  releaseFirst.resolve();
  await expect(page.getByText(
    "Unable to create task. Your session may have expired; refresh and try again.",
    { exact: true },
  )).toHaveCount(0);
});

test("task A-B-A return cannot overtake a pending same-resource patch", async ({ page, isMobile }) => {
  const state = createState();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let patchAttempts = 0;
  state.onTaskPatch = async (route, body, taskId) => {
    patchAttempts += 1;
    if (patchAttempts === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    const changed = taskRecord({
      id: taskId,
      ...body,
      updated_at: `2026-08-01T00:0${patchAttempts}:00.000Z`,
    });
    state.tasks = [changed];
    await fulfillJson(route, changed);
  };
  await installMutationApi(page, state);
  await page.goto("/tasks");

  let status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await status.selectOption("planned");
  await firstStarted.promise;
  await switchWorkspace(page, isMobile, "Optimistic Workspace", "Optimistic Lab", otherWorkspaceId);
  await switchWorkspace(page, isMobile, "Optimistic Lab", "Optimistic Workspace", workspaceId);

  status = page.getByRole("combobox", { name: "Status for Ship the guarded release" });
  await expect(status).toHaveValue("planned");
  await status.selectOption("review");
  await page.waitForTimeout(100);
  expect(patchAttempts).toBe(1);

  releaseFirst.resolve();
  await expect(status).toHaveValue("planned");
  await expect(status).toBeEnabled();
  await status.selectOption("review");
  await expect.poll(() => patchAttempts).toBe(2);
  await expect(status).toHaveValue("review");
});

test("initiative create remains selected when its reconciliation snapshot is stale", async ({ page, isMobile }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  state.onInitiativeCreate = async (route, body) => {
    started.resolve();
    await release.promise;
    return fulfillJson(route, initiativeRecord({
      id: "initiative-created",
      title: body.title,
      status: "draft",
      client_nonce: body.client_nonce,
    }), 201);
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");
  await revealInitiativeList(page, isMobile);

  await page.getByRole("button", { name: "Create Initiative", exact: true }).click();
  const title = page.getByPlaceholder("Investor demo");
  await title.fill("Stale snapshot initiative");
  const getsBeforeMutation = state.initiativeGets;
  await page.getByRole("button", { name: "Create initiative", exact: true }).click();
  await started.promise;
  await expect(page.getByRole("heading", { name: "Stale snapshot initiative", exact: true }).last()).toBeVisible();
  await expect(title).toBeDisabled();

  release.resolve();
  await expect.poll(() => state.initiativeGets).toBeGreaterThan(getsBeforeMutation);
  await expect(page.getByRole("heading", { name: "Stale snapshot initiative", exact: true }).last()).toBeVisible();
  await expect(title).toBeHidden();
});

test("initiative repeated timestamp-less snapshots retire the overlay with a visible warning", async ({ page }) => {
  const state = createState();
  state.initiatives = [initiativeRecord({ updated_at: null })];
  state.onInitiativePatch = async (route, body, initiativeId) => {
    return fulfillJson(route, initiativeRecord({
      id: initiativeId,
      ...body,
      updated_at: null,
    }));
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  const status = page.locator('select:has(option[value="at_risk"])').first();
  await expect(status).toHaveValue("active");
  await status.selectOption("at_risk");
  await expect(status).toHaveValue("active");
  await expect(status).toBeEnabled();
  await expect(page.getByText(
    "The initiative update was accepted, but the latest server state could not be verified. Review the current values and try again.",
    { exact: true },
  )).toBeVisible();
});

test("late initiative verification conflict stays with its original selection", async ({ page, isMobile }) => {
  const state = createState();
  state.initiatives = [
    initiativeRecord(),
    initiativeRecord({
      id: "initiative-two",
      title: "Fallback initiative",
      updated_at: "2026-07-31T23:59:00.000Z",
    }),
  ];
  const secondProofStarted = deferred();
  const releaseSecondProof = deferred();
  let patchResponded = false;
  let proofReads = 0;
  state.onInitiativePatch = async (route, body, initiativeId) => {
    patchResponded = true;
    await fulfillJson(route, initiativeRecord({
      id: initiativeId,
      ...body,
      updated_at: "2026-08-01T00:01:00.000Z",
    }));
  };
  state.onInitiativeGet = async (route, requestedWorkspaceId) => {
    if (!patchResponded || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads === 2) {
      secondProofStarted.resolve();
      await releaseSecondProof.promise;
    }
    await fulfillJson(route, state.initiatives);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  await page.locator('select:has(option[value="at_risk"])').first().selectOption("at_risk");
  await secondProofStarted.promise;
  await revealInitiativeList(page, isMobile);
  await page.getByRole("button", { name: /Fallback initiative/ }).click();
  releaseSecondProof.resolve();

  await expect(page.getByRole("heading", { name: "Fallback initiative", exact: true }).last()).toBeVisible();
  await expect(page.getByText(
    "The initiative update was accepted, but the latest server state could not be verified. Review the current values and try again.",
    { exact: true },
  )).toHaveCount(0);
});

test("initiative selection clears only the displaced resource failure", async ({ page, isMobile }) => {
  const state = createState();
  state.initiatives = [
    initiativeRecord(),
    initiativeRecord({
      id: "initiative-two",
      title: "Fallback initiative",
      updated_at: "2026-07-31T23:59:00.000Z",
    }),
  ];
  state.onInitiativePatch = async (route) => {
    await fulfillJson(route, { detail: "Temporary initiative failure" }, 503);
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  await page.locator('select:has(option[value="at_risk"])').first().selectOption("at_risk");
  const failure = page.getByText(
    "The initiative update response was lost and the latest server state did not confirm it. Canonical values were restored; review them and try again.",
    { exact: true },
  );
  await expect(failure).toBeVisible();
  await revealInitiativeList(page, isMobile);
  await page.getByRole("button", { name: /Fallback initiative/ }).click();
  await expect(page.getByRole("heading", { name: "Fallback initiative", exact: true }).last()).toBeVisible();
  await expect(failure).toHaveCount(0);
});

test("initiative assistance failure is cleared across an exact selection scope", async ({ page, isMobile }) => {
  const state = createState();
  state.initiatives = [
    initiativeRecord(),
    initiativeRecord({
      id: "initiative-two",
      title: "Fallback initiative",
      updated_at: "2026-07-31T23:59:00.000Z",
    }),
  ];
  state.onInitiativeAssist = async (route, body, initiativeId) => {
    if (initiativeId === "initiative-one") {
      return fulfillJson(route, { detail: "Temporary initiative assistance failure" }, 503);
    }
    return fulfillJson(route, {
      mode: body.mode,
      content: "Current fallback initiative guidance",
      source_task_count: 1,
      source_channel_count: 0,
      source_message_count: 0,
      generated_at: "2026-08-01T00:06:00.000Z",
    });
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  if (isMobile) await page.getByRole("button", { name: "assist", exact: true }).click();
  await page.getByRole("button", { name: "State brief" }).click();
  const failure = page.getByText(
    "Initiative assistance is temporarily unavailable. Please try again in a moment.",
    { exact: true },
  );
  await expect(failure).toBeVisible();

  await revealInitiativeList(page, isMobile);
  await page.getByRole("button", { name: /Fallback initiative/ }).click();
  if (isMobile) await page.getByRole("button", { name: "assist", exact: true }).click();
  await page.getByRole("button", { name: "State brief" }).click();
  await expect(page.getByText(
    "Current fallback initiative guidance", { exact: true },
  ).filter({ visible: true })).toBeVisible();
  await expect(failure).toHaveCount(0);
});

test("initiative selection transfers busy ownership across patch and link operations", async ({ page, isMobile }) => {
  const state = createState();
  state.initiatives = [
    initiativeRecord(),
    initiativeRecord({
      id: "initiative-two",
      title: "Fallback initiative",
      updated_at: "2026-07-31T23:59:00.000Z",
    }),
  ];
  const patchStarted = deferred();
  const releasePatch = deferred();
  const patchFinished = deferred();
  const linkStarted = deferred();
  const releaseLink = deferred();
  const linkFinished = deferred();
  state.onInitiativePatch = async (route, body, initiativeId) => {
    patchStarted.resolve();
    await releasePatch.promise;
    const changed = initiativeRecord({ id: initiativeId, ...body });
    state.initiatives = state.initiatives.map((initiative) => (
      initiative.id === initiativeId ? changed : initiative
    ));
    await fulfillJson(route, changed);
    patchFinished.resolve();
  };
  state.onInitiativeTaskAttach = async (route, initiativeId, taskId) => {
    linkStarted.resolve();
    await releaseLink.promise;
    const changed = initiativeRecord({
      id: initiativeId,
      title: "Fallback initiative",
      linked_tasks: state.tasks.filter(({ id }) => id === taskId),
    });
    state.initiatives = state.initiatives.map((initiative) => (
      initiative.id === initiativeId ? changed : initiative
    ));
    await fulfillJson(route, changed);
    linkFinished.resolve();
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  let status = page.locator('select:has(option[value="at_risk"])').first();
  await status.selectOption("at_risk");
  await patchStarted.promise;
  await expect(status).toBeDisabled();

  await revealInitiativeList(page, isMobile);
  await page.getByRole("button", { name: /Fallback initiative/ }).click();
  status = page.locator('select:has(option[value="at_risk"])').first();
  await expect(status).toBeEnabled();
  if (isMobile) await page.getByRole("button", { name: "plan", exact: true }).click();
  const taskSelector = page.locator('select:has(option:text("Attach existing task..."))').first();
  await taskSelector.selectOption("task-one");
  const linkButton = page.getByRole("button", { name: "Link Task" });
  await linkButton.click();
  await linkStarted.promise;
  await expect(linkButton).toBeDisabled();

  releasePatch.resolve();
  await patchFinished.promise;
  await expect(linkButton).toBeDisabled();

  await revealInitiativeList(page, isMobile);
  await page.getByRole("button", { name: /Guarded initiative/ }).click();
  status = page.locator('select:has(option[value="at_risk"])').first();
  await expect(status).toBeEnabled();
  releaseLink.resolve();
  await linkFinished.promise;
  await expect(status).toBeEnabled();
  expect(state.initiativeLinkPosts).toBe(1);
});

test("initiative link response loss awaits stale then exact canonical proof once", async ({ page, isMobile }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  let responseLost = false;
  let proofReads = 0;
  state.onInitiativeTaskAttach = async (route) => {
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onInitiativeGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    await fulfillJson(route, [initiativeRecord({
      linked_tasks: proofReads === 1 ? [] : [taskRecord({ initiative_id: "initiative-one" })],
    })]);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");
  if (isMobile) await page.getByRole("button", { name: "plan", exact: true }).click();

  await page.locator('select:has(option:text("Attach existing task..."))').first().selectOption("task-one");
  await page.getByRole("button", { name: "Link Task" }).click();
  await started.promise;
  const getsBeforeProof = state.initiativeGets;
  release.resolve();

  await expect.poll(() => proofReads).toBe(2);
  await expect.poll(() => state.initiativeGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  await expect(page.getByText("Ship the guarded release", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Task linked", { exact: true })).toHaveCount(1);
  await expect(page.getByText("Task attached to Guarded initiative.", { exact: true })).toHaveCount(1);
  await expect(page.getByText(
    "Unable to attach task. Check your connection and try again.", { exact: true },
  )).toHaveCount(0);
  expect(state.initiativeLinkPosts).toBe(1);
});

test("canonical initiative proof repairs selection when the current record disappears", async ({ page }) => {
  const state = createState();
  const fallback = initiativeRecord({
    id: "initiative-two",
    title: "Canonical fallback",
    updated_at: "2026-07-31T23:59:00.000Z",
  });
  state.initiatives = [initiativeRecord(), fallback];
  const started = deferred();
  const release = deferred();
  state.onInitiativePatch = async (route) => {
    state.initiatives = [fallback];
    started.resolve();
    await release.promise;
    await route.abort("connectionreset");
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  await page.locator('select:has(option[value="at_risk"])').first().selectOption("at_risk");
  await started.promise;
  const getsBeforeProof = state.initiativeGets;
  release.resolve();

  await expect.poll(() => state.initiativeGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  await expect(page.getByRole("heading", { name: "Canonical fallback", exact: true }).last()).toBeVisible();
  await expect(page.getByText(
    "The initiative update response was lost and the latest server state did not confirm it. Canonical values were restored; review them and try again.",
    { exact: true },
  )).toHaveCount(0);
});

test("initiative response loss accepts the original patch after stale then exact proofs", async ({ page }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  const staleInitiatives = [...state.initiatives];
  let responseLost = false;
  let proofReads = 0;
  state.onInitiativePatch = async (route, body, initiativeId) => {
    state.initiatives = [initiativeRecord({
      id: initiativeId,
      ...body,
      updated_at: "2026-08-01T00:01:00.000Z",
    })];
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onInitiativeGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads !== 1) return false;
    await fulfillJson(route, staleInitiatives);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  const status = page.locator('select:has(option[value="at_risk"])').first();
  await status.selectOption("at_risk");
  await started.promise;
  await expect(status).toHaveValue("at_risk");
  await expect(status).toBeDisabled();

  const getsBeforeProof = state.initiativeGets;
  release.resolve();
  await expect.poll(() => state.initiativeGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  expect(proofReads).toBe(2);
  await expect(status).toHaveValue("at_risk");
  await expect(status).toBeEnabled();
  await expect(page.getByText(
    "Unable to update initiative. Your session may have expired; refresh and try again.",
    { exact: true },
  )).toHaveCount(0);
});

test("initiative second-read failure cannot orphan its deferred overlay", async ({ page, isMobile }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  let responseLost = false;
  let proofReads = 0;
  state.onInitiativePatch = async (route) => {
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onInitiativeGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads === 1) {
      await fulfillJson(route, state.initiatives);
      return true;
    }
    if (proofReads === 2) {
      await fulfillJson(route, { detail: "Second proof unavailable" }, 503);
      return true;
    }
    return false;
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  let status = page.locator('select:has(option[value="at_risk"])').first();
  await status.selectOption("at_risk");
  await started.promise;
  release.resolve();
  await expect.poll(() => proofReads).toBe(2);
  await expect(status).toHaveValue("active");
  await expect(status).toBeEnabled();

  await switchWorkspace(page, isMobile, "Optimistic Workspace", "Optimistic Lab", otherWorkspaceId);
  await switchWorkspace(page, isMobile, "Optimistic Lab", "Optimistic Workspace", workspaceId);
  status = page.locator('select:has(option[value="at_risk"])').first();
  await expect(status).toHaveValue("active");
});

test("initiative create response loss waits through a stale nonce snapshot", async ({ page, isMobile }) => {
  const state = createState();
  const started = deferred();
  const release = deferred();
  const staleInitiatives = [...state.initiatives];
  let responseLost = false;
  let proofReads = 0;
  state.onInitiativeCreate = async (route, body) => {
    state.initiatives = [initiativeRecord({
      id: "initiative-response-loss",
      title: body.title,
      status: "draft",
      client_nonce: body.client_nonce,
    }), ...state.initiatives];
    started.resolve();
    await release.promise;
    responseLost = true;
    await route.abort("connectionreset");
  };
  state.onInitiativeGet = async (route, requestedWorkspaceId) => {
    if (!responseLost || requestedWorkspaceId !== workspaceId) return false;
    proofReads += 1;
    if (proofReads !== 1) return false;
    await fulfillJson(route, staleInitiatives);
    return true;
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");
  await revealInitiativeList(page, isMobile);

  await page.getByRole("button", { name: "Create Initiative", exact: true }).click();
  await page.getByPlaceholder("Investor demo").fill("Committed response-loss initiative");
  await page.getByRole("button", { name: "Create initiative", exact: true }).click();
  await started.promise;
  const getsBeforeProof = state.initiativeGets;
  release.resolve();

  await expect.poll(() => state.initiativeGets).toBeGreaterThanOrEqual(getsBeforeProof + 2);
  expect(proofReads).toBe(2);
  await expect(page.getByRole("heading", { name: "Committed response-loss initiative", exact: true }).last()).toBeVisible();
  await expect(page.getByText("Unable to open initiative. Check your connection and try again.", { exact: true })).toHaveCount(0);
});

test("initiative A-B-A return cannot overtake a pending same-resource patch", async ({ page, isMobile }) => {
  const state = createState();
  const firstStarted = deferred();
  const releaseFirst = deferred();
  let patchAttempts = 0;
  state.onInitiativePatch = async (route, body, initiativeId) => {
    patchAttempts += 1;
    if (patchAttempts === 1) {
      firstStarted.resolve();
      await releaseFirst.promise;
    }
    const changed = initiativeRecord({
      id: initiativeId,
      ...body,
      updated_at: `2026-08-01T00:0${patchAttempts}:00.000Z`,
    });
    state.initiatives = [changed];
    await fulfillJson(route, changed);
  };
  await installMutationApi(page, state);
  await page.goto("/initiatives");

  let status = page.locator('select:has(option[value="at_risk"])').first();
  await status.selectOption("at_risk");
  await firstStarted.promise;
  await switchWorkspace(page, isMobile, "Optimistic Workspace", "Optimistic Lab", otherWorkspaceId);
  await switchWorkspace(page, isMobile, "Optimistic Lab", "Optimistic Workspace", workspaceId);

  status = page.locator('select:has(option[value="at_risk"])').first();
  await expect(status).toHaveValue("at_risk");
  await status.selectOption("complete");
  await page.waitForTimeout(100);
  expect(patchAttempts).toBe(1);

  releaseFirst.resolve();
  await expect(status).toHaveValue("at_risk");
  await expect(status).toBeEnabled();
  await status.selectOption("complete");
  await expect.poll(() => patchAttempts).toBe(2);
  await expect(status).toHaveValue("complete");
});
