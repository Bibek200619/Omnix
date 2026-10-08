const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createRequire } = require("node:module");
const path = require("node:path");
const test = require("node:test");

// Resolve the copy used by concurrently, including any nested installation.
const runnerRequire = createRequire(require.resolve("concurrently"));
const { parse, quote } = runnerRequire("shell-quote");

for (const [name, terminator] of [
  ["LF", "\n"],
  ["CR", "\r"],
  ["Unicode line separator", "\u2028"],
  ["Unicode paragraph separator", "\u2029"],
]) {
  test(`quoting rejects ${name} after a comment token`, () => {
    // Verify rejection without executing the returned text in a shell.
    assert.throws(() => quote(["echo", "safe", { comment: "comment" }, `text${terminator}echo injected;#`]), TypeError);
  });
}

test("ordinary shell metacharacters remain literal arguments", () => {
  const args = ["echo", "space value", "a'b", 'a"b', "x;y", "$(echo unexpected)", "a&b", "", "日本語"];
  assert.deepEqual(parse(quote(args)), args);
});

test("concurrently still runs multiple commands with a quoted extra argument", () => {
  const root = path.dirname(require.resolve("concurrently/package.json"));
  const cli = path.join(root, "dist/bin/concurrently.js");
  const expected = "space & semicolon; apostrophe' quote\"";
  const command = quote([process.execPath, "-e", "process.stdout.write(process.argv[1])"]) + " {1}";
  const result = spawnSync(
    process.execPath,
    [cli, "--raw", "--passthrough-arguments", command, command, "--", expected],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, expected + expected);
});
