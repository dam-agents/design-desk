// The Desk store: cards, threads, votes, assets and the inbox of work waiting for
// the agent. Pure logic over one JSON document; the server is its only writer and
// persists it after every change (tmp + rename), so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LIMITS = {
  // The decisions one check reads at most; past it the read says it is cut (docs/desk.md → Decisions → The check).
  checkRead: 60,
  title: 200,
  text: 4000,
  threadsPerCard: 300,
  // The states drawn of one option (docs/requests.md → Every state of a part).
  optionStates: 24,
  // The parts one option changes or adds, each a tile under it (docs/requests.md → The option's elements).
  optionElements: 24,
  // What a shipped change does otherwise than the approved design it builds (docs/watch.md → Approved design).
  designDifferences: 12,
  // The ways of one part a person picks from (docs/requests.md → Alternatives of a part).
  alternatives: 4,
  // What a person writes a new option should look like and have.
  optionAsk: 2000,
  messagesPerThread: 200,
  // An answer to a change shows before and after pictures: a pair or two (light, dark), each with its diff.
  changeShots: 6,
  // A relayed body is capped at 1 MiB both ways; base64 adds a third, the JSON a little.
  assetBytes: 720 * 1024,
  // Every asset together: past this a new one is refused, so uploads cannot fill the disk.
  assetsBytes: 2 * 1024 * 1024 * 1024,
  // A session renews its claim while it works (design desk claim --heartbeat). A missing
  // heartbeat therefore returns dead work to the queue on the next inbox tick.
  claimTtlMin: 15,
  // A change card is read in passing: a short title, a one-sentence summary, a few short sections.
  change: { title: 90, summary: 180, sections: 5, section: 280 },
  // An issue on the Issues page: what it brings, and in a few bullets what the UI will need.
  issue: { title: 90, summary: 180, needs: 3, need: 200, sketches: 2 },
  // The user stories of the issue a request came from, and how each option meets them.
  stories: 12,
  // The decisions one option rests on, each pointing at the parts it shaped.
  reasons: 12,
  // Earlier looks of one element or screen kept on its card; the oldest go first.
  looks: 30,
  // The whole store is one file rewritten on every change; past this people's writes
  // are refused until the operator archives old cards.
  dbBytes: 50 * 1024 * 1024,
};

export const ROLES = ["admin", "designer", "pm", "lead-developer", "developer", "guest"];
// The roles that approve a request For Developers, when they did not file it (docs/desk.md → For Developers or For Designers).
export const DEVELOPERS = ["lead-developer", "developer"];
// The two tabs of Requests: whose call a request is (docs/desk.md → For Developers or For Designers).
export const AUDIENCES = ["developers", "designers"];
const BUSY = "Design Desk is already working on this. The result appears here.";

// Who may do what. The operator's roster assigns roles; the owner is always `admin`.
// `prototypeRoles` comes from config (`prototype_requesters`).
export function can(role, action, prototypeRoles = ["designer", "pm", "admin"]) {
  const member = role !== "guest";
  const shaper = role === "designer" || role === "admin";
  const dev = DEVELOPERS.includes(role);
  const pm = role === "pm";
  switch (action) {
    case "read": case "ack": case "ask": case "comment": return true;
    case "vote": case "request": case "follow-up": case "screens": case "resolve": return member;
    // Pictures of an issue: how it looks now and a sketch of how it could look (docs/issues.md).
    case "draw": return shaper || dev || pm;
    // A developer or a PM starts and changes everything a designer does; deciding stays a designer's.
    case "explore": case "revise": case "refresh": case "history": case "change": case "figma": case "share": case "add": return shaper || dev || pm;
    // Whether a request or a change is For Developers, which a developer approves, or For Designers.
    case "size": return role === "lead-developer" || role === "admin";
    // Mark a change For Developers handled: a lead developer, the dev UI owner, as well as a designer.
    case "handle-small": return shaper || role === "lead-developer";
    // Skip the vote and the live prototype: approve straight away, or decide and close
    // (docs/desk.md → Deciding straight away).
    case "skip": return shaper || pm || role === "lead-developer";
    // Close a request, reopen it, delete a closed one, rename any (docs/desk.md → Roles).
    case "close": case "reopen": return shaper || pm;
    // Deciding: approve, the presentation, handled, removing an option.
    case "queue": case "approve": case "handle": case "choose":
    // Record a decision from a comment, revoke one and restore it (docs/desk.md → Decisions).
    case "decide": return shaper;
    case "build": return prototypeRoles.includes(role);
    case "people": return role === "admin";
    // Designs: what was approved and sent, for developers to build and mark done (docs/desk-page.md → Designs).
    case "designs": case "built": return dev || role === "admin";
    default: return false;
  }
}

// Where a request the agent files came from (docs/desk.md → Where a card came from).
export const ORIGIN_CHANNELS = ["slack", "github", "chat", "agent"];
// The scheduled runs that file requests on their own (`origin.job`).
export const ORIGIN_JOBS = ["watch", "digest"];
// Where a decision was made (docs/desk.md → Decisions); `other` is only a record from before
// decisions named their origin.
export const DECISION_ORIGINS = ["pr", "issue", "commit", "doc", "slack", "desk", "call", "approval", "chat"];

// The server's per-person rate windows: past `max` callers, those with nothing left in either
// window (writes in `writeWindowMs`, items in the hour) are forgotten, so the map stays small.
export function forgetIdle(usage, now, writeWindowMs, max = 500) {
  if (usage.size > max) for (const [k, v] of usage) if (!v.items.some((t) => now - t < 3600 * 1000) && !v.writes.some((t) => now - t < writeWindowMs)) usage.delete(k);
}

// Every action the page asks about: /api/me for its caller, /api/people for each role.
export const ACTIONS = ["ack", "ask", "comment", "vote", "request", "follow-up", "explore", "revise", "build", "approve", "close", "reopen", "refresh", "history", "queue", "change", "figma", "screens", "share", "add", "handle", "handle-small", "choose", "draw", "decide", "size", "skip", "people", "designs", "built", "resolve"];
export const abilities = (role, prototypeRoles) => Object.fromEntries(ACTIONS.map((a) => [a, can(role, a, prototypeRoles)]));

// A role as written in `## Desk people` or `prototype_requesters`: lower case, inner spaces as
// hyphens (`Lead developer` → `lead-developer`). scripts/verify-onboarding.sh reads it the same way.
// `lead` is what the admin role was called before 1.59.0; a roster that still says so keeps working.
export const readRole = (r) => { const x = String(r || "").trim().toLowerCase().replace(/\s+/g, "-"); return x === "lead" ? "admin" : x; };

