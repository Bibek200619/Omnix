import { expect, test, type Page, type Route } from "@playwright/test";

const userId = "workspace-mutation-user";
const originalName = "Acme Operations";
const otherName = "Platform Lab";
const newerSelectionName = "Research Hub";

type WorkspaceRecord = Record<string, unknown> & {
  id: string;
  name: string;
  subspaces: WorkspaceRecord[];
};

function workspace(id: string, name: string): WorkspaceRecord {
  return {
    id,
    user_id: userId,
    name,
    description: `${name} description`,
    parent_workspace_id: null,
    workspace_type: "super_workspace",
    is_global: false,
    workspace_focus: "engineering",
    ai_specialization: "engineering",
    expertise_area: null,
    ai_instructions: null,
    intelligence_preferences: { memory_enabled: true },
    current_user_role: "founder",
    member_count: 1,
    is_shared: false,
    members_preview: [],
    subspaces: [],
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
  };
}

function subspace(id: string, name: string, parentId: string): WorkspaceRecord {
  return {
    ...workspace(id, name),
    parent_workspace_id: parentId,
    workspace_type: "subworkspace",
  };
}

function findWorkspace(records: WorkspaceRecord[], workspaceId: string): WorkspaceRecord | undefined {
  for (const record of records) {
    if (record.id === workspaceId) return record;
    const nested = findWorkspace(record.subspaces, workspaceId);
    if (nested) return nested;
  }
  return undefined;
}

async function fulfillJson(route: Route, payload: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
}

function authenticatedSession(id = userId, accessToken = "workspace-mutation-token") {
  return {
    access_token: accessToken,
    refresh_token: `${accessToken}-refresh`,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: `${id}@example.com`,
      app_metadata: {},
      user_metadata: { full_name: "Mutation Tester" },
      created_at: "2026-06-20T00:00:00Z",
    },
  };
}

async function seedAuthenticatedSession(page: Page, activeWorkspaceId = "workspace-1") {
  await page.addInitScript(
    ({ session, activeWorkspaceId }) => {
      window.localStorage.setItem("omnix.supabase.auth", JSON.stringify(session));
      window.localStorage.setItem("omnix.activeWorkspaceId", activeWorkspaceId);
      window.localStorage.setItem(`omnix.activeWorkspaceId.${session.user.id}`, activeWorkspaceId);
      window.localStorage.setItem(`omnix.onboarding.completed.${session.user.id}`, "true");
    },
    {
      activeWorkspaceId,
      session: authenticatedSession(),
    },
  );
}

async function mockWorkspaceApp(
  page: Page,
  canonical: () => WorkspaceRecord[],
  mutate: (route: Route, path: string, method: string) => Promise<boolean>,
) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace(/^\/api/, "") || "/";
    const method = request.method();
    if (await mutate(route, path, method)) return;
    const workspaces = canonical();

    if (path === "/workspaces/hierarchy") return fulfillJson(route, workspaces);
    const hierarchy = path.match(/^\/workspaces\/([^/]+)\/hierarchy$/);
    if (hierarchy) return fulfillJson(route, findWorkspace(workspaces, hierarchy[1]) ?? {});
    const subspaces = path.match(/^\/workspaces\/([^/]+)\/subspaces$/);
    if (subspaces && method === "GET") {
      return fulfillJson(route, findWorkspace(workspaces, subspaces[1])?.subspaces ?? []);
    }
    if (path === "/workspaces/status") return fulfillJson(route, []);
    if (path === "/workspace-invites") return fulfillJson(route, []);
    if (path === "/profile") {
      return fulfillJson(route, {
        user_id: userId,
        email: "mutations@example.com",
        display_name: "Mutation Tester",
        username: "mutation-tester",
        phone_number: "+15551234567",
      });
    }
    const members = path.match(/^\/workspaces\/([^/]+)\/members$/);
    if (members) return fulfillJson(route, []);
    const invites = path.match(/^\/workspaces\/([^/]+)\/invites$/);
    if (invites) return fulfillJson(route, []);
    const intelligence = path.match(/^\/workspaces\/([^/]+)\/intelligence$/);
    if (intelligence) {
      const current = findWorkspace(workspaces, intelligence[1]);
      return fulfillJson(route, {
        workspace_id: intelligence[1],
        workspace_name: current?.name ?? "Workspace",
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
        scope_workspace_ids: [intelligence[1]],
        context_summary: "Mutation test context",
      });
    }
    const presence = path.match(/^\/workspaces\/([^/]+)\/presence(?:\/heartbeat)?$/);
    if (presence) return fulfillJson(route, { workspace_id: presence[1], active_count: 0 });
    const activity = path.match(/^\/workspaces\/([^/]+)\/activity$/);
    if (activity) return fulfillJson(route, []);
    const mentions = path.match(/^\/workspaces\/([^/]+)\/mentions(?:\/unread-count)?$/);
    if (mentions) return fulfillJson(route, path.endsWith("unread-count") ? { unread_count: 0 } : []);
    return fulfillJson(route, method === "GET" ? [] : {});
  });
}

