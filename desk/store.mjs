// The Desk store: cards, threads, votes, assets and the inbox of work waiting for
// the agent. Pure logic over one JSON document; the server is its only writer and
// persists it after every change (tmp + rename), so a crash never leaves half a file.
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const LIMITS = {
  title: 200,
  text: 4000,
  threadsPerCard: 300,
  messagesPerThread: 200,
  // A relayed body is capped at 1 MiB both ways; base64 adds a third, the JSON a little.
  assetBytes: 720 * 1024,
  claimTtlMin: 120,
  // A change card is read in passing: a short title, a one-sentence summary, a few short sections.
  change: { title: 90, summary: 180, sections: 5, section: 400 },
  // An issue on the Issues page: what it brings, and in a few bullets what the UI will need.
  issue: { title: 90, summary: 180, needs: 3, need: 200, sketches: 2 },
  // Earlier looks of one element or screen kept on its card; the oldest go first.
  looks: 30,
  // The whole store is one file rewritten on every change; past this people's writes
  // are refused until the operator archives old cards.
  dbBytes: 50 * 1024 * 1024,
};

export const ROLES = ["lead", "designer", "pm", "developer", "guest"];
const BUSY = "Design Desk is already working on this. The result appears here.";

// Who may do what. The operator's roster assigns roles; the owner is always `lead`.
// `prototypeRoles` comes from config (`prototype_requesters`).
export function can(role, action, prototypeRoles = ["designer", "lead"]) {
  const member = role !== "guest";
  const shaper = role === "designer" || role === "lead";
  switch (action) {
    case "read": case "ack": case "ask": case "comment": return true;
    case "vote": case "request": case "follow-up": case "screens": return member;
    // Pictures of an issue: how it looks now and a sketch of how it could look (docs/issues.md).
    case "draw": return shaper || role === "pm";
    case "queue": case "explore": case "revise": case "approve": case "close": case "reopen": case "refresh": case "history": case "change": case "figma": case "share": case "add": case "handle": case "choose": return shaper;
    case "build": return prototypeRoles.includes(role);
    case "people": return role === "lead";
    default: return false;
  }
}

// Where a request the agent files came from (docs/desk.md → Where a card came from).
export const ORIGIN_CHANNELS = ["slack", "github", "chat", "agent"];
// The scheduled runs that file requests on their own (`origin.job`).
export const ORIGIN_JOBS = ["watch", "digest"];

// Every action the page asks about: /api/me for its caller, /api/people for each role.
export const ACTIONS = ["ack", "ask", "comment", "vote", "request", "follow-up", "explore", "revise", "build", "approve", "close", "reopen", "refresh", "history", "queue", "change", "figma", "screens", "share", "add", "handle", "choose", "draw", "people"];
export const abilities = (role, prototypeRoles) => Object.fromEntries(ACTIONS.map((a) => [a, can(role, a, prototypeRoles)]));

// The roster as the server reads a role (`## Desk people` rows): the first row of an email
// counts, and an unknown role is a guest's.
export function rosterOf(rows) {
  const seen = new Set();
  return rows.map((r) => ({ email: String(r.email || "").trim().toLowerCase(), role: String(r.role || "").trim().toLowerCase() }))
    .filter((r) => r.email && !seen.has(r.email) && seen.add(r.email))
    .map((r) => ({ email: r.email, role: ROLES.includes(r.role) ? r.role : "guest" }));
}

