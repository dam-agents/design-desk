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
import { Store, DeskError, forgetIdle, can, ROLES, ADDABLE_ROLES, abilities, rosterOf, readRole, personOf, namesOf, LOOK_ROLES } from "./store.mjs";
import { cfg, cfgTable, WORK } from "../toolkit/lib/core.mjs";
import { requestSkills } from "../toolkit/lib/actions.mjs";

const PORT = Number(process.env.DESK_PORT || 5555);
const DIR = process.env.DESK_DIR || join(WORK, "desk");
const MAX_BODY = 1024 * 1024;

mkdirSync(DIR, { recursive: true });
// A decision in force that waits for a designer's approval counts for nothing yet (docs/desk.md → Decisions); `withSide` is below.
const store = new Store(DIR, { needsApproval: (d) => withSide(d).unapproved });
const tokenPath = join(DIR, ".agent-token");
if (!existsSync(tokenPath)) { writeFileSync(tokenPath, randomBytes(24).toString("hex"), { mode: 0o600 }); chmodSync(tokenPath, 0o600); }
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
  if (kind === "write" && u.writes.length >= WRITES_PER_WINDOW) throw new DeskError(429, "That's a lot of changes in a few minutes. Wait 10 minutes and try again.");
  if (kind === "item" && u.items.length >= ITEMS_PER_HOUR) throw new DeskError(429, `You've sent Design Desk ${ITEMS_PER_HOUR} things this hour. It's working through them; try again in an hour.`);
  u[kind === "write" ? "writes" : "items"].push(now);
  usage.set(key, u);
  forgetIdle(usage, now, WINDOW_MS);
}

const log = (level, event, msg) => {
  try { process.stderr.write(`${new Date().toISOString()} ${level} ${event} ${msg}\n`); } catch {}
};

// The roster: `## Desk people` in work/CONFIG.md, | email | role |; one person's row may
// list several addresses (docs/config.md). Re-read on every request: it is small, and an
// edit by the operator takes effect at once.
const roster = () => rosterOf(cfgTable("Desk people"));
const rowOf = (email) => personOf(roster(), email);
function roleOf(caller) {
  if (caller.role === "owner") return "admin";
  if (!caller.email) return "guest";
  const role = rowOf(caller.email)?.role;
  return ROLES.includes(role) ? role : "guest";
}

// Who a decision came from (docs/desk.md → Decisions → Who decided): the design side
// (a designer, a PM or an admin) or a developer. The author's role on the roster, by their
// address; the role the record names only where the Desk verified it (a comment, an approval)
// or the operator or a designer said it (chat, the meeting), never from text Design Desk read. Else a pull request, a commit or an
// architecture page is a developer's; unknown stays null.
const DESIGN_SIDE = ["admin", "designer", "pm"], DEVELOPER_SIDE = ["lead-developer", "developer"];
const SAID_ROLE = ["desk", "approval", "chat", "call"], FROM_GITHUB = ["pr", "issue", "commit", "doc"];
function sideOf(d) {
  const email = String(d.author?.email || "").toLowerCase();
  const role = (SAID_ROLE.includes(d.origin?.kind) ? readRole(d.author?.role) : null) || (email ? rowOf(email)?.role || null : null);
  if (DESIGN_SIDE.includes(role)) return "design";
  if (DEVELOPER_SIDE.includes(role)) return "developer";
  return ["pr", "commit", "doc"].includes(d.origin?.kind) ? "developer" : null;
}
// A decision from anyone but the design side, or read from GitHub (whose author no one
// verified), waits for a designer's approval; it holds meanwhile (docs/desk.md → Decisions →
// Approved by a designer). scripts/preflight.sh publishes only approved ones the same way.
const withSide = (d) => { const side = sideOf(d); return { ...d, side, unapproved: d.status === "active" && (side !== "design" || FROM_GITHUB.includes(d.origin?.kind)) && !d.approved }; };

// The skills New request offers, from `request_skills` (toolkit/lib/actions.mjs).
const offerSkills = (figma) => requestSkills(cfg("request_skills", "copy, impact, brand, walkthrough, figma"),
  { figma, warn: (m) => log("warn", "request_skills", m) });

// The roster role of a person met in Slack, by the email the workspace discloses.
function slackRole(email) {
  if (!email) return "slack";
  const role = rowOf(email)?.role;
  return ROLES.includes(role) && role !== "guest" ? role : "slack";
}