// A row's emails: one person may sign in to the Desk with one address and meet Design Desk in
// Slack with another, so the email cell holds every address of theirs, separated by commas.
export const emailsOf = (cell) => String(cell || "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
// The roster as the server reads a role (`## Desk people` rows): `email` is a row's first
// address, `also` its others, `name` the optional third column; the first row of an address counts, and an unknown role is a guest's.
export function rosterOf(rows) {
  const seen = new Set();
  return rows.map((r) => ({ emails: emailsOf(r.email), role: readRole(r.role), name: String(r.name || "").trim().slice(0, 80) }))
    .map((r) => ({ ...r, emails: r.emails.filter((e) => !seen.has(e) && seen.add(e)) }))
    .filter((r) => r.emails.length)
    .map((r) => ({ email: r.emails[0], also: r.emails.slice(1), role: ROLES.includes(r.role) ? r.role : "guest", ...(r.name ? { name: r.name } : {}) }));
}
// The names the roster gives, by every address: the page shows a name where it has one.
export const namesOf = (roster) => Object.fromEntries(roster.filter((r) => r.name).flatMap((r) => [r.email, ...(r.also || [])].map((e) => [e, r.name])));
// The roster row of an address, any of its emails.
export const personOf = (roster, email) => { const e = String(email || "").trim().toLowerCase(); return e ? roster.find((r) => r.email === e || (r.also || []).includes(e)) || null : null; };
// Every address a caller goes by: the one they signed in with and their row's others.
const addressesOf = (who) => [who?.email, ...(who?.emails || [])].map((e) => String(e || "").toLowerCase()).filter(Boolean);

// The roles an admin may ask Design Desk to give a new person (docs/desk.md → People);
// making an admin stays the operator's.
export const ADDABLE_ROLES = ["designer", "pm", "lead-developer", "developer"];
const EMAIL = /^[^\s@|`<>]+@[^\s@|`<>]+\.[^\s@|`<>]+$/;

export const REQUEST_TYPES = ["idea", "bug", "feature", "adjustment", "proposal"];
export const REQUEST_STATES = ["triage", "variants", "feedback", "prototype", "testing", "spec", "handed-off", "declined"];
export const CHANGE_STATES = ["new", "handled", "archived"];
// A catalog element: one real UI part drawn in every state it can be in. A screen card
// shares the states; `dropped` is one a person added that the agent could not make.
export const ELEMENT_STATES = ["current", "stale", "building", "dropped"];
// An issue on the Issues page: listed while it is open, archived once it is closed or no UI.
export const ISSUE_STATES = ["open", "archived"];
// Where an issue stands in the team's plan: the current sprint, the next one, someone's, or
// labelled for design (docs/issues.md).
export const ISSUE_BUCKETS = ["sprint", "next", "assigned", "label"];
// Undo takes back an item marked presented until the end of that day, UTC: the store
// writes the deadline, `undo_until`, and the page shows Undo only before it
// (docs/desk.md → The presentation).
const endOfDay = (iso) => { const t = Date.parse(iso); return Number.isNaN(t) ? null : new Date(Math.floor(t / 864e5) * 864e5 + 864e5 - 1000).toISOString().replace(/\.\d{3}Z$/, "Z"); };
const INBOX_KINDS = ["question", "request", "explore", "revise", "states", "build", "handoff", "teardown", "follow-up", "catalog", "map", "agenda", "figma", "screens", "slack", "draw", "person", "decision", "decision-check", "ci"];
// Where a screen on a card came from: the pull request, the agent's screens instance, a
// person, a live prototype, or a rebuild drawn from the code.
const SCREEN_SOURCES = ["pr", "issue", "instance", "person", "prototype", "rebuild", "sketch", "test"];
// Thread kinds: people ask, comment, raise a concern or note a change to one element;
// the agent asks (`asks`) when a step cannot go on without a person's answer. A private
// ask (`private`) is a question only its author and the agent see: Design Desk explains,
// it never changes the design from one (docs/desk.md → Private asks).
const THREAD_KINDS = ["question", "comment", "concern", "change", "asks", "private"];
// The five starters a private ask may begin with; each one's full brief for the agent is in
// docs/desk.md → Private asks. The page shows a short label, the agent reads the key.
const STARTERS = ["explain", "why", "fixed", "options", "ask-team"];
// The Desk pages a private ask can be about when no item is open.
const ASK_PAGES = ["new", "requests", "designs", "issues", "product", "people", "guide"];
// Who a viewer is to the store: the key a private ask's `owner` holds.
const viewerKey = (who) => (who && !who.agent ? who.email || who.sub || null : null);
// Whether a viewer (their key, or undefined for the agent) may see a conversation.
const sees = (t, viewer) => Boolean(t) && (t.kind !== "private" || viewer === undefined || t.owner === viewer);
// The step an agent's question blocks, which a person's answer resumes.
const ASK_STEPS = ["request", "explore", "revise", "states", "build", "handoff", "figma", "catalog", "map"];
// The ability an answer to Design Desk's question needs: it resumes the step the question
// blocked, so it takes what starting that step takes (docs/desk.md → Roles).
const ASK_ABILITY = { request: "request", explore: "revise", revise: "revise", states: "revise", build: "build", handoff: "revise", figma: "figma", catalog: "add", map: "add" };
const FIGMA_URL = /^https:\/\/([\w-]+\.)?figma\.com\/[^\s]{1,500}$/;

// GitHub issues and pull requests the Desk's items point at, kept here with their comments
// so previews and Design Desk's answers read them without a call to GitHub
// (docs/desk.md → GitHub on the Desk). The agent writes them; people only read them.
const GH_KEY = /^[\w.-]+\/[\w.-]+#\d+$/;
const GH = { records: 3000, body: 4000, comments: 60, comment: 1500, perWrite: 100, tries: 3 };

export class DeskError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new DeskError(400, m);
const forbidden = (m) => new DeskError(403, m);
const missing = (m) => new DeskError(404, m);

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

// Ids come from people's requests; only an own key of the table is an entry, so
// "__proto__" or "constructor" never reaches Object.prototype.
const own = (table, id) => (typeof id === "string" && Object.hasOwn(table, id) ? table[id] : undefined);

// A request without a title is named after the first sentence of its problem.
function titleOf(title, problem) {
  if (typeof title === "string" && title.trim()) return title;
  const first = String(problem || "").trim().split(/(?<=[.!?])\s|\n/)[0] || "";
  return first.length > 90 ? `${first.slice(0, 87).replace(/\s+\S*$/, "")}…` : first;
}

// Where a private ask was asked: an item (and the option it showed), or a Desk page.
function cleanContext(c, cards, decisions) {
  const o = c && typeof c === "object" ? c : {};
  const card = o.card == null || o.card === "" ? null : String(o.card);
  if (card && !own(cards, card)) throw bad(`context: no card ${card}`);
  const decision = !card && o.decision ? String(o.decision) : null;
  if (decision && !own(decisions, decision)) throw bad(`context: no decision ${decision}`);
  if (decision) return { card: null, page: null, decision, label: optText(o.label, 300, "context label") || "" };
  const page = card ? null : ASK_PAGES.includes(o.page) ? o.page : "guide";
  const v = card && typeof o.variant === "string" ? (own(cards, card).variants || []).find((x) => x.id === o.variant) : null;
  const state = v && typeof o.state === "string" && (v.states || []).some((x) => x.id === o.state) ? o.state : null;
  const part = v && o.part && typeof o.part === "object" && o.part.selector ? { selector: clean(o.part.selector, 500, "context part"), label: optText(o.part.label, 120, "context part label") } : null;
  const filter = page && typeof o.filter === "string" ? optText(o.filter, 40, "context filter") : "";
  return { card, page, ...(v ? { variant: v.id } : {}), ...(state ? { state } : {}), ...(part ? { part } : {}), ...(filter ? { filter } : {}), label: optText(o.label, 300, "context label") || "" };
}

function clean(s, max, name) {
  if (typeof s !== "string") throw bad(`${name} must be text`);
  const t = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) throw bad(`${name} is empty`);
  if (t.length > max) throw bad(`${name} is longer than ${max} characters`);
  return t;
}
const optText = (s, max, name) => (s === undefined || s === null || s === "" ? "" : clean(s, max, name));

// The skills a person switched on or off for one request, by skill name: {copy: true}.
const SKILL_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
function cleanSkills(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw bad("skills must be {name: on}");
  const e = Object.entries(v);
  if (e.length > 20) throw bad("skills names 20 skills at most");
  for (const [k, on] of e) if (!SKILL_NAME.test(k) || typeof on !== "boolean") throw bad("skills must be {name: on}");
  return e.length ? Object.fromEntries(e) : null;
}
// How many design options a request asks for: none, or one to five (docs/requests.md → Variants).
export const MAX_OPTIONS = 5;
function cleanCount(v, fallback = 3) {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_OPTIONS) throw bad(`options must be a whole number from 0 to ${MAX_OPTIONS}`);
  return n;
}

export function emptyDb() {
  return { version: 1, seq: { card: 0, thread: 0, asset: 0, item: 0, decision: 0, poll: 0, council: 0 }, cards: {}, threads: {}, assets: {}, inbox: {}, decisions: {}, github: {}, gh_failed: {}, prefs: {}, reads: {}, seen: {}, noted: {}, opened: {} };
}

// The bell's events that fold into one row per item and day, with their count.
const NOTE_FAMILY = { comment: "talk", reply: "talk", question: "talk", answer: "talk", "agent-asks": "talk", "dev-question": "talk", vote: "vote" };

export class Store {
  constructor(dir, { clock = now } = {}) {
    this.dir = dir;
    this.clock = clock;
    this.dbPath = join(dir, "db.json");
    this.assetDir = join(dir, "assets");
    mkdirSync(this.assetDir, { recursive: true });
    this.load();
  }

  load() {
    // A role stored before 1.59.0 as `lead` (a vote, a decision's author, who approved) reads as `admin`.
    this.db = existsSync(this.dbPath) ? JSON.parse(readFileSync(this.dbPath, "utf8"), (k, v) => (k === "role" && v === "lead" ? "admin" : v)) : emptyDb();
    // A store from before `opened` (who loaded the Desk, docs/desk.md → People) starts it from
    // what it already knows: an address that set a preference, read the bell or opened an item
    // did load the Desk. Without this, everyone already on it would read as never having come.
    const seed = this.db.opened === undefined;
    for (const k of Object.keys(emptyDb())) if (this.db[k] === undefined) this.db[k] = emptyDb()[k];
    if (seed) for (const k of ["prefs", "seen", "reads"]) for (const key of Object.keys(this.db[k] || {})) {
      const e = String(key).toLowerCase();
      if (e.includes("@") && !own(this.db.opened, e)) Object.defineProperty(this.db.opened, e, { value: this.clock(), enumerable: true, writable: true, configurable: true });
    }
    this.db.seq = { ...emptyDb().seq, ...this.db.seq };
    for (const d of Object.values(this.db.decisions)) upgradeDecision(d);
    this.mtime = existsSync(this.dbPath) ? statSync(this.dbPath).mtimeMs : 0;
    this.writeInbox();
  }

  // Another writer replaced db.json (a restore from the backup): read it before acting,
  // so the memory of this process never writes an older store over it.
  reloadIfChanged() {
    const m = existsSync(this.dbPath) ? statSync(this.dbPath).mtimeMs : 0;
    if (m !== this.mtime) { this.load(); return true; }
    return false;
  }

  save() {
    const text = JSON.stringify(this.db);
    const tmp = `${this.dbPath}.tmp-${process.pid}`;
    writeFileSync(tmp, text);
    renameSync(tmp, this.dbPath);
    this.mtime = statSync(this.dbPath).mtimeMs;
    this.bytes = text.length;
    this.writeInbox();
  }

  full() { return (this.bytes ?? (existsSync(this.dbPath) ? statSync(this.dbPath).size : 0)) > LIMITS.dbBytes; }

  // inbox.json is what the inbox pre-flight reads: a local file, so an idle tick
  // never wakes the model and never needs the server to answer.
  // github-refs.json is what the watch pre-flight reads: every issue and pull request the
  // cards point at, with when GitHub last changed the copy kept of it and how many reads of
  // it failed in a row (docs/watch.md → Comments on GitHub). A local file, like inbox.json.
  writeGithubRefs() {
    const refs = this.githubRefs().map((key) => ({ key, updated: own(this.db.github, key)?.updated || null, tries: own(this.db.gh_failed, key)?.tries || 0 }));
    const p = join(this.dir, "github-refs.json"), tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify({ updated: this.clock(), refs }));
    renameSync(tmp, p);
  }

  writeInbox() {
    this.writeGithubRefs();
    const open = [], claimed = [];
    // A private ask's item says so: the agent answers it in its thread and changes nothing.
    const priv = new Map(Object.values(this.db.threads).filter((t) => t.kind === "private").map((t) => [t.id, t.context || {}]));
    for (const it of Object.values(this.db.inbox)) {
      if (it.state === "open") open.push(pick(it));
      else if (it.state === "claimed") claimed.push({ ...pick(it), claimed_by: it.claimed_by, claimed_at: it.claimed_at, claimed_started: it.claimed_started || it.claimed_at });
    }
    const doc = { updated: this.clock(), claim_ttl_min: LIMITS.claimTtlMin, open, claimed };
    const p = join(this.dir, "inbox.json"), tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1));
    renameSync(tmp, p);
    function pick(i) { return { id: i.id, kind: i.kind, card: i.card, thread: i.thread || null, created: i.created, ...(priv.has(i.thread) ? { private: true, context: priv.get(i.thread) } : {}), ...(i.person ? { person: i.person } : {}), ...(i.scope ? { scope: i.scope } : {}), ...(i.ask_first ? { ask_first: true } : {}), ...(i.implement ? { implement: true } : {}), ...(i.close_earlier ? { close_earlier: i.close_earlier } : {}), ...(i.comment_on ? { comment_on: i.comment_on } : {}), ...(i.variant ? { variant: i.variant } : {}), ...(i.element ? { element: i.element } : {}), ...(i.part ? { part: i.part } : {}) }; }
  }

  next(kind, prefix) { this.db.seq[kind] += 1; return `${prefix}-${this.db.seq[kind]}`; }

  card(id) { const c = own(this.db.cards, id); if (!c) throw missing(`no card ${id}`); return c; }
  thread(id) { const t = own(this.db.threads, id); if (!t) throw missing(`no thread ${id}`); return t; }
  // A conversation a viewer acts on: another person's private ask is not there for them.
  threadFor(id, who) { const t = this.thread(id); if (!sees(t, who?.agent ? undefined : viewerKey(who))) throw missing(`no thread ${id}`); return t; }
  // The ability a person's reply, answer or reopen on a conversation needs: an answer to the
  // agent's question takes its step's, a change note's follow-up redraws (`change`), anything
  // else is a comment. Marking one done (`resolve`) takes the same, and a member's ability for
  // someone else's conversation.
  threadNeed(id, who, move = "reply") {
    const t = this.threadFor(id, who);
    if (t.kind === "asks") return ASK_ABILITY[t.step] || "revise";
    if (t.kind === "change") return "change";
    const mine = addressesOf(who).includes(String(t.messages?.[0]?.by?.email || "").toLowerCase());
    return move === "resolve" && t.kind !== "private" && !mine ? "resolve" : "comment";
  }
  item(id) { const i = own(this.db.inbox, id); if (!i) throw missing(`no inbox item ${id}`); return i; }
  decision(id) { const d = own(this.db.decisions, id); if (!d) throw missing(`no decision ${id}`); return d; }
  // A card's warnings: the decisions it goes against that are still in force.
  activeConflicts(c) { return (c.conflicts || []).filter((x) => own(this.db.decisions, x.decision)?.status === "active"); }

  // ---------- the decision check (docs/desk.md → Decisions → The check) ----------

  // What a card is about: its own concepts, its impact's and those its last check read by.
  conceptsOf(c) { return [...new Set([...(c.concepts || []), ...(c.impact?.concept ? [String(c.impact.concept).toLowerCase()] : []), ...(c.decision_check?.concepts || [])])]; }
  // A card still worked on whose design a decision steers: an open request once it is triaged
  // or has options, a new change, an open issue with a sketch.
  checkable(c) {
    if (c.kind === "request") return !["declined", "handed-off"].includes(c.status) && Boolean(c.triage || (c.variants || []).length);
    if (c.kind === "change") return c.status === "new";
    if (c.kind === "issue") return c.status === "open" && (c.sketches || []).length > 0;
    return false;
  }
  // The decisions in force a card could go against: by its concepts, or by the concepts and
  // words asked for instead (to narrow a long read); a card about nothing named reads every one.
  decisionsFor(c, { concepts = [], q = "" } = {}) {
    const asked = concepts.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    const words = String(q || "").toLowerCase().split(/[\s,]+/).filter((w) => w.length > 2);
    const about = asked.length || words.length ? asked : this.conceptsOf(c);
    return Object.values(this.db.decisions).filter((d) => d.status === "active" && ((!about.length && !words.length)
      || about.some((a) => d.concepts.some((x) => x.includes(a) || a.includes(x)))
      || words.some((w) => `${d.text} ${d.why} ${d.concepts.join(" ")}`.toLowerCase().includes(w))))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  }
  // Each option at its version, with its states: what a check was made of.
  static checkedOptions(c) { return Object.fromEntries((c.variants || []).map((v) => [v.id, `${v.version || 1}${(v.states || []).map((x) => ` ${x.id}.${x.version || 1}`).join("")}`])); }
  // A design changed with no check, or a decision came that it may go against: one check is queued.
  queueCheck(c, who, note) {
    if (!c?.id || !this.checkable(c) || !this.decisionsFor(c).length) return null;
    return this.pendingOrNew("decision-check", c.id, who, note);
  }
  // A new decision, or one in force again: every card worked on that is about the same thing is checked again.
  checkAgainst(d) {
    for (const c of Object.values(this.db.cards)) {
      const about = this.conceptsOf(c);
      if (!about.length || !this.checkable(c) || !about.some((a) => d.concepts.some((x) => x.includes(a) || a.includes(x)))) continue;
      // The item names the decisions that queued it: only a check that read them closes it.
      const it = this.pendingOrNew("decision-check", c.id, { agent: true }, `${d.id} is in force: check the design against it.`);
      it.decisions = [...new Set([...(it.decisions || []), d.id])];
    }
  }
  // What the agent reads for a check: the card's options, the decisions in force it could go
  // against, what it goes against now and its last check.
  decisionCheck(id, { concepts = [], q = "" } = {}) {
    const c = this.card(id), all = this.decisionsFor(c, { concepts, q });
    // A long list is cut, and says so: the agent narrows it with concepts or words until it is whole.
    return { card: c.id, kind: c.kind, title: c.title, concepts: this.conceptsOf(c),
      options: (c.variants || []).map((v) => ({ id: v.id, name: v.name, version: v.version || 1 })),
      decisions: all.slice(0, LIMITS.checkRead).map((d) => ({ id: d.id, text: d.text, why: d.why, concepts: d.concepts, at: d.at, author: d.author })),
      total: all.length, truncated: all.length > LIMITS.checkRead,
      conflicts: this.activeConflicts(c), last: c.decision_check || null };
  }

  // ---------- reads ----------

  listCards({ kind, status, viewer, who = null } = {}) {
    const me = addressesOf(who);
    // One index of the pull requests sent requests are built by, for the whole list.
    let index = null;
    const builds = (c) => (c.kind === "change" ? this.buildsOf(c, (index ||= this.buildsIndex())) : null);
    return Object.values(this.db.cards)
      .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map((c) => ({
        id: c.id, kind: c.kind, title: c.title, status: c.status, summary: c.summary || "",
        created: c.created, updated: c.updated, source: c.source || null,
        screens: (c.screens || []).length, variants: (c.variants || []).length,
        open_threads: (c.threads || []).filter((t) => sees(this.db.threads[t], viewer) && this.db.threads[t]?.state !== "resolved").length,
        acked: viewer ? Boolean(c.acks?.[viewer]) : false, handled: c.handled?.at || null,
        // Whether this person has opened it: the list shows an unopened item's title bold (docs/desk-page.md → Read and unread).
        read: viewer ? Boolean(own(this.db.reads, viewer)?.[c.id]) : true,
        // Closed with a decision: the list shows it in the decided ink, as the page does.
        decided: c.kind === "request" && c.status === "declined" && c.decided?.at || null,
        triage: c.triage?.verdict || null, prototype: c.prototype?.state || null, team_feedback: c.team_feedback || null,
        // A spec draft waits on a person: the list's dot reads it as the page does (docs/desk-page.md → A request's state in the list).
        spec: c.spec ? { review: c.spec.review || null } : null,
        // A Slack vote on its options: running, or one that ended (the list's Your turn, docs/desk-page.md → Pages and filters).
        voting: !c.vote_ended && (c.polls || []).some((x) => x.state === "open"), voted: Boolean(c.vote_ended) || (c.polls || []).some((x) => x.state === "closed"),
        type: c.request?.type || null, reporter: c.origin?.reporter || null,
        // Whose tab a request is on: For Developers (a developer approves it) or For Designers (docs/desk.md → For Developers or For Designers).
        for: ["request", "change", "issue"].includes(c.kind) ? this.forOf(c) : null,
        // Whether the viewer voted on it: Your turn reads it on a row (docs/desk-page.md → Pages and filters).
        voted_mine: c.kind === "request" && Object.values(c.votes || {}).some((x) => Object.keys(x || {}).some((e) => me.includes(e.toLowerCase()))),
        group: c.group || null, thumb: c.screens?.[0]?.asset || c.design_part?.shot || null, state_count: (c.states || []).length, looks: (c.history || []).length,
        busy: Object.values(this.db.inbox).some((i) => i.card === c.id && i.state !== "done" && i.kind !== "question"),
        asks: (c.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open"),
        in_progress: c.kind === "change" && Boolean(c.source?.pr) && !c.source?.merged_at,
        automated: Boolean(c.origin?.automated),
        // Where it came from and who: the page's source label (docs/desk.md → Where a card came from).
        origin: c.origin || null, by: c.created_by || null, from: c.request?.from || null,
        path: c.path || null, period: c.period || null, suggested: c.call_suggestion || null,
        // When a screen or a part was drawn and last looked at again: the list says drawn: (docs/map.md → A screen card).
        drawn: c.drawn || null, checked: c.checked || null,
        bucket: c.bucket || null, needs: c.needs || [], sketches: (c.sketches || []).length,
        attention: this.attentionOf(c), conflicts: this.activeConflicts(c).length,
        // The decisions in force it goes against, by number: the list's red ! (docs/desk.md → Decisions).
        against: [...new Set(this.activeConflicts(c).map((x) => x.decision))],
        designed: this.designedOf(c), sent_card: this.sentCardOf(c), builds: builds(c),
        // An element from an approved design, not from the product (docs/catalog.md → From approved designs).
        design: c.design ? { card: c.design.card, option: c.design.option, version: c.design.version, change: c.design.change, of: c.design.of } : null,
        design_check: c.design_check ? { verdict: c.design_check.verdict, request: c.design_check.request, differences: c.design_check.differences.map((x) => ({ element: x.element, card: x.card })) } : null,
        in_catalog: c.in_catalog ? c.in_catalog.cards.length : 0,
        // Compared with its Figma frame (the figma skill): Product → Differences lists it.
        figma: c.figma_check ? figmaRow(c.figma_check) : null,
        // An approved design a developer marked done (docs/desk-page.md → Designs).
        built: c.built?.at || null,
        // Earlier Designs records of a request sent, reopened and sent again (docs/desk-page.md → Designs).
        sends: (c.sends || []).map((s) => ({ closed: s.closed, built: s.built?.at || null })),
      }));
  }

  // An issue that already went through Design Desk: a request made from it, or whose spec
  // went to it, was sent to developers (docs/issues.md → On the Desk). The newest one; null
  // for any other card.
  designedOf(c) {
    if (c.kind !== "issue") return null;
    const key = issueKey(c.source?.url);
    const r = Object.values(this.db.cards)
      .filter((x) => x.kind === "request" && x.status === "handed-off" && (x.request?.from === c.id || (key && issueKey(x.spec?.issue_url) === key)))
      .sort((a, b) => b.updated.localeCompare(a.updated))[0];
    return r ? { card: r.id, title: r.title, at: r.updated, url: r.spec?.issue_url || r.spec?.pr_url || null } : null;
  }

  // The request a change's pull request builds: its spec went to this pull request, or to the
  // issue whose pull requests (the Desk's GitHub copy, `linked`) include it. The newest send
  // wins. The index maps each such pull request's key to its request, built once per read.
  buildsIndex() {
    const index = new Map();
    const sent = Object.values(this.db.cards).filter((x) => x.kind === "request" && x.spec)
      .sort((a, b) => b.updated.localeCompare(a.updated));
    for (const r of sent) {
      const keys = [issueKey(r.spec.pr_url), ...(own(this.db.github, issueKey(r.spec.issue_url) || "")?.linked || []).map((p) => issueKey(p.url))];
      for (const k of keys) if (k && !index.has(k)) index.set(k, r);
    }
    return index;
  }

  buildsOf(c, index = null) {
    if (c.kind !== "change") return null;
    const key = issueKey(c.source?.url) || (c.source?.repo && c.source?.pr ? `${String(c.source.repo).toLowerCase()}#${c.source.pr}` : null);
    const r = key && (index || this.buildsIndex()).get(key);
    return r ? { card: r.id, title: r.title, at: r.updated, url: r.spec.issue_url || r.spec.pr_url || null } : null;
  }

  // The open pull request a request came from (`request.from`, a change card): its spec may go
  // back to it as a comment (docs/handoff.md → Review before it goes). Null once it merged or
  // the Desk's GitHub copy says it is closed.
  fromPr(c) {
    const ch = c.kind === "request" && c.request?.from ? own(this.db.cards, c.request.from) : null;
    if (ch?.kind !== "change" || !ch.source?.pr || ch.source.merged_at) return null;
    const key = issueKey(ch.source.url) || (ch.source.repo ? `${String(ch.source.repo).toLowerCase()}#${ch.source.pr}` : null);
    const gh = key ? own(this.db.github, key) : null;
    if (gh?.state && !/^open$/i.test(gh.state)) return null;
    return { card: ch.id, pr: ch.source.pr, repo: ch.source.repo || null, url: ch.source.url || null };
  }

  // The Issues card of the issue a request's spec went to, once the issues run carded it.
  sentCardOf(c) {
    const key = c.kind === "request" ? issueKey(c.spec?.issue_url) : null;
    if (!key) return null;
    const x = Object.values(this.db.cards).find((i) => i.kind === "issue" && i.status !== "archived" && issueKey(i.source?.url) === key);
    return x ? x.id : null;
  }

  // Whether a card waits for a designer, and why (docs/desk.md → Needs a designer). A
  // change card carries the agent's judgement; a request's comes from where it stands;
  // a suggestion for the next call waits for a designer on either, whatever its status.
  // Null: not judged.
  // Whose tab a request, a change or an issue is on: For Developers or For Designers. A change
  // or an issue starts on the agent's judgement (`attention.level` developer → For Developers)
  // until a person moves it (`size`), as a request does (docs/desk.md → For Developers or For Designers).
  forOf(c) {
    if (c.size) return c.size.small ? "developers" : "designers";
    return (c.kind === "change" || c.kind === "issue") && c.attention?.level === "developer" ? "developers" : "designers";
  }

  attentionOf(c) {
    if (!["change", "request", "issue"].includes(c.kind)) return null;
    const suggested = c.call_suggestion ? ["Suggested for the presentation"] : [];
    if (c.kind === "request" && (c.status === "handed-off" || c.status === "declined"))
      return suggested.length ? { level: "designer", reasons: suggested } : null;
    // A change or an issue For Developers waits for a lead developer, not a designer: its reasons
    // stay its own level unless a decision it goes against, or the presentation, needs a designer.
    const judged = c.kind !== "request" && c.attention;
    const dev = c.kind !== "request" && this.forOf(c) === "developers";
    const reasons = !dev && judged && (c.attention.level === "designer" || c.size) ? [...c.attention.reasons] : [];
    const mine = dev && judged ? [...c.attention.reasons] : [];
    const against = this.activeConflicts(c).map((x) => x.decision);
    if (against.length) reasons.push(`Goes against ${[...new Set(against)].join(", ")}`);
    const differs = c.design_check?.verdict === "differs" ? `Differs from the approved design ${c.design_check.request}` : null;
    if (differs) (dev ? mine : reasons).push(differs);
    if (c.kind === "request") {
      const asks = (c.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open");
      const busy = Object.values(this.db.inbox).some((i) => i.card === c.id && i.state !== "done" && i.kind !== "question");
      if (asks) reasons.push("Design Desk is waiting for an answer");
      else if (!busy && c.status === "triage" && c.triage) reasons.push("Checked: draw options, decide or close it");
      else if (!busy && c.status === "variants" && c.team_feedback?.state === "waiting") reasons.push("Options are drawn: fine-tune them, then ask the team for feedback");
      // A request For Developers waits for a developer's approval, not a designer's.
      else if (!busy && !c.size?.small && c.status === "feedback") reasons.push("Options are ready: approve one, build it live or ask for changes");
      else if (!busy && !c.size?.small && c.status === "testing") reasons.push("The live prototype is ready to try and approve");
    }
    reasons.push(...suggested);
    if (reasons.length) return { level: "designer", reasons: [...mine, ...reasons] };
    if (dev) return { level: "developer", reasons: mine };
    return c.attention ? { level: c.attention.level, reasons: c.attention.reasons } : null;
  }

  // `viewer` is the reading person's key; the agent reads without one and sees every
  // conversation, a person sees no one else's private ask.
  getCard(id, { viewer } = {}) {
    const c = this.card(id);
    // A conflict carries the decision's words and where it stands, so the page warns without another read.
    const conflicts = (c.conflicts || []).map((x) => { const d = own(this.db.decisions, x.decision); return { ...x, text: d?.text || "", status: d?.status || "revoked", replaced_by: d?.revoked?.replaced_by || null }; });
    // Each decision the card cites, with its words and whether it is still in force.
    const cited = Object.fromEntries([...(c.decisions || []), ...(c.impact?.decisions || []).map((x) => x.id).filter(Boolean), ...shapedBy(c)]
      .map((id) => { const d = own(this.db.decisions, id); return [id, { text: d?.text || "", status: d?.status || "revoked" }]; }));
    return { ...c, conflicts, cited, attention: this.attentionOf(c), ...(["request", "change", "issue"].includes(c.kind) ? { for: this.forOf(c) } : {}), ...(c.kind === "request" ? { from_pr: this.fromPr(c) } : {}), designed: this.designedOf(c), sent_card: this.sentCardOf(c), builds: this.buildsOf(c), threads: (c.threads || []).map((t) => this.db.threads[t]).filter((t) => sees(t, viewer)), waiting: this.waitingFor(c.id, viewer) };
  }

  // Work the agent has been asked for on a card and not finished, oldest first.
  waitingFor(cardId, viewer) {
    const usual = (i) => { const m = this.usualMinutes(i); return m ? { usual_min: m } : {}; };
    return Object.values(this.db.inbox).filter((i) => i.card === cardId && i.state !== "done" && (!i.thread || sees(this.db.threads[i.thread], viewer)))
      .sort((a, b) => a.created.localeCompare(b.created))
      .map((i) => ({ kind: i.kind, state: i.state, created: i.created, ...(i.state === "claimed" ? { started: i.claimed_started || i.claimed_at, ...usual(i) } : {}), ...(i.scope ? { scope: i.scope } : {}), ...(i.variant ? { variant: i.variant } : {}), ...(i.element ? { element: i.element } : {}), ...(i.part?.label ? { part: i.part.label } : {}) }));
  }

  // How long Design Desk usually works on an item of this kind: the median of its last ten
  // finished ones, in minutes; none before three of them (docs/desk-page.md → The page).
  usualMinutes(item) {
    const took = Object.values(this.db.inbox).filter((i) => i.state === "done" && i.kind === item.kind && (i.scope || "") === (item.scope || "") && i.claimed_started && i.done_at)
      .sort((a, b) => b.done_at.localeCompare(a.done_at)).slice(0, 10)
      .map((i) => (Date.parse(i.done_at) - Date.parse(i.claimed_started)) / 60000).filter((m) => m >= 0).sort((a, b) => a - b);
    return took.length < 3 ? null : Math.max(1, Math.round(took[Math.floor(took.length / 2)]));
  }

  getAsset(id) {
    const a = own(this.db.assets, id);
    if (!a) throw missing(`no asset ${id}`);
    const buf = readFileSync(join(this.assetDir, a.file));
    const text = /^text\/|json|svg/.test(a.contentType);
    return { id: a.id, name: a.name, kind: a.kind, contentType: a.contentType, encoding: text ? "utf8" : "base64", data: text ? buf.toString("utf8") : buf.toString("base64") };
  }

  // ---------- viewer actions ----------

  ack(cardId, who) {
    const c = this.card(cardId);
    c.acks = c.acks || {};
    c.acks[who.email || who.sub] = this.clock();
    this.save();
    return { acked: true };
  }

  // A designer marks a change handled: design has nothing more to do with it. Until then
  // the page counts the days it waits (config `change_due_days`).
  handle(cardId, who, on = true) {
    const c = this.card(cardId);
    if (!["change", "issue"].includes(c.kind)) throw bad("only a change or an issue is marked handled");
    // A lead developer marks a change For Developers handled; one that goes against a decision
    // in force stays a designer's (docs/desk.md → For Developers or For Designers).
    if (!who?.agent && !can(who?.role, "handle")) {
      if (!can(who?.role, "handle-small") || this.forOf(c) !== "developers") throw forbidden("Only designers can mark this handled. A lead developer marks a change or an issue For Developers handled.");
      if (this.activeConflicts(c).length) throw forbidden(`This ${c.kind} goes against a decision in force: a designer marks it handled.`);
    }
    // An issue keeps its status, which its run sets: handled only takes it off the Desk's lists
    // and out of drawing (docs/issues.md → On the Desk).
    if (c.kind === "issue") { if (on) c.handled = { by: person(who), at: this.clock() }; else delete c.handled; }
    else if (on) { c.status = "handled"; c.handled = { by: person(who), at: this.clock() }; }
    else { c.status = "new"; delete c.handled; }
    // A change whose pull request Design Desk's check holds (`ci_gate`, docs/watch.md → CI
    // gate): the check follows the mark, so the run sets it again — passed once handled.
    if (c.kind === "change" && ["failing", "passing"].includes(c.ci?.state)) this.pendingOrNew("ci", c.id, who, on ? "Marked handled: pass the check." : "Marked not handled: hold the check again.");
    this.save();
    return { card: c };
  }

  // A developer marks an approved design built, or takes it back (docs/desk-page.md → Designs).
  markBuilt(cardId, who, on = true) {
    const c = this.card(cardId);
    if (c.kind !== "request" || c.status !== "handed-off") throw bad("Only a design sent to developers is marked done.");
    // Taken back by a person, it stays theirs: a merged change marks it done no more.
    if (on) { c.built = { by: person(who), at: this.clock() }; delete c.not_built; } else { delete c.built; c.not_built = { by: person(who), at: this.clock() }; }
    this.save();
    return { card: c };
  }

  openThread(cardId, who, { kind = "comment", text, anchor = null, step = null, questions = null, shots = null, dev = false } = {}) {
    const c = this.card(cardId);
    // A developer's question to the designer of an approved design (docs/desk-page.md → Designs).
    if (dev && (kind !== "comment" || c.kind !== "request" || c.status !== "handed-off")) throw bad("A question for the designer belongs to a design sent to developers.");
    if (!THREAD_KINDS.includes(kind)) throw bad(`kind must be one of ${THREAD_KINDS.join(", ")}`);
    if (kind === "asks" && !who?.agent) throw forbidden("only Design Desk asks questions of this kind");
    if (kind === "private") throw bad("a private ask is opened with openPrivate");
    if (kind === "asks" && !ASK_STEPS.includes(step)) throw bad(`an agent question names the step it blocks: ${ASK_STEPS.join(", ")}`);
    if (kind === "change" && !(c.variants || []).some((v) => v.id === anchor?.variant)) throw bad("a change note belongs to one of the design options");
    if (anchor?.state && !(c.variants || []).find((v) => v.id === anchor.variant)?.states?.some((x) => x.id === anchor.state)) throw bad("That state is not drawn for this option.");
    if ((c.threads || []).length >= LIMITS.threadsPerCard) throw bad("This page holds at most 300 conversations. Mark some as done first.");
    const body = clean(text, LIMITS.text, "text");
    const pictures = this.changeShots(shots, who);
    const id = this.next("thread", "T");
    const t = {
      id, card: cardId, kind, state: "open", anchor: anchor && kind !== "private" ? cleanAnchor(anchor) : null,
      needs_agent: kind === "question" || kind === "change" || kind === "private", created: this.clock(),
      ...(kind === "private" ? { owner: viewerKey(who) } : {}), ...(dev ? { dev: true } : {}),
      messages: [{ by: who?.agent ? this.agentFor(cardId) : person(who), at: this.clock(), text: body, ...pictures }],
      // The agent's questions can come as a form; the answer resumes the step with its note.
      ...(kind === "asks" ? { step, resume_note: lastNote(this.db.inbox, cardId, step), ...resumeOf(this.db.inbox, cardId, step), ...(questions ? { questions: cleanQuestions(questions) } : {}) } : {}),
    };
    this.db.threads[id] = t;
    c.threads = [...(c.threads || []), id];
    if (kind !== "private") c.updated = this.clock();
    const item = kind === "question" || kind === "private" ? this.enqueue("question", cardId, id, who)
      : kind === "change" ? this.pendingOrNew("revise", cardId, who)
      : null;
    this.save();
    return { thread: t, inbox: item };
  }

  reply(threadId, who, text, max = LIMITS.text) {
    const t = this.threadFor(threadId, who);
    if (t.messages.length >= LIMITS.messagesPerThread) throw bad("This conversation is full. Start a new one below.");
    const body = clean(text, max, "text");
    t.messages.push({ by: person(who), at: this.clock(), text: body });
    let item = null;
    // A follow-up to a question goes back to the agent; a comment stays between people.
    // An item already claimed is being answered from what it saw, so a new message gets
    // an item of its own unless one is still open.
    if (t.kind === "question" || t.kind === "private") {
      t.state = "open"; t.needs_agent = true;
      if (!this.openItemFor(threadId)) item = this.enqueue("question", t.card, threadId, who);
    }
    // A person's answer to the agent's question resumes the step it blocked; a follow-up
    // on a change note goes back to the agent with the other notes.
    if (t.kind === "asks" && !who?.agent) { t.state = "answered"; item = this.pendingOrNew(t.step, t.card, who, t.resume_note || ""); const { implement, ...was } = t.resume || {}; if (was.variant && !item.variant) Object.assign(item, structuredClone(was)); if (implement) item.implement = true; }
    if (t.kind === "change" && !who?.agent) { t.state = "open"; t.needs_agent = true; item = this.pendingOrNew("revise", t.card, who); }
    if (t.kind !== "private") this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t, inbox: item };
  }

  // ---------- GitHub on the Desk ----------

  // Every issue and pull request a card points at: its source, where it came from, its
  // spec's issue. `card` limits it to one card.
  githubRefs(card = null) {
    const keys = new Set();
    for (const c of card ? [this.card(card)] : Object.values(this.db.cards).filter((x) => x.status !== "archived"))
      for (const k of [...refsOf(c), ...researchRefs(c)]) keys.add(k);
    return [...keys];
  }

  // The agent stores what it read on GitHub; the answer names the comments new since the
  // last read, which the watch run works through (docs/watch.md → Comments on GitHub).
  putGithub(records) {
    if (!Array.isArray(records) || !records.length || records.length > GH.perWrite) throw bad(`records: a list of 1 to ${GH.perWrite}`);
    const fresh = [];
    for (const x of records) {
      const key = String(x?.key || "").toLowerCase();
      if (!GH_KEY.test(key)) throw bad(`records: "${x?.key}" is not owner/repo#number`);
      if (!["issue", "pr"].includes(x.kind)) throw bad(`${key}: kind is issue or pr`);
      const all = (Array.isArray(x.comments) ? x.comments : []).map((m) => ({
        author: optText(m?.author, 100, "comment author"), at: optText(m?.at, 40, "comment at"),
        url: /^https:\/\/github\.com\//.test(String(m?.url || "")) ? String(m.url).slice(0, 500) : "",
        body: String(m?.body ?? "").slice(0, GH.comment),
      }));
      // Every fetched comment is compared with the copy, so none new is missed; the copy
      // keeps the newest ones. The first read of an item has nothing new.
      const was = own(this.db.github, key), seen = new Set((was?.comments || []).map((m) => `${m.at}|${m.author}`));
      const known = was?.comments?.length ? was.comments[0].at : null;
      const added = was ? all.filter((m) => !seen.has(`${m.at}|${m.author}`) && (!known || m.at >= known)) : [];
      // A comment the watch run marked as about the design keeps its mark through every read.
      const marked = new Set((was?.comments || []).filter((m) => m.design).map((m) => `${m.at}|${m.author}`));
      const comments = all.slice(-GH.comments).map((m) => (marked.has(`${m.at}|${m.author}`) ? { ...m, design: true } : m));
      this.db.github[key] = {
        key, kind: x.kind, title: String(x.title || key).replace(/\s+/g, " ").trim().slice(0, LIMITS.title) || key, state: optText(x.state, 30, "state"),
        url: /^https:\/\/github\.com\//.test(String(x.url || "")) ? String(x.url).slice(0, 500) : "",
        author: optText(x.author, 100, "author"), labels: (Array.isArray(x.labels) ? x.labels : []).slice(0, 20).map((l) => String(l).slice(0, 60)),
        assignees: (Array.isArray(x.assignees) ? x.assignees : []).slice(0, 10).map((a) => String(a).slice(0, 100)),
        // No list read this time (`linked` left out): the one from before stays.
        linked: !Array.isArray(x.linked) ? (was?.linked || []) : x.linked.slice(0, 10).filter((p) => /^https:\/\/github\.com\//.test(String(p?.url || ""))).map((p) => ({ title: String(p.title || "").slice(0, LIMITS.title), url: String(p.url).slice(0, 500), state: optText(p.state, 30, "state"), author: optText(p.author, 100, "author") })),
        body: String(x.body ?? "").slice(0, GH.body), updated: optText(x.updated, 40, "updated"), comments, fetched: this.clock(),
      };
      if (own(this.db.gh_failed, key)) delete this.db.gh_failed[key];
      if (added.length) fresh.push({ key, cards: this.cardsOf(key), comments: added });
    }
    const all = Object.values(this.db.github);
    if (all.length > GH.records) for (const x of all.sort((a, b) => a.fetched.localeCompare(b.fetched)).slice(0, all.length - GH.records)) delete this.db.github[x.key];
    this.save();
    return { stored: records.length, fresh };
  }

  // The refs github-sync could not read (a mistyped number, a private repository): each failed
  // read counts. After GH.tries in a row the watch gate stops opening a run for it, and the
  // answer names it once, that time (docs/watch.md → Comments on GitHub). A read clears it.
  failGithub(keys) {
    if (!Array.isArray(keys) || !keys.length || keys.length > GH.perWrite) throw bad(`keys: a list of 1 to ${GH.perWrite}`);
    const live = new Set(this.githubRefs()), gaveUp = [];
    for (const k of Object.keys(this.db.gh_failed)) if (!live.has(k)) delete this.db.gh_failed[k];
    for (const raw of keys) {
      const key = String(raw || "").toLowerCase();
      if (!GH_KEY.test(key)) throw bad(`keys: "${raw}" is not owner/repo#number`);
      if (!live.has(key)) continue;
      const tries = (own(this.db.gh_failed, key)?.tries || 0) + 1;
      Object.defineProperty(this.db.gh_failed, key, { value: { tries, at: this.clock() }, enumerable: true, writable: true, configurable: true });
      if (tries === GH.tries) gaveUp.push(key);
    }
    this.save();
    return { gave_up: gaveUp };
  }

  github(keys) { return keys.map((k) => own(this.db.github, String(k).toLowerCase())).filter(Boolean); }
  // An issue's comment about the design or the UI, as the watch run judged it: the only kind an
  // issue's preview shows (docs/watch.md → Comments on GitHub). `design: false` takes it back.
  markGithub(key, { at, author, design = true } = {}) {
    const x = own(this.db.github, String(key || "").toLowerCase());
    if (!x) throw missing(`the Desk keeps no copy of ${key}; run design desk github-sync first`);
    if (x.kind !== "issue") throw bad(`${x.key} is a pull request: only an issue's comments are marked`);
    const m = (x.comments || []).find((c) => c.at === String(at || "") && c.author === String(author || ""));
    if (!m) throw missing(`${x.key} has no comment by ${author} at ${at} in the Desk's copy`);
    if (design === false) delete m.design; else m.design = true;
    this.save();
    return { key: x.key, comment: { at: m.at, author: m.author, design: Boolean(m.design) } };
  }
  cardsOf(key) { return Object.values(this.db.cards).filter((c) => refsOf(c).includes(key)).map((c) => c.id); }

  // A private ask: a person's own question, about the item or the Desk page they were on.
  // It sits on no card's list of conversations; only `privateAsks` hands it back, to its
  // author (docs/desk.md → Private asks).
  openPrivate(who, { text, starter = null, context = {} } = {}) {
    const owner = viewerKey(who);
    if (!owner) throw forbidden("a private ask is a person's own question");
    if (starter !== null && !STARTERS.includes(starter)) throw bad(`starter must be one of ${STARTERS.join(", ")}`);
    const ctx = cleanContext(context, this.db.cards, this.db.decisions);
    // The issues and pull requests the item points at go with it, for the agent to read.
    if (ctx.card) { const refs = refsOf(this.card(ctx.card)); if (refs.length) ctx.refs = refs; }
    const mine = Object.values(this.db.threads).filter((t) => t.kind === "private" && t.owner === owner);
    if (mine.length >= LIMITS.threadsPerCard) throw bad("You have 300 private asks. Mark some as done first.");
    const id = this.next("thread", "T");
    const t = { id, card: ctx.card, kind: "private", owner, context: ctx, ...(starter ? { starter } : {}), state: "open", anchor: null, needs_agent: true, created: this.clock(),
      messages: [{ by: person(who), at: this.clock(), text: clean(text, LIMITS.text, "text") }] };
    this.db.threads[id] = t;
    const item = this.enqueue("question", ctx.card, id, who);
    this.save();
    return { thread: t, inbox: item };
  }

  // What a person chose for themselves on the page, kept by their email (docs/desk.md → The
  // menu): the day or night mode (null follows their system) and simple mode (null: on for a
  // viewer, off for every other role).
  prefsOf(who) {
    const key = viewerKey(who);
    const p = (key && own(this.db.prefs, key)) || {};
    // figma: the Figma comparisons shown to this person (null: hidden until they turn it on).
    return { theme: p.theme || null, simple: typeof p.simple === "boolean" ? p.simple : null, figma: typeof p.figma === "boolean" ? p.figma : null };
  }

  // Only the keys given change; a person with neither left set has no entry.
  setPrefs(who, prefs = {}) {
    const key = viewerKey(who);
    if (!key) throw bad("only a person has preferences");
    const { theme, simple, figma } = prefs;
    if ("theme" in prefs && theme !== null && theme !== "light" && theme !== "dark") throw bad("theme must be light, dark or null");
    if ("simple" in prefs && simple !== null && typeof simple !== "boolean") throw bad("simple must be true, false or null");
    if ("figma" in prefs && figma !== null && typeof figma !== "boolean") throw bad("figma must be true, false or null");
    const next = { ...this.prefsOf(who), ...("theme" in prefs ? { theme } : {}), ...("simple" in prefs ? { simple } : {}), ...("figma" in prefs ? { figma } : {}) };
    if (next.theme === null && next.simple === null && next.figma === null) delete this.db.prefs[key];
    else Object.defineProperty(this.db.prefs, key, { value: { ...(next.theme ? { theme: next.theme } : {}), ...(next.simple !== null ? { simple: next.simple } : {}), ...(next.figma !== null ? { figma: next.figma } : {}), at: this.clock() }, enumerable: true, writable: true, configurable: true });
    this.save();
    return this.prefsOf(who);
  }

  // A person opened an item: from now on its title is not bold in their list, and only theirs
  // (docs/desk-page.md → Read and unread). The first open counts; later ones change nothing.
  markRead(cardId, who) {
    const c = this.card(cardId);
    const key = viewerKey(who);
    if (!key) return { read: false };
    const mine = own(this.db.reads, key) || {};
    if (Object.hasOwn(mine, c.id)) return { read: true };
    Object.defineProperty(mine, c.id, { value: this.clock(), enumerable: true, writable: true, configurable: true });
    Object.defineProperty(this.db.reads, key, { value: mine, enumerable: true, writable: true, configurable: true });
    this.save();
    return { read: true };
  }

  // What happened lately on the Desk, newest first, for the bell (docs/desk-page.md → Notifications).
  // Nothing new is logged: each event is read from what the store keeps anyway (a card's
  // creation, a message, a drawn option, a vote, an approval, a spec, a decision). A person
  // never sees their own doings, nor another person's private ask. A row is read once its
  // person clicked it (`noted`, its id) or marked all as read (`seen`, the newest row then);
  // the unread rows For you are the bell's count.
  notifications(who, { limit = 50, days = 30 } = {}) {
    const key = viewerKey(who);
    const mine = new Set([who?.email, ...(who?.emails || [])].filter(Boolean).map((e) => String(e).toLowerCase()));
    const isMine = (by) => Boolean(by?.email) && mine.has(String(by.email).toLowerCase());
    const from = new Date(Date.parse(this.clock()) - days * 864e5).toISOString();
    const out = [];
    const push = (at, event, item, by, extra = {}, forYou = false) => { if (at && at >= from && !isMine(by)) out.push({ at, event, ...item, by: by || null, ...extra, for_you: forYou }); };
    const itemOf = (c) => ({ item: c.id, kind: c.kind, title: c.title || "", screen: c.request?.screen || c.path || null, status: c.status });
    for (const c of Object.values(this.db.cards)) {
      if (c.status === "archived" || c.kind === "digest") continue;
      const it = itemOf(c);
      // Yours: you filed it, approved it, voted on it or wrote in it; everything on it is then
      // For you, its messages included. The bell's For you shows these alone.
      const talked = (c.threads || []).some((tid) => (own(this.db.threads, tid)?.messages || []).some((m) => isMine(m.by)));
      const filed = [c.created_by, c.origin].some(isMine);
      const yours = filed || isMine(c.approved?.by) || talked || Object.values(c.votes || {}).some((x) => Object.keys(x || {}).some((e) => mine.has(e.toLowerCase())));
      const author = c.origin?.reporter && c.origin.channel !== "agent" ? { name: c.origin.reporter, email: c.origin.email || null, via: c.origin.channel } : c.created_by;
      if (["request", "change", "issue"].includes(c.kind)) push(c.created, `new-${c.kind}`, it, author, {}, yours);
      // Options drawn in one run come as one event: new ones, then redrawn ones.
      const runs = new Map();
      for (const v of c.variants || []) {
        if (!v.drawn) continue;
        const k = `${v.drawn}|${(v.version || 1) > 1 ? "redrawn" : "drawn"}`;
        runs.set(k, [...(runs.get(k) || []), v]);
      }
      // `variant` names where a click lands: the option drawn, voted on or approved.
      for (const [k, vs] of runs) { const [at, how] = k.split("|"); push(at, `options-${how}`, it, { agent: true }, { detail: vs.map((v) => v.name).join(", "), variant: vs[0].id }, yours); }
      for (const [variant, byKey] of Object.entries(c.votes || {})) {
        const name = (c.variants || []).find((v) => v.id === variant)?.name || variant;
        for (const [email, v] of Object.entries(byKey || {})) push(v.at, "vote", it, { email, role: v.role }, { detail: `${{ prefer: "Prefers", dislike: "Dislikes", concern: "Has a concern about" }[v.vote] || "Voted on"} ${name}`, variant }, yours);
      }
      // Asked for feedback: for every developer, and for whose request it is (docs/desk.md → Team feedback).
      if (c.team_feedback?.state === "open" && c.team_feedback.at) push(c.team_feedback.at, "feedback-asked", it, c.team_feedback.by, {}, yours || DEVELOPERS.includes(who?.role));
      if (c.approved?.at) push(c.approved.at, "approved", it, c.approved.by, { detail: (c.variants || []).find((v) => v.id === c.approved.variant)?.name || null, variant: c.approved.variant || null }, yours);
      if (c.spec?.at) push(c.spec.at, "spec", it, c.spec.by || { agent: true }, {}, yours);
      if (c.decided?.at) push(c.decided.at, "decided", it, c.decided.by, {}, yours);
      if (c.built?.at) push(c.built.at, "built", it, c.built.by, { designs: true }, yours);
      // A developer's question on Designs is for the designer who approved it, else for every designer (docs/desk-page.md → Designs).
      const designer = ["designer", "admin"].includes(c.approved?.by?.role) ? isMine(c.approved.by) : ["designer", "admin"].includes(who?.role);
      for (const tid of c.threads || []) {
        const t = own(this.db.threads, tid);
        // A private ask is never in a card's threads: its answers come in the loop below.
        if (!t || t.kind === "private") continue;
        (t.messages || []).forEach((m, i) => {
          const event = i === 0 ? (t.dev ? "dev-question" : t.kind === "asks" ? "agent-asks" : t.kind === "question" ? "question" : "comment")
            : m.by?.agent ? (t.kind === "question" ? "answer" : "reply") : "reply";
          push(m.at, event, it, m.by, { detail: String(m.text || "").replace(/\s+/g, " ").slice(0, 140), thread: t.id, msg: i, ...(t.dev ? { designs: true } : {}) }, yours || (t.dev && designer));
        });
      }
    }
    // Your private asks live outside the cards: Design Desk's answers to them are yours alone.
    for (const t of Object.values(this.db.threads)) {
      if (t.kind !== "private" || !key || t.owner !== key) continue;
      const c = t.card ? own(this.db.cards, t.card) : null;
      if (c && (c.status === "archived" || c.kind === "digest")) continue;
      const it = c ? itemOf(c) : { item: null, kind: null, title: t.context?.label || "The Desk", screen: null, status: null };
      (t.messages || []).forEach((m, i) => { if (m.by?.agent) push(m.at, "answer", it, m.by, { detail: String(m.text || "").replace(/\s+/g, " ").slice(0, 140), thread: t.id, msg: i, private: true }, true); });
    }
    for (const d of Object.values(this.db.decisions)) {
      const it = { item: d.id, kind: "decision", title: d.text, screen: null, status: d.status };
      push(d.recorded || d.at, "new-decision", it, d.author ? { email: d.author.email, name: d.author.name || d.author.login, role: d.author.role } : null);
      if (d.revoked?.at) push(d.revoked.at, "revoked", it, d.revoked.by || null, { detail: d.revoked.reason || null });
    }
    out.sort((a, b) => b.at.localeCompare(a.at) || (b.msg ?? 0) - (a.msg ?? 0));
    // Messages and votes on one item in one day come as one row: the newest leads, with how
    // many there are and who wrote them. A row is for you, private or neither, never a mix.
    const rows = [], open = new Map();
    for (const x of out) {
      const fam = NOTE_FAMILY[x.event];
      const k = fam && x.item ? [x.item, fam, x.at.slice(0, 10), x.for_you, Boolean(x.private), Boolean(x.designs)].join("|") : null;
      const row = k && open.get(k);
      if (row) {
        row.count += 1;
        if (x.thread && row.marks.length < 20) row.marks.push([x.thread, x.msg]);
        const who = x.by?.agent ? "agent" : String(x.by?.email || x.by?.name || "").toLowerCase();
        if (!row.people.some((p) => (p.agent ? "agent" : String(p.email || p.name || "").toLowerCase()) === who)) row.people.push(x.by);
        continue;
      }
      // `marks`: every message the row folds, for the page to light them all.
      const lead = { ...x, count: 1, people: x.by ? [x.by] : [], ...(x.thread ? { marks: [[x.thread, x.msg]] } : {}) };
      if (k) open.set(k, lead);
      rows.push(lead);
    }
    // `id`: the row's lead event, its thread and how many it folds, so a newer message on a
    // folded row, or a new thread in the same second, is a new, unread row.
    for (const x of rows) x.id = [x.event, x.item || "", x.at, x.thread || "", x.msg ?? "", x.count].join("|");
    const seen = (key && own(this.db.seen, key)) || null, noted = new Set((key && own(this.db.noted, key)) || []);
    for (const x of rows) x.read = Boolean(seen && x.at <= seen) || noted.has(x.id);
    return { items: rows.slice(0, limit), seen, unread: rows.filter((x) => x.for_you && !x.read).length };
  }

  // A person clicked one row: read for them alone. An id is kept while its row is still in the
  // bell and newer than `seen`, so the list stays short; a row read already writes nothing.
  markNoteRead(who, id) {
    const key = viewerKey(who);
    if (!key) return { read: false };
    const { items } = this.notifications(who, { limit: 500 });
    const row = items.find((x) => x.id === String(id || ""));
    if (!row) throw bad("That notification is not in the bell.");
    if (row.read) return { read: true };
    const seen = own(this.db.seen, key) || null;
    const keep = new Set(items.filter((x) => !seen || x.at > seen).map((x) => x.id));
    const ids = [...((own(this.db.noted, key)) || []).filter((x) => keep.has(x)), row.id];
    Object.defineProperty(this.db.noted, key, { value: ids, enumerable: true, writable: true, configurable: true });
    this.save();
    return { read: true };
  }

  // Mark as read in the bell: what is there now counts as read, for them alone. `seen` is the
  // newest event's time, so opening it again with nothing new writes nothing: the route sits
  // outside the write budget and must not save the store on every call.
  markSeen(who) {
    const key = viewerKey(who);
    if (!key) return { seen: null };
    const was = own(this.db.seen, key) || null;
    const at = this.notifications(who).items.reduce((m, x) => (x.at > m ? x.at : m), was || "");
    if (!at || at === was) return { seen: was };
    Object.defineProperty(this.db.seen, key, { value: at, enumerable: true, writable: true, configurable: true });
    if (own(this.db.noted, key)) delete this.db.noted[key];
    this.save();
    return { seen: at };
  }

  privateAsks(who) {
    const owner = viewerKey(who);
    return Object.values(this.db.threads).filter((t) => t.kind === "private" && owner && t.owner === owner)
      .sort((a, b) => b.created.localeCompare(a.created));
  }

  // A person answers the agent's form: per question one of its options, or null to leave
  // it to Design Desk, and an optional note. The answers become the reply's text too.
  answerForm(threadId, who, answers) {
    const t = this.threadFor(threadId, who);
    if (t.kind !== "asks" || !t.questions) throw bad("this conversation has no questions to fill in");
    if (t.state !== "open") throw bad("These questions are already answered.");
    if (!Array.isArray(answers) || answers.length !== t.questions.length) throw bad("answer every question, or leave it to Design Desk");
    const given = t.questions.map((q, i) => {
      const a = answers[i] || {};
      const choice = a.choice == null || a.choice === "" ? null : String(a.choice);
      if (choice !== null && !q.options.includes(choice)) throw bad(`"${choice}" is not an option of question ${i + 1}`);
      return { choice, note: optText(a.note, 500, "note") };
    });
    // Six full questions with notes stay under twice the text limit; the reply takes that.
    const text = t.questions.map((q, i) => { const a = given[i]; return `**${q.text}**\n${a.choice ?? "Leave it to Design Desk"}${a.note ? ` — ${a.note}` : ""}`; }).join("\n\n");
    const out = this.reply(threadId, who, text, LIMITS.text * 2);
    t.answers = given;
    this.save();
    return out;
  }

  resolve(threadId, who) {
    const t = this.threadFor(threadId, who);
    t.state = "resolved"; t.needs_agent = false;
    t.resolved = { by: person(who), at: this.clock() };
    this.save();
    return { thread: t };
  }

  // A conversation marked done opens again; a change note goes back to the agent.
  reopenThread(threadId, who) {
    const t = this.threadFor(threadId, who);
    if (t.state !== "resolved") throw bad("This conversation is still open.");
    delete t.resolved;
    t.state = "open";
    let item = null;
    if (t.kind === "change") { t.needs_agent = true; item = this.pendingOrNew("revise", t.card, who); }
    if (t.kind !== "private") this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t, inbox: item };
  }

  // A designer has the agent work comments on the options into the design: each becomes a
  // change note (its first kind kept as `was`) and one revise does them together.
  workIn(cardId, who, threadIds) {
    const c = this.card(cardId);
    if (c.kind !== "request") throw bad("only a design request's options take changes");
    if (designLocked(c)) throw bad(LOCKED);
    if ((c.status === "declined" || c.status === "handed-off")) throw bad("This request is closed. Press Reopen first.");
    if (!Array.isArray(threadIds) || !threadIds.length) throw bad("Pick the comments to work in.");
    const ts = [...new Set(threadIds.map(String))].slice(0, LIMITS.threadsPerCard).map((id) => {
      const t = own(this.db.threads, id);
      if (!t || t.card !== cardId || t.kind === "private") throw missing(`no conversation ${id} on this request`);
      if (t.kind === "asks") throw bad("Design Desk's own questions are answered, not worked in.");
      if (!(c.variants || []).some((v) => v.id === t.anchor?.variant)) throw bad("Only a comment on one of the design options can be worked in.");
      return t;
    });
    for (const t of ts) {
      if (t.kind !== "change") { t.was = t.kind; t.kind = "change"; }
      delete t.resolved;
      t.state = "open"; t.needs_agent = true;
      t.work_in = { by: person(who), at: this.clock() };
    }
    c.updated = this.clock();
    const item = this.pendingOrNew("revise", cardId, who);
    this.save();
    return { threads: ts, inbox: item };
  }

  vote(cardId, who, { variant, vote, note = "" }) {
    const c = this.card(cardId);
    if (!(c.variants || []).some((v) => v.id === variant)) throw bad(`no variant ${variant}`);
    if (!["prefer", "dislike", "concern", "none"].includes(vote)) throw bad("vote must be prefer, dislike, concern or none");
    if (c.vote_ended) throw bad("The vote on these options has ended.");
    c.votes = c.votes || {};
    c.votes[variant] = c.votes[variant] || {};
    const key = who.email || who.sub;
    if (vote === "none") delete c.votes[variant][key];
    else c.votes[variant][key] = { vote, role: who.role, note: optText(note, 500, "note"), at: this.clock() };
    c.updated = this.clock();
    this.save();
    return { votes: c.votes };
  }

  // A request is an idea for the design or a UI bug; a bug may come from a messenger,
  // filed by the agent on the reporter's behalf, with where to answer them (`origin`).
  // Types: an idea for the design; a UI bug; a feature (a larger piece, usually an
  // issue); an adjustment of UI a developer built (a pull request or a change card);
  // a proposal the agent made for a new feature.
  createRequest(who, { title, problem, goal = "", screen = "", steps = "", type = "idea", from = null, screens = [], origin = null, figma = "", vision = "", skills = null, options = 3, grill = false, auto = false, audience = null, carry = [] }) {
    if (figma && !FIGMA_URL.test(String(figma))) throw bad("The Figma link should start with https://www.figma.com/");
    if (!REQUEST_TYPES.includes(type)) throw bad(`type must be one of ${REQUEST_TYPES.join(", ")}`);
    if (audience !== null && audience !== undefined && !AUDIENCES.includes(audience)) throw bad(`audience must be one of ${AUDIENCES.join(", ")}`);
    // The request is the asker's words (docs/requests.md): an idea's are its problem (and how they
    // picture it); what should happen and the steps belong to a bug report, and to Design Desk's
    // own proposal. Nobody fills them in for an idea, so they are not kept for one.
    const reported = type === "bug" || type === "proposal";
    const request = {
      type, problem: clean(problem, LIMITS.text, "problem"), goal: reported ? optText(goal, LIMITS.text, "goal") : "",
      screen: optText(screen, 500, "screen"), steps: reported ? optText(steps, LIMITS.text, "steps") : "",
      from: from ? this.card(String(from)).id : null,
      figma: figma ? String(figma) : null,
      // How the person pictures it, and the skills they switched for its options (docs/requests.md).
      vision: optText(vision, LIMITS.text, "vision"), skills: cleanSkills(skills),
      // How many options to draw (0: none), whether Design Desk questions the person first
      // (the grill action), and whether the options start right after triage: only when the
      // person who filed it may start them (docs/requests.md).
      options: cleanCount(options), grill: grill === true, auto: auto === true && cleanCount(options) > 0,
    };
    const c = {
      kind: "request", status: "triage", created: this.clock(), updated: this.clock(), created_by: person(who),
      title: clean(titleOf(title, problem), LIMITS.title, "title"), request,
      summary: "", sections: [], screens: cleanRefs(screens, this.db.assets, "screens"), variants: [], votes: {}, threads: [], acks: {},
      triage: null, prototype: { state: "none" }, spec: null, origin: origin ? cleanOrigin(origin, this.db.cards) : null,
    };
    // For Developers or For Designers: what the asker chose; without a choice, a request from
    // Slack is the developers', any other the designers' (docs/desk.md → For Developers or For Designers).
    const forWhom = audience || (c.origin?.channel === "slack" ? "developers" : "designers");
    // `filed`: chosen when it was filed, so the page says nothing; a later move says who moved it.
    c.size = { small: forWhom === "developers", by: person(who), at: this.clock(), filed: true };
    // The pictures a person gave with the request (filed on the Desk, or reported in a channel
    // and filed by the agent) are theirs: the page shows them with the request, apart from
    // the ones Design Desk takes.
    if (!who?.agent || c.origin?.reporter) c.screens = c.screens.map((x) => ({ ...x, source: x.source || "person", ...(x.by || who?.agent ? {} : { by: person(who) }) }));
    // A request made from an approved one may carry its options over (docs/desk.md → Approved is
    // final): each starts here as it was there, at its latest version, and names where it came from.
    const source = request.from ? this.card(request.from) : null;
    if (Array.isArray(carry) && carry.length) {
      if (source?.kind !== "request") throw bad("Only options of a request carry over.");
      const picked = [...new Set(carry.map(String))];
      const vs = picked.map((vid) => (source.variants || []).find((v) => v.id === vid) || (() => { throw bad(`${source.id} has no option ${vid}`); })());
      c.variants = vs.map((v) => ({ id: v.id, name: v.name, purpose: v.purpose, rationale: v.rationale, fidelity: v.fidelity, asset: v.asset, figma_url: v.figma_url || null,
        stories: v.stories || null, reasons: v.reasons || null, states: structuredClone(v.states || []), elements: structuredClone(v.elements || []), version: 1,
        carried: { card: source.id, variant: v.id, version: v.version || 1 } }));
      request.carry = c.variants.map((v) => v.id);
      // Carried options are changed right after triage, as new ones would be drawn.
      if (auto === true) request.auto = true;
    }
    const id = this.next("card", "C");
    c.id = id;
    this.db.cards[id] = c;
    const item = this.enqueue(from ? "follow-up" : "request", id, null, who);
    this.save();
    return { card: c, inbox: item };
  }

  // A request's title, in a person's words: its author's, or anyone's who may close it
  // (`manage`). It stays theirs: a run's upsert no longer changes it (docs/desk.md → Roles).
  renameRequest(cardId, who, title, { manage = false } = {}) {
    const c = this.card(cardId);
    if (c.kind !== "request") throw bad("only a request is renamed here");
    const mine = [c.created_by?.email, c.origin?.email].some((x) => x && addressesOf(who).includes(String(x).toLowerCase()));
    if (!mine && !manage) throw forbidden("Only the person who filed it, a designer or an admin can rename this request.");
    c.title = clean(title, LIMITS.title, "title");
    c.renamed = { by: person(who), at: this.clock() };
    c.updated = c.renamed.at;
    this.save();
    return { card: c };
  }

  // A person's own option: their pictures as they are, on a page built here from the pictures
  // alone, with nothing drawn and no work queued (docs/requests.md → Variants, `picture`).
  // Only once the request is checked: triage comes before any option.
  addOwnOption(cardId, who, { name = "", note = "", images = [] }) {
    const c = this.card(cardId);
    if (c.kind !== "request" || c.request?.type === "bug") throw bad("only a design request has options");
    if (designLocked(c)) throw bad(LOCKED);
    if (["declined", "handed-off"].includes(c.status)) throw bad("This request is closed.");
    if (!c.triage) throw bad("Wait until Design Desk has checked the request, then add an option.");
    const vs = c.variants || [];
    if (vs.length >= 6) throw bad("A request has at most 6 options. Close one first.");
    if (!images.length) throw bad("Add at least one picture.");
    for (const im of images) if (!/^image\/(png|jpeg|webp)$/.test(im?.contentType || "") || !/^[A-Za-z0-9+/]+=*$/.test(String(im?.data || ""))) throw bad("Only PNG, JPEG or WebP pictures can be added.");
    const title = clean(String(name || "").trim() || `Option ${vs.length + 1}`, 80, "name"), why = optText(note, 1000, "note");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch])}</title>`
      + `<style>body{margin:0;background:#fff}img{display:block;max-width:100%;height:auto;margin:0 auto}</style></head><body>`
      + images.map((im, i) => `<img alt="Picture ${i + 1}" src="data:${im.contentType};base64,${im.data}">`).join("") + `</body></html>`;
    const asset = this.addAsset({ card: c.id, kind: "variant", name: "own-option.html", contentType: "text/html", data: html, encoding: "utf8" }).asset.id;
    const taken = new Set([...vs.map((v) => v.id), ...(c.dropped_options || []).map((x) => x.id)]);
    let n = 1; while (taken.has(`v${n}`)) n++;
    const at = this.clock();
    c.variants = [...vs, { id: `v${n}`, name: title, rationale: why,
      fidelity: "picture", asset, figma_url: null, stories: null, reasons: null, elements: [], states: [], alternatives: [], version: 1, history: [], drawn: at, by: person(who) }];
    // Its options are ready, as after a run draws them: a request filed on the Desk waits for a
    // person to ask the team (docs/desk.md → Team feedback); one the agent filed goes on to feedback.
    if (["triage", "variants"].includes(c.status) && c.team_feedback?.state !== "open") {
      if (c.created_by?.agent) { c.status = "feedback"; delete c.vote_ended; }
      else Object.assign(c, { status: "variants", team_feedback: c.team_feedback?.state === "waiting" ? c.team_feedback : { state: "waiting", since: at } });
    }
    c.updated = at;
    this.queueCheck(c, who, `${title} is a person's own option: check it against the decisions.`);
    this.save();
    return { card: c };
  }

  // A designer asks for a screen or an element Product does not have yet, in their own
  // words; the agent finds it in the product and makes the card (docs/map.md, catalog.md).
  // A screen already mapped at the address given is that card, and no new work.
  addToProduct(who, { kind, part, where = "", show = "", screens = [] }) {
    if (kind !== "screen" && kind !== "element") throw bad("kind must be screen or element");
    const wanted = { part: clean(part, 500, "part"), where: optText(where, 500, "where"), show: optText(show, 2000, "show") };
    if (kind === "screen" && /^\/\S*$/.test(wanted.where)) {
      const known = Object.values(this.db.cards).find((x) => x.kind === "screen" && x.path === wanted.where && x.status !== "dropped");
      if (known) return { card: known, existing: true, inbox: null };
    }
    const c = {
      kind, status: "building", created: this.clock(), updated: this.clock(), created_by: person(who),
      title: clean(titleOf(null, wanted.part), LIMITS.title, "title"), wanted,
      summary: "", sections: [], screens: cleanRefs(screens, this.db.assets, "screens"), variants: [], votes: {}, threads: [], acks: {}, prototype: { state: "none" },
    };
    c.id = this.next("card", "C");
    this.db.cards[c.id] = c;
    const item = this.enqueue(kind === "screen" ? "map" : "catalog", c.id, null, who);
    this.save();
    return { card: c, inbox: item };
  }

  // Where else it shows up: every screen there opens its card in Product → Screens. A place
  // without a card finds the screen of that name; a screen Product does not have yet gets a card
  // the next run draws, as + Add would (docs/map.md → A screen someone added). Only once Product
  // has screens at all: without the screens instance nothing would ever draw it.
  linkPlaces(impact, given = []) {
    const key = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    // A dropped screen counts too: a place named like one gets no link and no new card, so a name
    // the product does not have is not tried again on every write.
    const screens = Object.values(this.db.cards).filter((x) => x.kind === "screen");
    if (!screens.some((x) => x.status !== "dropped")) return;
    // A place that named a card keeps what it named: an unknown one is no link, never a new screen.
    for (const [i, p] of impact.places.entries()) {
      if (p.card || p.kind !== "screen" || given?.[i]?.card != null) continue;
      const name = (p.screen || String(p.where).split("→")[0]).trim() || p.where;
      // A live screen of that name wins over a dropped one of the same name.
      const named = screens.filter((x) => key(x.title) === key(name) || key(x.title) === key(p.where));
      const known = named.find((x) => x.status !== "dropped") || named[0];
      if (known) { p.card = known.status === "dropped" ? null : known.id; continue; }
      const { card } = this.addToProduct({ agent: true }, { kind: "screen", part: name, where: "", show: p.how || "" });
      screens.push(card);
      p.card = card.id;
    }
  }

  // One element of the approved option becomes an element of Product → Elements, marked as from
  // an approved design and not from the product (docs/catalog.md → From approved designs). No
  // run: the card copies the element's words, states and pictures; pressing it again updates it.
  addDesignToCatalog(cardId, who, element) {
    const c = this.card(cardId);
    if (c.kind !== "request") throw bad("Only a design request has elements to add.");
    const vs = c.variants || [];
    const v = vs.find((x) => x.id === c.approved?.variant) || (c.approved && vs.length === 1 ? vs[0] : null);
    if (!c.approved || !["spec", "handed-off"].includes(c.status) || !v) throw bad("Approve a design option first; its elements then go to the design catalog.");
    const e = elementsOf(v).find((x) => x.key === String(element || ""));
    if (!e) throw bad(`That element is not in ${v.name}.`);
    const id = this.copyToCatalog(c, v, person(who), e.key);
    this.save();
    return { card: c, added: id };
  }

  // An element card for an element of the approved option, made or updated (`key`); without a
  // key, after a run redraws the option's states, every element already in the catalog follows.
  copyToCatalog(c, v, by, key = null) {
    const at = this.clock(), mine = (e) => Object.values(this.db.cards).find((x) => x.kind === "element" && x.design?.card === c.id && x.design?.element === e.key);
    const els = elementsOf(v);
    let made = null;
    // A part the option no longer draws leaves the catalog: its card stays, marked, never deleted;
    // the part coming back brings it back (the loop below sets it current again).
    for (const x of Object.values(this.db.cards))
      if (x.kind === "element" && x.design?.card === c.id && x.status !== "dropped" && !els.some((e) => e.key === x.design.element))
        Object.assign(x, { status: "dropped", design: { ...x.design, gone: at }, updated: at });
    for (const e of els) {
      const was = mine(e);
      if (key ? e.key !== key : !was) continue;
      const of = e.element && own(this.db.cards, e.element)?.kind === "element" ? this.db.cards[e.element] : null;
      const states = e.states.map((x) => ({ name: x.name, how: x.how || "", stale: (x.of || 1) < (v.version || 1), asset: x.asset, shot: x.shot || null, selector: x.selector || null, use: x.use || "", stories: (x.stories || []).map((id) => (c.issue_brief?.stories || []).find((st) => st.id === id)?.text).filter(Boolean) }));
      const card = was || { kind: "element", created: at, created_by: by, sections: [], screens: [], variants: [], votes: {}, threads: [], acks: {}, prototype: { state: "none" } };
      Object.assign(card, {
        status: "current", title: clean(e.name, LIMITS.title, "title"), group: of?.group || "New in approved designs",
        summary: e.how || (of ? `How ${of.title} looks in the approved design.` : "A new part of the approved design."),
        design: { gone: null, card: c.id, request: c.title, variant: v.id, option: v.name, version: v.version || 1, element: e.key, change: e.change || (of ? "changed" : "new"), of: of?.id || null, approved: c.approved?.at || card.design?.approved || null, by: key ? by : card.design?.by || by, at: key ? at : card.design?.at || at },
        design_part: { asset: v.asset, selector: e.selector || null, shot: e.shot || null, view: e.view || null },
        design_states: states, states: states.map((x) => ({ name: x.name, how: x.how })), updated: at,
      });
      if (!was) { card.id = this.next("card", "C"); this.db.cards[card.id] = card; }
      made = card.id;
    }
    // Which elements of the option are in the catalog, and their cards.
    const cards = Object.values(this.db.cards).filter((x) => x.kind === "element" && x.design?.card === c.id && x.design?.variant === v.id && x.status !== "dropped");
    c.in_catalog = { variant: v.id, version: v.version || 1, cards: cards.map((x) => x.id), elements: Object.fromEntries(cards.map((x) => [x.design.element, x.id])), by: c.in_catalog?.by || by, at };
    c.updated = at;
    return made;
  }

  // Every approved design, for the watch run to find the one a shipped change builds
  // (docs/watch.md → Approved design): where its spec went and the elements it changes.
  approvedDesigns() {
    return Object.values(this.db.cards).filter((c) => c.kind === "request" && c.approved && ["spec", "handed-off"].includes(c.status)).map((c) => {
      const v = (c.variants || []).find((x) => x.id === c.approved.variant) || ((c.variants || []).length === 1 ? c.variants[0] : null);
      const from = own(this.db.cards, c.request?.from);
      return { card: c.id, title: c.title, status: c.status, approved: c.approved.at, variant: v?.id || null, option: v?.name || null, version: c.approved.version || v?.version || null, asset: v?.asset || null,
        issue_url: c.spec?.issue_url || null, pr_url: c.spec?.pr_url || null, from: from ? { card: from.id, kind: from.kind, url: from.source?.url || null } : null,
        elements: v ? elementsOf(v).map((e) => ({ key: e.key, name: e.name, change: e.change, of: e.element || null, file: (e.element && own(this.db.cards, e.element)?.source?.file) || null, states: e.states.length })) : [],
        in_catalog: c.in_catalog?.elements || {} };
    });
  }

  // A designer takes an option off the request, as a tab is closed: its votes and notes stay
  // in the record; the last option, and the one a live prototype is built from, stay
  // (docs/requests.md → Taking an option off).
  dropOption(c, who, variant) {
    const v = (c.variants || []).find((x) => x.id === variant);
    if (!v) throw bad("That design option is not on this request.");
    if (c.variants.length < 2) throw bad(`${v.name} is the only option. Close the request instead.`);
    if (c.live_pick?.variant === v.id && (["building", "live"].includes(c.prototype?.state) || Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === c.id && i.kind === "build"))) throw bad(`The live prototype is built from ${v.name}. Build another option first.`);
    // An approval or the presentation that names the option would point at nothing.
    if (c.approved?.variant === v.id) throw bad(`${v.name} is the approved option. Reopen the request first.`);
    // A presented one too: the record says which design the meeting saw, and Undo queues it again.
    if (c.agenda?.status !== "removed" && c.agenda?.variant === v.id) throw bad(`${v.name} is on the presentation${c.agenda.status === "presented" ? " the team saw" : ""}. Take it off the presentation first.`);
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === c.id && ["explore", "revise", "states", "handoff"].includes(i.kind))) throw bad(BUSY);
    c.variants = c.variants.filter((x) => x.id !== v.id);
    if (c.live_pick?.variant === v.id) delete c.live_pick;
    c.dropped_options = [...(c.dropped_options || []), { id: v.id, name: v.name, version: v.version || 1, by: person(who), at: this.clock() }].slice(-20);
    c.updated = this.clock();
    this.save();
    return { card: c };
  }

  // The alternative a person picked becomes the option's next version; the earlier one stays
  // in its history and the other alternatives go (docs/requests.md → Alternatives of a part).
  pickAlternative(c, who, variant, altId) {
    const v = (c.variants || []).find((x) => x.id === variant);
    if (!v) throw bad("Pick the design option.");
    const alt = (v.alternatives || []).find((x) => x.id === altId);
    if (!alt) throw bad("That alternative is not drawn for this option.");
    if ((alt.of || 1) < (v.version || 1)) throw new DeskError(409, `${v.name} changed after this alternative was drawn. Have the alternatives drawn again.`);
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === c.id && i.kind === "revise")) throw bad(BUSY);
    const at = this.clock();
    v.history = [{ asset: v.asset, version: v.version || 1, drawn: v.drawn || null }, ...(v.history || [])].slice(0, 10);
    v.asset = alt.asset; v.version = (v.version || 1) + 1; v.drawn = at;
    v.picked = { alternative: alt.name, part: alt.part, by: person(who), at };
    v.alternatives = [];
    c.updated = at;
    // The new version reaches what was drawn from the option: its states are drawn again, and
    // the elements in the design catalog follow it (docs/requests.md → Alternatives of a part).
    let item = null;
    if ((v.states || []).length && !Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === c.id && i.kind === "states")) {
      item = this.enqueue("states", c.id, null, who, `Draw every state again for version ${v.version}.`);
      Object.assign(item, { variant: v.id, scope: "redraw" });
    }
    if (c.in_catalog?.variant === v.id) this.copyToCatalog(c, v, c.in_catalog.by);
    this.queueCheck(c, who, `${v.name} is now ${alt.name}: check it against the decisions.`);
    this.save();
    return { card: c, ...(item ? { inbox: item } : {}) };
  }

  // An admin asks Design Desk to put a person on the Desk's list with a role; the agent
  // writes the row (docs/desk.md → People). `roster` is the list the server reads now.
  askForPerson(who, { email, role }, roster = [], { owner = false } = {}) {
    const e = clean(String(email ?? ""), 254, "email").toLowerCase();
    if (!EMAIL.test(e)) throw bad("That is not an email address.");
    if (!ADDABLE_ROLES.includes(role)) throw bad(`role must be one of ${ADDABLE_ROLES.join(", ")}`);
    const on = personOf(roster, e);
    if (on) throw bad(`${e} is already on the list.`);
    if (Object.values(this.db.inbox).some((i) => i.kind === "person" && i.state !== "done" && i.person?.email === e)) throw bad(BUSY);
    const it = this.enqueue("person", null, null, who);
    it.person = { email: e, role };
    // The owner is an admin whatever the roster says; the agent's re-check needs to know.
    if (owner) it.by.owner = true;
    this.save();
    return { inbox: it };
  }

  // The People tab's asks: every one still waiting, and the answered ones of the last two weeks.
  peopleAsks() {
    const since = Date.parse(this.clock()) - 14 * 86400 * 1000;
    return Object.values(this.db.inbox).filter((i) => i.kind === "person" && i.person && (i.state !== "done" || Date.parse(i.done_at) >= since))
      .sort((a, b) => b.created.localeCompare(a.created) || Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, 20)
      .map((i) => ({ id: i.id, email: i.person.email, role: i.person.role, by: i.by?.email || null, created: i.created, state: i.state, outcome: i.outcome || null, done_at: i.done_at || null,
        // Added to the list is not shared with: only the owner shares the Desk (docs/desk.md → People).
        opened: Boolean(own(this.db.opened, String(i.person.email).toLowerCase())) }));
  }

  // A person loaded the Desk: kept once per address, lower-cased, so People can tell an added
  // person the Desk was shared with from one it was not (docs/desk.md → People). The first
  // load alone writes; a store from before this record starts it when it is read (load).
  markOpened(who) {
    const fresh = addressesOf(who).filter((e) => !own(this.db.opened, e));
    if (!fresh.length) return;
    for (const e of fresh) Object.defineProperty(this.db.opened, e, { value: this.clock(), enumerable: true, writable: true, configurable: true });
    this.save();
  }

  // A state change a person asks for on a request card; the agent does the work.
  act(cardId, who, action, note = "", { askFirst = false, count = null, overrule = false, implement = false, closeEarlier = false, autoSend = false, variant = null, version = null, states = null, part = null, element = null } = {}) {
    const c = this.card(cardId);
    // Check again: Design Desk takes the screen's pictures again on the live product; the same
    // pictures mark it checked, new ones redraw it (docs/map.md → Check again).
    if (c.kind === "screen") {
      if (action !== "refresh") throw bad("a screen can only be checked again");
      if (c.status === "building" || c.status === "dropped") throw bad("Design Desk has not drawn this screen yet.");
      if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "map")) throw bad(BUSY);
      const item = this.enqueue("map", cardId, null, who, optText(note, 1000, "note"));
      item.scope = "refresh";
      this.save();
      return { card: c, inbox: item };
    }
    if (c.kind === "element") {
      if (c.design) throw bad(`This element comes from the approved design of ${c.design.card}, not from the product: it is drawn there.`);
      // `history` draws how it looked at earlier commits of the code (docs/catalog.md → History).
      if (action !== "refresh" && action !== "history") throw bad("a catalog element can only be redrawn or have its history drawn");
      if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "catalog")) throw bad(BUSY);
      const item = this.enqueue("catalog", cardId, null, who, optText(note, 1000, "note"));
      if (action === "history") item.scope = "history";
      this.save();
      return { card: c, inbox: item };
    }
    if (c.kind === "issue") {
      if (action !== "draw") throw bad("an issue can only be drawn");
      if (c.status === "archived") throw bad("This issue is closed.");
      if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "draw")) throw bad(BUSY);
      const item = this.enqueue("draw", cardId, null, who, optText(note, 1000, "note"));
      this.save();
      return { card: c, inbox: item };
    }
    if (c.kind !== "request") throw bad("only a design request takes actions");
    const closed = c.status === "declined" || c.status === "handed-off";
    if (designLocked(c) && ["explore", "add-option", "revise", "alternatives", "pick-alternative", "drop-option", "build", "figma-import"].includes(action)) throw bad(LOCKED);
    // Only an admin reopens a request sent to developers; what went to GitHub stays there (docs/desk.md → Approved designs no longer change).
    if (action === "reopen" && designLocked(c) && !who?.agent && who?.role !== "admin") throw forbidden("Only an admin reopens a request sent to developers.");
    // Drawing every state of an approved design's element documents it and changes nothing of it,
    // so it stays open once the design went to developers (docs/requests.md → Every state of a part).
    if (closed && action !== "reopen" && !(action === "states" && c.status === "handed-off")) throw bad("This request is closed. Press Reopen first.");
    // A person picks one of the ways a part could look: it becomes the option's next version.
    if (action === "pick-alternative") return this.pickAlternative(c, who, variant, note);
    if (action === "drop-option") return this.dropOption(c, who, variant);
    const kinds = { explore: "explore", "add-option": "explore", revise: "revise", alternatives: "revise", states: "states", build: "build", approve: "handoff", close: "teardown", "switch-off": "teardown", "figma-export": "figma", "figma-import": "figma", "slack-share": "slack", "slack-send": "slack" };
    if (action === "figma-export" && !(c.variants || []).some((v) => v.id === note)) throw bad("Pick the design option to send to Figma.");
    // A person switches off a live prototype before its expiry; the request stays where it is (docs/prototype.md → Teardown).
    // Only while the request is still being designed, so Build it again can follow.
    if (action === "switch-off" && !(["prototype", "testing"].includes(c.status) && c.prototype?.state === "live")) throw bad("This request has no live prototype on to switch off.");
    if (action === "switch-off" && Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "build")) throw bad("Design Desk is building this prototype again. Switch it off once that is done.");
    // Every state of one part of an option: the option and the part a person picked.
    const stateOf = action === "states" ? (c.variants || []).find((v) => v.id === variant) : null;
    if (action === "states" && !stateOf) throw bad("Pick the design option whose states to draw.");
    if (action === "states" && !part?.label && !String(note || "").trim()) throw bad("Select the part of the design, or say which part, whose states to draw.");
    // The element of the option whose states these are, from its tile (docs/requests.md → Every state of a part).
    const elOf = stateOf && element != null ? elementsOf(stateOf).find((e) => e.key === String(element)) : null;
    if (stateOf && element != null && !elOf) throw bad("That element is not in this design option.");
    // Ways one part could look, from what a person wrote: the option and the part they picked.
    const altOf = action === "alternatives" ? (c.variants || []).find((v) => v.id === variant) : null;
    if (action === "alternatives" && !altOf) throw bad("Pick the design option whose part to try other ways.");
    if (action === "alternatives" && !part?.label) throw bad("Select the part of the design to try other ways.");
    if (action === "alternatives" && !String(note || "").trim()) throw bad("Say how you picture this part.");
    // One more option, from what a person wrote it should look like and have.
    const base = action === "add-option" && variant ? (c.variants || []).find((v) => v.id === variant) : null;
    if (action === "add-option" && variant && !base) throw bad("That design option is not on this request.");
    if (action === "add-option" && !String(note || "").trim()) throw bad("Say what the new option should look like and have.");
    if (action === "add-option" && (c.variants || []).length >= 6) throw bad("A request has at most 6 options. Close one first.");
    // A request that asked for no options takes its first one here, once it is checked.
    if (action === "add-option" && !(c.variants || []).length && !(c.request?.options === 0 && c.triage)) throw bad("Wait for the first design options, then add one.");
    // What goes live is the option a person checked, at the version they looked at: a newer
    // one that arrived meanwhile is looked at first (docs/prototype.md → Build).
    const live = action === "build" ? (c.variants || []).find((v) => v.id === (variant || note)) : null;
    if (action === "build" && (c.variants || []).length && !live) throw bad("Pick the design option to build.");
    // The states it shows count too: one redrawn, added or removed alone is not what they saw.
    const seen = states && typeof states === "object" ? states : null;
    const statesMoved = live && seen && ((live.states || []).length !== Object.keys(seen).length || (live.states || []).some((x) => Number(seen[x.id]) !== (x.version || 1)));
    if (live && version != null && (Number(version) !== (live.version || 1) || statesMoved))
      throw new DeskError(409, `A newer version of ${live.name} or one of its states arrived while you looked. Look at it again before it goes live.`);
    const stale = live ? staleStates(live) : [];
    if (stale.length) throw new DeskError(409, `${stale.map((x) => x.name).join(", ")} of ${live.name} ${stale.length === 1 ? "was" : "were"} drawn for an earlier version of it. Have the states drawn again first.`);
    if (action.startsWith("slack-") && !(c.variants || []).length) throw bad("There are no design options to share yet.");
    if (action === "slack-share" && (c.polls || []).some((x) => x.state === "open")) throw bad("These options are already being voted on in Slack.");
    if (action === "figma-import" && !FIGMA_URL.test(String(note || ""))) throw bad("Paste a link to a Figma frame (https://www.figma.com/…).");
    if (action === "reopen") {
      if (c.status !== "declined" && c.status !== "handed-off") throw bad("only a closed request can be reopened");
      // A request sent to developers: its Designs record closes as it was (`sends`), and the
      // request goes back to before the vote with its options; a new approval sends it anew
      // (docs/desk-page.md → Designs).
      if (c.status === "handed-off") {
        const at = this.clock();
        c.sends = [...(c.sends || []), { approved: c.approved || null, spec: c.spec || null, dev_summary: c.dev_summary || null, built: c.built || null,
          threads: (c.threads || []).filter((t) => this.db.threads[t]?.dev && !(c.sends || []).some((s) => s.threads.includes(t))), closed: { by: person(who), at } }];
        for (const k of ["overruled", "approved", "decided", "built", "dev_summary", "spec", "vote_ended"]) delete c[k];
        if ((c.variants || []).length) Object.assign(c, { status: "variants", team_feedback: { state: "waiting", since: at } });
        else c.status = "triage";
        c.updated = at;
        const item = (c.variants || []).length ? null : this.enqueue("request", cardId, null, who, optText(note, 1000, "note"));
        this.save();
        return { card: c, inbox: item };
      }
      c.status = "triage";
      delete c.overruled;
      delete c.approved;
      delete c.decided;
      delete c.vote_ended;
      // Designs: sent, done, then declined and reopened, it is not built any more; its next handoff sums it up again.
      delete c.built;
      delete c.not_built;
      delete c.dev_summary;
      c.updated = this.clock();
      const item = this.enqueue("request", cardId, null, who, optText(note, 1000, "note"));
      this.save();
      return { card: c, inbox: item };
    }
    if (!kinds[action]) throw bad(`unknown action ${action}`);
    if (action === "build" && c.triage?.verdict !== "design")
      throw forbidden(c.triage ? "This request gets no live prototype because part of it needs a developer or a decision. The developer spec covers it." : "Design Desk is still checking this request. You can build a live prototype once it says what can be done.");
    // An option that goes against a decision in force goes live only knowingly (docs/desk.md → Decisions → The check).
    const liveAgainst = action === "build" && !who?.agent ? [...new Set(this.activeConflicts(c).filter((x) => !x.variant || x.variant === live?.id).map((x) => x.decision))] : [];
    if (liveAgainst.length && !overrule) throw new DeskError(409, `${live?.name || "This design"} goes against ${liveAgainst.join(", ")}. Read why on the request, and build it only if the team means to try it anyway.`);
    // A designer, a PM or a lead developer approves once it is checked, without a vote or a live
    // prototype; a developer on a request For Developers, once there are options (docs/desk.md → Deciding straight away).
    const direct = who?.agent || can(who?.role, "skip");
    if (action === "approve") mustBeChecked(c, "Approve");
    // Before options are on the card, an approval does not race the drawing of them.
    if (action === "approve" && ["triage", "variants"].includes(c.status) && Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && ["explore", "revise"].includes(i.kind)))
      throw bad("Design Desk is still drawing the options. Approve once they are here.");
    if (action === "approve" && !["testing", "feedback", "prototype", ...(direct ? ["triage", "variants"] : [])].includes(c.status))
      throw bad("There's nothing to approve yet. Wait for the design options.");
    if (action === "approve" && !direct && !can(who?.role, "approve")) {
      if (!c.size?.small || !DEVELOPERS.includes(who?.role)) throw forbidden("Only designers, PMs and lead developers can approve designs. A request For Developers is approved by a developer.");
      if (isAuthor(c, who)) throw forbidden("You filed this request, so another developer approves it.");
    }
    // Once a live prototype is built, approving approves what it shows: `live_pick`'s option at
    // its version, whatever the note says — also back at feedback after a revise, while it is up.
    const shown = action === "approve" && (["prototype", "testing"].includes(c.status) || c.prototype?.state === "live") && (c.variants || []).some((v) => v.id === c.live_pick?.variant) ? c.live_pick : null;
    if (shown) note = shown.variant;
    // A design that goes against a decision in force is approved only knowingly (docs/desk.md → Decisions).
    const against = action === "approve" ? [...new Set(this.activeConflicts(c).map((x) => x.decision))] : [];
    // Going against a decision in force stays a designer's call, For Developers included.
    if (against.length && !who?.agent && !can(who?.role, "approve")) throw forbidden(`This design goes against ${against.join(", ")}, so a designer approves it, even For Developers.`);
    if (against.length && !overrule) throw new DeskError(409, `This design goes against ${against.join(", ")}. Read why on the request, and approve it only if the team means to go against it.`);
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === kinds[action])) throw bad(BUSY);
    // A closed request has nothing going live.
    if (action === "close") {
      c.status = "declined"; delete c.call_suggestion; delete c.live_pick;
      // Nothing is designed on it any more: a check still waiting has nothing to check.
      for (const it of Object.values(this.db.inbox)) if (it.card === cardId && it.kind === "decision-check" && it.state === "open")
        Object.assign(it, { state: "done", done_at: this.clock(), outcome: "not checked: closed" });
    }
    // Draw design options says how many; the request keeps it for its later redraws.
    if (action === "explore" && count !== null) {
      const n = cleanCount(count);
      if (n < 1) throw bad("Pick how many options to draw: one to five.");
      c.request = { ...c.request, options: n };
    }
    if (against.length) c.overruled = { by: person(who), at: this.clock(), decisions: against };
    else if (action === "approve") delete c.overruled;
    // Who approved, shown on the card; an approval For Developers says so (`small`).
    if (action === "approve") c.approved = { by: person(who), at: this.clock(), small: Boolean(c.size?.small), ...(implement ? { implement: true } : {}),
      ...(shown ? { variant: shown.variant, version: shown.version } : (c.variants || []).some((v) => v.id === note) ? { variant: note } : {}) };
    // The approver sends the spec unread, as soon as it is written (docs/handoff.md → Review
    // before it goes); never a request from Slack, whose spec always waits for a person.
    // Nor one from an open pull request: a person picks there between a new issue and a comment on it.
    if (action === "approve" && autoSend && c.origin?.channel !== "slack" && !this.fromPr(c)) c.approved.auto_send = true;
    c.updated = this.clock();
    const item = this.enqueue(kinds[action], cardId, null, who, optText(note, action === "add-option" ? LIMITS.optionAsk : 1000, "note"));
    if (action === "add-option") {
      item.scope = "add";
      if (base) item.variant = base.id;
    }
    if (altOf) { item.scope = "alternatives"; item.variant = altOf.id; item.version = altOf.version || 1; item.part = cleanPart(part); }
    // The designer wants questions before the build when something is unclear.
    if (action === "build" && askFirst) item.ask_first = true;
    // Straight to the coding agent: the handoff labels its issue (docs/handoff.md, step 5).
    if (action === "approve" && implement) item.implement = true;
    // Sent before and reopened: the new send closes the earlier issue too (docs/handoff.md, step 6).
    if (action === "approve" && closeEarlier && earlierSend(c)) item.close_earlier = earlierSend(c);
    if (stateOf) {
      item.variant = stateOf.id; if (part?.label) item.part = cleanPart(part);
      if (elOf) item.element = elOf.key;
    }
    if (live) {
      item.variant = live.id; item.version = live.version || 1;
      // The card says which option, at which version and with which states, goes live.
      c.live_pick = { variant: live.id, name: live.name, version: live.version || 1, asset: live.asset,
        states: (live.states || []).map((x) => ({ id: x.id, name: x.name, part: x.part, version: x.version || 1, of: x.of || 1, asset: x.asset })), by: person(who), at: this.clock() };
    }
    // Pictures of the options posted to Slack, not a vote (the slack-polls skill → Send).
    if (action === "slack-send") item.scope = "send";
    this.save();
    return { card: c, inbox: item };
  }

  // ---------- the developer spec, read by a person before it goes ----------
  // Design Desk writes the spec as a draft (`spec.review: "draft"`); a person reads it, edits
  // it, asks for changes, or sends it. Only a send lets it leave the Desk (docs/handoff.md →
  // Review before it goes). Every version stays: an edit or a rewrite keeps the one it replaces.
  specAction(cardId, who, { action, text = "", note = "", implement = null, closeEarlier = false, comment = false } = {}) {
    const c = this.card(cardId);
    if (who?.agent) throw forbidden("A person reads the spec and sends it; Design Desk writes it.");
    if (c.kind !== "request" || c.status !== "spec" || !c.spec?.asset) throw bad("There is no developer spec to look at yet.");
    if (!["draft", "changes"].includes(c.spec.review || "")) throw bad(c.spec.review === "sent" ? "This spec is already on its way to developers." : "This spec is not waiting for a review.");
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "handoff")) throw bad(BUSY);
    if ((c.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open")) throw bad("Answer Design Desk's questions first; the spec takes your answers in.");
    const may = can(who?.role, "approve") || can(who?.role, "skip") || (c.approved?.small && DEVELOPERS.includes(who?.role) && !isAuthor(c, who));
    if (!may) throw forbidden("Only the people who may approve this request read and send its spec.");
    const at = this.clock();
    if (action === "edit") {
      const body = clean(text, 60000, "spec");
      const id = this.addAsset({ card: c.id, kind: "spec", name: "spec.md", contentType: "text/markdown", data: body, encoding: "utf8" }).asset.id;
      c.spec = { ...c.spec, history: [...(c.spec.history || []), { asset: c.spec.asset, at: c.spec.at || c.updated, by: c.spec.by || { agent: true } }].slice(-20), asset: id, at, by: person(who), review: "draft" };
      c.updated = at;
      this.save();
      return { card: c };
    }
    if (action === "changes") {
      const ask = clean(note, 2000, "what to change");
      c.spec = { ...c.spec, review: "changes", asked: { by: person(who), at, note: ask } };
      c.updated = at;
      const item = this.enqueue("handoff", cardId, null, who, ask);
      item.scope = "spec-revise";
      this.save();
      return { card: c, inbox: item };
    }
    if (action === "send") {
      // Here the person picks the route: an issue for developers, or straight to the coding
      // agent with its label (`implement`); left out, what Approve said holds.
      // Or back to the open pull request it came from, as a comment (`comment_on`).
      const pr = comment ? this.fromPr(c) : null;
      if (comment && !pr) throw bad("The pull request it came from is no longer open: send the spec as an issue.");
      const straight = pr ? false : implement == null ? Boolean(c.approved?.implement) : Boolean(implement);
      c.spec = { ...c.spec, review: "sent", sent: { by: person(who), at, implement: straight, ...(pr ? { comment_on: pr.url || `${pr.repo}#${pr.pr}` } : {}) } };
      if (c.approved) c.approved = { ...c.approved, implement: straight || undefined };
      if (c.approved && !straight) delete c.approved.implement;
      c.updated = at;
      const item = this.enqueue("handoff", cardId, null, who, c.approved?.variant || "");
      item.scope = "deliver";
      if (straight) item.implement = true;
      if (pr) item.comment_on = pr.url || `${pr.repo}#${pr.pr}`;
      if (closeEarlier && earlierSend(c)) item.close_earlier = earlierSend(c);
      this.save();
      return { card: c, inbox: item };
    }
    throw bad("unknown spec action");
  }

  // A person hands the drawn options of a Desk request to the team: from here people vote and
  // comment, as on a request from Slack (docs/desk.md → Team feedback).
  openFeedback(cardId, who) {
    const c = this.card(cardId);
    if (c.kind !== "request" || c.status !== "variants" || !(c.variants || []).length) throw bad("There are no drawn options to show the team yet.");
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && ["explore", "revise", "states"].includes(i.kind)))
      throw bad("Design Desk is still drawing the options. Ask the team once they are here.");
    if (!can(who?.role, "revise") && !isAuthor(c, who)) throw forbidden("Only designers, PMs, developers, admins or the person who filed it ask the team for feedback.");
    c.status = "feedback";
    c.team_feedback = { state: "open", by: person(who), at: this.clock() };
    // A new round of feedback is a new vote.
    delete c.vote_ended;
    c.updated = this.clock();
    this.save();
    return { card: c };
  }

  // A person ends the team's vote: nobody votes on the options after it, comments stay open, and
  // the request waits for its approver. A vote open in Slack is due to close at once, so the
  // agent's next look closes it there and posts its result (docs/desk.md → Team feedback).
  endVote(cardId, who) {
    const c = this.card(cardId);
    if (c.kind !== "request" || c.status !== "feedback") throw bad("The team is not voting on this request now.");
    if (c.vote_ended) throw bad("The vote on these options has already ended.");
    if (!can(who?.role, "revise") && !isAuthor(c, who)) throw forbidden("Only designers, PMs, developers, admins or the person who filed it end the vote.");
    const at = this.clock();
    c.vote_ended = { by: person(who), at };
    for (const poll of c.polls || []) if (poll.state === "open") poll.closes = at;
    c.updated = at;
    this.save();
    return { card: c };
  }

  // A lead developer moves a request to For Developers, which any developer but its author
  // approves, or back to For Designers; the card keeps who and when. A change moves the same
  // way, between a lead developer's look and a designer's
  // (docs/desk.md → For Developers or For Designers).
  setSize(cardId, who, small) {
    const c = this.card(cardId);
    if (!["request", "change", "issue"].includes(c.kind)) throw bad("only a design request, a change or an issue is For Developers or For Designers");
    if (c.kind !== "request" && c.handled) throw bad(`This ${c.kind} is already handled. Mark it not handled to change who looks at it.`);
    if (c.kind !== "request" && c.status === "archived") throw bad(`This ${c.kind} is archived.`);
    if (c.status === "declined" || c.status === "handed-off") throw bad("This request is closed.");
    if (c.approved) throw bad("This request is already approved. Reopen it to change who approves it.");
    if (typeof small !== "boolean") throw bad("small must be true or false");
    c.size = { small, by: person(who), at: this.clock() };
    c.updated = this.clock();
    // A change whose check Design Desk holds or passed: the check follows who looks at it now.
    if (c.kind === "change" && ["failing", "passing"].includes(c.ci?.state)) this.pendingOrNew("ci", c.id, who, `Moved to For ${small ? "Developers" : "Designers"}: set the check again.`);
    this.save();
    return { card: c };
  }

  // A designer, a PM or a lead developer decides a request without a vote or a live prototype and
  // closes it; Design Desk records the decision in their name (docs/desk.md → Deciding straight away).
  decideAndClose(cardId, who, { text, why = "" } = {}) {
    const c = this.card(cardId);
    if (who?.agent) throw forbidden("Design Desk does not decide: a person does");
    if (c.kind !== "request") throw bad("only a design request is decided here");
    if (c.status === "declined" || c.status === "handed-off") throw bad("This request is closed.");
    if (c.approved || c.status === "spec") throw bad("This request is already approved.");
    mustBeChecked(c, "Decide");
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "decision" && !i.thread)) throw bad(BUSY);
    const said = clean(text, 600, "decision");
    c.status = "declined"; delete c.call_suggestion; delete c.live_pick;
    c.decided = { by: person(who), at: this.clock(), text: said };
    c.updated = this.clock();
    const item = this.enqueue("decision", cardId, null, who, said);
    item.why = optText(why, 1500, "why");
    // Closing switches off its live prototype, as Close does.
    this.enqueue("teardown", cardId, null, who);
    this.save();
    return { card: c, inbox: item };
  }

  // ---------- the next call's agenda ----------

  // A designer puts a card on the agenda of the team's next call, with the option to
  // present; the agent writes a brief for it (what to decide); after the call an admin
  // closes the agenda. The agent only suggests a card; a designer adds it or says Not now.
  queueForCall(cardId, who, note = "", variant = null) {
    const c = this.card(cardId);
    if (who?.agent) throw forbidden("only a designer puts a card on the presentation; the agent suggests it");
    if (c.agenda?.status === "queued") throw bad("It is already on the presentation.");
    const vs = c.variants || [];
    // A page published before the option picker sends none: the favourite, else the first.
    if (vs.length && variant == null) variant = (favouriteOf(c) || vs[0]).id;
    if (vs.length && !vs.some((v) => v.id === variant)) throw bad("Pick the design option to present.");
    c.agenda = { status: "queued", by: person(who), at: this.clock(), note: optText(note, 500, "note"), variant: vs.length ? variant : null, brief: null };
    delete c.call_suggestion; delete c.call_dismissed;
    c.updated = this.clock();
    const item = this.enqueue("agenda", cardId, null, who, c.agenda.note);
    this.save();
    return { card: c, inbox: item };
  }

  // A designer's Not now holds: the agent does not suggest that card again until a designer
  // puts it on a call. A closed request takes no suggestion.
  suggestForCall(cardId, note = "") {
    const c = this.card(cardId);
    const skip = c.agenda?.status === "queued" ? "it is already on the presentation" : c.call_dismissed ? "a designer said Not now to it" : c.status === "declined" ? "the request is closed" : null;
    if (skip) return { card: c, suggested: false, reason: skip };
    c.call_suggestion = { note: optText(note, 500, "note"), at: this.clock() };
    c.updated = this.clock();
    this.save();
    return { card: c, suggested: true };
  }

  dismissSuggestion(cardId, who) {
    if (!can(who.role, "queue")) throw forbidden("Only a designer decides what goes on the presentation.");
    const c = this.card(cardId);
    if (c.call_suggestion) c.call_dismissed = { by: person(who), at: this.clock(), note: c.call_suggestion.note };
    delete c.call_suggestion;
    this.save();
    return { card: c };
  }

  unqueue(cardId, who) {
    const c = this.card(cardId);
    if (c.agenda?.status !== "queued") throw bad("it is not on the presentation");
    const mine = Boolean(c.agenda.by?.email) && addressesOf(who).includes(String(c.agenda.by.email).toLowerCase());
    if (!mine && !can(who.role, "queue")) throw forbidden("Only the person who added it, or a designer, can take it off the presentation.");
    c.agenda = { ...c.agenda, status: "removed", removed_at: this.clock() };
    this.save();
    return { card: c };
  }

  // A designer marks one item presented once the team saw it. Undo puts it back on until
  // the end of that day: an item of an earlier meeting keeps its date and who presented it.
  markPresented(cardId, who, presented = true) {
    if (!can(who.role, "queue")) throw forbidden("Only a designer or an admin marks an item presented.");
    const c = this.card(cardId);
    if (presented) {
      if (c.agenda?.status !== "queued") throw bad("it is not on the presentation");
      const at = this.clock();
      c.agenda = { ...c.agenda, status: "presented", call: at, presented_by: person(who), undo_until: endOfDay(at) };
    } else {
      if (c.agenda?.status !== "presented") throw bad("it was not presented");
      if (!(this.clock() <= (c.agenda.undo_until || ""))) throw bad("it was presented at an earlier meeting; add it to the presentation again instead");
      const { call, presented_by, undo_until, ...rest } = c.agenda;
      c.agenda = { ...rest, status: "queued" };
    }
    c.updated = this.clock();
    this.save();
    return { card: c };
  }

  // Mark all as presented: what was queued becomes presented, with the date.
  closeCall(who, { date = null } = {}) {
    if (!can(who.role, "queue")) throw forbidden("Only a designer or an admin marks the presentation presented.");
    const when = optText(date, 40, "date") || this.clock(), until = endOfDay(this.clock());
    const done = [];
    for (const c of Object.values(this.db.cards)) if (c.agenda?.status === "queued") { c.agenda = { ...c.agenda, status: "presented", call: when, undo_until: until }; done.push(c.id); }
    this.db.calls = [...(this.db.calls || []), { at: when, by: person(who), cards: done }].slice(-100);
    this.save();
    return { presented: done };
  }

  agenda() {
    return Object.values(this.db.cards).filter((c) => c.agenda?.status === "queued")
      .sort((a, b) => a.agenda.at.localeCompare(b.agenda.at))
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title, status: c.status, type: c.request?.type || null, agenda: c.agenda, summary: c.summary || "",
        source: c.source || null, origin: c.origin ? { repo: c.origin.repo, url: c.origin.url } : null,
        option: (c.variants || []).find((v) => v.id === c.agenda.variant)?.name || null,
        thumb: (c.variants || []).find((v) => v.id === c.agenda.variant)?.asset || c.screens?.[0]?.asset || c.variants?.[0]?.asset || null }));
  }

  // What was presented lately, the newest first: the page lists it under the queue.
  presented(limit = 10) {
    return Object.values(this.db.cards).filter((c) => c.agenda?.status === "presented")
      .sort((a, b) => String(b.agenda.call || "").localeCompare(String(a.agenda.call || ""))).slice(0, limit)
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title, agenda: c.agenda, option: (c.variants || []).find((v) => v.id === c.agenda.variant)?.name || null }));
  }

  // ---------- agent actions ----------

  // The open (not yet claimed) item of this kind for the card, or a new one: notes written
  // in a row are one piece of work, and one written while a session works gets its own.
  pendingOrNew(kind, card, who, note = "") {
    const open = Object.values(this.db.inbox).find((i) => i.card === card && i.kind === kind && i.state === "open");
    return open || this.enqueue(kind, card, null, who, note);
  }

  // Design Desk as a message's author, with the person whose item it works on (`for`): the
  // newest claimed item of the card, or the ones given; none when a run acts on its own
  // (docs/desk.md → Questions and comments).
  agentFor(card, items = null) {
    const xs = (items || Object.values(this.db.inbox).filter((i) => i.card === card && i.state === "claimed"))
      // A private ask's asker is never named where others read (docs/desk.md → Private asks).
      .filter((i) => (i.by?.email || i.by?.name) && this.db.threads[i.thread]?.kind !== "private").sort((a, b) => String(b.claimed_at || b.created).localeCompare(String(a.claimed_at || a.created)));
    const b = xs[0]?.by;
    return b ? { agent: true, for: { email: b.email || null, ...(b.name ? { name: b.name } : {}) } } : { agent: true };
  }

  enqueue(kind, card, thread, who, note = "") {
    if (!INBOX_KINDS.includes(kind)) throw bad(`unknown inbox kind ${kind}`);
    const id = this.next("item", "I");
    const it = { id, kind, card, thread, by: person(who), note, created: this.clock(), state: "open" };
    // A question item knows how many messages its thread had, so an answer closes only
    // what it could have read.
    if (thread) it.msg_count = this.thread(thread).messages.length;
    this.db.inbox[id] = it;
    return it;
  }

  openItemFor(thread) {
    return Object.values(this.db.inbox).find((i) => i.state === "open" && i.thread === thread);
  }

  // The agent wrote on a card: the items claimed on it are being worked, so their leases start
  // again. Nothing is saved here: the write that follows saves, and a refused write renews nothing.
  renewClaims({ card = null, thread = null } = {}) {
    const id = card ? String(card) : thread ? own(this.db.threads, String(thread))?.card : null;
    if (!id) return;
    for (const it of Object.values(this.db.inbox)) if (it.state === "claimed" && it.card === id) it.claimed_at = this.clock();
  }

  // A claim is the inbox lock: one session per item. It is a renewable lease, and a
  // claim past its TTL is taken over only by the explicit `takeover` the preflight sends.
  // A heartbeat by the same session renews it; another session still needs a takeover.
  claim(itemId, session, { takeover = false, heartbeat = false } = {}) {
    const it = this.item(itemId);
    if (it.state === "done") throw new DeskError(409, `${itemId} is done`);
    if (it.state === "claimed" && it.claimed_by !== session) {
      const age = (Date.parse(this.clock()) - Date.parse(it.claimed_at)) / 60000;
      if (!takeover || age < LIMITS.claimTtlMin) throw new DeskError(409, `${itemId} is claimed by ${it.claimed_by} since ${it.claimed_at}`);
    }
    if (heartbeat && (it.state !== "claimed" || it.claimed_by !== session)) throw new DeskError(409, `${itemId} is not claimed by ${session}`);
    const by = clean(String(session || ""), 200, "session");
    const was = it.state === "claimed" && it.claimed_by === by;
    it.state = "claimed"; it.claimed_by = by; it.claimed_at = this.clock();
    if (!was) it.claimed_started = it.claimed_at;
    if (it.thread) it.seen = this.thread(it.thread).messages.length;
    this.save();
    return { item: it, card: it.card ? this.getCard(it.card) : null, thread: it.thread ? this.thread(it.thread) : null };
  }

  done(itemId, session, outcome = "done") {
    const it = this.item(itemId);
    if (it.state === "claimed" && it.claimed_by !== session) throw new DeskError(409, `${itemId} is claimed by ${it.claimed_by}`);
    const why = clean(typeof outcome === "string" ? outcome : "done", 500, "outcome");
    it.state = "done"; it.done_at = this.clock(); it.outcome = why;
    if (it.thread && it.kind === "question") {
      const t = this.db.threads[it.thread];
      if (t && t.state === "answered") t.needs_agent = false;
    }
    this.save();
    return { item: it };
  }

  answer(threadId, text, { resolve = false, shots = null, warns = null } = {}) {
    const t = this.thread(threadId);
    const body = clean(text, LIMITS.text, "text");
    // What a worked-in note goes against, each shown as a warning box under the answer.
    const against = cleanWarns(warns, this.db.decisions);
    if (t.kind === "private" && shots?.length) throw bad("A private ask is answered in words: Design Desk changes nothing from one.");
    const pictures = this.changeShots(shots, { agent: true });
    // The answer closes the items it could have read: the claimed ones, and open ones
    // whose message was already there when a claim read the thread. A message that came
    // later keeps its own item open, and the thread keeps waiting for the agent.
    const items = Object.values(this.db.inbox).filter((it) => it.thread === threadId && it.kind === "question" && it.state !== "done");
    const claimed = items.filter((it) => it.state === "claimed");
    const seen = claimed.length ? Math.max(...claimed.map((it) => it.seen ?? t.messages.length)) : t.messages.length;
    t.messages.push({ by: this.agentFor(t.card, claimed), at: this.clock(), text: body, ...pictures, ...(against.length ? { warns: against } : {}) });
    let waiting = false;
    for (const it of items) {
      if (it.state === "claimed" || (it.msg_count ?? 0) <= seen) { it.state = "done"; it.done_at = this.clock(); it.outcome = "answered"; }
      else waiting = true;
    }
    t.state = waiting ? "open" : resolve ? "resolved" : "answered";
    t.needs_agent = waiting;
    // A private ask leaves no trace others see, not even the card's last-changed time.
    if (t.kind !== "private") this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t };
  }

  // What a comment worked in did to the design, as Design Desk shows it under its answer:
  // the same place before and after, each pair named, and the differences outlined.
  changeShots(list, who) {
    if (list == null || (Array.isArray(list) && !list.length)) return {};
    if (!who?.agent) throw forbidden("only Design Desk shows what a change did");
    if (!Array.isArray(list) || list.length > LIMITS.changeShots) throw bad(`shots: a list of at most ${LIMITS.changeShots} pictures`);
    const shots = cleanRefs(list, this.db.assets, "shots");
    for (const pair of new Set(shots.map((x) => x.pair))) {
      const stages = shots.filter((x) => x.pair === pair).map((x) => x.stage);
      if (!stages.includes("before") || !stages.includes("after")) throw bad(`shots: "${pair || "a picture"}" needs a before and an after picture`);
    }
    return { shots };
  }

  // Create or update a card the agent writes (a change card, or the agent's parts of a
  // request). Only the listed fields are the agent's; people's acks, votes and threads
  // are never overwritten.
  upsertCard(fields) {
    const AGENT_FIELDS = ["title", "summary", "sections", "screens", "source", "status", "triage", "variants", "prototype", "spec", "labels", "sheet", "states", "group", "elements", "research", "brief", "origin", "impact", "instance", "shotlist", "path", "how", "concepts", "changes", "period", "attention", "bucket", "needs", "sketches", "style", "draw", "issue_brief", "grill", "decisions", "conflicts", "design_check", "decision_check", "figma_check", "figma_search", "dev_summary", "ci"];
    let c = fields.id ? own(this.db.cards, fields.id) : null, goneLive = null;
    if (fields.id && !c) throw missing(`no card ${fields.id}`);
    if (!c && !["change", "request", "element", "screen", "digest", "issue"].includes(fields.kind)) throw bad("a new card needs kind change, request, element, screen, digest or issue");
    if (!c && fields.kind === "screen" && fields.path)
      c = Object.values(this.db.cards).find((x) => x.kind === "screen" && x.path === String(fields.path)) || null;
    if (!c && fields.kind === "digest" && fields.period)
      c = Object.values(this.db.cards).find((x) => x.kind === "digest" && x.period === String(fields.period)) || null;
    if (!c && fields.kind === "element" && fields.source?.file && fields.source?.export)
      c = Object.values(this.db.cards).find((x) => x.kind === "element" && x.source?.file === fields.source.file && x.source?.export === fields.source.export) || null;
    if (!c && fields.kind === "issue" && fields.source?.repo && fields.source?.issue)
      c = Object.values(this.db.cards).find((x) => x.kind === "issue" && x.source?.repo === fields.source.repo && String(x.source?.issue) === String(fields.source.issue)) || null;
    if (!c && fields.kind === "change" && fields.source?.repo && fields.source?.pr)
      c = Object.values(this.db.cards).find((x) => x.kind === "change" && x.source?.repo === fields.source.repo && x.source?.pr === fields.source.pr) || null;
    // Everything is checked on a copy; the store changes only when all of it holds.
    const next = c ? structuredClone(c) : { kind: fields.kind, status: { change: "new", request: "triage", element: "building", screen: "current", digest: "new", issue: "open" }[fields.kind], created: this.clock(), created_by: { agent: true },
      sections: [], screens: [], variants: [], votes: {}, threads: [], acks: {}, prototype: { state: "none" } };
    const brief = next.kind === "change" ? LIMITS.change : next.kind === "issue" ? LIMITS.issue : null;
    for (const k of AGENT_FIELDS) {
      if (fields[k] === undefined) continue;
      // A title a person gave a request is theirs: a run's upsert leaves it as it is.
      if (k === "title") { if (!next.renamed) next.title = clean(fields.title, brief?.title ?? LIMITS.title, "title"); }
      else if (k === "summary") next.summary = clean(fields.summary, brief?.summary ?? 600, "summary");
      else if (k === "status") {
        const ok = { change: CHANGE_STATES, request: REQUEST_STATES, element: ELEMENT_STATES, screen: ELEMENT_STATES, digest: CHANGE_STATES, issue: ISSUE_STATES }[next.kind];
        if (!ok.includes(fields.status)) throw bad(`status must be one of ${ok.join(", ")}`);
        // A person closed it while a session worked: the session's late write must not reopen it.
        if (c && (c.status === "declined" || c.status === "handed-off") && fields.status !== c.status && !(c.status === "handed-off" && fields.status === "declined"))
          throw new DeskError(409, `${c.id} is ${c.status}; only a person reopens it`);
        // Handled is a designer's mark on a change: the agent neither sets nor clears it.
        // Archiving a handled change stays the agent's (the remedy for a full store); the mark
        // stays with it, so an archived handled change never goes back to new.
        if (next.kind === "change" && ((fields.status === "handled" && c?.status !== "handled") || (c?.handled && !["handled", "archived"].includes(fields.status))))
          throw new DeskError(409, "only a designer marks a change handled, or not");
        next.status = fields.status;
        if (next.status === "declined") delete next.call_suggestion;
      } else if (k === "sections") next.sections = cleanSections(fields.sections, next.kind === "change" ? brief : null, this.db.cards);
      else if (k === "screens") next.screens = cleanRefs(fields.screens, this.db.assets, "screens");
      else if (k === "variants") {
        next.variants = versioned(cleanVariants(fields.variants, this.db.assets, this.db.decisions, c?.variants || [], this.db.cards), c?.variants || [], this.clock(), (c?.dropped_options || []).map((x) => x.id));
        // Nor does an option taken off go live, nor a build still waiting to build it.
        if (next.live_pick && !next.variants.some((v) => v.id === next.live_pick.variant)) { goneLive = next.live_pick.variant; delete next.live_pick; }
      }
      else if (k === "impact") { next.impact = cleanImpact(fields.impact, this.db.cards, this.db.decisions); this.linkPlaces(next.impact, fields.impact.places); }
      else if (k === "instance") next.instance = fields.instance === null ? null : cleanInstance(fields.instance);
      else if (k === "shotlist") next.shotlist = cleanShotlist(fields.shotlist);
      else if (k === "path") next.path = clean(String(fields.path), 300, "path");
      else if (k === "how") next.how = clean(fields.how, 600, "how");
      else if (k === "period") next.period = clean(String(fields.period), 40, "period");
      else if (k === "concepts") { if (!Array.isArray(fields.concepts)) throw bad("concepts must be a list"); next.concepts = fields.concepts.slice(0, 10).map((x) => clean(String(x), 80, "concept").toLowerCase()); }
      else if (k === "changes") { if (!Array.isArray(fields.changes)) throw bad("changes must be a list"); next.changes = fields.changes.slice(-40).map((id) => this.card(String(id)).id); }
      else if (k === "triage") next.triage = cleanTriage(fields.triage);
      // The UX decisions of an approved design, for developers on Designs (docs/handoff.md, step 7).
      else if (k === "ci") {
        // Design Desk's check on the change's pull request (docs/watch.md → CI gate).
        if (next.kind !== "change") throw bad("ci belongs to a change card");
        next.ci = fields.ci === null ? null : cleanCi(fields.ci);
        if (next.ci) next.ci.at = this.clock();
      }
      else if (k === "dev_summary") {
        if (next.kind !== "request") throw bad("dev_summary belongs to a request");
        next.dev_summary = fields.dev_summary === null ? null : { text: clean(fields.dev_summary, 4000, "dev_summary"), at: this.clock() };
      }
      else if (k === "issue_brief" || k === "grill") {
        if (next.kind !== "request") throw bad(`${k} belongs to a request`);
        next[k] = fields[k] === null ? null : k === "grill" ? cleanGrill(fields.grill) : cleanIssueBrief(fields.issue_brief);
      }
      // The decisions a card follows, and those it goes against (docs/desk.md → Decisions).
      else if (k === "decisions") { if (!Array.isArray(fields.decisions)) throw bad("decisions must be a list of D-n"); next.decisions = [...new Set(fields.decisions.slice(0, 20).map((id) => this.decision(String(id)).id))]; }
      else if (k === "conflicts") next.conflicts = cleanConflicts(fields.conflicts, this.db.decisions, next.variants);
      // The check this write was made with (docs/desk.md → Decisions → The check); stamped below, once the options are known.
      else if (k === "decision_check") next.decision_check = cleanDecisionCheck(fields.decision_check, this.db.decisions);
      // A shipped change read against the approved design it builds (docs/watch.md → Approved design).
      else if (k === "design_check") {
        if (next.kind !== "change") throw bad("design_check belongs to a change card");
        next.design_check = fields.design_check === null ? null : cleanDesignCheck(fields.design_check, this.db.cards, this.db.assets, this.clock());
      }
      // Where the search for a screen's or an element's frame in Figma stands, so it runs once
      // (the figma skill → Finding the frame); null: search again.
      else if (k === "figma_search") {
        if (!["screen", "element"].includes(next.kind)) throw bad("figma_search belongs to a screen or an element");
        next.figma_search = fields.figma_search === null ? null : cleanFigmaSearch(fields.figma_search, this.db.threads, this.clock());
      }
      // The item read against its frame in Figma (the figma skill → Compare with the product).
      else if (k === "figma_check") {
        if (!FIGMA_KINDS.includes(next.kind)) throw bad(`figma_check belongs to a ${FIGMA_KINDS.join(", ")} card`);
        next.figma_check = fields.figma_check === null ? null : keepDismissed(c?.figma_check, cleanFigmaCheck(fields.figma_check, this.db.assets, this.clock(), next.kind === "request" ? next.variants || [] : null));
      }
      else if (["bucket", "needs", "sketches", "style", "draw"].includes(k)) {
        if (next.kind !== "issue") throw bad(`${k} belongs to an issue`);
        if (k === "bucket") { if (!ISSUE_BUCKETS.includes(fields.bucket)) throw bad(`bucket must be one of ${ISSUE_BUCKETS.join(", ")}`); next.bucket = fields.bucket; }
        else if (k === "needs") next.needs = cleanNeeds(fields.needs);
        else if (k === "sketches") {
          if (Array.isArray(fields.sketches) && fields.sketches.length > LIMITS.issue.sketches) throw bad(`an issue has at most ${LIMITS.issue.sketches} sketches`);
          next.sketches = cleanRefs(fields.sketches, this.db.assets, "sketches");
        } else if (k === "draw") next.draw = cleanDraw(fields.draw);
        else next.style = optText(fields.style, 200, "style");
      }
      else if (k === "attention") {
        if (next.kind !== "change" && next.kind !== "issue") throw bad("attention is judged on change and issue cards; a request's comes from where it stands");
        next.attention = fields.attention === null ? null : cleanAttention(fields.attention);
      }
      else if (k === "sheet") { if (fields.sheet !== null && !own(this.db.assets, fields.sheet)) throw bad(`sheet: no asset ${fields.sheet}`); next.sheet = fields.sheet; }
      else if (k === "states") next.states = cleanStates(fields.states);
      else if (k === "group") next.group = clean(fields.group, 60, "group");
      else if (k === "elements") { if (!Array.isArray(fields.elements)) throw bad("elements must be a list"); next.elements = fields.elements.slice(0, 30).map((id) => this.card(String(id)).id); }
      else if (k === "research") next.research = cleanResearch(fields.research, this.db.assets, this.db);
      else if (k === "origin") next.origin = cleanOrigin(fields.origin, this.db.cards);
      else if (k === "brief") {
        // The agent's brief for the call: what is on the table and what to decide.
        if (!next.agenda) throw bad("a brief belongs to a card on the agenda");
        next.agenda = { ...next.agenda, brief: clean(fields.brief, 1500, "brief") };
      }
      else if (k === "spec") {
        // A rewrite keeps the version it replaces, a person's edit included (specAction).
        const was = c?.spec, now = cleanLinks(k, fields.spec);
        // A new version Design Desk writes waits for a person (docs/handoff.md → Review before it
        // goes), unless the write says otherwise (`review`, as with spec_review disabled) or it went.
        if (now?.asset && now.asset !== was?.asset && now.review === undefined && !was?.sent) now.review = "draft";
        next.spec = now && was?.asset && now.asset && now.asset !== was.asset
          ? { ...now, history: [...(was.history || []), { asset: was.asset, at: was.at || c.updated, by: was.by || { agent: true } }].slice(-20), at: this.clock(), by: { agent: true } }
          : now && was ? { ...now, history: now.history || was.history, ...(was.sent && !now.sent ? { sent: was.sent } : {}) } : now;
      }
      else next[k] = cleanLinks(k, fields[k]);
    }
    // A spec for a request from Slack never leaves unread: only a person's Send to developers
    // (specAction) marks it sent, whatever `spec_review` says (docs/handoff.md step 3). The
    // stored origin counts too, so a write cannot rename it away, and the card is not handed
    // off before that send.
    // So does one from a pull request still open: the person picks a new issue or a comment on it.
    const waits = [c?.origin, next.origin].some((o) => o?.channel === "slack") || Boolean(c && this.fromPr(c));
    if (waits && !c?.spec?.sent && ((fields.spec !== undefined && next.spec && (next.spec.review === "sent" || next.spec.sent)) || (next.status === "handed-off" && c?.status !== "handed-off")))
      throw bad("a request from Slack or from an open pull request waits for a person's Send to developers: write its spec with review \"draft\", and hand it off only after that send (docs/handoff.md step 3)");
    if (!next.title) throw bad("a card needs a title");
    // One card per screen and per element: a card a person added that turns out to be one
    // already on the Desk is dropped with a pointer to it, never filled in as a second copy.
    const twin = next.status !== "dropped" && Object.values(this.db.cards).find((x) => x.id !== next.id && x.kind === next.kind && x.status !== "dropped"
      && ((next.kind === "screen" && next.path && x.path === next.path)
        || (next.kind === "element" && next.source?.file && x.source?.file === next.source.file && x.source?.export === next.source.export)));
    if (twin) throw new DeskError(409, `${twin.id} is already this ${next.kind}`);
    // A request a person filed on the Desk waits at its drawn options until a person asks the
    // team (docs/desk.md → Team feedback); one the agent filed for someone (Slack, chat) goes on
    // to feedback by itself, and so does one with no options to fine-tune.
    if (next.kind === "request" && next.status === "feedback" && c && ["triage", "variants"].includes(c.status) && !next.created_by?.agent && next.team_feedback?.state !== "open" && (next.variants || []).length)
      Object.assign(next, { status: "variants", team_feedback: { state: "waiting", since: this.clock() } });
    // A request that comes to feedback from another step starts a new vote (docs/desk.md → Team feedback).
    if (next.kind === "request" && next.status === "feedback" && c && c.status !== "feedback") delete next.vote_ended;
    if (!c) { next.id = this.next("card", "C"); }
    // A design written without its check against the decisions gets one queued; a write with
    // its check closes the check waiting for it (docs/desk.md → Decisions → The check).
    const same = (k) => JSON.stringify(c?.[k] ?? null) === JSON.stringify(next[k] ?? null);
    const moved = (fields.triage !== undefined && !same("triage")) || (fields.impact !== undefined && !same("impact"))
      || (fields.sketches !== undefined && !same("sketches")) || (next.kind === "change" && fields.sections !== undefined && !same("sections"))
      || (fields.variants !== undefined && JSON.stringify(Store.checkedOptions(c || {})) !== JSON.stringify(Store.checkedOptions(next)));
    if (next.decision_check && fields.decision_check !== undefined) {
      next.decision_check = { ...next.decision_check, at: this.clock(), options: Store.checkedOptions(next) };
      // A check a decision queued closes only once the write read that decision.
      const read = new Set(next.decision_check.read);
      for (const it of Object.values(this.db.inbox)) if (it.card === next.id && it.kind === "decision-check" && it.state === "open" && (it.decisions || []).every((d) => read.has(d)))
        Object.assign(it, { state: "done", done_at: this.clock(), outcome: "checked with its write" });
    }
    this.keepLook(c, next);
    // A screen's or an element's pictures sent again, new or the same: Design Desk looked at it again.
    if ((next.kind === "screen" || next.kind === "element") && (fields.screens !== undefined || fields.sheet !== undefined)) next.checked = this.clock();
    // A summary for Designs alone is not an event: a backfill must not move when a request was sent (docs/desk-page.md → Designs).
    if (!c || Object.keys(fields).some((k) => fields[k] !== undefined && !["id", "dev_summary", "ci"].includes(k))) next.updated = this.clock();
    this.db.cards[next.id] = next;
    // A design already in the catalog follows every new version of its option and of its states.
    if (next.kind === "request" && next.in_catalog && fields.variants !== undefined) {
      const v = next.variants.find((x) => x.id === next.in_catalog.variant);
      if (v) this.copyToCatalog(next, v, next.in_catalog.by);
    }
    for (const it of Object.values(this.db.inbox)) if (goneLive && it.card === next.id && it.kind === "build" && it.state === "open" && it.variant === goneLive)
      Object.assign(it, { state: "done", done_at: this.clock(), outcome: "not built: its option was taken off the card" });
    if (moved && fields.decision_check === undefined) this.queueCheck(next, { agent: true }, "Its design changed without a check against the decisions.");
    // A merged change that builds a sent design marks it done (docs/desk-page.md → Designs): its pull
    // request is the spec's, or its check says it matches the design.
    if (next.kind === "change" && next.source?.merged_at) {
      const hit = this.buildsOf(next)?.card || (next.design_check?.verdict === "matches" ? next.design_check.request : null);
      const r = hit ? own(this.db.cards, String(hit)) : null;
      if (r && r.kind === "request" && r.status === "handed-off" && !r.built && !r.not_built) r.built = { by: { agent: true }, at: this.clock(), change: next.id };
      // Shipped, its approved option's elements join the design catalog, as Add to the design catalog would (docs/catalog.md → From approved designs).
      const v = r?.kind === "request" && r.approved && ["spec", "handed-off"].includes(r.status) ? (r.variants || []).find((x) => x.id === r.approved.variant) || ((r.variants || []).length === 1 ? r.variants[0] : null) : null;
      if (v) for (const e of elementsOf(v)) if (!r.in_catalog?.elements?.[e.key]) this.copyToCatalog(r, v, { agent: true }, e.key);
    }
    this.save();
    return { card: next };
  }

  // ---------- how an element or a screen looked before ----------

  // A redraw that replaces an element's sheet or a screen's pictures keeps the look it
  // replaces, so people can step back through its versions. Every look knows the shipped
  // changes that made it (`made_by`); a redraw that looks the same byte for byte is no
  // new version.
  keepLook(c, next) {
    if (next.kind !== "element" && next.kind !== "screen") return;
    const pictures = (x) => (x.kind === "element" ? (x.sheet ? [x.sheet] : []) : (x.screens || []).map((s) => s.asset));
    const before = c ? pictures(c) : [], now = pictures(next);
    if (!now.length || (now.length === before.length && now.every((id, i) => this.sameAsset(id, before[i])))) return;
    next.drawn = this.clock();
    if (!before.length) { next.made_by = []; return; }
    const at = c.drawn || c.updated;
    next.made_by = this.changesBetween(next, at, next.drawn);
    const look = c.kind === "element"
      ? { sheet: c.sheet, thumb: c.screens?.[0]?.asset || null, states: (c.states || []).map((x) => x.name) }
      : { screens: c.screens };
    next.history = byDate([{ ...look, at, commit: c.source?.commit || null, made_by: c.made_by || [], links: [], note: "" }, ...(c.history || [])]);
  }

  sameAsset(a, b) {
    if (a === b) return true;
    const x = own(this.db.assets, a), y = own(this.db.assets, b);
    if (!x || !y || x.bytes !== y.bytes) return false;
    try { return readFileSync(join(this.assetDir, x.file)).equals(readFileSync(join(this.assetDir, y.file))); } catch { return false; }
  }

  // The shipped changes that touched an element or a screen in a span of time, oldest first.
  changesBetween(card, from, to) {
    return Object.values(this.db.cards)
      .filter((x) => x.kind === "change" && !(x.source?.pr && !x.source?.merged_at) && ((x.elements || []).includes(card.id) || (card.changes || []).includes(x.id)))
      .map((x) => ({ id: x.id, at: x.source?.merged_at || x.created }))
      .filter((x) => instant(x.at) > instant(from) && instant(x.at) <= instant(to))
      .sort((a, b) => instant(a.at) - instant(b.at))
      .map((x) => x.id);
  }

  // An earlier look the agent drew later from the code's history (an element at the merge
  // of an older change), put in its place by date; the same commit drawn again replaces
  // its look. `made_by` and `links` name the change that made it look like this.
  addLook(cardId, look) {
    const c = this.card(cardId);
    if (c.kind !== "element" && c.kind !== "screen") throw bad("only an element or a screen has earlier looks");
    if (typeof look !== "object" || !look) throw bad("a look must be an object");
    const t = Date.parse(clean(String(look.at || ""), 40, "at"));
    if (Number.isNaN(t)) throw bad("at must be a date");
    if (t >= instant(c.drawn || c.updated)) throw bad("a look newer than the current drawing is the drawing: upsert it");
    const at = new Date(t).toISOString().replace(/\.\d{3}Z$/, "Z");
    const ref = (id, name) => { if (!own(this.db.assets, id)) throw bad(`${name}: no asset ${id}`); return id; };
    const pictures = c.kind === "element"
      ? { sheet: ref(look.sheet, "sheet"), thumb: look.thumb == null ? null : ref(look.thumb, "thumb"), states: look.states == null ? [] : cleanStates(look.states.map((x) => (typeof x === "string" ? { name: x } : x))).map((x) => x.name) }
      : { screens: cleanRefs(look.screens, this.db.assets, "screens") };
    if (c.kind === "screen" && !pictures.screens.length) throw bad("a screen's look needs its pictures");
    if (look.made_by != null && !Array.isArray(look.made_by)) throw bad("made_by must be a list");
    const made = (look.made_by || []).slice(0, 20).map((id) => this.card(String(id))).filter((x) => x.kind === "change").map((x) => x.id);
    const links = Array.isArray(look.links) ? look.links.slice(0, 10).map((l) => {
      if (!/^https?:\/\//i.test(String(l?.url || ""))) throw bad("links must be http(s)");
      return { label: clean(String(l.label || ""), 120, "link label"), url: String(l.url).slice(0, 500) };
    }) : [];
    const commit = optText(look.commit, 64, "commit") || null;
    const entry = { ...pictures, at, commit, made_by: made, links, note: optText(look.note, 300, "note"), drawn: this.clock(), later: true };
    c.history = byDate([entry, ...(c.history || []).filter((x) => !commit || x.commit !== commit)]);
    c.updated = this.clock();
    this.save();
    return { card: c, look: entry };
  }

  // ---------- votes in Slack ----------

  // The agent posts a request's options to Slack, one reply per option, and people vote
  // with reactions. The poll remembers where the posts are; the agent syncs it while it
  // is open and closes it on its date or when the request moves on.
  openPoll(cardId, { chat, root_ts, posts, closes, url = null, channel = null }) {
    const c = this.card(cardId);
    if (!Array.isArray(posts) || !posts.length) throw bad("a poll needs one post per option");
    for (const x of posts) if (!(c.variants || []).some((v) => v.id === x.variant)) throw bad(`no option ${x.variant}`);
    const poll = {
      id: this.next("poll", "P"), state: "open", opened: this.clock(), synced: null,
      chat: clean(String(chat || ""), 80, "chat"), root_ts: clean(String(root_ts || ""), 40, "root_ts"),
      channel: optText(channel, 80, "channel"), url: /^https:\/\//.test(String(url || "")) ? String(url).slice(0, 300) : null,
      closes: clean(String(closes || ""), 40, "closes"),
      posts: posts.slice(0, 6).map((x) => ({ variant: String(x.variant), ts: clean(String(x.ts || ""), 40, "ts") })),
    };
    c.polls = [...(c.polls || []), poll];
    c.updated = this.clock();
    this.save();
    return { poll };
  }

  updatePoll(cardId, pollId, { synced = null, result = null } = {}) {
    const c = this.card(cardId);
    const poll = (c.polls || []).find((x) => x.id === pollId);
    if (!poll) throw missing(`no poll ${pollId} on ${cardId}`);
    if (synced) poll.synced = clean(String(synced), 40, "synced");
    if (result !== null) { poll.state = "closed"; poll.closed = this.clock(); poll.result = clean(String(result), 600, "result"); }
    c.updated = this.clock();
    this.save();
    return { poll };
  }

  // ---------- councils in Slack ----------

  // People discuss a request in a Slack thread and ask for changes there; the agent answers
  // each ask with a new option or version. The council remembers the thread, how far the
  // agent has read it (`seen`, a Slack ts) and when it last looked.
  openCouncil(cardId, { chat, thread_ts, url = null, channel = null }) {
    const c = this.card(cardId);
    const ts = clean(String(thread_ts || ""), 40, "thread_ts");
    const held = this.findCouncil(ts);
    if (held && held.state === "open") return { council: this.card(held.card).councils.find((x) => x.id === held.council), duplicate: true };
    // A reopen starts its idle clock again and keeps how far the thread was read.
    const was = (c.councils || []).find((x) => x.thread_ts === ts);
    if (was) { Object.assign(was, { state: "open", opened: this.clock(), synced: null, closed: null, result: null }); c.updated = this.clock(); this.save(); return { council: was }; }
    const council = {
      id: this.next("council", "S"), state: "open", opened: this.clock(), synced: null, seen: null,
      chat: clean(String(chat || ""), 80, "chat"), thread_ts: ts,
      channel: optText(channel, 80, "channel"), url: /^https:\/\//.test(String(url || "")) ? String(url).slice(0, 300) : null,
    };
    c.councils = [...(c.councils || []), council];
    c.updated = this.clock();
    this.save();
    return { council };
  }

  updateCouncil(cardId, councilId, { synced = null, seen = null, result = null } = {}) {
    const c = this.card(cardId);
    const council = (c.councils || []).find((x) => x.id === councilId);
    if (!council) throw missing(`no council ${councilId} on ${cardId}`);
    if (synced) council.synced = clean(String(synced), 40, "synced");
    if (seen) council.seen = clean(String(seen), 40, "seen");
    if (result !== null) { council.state = "closed"; council.closed = this.clock(); council.result = clean(String(result), 600, "result"); }
    c.updated = this.clock();
    this.save();
    return { council };
  }

  // The council of a Slack thread; without one, the request the thread filed (a bug
  // report, say), so a first ask there lands on that card instead of a second one.
  findCouncil(ts) {
    for (const c of Object.values(this.db.cards)) for (const x of c.councils || [])
      if (x.thread_ts === ts) return { card: c.id, council: x.id, state: x.state };
    const c = Object.values(this.db.cards).find((x) => x.kind === "request" && x.origin?.thread_ts === ts);
    return c ? { card: c.id, council: null, state: null } : null;
  }

  // The reactions on one option's post, as they are now. A person's own vote on the Desk
  // wins over their reaction; a reaction taken back takes the vote away.
  slackVotes(cardId, variant, voters) {
    const c = this.card(cardId);
    if (!(c.variants || []).some((v) => v.id === variant)) throw bad(`no option ${variant}`);
    if (!Array.isArray(voters)) throw bad("voters must be a list");
    c.votes = c.votes || {};
    const box = (c.votes[variant] = c.votes[variant] || {});
    // A reaction already counted keeps its time: a sync is not a new vote, so the bell shows
    // only a reaction added or changed since the last sync (docs/desk-page.md → Notifications).
    const was = new Map();
    for (const [k, x] of Object.entries(box)) if (x.via === "slack") { was.set(k, x); delete box[k]; }
    for (const v of voters.slice(0, 500)) {
      // Slack votes 👍 or 👎 only: a concern there is a reply in the option's thread, relayed as a
      // comment (slack-polls → Share 4). A concern sent as a vote is dropped.
      if (!["prefer", "dislike"].includes(v.vote)) continue;
      // The agent's own 👍 and 👎 are the legend it puts on each post so a vote is one
      // click (slack-polls → Share 4), not votes: a bot's reaction never counts.
      if (v.is_bot === true) continue;
      const key = clean(String(v.key || ""), 200, "voter key");
      if (box[key]) continue;
      box[key] = { vote: v.vote, role: optText(v.role, 20, "role") || "slack", name: optText(v.name, 120, "name") || null, via: "slack", at: was.get(key)?.vote === v.vote ? was.get(key).at : this.clock(), note: "" };
    }
    c.updated = this.clock();
    this.save();
    return { votes: c.votes[variant] };
  }

  // A reply someone wrote in Slack becomes a comment once: on the option it was under, or
  // on the whole request when it came from a council thread. A mention (<@U0123>) reads as
  // the person's name the agent looked up (`mentions`), else it is left out.
  relayComment(cardId, { variant = null, name, email = null, role = null, text, slack_ts, url = null, mentions = {} }) {
    const named = mentions && typeof mentions === "object" ? mentions : {};
    text = String(text ?? "").replace(/( ?)<@([\w-]+)(?:\|([^>]+))?>/g, (m, sp, id, label) => {
      const name = own(named, id);
      const who = String(typeof name === "string" ? name : label ?? "").replace(/[<>]/g, "").replace(/^@/, "").trim().slice(0, 120);
      return who ? `${sp}@${who}` : "";
    }).trim();
    const c = this.card(cardId);
    if (variant && !(c.variants || []).some((v) => v.id === variant)) throw bad(`no option ${variant}`);
    const ts = clean(String(slack_ts || ""), 40, "slack_ts");
    const seen = (c.threads || []).map((t) => this.db.threads[t]).find((t) => t?.slack_ts === ts);
    if (seen) return { thread: seen, duplicate: true };
    const { thread } = this.openThread(cardId, { via: "slack", name, email, role: role || "slack" }, { kind: "comment", text, anchor: variant ? { variant, label: "the whole option" } : null });
    thread.slack_ts = ts;
    if (/^https:\/\//.test(String(url || ""))) thread.slack_url = String(url).slice(0, 300);
    this.save();
    return { thread };
  }

  findFinding(ref) {
    const c = Object.values(this.db.cards).find((x) => x.origin?.automated && x.origin.ref === ref);
    return c ? { card: c.id, status: c.status, title: c.title } : null;
  }

  findPoll(ts) {
    for (const c of Object.values(this.db.cards)) for (const poll of c.polls || []) {
      const post = poll.root_ts === ts ? { variant: null } : poll.posts.find((x) => x.ts === ts);
      if (post) return { card: c.id, poll: poll.id, state: poll.state, variant: post.variant };
    }
    return null;
  }

  // ---------- screens people add ----------

  // A person adds screenshots to a card (a shipped change the pull request showed no
  // picture of, say); the agent checks each shows the change, and captions it.
  addScreens(cardId, who, assetIds) {
    const c = this.card(cardId);
    if (!assetIds.length) throw bad("Add at least one picture.");
    const added = assetIds.map((asset) => ({ asset, caption: "", source: "person", by: person(who) }));
    c.screens = [...(c.screens || []), ...added].slice(-30);
    c.updated = this.clock();
    const item = this.pendingOrNew("screens", cardId, who);
    this.save();
    return { card: c, inbox: item };
  }

  // A designer or an admin deletes a closed request for good: the card, its conversations, its
  // pictures and Design Desk's finished work on it (docs/desk.md → Deleting a request). Only once
  // nothing is left to do on it, so no live prototype outlives it.
  deleteRequest(cardId, who) {
    const c = this.card(cardId);
    if (!who || who.agent) throw forbidden("Only a person deletes a request.");
    if (c.kind !== "request") throw bad("Only a request is deleted.");
    if (c.status !== "declined") throw bad("Close the request first: only a closed request is deleted.");
    if (["building", "live"].includes(c.prototype?.state)) throw bad("Its live prototype is still on. Delete it once Design Desk has switched it off.");
    if (Object.values(this.db.inbox).some((i) => i.card === cardId && i.state !== "done")) throw bad("Design Desk is still working on this request. Delete it once it is done.");
    for (const [id, t] of Object.entries(this.db.threads)) if (t.card === cardId) delete this.db.threads[id];
    for (const [id, i] of Object.entries(this.db.inbox)) if (i.card === cardId) delete this.db.inbox[id];
    for (const [id, a] of Object.entries(this.db.assets)) if (a.card === cardId) { try { unlinkSync(join(this.assetDir, a.file)); } catch {} delete this.db.assets[id]; }
    for (const mine of Object.values(this.db.reads)) if (mine && typeof mine === "object") delete mine[cardId];
    delete this.db.cards[cardId];
    this.save();
    return { deleted: cardId };
  }

  // ---------- decisions ----------

  // What the team decided, who decided it and where, kept so a later change can say what it
  // follows or goes against (docs/desk.md → Decisions). The agent records them; a person
  // asks for one from a comment, revokes one or restores it.
  addDecision({ concepts, text, why = "", author, origin, at = null, replaces = [], conflicts = [], pictures = [] }, { onDesk = false } = {}) {
    if (!Array.isArray(concepts) || !concepts.length) throw bad("a decision names at least one concept");
    if (!Array.isArray(replaces)) throw bad("replaces must be a list of D-n");
    if (!Array.isArray(pictures)) throw bad("pictures must be a list of asset ids");
    const d = {
      concepts: concepts.slice(0, 10).map((x) => clean(String(x), 80, "concept").toLowerCase()),
      text: clean(text, 600, "decision"), why: optText(why, 1500, "why"),
      author: cleanAuthor(author), origin: cleanDecisionOrigin(origin, this.db.cards, this.db.threads, onDesk),
      at: optText(at, 40, "at") || this.clock(), recorded: this.clock(), status: "active",
    };
    const pics = [...new Set(pictures.slice(0, 4).map(String))];
    for (const id of pics) if (!own(this.db.assets, id)) throw bad(`pictures: no asset ${id}`);
    if (pics.length) d.pictures = pics;
    const old = [...new Set(replaces.slice(0, 10).map((id) => this.decision(String(id))))];
    for (const o of old) if (o.status !== "active") throw bad(`replaces: ${o.id} is no longer in force`);
    const against = cleanConflicts(conflicts, this.db.decisions);
    if (against.some((x) => old.some((o) => o.id === x.decision))) throw bad("a decision replaces an earlier one or goes against it, not both");
    d.id = this.next("decision", "D");
    if (old.length) d.replaces = old.map((o) => o.id);
    if (against.length) d.conflicts = against;
    for (const o of old) this.markRevoked(o, { by: d.author, reason: `Replaced by ${d.id}`, replaced_by: d.id, origin: d.origin });
    // The comment it was decided in shows its number.
    const m = d.origin.thread && d.origin.message != null ? own(this.db.threads, d.origin.thread)?.messages[d.origin.message] : null;
    if (m) m.decision = d.id;
    this.db.decisions[d.id] = d;
    this.checkAgainst(d);
    this.save();
    return { decision: d };
  }

  // A designer or an admin adds a decision on the Desk, in their own name, with its pictures
  // (docs/desk.md → Decisions → Adding one on the Desk).
  recordDecision(who, { text, why = "", concepts = [], pictures = [] } = {}) {
    if (!who || who.agent) throw forbidden("Design Desk does not decide: a person does");
    const about = (Array.isArray(concepts) ? concepts : String(concepts || "").split(",")).map((x) => String(x).trim()).filter(Boolean);
    if (!about.length) throw bad("Say what it is about, e.g. send button.");
    const role = readRole(who.role);
    return this.addDecision({ concepts: about, text, why, pictures,
      author: { email: who.email, ...(ADDABLE_ROLES.includes(role) || role === "admin" ? { role } : {}) },
      origin: { kind: "desk", label: "Added on the Desk" } }, { onDesk: true });
  }

  // A person on the page revokes in their own name; the agent names the person and where they said it.
  revokeDecision(id, who, { reason, replaced_by = null, by = null, origin = null } = {}) {
    const d = this.decision(id);
    if (d.status !== "active") throw bad(`${d.id} is already revoked`);
    const rep = replaced_by ? this.decision(String(replaced_by)) : null;
    if (rep && (rep.id === d.id || rep.status !== "active")) throw bad("replaced_by names another decision in force");
    const r = who?.agent ? { by: cleanAuthor(by), origin: cleanDecisionOrigin(origin, this.db.cards, this.db.threads) } : { by: { email: who.email || null, role: who.role || null } };
    this.markRevoked(d, { ...r, reason: clean(reason, 600, "reason"), replaced_by: rep?.id || null });
    this.save();
    return { decision: d };
  }

  markRevoked(d, { by, reason, replaced_by = null, origin = null }) {
    d.status = "revoked";
    d.revoked = { by, at: this.clock(), reason, replaced_by, ...(origin ? { origin } : {}) };
    d.history = [...(d.history || []), { what: "revoked", ...d.revoked }].slice(-20);
  }

  restoreDecision(id, who) {
    const d = this.decision(id);
    if (d.status === "active") throw bad(`${d.id} is in force`);
    d.status = "active";
    delete d.revoked;
    // What replaced it no longer does: both are in force again.
    for (const o of Object.values(this.db.decisions)) if ((o.replaces || []).includes(d.id)) {
      o.replaces = o.replaces.filter((x) => x !== d.id);
      if (!o.replaces.length) delete o.replaces;
    }
    d.history = [...(d.history || []), { what: "restored", by: { email: who.email || null, role: who.role || null }, at: this.clock() }].slice(-20);
    this.checkAgainst(d);
    this.save();
    return { decision: d };
  }

  // A designer approves a decision someone else made (docs/desk.md → Decisions → Approved by a
  // designer). It holds either way; the approval only shows that a designer stands behind it.
  approveDecision(id, who) {
    if (!who || who.agent) throw forbidden("Design Desk does not approve decisions: a designer does");
    const d = this.decision(id);
    if (d.status !== "active") throw bad(`${d.id} is revoked: restore it first`);
    if (d.approved) throw bad(`${d.id} is already approved`);
    d.approved = { by: { email: who.email || null, role: who.role || null, ...(who.name ? { name: who.name } : {}) }, at: this.clock() };
    d.history = [...(d.history || []), { what: "approved", ...d.approved }].slice(-20);
    this.save();
    return { decision: d };
  }

  // A designer asks Design Desk to record what a person said in a comment as a decision.
  proposeDecision(threadId, who, { message, note = "" } = {}) {
    const t = this.threadFor(threadId, who);
    if (t.kind === "private") throw bad("A private ask is not recorded as a decision: send it to the comments first.");
    const i = Number(message);
    if (!Number.isInteger(i) || !t.messages[i]) throw bad("pick a message of this conversation");
    if (t.messages[i].by?.agent) throw bad("Design Desk does not decide: record what a person said");
    if (t.messages[i].decision) throw bad(`This is already ${t.messages[i].decision}.`);
    if (Object.values(this.db.inbox).some((x) => x.kind === "decision" && x.thread === threadId && x.message === i && x.state !== "done")) throw bad(BUSY);
    const item = this.enqueue("decision", t.card, threadId, who, optText(note, 600, "note"));
    item.message = i;
    this.save();
    return { inbox: item };
  }

  listDecisions({ concept = "", q = "", state = "" } = {}) {
    const c = String(concept || "").toLowerCase(), w = String(q || "").toLowerCase().trim();
    return Object.values(this.db.decisions)
      .filter((d) => (!state || d.status === state)
        && (!c || d.concepts.some((x) => x.includes(c) || c.includes(x)))
        && (!w || d.id.toLowerCase() === w || `${d.text} ${d.why}`.toLowerCase().includes(w)))
      .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
      // Each decision it goes against says whether that one still holds: the list's red ! counts only those in force.
      .map((d) => d.conflicts ? { ...d, conflicts: d.conflicts.map((x) => ({ ...x, status: this.db.decisions[x.decision]?.status || "revoked" })) } : d);
  }

  // One decision with everything that names it: cards that follow it or go against it, and
  // decisions that replace it or go against it.
  getDecision(id) {
    const d = this.decision(id), refs = [];
    for (const c of Object.values(this.db.cards)) {
      const how = (c.conflicts || []).some((x) => x.decision === d.id) ? "conflicts"
        : (c.decisions || []).includes(d.id) || (c.impact?.decisions || []).some((x) => x.id === d.id) ? "cites"
        : shapedBy(c).includes(d.id) ? "shapes" : null;
      // An option it shaped is named, so the decision's page says which design follows it.
      const options = (c.variants || []).filter((v) => (v.reasons || []).some((r) => r.decision === d.id)).map((v) => v.name);
      if (how) refs.push({ id: c.id, kind: c.kind, title: c.title, status: c.status, how, ...(options.length ? { options } : {}) });
    }
    for (const o of Object.values(this.db.decisions)) {
      const how = (o.replaces || []).includes(d.id) ? "replaces" : (o.conflicts || []).some((x) => x.decision === d.id) ? "conflicts" : null;
      if (how) refs.push({ id: o.id, kind: "decision", title: o.text, status: o.status, how });
    }
    const against = (d.conflicts || []).map((x) => { const o = own(this.db.decisions, x.decision); return { ...x, text: o?.text || "", status: o?.status || "revoked" }; });
    return { decision: { ...d, conflicts: against }, refs };
  }

  // A decision read against a Figma frame that goes against it (the figma skill → Compare with
  // the product); null clears it.
  setDecisionFigma(id, check) {
    const d = this.decision(id);
    if (check === null) delete d.figma_check;
    else d.figma_check = keepDismissed(d.figma_check, cleanFigmaCheck(check, this.db.assets, this.clock(), null));
    this.save();
    return { decision: d };
  }

  // A person takes a difference off an item's Figma table (the box's ×), or brings it back
  // (on: false). It stays off while the frame is the same (keepDismissed).
  dismissFigma(id, who, part, on = true) {
    const x = String(id).startsWith("D-") ? this.decision(id) : this.card(id);
    const k = x.figma_check;
    if (!k) throw bad("Nothing here is compared with Figma.");
    const key = String(part || "").trim();
    if (!k.differences.some((d) => d.part === key)) throw bad("That difference is not in the table.");
    const rest = (k.dismissed || []).filter((d) => d.part !== key);
    if (on) rest.push({ part: key, by: person(who), at: this.clock() });
    if (rest.length) k.dismissed = rest; else delete k.dismissed;
    if (x.kind) x.updated = this.clock();
    this.save();
    return { figma_check: k };
  }

  // The whole comparison off Product → Differences for everyone, or back (`on: false`); it
  // comes back on its own once the frame in Figma changes (keepDismissed).
  closeFigma(id, who, on = true) {
    const x = this.card(id);
    const k = x.figma_check;
    if (!k) throw bad("Nothing here is compared with Figma.");
    if (on) k.closed = { by: person(who), at: this.clock() }; else delete k.closed;
    x.updated = this.clock();
    this.save();
    return { figma_check: k };
  }

  addAsset({ card = null, kind, name, contentType, data, encoding = "base64" }) {
    if (!["screen", "variant", "spec", "patch", "image", "report"].includes(kind)) throw bad("unknown asset kind");
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType || "")) throw bad("contentType is not a media type");
    const buf = Buffer.from(String(data || ""), encoding === "utf8" ? "utf8" : "base64");
    if (!buf.length) throw bad("the asset is empty");
    if (buf.length > LIMITS.assetBytes) throw bad(`the asset is ${buf.length} bytes; the Desk serves at most ${LIMITS.assetBytes} (compress the image or split the page)`);
    const held = Object.values(this.db.assets).reduce((n, a) => n + (a.bytes || 0), 0);
    if (held + buf.length > LIMITS.assetsBytes) throw bad("The Desk holds as many pictures and pages as it can (2 GiB). A designer or an admin frees room by deleting a closed request (Delete this request…).");
    const id = this.next("asset", "A");
    const ext = (contentType.split("/")[1] || "bin").replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin";
    const file = `${id}.${ext}`;
    writeFileSync(join(this.assetDir, file), buf);
    this.db.assets[id] = { id, card, kind, name: optText(name, 200, "name") || id, contentType, file, bytes: buf.length, created: this.clock() };
    this.save();
    return { asset: this.db.assets[id] };
  }

  stats() {
    const items = Object.values(this.db.inbox);
    return {
      cards: Object.keys(this.db.cards).length,
      changes_new: Object.values(this.db.cards).filter((c) => c.kind === "change" && c.status === "new").length,
      requests_open: Object.values(this.db.cards).filter((c) => c.kind === "request" && !["handed-off", "declined"].includes(c.status)).length,
      inbox_open: items.filter((i) => i.state === "open").length,
      inbox_claimed: items.filter((i) => i.state === "claimed").length,
      db_bytes: existsSync(this.dbPath) ? statSync(this.dbPath).size : 0,
    };
  }
}

