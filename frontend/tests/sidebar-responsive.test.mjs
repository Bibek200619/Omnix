import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return readFileSync(path.join(frontendRoot, relativePath), "utf8");
}

function assertIncludes(source, needle, message) {
  if (!source.includes(needle)) {
    throw new Error(`${message}\nMissing: ${needle}`);
  }
}

const sidebar = readSource("components/layout/Sidebar.tsx");
const header = readSource("components/layout/Header.tsx");
const appShell = readSource("components/layout/AppShell.tsx");
const mobileDock = readSource("components/layout/MobileDock.tsx");

assertIncludes(header, "md:hidden", "Header hamburger must be mobile-only below the md breakpoint.");
assertIncludes(header, "md:inline-flex", "Desktop sidebar expand control must appear at md and wider.");

assertIncludes(sidebar, "md:hidden", "Sidebar backdrop and mobile close affordance must stop at md.");
assertIncludes(sidebar, "md:w-[var(--omnix-sidebar-w)]", "Sidebar desktop rail width must begin at md.");
assertIncludes(sidebar, "collapsed ? \"md:-translate-x-full\" : \"md:translate-x-0\"", "Sidebar desktop collapsed state must use md breakpoints.");
assertIncludes(sidebar, "[isOpen, onClose, pathname]", "Sidebar drawer must close when the route changes.");

assertIncludes(appShell, "md:pl-0", "App shell collapsed desktop padding must begin at md.");
assertIncludes(appShell, "md:pl-[var(--omnix-sidebar-w)]", "App shell desktop sidebar padding must begin at md.");
assertIncludes(appShell, "md:pb-0", "Main content must drop mobile dock padding at md.");

assertIncludes(mobileDock, "md:hidden", "Mobile dock must be hidden at md and wider.");
