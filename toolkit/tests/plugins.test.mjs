// node --test toolkit/tests — plug-ins are listed by kind, and a profile's shape is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProfile } from "../bin/profile.mjs";

const design = new URL("../bin/design.mjs", import.meta.url).pathname;

test("the bundled plug-ins are listed with their kinds", () => {
  const list = JSON.parse(execFileSync(process.execPath, [design, "plugins"], { encoding: "utf8" }));
  const kinds = Object.fromEntries(list.map((p) => [p.name, p.kind]));
  assert.equal(kinds["intake-slack"], "intake");
  assert.equal(kinds["handoff-github"], "handoff");
  assert.ok(list.every((p) => p.description.length > 20 && p.source === "bundled"));
});

test("a profile check names an empty allow list and a screen that does not exist", () => {
  const root = mkdtempSync(join(tmpdir(), "dd-profile-"));
  const dir = join(root, ".design-desk", "acme");
  mkdirSync(join(root, "web"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PROFILE.md"), "# Acme\n");
  const p = { schema: "design-desk-profile/v1", product: "Acme", ui: { paths: ["web/**"] }, boundary: { allow: [] }, screens: { Home: "web/home.tsx" } };
  const failed = checkProfile(p, dir, root).filter((r) => !r.ok).map((r) => r.id);
  assert.deepEqual(failed.sort(), ["boundary.allow", "screens"]);
});
