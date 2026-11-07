// node --test toolkit/tests/figma.test.mjs — design figma reads a frame from Figma's REST API:
// links, colours, what a frame is made of and where a design sits in a file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLink, linkTo, hexOf, summarize, framesOf, get } from "../lib/figma.mjs";

const clone = (x) => JSON.parse(JSON.stringify(x));

test("a Figma link names its file and node; a branch link names the branch's file", () => {
  assert.deepEqual(parseLink("https://www.figma.com/design/AbC123/Agents-app?node-id=12-40&t=x"), { key: "AbC123", node: "12:40", url: "https://www.figma.com/design/AbC123/Agents-app?node-id=12-40&t=x" });
  assert.equal(parseLink("https://www.figma.com/file/AbC123/App").node, null);
  assert.equal(parseLink("https://www.figma.com/design/AbC123/branch/Br456/App?node-id=1-2").key, "Br456");
  assert.equal(parseLink("https://example.com/design/AbC123/App"), null);
  assert.equal(parseLink("not a link"), null);
  assert.equal(linkTo("AbC123", "12:40", "Agents app"), "https://www.figma.com/design/AbC123/Agents-app?node-id=12-40");
});

test("colours come out as hex, with the alpha only when it is not opaque", () => {
  assert.equal(hexOf({ r: 0.898, g: 0.282, b: 0.302, a: 1 }), "#E5484D");
  assert.equal(hexOf({ r: 0, g: 0, b: 0, a: 1 }, 0.5), "#00000080");
  assert.equal(hexOf(null), null);
});

const frame = {
  id: "12:40", name: "Agents list", type: "FRAME", absoluteBoundingBox: { width: 360.4, height: 640 },
  layoutMode: "VERTICAL", itemSpacing: 16, paddingTop: 24, fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [
    { id: "1", name: "Title", type: "TEXT", characters: "Agents", style: { fontFamily: "Inter", fontSize: 24, fontWeight: 500, lineHeightPx: 31.2 }, fills: [{ type: "SOLID", color: { r: 0.1, g: 0.1, b: 0.1, a: 1 } }] },
    { id: "2", name: "Row", type: "INSTANCE", componentId: "c1", cornerRadius: 6, children: [
      { id: "3", name: "Stopped dot", type: "ELLIPSE", fills: [{ type: "SOLID", color: { r: 0.898, g: 0.282, b: 0.302, a: 1 } }] },
      { id: "4", name: "Hidden", type: "TEXT", visible: false, characters: "x", style: { fontFamily: "Inter", fontSize: 12, fontWeight: 400 } },
    ] },
    { id: "5", name: "Row", type: "INSTANCE", componentId: "c1", cornerRadius: 6 },
  ],
};

test("a frame's summary: colours, type, spacing, corners and components with their uses, and a hash of it all", () => {
  const s = summarize(frame, { c1: { name: "Agent row", key: "k1" } });
  assert.deepEqual(s.size, { w: 360, h: 640 });
  assert.deepEqual(s.colors.find((c) => c.hex === "#E5484D"), { hex: "#E5484D", role: "fill", uses: 1, parts: ["Stopped dot"] });
  assert.deepEqual(s.fonts, [{ font: "Inter 24 / 500", family: "Inter", size: 24, weight: 500, line: 31, uses: 1, parts: ["Title"] }]);
  assert.deepEqual(s.spacing.map((x) => x.value).sort(), ["gap 16", "padding 24"]);
  assert.deepEqual(s.radii, [{ value: "radius 6", uses: 2, parts: ["Row"] }]);
  assert.deepEqual(s.components, [{ name: "Agent row", key: "k1", uses: 2, parts: ["Row"] }]);
  assert.deepEqual(s.texts, [{ part: "Title", text: "Agents", font: "Inter 24 / 500" }], "a hidden layer is left out");
  const again = summarize(frame, { c1: { name: "Agent row", key: "k1" } });
  assert.equal(again.hash, s.hash, "the same frame, the same hash");
  const edited = summarize({ ...frame, itemSpacing: 12 }, { c1: { name: "Agent row", key: "k1" } });
  assert.notEqual(edited.hash, s.hash, "an edit changes it");
});

test("any visible edit anywhere in the frame gives a new hash", () => {
  const base = summarize(frame).hash;
  const edits = {
    "a child moved": (f) => { f.children[1].absoluteBoundingBox = { x: 200, y: 0, width: 328, height: 34 }; },
    "a child resized": (f) => { f.children[0].absoluteBoundingBox = { x: 0, y: 0, width: 120, height: 40 }; },
    "a shadow added": (f) => { f.children[1].effects = [{ type: "DROP_SHADOW", radius: 4, visible: true }]; },
    "an opacity set": (f) => { f.children[2].opacity = 0.5; },
    "text edited past what the summary lists": (f) => { f.children[0].characters = "Agents and their status, with every reason they stopped"; },
    "a layer hidden": (f) => { f.children[2].visible = false; },
    "alignment changed": (f) => { f.primaryAxisAlignItems = "CENTER"; },
  };
  for (const [what, edit] of Object.entries(edits)) {
    const f = clone(frame);
    edit(f);
    assert.notEqual(summarize(f).hash, base, what);
  }
  assert.equal(summarize(clone(frame)).hash, base, "an unedited copy keeps it");
});