// The option designers like most, as the page shows it: none on a tie, the only one when there is one.
function favouriteOf(c) {
  const vs = c.variants || [];
  if (vs.length === 1) return vs[0];
  const score = (v) => Object.values(c.votes?.[v.id] || {}).filter((x) => x.vote === "prefer" && ["designer", "admin"].includes(x.role)).length;
  const s = [...vs].sort((a, b) => score(b) - score(a));
  return s.length && score(s[0]) > 0 && score(s[0]) > (s[1] ? score(s[1]) : 0) ? s[0] : null;
}

// Every way past the vote and the prototype waits for Design Desk's check (docs/desk.md →
// Deciding straight away).
// Past Checking, a request was checked.
function mustBeChecked(c, verb) {
  if (c.status === "triage" && !c.triage) throw bad(`Design Desk is still checking this request. ${verb} it once it says what can be done.`);
}

// Whether a person filed the request: its author never approves it For Developers. A
// request the agent filed for someone carries their email in `origin.email` when the channel
// disclosed it; a name or login alone (`origin.reporter`) names no Desk person.
// An approved design is final: from Approve on (the spec, sent to developers) nothing changes
// it; a change is a new request made from it (docs/desk.md → Approved is final).
// The issue or pull request of a request's last earlier send, which a new send may close
// (docs/handoff.md, step 6): never a comment, whose issue is not the send's own.
const earlierSend = (c) => {
  const s = (c.sends || []).slice(-1)[0], url = s?.spec?.issue_url || s?.spec?.pr_url || "";
  return /^https:\/\/[^\s#?]+\/(issues|pull)\/\d+$/.test(url) ? url : null;
};
const designLocked = (c) => c.kind === "request" && Boolean(c.approved) && ["spec", "handed-off"].includes(c.status);
const LOCKED = "This design is approved, so it no longer changes. To change it, start a new request from this one.";
const isAuthor = (c, who) => {
  const me = addressesOf(who);
  return me.length > 0 && [c.created_by?.email, c.origin?.email].some((x) => me.includes(String(x || "").toLowerCase()));
};
const cleanEmail = (v) => {
  const e = String(v).trim().toLowerCase();
  if (!EMAIL.test(e) || e.length > 200) throw bad("origin.email must be an email");
  return e;
};

function person(who) {
  if (!who) return { agent: true };
  if (who.agent) return { agent: true };
  if (who.via === "slack") return { email: who.email || null, role: who.role || "slack", name: who.name || null, via: "slack" };
  return { email: who.email || null, role: who.role || "guest" };
}

// The part of an option whose states a person asked for: what they selected in the workspace.
function cleanPart(p) {
  const a = cleanAnchor(p);
  return { selector: a.selector, text: a.text, label: a.label, view: a.view, view_name: a.view_name };
}

function cleanAnchor(a) {
  if (typeof a !== "object") throw bad("anchor must be an object");
  return {
    variant: typeof a.variant === "string" ? a.variant.slice(0, 40) : null,
    // One state of the option (its `states`), when the note is about that state's drawing.
    state: typeof a.state === "string" ? a.state.slice(0, 40) : null,
    asset: typeof a.asset === "string" ? a.asset.slice(0, 40) : null,
    selector: typeof a.selector === "string" ? a.selector.slice(0, 500) : null,
    text: typeof a.text === "string" ? a.text.slice(0, 300) : null,
    tag: typeof a.tag === "string" ? a.tag.slice(0, 40) : null,
    label: typeof a.label === "string" ? a.label.slice(0, 120) : null,
    // The view of a multi-view design the element is in (`data-view`, its name).
    view: typeof a.view === "string" ? a.view.slice(0, 40) : null,
    view_name: typeof a.view_name === "string" ? a.view_name.slice(0, 120) : null,
    edit: a.edit && typeof a.edit === "object" ? { from: String(a.edit.from || "").slice(0, 300), to: String(a.edit.to || "").slice(0, 300) } : null,
  };
}

// A change card's section names where it comes from ("the issue #12", "not documented —
// ask the author"), so a reader sees the source of every paragraph.
function cleanSections(list, brief = null, cards = {}) {
  if (!Array.isArray(list)) throw bad("sections must be a list");
  if (brief && list.length > brief.sections) throw bad(`a change card has at most ${brief.sections} sections`);
  return list.slice(0, 20).map((s) => {
    if (brief && !s.source?.label) throw bad(`section "${s.title}" needs source.label: where it comes from, or that it is not documented`);
    return {
      key: String(s.key || "").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "note",
      title: clean(s.title, LIMITS.title, "section title"),
      body: clean(s.body, brief?.section ?? LIMITS.text * 2, "section body"),
      ...(s.source ? { source: cleanSource(s.source, cards) } : {}),
    };
  });
}

function cleanRefs(list, assets, name) {
  if (!Array.isArray(list)) throw bad(`${name} must be a list`);
  return list.slice(0, 30).map((s) => {
    const asset = typeof s === "string" ? s : s.asset;
    if (!own(assets, asset)) throw bad(`${name}: no asset ${asset}`);
    return {
      asset, caption: typeof s === "object" ? optText(s.caption, 300, "caption") : "",
      ...(SCREEN_SOURCES.includes(s?.source) ? { source: s.source } : {}),
      ...(["before", "after", "diff"].includes(s?.stage) ? { stage: s.stage, pair: optText(s.pair, 120, "pair") || "screen" } : {}),
      ...(Array.isArray(s?.marks) && s.marks.length ? { marks: cleanMarks(s.marks) } : {}),
      ...(s?.by && typeof s.by === "object" ? { by: { email: optText(s.by.email, 200, "email") || null, role: optText(s.by.role, 20, "role") || null } } : {}),
    };
  });
}

// Where the change is on a picture: boxes as fractions of its width and height (0–1), from
// `design diff`'s `marks`; the page outlines them when a person asks.
function cleanMarks(list) {
  const f = (v) => Math.min(1, Math.max(0, Math.round(Number(v) * 10000) / 10000));
  if (list.length > 20) throw bad("marks: at most 20 (design diff's `marks`)");
  return list.map((m) => {
    if (!m || typeof m !== "object" || ![m.x, m.y, m.w, m.h].every((v) => Number.isFinite(Number(v)))) throw bad("marks: each is {x, y, w, h} between 0 and 1");
    const x = f(m.x), y = f(m.y);
    return { x, y, w: f(Math.min(m.w, 1 - x)), h: f(Math.min(m.h, 1 - y)) };
  }).filter((m) => m.w > 0 && m.h > 0);
}

// Dates are compared as instants: an agent's date can carry an offset (`git log %cI`).
const instant = (iso) => Date.parse(iso) || 0;
// The decisions a card's options rest on (variants[].reasons).
const shapedBy = (c) => [...new Set((c.variants || []).flatMap((v) => (v.reasons || []).map((r) => r.decision)))];

// Earlier looks, newest first; past the limit the oldest go.
const byDate = (looks) => looks.sort((a, b) => instant(b.at) - instant(a.at)).slice(0, LIMITS.looks);

// A variant the agent redraws keeps its id; its earlier drawings stay as history, so the
// page can show what changed and people's pinned notes still find their option.
// An entry that leaves `stories` out keeps the option's coverage from before, and one that
// leaves `reasons` out the decisions it rests on.
// Two runs on one card each send the whole list: a run that read an option or a state at a
// version older than the card's would put back the drawing it replaced, so it is refused.
// An option or a state already on the card is sent with the `version` the run read; one
// it leaves out is gone only when it says so (`drop: true`, or `states: []`).
function versioned(list, before, at, removed = []) {
  const stale = (m) => new DeskError(409, `${m} Read the card again and send what is there now.`);
  // A designer took this option off (its tab's ✕): a run that read the card before sends it back.
  for (const x of list) if (!x.drop && removed.includes(x.id) && !before.some((o) => o.id === x.id)) throw stale(`${x.name || x.id} was removed from the request; leave it out, or draw a new option under a new id.`);
  const dropped = new Set(list.filter((x) => x.drop).map((x) => x.id));
  for (const id of dropped) if (!before.some((x) => x.id === id)) throw bad(`there is no option ${id} to drop`);
  const variants = list.filter((x) => !x.drop);
  if (variants.length > 6) throw bad("a request has at most 6 options");
  for (const o of before) if (!dropped.has(o.id) && !variants.some((x) => x.id === o.id)) throw stale(`${o.name} is on the card but not in what you sent; send it, or {id: "${o.id}", drop: true} to take it off.`);
  for (const given of variants) {
    const old = before.find((x) => x.id === given.id);
    if (!old) continue;
    if (given.read == null) throw stale(`${given.name} is on the card at version ${old.version || 1}; send the version you read.`);
    if (given.read < (old.version || 1)) throw stale(`${given.name} is at version ${old.version} now; you read version ${given.read}.`);
    if (!given.states || !given.states.length) continue;
    for (const o of old.states || []) if (!given.states.some((x) => x.id === o.id)) throw stale(`${given.name}: the state ${o.name} is on the card but not in what you sent; send it, or states: [] to remove them all.`);
    for (const st of given.states) {
      const o = (old.states || []).find((x) => x.id === st.id);
      if (!o) continue;
      if (st.read == null) throw stale(`${given.name}: the state ${st.name} is on the card at version ${o.version || 1}; send the version you read.`);
      if (st.read < (o.version || 1)) throw stale(`${given.name}: the state ${st.name} is at version ${o.version} now; you read version ${st.read}.`);
    }
  }
  return variants.map(({ read, ...given }) => {
    if (given.states) given.states = given.states.map(({ read: _, ...x }) => x);
    const old = before.find((x) => x.id === given.id);
    const was = old?.version || 1, now = !old ? 1 : old.asset === given.asset ? was : was + 1;
    // Alternatives are of the option at one version: a redrawn option drops the ones it had.
    const alternatives = given.alternatives ? given.alternatives.map((x) => ({ ...x, of: now, drawn: at })) : old && old.asset === given.asset ? old.alternatives || [] : [];
    // A person's own option keeps who added it through every run's upsert.
    // An option carried over from an approved request keeps saying so through every version.
    const v = { ...given, ...(old?.by ? { by: old.by } : {}), ...(old?.carried ? { carried: old.carried } : {}), stories: given.stories || old?.stories || null, reasons: given.reasons || old?.reasons || null, elements: given.elements ?? old?.elements ?? [], states: versionedStates(given.states ?? old?.states ?? [], old?.states || [], at, now, was, given.name || given.id), alternatives };
    if (!old) return { ...v, version: 1, history: [], drawn: at };
    const figma = v.figma_url || old.figma_url || null;
    if (old.asset === v.asset) return { ...v, version: was, history: old.history || [], drawn: old.drawn || at, figma_url: figma };
    return { ...v, version: now, drawn: at, figma_url: v.figma_url || null,
      history: [{ asset: old.asset, version: was, drawn: old.drawn || null }, ...(old.history || [])].slice(0, 10) };
  });
}

// A state is a copy of the whole option: drawn for an earlier version of it, it is out of date.
export const staleStates = (v) => (v?.states || []).filter((x) => (x.of || 1) < (v.version || 1));

// A state redrawn under its id gets the next version and keeps the one it replaces. `of` is
// the option's version it was drawn for: a new or redrawn state is of the option as it is now,
// an unchanged one keeps its own (one from before `of` was kept: the option's earlier version).
// The catalog shows the part alone: its picture (`shot`), or the part cut out of its page by
// `selector`. With neither it shows the whole page in a 160 px box — the item unreadably small
// in white (2026-11-04, C-34) — so a new or redrawn state that would be stored with neither is
// refused. An unchanged state keeps the shot and selector it has, and one stored before the
// rule with neither is kept as it is: a run sends it back as it read it.
function versionedStates(states, before, at, now, was, option) {
  return states.map((given) => {
    const old = before.find((x) => x.id === given.id);
    if (old && old.asset === given.asset) return { ...given, shot: given.shot ?? old.shot ?? null, selector: given.selector ?? old.selector ?? null, of: old.of || was, version: old.version || 1, history: old.history || [], drawn: old.drawn || at };
    // A redrawn state sent with its old picture of the part: that picture shows the state as it
    // was, so it is dropped — the catalog cuts the part from the new page by its selector, and
    // one with no selector is refused until the run sends a new picture.
    const stale = !!old && !!given.shot && given.shot === old.shot;
    const shot = stale ? null : given.shot ?? null;
    if (shot == null && !given.selector) throw bad(`${option}, state ${given.name || given.id}: the catalog needs a picture of the part — ${stale ? "the state is redrawn, so its old picture shows it as it was: " : ""}shoot it (design shot <state.html> <dir> --element <selector>) or send its selector`);
    if (!old) return { ...given, of: now, version: given.version || 1, history: given.history || [], drawn: given.drawn || at };
    return { ...given, shot, of: now, version: (old.version || 1) + 1, drawn: at,
      history: [{ asset: old.asset, version: old.version || 1, drawn: old.drawn || null }, ...(old.history || [])].slice(0, 10) };
  });
}

// The agent's form: a few questions, each with its options and the suggested one; a question
// left unanswered goes to Design Desk (docs/desk.md → The questions form).
function cleanQuestions(list) {
  if (!Array.isArray(list) || !list.length || list.length > 6) throw bad("questions is a list of 1 to 6");
  return list.map((q) => {
    const options = Array.isArray(q.options) ? q.options.map((o) => clean(String(o), 120, "option")) : [];
    if (options.length < 2 || options.length > 4) throw bad("each question has 2 to 4 options");
    const suggested = q.suggested == null || q.suggested === "" ? null : String(q.suggested);
    if (suggested !== null && !options.includes(suggested)) throw bad("suggested must be one of the question's options");
    return { text: clean(q.text, 300, "question"), why: optText(q.why, 300, "why"), options, suggested };
  });
}

// One issue or pull request whatever the link points into (a comment, a tab): "owner/name#12".
// The issues and pull requests a card points at, as owner/repo#number.
function refsOf(c) {
  const out = [issueKey(c.source?.url), issueKey(c.origin?.url), issueKey(c.spec?.issue_url), issueKey(c.spec?.pr_url)];
  if (c.source?.repo && (c.source.pr || c.source.issue)) out.push(`${String(c.source.repo).toLowerCase()}#${c.source.pr || c.source.issue}`);
  return [...new Set(out.filter(Boolean))];
}

// The issues and pull requests a card's research cites, read for their previews only: a comment
// on one never comes back to this card (cardsOf).
function researchRefs(c) {
  const r = c.research;
  if (!r) return [];
  const urls = [...(r.links || []).map((l) => l.url), ...[...String(r.summary || "").matchAll(/https?:\/\/[^\s)<>\]]+/g)].map((m) => m[0])];
  return [...new Set(urls.map(githubKey).filter(Boolean))];
}

