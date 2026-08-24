import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { resolveLiveEnvironment } from "../e2e-live/live-environment";

const validStorageState = JSON.stringify({
  origins: [
    {
      origin: "https://omnix.example",
      localStorage: [{ name: "omnix.supabase.auth", value: "redacted-test-session" }],
    },
  ],
});

test("live environment validation fails closed without deployment credentials", () => {
  expect(() => resolveLiveEnvironment({}, () => validStorageState)).toThrow(
    "OMNIX_E2E_BASE_URL is required",
  );
  expect(() => resolveLiveEnvironment({ OMNIX_E2E_BASE_URL: "https://omnix.example" }, () => validStorageState)).toThrow(
    "OMNIX_E2E_STORAGE_STATE is required",
  );
  expect(() => resolveLiveEnvironment({
    OMNIX_E2E_BASE_URL: "http://omnix.example",
    OMNIX_E2E_STORAGE_STATE: "state.json",
  }, () => validStorageState)).toThrow("must use HTTPS");
});

test("live environment validation binds the Supabase session to the deployment origin", () => {
  expect(() => resolveLiveEnvironment({
    OMNIX_E2E_BASE_URL: "https://other.example",
    OMNIX_E2E_STORAGE_STATE: "state.json",
  }, () => validStorageState)).toThrow("must contain omnix.supabase.auth");

  expect(resolveLiveEnvironment({
    OMNIX_E2E_BASE_URL: "https://omnix.example/",
    OMNIX_E2E_STORAGE_STATE: "state.json",
  }, () => validStorageState)).toEqual({
    baseURL: "https://omnix.example",
    storageState: "state.json",
  });
});

test("live browser lane has no development server or request mocks and stays read-only", () => {
  const root = resolve(__dirname, "..");
  const config = readFileSync(resolve(root, "playwright.live.config.ts"), "utf8");
  const liveSpec = readFileSync(resolve(root, "e2e-live/production-readonly.spec.ts"), "utf8");
  const packageJson = readFileSync(resolve(root, "package.json"), "utf8");

  expect(config).toContain('testDir: "./e2e-live"');
  expect(config).toContain("storageState: live.storageState");
  expect(config).not.toContain("webServer:");
  expect(liveSpec).not.toContain("page.route(");
  expect(liveSpec).not.toMatch(/\.click\(|\.fill\(|\.press\(/);
  expect(liveSpec).toContain('request().method() === "GET"');
  expect(packageJson).toContain('"test:e2e:live": "playwright test --config=playwright.live.config.ts"');
});
