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
  // The whole store is one file rewritten on every change; past this people's writes
  // are refused until the operator archives old cards.
  dbBytes: 50 * 1024 * 1024,
};

export const ROLES = ["lead", "designer", "pm", "developer", "guest"];

// Who may do what. The operator's roster assigns roles; the owner is always `lead`.
// `prototypeRoles` comes from config (`prototype_requesters`).
export function can(role, action, prototypeRoles = ["designer", "lead"]) {
  const member = role !== "guest";
  const shaper = role === "designer" || role === "lead";
  switch (action) {
    case "read": case "ack": case "ask": case "comment": return true;
    case "vote": case "request": case "follow-up": case "queue": return member;
    case "explore": case "revise": case "approve": case "close": case "reopen": case "refresh": return shaper;
    case "build": return prototypeRoles.includes(role);
    default: return false;
  }
}

export const REQUEST_TYPES = ["idea", "bug", "feature", "adjustment", "proposal"];
export const REQUEST_STATES = ["triage", "variants", "feedback", "prototype", "testing", "spec", "handed-off", "declined"];
export const CHANGE_STATES = ["new", "archived"];
// A catalog element: one real UI part drawn in every state it can be in.
export const ELEMENT_STATES = ["current", "stale", "building"];
const INBOX_KINDS = ["question", "request", "explore", "revise", "build", "handoff", "teardown", "follow-up", "catalog", "agenda"];

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

function clean(s, max, name) {
  if (typeof s !== "string") throw bad(`${name} must be text`);
  const t = s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!t) throw bad(`${name} is empty`);
  if (t.length > max) throw bad(`${name} is longer than ${max} characters`);
  return t;
}
const optText = (s, max, name) => (s === undefined || s === null || s === "" ? "" : clean(s, max, name));