function issueKey(url) {
  const m = /^https?:\/\/[^/]+\/([^/\s]+\/[^/\s]+)\/(?:issues|pull)\/(\d+)/i.exec(String(url || ""));
  return m ? `${m[1].toLowerCase()}#${m[2]}` : null;
}

// What else the step's last item named (the option and the part whose states are drawn),
// so an answer resumes the same work.
// A handoff straight to implementation stays so after its questions (docs/handoff.md, step 5).
function resumeOf(inbox, card, kind) {
  const xs = Object.values(inbox).filter((i) => i.card === card && i.kind === kind).sort((a, b) => a.created.localeCompare(b.created));
  const last = xs.filter((i) => i.variant).pop(), now = xs[xs.length - 1];
  const resume = { ...(last ? { variant: last.variant, ...(last.part ? { part: last.part } : {}) } : {}), ...(now?.implement ? { implement: true } : {}) };
  return Object.keys(resume).length ? { resume } : {};
}

function lastNote(inbox, card, kind) {
  const xs = Object.values(inbox).filter((i) => i.card === card && i.kind === kind).sort((a, b) => a.created.localeCompare(b.created));
  return xs.length ? xs[xs.length - 1].note || "" : "";
}

function cleanSource(o, cards) {
  if (typeof o !== "object" || !o) throw bad("source must be an object");
  return {
    label: optText(o.label, 200, "source label"),
    url: /^https?:\/\//.test(String(o.url || "")) ? String(o.url).slice(0, 500) : null,
    card: o.card && own(cards, String(o.card)) ? String(o.card) : null,
  };
}

