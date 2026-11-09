// node --test toolkit/tests/skills.test.mjs — an action resolves to its skill, and a profile's shape is checked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  const pinned = { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } };
  assert.equal(resolve("options", { config: pinned, profile: { options: { skill: "acme-prototyper", source: "acme/proto" } } }).skill, "acme-prototyper");
  const missing = resolve("options", { config: { options: "not-here" } });
  assert.equal(missing.skill, "variants");
  assert.match(missing.notes[0], /not-here .* not installed/);
  const acme = { options: { skill: "acme-prototyper", source: "acme/proto" } };
  assert.equal(resolve("revise", { config: pinned, profile: acme }).skill, "acme-prototyper");
  assert.equal(resolve("states").skill, "variants", "every state of a part is drawn by the variants skill");
  assert.equal(resolve("states", { config: pinned, profile: acme }).skill, "acme-prototyper", "and by the product's own confirmed options skill");
  assert.equal(resolve("prototype").skill, null);
});

test("a profile's skill does an action only while the operator's pin matches its source", async () => {
  const extra = mkdtempSync(join(tmpdir(), "dd-pin-"));
  mkdirSync(join(extra, "acme-prototyper"));
  writeFileSync(join(extra, "acme-prototyper", "SKILL.md"), "---\nname: acme-prototyper\ndescription: x\n---\n");
  process.env.DESIGN_DESK_SKILL_PATHS = `${extra}:${bundled}`;
  const { resolve, pinMatches } = await import("../lib/actions.mjs");
  const acme = { options: { skill: "acme-prototyper", source: "acme/proto" } };
  const unpinned = resolve("options", { profile: acme });
  assert.deepEqual([unpinned.skill, unpinned.source], ["variants", "default"], "installed but not confirmed: the bundled skill");
  assert.match(unpinned.notes[0], /acme-prototyper \(profile\) is not confirmed/);
  const moved = resolve("options", { config: { options: { skill: "acme-prototyper", source: "evil/proto@0123abcd" } }, profile: acme });
  assert.equal(moved.skill, "variants", "a pin to another repository is set aside");
  assert.match(moved.notes[0], /pinned to evil\/proto@0123abcd, which does not match/);
  const bumped = resolve("options", { config: { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } }, profile: { options: { skill: "acme-prototyper", source: "acme/proto@fedc9876" } } });
  assert.equal(bumped.skill, "variants", "a profile that names another commit needs a new confirmation");
  const blind = resolve("options", { config: { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } } });
  assert.equal(blind.skill, "variants", "a pinned row with no profile read is not checked, so not used");
  assert.match(blind.notes[0], /no profile read here names \(pass --repo\)/);
  const ok = resolve("options", { config: { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } }, profile: { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } } });
  assert.deepEqual([ok.skill, ok.notes], ["acme-prototyper", []], "a matching pin");
  const own = resolve("options", { config: { options: "acme-prototyper" }, profile: acme });
  assert.deepEqual([own.skill, own.source, own.notes], ["acme-prototyper", "config", []], "an unpinned row is the operator's own override, with no note");
  const other = resolve("options", { config: { options: { skill: "acme-other", source: "acme/proto@0123abcd" } }, profile: { options: { skill: "acme-prototyper", source: "acme/proto@0123abcd" } } });
  assert.deepEqual([other.skill, other.source], ["variants", "default"], "a pin on another skill confirms nothing, even with the same source");
  assert.match(other.notes[0], /acme-other \(config\) is pinned to acme\/proto@0123abcd, which does not match/);
  assert.match(other.notes[1], /acme-prototyper \(profile\) is not confirmed/);
  assert.equal(pinMatches("acme/proto", "acme/proto"), false, "a pin without a commit matches nothing");
  assert.equal(pinMatches("Acme/Proto@0123ABCD", "acme/proto"), true);
});

test("design skill reads the source pin of a ## Skills row", () => {
  const extra = mkdtempSync(join(tmpdir(), "dd-cli-"));
  mkdirSync(join(extra, "acme-prototyper"));
  writeFileSync(join(extra, "acme-prototyper", "SKILL.md"), "---\nname: acme-prototyper\ndescription: x\n---\n");
  const design = new URL("../bin/design.mjs", import.meta.url).pathname;
  const ask = (row) => {
    const work = mkdtempSync(join(tmpdir(), "dd-cli-work-"));
    writeFileSync(join(work, "CONFIG.md"), `# Config\n\n## Skills\n\n| action | skill | source |\n| --- | --- | --- |\n| options | acme-prototyper | ${row} |\n`);
    const r = spawnSync(process.execPath, [design, "skill", "options"], { encoding: "utf8", env: { ...process.env, WORK_DIR: work, DESIGN_DESK_SKILL_PATHS: `${extra}:${bundled}` } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const pinned = ask("acme/proto@0123abcd");
  assert.deepEqual([pinned.skill, pinned.source], ["variants", "default"], "a pinned row with no profile read is set aside");
  assert.match(pinned.notes[0], /pinned to acme\/proto@0123abcd/);
  const own = ask("");
  assert.deepEqual([own.skill, own.source, own.notes], ["acme-prototyper", "config", []], "an unpinned row is the operator's own override");
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
