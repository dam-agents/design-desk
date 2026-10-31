#!/usr/bin/env node
// The Desk server: the Artifact API of the Desk page. A Login item starts it at every
// boot (kit.yaml → startupItems); supervise-daemon restarts it when it exits.
//
// Two kinds of caller, told apart by what they cannot forge:
//   - the platform relay, which sets x-platform-caller-role/-email/-sub on every
//     request from the Desk page (the page itself cannot set headers);
//   - the agent's own CLI (`design desk …`), which sends the token in
//     work/desk/.agent-token (mode 600) on the /agent/ routes.
// It listens on loopback only. Viewer text is stored as data and never executed.
import { createServer } from "node:http";
import { existsSync, readFileSync, writeFileSync, mkdirSync, chmodSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { Store, DeskError, can, ROLES } from "./store.mjs";
import { cfg, cfgTable, WORK } from "../toolkit/lib/core.mjs";

const PORT = Number(process.env.DESK_PORT || 5555);
const DIR = process.env.DESK_DIR || join(WORK, "desk");
const MAX_BODY = 1024 * 1024;

mkdirSync(DIR, { recursive: true });
const store = new Store(DIR);
const tokenPath = join(DIR, ".agent-token");
if (!existsSync(tokenPath)) { writeFileSync(tokenPath, randomBytes(24).toString("hex")); chmodSync(tokenPath, 0o600); }
// Read on every agent call: a restore or a rotation takes effect without a restart.
const agentToken = () => { try { return Buffer.from(readFileSync(tokenPath, "utf8").trim()); } catch { return Buffer.alloc(0); } };

// Per caller: at most WRITES_PER_WINDOW writes and ITEMS_PER_HOUR new inbox items, so
// one person (or one script in a browser) cannot flood the agent or the store.
const WRITES_PER_WINDOW = 40, WINDOW_MS = 10 * 60 * 1000, ITEMS_PER_HOUR = 15;
const usage = new Map();
function spend(key, kind) {
  const now = Date.now();
  const u = usage.get(key) || { writes: [], items: [] };
  u.writes = u.writes.filter((t) => now - t < WINDOW_MS);
  u.items = u.items.filter((t) => now - t < 3600 * 1000);
  if (kind === "write" && u.writes.length >= WRITES_PER_WINDOW) throw new DeskError(429, "too many changes in a short time; try again in a few minutes");
  if (kind === "item" && u.items.length >= ITEMS_PER_HOUR) throw new DeskError(429, "you sent the agent a lot in the last hour; it will get to the rest, try again later");
  u[kind === "write" ? "writes" : "items"].push(now);
  usage.set(key, u);
}

const log = (level, event, msg) => {
  try { process.stderr.write(`${new Date().toISOString()} ${level} ${event} ${msg}\n`); } catch {}
};

// The roster: `## Desk people` in work/CONFIG.md, | email | role |. Re-read on every
// request: it is small, and an edit by the operator takes effect at once.
function roleOf(caller) {
  if (caller.role === "owner") return "lead";
  if (!caller.email) return "guest";
  const row = cfgTable("Desk people").find((r) => (r.email || "").toLowerCase() === caller.email);
  const role = (row?.role || "").toLowerCase();
  return ROLES.includes(role) ? role : "guest";
}

function settings() {
  const list = (v, d) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);
  return {
    prototypeRoles: list(cfg("prototype_requesters"), ["designer", "lead"]),
    ping: cfg("desk_ping", "enabled") !== "disabled",
    name: cfg("display_name", "Design Desk"),
  };
}

function isAgent(req) {
  const t = Buffer.from(String(req.headers["x-desk-agent-token"] || "")), want = agentToken();
  return want.length > 0 && t.length === want.length && timingSafeEqual(t, want);
}

// Only loopback names: a web page that rebinds its own name to 127.0.0.1 (opened in
// this machine's browser by a screenshot) arrives with its own Host and is refused.
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

function callerOf(req) {
  const role = req.headers["x-platform-caller-role"];
  if (role !== "owner" && role !== "viewer") return null;
  const email = String(req.headers["x-platform-caller-email"] || "").trim().toLowerCase() || null;
  const sub = String(req.headers["x-platform-caller-sub"] || "");
  const caller = { role, email, sub };
  return { ...caller, deskRole: roleOf(caller) };
}

