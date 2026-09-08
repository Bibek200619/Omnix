import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test } from "@playwright/test";
import type { visibleRefreshRegistry } from "../lib/visible-refresh-registry";

function scheduler() {
  let now = 0;
  let timerId = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const window = Object.assign(new EventTarget(), {
    setTimeout(callback: () => void, delay: number) {
      const id = ++timerId;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const exports: { visibleRefreshRegistry?: typeof visibleRefreshRegistry } = {};
  const source = readFileSync(resolve(__dirname, "../lib/visible-refresh-registry.ts"), "utf8");
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, window, document, Date: { now: () => now }, console });

  return {
    registry: exports.visibleRefreshRegistry!,
    timers,
    focus: () => window.dispatchEvent(new Event("focus")),
    visibility(state: string) {
      document.visibilityState = state;
      document.dispatchEvent(new Event("visibilitychange"));
    },
    advance(ms: number) {
      const target = now + ms;
      let runs = 0;
      while (timers.size) {
        const [id, timer] = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (timer.at > target) break;
        if (++runs > 100) throw new Error("Scheduler did not advance");
        now = timer.at;
        timers.delete(id);
        timer.callback();
      }
      now = target;
    },
  };
}

test("nearby domain deadlines do not stop the shared scheduler", () => {
  const clock = scheduler();
  let first = 0;
  let second = 0;
  clock.registry.subscribe({ key: "first", intervalMs: 1_000, callback: () => first++ });
  clock.registry.subscribe({ key: "second", intervalMs: 1_050, callback: () => second++ });
  clock.advance(3_100);
  expect([first, second]).toEqual([3, 2]);
  expect(clock.timers.size).toBe(1);
});

test("focus and visible events coalesce but polling resumes after hiding", () => {
  const clock = scheduler();
  const calls: string[] = [];
  clock.registry.subscribe({ key: "feed", intervalMs: 1_000, callback: (reason) => calls.push(reason) });
  clock.focus();
  clock.advance(10);
  clock.visibility("visible");
  expect(calls).toEqual(["focus"]);
  clock.visibility("hidden");
  expect(clock.timers.size).toBe(0);
  clock.advance(10);
  clock.visibility("visible");
  expect(clock.timers.size).toBe(1);
  clock.advance(1_000);
  expect(calls).toEqual(["focus", "interval"]);
  clock.visibility("hidden");
  clock.advance(5_000);
  expect(calls).toHaveLength(2);
  clock.visibility("visible");
  expect(calls).toEqual(["focus", "interval", "visible"]);
});

test("old cleanup cannot remove its replacement and last cleanup detaches", () => {
  const clock = scheduler();
  let oldCalls = 0;
  let newCalls = 0;
  const oldCleanup = clock.registry.subscribe({ key: "feed", intervalMs: 1_000, callback: () => oldCalls++ });
  const newCleanup = clock.registry.subscribe({ key: "feed", intervalMs: 1_000, callback: () => newCalls++ });
  oldCleanup();
  clock.advance(1_000);
  expect([oldCalls, newCalls]).toEqual([0, 1]);
  newCleanup();
  expect(clock.timers.size).toBe(0);
  clock.focus();
  clock.visibility("visible");
  clock.advance(2_000);
  expect(newCalls).toBe(1);
});
