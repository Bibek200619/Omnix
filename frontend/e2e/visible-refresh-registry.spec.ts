import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function source(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf8");
}

const registry = source("lib/visible-refresh-registry.ts");
const chat = source("components/chat/useChatSync.ts");
const notifications = source("lib/workspace-notifications-context.tsx");
const collaboration = source("lib/workspace-collaboration-context.tsx");

test("network refresh domains share one visibility-aware scheduler", () => {
  expect(registry.match(/window\.addEventListener\("focus"/g)).toHaveLength(1);
  expect(registry.match(/document\.addEventListener\("visibilitychange"/g)).toHaveLength(1);
  expect(registry.match(/window\.setTimeout/g)).toHaveLength(1);
  expect(registry).toContain('document.visibilityState !== "visible"');
  expect(registry).toContain("now - this.lastReactivateAt < 100");
  expect(registry).toContain("entry.nextRunAt = now + entry.intervalMs");

  for (const consumer of [chat, notifications]) {
    expect(consumer).toContain("visibleRefreshRegistry.subscribe");
    expect(consumer).not.toContain("window.setInterval");
    expect(consumer).not.toContain('window.addEventListener("focus"');
    expect(consumer).not.toContain('document.addEventListener("visibilitychange"');
  }

  expect(collaboration).toContain('key: "collaboration-heartbeat"');
  expect(collaboration).toContain('key: "collaboration-status"');
  expect(collaboration.match(/window\.setInterval/g)).toHaveLength(1);
  expect(collaboration).not.toContain('window.addEventListener("focus"');
  expect(collaboration).not.toContain('document.addEventListener("visibilitychange"');
});