// A decision recorded before it named its author and origin: in force, its source as its origin.
function upgradeDecision(d) {
  if (!d.status) d.status = "active";
  if (d.origin === undefined) { d.origin = d.source ? { kind: "other", ...d.source } : null; delete d.source; }
  if (d.author === undefined) d.author = null;
  // A decision written before concepts were a list, or by hand, still lists and opens.
  if (!Array.isArray(d.concepts)) d.concepts = d.concept ? [String(d.concept).toLowerCase()] : [];
  if (typeof d.text !== "string") d.text = String(d.text ?? "");
  if (typeof d.at !== "string") d.at = d.recorded || "";
}

// Who decided: a person's name, login or email; never Design Desk.
function cleanAuthor(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) throw bad("a decision names who decided it: author {name, login, email}");
  const x = { name: optText(a.name, 120, "author name") || null, login: optText(a.login, 80, "author login") || null, email: optText(a.email, 200, "author email") || null };
  if (!x.name && !x.login && !x.email) throw bad("author names the person: name, login or email");
  // Their role, where it is known (docs/desk.md → Decisions → Who decided).
  if (a.role != null && a.role !== "") {
    const role = readRole(a.role);
    if (!ADDABLE_ROLES.includes(role) && role !== "admin") throw bad(`author.role must be one of admin, ${ADDABLE_ROLES.join(", ")}`);
    x.role = role;
  }
  return x;
}