export function emptyDb() {
  return { version: 1, seq: { card: 0, thread: 0, asset: 0, item: 0 }, cards: {}, threads: {}, assets: {}, inbox: {} };
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
    function pick(i) { return { id: i.id, kind: i.kind, card: i.card, thread: i.thread || null, created: i.created }; }
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
        acked: viewer ? Boolean(c.acks?.[viewer]) : false,
        triage: c.triage?.verdict || null, prototype: c.prototype?.state || null,
        type: c.request?.type || null, reporter: c.origin?.reporter || null,
        group: c.group || null, thumb: c.screens?.[0]?.asset || null, state_count: (c.states || []).length,
      }));
  }

  getCard(id) {
    const c = this.card(id);
    return { ...c, threads: (c.threads || []).map((t) => this.db.threads[t]).filter(Boolean) };
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

  openThread(cardId, who, { kind = "comment", text, anchor = null } = {}) {
    const c = this.card(cardId);
    if (!["question", "comment", "concern"].includes(kind)) throw bad("kind must be question, comment or concern");
    if ((c.threads || []).length >= LIMITS.threadsPerCard) throw bad("this card has too many threads; resolve some first");
    const body = clean(text, LIMITS.text, "text");
    const id = this.next("thread", "T");
    const t = {
      id, card: cardId, kind, state: "open", anchor: anchor ? cleanAnchor(anchor) : null,
      needs_agent: kind === "question", created: this.clock(),
      messages: [{ by: person(who), at: this.clock(), text: body }],
    };
    this.db.threads[id] = t;
    c.threads = [...(c.threads || []), id];
    c.updated = this.clock();
    const item = kind === "question" ? this.enqueue("question", cardId, id, who) : null;
    this.save();
    return { thread: t, inbox: item };
  }

  reply(threadId, who, text) {
    const t = this.thread(threadId);
    if (t.messages.length >= LIMITS.messagesPerThread) throw bad("this thread is full; open a new one");
    const body = clean(text, LIMITS.text, "text");
    t.messages.push({ by: person(who), at: this.clock(), text: body });
    let item = null;
    // A follow-up to a question goes back to the agent; a comment stays between people.
    // An item already claimed is being answered from what it saw, so a new message gets
    // an item of its own unless one is still open.
    if (t.kind === "question") {
      t.state = "open"; t.needs_agent = true;
      if (!this.openItemFor(threadId)) item = this.enqueue("question", t.card, threadId, who);
    }
    this.card(t.card).updated = this.clock();
    this.save();
    return { thread: t, inbox: item };
  }

  resolve(threadId, who) {
    const t = this.thread(threadId);
    t.state = "resolved"; t.needs_agent = false;
    t.resolved = { by: person(who), at: this.clock() };
    this.save();
    return { thread: t };
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
  createRequest(who, { title, problem, goal = "", screen = "", steps = "", type = "idea", from = null, screens = [], origin = null }) {
    if (!REQUEST_TYPES.includes(type)) throw bad(`type must be one of ${REQUEST_TYPES.join(", ")}`);
    const request = {
      type, problem: clean(problem, LIMITS.text, "problem"), goal: optText(goal, LIMITS.text, "goal"),
      screen: optText(screen, 500, "screen"), steps: optText(steps, LIMITS.text, "steps"),
      from: from ? this.card(String(from)).id : null,
    };
    const c = {
      kind: "request", status: "triage", created: this.clock(), updated: this.clock(), created_by: person(who),
      title: clean(title, LIMITS.title, "title"), request,
      summary: "", sections: [], screens: cleanRefs(screens, this.db.assets, "screens"), variants: [], votes: {}, threads: [], acks: {},
      triage: null, prototype: { state: "none" }, spec: null, origin: origin ? cleanOrigin(origin) : null,
    };
    const id = this.next("card", "C");
    c.id = id;
    this.db.cards[id] = c;
    const item = this.enqueue(from ? "follow-up" : "request", id, null, who);
    this.save();
    return { card: c, inbox: item };
  }

  // A state change a person asks for on a request card; the agent does the work.
  act(cardId, who, action, note = "") {
    const c = this.card(cardId);
    if (c.kind === "element") {
      if (action !== "refresh") throw bad("a catalog element can only be refreshed");
      if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === "catalog")) throw bad("that is already waiting for the agent");
      const item = this.enqueue("catalog", cardId, null, who, optText(note, 1000, "note"));
      this.save();
      return { card: c, inbox: item };
    }
    if (c.kind !== "request") throw bad("only a design request takes actions");
    const closed = c.status === "declined" || c.status === "handed-off";
    if (closed && action !== "reopen") throw bad("this request is closed; reopen it first");
    const kinds = { explore: "explore", revise: "revise", build: "build", approve: "handoff", close: "teardown" };
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
      throw forbidden(c.triage ? "this request needs a developer or a product decision, so it gets no live prototype; the spec explains why" : "the request is not triaged yet; a live prototype follows the verdict");
    if (action === "approve" && !["testing", "feedback", "prototype"].includes(c.status))
      throw bad("approve a request once it has variants or a prototype to approve");
    if (Object.values(this.db.inbox).some((i) => i.state !== "done" && i.card === cardId && i.kind === kinds[action])) throw bad("that is already waiting for the agent");
    if (action === "close") c.status = "declined";
    c.updated = this.clock();
    const item = this.enqueue(kinds[action], cardId, null, who, optText(note, 1000, "note"));
    this.save();
    return { card: c, inbox: item };
  }

  // ---------- the next call's agenda ----------

  // People put a card on the agenda of the team's next call; the agent writes a brief
  // for it (what to decide); after the call the lead closes the agenda.
  queueForCall(cardId, who, note = "") {
    const c = this.card(cardId);
    if (c.agenda?.status === "queued") throw bad("it is already on the next call");
    c.agenda = { status: "queued", by: person(who), at: this.clock(), note: optText(note, 500, "note"), brief: null };
    c.updated = this.clock();
    const item = who?.agent ? null : this.enqueue("agenda", cardId, null, who, c.agenda.note);
    this.save();
    return { card: c, inbox: item };
  }

  unqueue(cardId, who) {
    const c = this.card(cardId);
    if (c.agenda?.status !== "queued") throw bad("it is not on the next call");
    const mine = c.agenda.by?.email && c.agenda.by.email === who.email;
    if (!mine && !can(who.role, "close")) throw forbidden("only the person who added it, a designer or the lead can take it off");
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
      .map((c) => ({ id: c.id, kind: c.kind, title: c.title, status: c.status, type: c.request?.type || null, agenda: c.agenda, summary: c.summary || "", thumb: c.screens?.[0]?.asset || c.variants?.[0]?.asset || null }));
  }

  // ---------- agent actions ----------

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
    return { item: it, card: this.getCard(it.card) };
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
    const AGENT_FIELDS = ["title", "summary", "sections", "screens", "source", "status", "triage", "variants", "prototype", "spec", "labels", "sheet", "states", "group", "elements", "research", "brief", "origin"];
    let c = fields.id ? own(this.db.cards, fields.id) : null;
    if (fields.id && !c) throw missing(`no card ${fields.id}`);
    if (!c && !["change", "request", "element"].includes(fields.kind)) throw bad("a new card needs kind change, request or element");
    if (!c && fields.kind === "element" && fields.source?.file && fields.source?.export)
      c = Object.values(this.db.cards).find((x) => x.kind === "element" && x.source?.file === fields.source.file && x.source?.export === fields.source.export) || null;
    if (!c && fields.kind === "change" && fields.source?.repo && fields.source?.pr)
      c = Object.values(this.db.cards).find((x) => x.kind === "change" && x.source?.repo === fields.source.repo && x.source?.pr === fields.source.pr) || null;
    // Everything is checked on a copy; the store changes only when all of it holds.
    const next = c ? structuredClone(c) : { kind: fields.kind, status: { change: "new", request: "triage", element: "building" }[fields.kind], created: this.clock(), created_by: { agent: true },
      sections: [], screens: [], variants: [], votes: {}, threads: [], acks: {}, prototype: { state: "none" } };
    for (const k of AGENT_FIELDS) {
      if (fields[k] === undefined) continue;
      if (k === "title") next.title = clean(fields.title, LIMITS.title, "title");
      else if (k === "summary") next.summary = clean(fields.summary, 600, "summary");
      else if (k === "status") {
        const ok = { change: CHANGE_STATES, request: REQUEST_STATES, element: ELEMENT_STATES }[next.kind];
        if (!ok.includes(fields.status)) throw bad(`status must be one of ${ok.join(", ")}`);
        // A person closed it while a session worked: the session's late write must not reopen it.
        if (c && (c.status === "declined" || c.status === "handed-off") && fields.status !== c.status && !(c.status === "handed-off" && fields.status === "declined"))
          throw new DeskError(409, `${c.id} is ${c.status}; only a person reopens it`);
        next.status = fields.status;
      } else if (k === "sections") next.sections = cleanSections(fields.sections);
      else if (k === "screens") next.screens = cleanRefs(fields.screens, this.db.assets, "screens");
      else if (k === "variants") next.variants = cleanVariants(fields.variants, this.db.assets);
      else if (k === "triage") next.triage = cleanTriage(fields.triage);
      else if (k === "sheet") { if (fields.sheet !== null && !own(this.db.assets, fields.sheet)) throw bad(`sheet: no asset ${fields.sheet}`); next.sheet = fields.sheet; }
      else if (k === "states") next.states = cleanStates(fields.states);
      else if (k === "group") next.group = clean(fields.group, 60, "group");
      else if (k === "elements") { if (!Array.isArray(fields.elements)) throw bad("elements must be a list"); next.elements = fields.elements.slice(0, 30).map((id) => this.card(String(id)).id); }
      else if (k === "research") next.research = cleanResearch(fields.research, this.db.assets);
      else if (k === "origin") next.origin = cleanOrigin(fields.origin);
      else if (k === "brief") {
        // The agent's brief for the call: what is on the table and what to decide.
        if (!next.agenda) throw bad("a brief belongs to a card on the agenda");
        next.agenda = { ...next.agenda, brief: clean(fields.brief, 1500, "brief") };
      }
      else next[k] = cleanLinks(k, fields[k]);
    }
    if (!next.title) throw bad("a card needs a title");
    if (!c) { next.id = this.next("card", "C"); }
    next.updated = this.clock();
    this.db.cards[next.id] = next;
    this.save();
    return { card: next };
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