test("where a design sits in a file: frames, the frames in a section, components; filtered by words", () => {
  const file = { name: "Agents app", document: { children: [
    { name: "Screens", children: [frame, { id: "9:1", name: "Flow", type: "SECTION", children: [{ id: "9:2", name: "Settings", type: "FRAME", devStatus: { type: "READY_FOR_DEV" } }] }] },
    { name: "Archive", children: [{ id: "7:1", name: "Agents list old", type: "FRAME" }] },
  ] } };
  const all = framesOf(file, "AbC123");
  assert.deepEqual(all.map((f) => [f.page, f.section, f.name, f.ready]), [["Screens", null, "Agents list", false], ["Screens", "Flow", "Settings", true], ["Archive", null, "Agents list old", false]]);
  assert.equal(all[1].url, "https://www.figma.com/design/AbC123/Agents-app?node-id=9-2");
  assert.deepEqual(framesOf(file, "AbC123", "agents screens").map((f) => f.node), ["12:40"]);
});

test("Figma's refusals in plain words", async () => {
  const answer = (status, headers = {}) => async () => ({ status, ok: status < 400, headers: { get: (k) => headers[k] ?? null }, json: async () => ({}) });
  await assert.rejects(get("/v1/files/x", { fetchImpl: answer(403) }), /token is missing, expired/);
  await assert.rejects(get("/v1/files/x", { fetchImpl: answer(429, { "retry-after": "30" }) }), /try again in 30 seconds/);
  await assert.rejects(get("/v1/files/x", { fetchImpl: answer(404) }), /no such file or node/);
  await assert.rejects(get("/v1/files/x", { fetchImpl: answer(500) }), /Figma answered 500/, "any other failure is not taken for an answer");
  assert.deepEqual(await get("/v1/files/x", { fetchImpl: answer(200) }), {});
});

// The command over a stand-in for Figma's API (FIGMA_API): what each `design figma` command
// asks for, prints, and says when Figma refuses.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);
const design = new URL("../bin/design.mjs", import.meta.url).pathname;

async function figmaStub(t) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url, token: req.headers["x-figma-token"] || null });
    const json = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
    const u = new URL(req.url, "http://stub");
    if (u.pathname === "/v1/files/AbC123" && u.searchParams.get("depth") === "3")
      return json(200, { name: "Agents app", version: "77", lastModified: "2026-11-04T10:00:00Z", document: { children: [{ name: "Screens", children: [frame] }] } });
    if (u.pathname === "/v1/files/AbC123/components") return json(200, { meta: { components: [{ name: "Send button", node_id: "30:2", description: "Primary" }] } });
    if (u.pathname === "/v1/files/AbC123/dev_resources") return json(403, { err: "no Dev Mode" });
    if (u.pathname === "/v1/files/AbC123/nodes") return json(200, { name: "Agents app", version: "77", lastModified: "2026-11-04T10:00:00Z", nodes: { [u.searchParams.get("ids")]: { document: frame, components: { c1: { name: "Agent row" } } } } });
    if (u.pathname === "/v1/images/AbC123") return json(200, { images: { [u.searchParams.get("ids")]: `http://127.0.0.1:${server.address().port}/img/frame.png` } });
    if (u.pathname === "/img/frame.png") { res.writeHead(200, { "content-type": "image/png" }); return res.end(Buffer.from("PNGDATA")); }
    return json(404, { err: "not found" });
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  t.after(() => server.close());
  const env = { ...process.env, FIGMA_API: `http://127.0.0.1:${server.address().port}`, FIGMA_TOKEN: "test-token" };
  const figma = async (...args) => JSON.parse((await run(process.execPath, [design, "figma", ...args], { env })).stdout);
  const fails = (...args) => run(process.execPath, [design, "figma", ...args], { env }).then(() => assert.fail("it should fail"), (e) => e.stderr);
  return { seen, figma, fails };
}

const FILE = "https://www.figma.com/design/AbC123/Agents-app";
const FRAME = `${FILE}?node-id=12-40`;

test("design figma: link, frames, components (code links refused said so), frame and render over the API", async (t) => {
  const { seen, figma, fails } = await figmaStub(t);
  assert.deepEqual(await figma("link", FRAME), { key: "AbC123", node: "12:40", url: FRAME });
  const frames = await figma("frames", FILE, "--name", "agents");
  assert.deepEqual([frames.version, frames.frames.map((f) => f.name)], ["77", ["Agents list"]]);
  const comps = await figma("components", FILE);
  assert.match(comps.code_links, /^unavailable: Figma refused \(403\)/, "a refusal of the Dev Mode links is said, not taken for none");
  assert.deepEqual(comps.components.map((c) => [c.name, c.node, c.code]), [["Send button", "30:2", []]]);
  const f = await figma("frame", FRAME);
  assert.deepEqual([f.name, f.edited, f.components[0].name, f.hash], ["Agents list", "2026-11-04T10:00:00Z", "Agent row", summarize(frame, { c1: { name: "Agent row" } }).hash]);
  const out = join(mkdtempSync(join(tmpdir(), "figma-render-")), "frame.png");
  assert.deepEqual(await figma("render", FRAME, out, "--scale", "1"), { file: out, node: "12:40", scale: 1 });
  assert.equal(readFileSync(out, "utf8"), "PNGDATA");
  assert.ok(seen.some((r) => r.url.startsWith("/v1/images/AbC123?ids=12%3A40&format=png&scale=1")), "the picture asked at the scale given");
  assert.ok(seen.filter((r) => r.url.startsWith("/v1/")).every((r) => r.token === "test-token"), "the token goes with every API call");
  assert.match(await fails("frame", FILE), /names no frame/);
  assert.match(await fails("frame", "https://www.figma.com/design/Gone99/X?node-id=1-1"), /no such file or node \(404\)/);
  assert.match(await fails("link", "https://example.com/x"), /not a Figma link/);
});