async function body(req) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new DeskError(413, "body too large"); chunks.push(c); }
  if (!n) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new DeskError(400, "body is not JSON"); }
}

const send = (res, status, obj) => {
  const text = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
};

// ---------- routes ----------

async function viewerRoute(req, res, url, who) {
  const s = settings();
  const actor = { email: who.email, sub: who.sub, role: who.deskRole };
  const need = (action) => { if (!can(who.deskRole, action, s.prototypeRoles)) throw new DeskError(403, `your role (${who.deskRole}) cannot ${action} here; ask the Desk's owner to add you to its people list`); };
  const p = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const m = req.method;
  if (m === "GET" && p[1] === "me") {
    const actions = ["ack", "ask", "comment", "vote", "request", "follow-up", "explore", "revise", "build", "approve", "close", "reopen", "refresh", "queue"];
    return send(res, 200, { email: who.email, key: who.email || who.sub, role: who.deskRole, platformRole: who.role, can: Object.fromEntries(actions.map((a) => [a, can(who.deskRole, a, s.prototypeRoles)])), pings: s.ping && who.deskRole !== "guest", name: s.name });
  }
  if (m === "GET" && p[1] === "cards" && !p[2]) return send(res, 200, { cards: store.listCards({ kind: url.searchParams.get("kind") || undefined, status: url.searchParams.get("status") || undefined, viewer: who.email || who.sub }) });
  if (m === "GET" && p[1] === "cards" && p[2]) return send(res, 200, { card: store.getCard(p[2]) });
  if (m === "GET" && p[1] === "assets" && p[2]) return send(res, 200, store.getAsset(p[2]));
  if (m === "GET" && p[1] === "stats") return send(res, 200, store.stats());
  if (m === "GET" && p[1] === "agenda") return send(res, 200, { agenda: store.agenda(), calls: (store.db.calls || []).slice(-5) });
  const b = m === "GET" ? {} : await body(req);
  if (m !== "GET") {
    if (store.full()) throw new DeskError(507, "the Desk is full; the owner archives old cards (docs/desk.md → Server)");
    spend(who.email || who.sub, "write");
    if ((p[1] === "cards" && p[3] === "threads" && b.kind === "question") || (p[1] === "threads" && p[3] === "messages") || p[1] === "requests" || (p[1] === "cards" && p[3] === "actions")) spend(who.email || who.sub, "item");
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "agenda") { need("queue"); return send(res, 200, withPing(store.queueForCall(p[2], actor, b.note), s, who)); }
  if (m === "DELETE" && p[1] === "cards" && p[3] === "agenda") return send(res, 200, store.unqueue(p[2], actor));
  if (m === "POST" && p[1] === "calls") return send(res, 200, store.closeCall(actor, b));
  if (m === "POST" && p[1] === "cards" && p[3] === "ack") { need("ack"); return send(res, 200, store.ack(p[2], actor)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "threads") { need(b.kind === "question" ? "ask" : "comment"); return send(res, 201, withPing(store.openThread(p[2], actor, b), s, who)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "messages") { need("comment"); return send(res, 201, withPing(store.reply(p[2], actor, b.text), s, who)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "resolve") { need("comment"); return send(res, 200, store.resolve(p[2], actor)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "votes") { need("vote"); return send(res, 200, store.vote(p[2], actor, b)); }
  if (m === "POST" && p[1] === "requests") {
    need(b.from ? "follow-up" : "request");
    if (b.from) store.card(String(b.from));
    // Only what a person types: an origin (where the agent answers) is the agent's to set.
    // A person files an idea, a bug, or an adjustment of a change card; features and
    // proposals are the agent's (from an issue, from a shipped change).
    const { title, problem, goal, screen, steps, from } = b;
    const type = from ? "adjustment" : b.type === "bug" ? "bug" : "idea";
    return send(res, 201, withPing(store.createRequest(actor, { title, problem, goal, screen, steps, type, from }), s, who));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "actions") { need(String(b.action)); return send(res, 200, withPing(store.act(p[2], actor, String(b.action), b.note), s, who)); }
  throw new DeskError(404, `no route ${m} ${url.pathname}`);
}

// The page sends the agent a ping with only the item id; the agent reads the work
// from this store, never from the prompt (a viewer can send any prompt text). A guest's
// work waits for the inbox schedule instead of starting a session of its own.
function withPing(result, s, who) {
  return result.inbox && s.ping && who.deskRole !== "guest" ? { ...result, ping: `Design Desk: inbox item ${result.inbox.id} is waiting. Follow CLAUDE.md → "Desk pings".` } : result;
}

async function agentRoute(req, res, url) {
  const p = url.pathname.split("/").filter(Boolean); // ["agent", ...]
  const m = req.method;
  if (m === "GET" && p[1] === "inbox") return send(res, 200, JSON.parse(readFileSync(join(DIR, "inbox.json"), "utf8")));
  if (m === "GET" && p[1] === "cards" && !p[2]) return send(res, 200, { cards: store.listCards({ kind: url.searchParams.get("kind") || undefined }) });
  if (m === "GET" && p[1] === "cards" && p[2]) return send(res, 200, { card: store.getCard(p[2]) });
  if (m === "GET" && p[1] === "items" && p[2]) { const it = store.item(p[2]); return send(res, 200, { item: it, card: store.getCard(it.card) }); }
  if (m === "GET" && p[1] === "stats") return send(res, 200, store.stats());
  const b = m === "GET" ? {} : await body(req);
  if (m === "POST" && p[1] === "cards") return send(res, 200, store.upsertCard(b));
  if (m === "POST" && p[1] === "reports") return send(res, 201, store.createRequest({ agent: true }, { ...b, type: "bug" }));
  if (m === "POST" && p[1] === "requests") return send(res, 201, store.createRequest({ agent: true }, b));
  if (m === "POST" && p[1] === "cards" && p[3] === "agenda") return send(res, 200, store.queueForCall(p[2], { agent: true }, b.note));
  if (m === "POST" && p[1] === "assets") return send(res, 201, store.addAsset(b));
  if (m === "POST" && p[1] === "threads" && p[3] === "answer") return send(res, 200, store.answer(p[2], b.text, { resolve: Boolean(b.resolve) }));
  if (m === "POST" && p[1] === "cards" && p[3] === "comment") return send(res, 201, store.openThread(p[2], { agent: true }, { kind: "comment", text: b.text }));
  if (m === "POST" && p[1] === "items" && p[3] === "claim") return send(res, 200, store.claim(p[2], String(b.session || ""), { takeover: Boolean(b.takeover) }));
  if (m === "POST" && p[1] === "items" && p[3] === "done") return send(res, 200, store.done(p[2], String(b.session || ""), b.outcome || "done"));
  if (m === "POST" && p[1] === "enqueue") return send(res, 201, (() => { store.card(String(b.card)); const it = store.enqueue(String(b.kind), String(b.card), null, { agent: true }, typeof b.note === "string" ? b.note.slice(0, 1000) : ""); store.save(); return { item: it }; })());
  throw new DeskError(404, `no route ${m} ${url.pathname}`);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://desk.local");
  try {
    if (!HOSTS.has(String(req.headers.host || ""))) throw new DeskError(421, "the Desk answers only on its loopback address");
    if (store.reloadIfChanged()) log("warn", "desk_reload", "db.json changed on disk (a restore?) — reloaded before answering");
    if (url.pathname === "/health") return send(res, 200, { ok: true, ...store.stats() });
    if (url.pathname.startsWith("/agent/")) {
      if (!isAgent(req)) throw new DeskError(401, "agent routes need the agent token");
      return await agentRoute(req, res, url);
    }
    if (url.pathname.startsWith("/api/")) {
      const who = callerOf(req);
      if (!who) throw new DeskError(401, "the Desk answers only the platform's relay");
      return await viewerRoute(req, res, url, who);
    }
    throw new DeskError(404, "not found");
  } catch (e) {
    const status = e instanceof DeskError ? e.status : 500;
    if (status >= 500) log("error", "desk_error", `${req.method} ${url.pathname}: ${e.stack || e}`);
    send(res, status, { error: e.message || String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => log("info", "desk_start", `listening on 127.0.0.1:${PORT}, store ${DIR}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
