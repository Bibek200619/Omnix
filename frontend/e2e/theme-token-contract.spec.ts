import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const authVisuals = frontendSource("components/auth/OmnixAuthVisuals.tsx");
const registerForm = frontendSource("components/auth/RegisterForm.tsx");
const oauthButtons = frontendSource("components/auth/OAuthButtons.tsx");
const liveKnowledgeGraph = frontendSource("components/analytics/LiveKnowledgeGraph.tsx");
const globals = frontendSource("styles/globals.css");

test("auth text colors use theme classes instead of inline AUTH_C color styles", () => {
  for (const source of [authVisuals, registerForm, oauthButtons]) {
    expect(source).not.toContain("style={{ color: AUTH_C");
  }

  expect(registerForm).not.toContain("AUTH_C,");
  expect(oauthButtons).not.toContain("AUTH_C");
  expect(authVisuals).toContain("text-[var(--omnix-text-2)]");
  expect(authVisuals).toContain("text-[var(--omnix-text-3)]");
  expect(registerForm).toContain("text-[var(--omnix-text-2)]");
  expect(registerForm).toContain("text-[var(--omnix-text-3)]");
});

test("auth loading copy follows the shared loading typography contract", () => {
  expect(oauthButtons).toContain("Redirecting…");
  expect(oauthButtons).not.toContain('"Redirecting"');
});

test("live knowledge graph uses theme tokens for cited literal color surfaces", () => {
  expect(liveKnowledgeGraph).not.toContain("bg-[#");
  expect(liveKnowledgeGraph).not.toContain("rgba(");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-7-17-29-0-95)");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-2-9-21-0-85)");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-0-255-255-0-72)");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-155-92-255-0-58)");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-51-102-255-0-54)");
  expect(liveKnowledgeGraph).toContain("var(--omnix-rgba-255-184-0-58)");
});

test("new theme tokens are centralized in global CSS", () => {
  for (const token of [
    "--omnix-rgba-2-9-21-0-85",
    "--omnix-rgba-7-17-29-0-95",
    "--omnix-rgba-0-255-255-0-72",
    "--omnix-rgba-155-92-255-0-045",
    "--omnix-rgba-155-92-255-0-58",
    "--omnix-rgba-51-102-255-0-54",
    "--omnix-rgba-255-184-0-58",
  ]) {
    expect(globals).toContain(token);
  }
});