// Where it was decided, with a link: a web address, or the card (and comment) on the Desk.
function cleanDecisionOrigin(o, cards, threads, onDesk = false) {
  if (!o || typeof o !== "object" || Array.isArray(o)) throw bad(`a decision names its origin: {kind, label, url, card} (kind: ${DECISION_ORIGINS.join(", ")})`);
  if (!DECISION_ORIGINS.includes(o.kind)) throw bad(`origin.kind must be one of ${DECISION_ORIGINS.join(", ")}`);
  const url = o.url == null || o.url === "" ? null : String(o.url);
  if (url && !/^https?:\/\//i.test(url)) throw bad("origin.url must be http(s)");
  const card = o.card == null || o.card === "" ? null : String(o.card);
  if (card && !own(cards, card)) throw bad(`origin: no card ${card}`);
  const thread = o.thread == null || o.thread === "" ? null : String(o.thread);
  if (thread && own(threads, thread)?.card !== card) throw bad(`origin: ${thread} is not a conversation on ${card || "a card"}`);
  if (thread && own(threads, thread).kind === "private") throw bad("origin: a private ask is not a decision's source");
  const message = o.message == null ? null : Number(o.message);
  if (message !== null && (!thread || !Number.isInteger(message) || !own(threads, thread).messages[message])) throw bad("origin.message is a message of origin.thread");
  // Only a decision a person adds on the Desk itself comes with no link: the Desk is where it was decided.
  if (!url && !card && o.kind !== "chat" && !(onDesk && o.kind === "desk")) throw bad("origin needs a link: url, or the card it was decided on");
  return { kind: o.kind, label: optText(o.label, 200, "origin label"), url: url ? url.slice(0, 500) : null, card, thread, message };
}

// The check a write was made with: what it was read by and the decisions in force it read
// (docs/desk.md → Decisions → The check). The store stamps when, and the options it saw.
function cleanDecisionCheck(x, decisions) {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw bad("decision_check is {concepts, read}");
  if (!Array.isArray(x.concepts) || !x.concepts.length) throw bad("decision_check.concepts names what the design is about");
  if (!Array.isArray(x.read ?? [])) throw bad("decision_check.read is a list of D-n");
  const read = [...new Set((x.read || []).slice(0, 1000).map(String))];
  for (const id of read) if (!own(decisions, id)) throw bad(`decision_check: no decision ${id}`);
  return { concepts: [...new Set(x.concepts.slice(0, 10).map((c) => clean(String(c), 80, "concept").toLowerCase()))], read };
}

// The decisions a card or a decision goes against, each with why; only those in force.
function cleanConflicts(list, decisions, variants = null) {
  if (!Array.isArray(list)) throw bad("conflicts must be a list");
  if (list.length > 10) throw bad("conflicts: at most 10");
  return list.map((x) => {
    const d = own(decisions, String(x?.decision || ""));
    if (!d) throw bad(`conflicts: no decision ${x?.decision}`);
    if (d.status !== "active") throw bad(`conflicts: ${d.id} is no longer in force`);
    const variant = x.variant == null || x.variant === "" ? null : String(x.variant);
    if (variant && !(variants || []).some((v) => v.id === variant)) throw bad(`conflicts: no option ${variant}`);
    return { decision: d.id, why: clean(x.why, 400, "conflict why"), ...(variant ? { variant } : {}) };
  });
}

// What a note worked in goes against (docs/requests.md → Variants, revise): a decision in force,
// the issue's brief, or how a pull request made it work — each with its source, for a box under the answer.
function cleanWarns(list, decisions) {
  if (list == null) return [];
  if (!Array.isArray(list) || list.length > 5) throw bad("warns is a list of at most 5");
  return list.map((x, i) => {
    const kind = x?.source?.kind;
    if (!["decision", "issue", "pr"].includes(kind)) throw bad(`warns ${i + 1}: source.kind must be decision, issue or pr`);
    let source;
    if (kind === "decision") {
      const d = own(decisions, String(x.source.ref || ""));
      if (!d) throw bad(`warns ${i + 1}: no decision ${x.source.ref}`);
      source = { kind, ref: d.id };
    } else {
      if (!/^https?:\/\//i.test(String(x.source.url || ""))) throw bad(`warns ${i + 1}: source.url must be an http(s) link`);
      source = { kind, url: String(x.source.url).slice(0, 500), label: optText(x.source.label, 80, "source label") };
    }
    return { what: clean(x.what, 200, "what it goes against"), why: optText(x.why, 400, "why"), source };
  });
}

// What a shipped change does otherwise than the approved design it builds (docs/watch.md →
// Approved design): per element, what differs, with a picture of each side.
function cleanDesignCheck(o, cards, assets, at) {
  if (typeof o !== "object" || !o || Array.isArray(o)) throw bad("design_check must be an object");
  const r = own(cards, String(o.request || ""));
  if (r?.kind !== "request" || !r.approved) throw bad(`design_check: ${o.request} is not an approved request`);
  if (!["matches", "differs"].includes(o.verdict)) throw bad("design_check.verdict must be matches or differs");
  const list = o.differences === undefined ? [] : o.differences;
  if (!Array.isArray(list) || list.length > LIMITS.designDifferences) throw bad(`design_check.differences is a list of at most ${LIMITS.designDifferences}`);
  if (o.verdict === "differs" && !list.length) throw bad("design_check: say what differs");
  const pic = (id, name) => { if (id == null) return null; if (!own(assets, id)?.contentType?.startsWith("image/")) throw bad(`design_check: ${name} must be an uploaded picture`); return id; };
  return { request: r.id, variant: optText(o.variant, 20, "variant") || r.approved.variant || null, version: Number.isInteger(o.version) ? o.version : r.approved.version || null,
    verdict: o.verdict, summary: optText(o.summary, 400, "summary"), at,
    differences: list.map((x, i) => {
      const card = x.card == null || x.card === "" ? null : String(x.card);
      if (card && own(cards, card)?.kind !== "element") throw bad(`design_check difference ${i + 1}: ${card} is not an element`);
      return { element: clean(x.element, 80, "element"), what: clean(x.what, 400, "what differs"), card, design: pic(x.design, "design"), shipped: pic(x.shipped, "shipped") };
    }) };
}

// Where an item differs from its frame in Figma (the figma skill → Compare with the product):
// the frame, both sides' pictures, and per difference what, how much it matters, each side's
// value and picture. On a request it names the option it was made for.
const FIGMA_KINDS = ["change", "screen", "element", "request"];
export const FIGMA_SEVERITIES = ["major", "minor"];
function cleanFigmaCheck(o, assets, at, variants) {
  if (typeof o !== "object" || !o || Array.isArray(o)) throw bad("figma_check must be an object");
  if (!["matches", "differs"].includes(o.verdict)) throw bad("figma_check.verdict must be matches or differs");
  const f = o.frame;
  if (typeof f !== "object" || !f || !FIGMA_URL.test(String(f.url || ""))) throw bad("figma_check.frame.url must be a link to the frame in Figma");
  const pic = (id, name) => { if (id == null || id === "") return null; if (!own(assets, id)?.contentType?.startsWith("image/")) throw bad(`figma_check: ${name} must be an uploaded picture`); return id; };
  const when = (v, name) => { if (v == null || v === "") return null; if (Number.isNaN(Date.parse(v))) throw bad(`figma_check: ${name} must be a date`); return new Date(v).toISOString(); };
  let variant = null;
  if (variants) {
    variant = optText(o.variant, 20, "variant") || null;
    if (!variant || !variants.some((v) => v.id === variant)) throw bad("figma_check on a request names the option it compares (variant)");
  }
  const list = o.differences === undefined ? [] : o.differences;
  if (!Array.isArray(list) || list.length > LIMITS.designDifferences) throw bad(`figma_check.differences is a list of at most ${LIMITS.designDifferences}`);
  if (o.verdict === "differs" && !list.length) throw bad("figma_check: say what differs");
  // A difference is named by its part: the ×, Work into the design and a kept removal find it so.
  const parts = list.map((x) => String(x?.part ?? "").trim());
  const twice = parts.find((x, i) => parts.indexOf(x) !== i);
  if (twice !== undefined) throw bad(`figma_check: "${twice}" is named twice; give each difference its own part`);
  return {
    verdict: o.verdict, checked: at, ...(variant ? { variant } : {}),
    frame: { url: String(f.url), name: clean(f.name, 120, "frame name"), version: optText(f.version, 40, "frame version") || null, edited: when(f.edited, "frame.edited"), shot: pic(f.shot, "frame.shot") },
    product_shot: pic(o.product_shot, "product_shot"),
    differences: list.map((x, i) => {
      if (!FIGMA_SEVERITIES.includes(x?.severity)) throw bad(`figma_check difference ${i + 1}: severity must be major or minor`);
      return { part: clean(x.part, 80, "part"), what: clean(x.what, 300, "what differs"), severity: x.severity,
        figma: optText(x.figma, 120, "figma value"), product: optText(x.product, 120, "product value"),
        figma_shot: pic(x.figma_shot, "figma_shot"), product_shot: pic(x.product_shot, "product_shot") };
    }),
  };
}

// How the search for a frame ended: nothing fits, a question waits (its thread), or a person said no.
const FIGMA_SEARCH = ["none", "asked", "no"];
function cleanFigmaSearch(o, threads, at) {
  if (typeof o !== "object" || !o || !FIGMA_SEARCH.includes(o.state)) throw bad(`figma_search.state must be one of ${FIGMA_SEARCH.join(", ")}`);
  const thread = o.thread == null || o.thread === "" ? null : String(o.thread);
  if (o.state === "asked" && !own(threads, thread)) throw bad("figma_search: an open question names its thread");
  return { state: o.state, at, ...(thread ? { thread } : {}) };
}

// The list's summary of a comparison: the differences people did not take off the table.
function figmaRow(k) {
  const off = new Set((k.dismissed || []).map((d) => d.part));
  const count = (k.differences || []).filter((d) => !off.has(d.part)).length;
  return { verdict: count ? k.verdict : "matches", count, frame: k.frame?.name || "", checked: k.checked || null, closed: Boolean(k.closed) };
}

// A new comparison keeps the differences people took off the table while the frame is the
// same one, unedited: the same url and the same version, which must be known on both sides
// (a frame without one never keeps a removal). Only those still in it stay off. A closed
// comparison stays closed on the same terms.
function keepDismissed(prev, next) {
  const same = prev?.frame?.url === next.frame.url && Boolean(next.frame.version) && prev?.frame?.version === next.frame.version;
  const kept = same && prev.dismissed?.length ? prev.dismissed.filter((d) => next.differences.some((x) => x.part === d.part)) : [];
  return { ...next, ...(kept.length ? { dismissed: kept } : {}), ...(same && prev.closed ? { closed: prev.closed } : {}) };
}

// Where else the same thing shows up, what a change to it touches, and the earlier
// decisions that bound it — written by the agent, read by people.
function cleanImpact(o, cards, decisions = {}) {
  if (typeof o !== "object" || !o) throw bad("impact must be an object");
  const list = (xs, max, f) => (Array.isArray(xs) ? xs.slice(0, max).map(f) : []);
  return {
    concept: clean(o.concept, 120, "impact concept"),
    places: list(o.places, 30, (x) => ({ where: clean(x.where, 160, "place"), how: optText(x.how, 400, "how"), screen: optText(x.screen, 120, "screen"), card: ["screen", "element"].includes(own(cards, x.card)?.kind) ? x.card : null, kind: ["screen", "component", "message", "email", "document", "other"].includes(x.kind) ? x.kind : "screen" })),
    affects: list(o.affects, 20, (x) => ({ what: clean(x.what, 200, "affected"), why: optText(x.why, 600, "why"), source: x.source ? cleanSource(x.source, cards) : null })),
    // Under the hood: what has to happen behind the screens for the change to be possible, as a
    // short plain text for someone who does not know the code, with where it comes from.
    ...(o.behind ? (({ text, sources }) => ({ behind: { text: clean(text, 1500, "behind"), sources: list(sources, 5, (x) => cleanSource(x, cards)) } }))(typeof o.behind === "string" ? { text: o.behind } : o.behind) : {}),
    // A decision on the Desk is cited by its number; one found elsewhere, by its words and source.
    decisions: list(o.decisions, 20, (x) => {
      if (x.id != null && !own(decisions, String(x.id))) throw bad(`impact: no decision ${x.id}`);
      return { ...(x.id != null ? { id: String(x.id) } : {}), text: x.id != null ? optText(x.text, 600, "decision") : clean(x.text, 600, "decision"), when: optText(x.when, 40, "when"), source: x.source ? cleanSource(x.source, cards) : null };
    }),
  };
}

// The agent's own install of the product a card's screens came from, for people to open.
function cleanInstance(o) {
  if (typeof o !== "object" || !o) throw bad("instance must be an object");
  if (!/^https?:\/\//.test(String(o.url || ""))) throw bad("instance.url must be an http(s) address");
  const login = o.login && typeof o.login === "object" ? { user: optText(o.login.user, 120, "user"), password: optText(o.login.password, 200, "password"), hint: optText(o.login.hint, 300, "hint") } : null;
  return { url: String(o.url).slice(0, 500), login, name: optText(o.name, 40, "instance name"), ref: optText(o.ref, 120, "ref"), commit: optText(o.commit, 40, "commit"), updated: optText(o.updated, 40, "updated") };
}

// What to capture: the screens and states a person can take pictures of, in plain words.
function cleanShotlist(list) {
  if (!Array.isArray(list)) throw bad("shotlist must be a list");
  return list.slice(0, 12).map((x) => ({ name: clean(x.name, 120, "shot name"), how: optText(x.how, 600, "how"), path: optText(x.path, 300, "path") }));
}

function cleanVariants(list, assets, decisions = {}, before = [], cards = {}) {
  if (!Array.isArray(list)) throw bad("variants must be a list");
  return list.slice(0, 12).map((v, i) => {
    // An option the run takes off the card on purpose: `{id, drop: true}`.
    if (v?.drop === true) return { id: String(v.id || "").replace(/[^a-z0-9-]/gi, "").slice(0, 20), drop: true };
    if (!own(assets, v.asset)) throw bad(`variant ${i + 1}: no asset ${v.asset}`);
    const id = String(v.id || `v${i + 1}`).replace(/[^a-z0-9-]/gi, "").slice(0, 20);
    // A revise may keep a reason its option already had after the decision was revoked.
    const had = new Set((before.find((o) => o.id === id)?.reasons || []).map((r) => r.decision));
    return {
      id,
      name: clean(v.name, 80, "variant name"),
      rationale: optText(v.rationale, 1000, "rationale"),
      fidelity: ["wireframe", "mockup", "figma", "picture"].includes(v.fidelity) ? v.fidelity : "mockup",
      asset: v.asset,
      figma_url: FIGMA_URL.test(String(v.figma_url || "")) ? String(v.figma_url) : null,
      stories: v.stories == null ? null : cleanCoverage(v.stories, i + 1),
      reasons: v.reasons == null ? null : cleanReasons(v.reasons, decisions, i + 1, had),
      // The version the run read (`version` as the card gave it): an older one is refused.
      ...(Number.isInteger(v.version) ? { read: v.version } : {}),
      // Leaving `states` out keeps the option's states from before; [] removes them.
      ...(v.states === undefined ? {} : { states: cleanOptionStates(v.states, assets, i + 1) }),
      // Leaving `elements` out keeps the option's elements from before; [] removes them.
      ...(v.elements === undefined ? {} : { elements: cleanOptionElements(v.elements, assets, cards, i + 1) }),
      // Leaving `alternatives` out keeps the ones from before while the option is unchanged.
      ...(v.alternatives === undefined ? {} : { alternatives: cleanAlternatives(v.alternatives, assets, i + 1) }),
    };
  });
}

// Every state of a part of an option (docs/requests.md → Every state of a part): one
// self-contained page per state, each its own drawing with its own versions and notes.
const STATE_ID = /^[a-z0-9][a-z0-9-]{0,39}$/i;
function cleanOptionStates(list, assets, n) {
  if (list === null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.optionStates) throw bad(`variant ${n}: states is a list of at most ${LIMITS.optionStates}`);
  const ids = new Set();
  return list.map((x, i) => {
    const id = String(x?.id || `s${i + 1}`);
    if (!STATE_ID.test(id) || ids.has(id)) throw bad(`variant ${n}, state ${i + 1}: its id must be short and its own`);
    ids.add(id);
    if (!own(assets, x.asset)) throw bad(`variant ${n}, state ${i + 1}: no asset ${x.asset}`);
    // The design catalog on the request: a picture of the part alone in this state (`shot`), and
    // the use case of the brief it serves, as the issue's user stories (`stories`) or in words (`use`).
    if (x.shot != null && !own(assets, x.shot)?.contentType?.startsWith("image/")) throw bad(`variant ${n}, state ${i + 1}: shot must be an uploaded picture`);
    const stories = x.stories == null ? [] : x.stories;
    if (!Array.isArray(stories) || stories.length > LIMITS.stories || stories.some((s) => !STORY_ID.test(String(s)))) throw bad(`variant ${n}, state ${i + 1}: stories is a list of user story ids`);
    return { id, name: clean(x.name, 80, "state name"), how: optText(x.how, 300, "how"), part: clean(x.part || "The option", 120, "part"), asset: x.asset,
      shot: x.shot ?? null, selector: typeof x.selector === "string" && x.selector ? x.selector.slice(0, 500) : null, stories: [...new Set(stories.map(String))], use: optText(x.use, 300, "use"),
      ...(x.element != null && x.element !== "" ? { element: STATE_ID.test(String(x.element)) ? String(x.element) : (() => { throw bad(`variant ${n}, state ${i + 1}: element is the id of one of the option's elements`); })() } : {}),
      ...(Number.isInteger(x.version) ? { read: x.version } : {}) };
  });
}

// The parts an option changes or adds (docs/requests.md → The option's elements): each a tile
// under the option, its states grouped under it. `element` names the product's own element
// card it changes, when the catalog has one.
function cleanOptionElements(list, assets, cards, n) {
  if (list === null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.optionElements) throw bad(`variant ${n}: elements is a list of at most ${LIMITS.optionElements}`);
  const ids = new Set();
  return list.map((x, i) => {
    const id = String(x?.id || `e${i + 1}`);
    if (!STATE_ID.test(id) || ids.has(id)) throw bad(`variant ${n}, element ${i + 1}: its id must be short and its own`);
    ids.add(id);
    if (!["new", "changed"].includes(x.change)) throw bad(`variant ${n}, element ${i + 1}: change must be new or changed`);
    if (x.shot != null && !own(assets, x.shot)?.contentType?.startsWith("image/")) throw bad(`variant ${n}, element ${i + 1}: shot must be an uploaded picture`);
    const selector = typeof x.selector === "string" && x.selector ? x.selector.slice(0, 500) : null;
    if (!selector && x.shot == null) throw bad(`variant ${n}, element ${i + 1}: the tile needs a picture of it — its selector in the option's page, or a shot of it alone`);
    const of = x.element == null || x.element === "" ? null : String(x.element);
    if (of && (own(cards, of)?.kind !== "element" || own(cards, of).design)) throw bad(`variant ${n}, element ${i + 1}: ${of} is not an element of the product`);
    return { id, name: clean(x.name, 80, "element name"), change: x.change, how: optText(x.how, 300, "how"), selector, shot: x.shot ?? null,
      ...(x.view ? { view: String(x.view).slice(0, 40), view_name: optText(x.view_name, 120, "view name") } : {}), element: of };
  });
}

// An option's elements with their states: the ones it lists, each with the states drawn of it
// (`state.element`, else the state's part by name), then one per part its states draw that no
// listed element names — so an option drawn before it listed elements still shows its parts.
const partKey = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
export function elementsOf(v) {
  const out = (v?.elements || []).map((e) => ({ ...e, key: e.id, states: [] }));
  for (const x of v?.states || []) {
    let e = x.element ? out.find((y) => !y.derived && y.id === x.element) : null;
    e ||= out.find((y) => !y.derived && partKey(y.name) === partKey(x.part)) || out.find((y) => y.derived && y.name_key === partKey(x.part));
    if (!e) { e = { key: `part-${partKey(x.part).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "part"}`, name_key: partKey(x.part), name: x.part, change: null, how: "", derived: true, selector: x.selector || null, shot: x.shot || null, asset: x.asset, element: null, states: [] }; out.push(e); }
    e.states.push(x);
  }
  return out;
}

// What an issue says about the design, for a request that came from one: the part of its
// text that concerns what people see, and its user stories (docs/requests.md → Research).
// A story the issue did not write as one, the agent wrote from its text: `derived`.
const STORY_ID = /^[a-z0-9][a-z0-9-]{0,19}$/i;
function cleanIssueBrief(b) {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw bad("issue_brief must be {text, stories}");
  const stories = b.stories === undefined ? [] : b.stories;
  if (!Array.isArray(stories) || stories.length > LIMITS.stories) throw bad(`issue_brief.stories is a list of at most ${LIMITS.stories}`);
  const ids = new Set();
  return {
    text: optText(b.text, LIMITS.text, "issue_brief.text"),
    url: /^https?:\/\//i.test(String(b.url || "")) ? String(b.url).slice(0, 500) : null,
    stories: stories.map((x, i) => {
      const id = String(x?.id || `s${i + 1}`);
      if (!STORY_ID.test(id) || ids.has(id)) throw bad(`story ${i + 1}: its id must be short and its own`);
      ids.add(id);
      return { id, text: clean(x?.text, 400, "story"), derived: x?.derived === true };
    }),
  };
}

// How one option meets each user story: whether it does, in one or two plain sentences,
// and the parts of the design that do it (a CSS path in the option's file, a plain label
// and the view it is on), which the page outlines when a person picks the story.
function cleanCoverage(list, n) {
  if (!Array.isArray(list) || list.length > LIMITS.stories) throw bad(`variant ${n}: stories is a list of at most ${LIMITS.stories}`);
  return list.map((x) => {
    if (!STORY_ID.test(String(x?.story || ""))) throw bad(`variant ${n}: each story entry names its story`);
    if (!["yes", "partly", "no"].includes(x.met)) throw bad(`variant ${n}: met must be yes, partly or no`);
    const parts = x.parts === undefined ? [] : x.parts;
    if (!Array.isArray(parts) || parts.length > 6) throw bad(`variant ${n}: a story points at 6 parts at most`);
    return { story: String(x.story), met: x.met, how: clean(x.how, 600, "how"), parts: parts.map(cleanOptionPart) };
  });
}
// A part of an option a story or a reason points at: a CSS path, a plain label, the view it is on.
const cleanOptionPart = (p) => ({ selector: clean(String(p?.selector || ""), 500, "selector"), label: clean(String(p?.label || ""), 120, "label"),
  ...(p?.view ? { view: String(p.view).slice(0, 40) } : {}) });

// Why an option's parts are as they are: each decision on the Desk it follows, in one or two
// plain sentences on how, and the parts it shaped, which the page tags in the design.
function cleanReasons(list, decisions, n, had = new Set()) {
  if (!Array.isArray(list) || list.length > LIMITS.reasons) throw bad(`variant ${n}: reasons is a list of at most ${LIMITS.reasons}`);
  const seen = new Set();
  return list.map((x) => {
    const id = String(x?.decision || "");
    if (!own(decisions, id)) throw bad(`variant ${n}: no decision ${id || "named"} on the Desk`);
    if (decisions[id].status !== "active" && !had.has(id)) throw bad(`variant ${n}: ${id} is no longer in force; a new reason names a decision in force`);
    if (seen.has(id)) throw bad(`variant ${n}: ${id} is given twice; one reason names all the parts it shaped`);
    seen.add(id);
    const parts = x.parts === undefined ? [] : x.parts;
    if (!Array.isArray(parts) || parts.length > 6) throw bad(`variant ${n}: a reason points at 6 parts at most`);
    return { decision: id, how: clean(x.how, 600, "how"), parts: parts.map(cleanOptionPart) };
  });
}

// Questions before the design (the grill action): asking, then done with what was agreed.
function cleanGrill(g) {
  if (!g || !["asking", "done"].includes(g.state)) throw bad("grill state must be asking or done");
  const asked = g.asked === undefined ? 0 : Number(g.asked);
  if (!Number.isInteger(asked) || asked < 0 || asked > 50) throw bad("grill.asked must be a whole number from 0 to 50");
  return { state: g.state, asked, summary: optText(g.summary, 2000, "grill.summary") };
}

function cleanTriage(t) {
  if (!t || !["design", "needs-developer", "product"].includes(t.verdict)) throw bad("triage verdict must be design, needs-developer or product");
  const list = (x, n) => (Array.isArray(x) ? x.slice(0, 12).map((s) => clean(s, 600, n)) : []);
  // cannot: what changes how the product works; build: what a developer wires to build the design (it stops nothing).
  return { verdict: t.verdict, reasons: list(t.reasons, "reason"), can: list(t.can, "can"), cannot: list(t.cannot, "cannot"), build: list(t.build, "build") };
}

// The agent's judgement of a change: a designer should look at it, or it is for
// information only; either way with its reasons in plain words.
// Design Desk's check on a change's pull request: failing (held until a designer marks it
// handled), passing, skipped (judged and never held: it builds a Desk request, it is no longer
// open, or its status could not be set 3 times), or error (its last status write failed; `tries`
// counts the failures in a row, and the gate stops at 3), on the commit it was set on
// (docs/watch.md → CI gate).
function cleanCi(x) {
  if (!x || !["failing", "passing", "skipped", "error"].includes(x.state)) throw bad("ci state must be failing, passing, skipped or error");
  if (x.sha !== undefined && !/^[0-9a-f]{7,40}$/.test(String(x.sha))) throw bad("ci sha must be a commit id");
  if (x.tries !== undefined && !(Number.isInteger(x.tries) && x.tries >= 1 && x.tries <= 3)) throw bad("ci tries must be 1 to 3");
  if (x.state === "error" && x.tries === undefined) throw bad("a ci error counts its tries");
  return { state: x.state, ...(x.sha ? { sha: String(x.sha) } : {}), ...(x.tries ? { tries: x.tries } : {}) };
}

function cleanAttention(a) {
  if (!a || !["designer", "developer", "fyi"].includes(a.level)) throw bad("attention level must be designer, developer or fyi");
  if (!Array.isArray(a.reasons) || !a.reasons.length) throw bad("attention names at least one reason");
  return { level: a.level, reasons: a.reasons.slice(0, 5).map((s) => clean(s, 160, "attention reason")) };
}

// The agent's free-form fields are objects whose links the page renders: only http(s).
function cleanLinks(key, value) {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) && key !== "labels") throw bad(`${key} must be an object`);
  const copy = structuredClone(value);
  const walk = (o) => { for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === "object") walk(v);
    else if (/url$/i.test(k) && v != null && !/^https?:\/\//i.test(String(v))) throw bad(`${key}.${k} must be an http(s) address`);
  } };
  walk(copy);
  return copy;
}

