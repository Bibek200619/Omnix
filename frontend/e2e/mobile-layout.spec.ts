import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const rootLayout = frontendSource("app/layout.tsx");
const appShell = frontendSource("components/layout/AppShell.tsx");
const mobileDock = frontendSource("components/layout/MobileDock.tsx");
const sidebar = frontendSource("components/layout/Sidebar.tsx");
const modal = frontendSource("components/ui/Modal.tsx");
const styles = frontendSource("styles/globals.css");
const markdown = frontendSource("components/chat/MarkdownRenderer.tsx");

test("viewport metadata opts into edge-to-edge safe areas and keyboard resizing", () => {
  expect(rootLayout).toContain('viewportFit: "cover"');
  expect(rootLayout).toContain('interactiveWidget: "resizes-content"');
  expect(appShell).toContain("h-[100dvh] min-h-0 overflow-hidden");
  expect(appShell).not.toContain("min-h-[100svh]");
  expect(appShell).toContain("pb-[calc(4.25rem_+_env(safe-area-inset-bottom))]");
});

test("fixed navigation reserves every device safe-area edge", () => {
  expect(mobileDock).toContain("env(safe-area-inset-left)");
  expect(mobileDock).toContain("env(safe-area-inset-right)");
  expect(mobileDock).toContain("env(safe-area-inset-bottom)");
  expect(sidebar).toContain("pt-[max(18px,env(safe-area-inset-top))]");
  expect(sidebar).toContain("env(safe-area-inset-bottom)");
});

test("mobile dialogs keep a bounded body and safe-area-aware shell", () => {
  expect(modal).toContain("max-h-[90dvh]");
  expect(modal).toContain("overflow-y-auto overscroll-contain");
  expect(styles).toContain('padding-top: max(1rem, env(safe-area-inset-top))');
  expect(styles).toContain('padding-right: env(safe-area-inset-right)');
  expect(styles).toContain('.omnix-modal-card[role="dialog"]');
  expect(styles).toContain("overflow: hidden");
});

test("generated markdown tables scroll inside their own container", () => {
  expect(markdown).toContain("overflow-x-auto");
  expect(markdown).toContain('<table className="min-w-full');
});
