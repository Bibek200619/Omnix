import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";

import postcss from "postcss";
import config from "../postcss.config.mjs";

const require = createRequire(import.meta.url);
const entrypoint = fileURLToPath(new URL("../styles/globals.css", import.meta.url));

test("the configured CSS pipeline compiles application utilities and theme", async () => {
  const plugins = Object.entries(config.plugins).map(([name, options]) => require(name)(options));
  const source = await readFile(entrypoint, "utf8");
  const result = await postcss(plugins).process(
    `${source}\n.build-regression { @apply bg-canvas rounded-omnix shadow-omnix-glow-xs; }`,
    { from: entrypoint },
  );

  const declarations = new Map();
  result.root.walkRules(".build-regression", (rule) => {
    rule.walkDecls((decl) => declarations.set(decl.prop, decl.value));
  });
  assert.equal(declarations.get("border-radius"), "12px");
  assert.equal(declarations.get("background-color"), "rgb(5 12 23 / var(--tw-bg-opacity, 1))");
  assert.ok(declarations.get("--tw-shadow").includes("rgba(0,255,255,0.25)"));

  let screenReaderUtility = false;
  result.root.walkRules(".sr-only", (rule) => {
    rule.walkDecls("position", (decl) => {
      if (decl.value === "absolute") screenReaderUtility = true;
    });
  });
  assert.ok(screenReaderUtility, "application accessibility utilities must be generated");
  assert.ok(!result.css.includes("@tailwind"), "Tailwind directives must be compiled");
});
