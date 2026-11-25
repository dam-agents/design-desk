// The handoff bundle (docs/handoff.md → The bundle): from an approved request, the same files
// and design.json for any product.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleOf, acceptanceOf, specPictures, freshBundleDir, shotPath, extOf } from "../bin/desk.mjs";

const card = {
  id: "C-7", title: "Calmer header", request: { type: "idea", problem: "The header is too loud." },
  approved: { by: { email: "alice@example.com" }, at: "2026-11-06T10:00:00Z", variant: "v2", version: 3, implement: true },
  triage: { verdict: "needs-developer", can: ["Grey header"], cannot: ["Sort by spend: no such order in the data."], build: ["Send the header's count with the list."] },
  variants: [{ id: "v1", name: "Bold", asset: "A-1" }, { id: "v2", name: "Quiet", asset: "A-2", version: 3,
    elements: [{ id: "e1", name: "Header", change: "changed", how: "Grey, smaller.", selector: "header" }],
    states: [{ id: "s1", name: "Empty list", part: "Header", element: "e1", how: "No agents yet.", asset: "A-3", shot: "A-4", stories: ["u1"] }],
    stories: [{ story: "u1", met: "yes" }], reasons: [{ decision: "D-2", how: "Greys stay quiet." }] }],
  issue_brief: { stories: [{ id: "u1", text: "As an admin I see the list calmly" }] },
  spec: { asset: "A-9", acceptance: [{ given: "the agents list", when: "it opens", then: "the header is grey" }] },
  prototype: { branch: "design-desk/c7-calm", patch: "A-8", guard: { ok: true } },
};

test("the bundle carries the approved option, its states, the boundary and the acceptance criteria", () => {
  const { design, files } = bundleOf(card);
  assert.equal(design.format, "design-desk/handoff@1");
  assert.deepEqual(design.approved.option, { id: "v2", name: "Quiet", version: 3 }, "the option a person approved, not the first");
  assert.equal(design.approved.straight_to_implementation, true);
  assert.equal(design.approved.by, null, "no e-mail address in a file that may go public");
  assert.equal(design.request.problem, undefined, "the requester's raw words never reach a coding agent");
  assert.deepEqual(design.boundary.needs_developer, ["Sort by spend: no such order in the data."]);
  assert.deepEqual(design.boundary.build, ["Send the header's count with the list."], "what a developer wires reaches the bundle");
  assert.deepEqual(design.elements[0].states, ["s1"], "an element lists its states");
  assert.equal(design.states[0].shot, "shots/s1-empty-list.webp", "a shot is pushed as WebP");
  assert.deepEqual(design.stories, [{ id: "u1", text: "As an admin I see the list calmly", met: "yes" }]);
  assert.equal(design.acceptance[0].then, "the header is grey");
  assert.deepEqual(design.decisions, [{ decision: "D-2", how: "Greys stay quiet." }]);
  assert.deepEqual(files.map((f) => [f.path, f.asset]), [["spec.md", "A-9"], ["mockup.html", "A-2"], ["states/s1-empty-list.html", "A-3"], ["shots/s1-empty-list.webp", "A-4"], ["prototype.patch", "A-8"]]);
});

test("a live prototype's option and version are what the bundle carries", () => {
  const live = { ...card, live_pick: { variant: "v1", version: 2, asset: "A-11" }, approved: { ...card.approved, variant: "v1", version: 2 } };
  const { design, files } = bundleOf(live);
  assert.deepEqual(design.approved.option, { id: "v1", name: "Bold", version: 2 });
  assert.equal(files.find((f) => f.path === "mockup.html").asset, "A-11", "the page the prototype showed");
});

test("a request approved before any option bundles its spec alone", () => {
  const { design, files } = bundleOf({ id: "C-8", title: "Copy only", approved: { by: { role: "designer" } }, variants: [], spec: { asset: "A-5" } });
  assert.equal(design.approved.option, null);
  assert.equal(design.approved.by, "designer");
  assert.deepEqual(files, [{ path: "spec.md", asset: "A-5" }]);
});

