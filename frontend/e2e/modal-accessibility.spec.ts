import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const modal = frontendSource("components/ui/Modal.tsx");
const focusTrap = frontendSource("lib/use-focus-trap.ts");
const filesPage = frontendSource("app/(dashboard)/files/page.tsx");
const teamPage = frontendSource("app/(dashboard)/team/page.tsx");
const workspacePage = frontendSource("app/(dashboard)/workspace/page.tsx");
const documentSuggestions = frontendSource("components/files/DocumentDecisionSuggestionsModal.tsx");
const workspaceAccess = frontendSource("components/workspace/WorkspaceAccessPanel.tsx");

const customModalSources = [
  "components/files/ConnectorSetupModal.tsx",
  "components/conversations/TaskFromMessageModal.tsx",
  "components/conversations/DecisionFromMessageModal.tsx",
  "app/(dashboard)/team/page.tsx",
  "app/(dashboard)/workspace/page.tsx",
].map(frontendSource);

test("shared modal requires a deterministic name and exposes one dialog contract", () => {
  expect(modal).toContain("title: string;");
  expect(modal).toContain("description?: string;");
  expect(modal).toContain('role?: "dialog" | "alertdialog";');
  expect(modal).toContain("closeDisabled?: boolean;");
  expect(modal).toContain('aria-labelledby={titleId}');
  expect(modal).toContain('aria-describedby={description ? descriptionId : undefined}');
  expect(modal).toContain('tabIndex={-1}');
  expect(modal).toContain('onKeyDown={handleDialogKeyDown}');
  expect(modal).toContain('event.defaultPrevented || event.key !== "Escape" || closeDisabled');
  expect(modal).toContain('event.target === event.currentTarget');
  expect(modal).toContain("overscroll-contain");
});

test("focus trap isolates the background and restores focus after pointer dismissal", () => {
  expect(focusTrap).toContain("element.inert = true");
  expect(focusTrap).toContain('element.setAttribute("aria-hidden", "true")');
  expect(focusTrap).toContain("restoreBackground?.()");
  expect(focusTrap).toContain("window.requestAnimationFrame(() => {");
  expect(focusTrap).toContain("previouslyFocused?.isConnected");
  expect(focusTrap).toContain("previouslyFocused.focus({ preventScroll: true })");
  expect(focusTrap).toContain("(first ?? container).focus({ preventScroll: true })");
});

test("visual modal overlays use the shared semantic boundary", () => {
  for (const source of customModalSources) {
    expect(source).toContain('import { Modal } from "@/components/ui/Modal";');
    expect(source).toContain("<Modal");
    expect(source).not.toContain("<Portal>");
    expect(source).not.toContain("<DocumentPortal>");
  }

  expect(filesPage).toContain("<DocumentDecisionSuggestionsModal");
  expect(filesPage).not.toContain("DocumentPortal");
  expect(documentSuggestions).toContain('description="Review evidence-backed decision suggestions extracted from this document."');
  expect(documentSuggestions).toContain('import { Modal } from "@/components/ui/Modal";');
  expect(teamPage).toContain('role="alertdialog"');
  expect(teamPage).toContain('title="Update member role"');
  expect(teamPage).toContain('closeDisabled={Boolean(busyAction)}');
  expect(workspacePage).toContain('form="create-workspace-form"');
  expect(workspacePage).toContain('form="create-subworkspace-form"');
  expect(workspacePage).toContain("closeDisabled={creating}");
  expect(workspacePage).toContain("closeDisabled={creatingSubspace}");
  expect(workspaceAccess).toContain('role="alertdialog"');
  expect(workspaceAccess).not.toContain("<Portal>");
});
