// node --test desk/tests/*.test.mjs — the Desk page runs in a sandboxed frame without
// allow-forms: the browser blocks a form's submission before its submit event fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "page.html"), "utf8");

test("a button in a form never submits it", () => {
  const forms = page.match(/<form\b[\s\S]*?<\/form>/g) || [];
  assert.ok(forms.length > 0, "the page has its dialog forms");
  for (const f of forms)
    for (const b of f.match(/<button\b[^>]*>/g) || [])
      assert.match(b, /\btype="button"/, `${f.match(/id="([^"]+)"/)?.[1]}: ${b}`);
});

test("no work waits on a submit event", () => {
  assert.doesNotMatch(page, /addEventListener\("submit",\s*guard\(/);
});