// Where a request came from: the reporter's thread the agent answers in, the issue, and,
// when a scheduled run filed it, that run (`job`) and the event it acted on (`event`).
function cleanOrigin(o, cards) {
  if (typeof o !== "object") throw bad("origin must be an object");
  const str = (v, n) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, n));
  if (!ORIGIN_CHANNELS.includes(o.channel)) throw bad(`origin.channel must be one of ${ORIGIN_CHANNELS.join(", ")}`);
  const url = str(o.url, 500);
  if (url && !/^https?:\/\//i.test(url)) throw bad("origin.url must be http(s)");
  // A person's channel names the person: the Desk shows them as the author.
  if (o.channel !== "agent" && !str(o.reporter, 120)) throw bad(`origin.reporter is required for the ${o.channel} channel: the person's name or login`);
  if (o.job && !ORIGIN_JOBS.includes(o.job)) throw bad(`origin.job must be one of ${ORIGIN_JOBS.join(", ")}`);
  if (o.event != null && (typeof o.event !== "object" || Array.isArray(o.event))) throw bad("origin.event must be an object: {label, url, card}");
  return { channel: o.channel, chat: str(o.chat, 64), thread_ts: str(o.thread_ts, 32), message_ts: str(o.message_ts, 32),
    repo: str(o.repo, 200), number: o.number == null ? null : Number(o.number) || null, kind: str(o.kind, 20), url,
    reporter: str(o.reporter, 120), at: str(o.at, 40),
    // The reporter's email where the channel discloses it (Slack): who counts as a request's author.
    // An empty email is no email: the channel disclosed none.
    ...(o.email != null && String(o.email).trim() ? { email: cleanEmail(o.email) } : {}),
    ...(o.job ? { job: String(o.job) } : {}),
    ...(o.event ? { event: cleanSource(o.event, cards) } : {}),
    // A finding an automated test posted (Quality Inspector), not a person's report.
    ...(o.automated ? { automated: true, tool: str(o.tool, 80), check: str(o.check, 40), severity: ["high", "medium", "low"].includes(o.severity) ? o.severity : null, ref: str(o.ref, 80), build: str(o.build, 80) } : {}) };
}

