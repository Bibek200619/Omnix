import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function source(relativePath) {
  const absolutePath = path.join(frontendRoot, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Expected onboarding file to exist: ${relativePath}`);
  }
  return readFileSync(absolutePath, "utf8");
}

function assertIncludes(content, needle, message) {
  if (!content.includes(needle)) {
    throw new Error(`${message}\nMissing: ${needle}`);
  }
}

const appShell = source("components/layout/AppShell.tsx");
const gate = source("components/workspace/WorkspaceOnboardingGate.tsx");
const page = source("app/(dashboard)/onboarding/page.tsx");
const flow = source("components/onboarding/OnboardingFlow.tsx");

assertIncludes(appShell, "omnix.onboarding.completed", "AppShell must check the first-login onboarding key.");
assertIncludes(appShell, "router.replace(\"/onboarding\")", "Incomplete onboarding must redirect into the onboarding route.");
assertIncludes(appShell, "pathname !== \"/onboarding\"", "The onboarding route must not redirect to itself.");

assertIncludes(gate, "pathname === \"/onboarding\"", "The hard workspace gate must allow the onboarding route to render.");

assertIncludes(page, "<OnboardingFlow />", "The onboarding page must render the flow component.");

for (const label of ["Welcome", "Invite", "Upload", "Chat"]) {
  assertIncludes(flow, label, `Onboarding flow must include the ${label} step.`);
}

assertIncludes(flow, "localStorage.setItem(ONBOARDING_COMPLETED_KEY, \"true\")", "Completion must persist the onboarding key.");
assertIncludes(flow, "router.replace(\"/dashboard\")", "Completion must redirect to the dashboard.");
assertIncludes(flow, "Skip", "Every onboarding step must expose a skip path.");
