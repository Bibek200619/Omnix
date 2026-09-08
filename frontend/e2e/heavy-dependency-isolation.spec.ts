import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve } from "node:path";
import { expect, test } from "@playwright/test";

const frontendRoot = resolve(__dirname, "..");

function applicationSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if ([".next", "e2e", "e2e-live", "node_modules"].includes(entry.name)) return [];
      return applicationSources(path);
    }
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("Three.js stays behind the client-only public landing boundary", () => {
  const importers = applicationSources(frontendRoot)
    .filter((path) => /(?:from\s+["']three["']|import\(["']three["']\))/.test(readFileSync(path, "utf8")))
    .map((path) => relative(frontendRoot, path));

  expect(importers).toEqual(["components/landing/LandingHeroScene.tsx"]);

  const landing = readFileSync(resolve(frontendRoot, "components/landing/LandingExperience.tsx"), "utf8");
  expect(landing).toContain('import dynamic from "next/dynamic";');
  expect(landing).toContain('import("@/components/landing/LandingHeroScene")');
  expect(landing).toContain("ssr: false");
  expect(landing).toContain("loading: () => (");
  expect(landing).not.toContain('import { LandingHeroScene } from "@/components/landing/LandingHeroScene";');
});

test("landing primary content does not wait for the decorative scene", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Turn private knowledge into precise AI answers" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Start working free/ }).first()).toBeVisible();
});