async function openWorkspaceSettings(page: Page, workspaceName = originalName) {
  await page.goto("/settings/workspace", { waitUntil: "domcontentloaded" });
  const heading = page.getByRole("heading", { name: workspaceName });
  try {
    await expect(heading).toBeVisible();
  } catch {
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(heading).toBeVisible();
  }
}

async function revealWorkspaceSidebar(page: Page, isMobile: boolean) {
  if (isMobile) await page.getByRole("button", { name: "Open navigation" }).click();
}

type WorkspaceTreeContextMethod = "refreshWorkspaceTree" | "refreshWorkspaceSubspaces";

async function invokeWorkspaceTreeContext(
  page: Page,
  method: WorkspaceTreeContextMethod,
  workspaceId: string,
  pendingKey?: string,
  force = true,
) {
  await page.getByRole("heading").first().evaluate(async (node, args) => {
    type FiberNode = {
      memoizedProps?: { value?: Record<string, unknown> };
      return?: FiberNode | null;
    };
    type TestWindow = Window & { __workspaceRefreshRequests?: Record<string, Promise<unknown>> };
    const host = node as HTMLElement & Record<string, unknown>;
    const fiberKey = Object.keys(host).find((key) => key.startsWith("__reactFiber$"));
    let fiber: FiberNode | null | undefined = fiberKey ? host[fiberKey] as FiberNode : undefined;
    while (fiber) {
      const value = fiber.memoizedProps?.value;
      const refresh = value?.[args.method];
      if (typeof refresh === "function" && Array.isArray(value?.workspaces)) {
        const request = Promise.resolve(refresh(args.workspaceId, { force: args.force }));
        if (args.pendingKey) {
          const target = window as TestWindow;
          target.__workspaceRefreshRequests ??= {};
          target.__workspaceRefreshRequests[args.pendingKey] = request;
        } else await request;
        return;
      }
      fiber = fiber.return;
    }
    throw new Error("Workspace tree context was not found from the rendered React fiber.");
  }, { force, method, workspaceId, pendingKey });
}

async function awaitWorkspaceTreeContextRequest(page: Page, pendingKey: string) {
  await page.evaluate(async (key) => {
    const target = window as Window & { __workspaceRefreshRequests?: Record<string, Promise<unknown>> };
    const request = target.__workspaceRefreshRequests?.[key];
    if (!request) throw new Error(`Missing stored workspace refresh: ${key}`);
    await request;
    delete target.__workspaceRefreshRequests?.[key];
  }, pendingKey);
}

async function advanceWorkspaceAuthScope(page: Page, id: string) {
  await page.getByRole("heading").first().evaluate((node, nextUserId) => {
    type HookNode = { memoizedState?: unknown; next?: HookNode | null };
    type FiberNode = {
      memoizedState?: HookNode | null;
      return?: FiberNode | null;
    };
    const host = node as HTMLElement & Record<string, unknown>;
    const fiberKey = Object.keys(host).find((key) => key.startsWith("__reactFiber$"));
    let fiber: FiberNode | null | undefined = fiberKey ? host[fiberKey] as FiberNode : undefined;
    while (fiber) {
      let hook = fiber.memoizedState;
      while (hook) {
        const ref = hook.memoizedState as { current?: unknown } | undefined;
        const current = ref?.current;
        if (current && typeof current === "object" &&
          "userId" in current && "generation" in current &&
          typeof current.generation === "number") {
          ref.current = { userId: nextUserId, generation: current.generation + 1 };
          return;
        }
        hook = hook.next;
      }
      fiber = fiber.return;
    }
    throw new Error("Workspace auth scope ref was not found from the rendered React fiber.");
  }, id);
}