function person(who) {
  if (!who) return { agent: true };
  if (who.agent) return { agent: true };
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
  };
}

function cleanSections(list) {
  if (!Array.isArray(list)) throw bad("sections must be a list");
  return list.slice(0, 20).map((s) => ({
    key: String(s.key || "").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "note",
    title: clean(s.title, LIMITS.title, "section title"),
    body: clean(s.body, LIMITS.text * 2, "section body"),
  }));
}

function cleanRefs(list, assets, name) {
  if (!Array.isArray(list)) throw bad(`${name} must be a list`);
  return list.slice(0, 30).map((s) => {
    const asset = typeof s === "string" ? s : s.asset;
    if (!own(assets, asset)) throw bad(`${name}: no asset ${asset}`);
    return { asset, caption: typeof s === "object" ? optText(s.caption, 300, "caption") : "" };
  });
}

function cleanVariants(list, assets) {
  if (!Array.isArray(list)) throw bad("variants must be a list");
  return list.slice(0, 6).map((v, i) => {
    if (!own(assets, v.asset)) throw bad(`variant ${i + 1}: no asset ${v.asset}`);
    return {
      id: String(v.id || `v${i + 1}`).replace(/[^a-z0-9-]/gi, "").slice(0, 20),
      name: clean(v.name, 80, "variant name"),
      rationale: optText(v.rationale, 1000, "rationale"),
      fidelity: ["wireframe", "mockup"].includes(v.fidelity) ? v.fidelity : "mockup",
      asset: v.asset,
    };
  });
}

function cleanTriage(t) {
  if (!t || !["design", "needs-developer", "product"].includes(t.verdict)) throw bad("triage verdict must be design, needs-developer or product");
  const list = (x, n) => (Array.isArray(x) ? x.slice(0, 12).map((s) => clean(s, 600, n)) : []);
  return { verdict: t.verdict, reasons: list(t.reasons, "reason"), can: list(t.can, "can"), cannot: list(t.cannot, "cannot") };
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

// Where a reported bug came from, so the agent can answer the reporter in their thread.
function cleanOrigin(o) {
  if (typeof o !== "object") throw bad("origin must be an object");
  const str = (v, n) => (v === undefined || v === null || v === "" ? null : String(v).slice(0, n));
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(String(o.channel || ""))) throw bad("origin.channel is a short name: slack, telegram, github, desk…");
  const url = str(o.url, 500);
  if (url && !/^https?:\/\//i.test(url)) throw bad("origin.url must be http(s)");
  return { channel: o.channel, chat: str(o.chat, 64), thread_ts: str(o.thread_ts, 32), message_ts: str(o.message_ts, 32),
    repo: str(o.repo, 200), number: o.number == null ? null : Number(o.number) || null, kind: str(o.kind, 20), url,
    reporter: str(o.reporter, 120), at: str(o.at, 40) };
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
