// node --test toolkit/tests/skills.test.mjs — an action resolves to its skill, and a profile's shape is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
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

test("New request offers installed skills only, figma with Figma on, bundled words and defaults", async () => {
  const extra = mkdtempSync(join(tmpdir(), "dd-switch-"));
  for (const [dir, front] of [["acme-proto", "name: acme-proto\ndescription: >-\n  Draw options in the Acme kit. Use it for any request."], ["copy", "name: copy\ndescription: \"A product's own copy skill.\""]]) {
    mkdirSync(join(extra, dir));
    writeFileSync(join(extra, dir, "SKILL.md"), `---\n${front}\n---\n`);
  }
  const { requestSkills } = await import("../lib/actions.mjs");
  const list = "copy, impact, brand, figma, not-here, acme-proto, ../x";
  const offer = (o) => Object.fromEntries(requestSkills(list, o).map((k) => [k.name, k]));
  const bundledOnly = offer({ paths: [bundled] });
  assert.deepEqual(Object.keys(bundledOnly), ["copy", "impact", "brand"], "not installed, figma off and a bad name are not offered");
  assert.equal(bundledOnly.copy.on, true, "a default-on skill");
  assert.equal(bundledOnly.brand.on, false, "a default-off skill");
  assert.equal(bundledOnly.impact.does, "Show where else the same thing appears");
  assert.ok(offer({ paths: [bundled], figma: true }).figma, "figma with Figma on");
  const mixed = offer({ paths: [extra, bundled] });
  assert.deepEqual(mixed["acme-proto"], { name: "acme-proto", does: "Draw options in the Acme kit.", on: false }, "an unknown skill: its first sentence, off");
  assert.deepEqual(mixed.copy, { name: "copy", does: "A product's own copy skill.", on: false }, "a product's skill under a bundled name takes no bundled words");
  const link = join(mkdtempSync(join(tmpdir(), "dd-link-")), "skills");
  symlinkSync(bundled, link);
  const linked = offer({ paths: [link] });
  assert.deepEqual([linked.copy.on, linked.impact.on, linked.impact.does], [true, true, "Show where else the same thing appears"], "a linked skills root still finds the bundled skills");
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
