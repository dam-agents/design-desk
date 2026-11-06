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

test("drawing every state of a part is a designer's or developer's, not a viewer's, and carries the part", async (t) => {
  const d = await desk(t);
  const { body: { card } } = await d.viewer("alice@example.com", "/api/requests", { problem: "People miss the upload button." });
  const { body: { asset } } = await d.agent("/agent/assets", { kind: "variant", name: "v1", contentType: "text/html", data: "<button>Upload</button>", encoding: "utf8" });
  assert.equal((await d.agent("/agent/cards", { id: card.id, status: "feedback", variants: [{ id: "v1", name: "Big", asset: asset.id }] })).status, 200);
  const ask = { action: "states", note: "", variant: "v1", part: { selector: "body > button", label: "Button “Upload”" } };
  const pm = await d.viewer("pat@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(pm.status, 403);
  assert.match(pm.body.error, /Only designers can redraw options/);
  assert.equal((await d.viewer("guest@example.com", `/api/cards/${card.id}/actions`, ask)).status, 403, "a viewer off the roster may not");
  const dev = await d.viewer("bob@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(dev.status, 200, "a developer changes options too");
  assert.deepEqual([dev.body.inbox.kind, dev.body.inbox.variant, dev.body.inbox.part.label], ["states", "v1", "Button “Upload”"]);
  const again = await d.viewer("alice@example.com", `/api/cards/${card.id}/actions`, ask);
  assert.equal(again.status, 400, "one states item at a time per request");
});

test("For Developers: only a lead developer moves it there, any developer but its author approves it", async (t) => {
  const d = await desk(t);
  const filed = await d.viewer("bob@example.com", "/api/requests", { problem: "Rows are too airy.", options: 0 });
  assert.equal(filed.status, 201);
  const id = filed.body.card.id;
  assert.equal((await d.agent("/agent/cards", { id, status: "feedback", triage: { verdict: "design", reasons: ["Spacing only."] } })).status, 200);
  const approve = (email) => d.viewer(email, `/api/cards/${id}/actions`, { action: "approve" });
  const size = (email, small) => d.viewer(email, `/api/cards/${id}/size`, { small });

  const me = await d.viewer("lou@example.com", "/api/me");
  assert.deepEqual([me.body.role, me.body.can.size, me.body.can.approve, me.body.can.explore], ["lead-developer", true, false, true], "a roster role with a space reads as lead-developer");
  assert.equal((await approve("dana@example.com")).status, 403, "For Designers: a designer's");
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

test("deciding straight away: a lead developer approves or decides and closes, a developer does not", async (t) => {
  const d = await desk(t);
  const filed = await d.viewer("bob@example.com", "/api/requests", { problem: "The header shouts.", options: 0 });
  const id = filed.body.card.id;
  assert.equal((await d.agent("/agent/cards", { id, triage: { verdict: "design", reasons: ["Only the look."] } })).status, 200);
  const me = await d.viewer("lou@example.com", "/api/me");
  assert.equal(me.body.can.skip, true);
  assert.equal((await d.viewer("dana@example.com", `/api/cards/${id}/actions`, { action: "approve" })).status, 403, "a developer approves only a request For Developers");
  assert.equal((await d.viewer("dana@example.com", `/api/cards/${id}/decide`, { text: "No." })).status, 403);
  assert.equal((await d.viewer("lou@example.com", `/api/cards/${id}/actions`, { action: "approve", note: "Grey header.", implement: true })).status, 400, "an idea's spec stays on the Desk: not straight to the coding agent");
  const ok = await d.viewer("lou@example.com", `/api/cards/${id}/actions`, { action: "approve", note: "Grey header." });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.inbox.kind, ok.body.card.approved.by.email, ok.body.card.approved.implement], ["handoff", "lou@example.com", undefined]);

  const other = (await d.viewer("bob@example.com", "/api/requests", { problem: "The badge is hard to see.", options: 0 })).body.card.id;
  assert.equal((await d.viewer("lou@example.com", `/api/cards/${other}/decide`, { text: "Too early." })).status, 400, "not before Design Desk checked it");
  assert.equal((await d.agent("/agent/cards", { id: other, triage: { verdict: "design", reasons: ["Only the look."] } })).status, 200);
  const decided = await d.viewer("lou@example.com", `/api/cards/${other}/decide`, { text: "Badges stay: colour is for errors only." });
  assert.equal(decided.status, 201);
  assert.deepEqual([decided.body.card.status, decided.body.inbox.kind], ["declined", "decision"]);
});

test("straight to implementation where the spec reaches GitHub: the approval and its handoff carry it", async (t) => {
  const d = await desk(t, "- handoff: issue\n\n");
  const id = (await d.viewer("bob@example.com", "/api/requests", { problem: "The header shouts.", options: 0 })).body.card.id;
  assert.equal((await d.agent("/agent/cards", { id, triage: { verdict: "design", reasons: ["Only the look."] } })).status, 200);
  const ok = await d.viewer("lou@example.com", `/api/cards/${id}/actions`, { action: "approve", note: "Grey header.", implement: true });
  assert.equal(ok.status, 200);
  assert.deepEqual([ok.body.card.approved.implement, ok.body.inbox.implement], [true, true]);
});

test("prototype_requesters reads a role as the roster does: `Lead developer` is lead-developer", async (t) => {
  const d = await desk(t, "- prototype_requesters: designer, Lead developer\n\n");
  const build = async (email) => (await d.viewer(email, "/api/me")).body.can.build;
  assert.equal(await build("lou@example.com"), true, "a lead developer builds");
  assert.equal(await build("alice@example.com"), true);
  assert.equal(await build("bob@example.com"), false, "a developer is not listed");
});

test("the page gets the Desk's share link to build an item's link from, and nothing that is not a web link", async (t) => {
  const d = await desk(t, "- desk_link: https://share.example.com/a/xY12  # the share link\n\n");
  assert.equal((await d.viewer("guest@example.com", "/api/me")).body.link, "https://share.example.com/a/xY12");
  const bad = await desk(t, "- desk_link: javascript:alert(1)\n\n");
  assert.equal((await bad.viewer("guest@example.com", "/api/me")).body.link, null);
  const unset = await desk(t);
  assert.equal((await unset.viewer("guest@example.com", "/api/me")).body.link, null);
});

test("a decision says whose it is: the design side or a developer, by the role named, the roster, or where it was decided", async (t) => {
  const d = await desk(t);
  const add = (author, origin) => d.agent("/agent/decisions", { concepts: ["rows"], text: "Rows stay roomy", author, origin });
  const ids = [];
  for (const [author, origin] of [
    [{ email: "alice@example.com" }, { kind: "slack", url: "https://acme.slack.com/x" }],
    [{ email: "lou@example.com" }, { kind: "slack", url: "https://acme.slack.com/x" }],
    [{ name: "Pat", role: "PM" }, { kind: "chat" }],
    [{ login: "dana" }, { kind: "pr", url: "https://github.com/acme/widgets/pull/4" }],
    [{ name: "Someone" }, { kind: "slack", url: "https://acme.slack.com/x" }],
  ]) { const r = await add(author, origin); assert.equal(r.status, 201, JSON.stringify(r.body)); ids.push(r.body.decision.id); }
  assert.equal((await add({ name: "X", role: "owner" }, { kind: "chat" })).status, 400, "a role the roster does not know is refused");
  const sides = Object.fromEntries((await d.viewer("alice@example.com", "/api/decisions")).body.decisions.map((x) => [x.id, x.side]));
  assert.deepEqual(ids.map((id) => sides[id]), ["design", "developer", "design", "developer", null]);
  assert.equal((await d.viewer("alice@example.com", `/api/decisions/${ids[1]}`)).body.decision.side, "developer", "one decision says it too");

  // Not the design side's: Not approved until a designer approves it; it holds meanwhile.
  const pending = async () => (await d.viewer("alice@example.com", "/api/decisions?state=unapproved")).body.decisions.map((x) => x.id).sort();
  assert.deepEqual(await pending(), [ids[1], ids[3], ids[4]].sort());
  assert.equal((await d.viewer("bob@example.com", `/api/decisions/${ids[1]}/approve`, {})).status, 403, "a developer does not approve one");
  assert.equal((await d.viewer("alice@example.com", `/api/decisions/${ids[0]}/approve`, {})).status, 400, "a designer's needs none");
  const ok = await d.viewer("alice@example.com", `/api/decisions/${ids[1]}/approve`, {});
  assert.deepEqual([ok.status, ok.body.decision.unapproved, ok.body.decision.approved.by.email], [200, false, "alice@example.com"]);
  assert.deepEqual(await pending(), [ids[3], ids[4]].sort());

  // What a check reads: by the card's concepts, or by the concepts and words asked for instead.
  const card = (await d.agent("/agent/cards", { kind: "change", title: "Rows", concepts: ["rows"], source: { repo: "acme/widgets", pr: 3 } })).body.card.id;
  const read = async (q) => (await d.agent(`/agent/cards/${card}/decision-check${q}`)).body;
  const all = await read("");
  assert.deepEqual([all.card, all.total, all.truncated, all.decisions.length], [card, 5, false, 5], "the route is not taken for the card itself");
  assert.equal((await read("?concept=prices&q=")).total, 0, "an asked concept reads instead of the card's");
  assert.equal((await read("?concept=&q=roomy%20rows")).total, 5, "words read too");
});

test("a private ask reaches only its author over the API; another viewer cannot read or act on it", async (t) => {
  const d = await desk(t);
  const card = (await d.viewer("alice@example.com", "/api/requests", { problem: "The list is busy." })).body.card;
  const asked = await d.viewer("alice@example.com", "/api/private", { text: "How do the options differ?", starter: "options", context: { card: card.id, label: "the request" } });
  assert.equal(asked.status, 201);
  const id = asked.body.thread.id;
  const mine = async (email) => (await d.viewer(email, "/api/private")).body.asks.map((x) => x.id);
  assert.deepEqual(await mine("alice@example.com"), [id]);
  assert.deepEqual(await mine("bob@example.com"), []);
  assert.deepEqual(await mine("guest@example.com"), []);
  for (const email of ["alice@example.com", "bob@example.com"])
    assert.deepEqual((await d.viewer(email, `/api/cards/${card.id}`)).body.card.threads, [], "on no card");
  assert.equal((await d.viewer("bob@example.com", "/api/cards")).body.cards.find((c) => c.id === card.id).open_threads, 0);
  for (const step of ["messages", "resolve", "reopen", "answers", "decision"])
    assert.equal((await d.viewer("lee@example.com", `/api/threads/${id}/${step}`, { text: "peek", message: 0, answers: [] })).status, 404, step);
  assert.equal((await d.viewer("lee@example.com", `/api/cards/${card.id}/work-in`, { threads: [id] })).status, 404, "nobody works a private ask in");
  assert.equal((await d.viewer("alice@example.com", `/api/cards/${card.id}/threads`, { kind: "private", text: "x" })).status, 400, "not as a card's conversation");
  assert.equal((await d.viewer("alice@example.com", `/api/cards/${card.id}`)).body.card.updated, card.updated, "the card's last-changed time does not move");
  const item = (await d.agent("/agent/inbox")).body.open.find((i) => i.thread === id);
  assert.equal(item.private, true, "the agent's item says it is private");
  assert.equal((await d.agent(`/agent/items/${item.id}`)).body.thread.id, id, "the agent reads the thread with its item");
  assert.equal((await d.agent(`/agent/threads/${id}/answer`, { text: "One is a list, one a grid." })).status, 200);
  assert.deepEqual(await mine("bob@example.com"), []);
});

test("GitHub on the Desk: only the agent writes the copy, a person reads it", async (t) => {
  const d = await desk(t);
  const rec = { key: "acme/widgets#3", kind: "issue", title: "One account", comments: [{ author: "pat", at: "2026-11-01T10:00:00Z", body: "Hi" }] };
  assert.equal((await d.viewer("lee@example.com", "/api/github", { records: [rec] })).status, 404, "a person cannot write it");
  assert.equal((await d.agent("/agent/github", { records: [rec] })).status, 200);
  assert.deepEqual((await d.viewer("alice@example.com", "/api/github?keys=acme/widgets%233")).body.records.map((x) => x.title), ["One account"]);
});

test("day or night: each person's own choice, kept on the Desk", async (t) => {
  const d = await desk(t);
  const theme = async (email) => (await d.viewer(email, "/api/me")).body.theme;
  assert.equal(await theme("alice@example.com"), null, "no choice: the system's mode");
  const saved = await d.viewer("alice@example.com", "/api/prefs", { theme: "dark" });
  assert.deepEqual([saved.status, saved.body.theme], [200, "dark"]);
  assert.equal(await theme("alice@example.com"), "dark");
  assert.equal(await theme("bob@example.com"), null, "not anyone else's");
  assert.equal((await d.viewer("bob@example.com", "/api/prefs", { theme: "sepia" })).status, 400);
  assert.equal((await d.viewer("guest@example.com", "/api/prefs", { theme: "light" })).status, 200, "a guest keeps one too");
  assert.equal((await d.viewer("alice@example.com", "/api/prefs", { theme: null })).body.theme, null, "null follows the system again");
  assert.equal(await theme("alice@example.com"), null);
});

test("simple mode: each person's own choice, kept on the Desk apart from day or night", async (t) => {
  const d = await desk(t);
  const me = async (email) => (await d.viewer(email, "/api/me")).body;
  assert.equal((await me("alice@example.com")).simple, null, "no choice: the role decides on the page");
  await d.viewer("alice@example.com", "/api/prefs", { theme: "dark" });
  const saved = await d.viewer("alice@example.com", "/api/prefs", { simple: true });
  assert.deepEqual([saved.status, saved.body.simple, saved.body.theme], [200, true, "dark"], "only the key sent changes");
  assert.deepEqual([(await me("alice@example.com")).simple, (await me("bob@example.com")).simple], [true, null], "not anyone else's");
  assert.equal((await d.viewer("alice@example.com", "/api/prefs", { theme: null })).body.simple, true, "day or night leaves it");
  assert.equal((await d.viewer("bob@example.com", "/api/prefs", { simple: "yes" })).status, 400);
  assert.equal((await d.viewer("bob@example.com", "/api/prefs", [true])).status, 400, "not an object");
  assert.equal((await d.viewer("guest@example.com", "/api/prefs", { simple: false })).body.simple, false, "a viewer may leave it");
  assert.equal((await d.viewer("alice@example.com", "/api/prefs", { simple: null })).body.simple, null, "null: the role decides again");
});

test("read and unread: the first open marks an item read for that person alone", async (t) => {
  const d = await desk(t);
  const id = (await d.viewer("alice@example.com", "/api/requests", { problem: "The list is busy." })).body.card.id;
  const read = async (email) => (await d.viewer(email, "/api/cards")).body.cards.find((c) => c.id === id).read;
  assert.deepEqual([await read("alice@example.com"), await read("bob@example.com")], [false, false], "nobody opened it yet");
  assert.equal((await d.viewer("alice@example.com", `/api/cards/${id}/read`, {})).body.read, true);
  assert.deepEqual([await read("alice@example.com"), await read("bob@example.com")], [true, false], "only for the one who opened it");
  assert.equal((await d.viewer("guest@example.com", `/api/cards/${id}/read`, {})).status, 200, "a guest reads too");
  assert.equal((await d.viewer("alice@example.com", "/api/cards/C-999/read", {})).status, 404);
});

test("team feedback: a Desk request waits for a person to ask the team, one from Slack goes on by itself", async (t) => {
  const d = await desk(t);
  const { body: { asset } } = await d.agent("/agent/assets", { kind: "variant", name: "v1", contentType: "text/html", data: "<button>Save</button>", encoding: "utf8" });
  // A redraw re-sends the option with the version the card returned.
  const draw = (id, version) => d.agent("/agent/cards", { id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [{ id: "v1", name: "Calm", asset: asset.id, ...(version ? { version } : {}) }] });

  const mine = (await d.viewer("pat@example.com", "/api/requests", { problem: "The header shouts.", options: 1 })).body.card.id;
  const triage = (await d.agent("/agent/inbox")).body.open.find((i) => i.card === mine).id;
  await d.agent(`/agent/items/${triage}/claim`, { session: "s1" }); await d.agent(`/agent/items/${triage}/done`, { session: "s1" });
  const held = await draw(mine);
  assert.deepEqual([held.body.card.status, held.body.card.team_feedback.state], ["variants", "waiting"], "drawn, kept to its people");
  assert.match((await d.viewer("pat@example.com", "/api/cards")).body.cards.find((c) => c.id === mine).attention.reasons.join(" "), /ask the team for feedback/);
  assert.equal((await d.viewer("guest@example.com", `/api/cards/${mine}/feedback`, {})).status, 403, "not a viewer's");
  const asked = await d.viewer("pat@example.com", `/api/cards/${mine}/feedback`, {});
  assert.deepEqual([asked.status, asked.body.card.status, asked.body.card.team_feedback.by.email], [200, "feedback", "pat@example.com"], "its author asks the team");
  assert.equal((await d.viewer("pat@example.com", `/api/cards/${mine}/feedback`, {})).status, 400, "once");
  assert.equal((await draw(mine, asked.body.card.variants[0].version)).body.card.status, "feedback", "a redraw after that stays with the team");

  const slack = (await d.agent("/agent/cards", { kind: "request", title: "Softer colours", origin: { channel: "slack", reporter: "Carla" } })).body.card.id;
  assert.equal((await draw(slack)).body.card.status, "feedback", "from Slack: on to the team by itself");
  const none = (await d.viewer("pat@example.com", "/api/requests", { problem: "Typo in the footer.", options: 0 })).body.card.id;
  assert.equal((await d.agent("/agent/cards", { id: none, status: "feedback", triage: { verdict: "design", reasons: ["Words only."] } })).body.card.status, "feedback", "no options to fine-tune: on by itself");
});