test("the acceptance criteria come from the spec's own text, as a person last edited it", () => {
  const text = "# Spec\n\n## Acceptance criteria\n\n- Given the agents list, when it opens, then the header is grey.\n- **Given** no agents **when** the list opens **then** it says so\n- A loose line\n\n## Notes\n- Given x, when y, then z";
  assert.deepEqual(acceptanceOf(text), [
    { given: "the agents list", when: "it opens", then: "the header is grey" },
    { given: "no agents", when: "the list opens", then: "it says so" }]);
  assert.equal(acceptanceOf("# Spec without them"), null, "no heading: the card's list stands");
});

test("the spec's pictures are saved once and its lines point at them", async () => {
  const asked = [];
  const { text, files } = await specPictures("![Before](asset:A-12)\n![After](asset:A-13)\n![Before again](asset:A-12)", async (id) => { asked.push(id); return { contentType: "image/png", encoding: "base64", data: "iVBORw0KGgo=" }; });
  assert.deepEqual(asked, ["A-12", "A-13"], "each picture fetched once");
  assert.equal(text, "![Before](pictures/A-12.png)\n![After](pictures/A-13.png)\n![Before again](pictures/A-12.png)");
  assert.deepEqual(files.map((f) => f.name), ["pictures/A-12.png", "pictures/A-13.png"]);
});

test("with an encoder, a raster picture is saved as WebP and the spec points at the .webp; an SVG stays as it is", async () => {
  const seen = [];
  const webp = async (data, type) => { seen.push(type); return Buffer.from("RIFFxxxxWEBP"); };
  const fetch = async (id) => id === "A-12" ? { contentType: "image/png", encoding: "base64", data: "iVBORw0KGgo=" } : { contentType: "image/svg+xml", encoding: "utf8", data: "<svg/>" };
  const { text, files } = await specPictures("![Before](asset:A-12)\n![Icon](asset:A-13)", fetch, webp);
  assert.equal(text, "![Before](pictures/A-12.webp)\n![Icon](pictures/A-13.svg)");
  assert.deepEqual(seen, ["image/png"], "only the raster picture is encoded");
  assert.equal(files[0].data.toString(), "RIFFxxxxWEBP");
  assert.equal(files[1].data.toString(), "<svg/>");
});

