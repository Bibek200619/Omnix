import { expect, test, type Request } from "@playwright/test";

const hierarchyPath = /\/api\/workspaces\/hierarchy(?:\?|$)/;
const tasksPath = /\/api\/workspaces\/[^/]+\/tasks(?:\?|$)/;

function safeRequestContract(request: Request) {
  const headers = request.headers();
  return {
    hasBearerToken: /^Bearer\s+\S+$/.test(headers.authorization ?? ""),
    hasWorkspaceScope: Boolean(headers["x-omnix-workspace"]?.trim()),
    method: request.method(),
  };
}

test("authenticated deployment reads workspace data through the real API", async ({ page }) => {
  const hierarchyResponsePromise = page.waitForResponse((response) => (
    hierarchyPath.test(response.url()) && response.request().method() === "GET"
  ));
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const hierarchyResponse = await hierarchyResponsePromise;

  expect(hierarchyResponse.status()).toBe(200);
  expect(safeRequestContract(hierarchyResponse.request())).toMatchObject({
    hasBearerToken: true,
    method: "GET",
  });
  const hierarchy = await hierarchyResponse.json();
  expect(Array.isArray(hierarchy)).toBe(true);
  expect(hierarchy.length).toBeGreaterThan(0);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.locator("#main-content")).toBeVisible();

  const tasksResponsePromise = page.waitForResponse((response) => (
    tasksPath.test(response.url()) && response.request().method() === "GET"
  ));
  await page.goto("/tasks", { waitUntil: "domcontentloaded" });
  const tasksResponse = await tasksResponsePromise;

  expect(tasksResponse.status()).toBe(200);
  expect(safeRequestContract(tasksResponse.request())).toEqual({
    hasBearerToken: true,
    hasWorkspaceScope: true,
    method: "GET",
  });
  expect(Array.isArray(await tasksResponse.json())).toBe(true);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
  await expect(page.getByRole("heading", { name: "Execution" })).toBeVisible();
});
