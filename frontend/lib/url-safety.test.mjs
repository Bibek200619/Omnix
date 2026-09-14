import assert from "node:assert/strict";
import test from "node:test";

import { safeExternalUrl, safeLinkHref } from "./url-safety.ts";

test("safeExternalUrl allows only absolute http and https URLs", () => {
  assert.equal(safeExternalUrl("https://example.com/a?b=1"), "https://example.com/a?b=1");
  assert.equal(safeExternalUrl("http://example.com/path"), "http://example.com/path");
  assert.equal(safeExternalUrl("javascript:alert(1)"), null);
  assert.equal(safeExternalUrl("data:text/html,<script>alert(1)</script>"), null);
  assert.equal(safeExternalUrl("//example.com/path"), null);
  assert.equal(safeExternalUrl("/internal/path"), null);
});

test("safeLinkHref allows local app links and blocks executable protocols", () => {
  assert.equal(safeLinkHref("/chat?conversation=abc"), "/chat?conversation=abc");
  assert.equal(safeLinkHref("#message-1"), "#message-1");
  assert.equal(safeLinkHref("https://example.com/docs"), "https://example.com/docs");
  assert.equal(safeLinkHref(" javascript:alert(1) "), null);
  assert.equal(safeLinkHref("vbscript:msgbox(1)"), null);
  assert.equal(safeLinkHref("data:image/svg+xml,<svg onload=alert(1)>"), null);
});
