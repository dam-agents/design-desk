// node --test toolkit/tests/*.test.mjs — a capture recipe brings a page into a state before it shoots.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const design = new URL("../bin/design.mjs", import.meta.url).pathname;
const PAGE = `<!doctype html><html><body><h1>Agents</h1><button id="add">New agent</button><ul id="list"></ul>
<script>document.getElementById("add").onclick = () => { document.getElementById("list").innerHTML = "<li>Release helper</li>"; };</script></body></html>`;

test("a recipe clicks to its state, shoots both themes, and reports where a step got stuck", async (t) => {
  const server = createServer((_, res) => { res.setHeader("content-type", "text/html"); res.end(PAGE); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const dir = mkdtempSync(join(tmpdir(), "dd-capture-"));
  writeFileSync(join(dir, "recipe.json"), JSON.stringify({
    setup: [{ goto: "/agents" }],
    shots: [
      { name: "One agent", steps: [{ click: "text=New agent" }, { wait: "text=Release helper" }], themes: ["light", "dark"] },
      { name: "Missing", steps: [{ click: "text=Nowhere" }] },
      { name: "Elsewhere", steps: [{ goto: "https://example.com/" }] },
    ],
  }));
  // The page's server runs in this process, so the capture runs beside it, never blocking it.
  let out;
  try { ({ stdout: out } = await promisify(execFile)(process.execPath, [design, "capture", base, dir, "--recipe", join(dir, "recipe.json")], { timeout: 150000 })); }
  catch (e) { server.close(); if (/Chromium|browser/i.test(String(e.stderr))) return t.skip("no browser here"); throw e; }
  server.close();
  const lines = out.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.filter((l) => !l.error).map((l) => l.theme), ["light", "dark"]);
  assert.ok(existsSync(join(dir, "one-agent.jpg")) && existsSync(join(dir, "one-agent-dark.jpg")));
  assert.match(lines.find((l) => l.name === "Missing").at, /Missing step 1/);
  assert.match(lines.find((l) => l.name === "Elsewhere").error, /leaves the app/);
});