test.describe("workspace optimistic mutation lifecycle", () => {
  test.beforeEach(async ({ page }) => {
    await seedAuthenticatedSession(page);
  });

  test("shows an optimistic rename before the PATCH settles", async ({ page, isMobile }) => {
    let canonical = [workspace("workspace-1", originalName), workspace("workspace-2", otherName)];
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-1" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { name: string; description?: string | null };
        await patchGate;
        canonical = canonical.map((item) => item.id === "workspace-1" ? { ...item, ...payload } : item);
        await fulfillJson(route, canonical[0]);
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await page.getByRole("textbox", { name: "Workspace name" }).fill("Renamed Workspace");
      await page.getByRole("button", { name: "Save workspace", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Renamed Workspace" })).toBeVisible();
      await revealWorkspaceSidebar(page, isMobile);
      await expect(page.getByRole("button", { name: /Current workspace: Renamed Workspace/ })).toBeVisible();
    } finally {
      releasePatch();
    }
    await expect(page.getByText("Workspace renamed")).toBeVisible();
  });

  test("retires a successful rename projection onto a newer canonical collaborator value", async ({ page }) => {
    const requestedName = "Requested Rename";
    const collaboratorName = "Collaborator Canonical Rename";
    const canonical = [workspace("workspace-1", originalName), workspace("workspace-2", otherName)];
    let patchCompleted = false;
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/hierarchy" && method === "GET" && patchCompleted) {
        await fulfillJson(route, [workspace("workspace-1", collaboratorName), canonical[1]]);
        return true;
      }
      if (path === "/workspaces/workspace-1" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { name: string; description?: string | null };
        patchCompleted = true;
        await fulfillJson(route, { ...canonical[0], ...payload });
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    await page.getByRole("textbox", { name: "Workspace name" }).fill(requestedName);
    await page.getByRole("button", { name: "Save workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: collaboratorName })).toBeVisible();
    await expect(page.getByRole("heading", { name: requestedName })).toHaveCount(0);
    await expect(page.getByText("Workspace renamed")).toBeVisible();
  });

  test("rolls a failed rename back to the canonical workspace", async ({ page }) => {
    const canonical = [workspace("workspace-1", originalName), workspace("workspace-2", otherName)];
    let failedResponseSent = false;
    let reconciliationReads = 0;
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/hierarchy" && method === "GET" && failedResponseSent) {
        reconciliationReads += 1;
        return false;
      }
      if (path === "/workspaces/workspace-1" && method === "PATCH") {
        await patchGate;
        failedResponseSent = true;
        await fulfillJson(route, { detail: "rename failed" }, 500);
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await page.getByRole("textbox", { name: "Workspace name" }).fill("Rejected Rename");
      await page.getByRole("button", { name: "Save workspace", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Rejected Rename" })).toBeVisible();
    } finally {
      releasePatch();
    }
    await expect(page.getByRole("heading", { name: originalName })).toBeVisible();
    await expect.poll(() => reconciliationReads).toBeGreaterThan(0);
  });

  test("accepts a response-loss rename when canonical reconciliation proves the commit", async ({ page }) => {
    let canonical = [workspace("workspace-1", originalName), workspace("workspace-2", otherName)];
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-1" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { name: string; description?: string | null };
        canonical = canonical.map((item) => item.id === "workspace-1" ? { ...item, ...payload } : item);
        await fulfillJson(route, { detail: "response lost after commit" }, 500);
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    await page.getByRole("textbox", { name: "Workspace name" }).fill("Committed Rename");
    await page.getByRole("button", { name: "Save workspace", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Committed Rename" })).toBeVisible();
    await expect(page.getByText("Workspace renamed")).toBeVisible();
    await expect(page.getByText("Unable to update workspace.")).toHaveCount(0);
  });

  test("tree and subspace refreshes preserve a pending optimistic subspace rename", async ({ page }) => {
    const childName = "Incident Response";
    const renamedChild = "Incident Command";
    let canonical = [{
      ...workspace("workspace-1", originalName),
      subspaces: [subspace("workspace-child", childName, "workspace-1")],
    }];
    let releasePatch!: () => void;
    const patchGate = new Promise<void>((resolve) => { releasePatch = resolve; });
    await seedAuthenticatedSession(page, "workspace-child");
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-child" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { name: string; description?: string | null };
        await patchGate;
        const child = { ...canonical[0].subspaces[0], ...payload };
        canonical = [{ ...canonical[0], subspaces: [child] }];
        await fulfillJson(route, child);
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page, childName);

    try {
      await page.getByRole("textbox", { name: "Workspace name" }).fill(renamedChild);
      await page.getByRole("button", { name: "Save workspace", exact: true }).click();
      await expect(page.getByRole("heading", { name: renamedChild })).toBeVisible();
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1");
      await expect(page.getByRole("heading", { name: renamedChild })).toBeVisible();
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceSubspaces", "workspace-1");
      await expect(page.getByRole("heading", { name: renamedChild })).toBeVisible();
    } finally {
      releasePatch();
    }
    await expect(page.getByText("Workspace renamed")).toBeVisible();
  });

  test("tree and subspace refreshes cannot resurrect a pending optimistic subspace delete", async ({ page }) => {
    const childName = "Disposable Workspace";
    let canonical = [{
      ...workspace("workspace-1", originalName),
      subspaces: [subspace("workspace-child", childName, "workspace-1")],
    }];
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    await seedAuthenticatedSession(page, "workspace-child");
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-child" && method === "DELETE") {
        await deleteGate;
        canonical = [{ ...canonical[0], subspaces: [] }];
        await fulfillJson(route, {});
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page, childName);

    try {
      await page.getByRole("button", { name: "Delete workspace" }).click();
      await page.getByRole("dialog", { name: "Delete workspace" })
        .getByRole("button", { name: "Delete workspace" }).click();
      await expect(page.getByRole("heading", { name: originalName })).toBeVisible();
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1");
      await expect(page.getByText(childName, { exact: true })).toHaveCount(0);
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceSubspaces", "workspace-1");
      await expect(page.getByText(childName, { exact: true })).toHaveCount(0);
    } finally {
      releaseDelete();
    }
    await expect(page.getByText("Workspace deleted")).toBeVisible();
  });

  test("auth-generation ABA rejects a late tree refresh without releasing the replacement request", async ({ page }) => {
    const canonical = [workspace("workspace-1", originalName)];
    let partialReads = 0;
    let releaseLate!: () => void;
    let releaseReplacement!: () => void;
    const lateGate = new Promise<void>((resolve) => { releaseLate = resolve; });
    const replacementGate = new Promise<void>((resolve) => { releaseReplacement = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-1/hierarchy" && method === "GET") {
        partialReads += 1;
        if (partialReads === 1) {
          await lateGate;
          await fulfillJson(route, workspace("workspace-1", "Late A Workspace"));
        } else {
          await replacementGate;
          await fulfillJson(route, workspace("workspace-1", "A2 Fresh Workspace"));
        }
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "late-a");
      await expect.poll(() => partialReads).toBe(1);
      await advanceWorkspaceAuthScope(page, "workspace-user-b");
      await advanceWorkspaceAuthScope(page, userId);
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "replacement-a");
      await expect.poll(() => partialReads).toBe(2);

      releaseLate();
      await awaitWorkspaceTreeContextRequest(page, "late-a");
      await expect(page.getByRole("heading", { name: originalName })).toBeVisible();
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "duplicate-a", false);
      await page.waitForTimeout(100);
      expect(partialReads).toBe(2);

      releaseReplacement();
      await awaitWorkspaceTreeContextRequest(page, "replacement-a");
      await awaitWorkspaceTreeContextRequest(page, "duplicate-a");
      await expect(page.getByRole("heading", { name: "A2 Fresh Workspace" })).toBeVisible();
      expect(partialReads).toBe(2);
    } finally {
      releaseLate();
      releaseReplacement();
    }
  });

  test("a forced same-scope tree refresh replaces a pending snapshot exactly once", async ({ page }) => {
    const canonical = [workspace("workspace-1", originalName)];
    let partialReads = 0;
    let releaseOld!: () => void;
    let releaseForced!: () => void;
    const oldGate = new Promise<void>((resolve) => { releaseOld = resolve; });
    const forcedGate = new Promise<void>((resolve) => { releaseForced = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-1/hierarchy" && method === "GET") {
        partialReads += 1;
        if (partialReads === 1) {
          await oldGate;
          await fulfillJson(route, workspace("workspace-1", "Pre-create Snapshot"));
        } else {
          await forcedGate;
          await fulfillJson(route, workspace("workspace-1", "Forced Canonical Snapshot"));
        }
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "pre-create", false);
      await expect.poll(() => partialReads).toBe(1);
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "forced");
      await expect.poll(() => partialReads).toBe(2);
      await invokeWorkspaceTreeContext(page, "refreshWorkspaceTree", "workspace-1", "forced-duplicate", false);
      await page.waitForTimeout(100);
      expect(partialReads).toBe(2);

      releaseOld();
      await awaitWorkspaceTreeContextRequest(page, "pre-create");
      await expect(page.getByRole("heading", { name: originalName })).toBeVisible();
      releaseForced();
      await awaitWorkspaceTreeContextRequest(page, "forced");
      await awaitWorkspaceTreeContextRequest(page, "forced-duplicate");
      await expect(page.getByRole("heading", { name: "Forced Canonical Snapshot" })).toBeVisible();
    } finally {
      releaseOld();
      releaseForced();
    }
  });

  test("an unrelated rename refresh cannot resurrect a pending optimistic delete", async ({ page, isMobile }) => {
    let canonical = [workspace("workspace-1", originalName), workspace("workspace-2", otherName)];
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/workspace-1" && method === "DELETE") {
        await deleteGate;
        canonical = canonical.filter((item) => item.id !== "workspace-1");
        await fulfillJson(route, {});
        return true;
      }
      if (path === "/workspaces/workspace-2" && method === "PATCH") {
        const payload = route.request().postDataJSON() as { name: string; description?: string | null };
        canonical = canonical.map((item) => item.id === "workspace-2" ? { ...item, ...payload } : item);
        await fulfillJson(route, canonical.find((item) => item.id === "workspace-2"));
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await page.getByRole("button", { name: "Delete workspace" }).click();
      await page.getByRole("dialog", { name: "Delete workspace" })
        .getByRole("button", { name: "Delete workspace" }).click();
      await expect(page.getByRole("heading", { name: otherName })).toBeVisible();
      await page.getByRole("textbox", { name: "Workspace name" }).fill("Renamed Platform");
      await page.getByRole("button", { name: "Save workspace", exact: true }).click();
      await expect(page.getByText("Workspace renamed")).toBeVisible();
      await revealWorkspaceSidebar(page, isMobile);
      await page.getByRole("button", { name: /Current workspace: Renamed Platform/ }).click();
      await expect(page.getByRole("button", { name: `Switch to ${originalName}` })).toHaveCount(0);
    } finally {
      releaseDelete();
    }
    await expect(page.getByRole("heading", { name: "Renamed Platform" })).toBeVisible();
  });

  test("delete rollback preserves fallback-other-fallback selection ownership", async ({ page, isMobile }) => {
    const canonical = [
      workspace("workspace-1", originalName),
      workspace("workspace-2", otherName),
      workspace("workspace-3", newerSelectionName),
    ];
    let failedResponseSent = false;
    let reconciliationReads = 0;
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });
    await mockWorkspaceApp(page, () => canonical, async (route, path, method) => {
      if (path === "/workspaces/hierarchy" && method === "GET" && failedResponseSent) {
        reconciliationReads += 1;
        return false;
      }
      if (path === "/workspaces/workspace-1" && method === "DELETE") {
        await deleteGate;
        failedResponseSent = true;
        await fulfillJson(route, { detail: "delete failed" }, 500);
        return true;
      }
      return false;
    });
    await openWorkspaceSettings(page);

    try {
      await page.getByRole("button", { name: "Delete workspace" }).click();
      const confirmation = page.getByRole("dialog", { name: "Delete workspace" });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole("button", { name: "Delete workspace" }).click();
      await revealWorkspaceSidebar(page, isMobile);
      await expect(page.getByRole("button", { name: /Current workspace: Platform Lab/ })).toBeVisible();
      await page.getByRole("button", { name: /Current workspace: Platform Lab/ }).click();
      await page.getByRole("button", { name: `Switch to ${newerSelectionName}` }).click();
      await revealWorkspaceSidebar(page, isMobile);
      await page.getByRole("button", { name: /Current workspace: Research Hub/ }).click();
      await page.getByRole("button", { name: `Switch to ${otherName}` }).click();
    } finally {
      releaseDelete();
    }
    await revealWorkspaceSidebar(page, isMobile);
    await expect(page.getByRole("button", { name: /Current workspace: Platform Lab/ })).toBeVisible();
    await expect.poll(() => reconciliationReads).toBeGreaterThan(0);
    expect(await page.evaluate(() => localStorage.getItem(`omnix.activeWorkspaceId.${"workspace-mutation-user"}`))).toBe("workspace-2");
  });
});
