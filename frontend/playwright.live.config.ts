import { defineConfig, devices } from "@playwright/test";
import { resolveLiveEnvironment } from "./e2e-live/live-environment";

const live = resolveLiveEnvironment();

export default defineConfig({
  testDir: "./e2e-live",
  outputDir: "test-results-live",
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: live.baseURL,
    storageState: live.storageState,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "live-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "live-mobile-chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
