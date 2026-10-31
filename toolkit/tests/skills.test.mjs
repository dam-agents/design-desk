// node --test toolkit/tests — an action resolves to its skill, and a profile's shape is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkProfile } from "../bin/profile.mjs";

const bundled = new URL("../../.agents/skills", import.meta.url).pathname;

test("an action takes the operator's skill, then the product's, then the bundled one", async () => {
  const extra = mkdtempSync(join(tmpdir(), "dd-skills-"));
  mkdirSync(join(extra, "proto-dir"));
  writeFileSync(join(extra, "proto-dir", "SKILL.md"), "---\nname: acme-prototyper\ndescription: x\n---\n");
  process.env.DESIGN_DESK_SKILL_PATHS = `${extra}:${bundled}`;
  const { resolve } = await import("../lib/actions.mjs");
  assert.equal(resolve("options").skill, "variants");
  assert.equal(resolve("options", { profile: { options: { skill: "acme-prototyper", source: "acme/proto" } } }).skill, "acme-prototyper");
  const missing = resolve("options", { config: { options: "not-here" } });
  assert.equal(missing.skill, "variants");
  assert.match(missing.notes[0], /not-here .* not installed/);
  assert.equal(resolve("revise", { profile: { options: "acme-prototyper" } }).skill, "acme-prototyper");
  assert.equal(resolve("prototype").skill, null);
});

test("a profile check names an empty allow list, a missing screen and an unknown action", () => {
  const root = mkdtempSync(join(tmpdir(), "dd-profile-"));
  const dir = join(root, ".design-desk", "acme");
  mkdirSync(join(root, "web"), { recursive: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "PROFILE.md"), "# Acme\n");
  const p = { schema: "design-desk-profile/v1", product: "Acme", ui: { paths: ["web/**"] }, boundary: { allow: [] }, screens: { Home: "web/home.tsx" }, skills: { draw: { skill: "x" } } };
  const failed = checkProfile(p, dir, root).filter((r) => !r.ok).map((r) => r.id);
  assert.deepEqual(failed.sort(), ["boundary.allow", "screens", "skills"]);
});
