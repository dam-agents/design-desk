// node --test desk/tests/server.test.mjs — the Desk server over HTTP: who may ask for a
// new person on the roster, what the agent's routes refuse, what a person's page keeps, and
// the Desk's link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "server.mjs");
const ROSTER = "## Desk people\n\n| email | role |\n| --- | --- |\n| lee@example.com | lead |\n| alice@example.com | designer |\n| pat@example.com | pm |\n| lou@example.com | Lead developer |\n| bob@example.com | developer |\n| dana@example.com | developer |\n";

const freePort = () => new Promise((ok) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => ok(port)); }); });

async function desk(t, config = "") {
  const work = mkdtempSync(join(tmpdir(), "desk-server-"));
  writeFileSync(join(work, "CONFIG.md"), config + ROSTER);
  mkdirSync(join(work, "desk"));
  const port = await freePort();
  const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, WORK_DIR: work, DESK_DIR: join(work, "desk"), DESK_PORT: String(port) }, stdio: "ignore" });
  t.after(() => proc.kill());
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`${base}/health`)).ok) break; } catch {} await new Promise((r) => setTimeout(r, 50)); }
  const token = readFileSync(join(work, "desk", ".agent-token"), "utf8").trim();
  const send = async (path, headers, body) => {
    const r = await fetch(base + path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const as = (email, role = "viewer") => ({ "x-platform-caller-role": role, "x-platform-caller-email": email });
  return {
    viewer: (email, path, body, role) => send(path, as(email, role), body),
    agent: (path, body) => send(path, { "x-desk-agent-token": token }, body),
  };
}

test("only a lead asks for a new person; the owner's ask says so; the agent cannot make one", async (t) => {
  const d = await desk(t);
  const ask = { email: "alex@example.com", role: "pm" };
  const designer = await d.viewer("alice@example.com", "/api/people", ask);
  assert.equal(designer.status, 403);
  assert.match(designer.body.error, /Only a lead can add people/);
  assert.equal((await d.viewer("guest@example.com", "/api/people", ask)).status, 403);

  const lead = await d.viewer("lee@example.com", "/api/people", ask);
  assert.equal(lead.status, 201);
  assert.deepEqual([lead.body.inbox.kind, lead.body.inbox.person, lead.body.inbox.by.owner], ["person", ask, undefined]);
  const owner = await d.viewer("own@example.com", "/api/people", { email: "dee@example.com", role: "developer" }, "owner");
  assert.equal(owner.status, 201);
  assert.equal(owner.body.inbox.by.owner, true, "the platform's owner role is recorded");

  const people = await d.viewer("alice@example.com", "/api/people");
  assert.deepEqual(people.body.asks.map((a) => a.email).sort(), ["alex@example.com", "dee@example.com"]);
  assert.deepEqual(people.body.addable, ["designer", "lead-developer", "developer", "pm"]);

  const enqueue = await d.agent("/agent/enqueue", { kind: "person", card: "C-1" });
  assert.equal(enqueue.status, 400);
  assert.match(enqueue.body.error, /only from a lead/);
});

test("a request's options start after triage only for someone who may start them; a bug asks for none", async (t) => {
  const d = await desk(t);
  const file = (email, body) => d.viewer(email, "/api/requests", { problem: "The list is busy.", ...body });
  const designer = await file("alice@example.com", { options: 4, grill: true });
  assert.equal(designer.status, 201);
  assert.deepEqual([designer.body.card.request.options, designer.body.card.request.grill, designer.body.card.request.auto], [4, true, true]);
  const pm = await file("pat@example.com", {});
  assert.deepEqual([pm.body.card.request.options, pm.body.card.request.auto], [3, false], "a pm's options wait for a designer");
  assert.equal((await file("alice@example.com", { options: 0 })).body.card.request.auto, false, "none asked for: nothing starts");
  const bug = await file("alice@example.com", { type: "bug", options: 5, grill: true });
  assert.deepEqual([bug.body.card.request.options, bug.body.card.request.grill, bug.body.card.request.auto], [0, false, false]);
  assert.equal((await file("guest@example.com", {})).status, 403, "a guest files no request");
  const pasted = await file("alice@example.com", { images: [{ contentType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }] });
  assert.deepEqual(pasted.body.card.screens.map((x) => [x.source, x.by?.email]), [["person", "alice@example.com"]], "a pasted picture is the person's: the page shows it with the request, by who added it");
});

test("drawing every state of a part is a designer's or a developer's, like redrawing an option, and carries the part", async (t) => {
  const d = await desk(t);
  const { body: { card } } = await d.viewer("alice@example.com", "/api/requests", { problem: "People miss the upload button." });
  const { body: { asset } } = await d.agent("/agent/assets", { kind: "variant", name: "v1", contentType: "text/html", data: "<button>Upload</button>", encoding: "utf8" });
  assert.equal((await d.agent("/agent/cards", { id: card.id, status: "feedback", variants: [{ id: "v1", name: "Big", asset: asset.id }] })).status, 200);
  const ask = { action: "states", note: "", variant: "v1", part: { selector: "body > button", label: "Button “Upload”" } };
  const pm = await d.viewer("pat@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(pm.status, 403);
  assert.match(pm.body.error, /Only designers can redraw options/);
  const dev = await d.viewer("bob@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(dev.status, 200, "a developer changes options too");
  assert.deepEqual([dev.body.inbox.kind, dev.body.inbox.variant, dev.body.inbox.part.label], ["states", "v1", "Button “Upload”"]);
  const again = await d.viewer("alice@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(again.status, 400, "one states item at a time per request");
});

test("a small change: only a lead developer marks it, any developer but its author approves it", async (t) => {
  const d = await desk(t);
  const filed = await d.viewer("bob@example.com", "/api/requests", { problem: "Rows are too airy.", options: 0 });
  assert.equal(filed.status, 201);
  const id = filed.body.card.id;
  assert.equal((await d.agent("/agent/cards", { id, status: "feedback", triage: { verdict: "design", reasons: ["Spacing only."] } })).status, 200);
  const approve = (email) => d.viewer(email, `/api/cards/${id}/actions`, { action: "approve" });
  const size = (email, small) => d.viewer(email, `/api/cards/${id}/size`, { small });

  const me = await d.viewer("lou@example.com", "/api/me");
  assert.deepEqual([me.body.role, me.body.can.size, me.body.can.approve, me.body.can.explore], ["lead-developer", true, false, true], "a roster role with a space reads as lead-developer");
  assert.equal((await approve("dana@example.com")).status, 403, "not a small change: a designer's");
  for (const email of ["bob@example.com", "alice@example.com", "pat@example.com", "guest@example.com"]) assert.equal((await size(email, true)).status, 403, email);

  const marked = await size("lou@example.com", true);
  assert.equal(marked.status, 200);
  assert.deepEqual([marked.body.card.size.small, marked.body.card.size.by.email], [true, "lou@example.com"]);
  const author = await approve("bob@example.com");
  assert.equal(author.status, 403);
  assert.match(author.body.error, /You filed this request/);
  assert.equal((await approve("pat@example.com")).status, 403, "a PM is no developer");
  assert.equal((await approve("guest@example.com")).status, 403);
  const ok = await approve("dana@example.com");
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.card.approved.by.email, ok.body.card.approved.small], ["dana@example.com", true]);
  assert.equal((await size("lou@example.com", false)).status, 400, "approved: the size stays");
});

test("prototype_requesters reads a role as the roster does: `Lead developer` is lead-developer", async (t) => {
  const d = await desk(t, "- prototype_requesters: designer, Lead developer\n\n");
  const build = async (email) => (await d.viewer(email, "/api/me")).body.can.build;
  assert.equal(await build("lou@example.com"), true, "a lead developer builds");
  assert.equal(await build("alice@example.com"), true);
  assert.equal(await build("bob@example.com"), false, "a developer is not listed");
});

test("a person's folded intros are kept for them alone, guests included", async (t) => {
  const d = await desk(t);
  assert.deepEqual((await d.viewer("alice@example.com", "/api/me")).body.prefs, {});
  assert.equal((await d.viewer("guest@example.com", "/api/me/prefs", { intro: "hidden" })).status, 200);
  assert.deepEqual((await d.viewer("guest@example.com", "/api/me")).body.prefs, { intro: "hidden" });
  assert.deepEqual((await d.viewer("alice@example.com", "/api/me")).body.prefs, {}, "one person's choice is theirs alone");
  assert.equal((await d.viewer("alice@example.com", "/api/me/prefs", { intro: "maybe" })).status, 400);
});

test("the page gets the Desk's share link to build an item's link from, and nothing that is not a web link", async (t) => {
  const d = await desk(t, "- desk_link: https://share.example.com/a/xY12  # the share link\n\n");
  assert.equal((await d.viewer("guest@example.com", "/api/me")).body.link, "https://share.example.com/a/xY12");
  const bad = await desk(t, "- desk_link: javascript:alert(1)\n\n");
  assert.equal((await bad.viewer("guest@example.com", "/api/me")).body.link, null);
  const unset = await desk(t);
  assert.equal((await unset.viewer("guest@example.com", "/api/me")).body.link, null);
});