// What the UI will need for an issue: a few short bullets in the product's words.
function cleanNeeds(list) {
  if (!Array.isArray(list) || !list.length) throw bad("needs is a list of 1 to 3 short bullets");
  if (list.length > LIMITS.issue.needs) throw bad(`an issue has at most ${LIMITS.issue.needs} needs`);
  return list.map((x) => clean(String(x), LIMITS.issue.need, "need"));
}

// How an issue's drawing went: the pre-flight stops offering it after two failures, so
// `failures` is a whole number, and `note` says in one sentence why it failed.
function cleanDraw(d) {
  if (d === null) return null;
  if (typeof d !== "object" || Array.isArray(d)) throw bad("draw must be an object: {failures, note}");
  const failures = d.failures ?? 0;
  if (!Number.isInteger(failures) || failures < 0 || failures > 100) throw bad("draw.failures must be a whole number from 0 to 100");
  return { failures, note: optText(d.note, 300, "draw note") };
}

// A catalog element's states: what each tile shows and what makes it happen.
// Ways one part of an option could look, each a copy of the whole option with only that
// part drawn differently (docs/requests.md → Alternatives of a part); a person picks one.
function cleanAlternatives(list, assets, n) {
  if (list === null) return [];
  if (!Array.isArray(list) || list.length > LIMITS.alternatives) throw bad(`variant ${n}: alternatives is a list of at most ${LIMITS.alternatives}`);
  const ids = new Set();
  return list.map((x, i) => {
    const id = String(x?.id || `a${i + 1}`);
    if (!STATE_ID.test(id) || ids.has(id)) throw bad(`variant ${n}, alternative ${i + 1}: its id must be short and its own`);
    ids.add(id);
    if (!own(assets, x.asset)) throw bad(`variant ${n}, alternative ${i + 1}: no asset ${x.asset}`);
    if (x.shot != null && !own(assets, x.shot)?.contentType?.startsWith("image/")) throw bad(`variant ${n}, alternative ${i + 1}: shot must be an uploaded picture`);
    return { id, name: clean(x.name, 80, "alternative name"), how: optText(x.how, 300, "how"), part: clean(x.part || "The option", 120, "part"), asset: x.asset,
      shot: x.shot ?? null, selector: typeof x.selector === "string" && x.selector ? x.selector.slice(0, 500) : null, ask: optText(x.ask, 1000, "ask") };
  });
}

function cleanStates(list) {
  if (!Array.isArray(list)) throw bad("states must be a list");
  return list.slice(0, 60).map((x, i) => ({ name: clean(x.name, 80, `state ${i + 1} name`), how: optText(x.how, 300, `state ${i + 1} how`) }));
}

// What the agent found before designing: the context, the history, the decisions.
// Its sources are what a designer can open and read (docs/requests.md → Research, step 6): an
// issue or a pull request, an item or a decision on the Desk by its number, or a Markdown page
// (a doc, an ADR) with the section that says it and a short quote of it. A code file is never one.
const CODE_FILE = /(?<![\w.-])(?:[\w.-]+\/)*[\w-][\w.-]*\.(?:tsx?|jsx?|mjs|cjs|css|scss|sass|less|html?|py|go|rb|java|kt|kts|scala|swift|rs|vue|svelte|php|c|cc|cpp|h|hpp|cs|dart|lua|sql|ya?ml|toml|json|sh)(?![\w-])/gi;
// A bare `<name>.js` with no folder is how a library is named (Node.js, Moment.js, highlight.js,
// storybook.js.org): words in a summary, never a code file. With a folder it is a file.
const LIBRARY_NAME = /^[^/]+\.js$/i;
// Only a GitHub issue or pull request is a source of that kind: the page previews no other host.
const githubKey = (url) => (/^https:\/\/(?:www\.)?github\.com\//i.test(String(url || "")) ? issueKey(url) : null);
function researchLink(l, i, db) {
  const at = `research link ${i + 1}`;
  if (l?.ref != null) {
    const ref = String(l.ref).trim().toUpperCase();
    if (!/^(?:C-\d+(?:\.\d+)?|D-\d+)$/.test(ref)) throw bad(`${at}: ref is an item's or a decision's number (C-12, C-12.3, D-4)`);
    // Its words, when none are given: the item's title or the decision's text.
    const it = db && (ref.startsWith("D-") ? own(db.decisions, ref) : own(db.cards, ref.replace(/\.\d+$/, "")));
    if (db && !it) throw bad(`${at}: no ${ref} on the Desk`);
    return { ref, label: optText(l.label, 120, "link label") || String(it?.title || it?.text || ref).replace(/\s+/g, " ").slice(0, 120) };
  }
  const url = String(l?.url || "").slice(0, 500);
  if (githubKey(url)) return { label: clean(l.label, 120, "link label"), url };
  // A Markdown page: a doc or an ADR, never a code file.
  if (/^https:\/\/[^/]+\/[^/]+\/[^/]+\/(?:blob|tree)\/[^?#]+\.(?:md|mdx|markdown)(?:[?#]|$)/i.test(url)) {
    return { label: clean(l.label, 120, "link label"), url, section: clean(l.section, 160, `${at} section`), excerpt: clean(l.excerpt, 600, `${at} excerpt`) };
  }
  throw bad(`${at}: only an issue, a pull request, a Desk item or decision ({ref}), or a Markdown page with its section and excerpt; never a code file (${url || "no url"})`);
}
function cleanResearch(r, assets, db = null) {
  if (r === null) return null;
  if (typeof r !== "object") throw bad("research must be an object");
  const verdicts = ["clear", "duplicate", "deliberate", "collision", "unclear"];
  if (!verdicts.includes(r.verdict)) throw bad(`research.verdict must be one of ${verdicts.join(", ")}`);
  if (r.asset != null && !own(assets, r.asset)) throw bad(`research: no asset ${r.asset}`);
  const summary = clean(r.summary, 2000, "research summary");
  // In the summary a link, written as a link or bare, is a GitHub issue or pull request; a page
  // goes in links, with its section; a commit or a code file is never one.
  for (const m of summary.matchAll(/https?:\/\/[^\s)<>\]]+/g)) if (!githubKey(m[0])) throw bad(`a link in the research summary is a GitHub issue or pull request; put a page in links with its section and excerpt (${m[0].slice(0, 200)})`);
  const file = [...summary.replace(/https?:\/\/[^\s)<>\]]+/g, "").matchAll(CODE_FILE)].map((m) => m[0]).find((f) => !LIBRARY_NAME.test(f));
  if (file) throw bad(`research summary names a code file (${file}): say where it is on the screen in words, and cite its pull request, issue or doc in links`);
  const links = Array.isArray(r.links) ? r.links.slice(0, 20).map((l, i) => researchLink(l, i, db)) : [];
  return { verdict: r.verdict, summary, asset: r.asset ?? null, links, at: optText(r.at, 40, "at") || null };
}