// The roles a lead may ask Design Desk to give a new person (docs/desk.md → People);
// making a lead stays the operator's.
export const ADDABLE_ROLES = ["designer", "pm", "developer"];
const EMAIL = /^[^\s@|`<>]+@[^\s@|`<>]+\.[^\s@|`<>]+$/;

export const REQUEST_TYPES = ["idea", "bug", "feature", "adjustment", "proposal"];
export const REQUEST_STATES = ["triage", "variants", "feedback", "prototype", "testing", "spec", "handed-off", "declined"];
export const CHANGE_STATES = ["new", "handled", "archived"];
// A catalog element: one real UI part drawn in every state it can be in. A screen card
// shares the states; `dropped` is one a person added that the agent could not make.
export const ELEMENT_STATES = ["current", "stale", "building", "dropped"];
// An issue on the Issues page: listed while it is open, archived once it is closed or no UI.
export const ISSUE_STATES = ["open", "archived"];
// Where an issue stands in the team's plan: the current sprint, someone's, or the backlog.
export const ISSUE_BUCKETS = ["sprint", "assigned", "backlog"];
const INBOX_KINDS = ["question", "request", "explore", "revise", "build", "handoff", "teardown", "follow-up", "catalog", "map", "agenda", "figma", "screens", "slack", "draw", "person"];
// Where a screen on a card came from: the pull request, the agent's screens instance, a
// person, a live prototype, or a rebuild drawn from the code.
const SCREEN_SOURCES = ["pr", "instance", "person", "prototype", "rebuild", "test"];
// Thread kinds: people ask, comment, raise a concern or note a change to one element;
// the agent asks (`asks`) when a step cannot go on without a person's answer.
const THREAD_KINDS = ["question", "comment", "concern", "change", "asks"];
// The step an agent's question blocks, which a person's answer resumes.
const ASK_STEPS = ["request", "explore", "revise", "build", "handoff", "figma", "catalog", "map"];
const FIGMA_URL = /^https:\/\/([\w-]+\.)?figma\.com\/[^\s]{1,500}$/;

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

export function emptyDb() {
  return { version: 1, seq: { card: 0, thread: 0, asset: 0, item: 0, decision: 0, poll: 0, council: 0 }, cards: {}, threads: {}, assets: {}, inbox: {}, decisions: {}, prefs: {} };
}

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
    this.db = existsSync(this.dbPath) ? JSON.parse(readFileSync(this.dbPath, "utf8")) : emptyDb();
    for (const k of Object.keys(emptyDb())) if (this.db[k] === undefined) this.db[k] = emptyDb()[k];
    this.db.seq = { ...emptyDb().seq, ...this.db.seq };
    this.mtime = existsSync(this.dbPath) ? statSync(this.dbPath).mtimeMs : 0;
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
  writeInbox() {
    const open = [], claimed = [];
    for (const it of Object.values(this.db.inbox)) {
      if (it.state === "open") open.push(pick(it));
      else if (it.state === "claimed") claimed.push({ ...pick(it), claimed_by: it.claimed_by, claimed_at: it.claimed_at });
    }
    const doc = { updated: this.clock(), claim_ttl_min: LIMITS.claimTtlMin, open, claimed };
    const p = join(this.dir, "inbox.json"), tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1));
    renameSync(tmp, p);
    function pick(i) { return { id: i.id, kind: i.kind, card: i.card, thread: i.thread || null, created: i.created, ...(i.person ? { person: i.person } : {}), ...(i.scope ? { scope: i.scope } : {}), ...(i.ask_first ? { ask_first: true } : {}) }; }
  }

  next(kind, prefix) { this.db.seq[kind] += 1; return `${prefix}-${this.db.seq[kind]}`; }

  card(id) { const c = own(this.db.cards, id); if (!c) throw missing(`no card ${id}`); return c; }
  thread(id) { const t = own(this.db.threads, id); if (!t) throw missing(`no thread ${id}`); return t; }
  item(id) { const i = own(this.db.inbox, id); if (!i) throw missing(`no inbox item ${id}`); return i; }

  // ---------- reads ----------

  listCards({ kind, status, viewer } = {}) {
    return Object.values(this.db.cards)
      .filter((c) => (!kind || c.kind === kind) && (!status || c.status === status))
      .sort((a, b) => b.updated.localeCompare(a.updated))
      .map((c) => ({
        id: c.id, kind: c.kind, title: c.title, status: c.status, summary: c.summary || "",
        created: c.created, updated: c.updated, source: c.source || null,
        screens: (c.screens || []).length, variants: (c.variants || []).length,
        open_threads: (c.threads || []).filter((t) => this.db.threads[t]?.state !== "resolved").length,
        acked: viewer ? Boolean(c.acks?.[viewer]) : false, handled: c.handled?.at || null,
        triage: c.triage?.verdict || null, prototype: c.prototype?.state || null,
        type: c.request?.type || null, reporter: c.origin?.reporter || null,
        group: c.group || null, thumb: c.screens?.[0]?.asset || null, state_count: (c.states || []).length, looks: (c.history || []).length,
        busy: Object.values(this.db.inbox).some((i) => i.card === c.id && i.state !== "done" && i.kind !== "question"),
        asks: (c.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open"),
        in_progress: c.kind === "change" && Boolean(c.source?.pr) && !c.source?.merged_at,
        automated: Boolean(c.origin?.automated),
        // Where it came from and who: the page's source label (docs/desk.md → Where a card came from).
        origin: c.origin || null, by: c.created_by || null, from: c.request?.from || null,
        path: c.path || null, period: c.period || null, suggested: c.call_suggestion || null,
        bucket: c.bucket || null, needs: c.needs || [], sketches: (c.sketches || []).length,
        attention: this.attentionOf(c),
      }));
  }

  // Whether a card waits for a designer, and why (docs/desk.md → Needs a designer). A
  // change card carries the agent's judgement; a request's comes from where it stands;
  // a suggestion for the next call waits for a designer on either, whatever its status.
  // Null: not judged.
  attentionOf(c) {
    if (c.kind !== "change" && c.kind !== "request") return null;
    const suggested = c.call_suggestion ? ["Suggested for the next call"] : [];
    if (c.kind === "request" && (c.status === "handed-off" || c.status === "declined"))
      return suggested.length ? { level: "designer", reasons: suggested } : null;
    const reasons = c.attention?.level === "designer" ? [...c.attention.reasons] : [];
    if (c.kind === "request") {
      const asks = (c.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open");
      const busy = Object.values(this.db.inbox).some((i) => i.card === c.id && i.state !== "done" && i.kind !== "question");
      if (asks) reasons.push("Design Desk is waiting for an answer");
      else if (!busy && c.status === "triage" && c.triage) reasons.push("Checked: draw options or close it");
      else if (!busy && c.status === "feedback") reasons.push(c.chosen ? "A designer picked an option: approve it or build it live" : "Options are ready: pick one or ask for changes");
      else if (!busy && c.status === "testing") reasons.push("The live prototype is ready to try and approve");
    }
    reasons.push(...suggested);
    if (reasons.length) return { level: "designer", reasons };
    return c.attention ? { level: c.attention.level, reasons: c.attention.reasons } : null;
  }

  getCard(id) {
    const c = this.card(id);
    return { ...c, attention: this.attentionOf(c), threads: (c.threads || []).map((t) => this.db.threads[t]).filter(Boolean), waiting: this.waitingFor(c.id) };
  }

  // Work the agent has been asked for on a card and not finished, oldest first.
  waitingFor(cardId) {
    return Object.values(this.db.inbox).filter((i) => i.card === cardId && i.state !== "done")
      .sort((a, b) => a.created.localeCompare(b.created))
      .map((i) => ({ kind: i.kind, state: i.state, created: i.created, ...(i.scope ? { scope: i.scope } : {}) }));
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

  // What a person chose on the page for themselves, kept for them in any browser: whether
  // the tab intros are folded (docs/desk.md → Tab intros).
  prefsOf(who) { return own(this.db.prefs, who.email || who.sub) || {}; }

  setPrefs(who, { intro } = {}) {
    if (!["shown", "hidden"].includes(intro)) throw bad("intro must be shown or hidden");
    const prefs = this.prefsOf(who);
    if (prefs.intro !== intro) { this.db.prefs[who.email || who.sub] = { ...prefs, intro }; this.save(); }
    return { prefs: this.prefsOf(who) };
  }

  // A designer marks a change handled: design has nothing more to do with it. Until then
  // the page counts the days it waits (config `change_due_days`).
  handle(cardId, who, on = true) {
    const c = this.card(cardId);
    if (c.kind !== "change") throw bad("only a change is marked handled");
    if (on) { c.status = "handled"; c.handled = { by: person(who), at: this.clock() }; }
    else { c.status = "new"; delete c.handled; }
    this.save();
    return { card: c };
  }

  openThread(cardId, who, { kind = "comment", text, anchor = null, step = null, questions = null } = {}) {
    const c = this.card(cardId);
    if (!THREAD_KINDS.includes(kind)) throw bad(`kind must be one of ${THREAD_KINDS.join(", ")}`);
    if (kind === "asks" && !who?.agent) throw forbidden("only Design Desk asks questions of this kind");
    if (kind === "asks" && !ASK_STEPS.includes(step)) throw bad(`an agent question names the step it blocks: ${ASK_STEPS.join(", ")}`);
    if (kind === "change" && !(c.variants || []).some((v) => v.id === anchor?.variant)) throw bad("a change note belongs to one of the design options");
    if ((c.threads || []).length >= LIMITS.threadsPerCard) throw bad("This page holds at most 300 conversations. Mark some as done first.");
    const body = clean(text, LIMITS.text, "text");
    const id = this.next("thread", "T");
    const t = {
      id, card: cardId, kind, state: "open", anchor: anchor ? cleanAnchor(anchor) : null,
      needs_agent: kind === "question" || kind === "change", created: this.clock(),
      messages: [{ by: person(who), at: this.clock(), text: body }],
      // The agent's questions can come as a form; the answer resumes the step with its note.
      ...(kind === "asks" ? { step, resume_note: lastNote(this.db.inbox, cardId, step), ...(questions ? { questions: cleanQuestions(questions) } : {}) } : {}),
    };
    this.db.threads[id] = t;
    c.threads = [...(c.threads || []), id];
    c.updated = this.clock();
    const item = kind === "question" ? this.enqueue("question", cardId, id, who)
      : kind === "change" ? this.pendingOrNew("revise", cardId, who)
      : null;
    this.save();
    return { thread: t, inbox: item };
  }

  reply(threadId, who, text, max = LIMITS.text) {
    const t = this.thread(threadId);
    if (t.messages.length >= LIMITS.messagesPerThread) throw bad("This conversation is full. Start a new one below.");
    const body = clean(text, max, "text");
    t.messages.push({ by: person(who), at: this.clock(), text: body });
    let item = null;
    // A follow-up to a question goes back to the agent; a comment stays between people.
    // An item already claimed is being answered from what it saw, so a new message gets
    // an item of its own unless one is still open.
    if (t.kind === "question") {
      t.state = "open"; t.needs_agent = true;
      if (!this.openItemFor(threadId)) item = this.enqueue("question", t.card, threadId, who);
    }
    // A person's answer to the agent's question resumes the step it blocked; a follow-up
    // on a change note goes back to the agent with the other notes.
    if (t.kind === "asks" && !who?.agent) { t.state = "answered"; item = this.pendingOrNew(t.step, t.card, who, t.resume_note || ""); }
    if (t.kind === "change" && !who?.agent) { t.state = "open"; t.needs_agent = true; item = this.pendingOrNew("revise", t.card, who); }
    this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t, inbox: item };
  }

  // A person answers the agent's form: per question one of its options, or null to leave
  // it to Design Desk, and an optional note. The answers become the reply's text too.
  answerForm(threadId, who, answers) {
    const t = this.thread(threadId);
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
    const t = this.thread(threadId);
    t.state = "resolved"; t.needs_agent = false;
    t.resolved = { by: person(who), at: this.clock() };
    this.save();
    return { thread: t };
  }

  // A conversation marked done opens again; a change note goes back to the agent.
  reopenThread(threadId, who) {
    const t = this.thread(threadId);
    if (t.state !== "resolved") throw bad("This conversation is still open.");
    delete t.resolved;
    t.state = "open";
    let item = null;
    if (t.kind === "change") { t.needs_agent = true; item = this.pendingOrNew("revise", t.card, who); }
    this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t, inbox: item };
  }

  // A designer has the agent work comments on the options into the design: each becomes a
  // change note (its first kind kept as `was`) and one revise does them together.
  workIn(cardId, who, threadIds) {
    const c = this.card(cardId);
    if (c.kind !== "request") throw bad("only a design request's options take changes");
    if ((c.status === "declined" || c.status === "handed-off")) throw bad("This request is closed. Press Reopen first.");
    if (!Array.isArray(threadIds) || !threadIds.length) throw bad("Pick the comments to work in.");
    const ts = [...new Set(threadIds.map(String))].slice(0, LIMITS.threadsPerCard).map((id) => {
      const t = own(this.db.threads, id);
      if (!t || t.card !== cardId) throw missing(`no conversation ${id} on this request`);
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

  // Only a designer or the lead picks the winning option; votes and the agent only advise.
  choose(cardId, who, variant) {
    const c = this.card(cardId);
    if (who?.agent) throw forbidden("only a designer picks the winning option");
    if (c.kind !== "request") throw bad("only a design request has options to pick from");
    if (variant === null) { delete c.chosen; }
    else {
      if (!(c.variants || []).some((v) => v.id === variant)) throw bad("Pick one of the design options.");
      c.chosen = { variant, by: person(who), at: this.clock() };
    }
    c.updated = this.clock();
    this.save();
    return { card: c };
  }

  vote(cardId, who, { variant, vote, note = "" }) {
    const c = this.card(cardId);
    if (!(c.variants || []).some((v) => v.id === variant)) throw bad(`no variant ${variant}`);
    if (!["prefer", "concern", "none"].includes(vote)) throw bad("vote must be prefer, concern or none");
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
  createRequest(who, { title, problem, goal = "", screen = "", steps = "", type = "idea", from = null, screens = [], origin = null, figma = "", vision = "", skills = null }) {
    if (figma && !FIGMA_URL.test(String(figma))) throw bad("The Figma link should start with https://www.figma.com/");
    if (!REQUEST_TYPES.includes(type)) throw bad(`type must be one of ${REQUEST_TYPES.join(", ")}`);
    const request = {
      type, problem: clean(problem, LIMITS.text, "problem"), goal: optText(goal, LIMITS.text, "goal"),
      screen: optText(screen, 500, "screen"), steps: optText(steps, LIMITS.text, "steps"),
      from: from ? this.card(String(from)).id : null,
      figma: figma ? String(figma) : null,
      // How the person pictures it, and the skills they switched for its options (docs/requests.md).
      vision: optText(vision, LIMITS.text, "vision"), skills: cleanSkills(skills),
    };
    const c = {
      kind: "request", status: "triage", created: this.clock(), updated: this.clock(), created_by: person(who),
      title: clean(titleOf(title, problem), LIMITS.title, "title"), request,
      summary: "", sections: [], screens: cleanRefs(screens, this.db.assets, "screens"), variants: [], votes: {}, threads: [], acks: {},
      triage: null, prototype: { state: "none" }, spec: null, origin: origin ? cleanOrigin(origin, this.db.cards) : null,
    };
    const id = this.next("card", "C");
    c.id = id;
    this.db.cards[id] = c;
    const item = this.enqueue(from ? "follow-up" : "request", id, null, who);
    this.save();
    return { card: c, inbox: item };
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

  // A lead asks Design Desk to put a person on the Desk's list with a role; the agent
  // writes the row (docs/desk.md → People). `roster` is the list the server reads now.
  askForPerson(who, { email, role }, roster = [], { owner = false } = {}) {
    const e = clean(String(email ?? ""), 254, "email").toLowerCase();
    if (!EMAIL.test(e)) throw bad("That is not an email address.");
    if (!ADDABLE_ROLES.includes(role)) throw bad(`role must be one of ${ADDABLE_ROLES.join(", ")}`);
    const on = roster.find((r) => r.email === e);
    if (on) throw bad(`${e} is already on the list.`);
    if (Object.values(this.db.inbox).some((i) => i.kind === "person" && i.state !== "done" && i.person?.email === e)) throw bad(BUSY);
    const it = this.enqueue("person", null, null, who);
    it.person = { email: e, role };
    // The owner is a lead whatever the roster says; the agent's re-check needs to know.
    if (owner) it.by.owner = true;
    this.save();
    return { inbox: it };
  }

  // The People tab's asks: every one still waiting, and the answered ones of the last two weeks.
  peopleAsks() {
    const since = Date.parse(this.clock()) - 14 * 86400 * 1000;
    return Object.values(this.db.inbox).filter((i) => i.kind === "person" && i.person && (i.state !== "done" || Date.parse(i.done_at) >= since))
      .sort((a, b) => b.created.localeCompare(a.created) || Number(b.id.slice(2)) - Number(a.id.slice(2))).slice(0, 20)
      .map((i) => ({ id: i.id, email: i.person.email, role: i.person.role, by: i.by?.email || null, created: i.created, state: i.state, outcome: i.outcome || null, done_at: i.done_at || null }));
  }

  // A state change a person asks for on a request card; the agent does the work.
  act(cardId, who, action, note = "", { askFirst = false } = {}) {
    const c = this.card(cardId);
    if (c.kind === "element") {
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
    if (closed && action !== "reopen") throw bad("This request is closed. Press Reopen first.");
    const kinds = { explore: "explore", revise: "revise", build: "build", approve: "handoff", close: "teardown", "figma-export": "figma", "figma-import": "figma", "slack-share": "slack", "slack-send": "slack" };
    if (action === "figma-export" && !(c.variants || []).some((v) => v.id === note)) throw bad("Pick the design option to send to Figma.");
    if (action.startsWith("slack-") && !(c.variants || []).length) throw bad("There are no design options to share yet.");
    if (action === "slack-share" && (c.polls || []).some((x) => x.state === "open")) throw bad("These options are already being voted on in Slack.");
    if (action === "figma-import" && !FIGMA_URL.test(String(note || ""))) throw bad("Paste a link to a Figma frame (https://www.figma.com/…).");
    if (action === "reopen") {
      if (c.status !== "declined" && c.status !== "handed-off") throw bad("only a closed request can be reopened");
      c.status = "triage";
      c.updated = this.clock();
      const item = this.enqueue("request", cardId, null, who, optText(note, 1000, "note"));
      this.save();
      return { card: c, inbox: item };
    }
    if (!kinds[action]) throw bad(`unknown action ${action}`);
    if (action === "build" && c.triage?.verdict !== "design")
      throw forbidden(c.triage ? "This request gets no live prototype because part of it needs a developer or a decision. The developer spec covers it." : "Design Desk is still checking this request. You can build a live prototype once it says what can be done.");
    if (action === "approve" && !["testing", "feedback", "prototype"].includes(c.status))
      throw bad("There's nothing to approve yet. Wait for the design options.");
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === kinds[action])) throw bad(BUSY);
    if (action === "close") { c.status = "declined"; delete c.call_suggestion; }
    c.updated = this.clock();
    const item = this.enqueue(kinds[action], cardId, null, who, optText(note, 1000, "note"));
    // The designer wants questions before the build when something is unclear.
    if (action === "build" && askFirst) item.ask_first = true;
    // Pictures of the options posted to Slack, not a vote (the slack-polls skill → Send).
    if (action === "slack-send") item.scope = "send";
    this.save();
    return { card: c, inbox: item };
  }

  // ---------- the next call's agenda ----------

  // A designer puts a card on the agenda of the team's next call, with the option to
  // present; the agent writes a brief for it (what to decide); after the call the lead
  // closes the agenda. The agent only suggests a card; a designer adds it or says Not now.
  queueForCall(cardId, who, note = "", variant = null) {
    const c = this.card(cardId);
    if (who?.agent) throw forbidden("only a designer puts a card on the next call; the agent suggests it");
    if (c.agenda?.status === "queued") throw bad("It is already on the next call.");
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
    const skip = c.agenda?.status === "queued" ? "it is already on the next call" : c.call_dismissed ? "a designer said Not now to it" : c.status === "declined" ? "the request is closed" : null;
    if (skip) return { card: c, suggested: false, reason: skip };
    c.call_suggestion = { note: optText(note, 500, "note"), at: this.clock() };
    c.updated = this.clock();
    this.save();
    return { card: c, suggested: true };
  }

  dismissSuggestion(cardId, who) {
    if (!can(who.role, "queue")) throw forbidden("Only a designer decides what goes on the next call.");
    const c = this.card(cardId);
    if (c.call_suggestion) c.call_dismissed = { by: person(who), at: this.clock(), note: c.call_suggestion.note };
    delete c.call_suggestion;
    this.save();
    return { card: c };
  }

  unqueue(cardId, who) {
    const c = this.card(cardId);
    if (c.agenda?.status !== "queued") throw bad("it is not on the next call");
    const mine = c.agenda.by?.email && c.agenda.by.email === who.email;
    if (!mine && !can(who.role, "close")) throw forbidden("Only the person who added it, or a designer, can take it off the call.");
    c.agenda = { ...c.agenda, status: "removed", removed_at: this.clock() };
    this.save();
    return { card: c };
  }

  // The lead marks the call held: what was queued becomes presented, with the date.
  closeCall(who, { date = null } = {}) {
    if (!can(who.role, "close")) throw forbidden("the lead or a designer closes the call");
    const when = optText(date, 40, "date") || this.clock();
    const done = [];
    for (const c of Object.values(this.db.cards)) if (c.agenda?.status === "queued") { c.agenda = { ...c.agenda, status: "presented", call: when }; done.push(c.id); }
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

  // ---------- agent actions ----------

  // The open (not yet claimed) item of this kind for the card, or a new one: notes written
  // in a row are one piece of work, and one written while a session works gets its own.
  pendingOrNew(kind, card, who, note = "") {
    const open = Object.values(this.db.inbox).find((i) => i.card === card && i.kind === kind && i.state === "open");
    return open || this.enqueue(kind, card, null, who, note);
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

  // A claim is the inbox lock: one session per item. A claim older than the TTL is
  // taken over only by an explicit `takeover`, which the pre-flight decides.
  claim(itemId, session, { takeover = false } = {}) {
    const it = this.item(itemId);
    if (it.state === "done") throw new DeskError(409, `${itemId} is done`);
    if (it.state === "claimed" && it.claimed_by !== session) {
      const age = (Date.parse(this.clock()) - Date.parse(it.claimed_at)) / 60000;
      if (!takeover || age < LIMITS.claimTtlMin) throw new DeskError(409, `${itemId} is claimed by ${it.claimed_by} since ${it.claimed_at}`);
    }
    const by = clean(String(session || ""), 200, "session");
    it.state = "claimed"; it.claimed_by = by; it.claimed_at = this.clock();
    if (it.thread) it.seen = this.thread(it.thread).messages.length;
    this.save();
    return { item: it, card: it.card ? this.getCard(it.card) : null };
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

  answer(threadId, text, { resolve = false } = {}) {
    const t = this.thread(threadId);
    const body = clean(text, LIMITS.text, "text");
    // The answer closes the items it could have read: the claimed ones, and open ones
    // whose message was already there when a claim read the thread. A message that came
    // later keeps its own item open, and the thread keeps waiting for the agent.
    const items = Object.values(this.db.inbox).filter((it) => it.thread === threadId && it.kind === "question" && it.state !== "done");
    const claimed = items.filter((it) => it.state === "claimed");
    const seen = claimed.length ? Math.max(...claimed.map((it) => it.seen ?? t.messages.length)) : t.messages.length;
    t.messages.push({ by: { agent: true }, at: this.clock(), text: body });
    let waiting = false;
    for (const it of items) {
      if (it.state === "claimed" || (it.msg_count ?? 0) <= seen) { it.state = "done"; it.done_at = this.clock(); it.outcome = "answered"; }
      else waiting = true;
    }
    t.state = waiting ? "open" : resolve ? "resolved" : "answered";
    t.needs_agent = waiting;
    this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t };
  }

  // Create or update a card the agent writes (a change card, or the agent's parts of a
  // request). Only the listed fields are the agent's; people's acks, votes and threads
  // are never overwritten.
  upsertCard(fields) {
    const AGENT_FIELDS = ["title", "summary", "sections", "screens", "source", "status", "triage", "variants", "prototype", "spec", "labels", "sheet", "states", "group", "elements", "research", "brief", "origin", "impact", "instance", "shotlist", "path", "how", "concepts", "changes", "period", "attention", "bucket", "needs", "sketches", "style", "draw"];
    let c = fields.id ? own(this.db.cards, fields.id) : null;
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
      if (k === "title") next.title = clean(fields.title, brief?.title ?? LIMITS.title, "title");
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
        next.variants = versioned(cleanVariants(fields.variants, this.db.assets), c?.variants || [], this.clock());
        // A designer's pick of an option the redraw no longer has is no pick.
        if (next.chosen && !next.variants.some((v) => v.id === next.chosen.variant)) delete next.chosen;
      }
      else if (k === "impact") next.impact = cleanImpact(fields.impact, this.db.cards);
      else if (k === "instance") next.instance = fields.instance === null ? null : cleanInstance(fields.instance);
      else if (k === "shotlist") next.shotlist = cleanShotlist(fields.shotlist);
      else if (k === "path") next.path = clean(String(fields.path), 300, "path");
      else if (k === "how") next.how = clean(fields.how, 600, "how");
      else if (k === "period") next.period = clean(String(fields.period), 40, "period");
      else if (k === "concepts") { if (!Array.isArray(fields.concepts)) throw bad("concepts must be a list"); next.concepts = fields.concepts.slice(0, 10).map((x) => clean(String(x), 80, "concept").toLowerCase()); }
      else if (k === "changes") { if (!Array.isArray(fields.changes)) throw bad("changes must be a list"); next.changes = fields.changes.slice(-40).map((id) => this.card(String(id)).id); }
      else if (k === "triage") next.triage = cleanTriage(fields.triage);
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
        if (next.kind !== "change") throw bad("attention is judged on change cards; a request's comes from where it stands");
        next.attention = fields.attention === null ? null : cleanAttention(fields.attention);
      }
      else if (k === "sheet") { if (fields.sheet !== null && !own(this.db.assets, fields.sheet)) throw bad(`sheet: no asset ${fields.sheet}`); next.sheet = fields.sheet; }
      else if (k === "states") next.states = cleanStates(fields.states);
      else if (k === "group") next.group = clean(fields.group, 60, "group");
      else if (k === "elements") { if (!Array.isArray(fields.elements)) throw bad("elements must be a list"); next.elements = fields.elements.slice(0, 30).map((id) => this.card(String(id)).id); }
      else if (k === "research") next.research = cleanResearch(fields.research, this.db.assets);
      else if (k === "origin") next.origin = cleanOrigin(fields.origin, this.db.cards);
      else if (k === "brief") {
        // The agent's brief for the call: what is on the table and what to decide.
        if (!next.agenda) throw bad("a brief belongs to a card on the agenda");
        next.agenda = { ...next.agenda, brief: clean(fields.brief, 1500, "brief") };
      }
      else next[k] = cleanLinks(k, fields[k]);
    }
    if (!next.title) throw bad("a card needs a title");
    // One card per screen and per element: a card a person added that turns out to be one
    // already on the Desk is dropped with a pointer to it, never filled in as a second copy.
    const twin = next.status !== "dropped" && Object.values(this.db.cards).find((x) => x.id !== next.id && x.kind === next.kind && x.status !== "dropped"
      && ((next.kind === "screen" && next.path && x.path === next.path)
        || (next.kind === "element" && next.source?.file && x.source?.file === next.source.file && x.source?.export === next.source.export)));
    if (twin) throw new DeskError(409, `${twin.id} is already this ${next.kind}`);
    if (!c) { next.id = this.next("card", "C"); }
    this.keepLook(c, next);
    next.updated = this.clock();
    this.db.cards[next.id] = next;
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
    for (const [k, x] of Object.entries(box)) if (x.via === "slack") delete box[k];
    for (const v of voters.slice(0, 500)) {
      if (!["prefer", "concern"].includes(v.vote)) continue;
      const key = clean(String(v.key || ""), 200, "voter key");
      if (box[key]) continue;
      box[key] = { vote: v.vote, role: optText(v.role, 20, "role") || "slack", name: optText(v.name, 120, "name") || null, via: "slack", at: this.clock(), note: "" };
    }
    c.updated = this.clock();
    this.save();
    return { votes: c.votes[variant] };
  }

  // A reply someone wrote in Slack becomes a comment once: on the option it was under, or
  // on the whole request when it came from a council thread.
  relayComment(cardId, { variant = null, name, email = null, role = null, text, slack_ts, url = null }) {
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

  // ---------- decisions ----------

  // What the team decided and why, kept so a later change can say what it touches. The
  // agent records them (an approved design, a call's outcome, a deliberate behaviour it
  // found) and reads them back by concept.
  addDecision({ concepts, text, why = "", source = null, at = null }) {
    if (!Array.isArray(concepts) || !concepts.length) throw bad("a decision names at least one concept");
    const d = {
      concepts: concepts.slice(0, 10).map((x) => clean(String(x), 80, "concept").toLowerCase()),
      text: clean(text, 600, "decision"), why: optText(why, 1500, "why"),
      source: source ? cleanSource(source, this.db.cards) : null,
      at: optText(at, 40, "at") || this.clock(), recorded: this.clock(),
    };
    d.id = this.next("decision", "D");
    this.db.decisions[d.id] = d;
    this.save();
    return { decision: d };
  }

  listDecisions({ concept = "", q = "" } = {}) {
    const c = String(concept || "").toLowerCase(), w = String(q || "").toLowerCase();
    return Object.values(this.db.decisions)
      .filter((d) => (!c || d.concepts.some((x) => x.includes(c) || c.includes(x))) && (!w || `${d.text} ${d.why}`.toLowerCase().includes(w)))
      .sort((a, b) => b.at.localeCompare(a.at));
  }

  addAsset({ card = null, kind, name, contentType, data, encoding = "base64" }) {
    if (!["screen", "variant", "spec", "patch", "image", "report"].includes(kind)) throw bad("unknown asset kind");
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType || "")) throw bad("contentType is not a media type");
    const buf = Buffer.from(String(data || ""), encoding === "utf8" ? "utf8" : "base64");
    if (!buf.length) throw bad("the asset is empty");
    if (buf.length > LIMITS.assetBytes) throw bad(`the asset is ${buf.length} bytes; the Desk serves at most ${LIMITS.assetBytes} (compress the image or split the page)`);
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
  const chosen = vs.find((v) => v.id === c.chosen?.variant);
  if (chosen) return chosen;
  const score = (v) => Object.values(c.votes?.[v.id] || {}).filter((x) => x.vote === "prefer" && ["designer", "lead"].includes(x.role)).length;
  const s = [...vs].sort((a, b) => score(b) - score(a));
  return s.length && score(s[0]) > 0 && score(s[0]) > (s[1] ? score(s[1]) : 0) ? s[0] : null;
}

function person(who) {
  if (!who) return { agent: true };
  if (who.agent) return { agent: true };
  if (who.via === "slack") return { email: who.email || null, role: who.role || "slack", name: who.name || null, via: "slack" };
  return { email: who.email || null, role: who.role || "guest" };
}

function cleanAnchor(a) {
  if (typeof a !== "object") throw bad("anchor must be an object");
  return {
    variant: typeof a.variant === "string" ? a.variant.slice(0, 40) : null,
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
// Earlier looks, newest first; past the limit the oldest go.
const byDate = (looks) => looks.sort((a, b) => instant(b.at) - instant(a.at)).slice(0, LIMITS.looks);

// A variant the agent redraws keeps its id; its earlier drawings stay as history, so the
// page can show what changed and people's pinned notes still find their option.
function versioned(variants, before, at) {
  return variants.map((v) => {
    const old = before.find((x) => x.id === v.id);
    if (!old) return { ...v, version: 1, history: [], drawn: at };
    const figma = v.figma_url || old.figma_url || null;
    if (old.asset === v.asset) return { ...v, version: old.version || 1, history: old.history || [], drawn: old.drawn || at, figma_url: figma };
    return { ...v, version: (old.version || 1) + 1, drawn: at, figma_url: v.figma_url || null,
      history: [{ asset: old.asset, version: old.version || 1, drawn: old.drawn || null }, ...(old.history || [])].slice(0, 10) };
  });
}

// The agent's form: a few questions, each with its options; the page adds "Leave it to Design Desk".
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

// Where else the same thing shows up, what a change to it touches, and the earlier
// decisions that bound it — written by the agent, read by people.
function cleanImpact(o, cards) {
  if (typeof o !== "object" || !o) throw bad("impact must be an object");
  const list = (xs, max, f) => (Array.isArray(xs) ? xs.slice(0, max).map(f) : []);
  return {
    concept: clean(o.concept, 120, "impact concept"),
    places: list(o.places, 30, (x) => ({ where: clean(x.where, 160, "place"), how: optText(x.how, 400, "how"), screen: optText(x.screen, 120, "screen"), card: ["screen", "element"].includes(own(cards, x.card)?.kind) ? x.card : null, kind: ["screen", "component", "message", "email", "document", "other"].includes(x.kind) ? x.kind : "screen" })),
    affects: list(o.affects, 20, (x) => ({ what: clean(x.what, 200, "affected"), why: optText(x.why, 600, "why"), source: x.source ? cleanSource(x.source, cards) : null })),
    decisions: list(o.decisions, 20, (x) => ({ text: clean(x.text, 600, "decision"), when: optText(x.when, 40, "when"), source: x.source ? cleanSource(x.source, cards) : null })),
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

function cleanVariants(list, assets) {
  if (!Array.isArray(list)) throw bad("variants must be a list");
  return list.slice(0, 6).map((v, i) => {
    if (!own(assets, v.asset)) throw bad(`variant ${i + 1}: no asset ${v.asset}`);
    return {
      id: String(v.id || `v${i + 1}`).replace(/[^a-z0-9-]/gi, "").slice(0, 20),
      name: clean(v.name, 80, "variant name"),
      rationale: optText(v.rationale, 1000, "rationale"),
      fidelity: ["wireframe", "mockup", "figma"].includes(v.fidelity) ? v.fidelity : "mockup",
      asset: v.asset,
      figma_url: FIGMA_URL.test(String(v.figma_url || "")) ? String(v.figma_url) : null,
    };
  });
}

function cleanTriage(t) {
  if (!t || !["design", "needs-developer", "product"].includes(t.verdict)) throw bad("triage verdict must be design, needs-developer or product");
  const list = (x, n) => (Array.isArray(x) ? x.slice(0, 12).map((s) => clean(s, 600, n)) : []);
  return { verdict: t.verdict, reasons: list(t.reasons, "reason"), can: list(t.can, "can"), cannot: list(t.cannot, "cannot") };
}

// The agent's judgement of a change: a designer should look at it, or it is for
// information only; either way with its reasons in plain words.
function cleanAttention(a) {
  if (!a || !["designer", "fyi"].includes(a.level)) throw bad("attention level must be designer or fyi");
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
function cleanStates(list) {
  if (!Array.isArray(list)) throw bad("states must be a list");
  return list.slice(0, 60).map((x, i) => ({ name: clean(x.name, 80, `state ${i + 1} name`), how: optText(x.how, 300, `state ${i + 1} how`) }));
}

// What the agent found before designing: the context, the history, the decisions.
function cleanResearch(r, assets) {
  if (r === null) return null;
  if (typeof r !== "object") throw bad("research must be an object");
  const verdicts = ["clear", "duplicate", "deliberate", "collision", "unclear"];
  if (!verdicts.includes(r.verdict)) throw bad(`research.verdict must be one of ${verdicts.join(", ")}`);
  if (r.asset != null && !own(assets, r.asset)) throw bad(`research: no asset ${r.asset}`);
  const links = Array.isArray(r.links) ? r.links.slice(0, 20).map((l) => {
    if (!/^https?:\/\//i.test(String(l.url || ""))) throw bad("research links must be http(s)");
    return { label: clean(l.label, 120, "link label"), url: String(l.url).slice(0, 500) };
  }) : [];
  return { verdict: r.verdict, summary: clean(r.summary, 2000, "research summary"), asset: r.asset ?? null, links, at: optText(r.at, 40, "at") || null };
}
