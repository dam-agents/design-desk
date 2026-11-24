// node --test desk/tests/mcp.test.mjs — other agents on the Desk (docs/mcp.md): the server's
// /peer/ routes admit only the peer token, only while mcp_satellite is on, only the routes they
// name and only what mcp_role may do; desk/mcp.mjs speaks MCP over stdio to them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "server.mjs"), MCP = join(HERE, "..", "mcp.mjs");
const ROSTER = "## Desk people\n\n| email | role |\n| --- | --- |\n| alice@example.com | designer |\n| bob@example.com | developer |\n";

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

async function desk(t, config) {
  const work = mkdtempSync(join(tmpdir(), "desk-mcp-"));
  writeFileSync(join(work, "CONFIG.md"), config + "\n" + ROSTER);
  mkdirSync(join(work, "desk"));
  const port = await freePort();
  const env = { ...process.env, WORK_DIR: work, DESK_DIR: join(work, "desk"), DESK_PORT: String(port) };
  const proc = spawn(process.execPath, [SERVER], { env, stdio: "ignore" });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
  const token = readFileSync(join(work, "desk", ".peer-token"), "utf8").trim();
  const peer = async (method, path, body, tok = token) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", "x-desk-peer-token": tok }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  // A person on the page, through the platform's relay: files the request a peer then reads.
  const viewer = async (email, path, body) => {
    const r = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", "x-platform-caller-role": "viewer", "x-platform-caller-email": email }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  return { peer, viewer, env, work };
}

test("the peer routes are closed while mcp_satellite is disabled, and need the peer token", async (t) => {
  const d = await desk(t, "- mcp_satellite: disabled\n");
  assert.equal((await d.peer("GET", "/peer/cards")).status, 403);
  const d2 = await desk(t, "- mcp_satellite: when-awake\n");
  assert.equal((await d2.peer("GET", "/peer/cards", null, "x".repeat(48))).status, 401);
  assert.equal((await d2.peer("GET", "/peer/cards")).status, 200);
});

test("a peer reads, asks and files requests, as one caller of mcp_role, and reaches nothing else", async (t) => {
  const d = await desk(t, "- mcp_satellite: always\n- mcp_role: developer\n");
  const made = await d.peer("POST", "/peer/requests", { title: "Busy list", problem: "The list is busy." });
  assert.equal(made.status, 201, JSON.stringify(made.body));
  const id = made.body.card.id;
  assert.equal(made.body.card.stage, undefined, "an agent's request opens, as Design Desk's own do, whatever mcp_role");
  assert.equal((await d.peer("POST", `/peer/cards/${id}/stage`, { to: "design" })).status, 404, "a peer moves no request on");
  assert.equal((await d.peer("GET", `/peer/cards/${id}`)).status, 200);
  const asked = await d.peer("POST", `/peer/cards/${id}/threads`, { kind: "question", text: "Why two columns?" });
  assert.equal(asked.status, 201);
  assert.equal((await d.peer("POST", `/peer/threads/${asked.body.thread.id}/messages`, { text: "And on a phone?" })).status, 201);
  assert.equal((await d.peer("GET", "/peer/decisions")).status, 200);
  // Votes, actions, people, private asks and the agent's routes are not a peer's.
  for (const [m, p, b] of [["POST", `/peer/cards/${id}/votes`, { variant: "v1", vote: "like" }], ["POST", `/peer/cards/${id}/actions`, { action: "approve" }],
    ["POST", "/peer/people", { email: "x@example.com", role: "admin" }], ["POST", "/peer/private", { text: "hi" }], ["GET", "/peer/me"], ["GET", "/peer/kit"]]) {
    assert.equal((await d.peer(m, p, b)).status, 404, `${m} ${p}`);
  }
  assert.equal((await d.peer("GET", "/agent/inbox")).status, 401, "the peer token is not the agent's");
});

test("mcp_role guest asks but files no request; an unknown role reads as guest", async (t) => {
  for (const role of ["guest", "admin"]) {
    const d = await desk(t, `- mcp_satellite: when-awake\n- mcp_role: ${role}\n`);
    assert.equal((await d.peer("POST", "/peer/requests", { title: "x", problem: "The list is busy." })).status, 403, role);
  }
});

test("desk/mcp.mjs answers MCP over stdio: tools, a request filed, the list read, an error as a tool error", async (t) => {
  const d = await desk(t, "- mcp_satellite: when-awake\n");
  const proc = spawn(process.execPath, [MCP], { env: d.env, stdio: ["pipe", "pipe", "ignore"] });
  t.after(() => proc.kill());
  const lines = createInterface({ input: proc.stdout })[Symbol.asyncIterator]();
  let n = 0;
  const call = async (method, params) => { const id = ++n; proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n"); const r = JSON.parse((await lines.next()).value); assert.equal(r.id, id); return r; };
  const init = await call("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } });
  assert.equal(init.result.serverInfo.name, "design-desk");
  assert.equal(init.result.serverInfo.title, "Design Desk");
  assert.equal(init.result.serverInfo.icons, undefined, "no icons for a protocol before 2025-11-25");
  proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  const tools = (await call("tools/list")).result.tools.map((x) => x.name);
  assert.deepEqual(tools, ["list_items", "read_item", "list_decisions", "read_decision", "ask", "comment", "reply", "file_request", "report_bug"]);
  const filed = await call("tools/call", { name: "file_request", arguments: { title: "Busy list", problem: "The list is busy." } });
  assert.equal(filed.result.isError, undefined, filed.result.content[0].text);
  const out = JSON.parse(filed.result.content[0].text);
  assert.match(out.item, /^R-\d+$/);
  assert.ok(out.queued?.id, "the request waits for the inbox run");
  const list = JSON.parse((await call("tools/call", { name: "list_items", arguments: { kind: "request" } })).result.content[0].text);
  assert.deepEqual(list.map((c) => c.id), [out.item]);
  const bad = await call("tools/call", { name: "read_item", arguments: { id: "../agent/inbox" } });
  assert.equal(bad.result.isError, true);
  const missing = await call("tools/call", { name: "read_item", arguments: { id: "R-999" } });
  assert.equal(missing.result.isError, true);
});

test("a long tool result stays valid JSON and names what was shortened", async () => {
  const { fit } = await import("../mcp.mjs");
  const list = Array.from({ length: 500 }, (_, i) => ({ id: `R-${i}`, summary: "x".repeat(200) }));
  const l = fit(list, 5000);
  assert.ok(JSON.stringify(l).length <= 5000);
  assert.deepEqual(l.items[0].id, "R-0");
  assert.match(l._cut, /items left out/);
  const card = { id: "R-1", title: "Busy list", threads: Array.from({ length: 50 }, (_, i) => ({ id: `t${i}`, text: "y".repeat(400) })), summary: "z".repeat(3000) };
  const c = fit(card, 6000);
  assert.ok(JSON.stringify(c).length <= 6000, String(JSON.stringify(c).length));
  assert.equal(c.id, "R-1");
  assert.equal(c.threads.at(-1).id, "t49", "a conversation keeps its newest end");
  assert.match(c._cut, /threads/);
  assert.equal(fit({ a: 1 }, 6000).a, 1, "a short result is untouched");
});

test("a peer reads a proposal, as anyone does, and none of a draft", async (t) => {
  const d = await desk(t, "- mcp_satellite: always\n- mcp_role: pm\n");
  const id = (await d.viewer("bob@example.com", "/api/requests", { problem: "Rows are too airy.", options: 0 })).body.card.id;
  assert.equal((await d.peer("GET", `/peer/cards/${id}`)).status, 404, "no draft of someone else's");
  assert.equal((await d.peer("GET", "/peer/cards")).body.cards.some((c) => c.id === id), false);
  assert.equal((await d.viewer("bob@example.com", `/api/cards/${id}/stage`, { to: "proposal" })).status, 200);
  assert.equal((await d.peer("GET", `/peer/cards/${id}`)).status, 200, "a proposal is everyone's");
});