test("the toolkit's Chromium encodes a PNG as WebP", async (t) => {
  const { chromium, req } = await import("../lib/core.mjs");
  if (!chromium()) return t.skip("no browser here");
  try { req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  const { webpEncoder, isRaster } = await import("../lib/webp.mjs");
  assert.ok(isRaster("image/png") && isRaster("image/jpeg; q=1") && !isRaster("image/svg+xml") && !isRaster("image/gif"));
  const enc = await webpEncoder();
  try {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
    const out = await enc.encode(png, "image/png");
    assert.equal(out.subarray(0, 4).toString(), "RIFF");
    assert.equal(out.subarray(8, 12).toString(), "WEBP");
  } finally { await enc.close(); }
  // The command line's success path: the picture beside itself as .webp, its path printed.
  const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "design-desk-webp-ok-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "shot.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64"));
  const r = spawnSync(process.execPath, [join(import.meta.dirname, "..", "bin", "design.mjs"), "webp", join(dir, "shot.png")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), join(dir, "shot.webp"));
  assert.equal(readFileSync(join(dir, "shot.webp")).subarray(8, 12).toString(), "WEBP");
});

test("design webp reads a picture's type from its bytes and refuses a GIF, an SVG or a non-picture before writing any", async (t) => {
  const { pictureType } = await import("../lib/webp.mjs");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
  assert.equal(pictureType(png), "image/png");
  assert.equal(pictureType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(pictureType(Buffer.from("GIF89a....")), "image/gif");
  assert.equal(pictureType(Buffer.from("<svg/>")), null);
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { spawnSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "design-desk-webp-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.png"), png);
  writeFileSync(join(dir, "moving.png"), Buffer.from("GIF89a...."));
  writeFileSync(join(dir, "icon.svg"), "<svg/>");
  const design = join(import.meta.dirname, "..", "bin", "design.mjs");
  for (const bad of ["moving.png", "icon.svg"]) {
    const r = spawnSync(process.execPath, [design, "webp", join(dir, "a.png"), join(dir, bad)], { encoding: "utf8" });
    assert.notEqual(r.status, 0, `${bad} is refused`);
    assert.match(r.stderr, new RegExp(bad.replace(".", "\\.")), "the refusal names the file");
  }
  assert.equal(existsSync(join(dir, "a.webp")), false, "nothing is written when one of them is refused");
});

test("a prototype's patch is bundled only when the card says its guard passed", () => {
  for (const guard of [undefined, { ok: false }, { ok: "true" }]) {
    const { design, files } = bundleOf({ ...card, prototype: { ...card.prototype, guard } });
    assert.equal(files.some((f) => f.path === "prototype.patch"), false, `no patch with guard ${JSON.stringify(guard)}`);
    assert.equal(design.prototype.patch, null);
    assert.equal(design.prototype.branch, "design-desk/c7-calm", "the branch is still named");
  }
});

test("a shot is WebP only when its asset is a still picture", () => {
  assert.equal(shotPath("shots/s1-x.webp", "image/png"), "shots/s1-x.webp");
  assert.equal(shotPath("shots/s1-x.webp", "image/gif"), "shots/s1-x.gif", "a GIF keeps its type");
  assert.equal(shotPath("shots/s1-x.webp", "image/svg+xml"), "shots/s1-x.svg");
  assert.deepEqual(["image/svg+xml", "image/jpeg", "image/png; x=1", "", "image/x-icon"].map(extOf), ["svg", "jpg", "png", "bin", "ico"]);
  assert.equal(shotPath("states/s1-x.html", "text/html"), "states/s1-x.html", "only a planned .webp is touched");
});

test("the bundle's directory starts empty: what a bundle writes is cleared, anything else refused", async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const root = mkdtempSync(join(tmpdir(), "design-desk-bundle-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  freshBundleDir(join(root, "missing"));
  const old = join(root, "old"); mkdirSync(join(old, "shots"), { recursive: true });
  writeFileSync(join(old, "design.json"), "{}"); writeFileSync(join(old, "shots", "stale.webp"), "x");
  freshBundleDir(old);
  assert.equal(existsSync(join(old, "shots", "stale.webp")), false, "an earlier attempt's file is gone");
  const other = join(root, "other"); mkdirSync(other); writeFileSync(join(other, "design.json"), "{}"); writeFileSync(join(other, "notes.txt"), "keep");
  assert.throws(() => freshBundleDir(other), /holds notes\.txt, which no bundle writes/);
  assert.equal(existsSync(join(other, "notes.txt")), true, "a directory holding anything else is left alone, a design.json in it or not");
  assert.equal(existsSync(join(other, "design.json")), true);
  const noBundle = join(root, "nobundle"); mkdirSync(join(noBundle, "pictures"), { recursive: true }); writeFileSync(join(noBundle, "pictures", "mine.png"), "x");
  assert.throws(() => freshBundleDir(noBundle), /holds no earlier bundle/, "bundle names alone, with no design.json, are not a bundle");
  assert.equal(existsSync(join(noBundle, "pictures", "mine.png")), true, "and are left alone");
});

test("the encoder hands back the browser's WebP, and refuses a browser that answers another format", async () => {
  const { webpEncoder } = await import("../lib/webp.mjs");
  let answer = `data:image/webp;base64,${Buffer.from("RIFF0000WEBP").toString("base64")}`, closed = 0;
  const browser = { newPage: async () => ({ evaluate: async () => answer, close: async () => { closed++; } }) };
  const enc = await webpEncoder({ browser });
  assert.equal((await enc.encode(Buffer.from("png"), "image/png")).toString(), "RIFF0000WEBP");
  answer = "data:image/png;base64,AAAA";
  await assert.rejects(enc.encode(Buffer.from("png"), "image/png"), /did not encode WebP/, "a PNG fallback is never saved as .webp");
  await enc.close();
  assert.equal(closed, 1, "its page is closed; a browser it was given stays open");
});

test("a bundle that died halfway (its placeholder design.json alone) is cleared on the next try", async (t) => {
  const { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "design-desk-half-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "shots")); writeFileSync(join(dir, "shots", "s1.webp"), "x");
  writeFileSync(join(dir, "design.json"), JSON.stringify({ format: "design-desk/handoff@1", partial: true }));
  freshBundleDir(dir);
  assert.equal(existsSync(join(dir, "shots", "s1.webp")), false);
  assert.equal(existsSync(join(dir, "design.json")), false);
});