function settings() {
  const list = (v, d) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : d);
  const admin = roster().find((r) => r.role === "admin");
  const ideas = cfg("handoff", "desk");
  return {
    // Read as the roster reads a role, so `lead developer` here is the roster's `lead-developer`.
    prototypeRoles: list(cfg("prototype_requesters"), ["designer", "pm", "admin"]).map(readRole),
    ping: cfg("desk_ping", "enabled") !== "disabled",
    name: cfg("display_name", "Design Desk"),
    // The repository a bare #12 on the page links into, when its card names none.
    repo: list(cfg("repos"), []).find((r) => r !== "none") || null,
    // Who people ask for access or help: the first admin on the roster, else the owner.
    contact: admin?.email || "the Desk's owner",
    figma: cfg("figma", "disabled") !== "disabled",
    // A screen card needs the agent's own copy of the product for its pictures (docs/map.md).
    screens: cfg("screens", "disabled") === "enabled",
    slack: cfg("slack_polls", "disabled") === "enabled",
    // Pictures of the options posted to the Slack channel; a request from Slack goes to its thread anyway.
    slackSend: cfg("slack_send", "disabled") === "enabled",
    // The Desk's share link: the page builds an item's link from it (docs/desk.md → Links to an item).
    link: ((v) => (/^https?:\/\/[^\s#]+$/.test(v) ? v : null))(cfg("desk_link", "")),
    // Days a change may wait to be handled before the page shows it overdue; 0 or off: never.
    dueDays: ((v) => (v === "off" ? 0 : /^\d+$/.test(v) ? Number(v) : 21))(cfg("change_due_days", "21")),
    // Days after shipping that a change nobody marked handled moves to Auto handled; 0 or off: never.
    autoDays: ((v) => (v === "off" ? 0 : /^\d+$/.test(v) ? Number(v) : 14))(cfg("change_auto_handled_days", "14")),
    // Days a pull request's own environment runs after it was deployed; 0 or off: never shown as gone.
    envDays: ((v) => (v === "off" ? 0 : /^\d+$/.test(v) ? Number(v) : 7))(cfg("pr_environment_days", "7")),
    // Whether a person reads and sends the spec (docs/handoff.md → Review before it goes): then
    // they pick its route at Send, not at Approve.
    specReview: cfg("spec_review", "enabled") !== "disabled",
    // Where an approved design goes, by request type, so the page can say it before approving.
    handoff: {
      feature: cfg("issue_writeback", "enabled") === "disabled" ? "desk" : "issue-comment",
      adjustment: "coding-agent", bug: "coding-agent",
      idea: ideas, proposal: ideas,
    },
  };
}

// The words a person reads when their role lacks an action.
const VERBS = { ack: "mark changes as seen", handle: "mark changes and issues as handled", "handle-small": "mark changes and issues For Developers as handled", ask: "ask questions", comment: "comment", vote: "vote", request: "send requests", "follow-up": "adjust a change",
  screens: "add screenshots", explore: "start design options", revise: "redraw options", build: "build live prototypes", approve: "approve designs", close: "close requests",
  reopen: "reopen requests", refresh: "update drawings", share: "share options in Slack", choose: "remove a design option", queue: "add to the presentation", change: "note changes on an element", figma: "use Figma here", add: "add screens and parts to Product",
  draw: "draw issues", decide: "record and revoke decisions", size: "move a request between For Developers and For Designers", skip: "decide without a vote or a live prototype", people: "add people to the Desk", resolve: "mark someone else's conversation done", designs: "see Designs", built: "mark designs done" };

const canAll = (role, s) => abilities(role, s.prototypeRoles);

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
  // Every address the person goes by: the one they signed in with first, then their row's others.
  const row = email ? rowOf(email) : null;
  const emails = row ? [email, ...[row.email, ...row.also].filter((e) => e !== email)] : email ? [email] : [];
  return { ...caller, emails, deskRole: roleOf(caller) };
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
  const actor = { email: who.email, emails: who.emails, sub: who.sub, role: who.deskRole };
  const need = (action) => {
    if (can(who.deskRole, action, s.prototypeRoles)) return;
    const verb = VERBS[action] || "do that";
    throw new DeskError(403, who.deskRole === "guest"
      ? `To ${verb}, ask ${s.contact} to add ${who.email || "you"} to the Desk's members.`
      : `Only ${action === "people" ? "an admin" : action === "size" ? "lead developers and admins" : action === "skip" ? "designers, PMs and lead developers" : action === "close" || action === "reopen" ? "designers and PMs" : action === "built" ? "developers" : "designers"} can ${verb}. Ask ${s.contact} if you need it.`);
  };
  const p = url.pathname.split("/").filter(Boolean); // ["api", ...]
  const m = req.method;
  if (m === "GET" && p[1] === "me") {
    // The page asks who it is once, when it loads: that is the sign-in People reads (docs/desk.md → People).
    // A read never fails for it: a full store keeps no record, and a failed write is dropped.
    try { if (!store.full()) store.markOpened(actor); } catch {}
    return send(res, 200, { email: who.email, emails: who.emails, my_name: rowOf(who.email)?.name || null, names: namesOf(roster()), key: who.email || who.sub, role: who.deskRole, theme: store.prefsOf(actor).theme, simple: store.prefsOf(actor).simple, figma_pref: store.prefsOf(actor).figma, platformRole: who.role, can: canAll(who.deskRole, s), pings: s.ping && who.deskRole !== "guest", name: s.name, repo: s.repo, contact: s.contact, figma: s.figma, slack: s.slack, slack_send: s.slackSend, screens: s.screens, handoff: s.handoff, spec_review: s.specReview, due_days: s.dueDays, auto_days: s.autoDays, env_days: s.envDays, link: s.link, skills: offerSkills(s.figma) });
  }
  // Who is on the Desk and what each role may do; only people the owner shared the Desk with get here.
  if (m === "GET" && p[1] === "people") { const ppl = roster(); return send(res, 200, { people: ppl, activity: store.peopleActivity(ppl), roles: Object.fromEntries(ROLES.map((r) => [r, canAll(r, s)])), asks: store.peopleAsks(), addable: ADDABLE_ROLES }); }
  if (m === "GET" && p[1] === "cards" && !p[2]) return send(res, 200, { cards: store.listCards({ kind: url.searchParams.get("kind") || undefined, status: url.searchParams.get("status") || undefined, viewer: who.email || who.sub, who: actor }) });
  if (m === "GET" && p[1] === "cards" && p[2]) {
    const card = store.getCard(p[2], { viewer: who.email || who.sub || null });
    // Each conversation says what this reader may do in it, so the page shows only the controls
    // the routes below accept (reply and answer, reopen; resolve: Mark done).
    const may = (t, move) => can(who.deskRole, store.threadNeed(t.id, actor, move), s.prototypeRoles);
    return send(res, 200, { card: { ...card, threads: card.threads.map((t) => ({ ...t, may: { reply: may(t), resolve: may(t, "resolve") } })) } });
  }
  if (m === "GET" && p[1] === "assets" && p[2]) return send(res, 200, store.getAsset(p[2]));
  // What the Desk keeps of the issues and pull requests its items point at, for previews.
  if (m === "GET" && p[1] === "github") return send(res, 200, { records: store.github(String(url.searchParams.get("keys") || "").split(",").filter(Boolean).slice(0, 50)) });
  // A person's own private asks, and no one else's (docs/desk.md → Private asks).
  if (m === "GET" && p[1] === "private") return send(res, 200, { asks: store.privateAsks(actor) });
  if (m === "GET" && p[1] === "stats") return send(res, 200, store.stats());
  if (m === "GET" && p[1] === "agenda") return send(res, 200, { agenda: store.agenda(), presented: store.presented(), calls: (store.db.calls || []).slice(-5) });
  // The product's releases, for Product → History (docs/watch.md → Releases).
  if (m === "GET" && p[1] === "releases") return send(res, 200, store.getReleases());
  // The product's kit: an admin's, a designer's and a lead developer's page (docs/desk-page.md → Product → Kit).
  if (m === "GET" && p[1] === "kit") { if (!LOOK_ROLES.includes(who.deskRole)) throw new DeskError(403, `Only admins, designers and lead developers see the kit. Ask ${s.contact} if you need it.`); return send(res, 200, store.getKit()); }
  if (m === "GET" && p[1] === "decisions" && !p[2]) {
    // Not approved: the ones in force that wait for a designer's approval.
    const q = decisionQuery(url), pending = url.searchParams.get("state") === "unapproved";
    const all = store.listDecisions({ ...q, state: pending ? "active" : q.state }).map(withSide);
    return send(res, 200, { decisions: (pending ? all.filter((d) => d.unapproved) : all).slice(0, 200) });
  }
  if (m === "GET" && p[1] === "decisions" && p[2]) { const r = store.getDecision(p[2]); return send(res, 200, { ...r, decision: withSide(r.decision) }); }
  // Opening an item marks it read for this person alone (docs/desk-page.md → Read and unread). It is
  // outside the write budget: browsing many items must not use up what comments and votes need,
  // and it writes at most once per person and item.
  if (m === "POST" && p[1] === "cards" && p[3] === "read" && !p[4]) return send(res, 200, store.full() ? { read: false } : store.markRead(p[2], actor));
  // The bell: what happened lately, for this person (docs/desk-page.md → Notifications). A click on a
  // row marks it read, Mark as read all of them; like reading an item, outside the write budget.
  if (m === "GET" && p[1] === "notifications") return send(res, 200, store.notifications(actor));
  if (m === "POST" && p[1] === "notifications" && p[2] === "read") return send(res, 200, store.full() ? { read: false } : store.markNoteRead(actor, url.searchParams.get("id")));
  if (m === "POST" && p[1] === "notifications" && p[2] === "seen") return send(res, 200, store.full() ? { seen: null } : store.markSeen(actor));
  const b = m === "GET" ? {} : await body(req);
  if (m !== "GET") {
    if (store.full()) throw new DeskError(507, `The Desk is full and can't save anything new. Tell ${s.contact}; they can archive old changes.`);
    spend(who.email || who.sub, "write");
    if ((p[1] === "cards" && p[3] === "threads" && ["question", "change"].includes(b.kind)) || p[1] === "private" || (p[1] === "threads" && ["messages", "answers", "decision"].includes(p[3])) || p[1] === "requests" || p[1] === "product" || p[1] === "people" || (p[1] === "cards" && ["actions", "screens", "work-in", "decide", "spec", "text"].includes(p[3]))) spend(who.email || who.sub, "item");
  }
  // A person's own day or night mode and simple mode, kept for them on every device
  // (docs/desk-page.md → The menu); only the keys sent change.
  if (m === "POST" && p[1] === "prefs") {
    if (!b || typeof b !== "object" || Array.isArray(b)) throw new DeskError(400, "prefs must be an object");
    return send(res, 200, store.setPrefs(actor, Object.fromEntries(["theme", "simple", "figma"].filter((k) => Object.hasOwn(b, k)).map((k) => [k, b[k] ?? null]))));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "agenda") { need("queue"); return send(res, 200, withPing(store.queueForCall(p[2], actor, b.note, typeof b.variant === "string" ? b.variant : null), s, who)); }
  if (m === "DELETE" && p[1] === "cards" && p[2] && !p[3]) { need("close"); return send(res, 200, store.deleteRequest(p[2], actor)); }
  if (m === "DELETE" && p[1] === "cards" && p[3] === "agenda") return send(res, 200, store.unqueue(p[2], actor));
  if (m === "POST" && p[1] === "calls") return send(res, 200, store.closeCall(actor, b));
  if (m === "POST" && p[1] === "cards" && p[3] === "presented") return send(res, 200, store.markPresented(p[2], actor, b.presented !== false));
  if (m === "POST" && p[1] === "cards" && p[3] === "ack") { need("ack"); return send(res, 200, store.ack(p[2], actor)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "built") { need("built"); return send(res, 200, store.markBuilt(p[2], actor, b.built !== false)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "handled") { if (!can(who.deskRole, "handle-small", s.prototypeRoles)) need("handle"); return send(res, 200, store.handle(p[2], actor, b.handled !== false)); }
  // A difference from Figma taken off an item's table, or brought back (docs/desk.md → Differences from Figma).
  if (m === "POST" && p[1] === "cards" && p[3] === "figma-close") { need("handle"); if (!s.figma) throw new DeskError(400, "Figma is not connected to this Desk yet."); return send(res, 200, store.closeFigma(p[2], actor, b.on !== false)); }
  if (m === "POST" && (p[1] === "cards" || p[1] === "decisions") && p[3] === "figma-dismiss") { need("handle"); if (!s.figma) throw new DeskError(400, "Figma is not connected to this Desk yet."); return send(res, 200, store.dismissFigma(p[2], actor, b.part, b.on !== false)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "threads") {
    need(b.kind === "question" ? "ask" : b.kind === "change" ? "change" : "comment");
    const { kind, text, anchor } = b;
    // A question for the designer, from Designs (docs/desk-page.md → Designs).
    const dev = b.dev === true && can(who.deskRole, "designs", s.prototypeRoles);
    return send(res, 201, withPing(store.openThread(p[2], actor, { kind, text, anchor, dev }), s, who));
  }
  if (m === "POST" && p[1] === "private") { need("ask"); return send(res, 201, withPing(store.openPrivate(actor, { text: b.text, starter: typeof b.starter === "string" ? b.starter : null, context: b.context }), s, who)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "messages") { need(store.threadNeed(p[2], actor)); return send(res, 201, withPing(store.reply(p[2], actor, b.text), s, who)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "answers") { need(store.threadNeed(p[2], actor)); return send(res, 200, withPing(store.answerForm(p[2], actor, b.answers), s, who)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "resolve") { need(store.threadNeed(p[2], actor, "resolve")); return send(res, 200, store.resolve(p[2], actor)); }
  if (m === "POST" && p[1] === "threads" && p[3] === "reopen") { need(store.threadNeed(p[2], actor)); return send(res, 200, withPing(store.reopenThread(p[2], actor), s, who)); }
  // Decisions (docs/desk.md → Decisions): Design Desk records one from a comment; a designer revokes or restores one.
  if (m === "POST" && p[1] === "threads" && p[3] === "decision") { need("decide"); return send(res, 201, withPing(store.proposeDecision(p[2], actor, { message: b.message, note: b.note }), s, who)); }
  // A designer or an admin adds a decision in their own name, with up to two pictures (docs/desk.md → Decisions).
  if (m === "POST" && p[1] === "decisions" && !p[2]) {
    need("decide");
    const images = Array.isArray(b.images) ? b.images.slice(0, 2) : [];
    for (const im of images) if (!/^image\/(png|jpeg|webp)$/.test(im?.contentType || "")) throw new DeskError(400, "only PNG, JPEG or WebP pictures can be added");
    const ids = images.map((im, i) => store.addAsset({ kind: "image", name: `decision-${i + 1}`, contentType: im.contentType, data: String(im.data || "") }).asset.id);
    return send(res, 201, store.recordDecision(actor, { text: b.text, why: b.why, concepts: b.concepts, pictures: ids }));
  }
  if (m === "POST" && p[1] === "decisions" && p[3] === "revoke") { need("decide"); return send(res, 200, store.revokeDecision(p[2], actor, { reason: b.reason, replaced_by: b.replaced_by || null })); }
  if (m === "POST" && p[1] === "decisions" && p[3] === "restore") { need("decide"); return send(res, 200, store.restoreDecision(p[2], actor)); }
  if (m === "POST" && p[1] === "decisions" && p[3] === "approve") {
    need("decide");
    const d = store.decision(p[2]);
    if (sideOf(d) === "design" && !FROM_GITHUB.includes(d.origin?.kind)) throw new DeskError(400, "A decision of the design side needs no approval.");
    return send(res, 200, { decision: withSide(store.approveDecision(p[2], actor).decision) });
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "work-in") { need("change"); return send(res, 200, withPing(store.workIn(p[2], actor, b.threads), s, who)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "decide") { need("skip"); return send(res, 201, withPing(store.decideAndClose(p[2], actor, { text: b.text, why: b.why }), s, who)); }
  if (m === "POST" && p[1] === "cards" && p[3] === "feedback") return send(res, 200, store.openFeedback(p[2], actor));
  if (m === "POST" && p[1] === "cards" && p[3] === "end-vote") return send(res, 200, store.endVote(p[2], actor));
  // The developer spec, read before it goes: edit it, ask for changes, or send it (docs/handoff.md).
  if (m === "POST" && p[1] === "cards" && p[3] === "spec") { const r = store.specAction(p[2], actor, { action: b.action, text: b.text, note: b.note, implement: typeof b.implement === "boolean" ? b.implement : null, closeEarlier: b.close_earlier === true, comment: b.comment === true }); return send(res, 200, r.inbox ? withPing(r, s, who) : r); }
  if (m === "POST" && p[1] === "cards" && p[3] === "size") { need("size"); return send(res, 200, store.setSize(p[2], actor, b.small)); }
  // An approved design's elements into Product → Elements (docs/catalog.md → From approved designs).
  if (m === "POST" && p[1] === "cards" && p[3] === "catalog") { need("add"); return send(res, 200, store.addDesignToCatalog(p[2], actor, typeof b.element === "string" ? b.element : "")); }
  if (m === "POST" && p[1] === "cards" && p[3] === "votes") { need("vote"); return send(res, 200, store.vote(p[2], actor, b)); }
  if (m === "POST" && p[1] === "requests") {
    need(b.from ? "follow-up" : "request");
    if (b.from) store.card(String(b.from));
    // Only what a person types: an origin (where the agent answers) is the agent's to set.
    // A person files an idea, a bug, or an adjustment of a change card; features and
    // proposals are the agent's (from an issue, from a shipped change).
    const { title, problem, goal, screen, steps, from, figma } = b;
    // For Developers or For Designers, the dialog's switch, for the roles that may move a
    // request between the two; the Desk's default is the designers'.
    const audience = b.audience === "developers" && can(who.deskRole, "size", s.prototypeRoles) ? "developers" : "designers";
    // How many options, and questions first: a bug is fixed, not designed, so it has neither.
    // From an issue on the Issues page it designs that feature; from a change it adjusts it.
    // From an approved request, a new one of the same kind, its options carried over as ticked.
    const src = from ? store.card(String(from)) : null;
    const type = src ? (src.kind === "issue" ? "feature" : src.kind === "request" ? (src.request?.type === "bug" ? "idea" : src.request?.type || "idea") : "adjustment") : b.type === "bug" ? "bug" : "idea";
    const carry = src?.kind === "request" && Array.isArray(b.carry) ? b.carry.slice(0, 6).map(String) : [];
    // A bug is fixed, not designed: no picture of it and no skills. Only the offered skills count.
    const offered = new Set(offerSkills(s.figma).map((k) => k.name));
    const vision = type === "bug" ? "" : b.vision;
    const skills = type === "bug" || !b.skills || typeof b.skills !== "object" ? null
      : Object.fromEntries(Object.entries(b.skills).filter(([k, on]) => offered.has(k) && typeof on === "boolean"));
    // Pictures a person pasted: two at most, images only, stored before the card names them.
    const images = Array.isArray(b.images) ? b.images.slice(0, 2) : [];
    for (const im of images) if (!/^image\/(png|jpeg|webp)$/.test(im?.contentType || "")) throw new DeskError(400, "only PNG, JPEG or WebP pictures can be attached");
    const screens = images.map((im, i) => ({ asset: store.addAsset({ kind: "screen", name: `pasted-${i + 1}`, contentType: im.contentType, data: String(im.data || "") }).asset.id, caption: "", source: "person", by: { email: actor.email, role: actor.role } }));
    const options = type === "bug" ? 0 : b.options, grill = type !== "bug" && b.grill === true;
    // The options start right after triage only for someone who may start them.
    const auto = type !== "bug" && can(who.deskRole, "explore", s.prototypeRoles);
    return send(res, 201, withPing(store.createRequest(actor, { title, problem, goal, screen, steps, type, from, screens, figma, vision, skills, options, grill, auto, audience, carry }), s, who));
  }
  // An admin asks for a new person on the list; the agent writes the row (docs/desk.md → People).
  if (m === "POST" && p[1] === "people") { need("people"); return send(res, 201, withPing(store.askForPerson(actor, { email: b.email, role: b.role }, roster(), { owner: who.role === "owner" }), s, who)); }
  if (m === "POST" && p[1] === "product") {
    need("add");
    if (b.kind === "screen" && !s.screens) throw new DeskError(400, `Screens need Design Desk's own copy of the product, which is not turned on yet. Ask ${s.contact}.`);
    const images = Array.isArray(b.images) ? b.images.slice(0, 2) : [];
    for (const im of images) if (!/^image\/(png|jpeg|webp)$/.test(im?.contentType || "")) throw new DeskError(400, "only PNG, JPEG or WebP pictures can be attached");
    const screens = images.map((im, i) => ({ asset: store.addAsset({ kind: "screen", name: `pasted-${i + 1}`, contentType: im.contentType, data: String(im.data || "") }).asset.id, caption: "", source: "person", by: { email: actor.email, role: actor.role } }));
    const { kind, part, where, show } = b;
    return send(res, 201, withPing(store.addToProduct(actor, { kind, part, where, show, screens }), s, who));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "screens") {
    need("screens");
    store.card(p[2]);
    const images = Array.isArray(b.images) ? b.images.slice(0, 4) : [];
    for (const im of images) if (!/^image\/(png|jpeg|webp)$/.test(im?.contentType || "")) throw new DeskError(400, "only PNG, JPEG or WebP pictures can be added");
    const ids = images.map((im, i) => store.addAsset({ card: p[2], kind: "screen", name: `added-${i + 1}`, contentType: im.contentType, data: String(im.data || "") }).asset.id);
    return send(res, 201, withPing(store.addScreens(p[2], actor, ids), s, who));
  }
  // Edit text, confirmed: the words change in the design at once (docs/desk-page.md → design workspace).
  if (m === "POST" && p[1] === "cards" && p[3] === "text") {
    need("change");
    return send(res, 200, withPing(store.editText(p[2], actor, { variant: typeof b.variant === "string" ? b.variant : "", state: typeof b.state === "string" && b.state ? b.state : null, read: Number.isInteger(b.read) ? b.read : null, from: typeof b.from === "string" ? b.from : "", to: typeof b.to === "string" ? b.to : "", nth: Number.isInteger(b.nth) ? b.nth : 0, count: Number.isInteger(b.count) ? b.count : 1 }), s, who));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "title") { need("comment"); return send(res, 200, store.renameRequest(p[2], actor, b.title, { manage: can(who.deskRole, "close", s.prototypeRoles) })); }
  // A person's own option: their pictures on a page the server builds, nothing drawn (docs/requests.md → Variants).
  if (m === "POST" && p[1] === "cards" && p[3] === "options") {
    need("explore");
    return send(res, 201, store.addOwnOption(p[2], actor, { name: b.name, note: b.note, images: Array.isArray(b.images) ? b.images.slice(0, 4) : [] }));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "actions") {
    const action = String(b.action);
    // A request For Developers is approved by a developer too, and a lead developer approves any request;
    // the store checks who (docs/desk.md → For Developers or For Designers, Deciding straight away).
    // Drawing every state of a part is changing the option: a designer's, a PM's or a developer's.
    if (action !== "approve" || !(store.card(p[2]).size?.small || can(who.deskRole, "skip", s.prototypeRoles))) need(action.startsWith("figma-") ? "figma" : action.startsWith("slack-") ? "share" : ["states", "alternatives", "pick-alternative"].includes(action) ? "revise" : action === "drop-option" ? "choose" : ["add-option", "draw-now"].includes(action) ? "explore" : action === "switch-off" ? "build" : action);
    if (action.startsWith("figma-") && !s.figma) throw new DeskError(400, "Figma is not connected to this Desk yet.");
    if (action === "slack-share" && !s.slack) throw new DeskError(400, "Slack voting is not turned on for this Desk yet.");
    // Straight to implementation labels an issue: only where the approved spec reaches GitHub (docs/handoff.md, step 5).
    if (action === "approve" && b.implement === true && (s.handoff[store.card(p[2]).request?.type || "idea"] || "desk") === "desk") throw new DeskError(400, "This request's spec stays on the Desk, so it cannot go straight to the coding agent.");
    if (action === "slack-send" && !s.slackSend && store.card(p[2]).origin?.channel !== "slack") throw new DeskError(400, `Sending designs to Slack is not turned on for this Desk yet. Ask ${s.contact}.`);
    return send(res, 200, withPing(store.act(p[2], actor, action, b.note, { askFirst: b.ask_first === true, count: b.count ?? null, overrule: b.overrule === true, implement: b.implement === true, closeEarlier: b.close_earlier === true, autoSend: b.auto_send === true,
      variant: typeof b.variant === "string" ? b.variant : null, version: Number.isInteger(b.version) ? b.version : null,
      states: b.states && typeof b.states === "object" && !Array.isArray(b.states) ? b.states : null, part: b.part && typeof b.part === "object" ? b.part : null, element: typeof b.element === "string" ? b.element : null }), s, who));
  }
  throw new DeskError(404, `no route ${m} ${url.pathname}`);
}

const decisionQuery = (url) => ({ concept: url.searchParams.get("concept") || "", q: url.searchParams.get("q") || "", state: ["active", "revoked"].includes(url.searchParams.get("state")) ? url.searchParams.get("state") : "" });

// The page sends the agent a ping with only the item id; the agent reads the work
// from this store, never from the prompt (a viewer can send any prompt text). A guest's
// work waits for the inbox schedule instead of starting a session of its own.
// Each conversation gets a session of its own on the platform: a thread (a question, a
// private ask), else the card (a request and the work on it), else the item alone.
function withPing(result, s, who) {
  if (!(result.inbox && s.ping && who.deskRole !== "guest")) return result;
  const i = result.inbox;
  return { ...result, ping: `Design Desk: a teammate is waiting on the Desk (ref ${i.id}). Follow CLAUDE.md → "Desk pings".`, ping_conversation: i.thread || i.card || i.id };
}

async function agentRoute(req, res, url) {
  const p = url.pathname.split("/").filter(Boolean); // ["agent", ...]
  const m = req.method;
  if (m === "GET" && p[1] === "inbox") return send(res, 200, JSON.parse(readFileSync(join(DIR, "inbox.json"), "utf8")));
  if (m === "GET" && p[1] === "cards" && !p[2]) return send(res, 200, { cards: store.listCards({ kind: url.searchParams.get("kind") || undefined }) });
  // What a check reads (docs/desk.md → Decisions → The check).
  if (m === "GET" && p[1] === "cards" && p[3] === "decision-check") return send(res, 200, store.decisionCheck(p[2], { concepts: (url.searchParams.get("concept") || "").split(",").filter(Boolean), q: url.searchParams.get("q") || "" }));
  if (m === "GET" && p[1] === "cards" && p[2]) return send(res, 200, { card: store.getCard(p[2]) });
  if (m === "GET" && p[1] === "items" && p[2]) { const it = store.item(p[2]); return send(res, 200, { item: it, card: it.card ? store.getCard(it.card) : null, thread: it.thread ? store.thread(it.thread) : null }); }
  if (m === "GET" && p[1] === "stats") return send(res, 200, store.stats());
  // The approved designs a shipped change may build (docs/watch.md → Approved design).
  if (m === "GET" && p[1] === "designs") return send(res, 200, { designs: store.approvedDesigns() });
  if (m === "GET" && p[1] === "decisions" && !p[2]) return send(res, 200, { decisions: store.listDecisions(decisionQuery(url)) });
  if (m === "GET" && p[1] === "decisions" && p[2]) return send(res, 200, store.getDecision(p[2]));
  if (m === "GET" && p[1] === "assets" && p[2]) return send(res, 200, store.getAsset(p[2]));
  if (m === "GET" && p[1] === "polls") return send(res, 200, { poll: store.findPoll(String(url.searchParams.get("ts") || "")) });
  if (m === "GET" && p[1] === "councils") return send(res, 200, { council: store.findCouncil(String(url.searchParams.get("ts") || "")) });
  if (m === "GET" && p[1] === "findings") return send(res, 200, { finding: store.findFinding(String(url.searchParams.get("ref") || "")) });
  const b = m === "GET" ? {} : await body(req);
  // Work on a card keeps the claims on it alive: every agent write that names a card, an asset
  // of it or a thread of it renews the lease of the items claimed on it (docs/desk.md → Claims).
  if (m === "POST" && ["cards", "assets", "threads"].includes(p[1])) store.renewClaims({ card: p[1] === "cards" ? p[2] || b.id : p[1] === "assets" ? b.card : null, thread: p[1] === "threads" ? p[2] : null });
  if (m === "POST" && p[1] === "cards" && !p[2]) return send(res, 200, store.upsertCard(b));
  if (m === "POST" && p[1] === "reports") return send(res, 201, store.createRequest({ agent: true }, { ...b, type: "bug" }));
  // The product's kit as `design kit` read it (docs/requests.md → Smart controls).
  if (m === "POST" && p[1] === "kit") return send(res, 200, store.setKit(b));
  // The releases the watch pre-flight found (docs/watch.md → Releases).
  if (m === "POST" && p[1] === "releases") return send(res, 200, store.setReleases(b.releases ?? b));
  if (m === "POST" && p[1] === "requests") return send(res, 201, store.createRequest({ agent: true }, b));
  // An earlier look of an element drawn from the code's history (docs/catalog.md → History).
  if (m === "POST" && p[1] === "cards" && p[3] === "looks") return send(res, 201, store.addLook(p[2], b));
  if (m === "POST" && p[1] === "assets") return send(res, 201, store.addAsset(b));
  if (m === "POST" && p[1] === "threads" && p[3] === "answer") return send(res, 200, store.answer(p[2], b.text, { resolve: Boolean(b.resolve), shots: b.shots ?? null, warns: b.warns ?? null }));
  if (m === "POST" && p[1] === "cards" && p[3] === "comment") return send(res, 201, store.openThread(p[2], { agent: true }, { kind: "comment", text: b.text, shots: b.shots ?? null }));
  if (m === "POST" && p[1] === "cards" && p[3] === "ask") return send(res, 201, store.openThread(p[2], { agent: true }, { kind: "asks", text: b.text, step: b.step, questions: b.questions || null }));
  if (m === "POST" && p[1] === "decisions" && !p[2]) return send(res, 201, store.addDecision(b));
  // A decision a Figma frame goes against (the figma skill → Compare with the product).
  if (m === "POST" && p[1] === "decisions" && p[3] === "figma") return send(res, 200, store.setDecisionFigma(p[2], b.figma_check ?? null));
  // The agent revokes only in the name of the person who did, with where they said it.
  if (m === "POST" && p[1] === "decisions" && p[3] === "revoke") return send(res, 200, store.revokeDecision(p[2], { agent: true }, { reason: b.reason, replaced_by: b.replaced_by || null, by: b.by, origin: b.origin }));
  if (m === "POST" && p[1] === "cards" && p[3] === "polls" && !p[4]) return send(res, 201, store.openPoll(p[2], b));
  if (m === "POST" && p[1] === "cards" && p[3] === "polls" && p[4]) return send(res, 200, store.updatePoll(p[2], p[4], b));
  if (m === "POST" && p[1] === "cards" && p[3] === "councils" && !p[4]) return send(res, 201, store.openCouncil(p[2], b));
  if (m === "POST" && p[1] === "cards" && p[3] === "councils" && p[4]) return send(res, 200, store.updateCouncil(p[2], p[4], b));
  // A Slack voter's role is the roster's for their email, never one the agent names.
  if (m === "POST" && p[1] === "cards" && p[3] === "slack-votes") {
    const voters = (Array.isArray(b.voters) ? b.voters : []).map((v) => ({ ...v, key: v.email ? String(v.email).toLowerCase() : `slack:${v.slack_id || v.key}`, role: slackRole(v.email) }));
    return send(res, 200, store.slackVotes(p[2], String(b.variant || ""), voters));
  }
  if (m === "POST" && p[1] === "cards" && p[3] === "relay") return send(res, 201, store.relayComment(p[2], { ...b, role: slackRole(b.email) }));
  if (m === "POST" && p[1] === "items" && p[3] === "claim") return send(res, 200, store.claim(p[2], String(b.session || ""), { takeover: Boolean(b.takeover), heartbeat: Boolean(b.heartbeat) }));
  if (m === "POST" && p[1] === "items" && p[3] === "done") return send(res, 200, store.done(p[2], String(b.session || ""), b.outcome || "done"));
  // An ask to add a person carries its payload; only an admin's ask on the page makes one.
  if (m === "GET" && p[1] === "github") { const card = url.searchParams.get("card"); const keys = url.searchParams.get("keys"); return send(res, 200, keys ? { records: store.github(keys.split(",").filter(Boolean)) } : { refs: store.githubRefs(card || null) }); }
  if (m === "POST" && p[1] === "github" && p[2] === "failed") return send(res, 200, store.failGithub(b.keys));
  if (m === "POST" && p[1] === "github" && p[2] === "marks") return send(res, 200, store.markGithub(b.key, { at: b.at, author: b.author, design: b.design !== false }));
  if (m === "POST" && p[1] === "github") return send(res, 200, store.putGithub(b.records));
  if (m === "POST" && p[1] === "enqueue" && b.kind === "person") throw new DeskError(400, "an ask to add a person comes only from an admin on the People tab");
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
    // An unexpected error stays in the log: its text can name paths on the agent's machine.
    send(res, status, { error: status >= 500 ? "Something went wrong on the Desk. Try again; the operator sees it in the log." : e.message || String(e) });
  }
});

server.listen(PORT, "127.0.0.1", () => log("info", "desk_start", `listening on 127.0.0.1:${PORT}, store ${DIR}`));
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
