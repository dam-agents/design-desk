// node --test desk/tests/store.test.mjs — the Desk store: roles, the inbox, claims and answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, can, DeskError, ACTIONS, LIMITS, abilities, forgetIdle, rosterOf, readRole, personOf, namesOf, elementsOf } from "../store.mjs";

const fresh = () => new Store(mkdtempSync(join(tmpdir(), "desk-store-")));
const alice = { email: "alice@example.com", role: "designer" };
const bob = { email: "bob@example.com", role: "developer" };
const inbox = (s) => JSON.parse(readFileSync(join(s.dir, "inbox.json"), "utf8"));

test("roles: guests read and talk, designers shape, builds follow config", () => {
  assert.equal(can("guest", "ask"), true);
  assert.equal(can("guest", "request"), false);
  assert.equal(can("developer", "vote"), true);
  assert.equal(can("developer", "build"), false);
  assert.equal(can("developer", "build", ["developer"]), true);
  assert.equal(can("designer", "approve"), true);
  assert.equal(can("developer", "queue"), false);
  assert.equal(can("designer", "queue"), true);
  for (const a of ["explore", "revise", "refresh", "history", "change", "figma", "share", "add", "draw"]) assert.equal(can("developer", a), true, a);
  for (const a of ["approve", "close", "reopen", "queue", "handle", "choose", "decide"]) assert.equal(can("developer", a), false, a);
  assert.equal(can("guest", "explore"), false);
  // A PM moves a request along: everything a lead developer may but the tab, and closing, reopening and live prototypes.
  for (const a of ["explore", "revise", "skip", "close", "reopen", "build"]) assert.equal(can("pm", a), true, a);
  for (const a of ["approve", "queue", "handle", "choose", "decide", "people"]) assert.equal(can("pm", a), false, a);
  assert.equal(can("admin", "add"), true);
});

test("the roster: the first row of an email counts, an unknown role is a guest's", () => {
  assert.deepEqual(rosterOf([{ email: " Alice@Example.com ", role: "Designer" }, { email: "alice@example.com", role: "admin" }, { email: "dave@example.com", role: "ops" }, { email: "", role: "pm" }]),
    [{ email: "alice@example.com", also: [], role: "designer" }, { email: "dave@example.com", also: [], role: "guest" }]);
});

test("a roster role written as lead, the admin's name before 1.59.0, reads as admin", () => {
  assert.equal(readRole(" Lead "), "admin");
  assert.deepEqual(rosterOf([{ email: "lee@example.com", role: "lead" }]), [{ email: "lee@example.com", also: [], role: "admin" }]);
  const dir = mkdtempSync(join(tmpdir(), "desk-lead-"));
  writeFileSync(join(dir, "db.json"), JSON.stringify({ cards: { r1: { id: "r1", votes: { v1: { "lee@example.com": { vote: "prefer", role: "lead" } } } } }, decisions: { "D-1": { id: "D-1", text: "x", author: { email: "lee@example.com", role: "lead" } } } }));
  const s = new Store(dir);
  assert.equal(s.db.cards.r1.votes.v1["lee@example.com"].role, "admin");
  assert.equal(s.db.decisions["D-1"].author.role, "admin");
});

test("one person's row may list every address they go by, and each counts as them", () => {
  const roster = rosterOf([{ email: "lukas@example.com, Lukas.J@work.example.com", role: "admin" }, { email: "lukas.j@work.example.com", role: "pm" }]);
  assert.deepEqual(roster, [{ email: "lukas@example.com", also: ["lukas.j@work.example.com"], role: "admin" }], "an address already on a row counts once");
  assert.equal(personOf(roster, "LUKAS.J@work.example.com")?.role, "admin", "the Slack address finds the row");
  assert.equal(personOf(roster, "nobody@example.com"), null);
  const named = rosterOf([{ email: "lukas@example.com, lukas.j@work.example.com", role: "admin", name: " Lukas " }]);
  assert.deepEqual(namesOf(named), { "lukas@example.com": "Lukas", "lukas.j@work.example.com": "Lukas" }, "a name, by every address of the row");
  // The person who filed a request renames it by any of their addresses.
  const s = fresh();
  const { card } = s.createRequest({ agent: true }, { title: "Overflow", problem: "Runs over.", origin: { channel: "slack", reporter: "Lukas", email: "lukas.j@work.example.com" } });
  assert.throws(() => s.renameRequest(card.id, { email: "other@example.com" }, "New"), /Only the person who filed it/);
  assert.doesNotThrow(() => s.renameRequest(card.id, { email: "lukas@example.com", emails: ["lukas@example.com", "lukas.j@work.example.com"] }, "New"), "their Desk address renames the request they filed in Slack");
  // Who put an item on the presentation takes it off by any of their addresses.
  s.card(card.id).agenda = { status: "queued", by: { email: "lukas.j@work.example.com" } };
  assert.throws(() => s.unqueue(card.id, { email: "other@example.com", role: "pm" }), /Only the person who added it/);
  assert.equal(s.unqueue(card.id, { email: "lukas@example.com", emails: ["lukas@example.com", "lukas.j@work.example.com"], role: "pm" }).card.agenda.status, "removed");
});

test("an admin asks for a new person: one item with no card, the roster and open asks refuse twins", () => {
  assert.equal(can("admin", "people"), true);
  assert.equal(can("designer", "people"), false);
  const s = fresh();
  const admin = { email: "lee@example.com", role: "admin" };
  const roster = [{ email: "alice@example.com", role: "designer" }];
  const { inbox: item } = s.askForPerson(admin, { email: " Alex@Example.com ", role: "pm" }, roster);
  assert.equal(item.card, null);
  assert.deepEqual(inbox(s).open.map((i) => [i.kind, i.person]), [["person", { email: "alex@example.com", role: "pm" }]]);
  assert.throws(() => s.askForPerson(admin, { email: "alex@example.com", role: "designer" }, roster), /already working/);
  assert.throws(() => s.askForPerson(admin, { email: "alice@example.com", role: "pm" }, roster), /already on the list/);
  assert.throws(() => s.askForPerson(admin, { email: "carol@example.com", role: "admin" }, roster), /role must be one of/);
  assert.throws(() => s.askForPerson(admin, { email: "a|b@example.com", role: "pm" }, roster), /not an email/);
  // The agent claims it without a card and answers it with its outcome.
  assert.equal(item.by.owner, undefined, "a roster admin is not the owner");
  assert.equal(s.askForPerson({ email: "own@example.com", role: "admin" }, { email: "dee@example.com", role: "developer" }, roster, { owner: true }).inbox.by.owner, true);
  assert.equal(s.claim(item.id, "run-1").card, null);
  s.done(item.id, "run-1", "added");
  // An item without its payload (an older store, a hand-made one) never breaks the list.
  s.enqueue("person", null, null, admin);
  assert.deepEqual(s.peopleAsks().map((a) => [a.email, a.state, a.outcome, a.by]), [["dee@example.com", "open", null, "own@example.com"], ["alex@example.com", "done", "added", "lee@example.com"]]);
});

test("abilities: every action, as can() answers it", () => {
  assert.deepEqual(Object.keys(abilities("pm", ["designer"])), ACTIONS);
  assert.equal(abilities("pm", ["designer"]).build, false);
  assert.equal(abilities("pm", ["pm"]).build, true);
  assert.equal(abilities("guest").vote, false);
});

test("a question goes to the inbox and the answer takes it out", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "change", title: "Spend in the list", source: { repo: "acme/widgets", pr: 7 } });
  const { thread, inbox: item } = s.openThread(card.id, bob, { kind: "question", text: "Why weekly?" });
  assert.equal(item.kind, "question");
  assert.deepEqual(inbox(s).open.map((i) => i.id), [item.id]);
  s.answer(thread.id, "The limit resets weekly.");
  assert.equal(inbox(s).open.length, 0);
  assert.equal(s.getCard(card.id).threads[0].state, "answered");
  // A follow-up question returns it to the agent; a comment does not.
  s.reply(thread.id, bob, "And per person?");
  assert.equal(inbox(s).open.length, 1);
  s.openThread(card.id, alice, { kind: "comment", text: "Nice." });
  assert.equal(inbox(s).open.length, 1);
});

test("a change card is found again by its pull request, people's data survives", () => {
  const s = fresh();
  const a = s.upsertCard({ kind: "change", title: "One", source: { repo: "acme/widgets", pr: 9 } }).card;
  s.ack(a.id, alice);
  const b = s.upsertCard({ kind: "change", title: "One, rewritten", source: { repo: "acme/widgets", pr: 9 }, acks: {} }).card;
  assert.equal(a.id, b.id);
  assert.ok(b.acks[alice.email], "acks are not the agent's to overwrite");
});

test("a held check follows the handled mark: each mark queues one ci item, none without a check", () => {
  const s = fresh();
  const plain = s.upsertCard({ kind: "change", title: "Plain", source: { repo: "acme/widgets", pr: 7 } }).card;
  s.handle(plain.id, alice);
  assert.equal(Object.values(s.db.inbox).filter((i) => i.kind === "ci").length, 0, "no check held: nothing to set");
  const c = s.upsertCard({ kind: "change", title: "Held", source: { repo: "acme/widgets", pr: 8 } }).card;
  assert.throws(() => s.upsertCard({ id: c.id, ci: { state: "red" } }), /failing, passing, skipped or error/);
  assert.throws(() => s.upsertCard({ id: c.id, ci: { state: "error" } }), /counts its tries/);
  assert.throws(() => s.upsertCard({ id: c.id, ci: { state: "error", tries: 4 } }), /1 to 3/);
  assert.equal(s.upsertCard({ id: c.id, ci: { state: "error", tries: 2 } }).card.ci.tries, 2);
  assert.throws(() => s.upsertCard({ id: c.id, ci: { state: "failing", sha: "nope" } }), /commit id/);
  const r = s.createRequest(alice, { title: "A request", problem: "P." }).card;
  assert.throws(() => s.upsertCard({ id: r.id, ci: { state: "failing" } }), /change card/);
  s.upsertCard({ id: c.id, ci: { state: "failing", sha: "abc1234" } });
  assert.equal(s.getCard(c.id).ci.state, "failing");
  s.handle(c.id, alice);
  const items = Object.values(s.db.inbox).filter((i) => i.kind === "ci" && i.card === c.id);
  assert.deepEqual(items.map((i) => [i.state, i.by.email]), [["open", "alice@example.com"]]);
  s.handle(c.id, alice, false);
  assert.equal(Object.values(s.db.inbox).filter((i) => i.kind === "ci" && i.card === c.id).length, 1, "an open item is reused, not doubled");
  const skipped = s.upsertCard({ kind: "change", title: "Built from a request", source: { repo: "acme/widgets", pr: 10 } }).card;
  s.upsertCard({ id: skipped.id, ci: { state: "skipped" } });
  s.handle(skipped.id, alice);
  assert.equal(Object.values(s.db.inbox).filter((i) => i.kind === "ci" && i.card === skipped.id).length, 0, "a check never held needs no item");
});

test("Design Desk's message names the person whose claimed item it works on", () => {
  const s = fresh();
  const c = s.upsertCard({ kind: "change", title: "Held", source: { repo: "acme/widgets", pr: 8 } }).card;
  s.openThread(c.id, { agent: true }, { kind: "comment", text: "On its own." });
  s.upsertCard({ id: c.id, ci: { state: "failing", sha: "abc1234" } });
  s.handle(c.id, alice);
  const it = Object.values(s.db.inbox).find((i) => i.kind === "ci");
  s.claim(it.id, "run-1");
  s.openThread(c.id, { agent: true }, { kind: "comment", text: "Passed the check." });
  assert.deepEqual(Object.values(s.db.threads).map((t) => t.messages[0].by), [{ agent: true }, { agent: true, for: { email: "alice@example.com" } }]);
  // A claimed private ask on the same card is never the one named.
  s.done(it.id, "run-1", "passed");
  const priv = s.openPrivate({ email: "carol@example.com", role: "designer" }, { text: "Just between us?", context: { card: c.id } });
  s.claim(priv.inbox.id, "run-2");
  s.openThread(c.id, { agent: true }, { kind: "comment", text: "A public note." });
  assert.deepEqual(Object.values(s.db.threads).filter((t) => t.kind === "comment").at(-1).messages[0].by, { agent: true });
});

test("a change card stays short, and a designer marks it handled", () => {
  const s = fresh();
  assert.throws(() => s.upsertCard({ kind: "change", title: "x".repeat(91) }), /longer than 90/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", summary: "y".repeat(181) }), /longer than 180/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", sections: [{ key: "what", title: "What changed", body: "z".repeat(281), source: { label: "PR #9" } }] }), /longer than 280/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", sections: [{ key: "why", title: "Why", body: "Because." }] }), /needs source.label/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", sections: Array(6).fill({ title: "T", body: "b" }) }), /at most 5 sections/);
  const c = s.upsertCard({ kind: "change", title: "One", summary: "Short.", source: { repo: "acme/widgets", pr: 9 },
    sections: [{ key: "why", title: "Why it is like this", body: "- Owners missed stopped agents.", source: { label: "the issue #8", url: "https://github.com/acme/widgets/issues/8" } }] }).card;
  assert.equal(c.sections[0].source.label, "the issue #8");
  assert.equal(s.listCards({ kind: "change" })[0].handled, null);
  assert.equal(can("developer", "handle"), false);
  assert.equal(can("designer", "handle"), true);
  assert.throws(() => s.upsertCard({ id: c.id, status: "handled" }), /only a designer/);
  s.handle(c.id, alice);
  assert.equal(s.getCard(c.id).status, "handled");
  assert.throws(() => s.upsertCard({ id: c.id, status: "new" }), /only a designer/);
  assert.equal(s.upsertCard({ id: c.id, status: "archived" }).card.status, "archived", "a handled change can still be archived");
  assert.throws(() => s.upsertCard({ id: c.id, status: "new" }), /only a designer/, "an archived handled change does not go back to new");
  assert.equal(s.getCard(c.id).status, "archived");
  s.handle(c.id, alice);
  assert.equal(s.listCards({ kind: "change" })[0].handled, s.getCard(c.id).handled.at);
  s.handle(c.id, alice, false);
  assert.equal(s.getCard(c.id).status, "new");
  assert.equal(s.getCard(c.id).handled, undefined);
  const r = s.createRequest(alice, { title: "Bigger button", problem: "Hard to hit." }).card;
  assert.throws(() => s.handle(r.id, alice), /only a change or an issue/);
  // An issue marked handled keeps its status; a run's upsert leaves the mark (docs/issues.md → On the Desk).
  const is = s.upsertCard({ kind: "issue", title: "Export as CSV", status: "open", bucket: "sprint", source: { repo: "acme/widgets", issue: 77 } }).card;
  s.handle(is.id, alice);
  assert.deepEqual([s.getCard(is.id).status, Boolean(s.getCard(is.id).handled)], ["open", true]);
  s.upsertCard({ id: is.id, bucket: "next" });
  assert.ok(s.listCards({ kind: "issue" }).find((x) => x.id === is.id).handled, "the run's update keeps it handled");
  s.handle(is.id, alice, false);
  assert.equal(s.getCard(is.id).handled, undefined);
});

test("claims: one session per item, a heartbeat renews the lease, takeover only past it", () => {
  let now = "2026-10-30T10:00:00Z";
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => now });
  const { inbox: item } = s.createRequest(alice, { title: "Calmer empty state", problem: "It shouts." });
  s.claim(item.id, "s1");
  assert.throws(() => s.claim(item.id, "s2"), (e) => e instanceof DeskError && e.status === 409);
  now = "2026-10-30T10:10:00Z";
  assert.equal(s.claim(item.id, "s1", { heartbeat: true }).item.claimed_at, now, "the owner renews its lease");
  assert.throws(() => s.claim(item.id, "s2", { heartbeat: true }), /claimed by s1/);
  now = "2026-10-30T10:20:00Z";
  assert.throws(() => s.claim(item.id, "s2", { takeover: true }), /claimed by s1/);
  now = "2026-10-30T10:25:00Z";
  assert.equal(s.claim(item.id, "s2", { takeover: true }).item.claimed_by, "s2");
  assert.equal(s.item(item.id).claimed_started, "2026-10-30T10:25:00Z", "a takeover starts the new session's lease");
  assert.throws(() => s.done(item.id, "s1"), /claimed by s2/);
  assert.equal(s.done(item.id, "s2", "triaged").item.state, "done");
  assert.deepEqual(inbox(s).claimed, []);
});

test("the inbox file is refreshed when the store starts, so an upgrade writes the current lease", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-store-"));
  writeFileSync(join(dir, "inbox.json"), JSON.stringify({ claim_ttl_min: 120, open: [], claimed: [] }));
  const s = new Store(dir);
  assert.equal(inbox(s).claim_ttl_min, 15);
});

test("For Developers or For Designers: Slack starts with developers, the Desk and the agent with designers, unless asked", () => {
  const s = fresh();
  const slack = { channel: "slack", chat: "C0123", thread_ts: "1.0", reporter: "Dana" };
  const forOf = (who, body) => s.createRequest(who, { title: "x", problem: "y", ...body }).card.size.small;
  assert.equal(forOf({ agent: true }, { origin: slack }), true, "from Slack: the developers'");
  assert.equal(forOf({ agent: true }, { origin: slack, audience: "designers" }), false, "unless the message asks for a designer");
  assert.equal(forOf({ agent: true }, {}), false, "the agent's own: the designers'");
  assert.equal(forOf({ email: "bob@example.com", role: "developer" }, { audience: "developers" }), true, "the Desk's switch");
  assert.equal(forOf({ email: "bob@example.com", role: "developer" }, {}), false);
  assert.throws(() => forOf({ agent: true }, { audience: "pm" }), /audience must be one of/);
  const own = s.createRequest({ agent: true }, { title: "The agent's own", problem: "y" }).card;
  assert.equal(s.listCards().find((c) => c.id === own.id).for, "designers", "the list says whose tab it is on");
  assert.equal(s.createRequest({ agent: true }, { title: "y", problem: "z" }).card.size.filed, true, "chosen when filed: the page names no one");
});

test("For Developers: a lead developer moves it there, any developer but its author approves, the card says who", () => {
  const s = fresh();
  const lee = { email: "lee@example.com", role: "lead-developer" };
  const dana = { email: "dana@example.com", role: "developer" };
  assert.equal(can("lead-developer", "size"), true);
  assert.equal(can("admin", "size"), true);
  for (const r of ["designer", "pm", "developer", "guest"]) assert.equal(can(r, "size"), false, r);
  assert.equal(can("lead-developer", "approve"), false, "a developer approves only a request For Developers, per card");
  assert.deepEqual(rosterOf([{ email: "x@example.com", role: "Lead Developer" }]), [{ email: "x@example.com", also: [], role: "lead-developer" }]);

  const { card, inbox: item } = s.createRequest(bob, { title: "Tighter row spacing", problem: "Rows are too airy." });
  s.claim(item.id, "s1"); s.done(item.id, "s1", "triaged");
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Spacing only."] } });
  assert.equal(s.attentionOf(s.card(card.id)).level, "designer", "options ready: a designer's, until it is For Developers");
  assert.throws(() => s.act(card.id, dana, "approve"), (e) => e.status === 403 && /Only designers/.test(e.message), "not For Developers yet: a designer's");
  assert.throws(() => s.setSize(card.id, lee, "yes"), /true or false/);
  const marked = s.setSize(card.id, lee, true).card;
  assert.deepEqual(marked.size, { small: true, by: { email: "lee@example.com", role: "lead-developer" }, at: marked.size.at });
  assert.equal(s.attentionOf(marked), null, "a request For Developers waits for a developer, not a designer");
  assert.throws(() => s.act(card.id, bob, "approve"), (e) => e.status === 403 && /You filed this request/.test(e.message));
  assert.throws(() => s.act(card.id, { email: "gus@example.com", role: "guest" }, "approve"), (e) => e.status === 403);
  const ok = s.act(card.id, dana, "approve");
  assert.equal(ok.inbox.kind, "handoff");
  assert.deepEqual(ok.card.approved, { by: { email: "dana@example.com", role: "developer" }, at: ok.card.approved.at, small: true });

  s.act(card.id, alice, "close");
  assert.throws(() => s.setSize(card.id, lee, false), /closed/);
  s.act(card.id, alice, "reopen");
  assert.equal(s.card(card.id).approved, undefined, "a reopened request waits for a new approval");
  assert.equal(s.setSize(card.id, lee, false).card.size.small, false);
});

test("the developer spec waits for a person: edit keeps every version, changes go back to Design Desk, only a send lets it go", () => {
  const s = fresh();
  const shot = () => s.addAsset({ kind: "spec", name: "spec.md", contentType: "text/markdown", data: "# Spec v1", encoding: "utf8" }).asset.id;
  const { card, inbox: item } = s.createRequest(bob, { title: "Calmer header", problem: "Too loud." });
  s.claim(item.id, "s1"); s.done(item.id, "s1", "triaged");
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] } });
  const ok = s.act(card.id, alice, "approve");
  s.claim(ok.inbox.id, "s2");
  const first = shot();
  s.upsertCard({ id: card.id, status: "spec", spec: { asset: first, review: "draft", acceptance: [{ given: "the header", when: "the page opens", then: "it is grey" }] } });
  s.done(ok.inbox.id, "s2", "review");
  assert.throws(() => s.specAction(card.id, { agent: true }, { action: "send" }), (e) => e.status === 403, "Design Desk never sends it itself");
  assert.throws(() => s.specAction(card.id, { email: "gus@example.com", role: "guest" }, { action: "send" }), (e) => e.status === 403, "only who may approve");
  const edited = s.specAction(card.id, alice, { action: "edit", text: "# Spec v2, by Alice" }).card;
  assert.notEqual(edited.spec.asset, first);
  assert.deepEqual(edited.spec.history.map((x) => x.asset), [first], "the version it replaces stays");
  assert.equal(edited.spec.review, "draft");
  assert.equal(edited.spec.acceptance.length, 1, "an edit keeps the acceptance criteria");
  const asked = s.specAction(card.id, alice, { action: "changes", note: "The error state needs its own picture." });
  assert.equal(asked.inbox.scope, "spec-revise");
  assert.throws(() => s.specAction(card.id, alice, { action: "send" }), /not waiting|already|still/i, "not while Design Desk rewrites it");
  s.claim(asked.inbox.id, "s3");
  const third = shot();
  s.upsertCard({ id: card.id, spec: { ...s.card(card.id).spec, asset: third, review: "draft" } });
  s.done(asked.inbox.id, "s3", "review");
  assert.deepEqual(s.card(card.id).spec.history.map((x) => x.asset), [first, edited.spec.asset], "the rewrite keeps Alice's version too");
  const fourth = shot();
  s.upsertCard({ id: card.id, spec: { asset: fourth } });
  assert.equal(s.card(card.id).spec.review, "draft", "a new version Design Desk writes waits for a person, even when the write leaves review out");
  const sent = s.specAction(card.id, alice, { action: "send" });
  assert.deepEqual([sent.inbox.kind, sent.inbox.scope, sent.card.spec.review], ["handoff", "deliver", "sent"]);
  assert.throws(() => s.specAction(card.id, alice, { action: "edit", text: "late" }), /already on its way|in progress|still/i);
});

test("a spec for a request from Slack is sent only by a person, whatever spec_review says", () => {
  const s = fresh();
  const spec = () => s.addAsset({ kind: "spec", name: "spec.md", contentType: "text/markdown", data: "# Spec", encoding: "utf8" }).asset.id;
  const ready = (origin) => {
    const { card } = s.createRequest({ agent: true }, { title: "Calmer header", problem: "Too loud.", origin });
    s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] } });
    const { inbox: item } = s.act(card.id, alice, "approve");
    s.claim(item.id, `s-${card.id}`); s.done(item.id, `s-${card.id}`, "review");
    return card.id;
  };
  const slack = ready({ channel: "slack", chat: "C0123", thread_ts: "1.0", reporter: "Dana" });
  const approved = s.card(slack).status;
  assert.throws(() => s.upsertCard({ id: slack, status: "spec", spec: { asset: spec(), review: "sent" } }), /waits for a person's Send/, "spec_review disabled does not send it");
  assert.throws(() => s.upsertCard({ id: slack, status: "spec", spec: { asset: spec(), review: "draft", sent: { by: { email: "alice@example.com" } } } }), /waits for a person's Send/, "nor a send the agent writes itself");
  assert.throws(() => s.upsertCard({ id: slack, origin: { channel: "chat", reporter: "Dana" }, status: "spec", spec: { asset: spec(), review: "sent" } }), /waits for a person's Send/, "nor a write that renames its origin");
  assert.throws(() => s.upsertCard({ id: slack, status: "handed-off" }), /waits for a person's Send/, "nor a hand-off before the send");
  assert.deepEqual([s.card(slack).spec, s.card(slack).status, s.card(slack).origin.channel], [null, approved, "slack"], "a refused write leaves the card as it was");
  s.upsertCard({ id: slack, status: "spec", spec: { asset: spec(), review: "draft" } });
  assert.equal(s.specAction(slack, alice, { action: "send" }).card.spec.review, "sent");
  s.upsertCard({ id: slack, spec: { ...s.card(slack).spec, issue_url: "https://github.com/acme/widgets/issues/7" } });
  assert.equal(s.card(slack).spec.issue_url, "https://github.com/acme/widgets/issues/7", "after a person's send the agent records where it went");
  const chat = ready({ channel: "chat", reporter: "Lukas" });
  s.upsertCard({ id: chat, status: "spec", spec: { asset: spec(), review: "sent" } });
  assert.equal(s.card(chat).spec.review, "sent", "any other request goes straight on with spec_review disabled");
});

test("For Developers: the reporter of a request the agent filed is its author; a decision in force needs a designer", () => {
  const s = fresh();
  const lee = { email: "lee@example.com", role: "lead-developer" };
  const dana = { email: "dana@example.com", role: "developer" };
  const { card } = s.createRequest({ agent: true }, { title: "Tighter rows", problem: "Too airy.", origin: { channel: "slack", chat: "C0123", thread_ts: "1.0", reporter: "Dana", email: "Dana@Example.com" } });
  assert.equal(s.card(card.id).origin.email, "dana@example.com");
  assert.throws(() => s.createRequest({ agent: true }, { title: "x", problem: "y", origin: { channel: "slack", reporter: "Dana", email: "Dana" } }), /origin.email must be an email/);
  const none = s.createRequest({ agent: true }, { title: "x", problem: "y", origin: { channel: "slack", reporter: "Dana", email: " " } }).card;
  assert.equal("email" in s.card(none.id).origin, false, "an empty email is no email");
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Spacing only."] } });
  s.setSize(card.id, lee, true);
  assert.throws(() => s.act(card.id, dana, "approve"), /You filed this request/, "the reporter's email is the author");

  const d = s.addDecision({ concepts: ["rows"], text: "Rows stay roomy", author: { login: "alice" }, origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/4" } }).decision;
  s.upsertCard({ id: card.id, conflicts: [{ decision: d.id, why: "It tightens them." }] });
  assert.throws(() => s.act(card.id, lee, "approve", "", { overrule: true }), (e) => e.status === 403 && /a designer approves it/.test(e.message));
  assert.ok(s.act(card.id, alice, "approve", "", { overrule: true }).card.overruled, "a designer still overrules");
});

test("deciding straight away: a designer or lead developer approves without options or a vote, or decides and closes", () => {
  const s = fresh();
  const lee = { email: "lee@example.com", role: "lead-developer" };
  const dana = { email: "dana@example.com", role: "developer" };
  for (const r of ["admin", "designer", "pm", "lead-developer"]) assert.equal(can(r, "skip"), true, r);
  for (const r of ["developer", "guest"]) assert.equal(can(r, "skip"), false, r);

  const { card, inbox: item } = s.createRequest(bob, { title: "Calmer header", problem: "The header shouts." });
  assert.throws(() => s.act(card.id, lee, "approve"), /still checking/, "not before it is checked");
  assert.throws(() => s.act(card.id, lee, "approve"), /Approve it once/, "the refusal names the approval");
  assert.throws(() => s.decideAndClose(card.id, lee, { text: "No." }), /Decide it once/, "nor decided");
  assert.throws(() => s.decideAndClose(card.id, { agent: true }, { text: "No." }), (e) => e.status === 403 && e.message === "Design Desk does not decide: a person does");
  s.claim(item.id, "s1"); s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: ["Only the look."] } }); s.done(item.id, "s1", "triaged");
  assert.throws(() => s.act(card.id, dana, "approve"), /nothing to approve yet/, "a developer waits for options, For Developers or not");
  const drawing = s.act(card.id, alice, "explore").inbox;
  assert.throws(() => s.act(card.id, lee, "approve"), /still drawing the options/, "no approval while the options are drawn");
  s.claim(drawing.id, "s2"); s.done(drawing.id, "s2", "drawn");
  const ok = s.act(card.id, lee, "approve", "Use the grey header.");
  assert.equal(ok.inbox.kind, "handoff");
  assert.equal(ok.inbox.note, "Use the grey header.");
  assert.deepEqual(ok.card.approved, { by: { email: "lee@example.com", role: "lead-developer" }, at: ok.card.approved.at, small: false });

  const other = s.createRequest(bob, { title: "Louder badge", problem: "Hard to see." }).card;
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>x</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: other.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] }, variants: [{ id: "v1", name: "Red", asset }, { id: "v2", name: "Blue", asset }] });
  assert.throws(() => s.decideAndClose(other.id, lee, { text: " " }), /decision/);
  const decided = s.decideAndClose(other.id, lee, { text: "Badges stay as they are: colour is for errors only.", why: "Agreed at the meeting." });
  assert.equal(decided.card.status, "declined");
  assert.deepEqual([decided.inbox.kind, decided.inbox.thread, decided.inbox.note, decided.inbox.why], ["decision", null, "Badges stay as they are: colour is for errors only.", "Agreed at the meeting."]);
  assert.equal(decided.card.decided.by.email, "lee@example.com");
  assert.equal(s.listCards({ kind: "request" }).find((x) => x.id === other.id).decided, decided.card.decided.at, "the list knows it was decided");
  assert.throws(() => s.decideAndClose(other.id, lee, { text: "Again" }), /closed/);
  s.act(other.id, alice, "reopen");
  assert.equal(s.card(other.id).decided, undefined, "a reopened request waits for a new decision");
});

test("a live prototype's option is the one approved", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { title: "Calmer list", problem: "The list shouts." });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>x</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] }, variants: [{ id: "v1", name: "Quiet", asset }, { id: "v2", name: "Bold", asset }] });
  assert.deepEqual([s.act(card.id, alice, "build", "v2", { variant: "v2", version: 1 }).card.live_pick.variant, s.card(card.id).built], ["v2", undefined], "live_pick is the one record of what goes live");
  // A newer version drawn after the build is not what the prototype shows.
  const asset2 = s.addAsset({ kind: "variant", name: "v2b", contentType: "text/html", data: Buffer.from("<b>y</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, status: "testing", prototype: { state: "live", url: "https://example.com/p" }, variants: [{ id: "v1", version: 1, name: "Quiet", asset }, { id: "v2", version: 1, name: "Bold", asset: asset2 }] });
  const ok = s.act(card.id, alice, "approve", "v1");
  assert.equal(ok.inbox.note, "v2", "the prototype's option, whatever the pick");
  assert.deepEqual([ok.card.approved.variant, ok.card.approved.version], ["v2", 1], "at the version it was built from");
});

test("a person switches off a live prototype: a teardown, the request stays where it is; none twice, none without a prototype", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { title: "Calmer list", problem: "The list shouts." });
  assert.throws(() => s.act(card.id, alice, "switch-off"), /no live prototype/);
  s.upsertCard({ id: card.id, status: "testing", triage: { verdict: "design", reasons: ["Only the look."] }, prototype: { state: "live", url: "https://example.com/p" } });
  const r = s.act(card.id, alice, "switch-off");
  assert.deepEqual([r.inbox.kind, r.card.status], ["teardown", "testing"]);
  assert.throws(() => s.act(card.id, alice, "switch-off"), /already|working/i, "one teardown at a time");
  // Not once the design is approved: Build it again could not follow.
  const sent = s.createRequest(bob, { title: "Approved one", problem: "x" }).card;
  s.upsertCard({ id: sent.id, status: "spec", triage: { verdict: "design", reasons: ["Only the look."] }, prototype: { state: "live", url: "https://example.com/q" } });
  assert.throws(() => s.act(sent.id, alice, "switch-off"), /no live prototype on/);
  // Not while a build of it waits.
  const building = s.createRequest(bob, { title: "Rebuilding", problem: "x" }).card;
  s.upsertCard({ id: building.id, status: "testing", triage: { verdict: "design", reasons: ["Only the look."] }, prototype: { state: "live", url: "https://example.com/r" } });
  s.enqueue("build", building.id, null, alice);
  assert.throws(() => s.act(building.id, alice, "switch-off"), /building this prototype again/);
});

test("while its prototype is live, approve takes live_pick back at feedback; an option taken off leaves live_pick and its waiting build", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { title: "Calmer list", problem: "The list shouts." });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<b>x</b>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] }, variants: [{ id: "v1", name: "Quiet", asset }, { id: "v2", name: "Bold", asset }] });
  const { inbox: build } = s.act(card.id, alice, "build", "v2", { variant: "v2", version: 1 });
  s.claim(build.id, "run-1"); s.done(build.id, "run-1", "live");
  // A revise puts the request back at feedback; the prototype is still up.
  s.upsertCard({ id: card.id, status: "feedback", prototype: { state: "live", url: "https://example.com/p" } });
  const ok = s.act(card.id, alice, "approve", "v1");
  assert.deepEqual([ok.inbox.note, ok.card.approved.variant, ok.card.approved.version], ["v2", "v2", 1]);
  // Another request: a build waits, then its option is dropped.
  const { card: other } = s.createRequest(bob, { title: "Calmer rows", problem: "Rows shout." });
  s.upsertCard({ id: other.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] }, variants: [{ id: "v1", name: "Quiet", asset }, { id: "v2", name: "Bold", asset }] });
  const { inbox: waiting } = s.act(other.id, alice, "build", "v2", { variant: "v2", version: 1 });
  s.upsertCard({ id: other.id, variants: [{ id: "v1", version: 1, name: "Quiet", asset }, { id: "v2", drop: true }] });
  assert.equal(s.getCard(other.id).live_pick, undefined, "a dropped option does not go live");
  assert.deepEqual([s.item(waiting.id).state, s.item(waiting.id).outcome], ["done", "not built: its option was taken off the card"]);
});

test("a triage keeps what a developer wires to build the design (build)", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Provider name on the row", problem: "Show the provider." });
  s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: [], build: ["Send the provider's name with each chat."] } });
  assert.deepEqual(s.getCard(card.id).triage.build, ["Send the provider's name with each chat."]);
  s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: [] } });
  assert.deepEqual(s.getCard(card.id).triage.build, [], "a triage without it keeps none");
});

test("a request that needs a developer gets no live prototype", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Week starts per person", problem: "Use my own Monday." });
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "needs-developer", reasons: ["The week comes from the server."] } });
  assert.throws(() => s.act(card.id, alice, "build"), /needs a developer/);
  assert.equal(s.act(card.id, alice, "approve").inbox.kind, "handoff");
  assert.throws(() => s.act(card.id, alice, "approve"), /already working on this/);
});

test("a request keeps how the person pictures it and the skills they switched", () => {
  const s = fresh();
  const r = s.createRequest(alice, { problem: "The list is busy.", vision: "Calmer, like Settings.", skills: { copy: true, brand: false } }).card;
  assert.equal(r.request.vision, "Calmer, like Settings.");
  assert.deepEqual(r.request.skills, { copy: true, brand: false });
  assert.equal(s.createRequest(alice, { problem: "x" }).card.request.skills, null);
  assert.throws(() => s.createRequest(alice, { problem: "x", skills: { copy: "yes" } }), /skills must be/);
  assert.throws(() => s.createRequest(alice, { problem: "x", skills: { "../x": true } }), /skills must be/);
});

test("a request keeps how many options it asks for and questions first; Draw design options can change the count", () => {
  const s = fresh();
  const r = s.createRequest(alice, { problem: "The list is busy.", options: 5, grill: true, auto: true }).card;
  assert.deepEqual([r.request.options, r.request.grill, r.request.auto], [5, true, true]);
  const d = s.createRequest(alice, { problem: "x" }).card.request;
  assert.deepEqual([d.options, d.grill, d.auto], [3, false, false], "three options, no questions, a designer starts them");
  assert.equal(s.createRequest(alice, { problem: "x", options: 0, auto: true }).card.request.auto, false, "none asked for: nothing starts on its own");
  assert.throws(() => s.createRequest(alice, { problem: "x", options: 6 }), /options must be/);
  assert.throws(() => s.createRequest(alice, { problem: "x", options: 1.5 }), /options must be/);
  assert.throws(() => s.act(r.id, alice, "explore", "", { count: 0 }), /one to five/);
  s.act(r.id, alice, "explore", "", { count: 2 });
  assert.equal(s.card(r.id).request.options, 2);
});

test("a request from an issue keeps what the issue says about the design and how each option meets its stories", () => {
  const s = fresh();
  const issue = s.upsertCard({ kind: "issue", title: "See spend", status: "open", bucket: "sprint", needs: ["A spend column"], source: { repo: "acme/widgets", issue: 41 } }).card;
  const { card } = s.createRequest(alice, { problem: "A spend column", type: "feature", from: issue.id });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>x</b>").toString("base64") }).asset.id;
  const brief = { text: "People see each agent's weekly spend.", url: "https://github.com/acme/widgets/issues/41", stories: [{ id: "s1", text: "As an admin I see what each agent spends." }, { id: "s2", text: "I can sort by spend.", derived: true }] };
  s.upsertCard({ id: card.id, issue_brief: brief, grill: { state: "done", asked: 3, summary: "- Weekly, not monthly" },
    variants: [{ id: "v1", name: "Column", asset, stories: [{ story: "s1", met: "yes", how: "A spend column.", parts: [{ selector: "#spend", label: "Spend column", view: "1" }] }] }] });
  const c = s.card(card.id);
  assert.equal(c.request.from, issue.id);
  assert.deepEqual(c.issue_brief.stories.map((x) => [x.id, x.derived]), [["s1", false], ["s2", true]]);
  assert.deepEqual(c.variants[0].stories[0].parts, [{ selector: "#spend", label: "Spend column", view: "1" }]);
  assert.deepEqual([c.grill.state, c.grill.asked], ["done", 3]);
  const asset2 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>y</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Column", asset: asset2 }] });
  assert.equal(s.card(card.id).variants[0].version, 2);
  assert.equal(s.card(card.id).variants[0].stories[0].how, "A spend column.", "a revise that leaves stories out keeps the coverage");
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 2, name: "Column", asset: asset2, stories: [{ story: "s1", met: "partly", how: "Moved." }] }] });
  assert.equal(s.card(card.id).variants[0].stories[0].met, "partly", "new stories replace the old");
  assert.throws(() => s.upsertCard({ id: card.id, issue_brief: { stories: [{ id: "s1", text: "a" }, { id: "s1", text: "b" }] } }), /its own/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Column", asset, stories: [{ story: "s1", met: "maybe", how: "x" }] }] }), /met must be/);
  assert.throws(() => s.upsertCard({ id: issue.id, issue_brief: brief }), /belongs to a request/);
  assert.throws(() => s.upsertCard({ id: card.id, grill: { state: "later" } }), /grill state/);
});

test("an option names the decisions it rests on and the parts each shaped; the decision lists the option", () => {
  const s = fresh();
  const author = { name: "Alice", login: "alice" };
  const d1 = s.addDecision({ concepts: ["billing"], text: "Prices show per month", author, origin: { kind: "chat" } }).decision.id;
  const d2 = s.addDecision({ concepts: ["buttons"], text: "One primary button per screen", author, origin: { kind: "chat" } }).decision.id;
  const { card } = s.createRequest(alice, { problem: "Plans page", type: "feature" });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>x</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Cards", asset, reasons: [
    { decision: d1, how: "Every price reads per month.", parts: [{ selector: "#p1", label: "Starter price", view: "1" }] },
    { decision: d2, how: "Only Upgrade is primary." }] }] });
  assert.deepEqual(s.card(card.id).variants[0].reasons.map((r) => [r.decision, r.parts.length]), [[d1, 1], [d2, 0]]);
  assert.deepEqual(s.getCard(card.id).cited[d1], { text: "Prices show per month", status: "active" }, "the card carries the words of what its options rest on");
  assert.deepEqual(s.getDecision(d1).refs, [{ id: card.id, kind: "request", title: s.card(card.id).title, status: s.card(card.id).status, how: "shapes", options: ["Cards"] }]);
  const asset2 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>y</b>").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Cards", asset: asset2 }] });
  assert.equal(s.card(card.id).variants[0].reasons.length, 2, "a revise that leaves reasons out keeps them");
  s.revokeDecision(d1, alice, { reason: "Yearly is back." });
  assert.equal(s.getCard(card.id).cited[d1].status, "revoked", "a revoked one says so");
  const send = (reasons) => s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 2, name: "Cards", asset: asset2, reasons }] });
  assert.throws(() => send([{ decision: "D-99", how: "x" }]), /no decision D-99/);
  assert.throws(() => send([{ decision: d2, how: "x" }, { decision: d2, how: "y" }]), /given twice/);
  assert.throws(() => send([{ decision: d2, how: "x", parts: Array(7).fill({ selector: "#a", label: "a" }) }]), /6 parts/);
  send([{ decision: d1, how: "Still per month." }, { decision: d2, how: "Only Upgrade is primary." }]);
  assert.equal(s.card(card.id).variants[0].reasons[0].decision, d1, "a revise keeps a reason it had, revoked or not");
  const version = s.card(card.id).variants[0].version;
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ id: "v1", version, name: "Cards", asset: asset2 }, { id: "v2", name: "Rows", asset: asset2, reasons: [{ decision: d1, how: "x" }] }] }), /no longer in force/, "a new reason names a decision in force");
});

test("input limits and asset size are enforced", () => {
  const s = fresh();
  assert.throws(() => s.createRequest(alice, { title: "x".repeat(201), problem: "y" }), /longer than 200/);
  assert.throws(() => s.addAsset({ kind: "screen", contentType: "image/png", data: Buffer.alloc(800 * 1024).toString("base64") }), /at most/);
  const { asset } = s.addAsset({ kind: "variant", contentType: "text/html", encoding: "utf8", data: "<p>hi</p>" });
  assert.equal(s.getAsset(asset.id).data, "<p>hi</p>");
});

test("ids that name Object.prototype members are not entries", () => {
  const s = fresh();
  for (const id of ["__proto__", "constructor", "toString"]) {
    assert.throws(() => s.ack(id, alice), /no card/);
    assert.throws(() => s.openThread(id, alice, { kind: "comment", text: "x" }), /no card/);
    assert.throws(() => s.getAsset(id), /no asset/);
    assert.throws(() => s.claim(id, "s1"), /no inbox item/);
  }
  assert.equal(({}).acks, undefined);
  assert.equal(({}).threads, undefined);
});

test("a follow-up asked while the agent answers keeps its own item", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "change", title: "Spend", source: { repo: "acme/widgets", pr: 3 } });
  const { thread, inbox: first } = s.openThread(card.id, bob, { kind: "question", text: "Why weekly?" });
  s.claim(first.id, "s1");
  const { inbox: second } = s.reply(thread.id, bob, "And per person?");
  assert.ok(second, "the follow-up gets an item although the first is claimed");
  s.answer(thread.id, "Because the limit resets weekly.");
  assert.deepEqual(inbox(s).open.map((i) => i.id), [second.id]);
  assert.equal(s.getCard(card.id).threads[0].needs_agent, true);
});

test("a failed card write leaves nothing behind", () => {
  const s = fresh();
  assert.throws(() => s.upsertCard({ kind: "change", title: "Ghost", summary: "x".repeat(700) }), /longer than 180/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "Ghost", screens: ["A-99"] }), /no asset/);
  assert.equal(s.listCards().length, 0);
  assert.throws(() => s.upsertCard({ kind: "request", title: "Bad link", prototype: { state: "live", url: "javascript:alert(1)" } }), /http/);
});

test("an issue keeps its linked pull requests when a read could not get them", () => {
  const s = fresh();
  const rec = (extra) => ({ key: "acme/widgets#3", kind: "issue", title: "Red", state: "open", url: "https://github.com/acme/widgets/issues/3", ...extra });
  s.putGithub([rec({ linked: [{ title: "Build it", url: "https://github.com/acme/widgets/pull/8", state: "open", author: "bot" }], assignees: ["bot"] })]);
  s.putGithub([rec({})]);
  assert.deepEqual(s.db.github["acme/widgets#3"].linked.map((p) => p.url), ["https://github.com/acme/widgets/pull/8"], "left out: the list from before stays");
  s.putGithub([rec({ linked: [] })]);
  assert.deepEqual(s.db.github["acme/widgets#3"].linked, [], "read and empty: none");
});

test("only an admin reopens a request sent to developers: back before the vote with its options, its Designs record closed in sends", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Calmer header", problem: "Too loud." });
  const page = s.addAsset({ kind: "variant", name: "v.html", contentType: "text/html", data: "<p>v</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "handed-off", variants: [{ id: "v1", name: "Quiet", asset: page }], spec: { issue_url: "https://github.com/acme/widgets/issues/142" }, dev_summary: "x" });
  // Approved and marked done by people, not by an upsert.
  Object.assign(s.card(card.id), { approved: { by: alice, at: "2026-11-05T09:00:00Z", variant: "v1" } });
  s.markBuilt(card.id, bob);
  const ask = s.openThread(card.id, bob, { text: "Sticky?", dev: true }).thread;
  assert.throws(() => s.act(card.id, { email: "pat@example.com", role: "pm" }, "reopen"), /Only an admin reopens/);
  const r = s.act(card.id, { email: "ann@example.com", role: "admin" }, "reopen");
  assert.deepEqual([r.card.status, r.card.team_feedback.state, r.inbox, r.card.approved, r.card.spec, r.card.built, r.card.dev_summary], ["variants", "waiting", null, undefined, undefined, undefined, undefined], "before the vote, its options kept, nothing to check again");
  const [rec] = r.card.sends;
  assert.deepEqual([rec.approved.variant, rec.spec.issue_url, rec.built.by.email, rec.dev_summary.text, rec.threads, rec.closed.by.email], ["v1", "https://github.com/acme/widgets/issues/142", "bob@example.com", "x", [ask.id], "ann@example.com"]);
  assert.deepEqual(s.listCards().find((x) => x.id === card.id).sends.map((x) => x.built), [rec.built.at], "the list names the earlier record");
  // Approved again: the new send may close the earlier issue, when the person ticks it.
  s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: ["Look only."] } });
  const approved = s.act(card.id, alice, "approve", "v1", { closeEarlier: true }).inbox;
  assert.equal(inbox(s).open.find((i) => i.id === approved.id).close_earlier, "https://github.com/acme/widgets/issues/142", "the agent reads it in inbox.json");
  // Send to developers carries it too.
  s.claim(approved.id, "s1"); s.done(approved.id, "s1", "spec written");
  s.upsertCard({ id: card.id, status: "spec", spec: { asset: page } });
  const sentAgain = s.specAction(card.id, alice, { action: "send", closeEarlier: true }).inbox;
  assert.equal(inbox(s).open.find((i) => i.id === sentAgain.id).close_earlier, "https://github.com/acme/widgets/issues/142");
  assert.equal(inbox(s).open.find((i) => i.id === sentAgain.id).scope, "deliver");
  // Sent and reopened again: the second record holds only the questions asked since.
  s.claim(sentAgain.id, "s2"); s.done(sentAgain.id, "s2", "sent");
  s.upsertCard({ id: card.id, status: "handed-off", spec: { asset: page, issue_url: "https://github.com/acme/widgets/issues/150" } });
  const ask2 = s.openThread(card.id, bob, { text: "Mobile?", dev: true }).thread;
  const again = s.act(card.id, { email: "ann@example.com", role: "admin" }, "reopen");
  assert.deepEqual(again.card.sends.map((x) => x.threads), [[ask.id], [ask2.id]]);
});

test("a send after a reopen closes only an issue or pull request; a reopen with no options goes back to triage", () => {
  const s = fresh();
  const admin = { email: "ann@example.com", role: "admin" };
  const sentWith = (spec, variants = []) => {
    const { card } = s.createRequest(alice, { title: "Header", problem: "Too loud." });
    s.upsertCard({ id: card.id, status: "handed-off", triage: { verdict: "design", reasons: ["Look only."] }, variants, spec });
    Object.assign(s.card(card.id), { approved: { by: alice, at: "2026-11-05T09:00:00Z" } });
    return card.id;
  };
  // No options: back to triage, checked again.
  const bare = sentWith({ pr_url: "https://github.com/acme/widgets/pull/7" });
  const r = s.act(bare, admin, "reopen");
  assert.deepEqual([r.card.status, r.inbox.kind], ["triage", "request"]);
  // A pull request's URL when there is no issue.
  s.claim(r.inbox.id, "s1"); s.done(r.inbox.id, "s1", "triaged");
  assert.equal(s.act(bare, alice, "approve", "", { closeEarlier: true }).inbox.close_earlier, "https://github.com/acme/widgets/pull/7");
  // A comment on the origin issue is never closed: its issue is not the send's own.
  const feature = sentWith({ issue_url: "https://github.com/acme/widgets/issues/5#issuecomment-99" });
  s.act(feature, admin, "reopen");
  const item = s.act(feature, alice, "approve", "", { closeEarlier: true }).inbox;
  assert.equal(item.close_earlier, undefined);
});

test("an approved design is final: nothing changes it; a new request starts from it", () => {
  const s = fresh();
  const { card, inbox: item } = s.createRequest(alice, { title: "Calmer header", problem: "Too loud." });
  s.claim(item.id, "s1"); s.done(item.id, "s1", "triaged");
  const page = s.addAsset({ kind: "variant", name: "v.html", contentType: "text/html", data: "<p>v</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [{ id: "v1", name: "Quiet", asset: page }] });
  s.act(card.id, alice, "approve", "v1");
  s.upsertCard({ id: card.id, status: "spec" });
  for (const a of ["revise", "explore", "add-option", "build"]) assert.throws(() => s.act(card.id, alice, a, "more", { variant: "v1" }), /approved, so it no longer changes/, a);
  s.upsertCard({ id: card.id, status: "handed-off" });
  assert.throws(() => s.act(card.id, alice, "reopen"), /Only an admin reopens/, "a designer does not reopen a design sent to developers");
  const next = s.createRequest(alice, { title: "Calmer header, again", problem: "Smaller still.", from: card.id, carry: ["v1"], options: 0, auto: true }).card;
  assert.equal(next.request.from, card.id, "the new request names the approved one it starts from");
  assert.deepEqual(next.variants.map((v) => [v.id, v.name, v.asset, v.carried.card]), [["v1", "Quiet", page, card.id]], "the ticked option carries over as it was");
  assert.equal(next.request.auto, true, "carried options are changed right after triage");
  assert.throws(() => s.createRequest(alice, { title: "x", problem: "y", from: card.id, carry: ["v9"] }), /no option v9/);
  // A redraw of the carried option keeps saying where it came from.
  const page2 = s.addAsset({ kind: "variant", name: "v2.html", contentType: "text/html", data: "<p>v2</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: next.id, variants: [{ id: "v1", name: "Quiet", asset: page2, version: 1 }] });
  assert.equal(s.getCard(next.id).variants[0].carried?.card, card.id, "the revise keeps the carried marker");
});

test("a closed request takes no work and no late status from a session", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Calmer", problem: "It shouts." });
  s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: ["Copy only."] } });
  s.act(card.id, alice, "close");
  assert.throws(() => s.act(card.id, alice, "explore"), /closed/);
  assert.throws(() => s.upsertCard({ id: card.id, status: "feedback" }), /only a person reopens/);
  s.act(card.id, alice, "reopen");
  assert.equal(s.getCard(card.id).status, "triage");
  const fresh2 = s.createRequest(alice, { title: "Untriaged", problem: "x" }).card;
  assert.throws(() => s.act(fresh2.id, alice, "build"), /still checking/);
});

test("a bug from Slack lands on the queue with where to answer", () => {
  const s = fresh();
  const shot = s.addAsset({ kind: "screen", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset;
  const { card, inbox: item } = s.createRequest({ agent: true }, {
    type: "bug", title: "The spend amount overflows on narrow screens", problem: "On a phone the amount runs over the row's edge.",
    goal: "It wraps or shortens.", steps: "Open Agents on a phone", screens: [{ asset: shot.id, caption: "From Slack" }],
    origin: { channel: "slack", chat: "C0123ABCD", thread_ts: "1730000000.000100", reporter: "Alice" },
  });
  assert.equal(card.request.type, "bug");
  assert.equal(card.origin.thread_ts, "1730000000.000100");
  assert.equal(item.kind, "request");
  assert.deepEqual(s.listCards({ kind: "request" }).map((c) => [c.type, c.reporter, c.screens]), [["bug", "Alice", 1]]);
  assert.throws(() => s.createRequest(alice, { type: "rant", title: "x", problem: "y" }), /type must be one of/);
  // The request is the asker's words: an idea keeps no goal or steps anybody wrote for it.
  const idea = s.createRequest({ agent: true }, { type: "idea", title: "Calmer list", problem: "The list shouts at me.", goal: "A calmer list that…", steps: "1. Open it" }).card;
  assert.deepEqual([idea.request.problem, idea.request.goal, idea.request.steps], ["The list shouts at me.", "", ""]);
  assert.equal(card.request.goal, "It wraps or shortens.", "a bug keeps what its reporter said should happen");
});

test("the pictures a person gives with a request are marked theirs; the agent's own stay as it named them", () => {
  const s = fresh();
  const shot = () => s.addAsset({ kind: "screen", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const mine = s.createRequest(alice, { title: "Bigger button", problem: "Hard to hit.", screens: [shot()] }).card;
  assert.deepEqual(mine.screens.map((x) => [x.source, x.by?.email]), [["person", "alice@example.com"]]);
  const reported = s.createRequest({ agent: true }, { title: "Overflow", problem: "Runs over.", screens: [{ asset: shot() }], origin: { channel: "slack", reporter: "Dana" } }).card;
  assert.deepEqual(reported.screens.map((x) => [x.source, x.by]), [["person", undefined]], "a reporter's picture is theirs, with no Desk person behind it");
  const proposed = s.createRequest({ agent: true }, { title: "Spend column", problem: "Show it.", screens: [{ asset: shot(), source: "instance" }, { asset: shot() }] }).card;
  assert.deepEqual(proposed.screens.map((x) => x.source), ["instance", undefined]);
});

test("every request says where it came from, and what a run filed it on", () => {
  const s = fresh();
  const change = s.upsertCard({ kind: "change", title: "Pinned reports", source: { repo: "acme/widgets", pr: 12, url: "https://github.com/acme/widgets/pull/12", author: "dana", merged_at: "2026-11-01T10:00:00Z" } }).card;
  const idea = s.createRequest(alice, { problem: "The send button is small." }).card;
  const proposal = s.createRequest({ agent: true }, { type: "proposal", problem: "Group the pins.", from: change.id,
    origin: { channel: "agent", job: "watch", event: { label: "PR #12 shipped", url: "https://github.com/acme/widgets/pull/12", card: change.id } } }).card;
  const issue = s.createRequest({ agent: true }, { type: "feature", problem: "Export as PDF.",
    origin: { channel: "github", kind: "issue", number: 97, url: "https://github.com/acme/widgets/issues/97", reporter: "frank", job: "watch", event: { label: "labelled design", url: "javascript:alert(1)", card: "C-999" } } }).card;
  assert.deepEqual(proposal.origin.event, { label: "PR #12 shipped", url: "https://github.com/acme/widgets/pull/12", card: change.id });
  assert.deepEqual(issue.origin.event, { label: "labelled design", url: null, card: null }, "an event links only over http(s), to a card the Desk has");
  const rows = Object.fromEntries(s.listCards({ kind: "request" }).map((c) => [c.id, c]));
  assert.deepEqual([rows[idea.id].by, rows[idea.id].origin, rows[idea.id].from], [{ email: alice.email, role: "designer" }, null, null]);
  assert.deepEqual([rows[proposal.id].by, rows[proposal.id].from, rows[proposal.id].origin.job], [{ agent: true }, change.id, "watch"]);
  assert.equal(rows[issue.id].origin.reporter, "frank");
  assert.throws(() => s.createRequest({ agent: true }, { problem: "x", origin: { channel: "agent", job: "Watch run" } }), /origin.job/);
  assert.throws(() => s.createRequest({ agent: true }, { problem: "x", origin: { channel: "telegram", reporter: "Gita" } }), /origin.channel must be one of slack, github, chat, agent/);
  assert.throws(() => s.createRequest({ agent: true }, { problem: "x", origin: { channel: "agent", job: "audit" } }), /origin.job must be one of watch, digest/);
  assert.throws(() => s.createRequest({ agent: true }, { problem: "x", origin: { channel: "agent", event: "PR #12 shipped" } }), /origin.event must be an object/);
  // The operator asks in the direct session (docs/requests.md → Chat and Slack): a person's
  // channel names the person, so the row has its author.
  const chat = s.createRequest({ agent: true }, { problem: "Prototype the calmer header.", origin: { channel: "chat", reporter: "Gita" } }).card;
  assert.equal(s.listCards({ kind: "request" }).find((c) => c.id === chat.id).origin.reporter, "Gita");
  for (const channel of ["slack", "github", "chat"])
    assert.throws(() => s.createRequest({ agent: true }, { problem: "x", origin: { channel } }), new RegExp(`origin.reporter is required for the ${channel} channel`));
});

test("change notes on elements wake the agent once; its redraw keeps the earlier version", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts. It has three buttons." });
  assert.equal(card.title, "The empty list shouts.");
  const a1 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "One button", asset: a1 }] });
  const anchor = { variant: "v1", selector: "button", text: "Create agent" };
  const first = s.openThread(card.id, alice, { kind: "change", text: "Make it secondary", anchor }).inbox;
  const second = s.openThread(card.id, alice, { kind: "change", text: "Shorter title", anchor }).inbox;
  assert.equal(first.id, second.id);
  assert.deepEqual(s.getCard(card.id).waiting.map((w) => w.kind), ["request", "revise"]);
  const a2 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>2</p>", encoding: "utf8" }).asset.id;
  const v = s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "One button", asset: a2 }] }).card.variants[0];
  assert.equal(v.version, 2);
  assert.equal(v.history[0].asset, a1);
});

test("comments on options: replies, done and reopen, and a designer has them worked in together", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { problem: "The settings page is hard to scan." });
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Tabs", asset: a }, { id: "v2", name: "One page", asset: a }] });
  const anchor = { variant: "v1", selector: "button", text: "Save", view: "2", view_name: "Billing" };
  const one = s.openThread(card.id, bob, { kind: "comment", text: "Save is easy to miss", anchor });
  assert.equal(one.inbox, null);
  assert.deepEqual([one.thread.anchor.view, one.thread.anchor.view_name], ["2", "Billing"]);
  const two = s.openThread(card.id, bob, { kind: "concern", text: "Too many tabs", anchor: { variant: "v1", label: "the whole option" } }).thread;
  const loose = s.openThread(card.id, bob, { kind: "comment", text: "Nice work" }).thread;
  s.reply(one.thread.id, alice, "Agreed");
  s.resolve(one.thread.id, alice);
  assert.throws(() => s.reopenThread(two.id, alice), /still open/);
  assert.equal(s.reopenThread(one.thread.id, alice).thread.state, "open");
  assert.throws(() => s.workIn(card.id, alice, [loose.id]), /one of the design options/);
  assert.throws(() => s.workIn(card.id, alice, ["T-999"]), /no conversation/);
  const { threads, inbox: item } = s.workIn(card.id, alice, [one.thread.id, two.id]);
  assert.deepEqual(threads.map((t) => [t.kind, t.was, t.needs_agent]), [["change", "comment", true], ["change", "concern", true]]);
  assert.equal(item.kind, "revise");
  // Worked in again while the revise waits: the same item.
  assert.equal(s.workIn(card.id, alice, [two.id]).inbox.id, item.id);
  // A change note marked done and reopened goes back to the agent.
  s.resolve(two.id, alice);
  assert.equal(s.reopenThread(two.id, alice).inbox.id, item.id);
});

test("a worked-in change is answered with the place before and after", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { problem: "Save is easy to miss." });
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Tabs", asset: a }] });
  const { thread } = s.openThread(card.id, alice, { kind: "change", text: "Make Save primary", anchor: { variant: "v1", selector: "button", label: "Save" } });
  const pic = () => s.addAsset({ kind: "image", name: "p.jpg", contentType: "image/jpeg", data: Buffer.from("jpg").toString("base64") }).asset.id;
  const [before, after] = [pic(), pic()];
  const marks = [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }];
  assert.throws(() => s.answer(thread.id, "Done.", { shots: [{ asset: after, stage: "after", pair: "Save" }] }), /needs a before and an after/);
  assert.throws(() => s.answer(thread.id, "Done.", { shots: [{ asset: before }, { asset: after, stage: "after" }] }), /needs a before and an after/);
  assert.throws(() => s.answer(thread.id, "Done.", { shots: [{ asset: "A-999", stage: "before" }, { asset: after, stage: "after" }] }), /no asset/);
  assert.throws(() => s.openThread(card.id, alice, { kind: "comment", text: "Look", shots: [{ asset: before, stage: "before" }, { asset: after, stage: "after" }] }), /only Design Desk/);
  assert.equal(s.getCard(card.id).threads[0].messages.length, 1, "a refused answer leaves the thread as it was");
  s.answer(thread.id, "Save is the primary button now.", { resolve: true, shots: [{ asset: before, stage: "before", pair: "Save", marks }, { asset: after, stage: "after", pair: "Save", marks }] });
  const t = s.getCard(card.id).threads[0];
  assert.equal(t.state, "resolved");
  assert.deepEqual(t.messages[1].shots.map((x) => [x.asset, x.stage, x.pair, x.marks]), [[before, "before", "Save", marks], [after, "after", "Save", marks]]);
  // An answer without pictures carries none; the agent's own comment can carry them too.
  const q = s.openThread(card.id, bob, { kind: "question", text: "Why?" }).thread;
  assert.equal("shots" in s.answer(q.id, "Because.").thread.messages[1], false);
  const c = s.openThread(card.id, { agent: true }, { kind: "comment", text: "Redrawn with every comment.", shots: [{ asset: before, stage: "before" }, { asset: after, stage: "after" }] }).thread;
  assert.deepEqual(c.messages[0].shots.map((x) => x.pair), ["screen", "screen"]);
});

test("no option is the winner; votes only suggest one, and the presentation shows the one picked", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Two ways to show the plan." });
  const triaged = Object.values(s.db.inbox).find((i) => i.card === card.id);
  s.claim(triaged.id, "run-1"); s.done(triaged.id, "run-1", "checked");
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Table", asset: a }, { id: "v2", name: "Cards", asset: a }] });
  // Filed on the Desk: its options wait for a person to ask the team (docs/desk.md → Team feedback).
  assert.equal(s.card(card.id).status, "variants");
  s.openFeedback(card.id, alice);
  s.vote(card.id, alice, { variant: "v1", vote: "prefer" });
  assert.equal("choose" in s, false, "nobody picks a winner");
  assert.equal(s.vote(card.id, alice, { variant: "v2", vote: "dislike" }).votes.v2[alice.email].vote, "dislike", "a person may vote against an option");
  assert.throws(() => s.vote(card.id, alice, { variant: "v2", vote: "love" }), /prefer, dislike, concern or none/);
  assert.match(s.getCard(card.id).attention.reasons.join(), /Options are ready/);
  // The agent's card writes never carry a pick.
  s.upsertCard({ id: card.id, chosen: { variant: "v1" } });
  assert.equal(s.getCard(card.id).chosen, undefined);
  // The presentation shows the option the person picks in its dialog.
  assert.equal(s.queueForCall(card.id, alice, "", "v2").card.agenda.variant, "v2");
});

test("a change note keeps the look changes picked in the palette, as CSS values", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "People miss the upload button." });
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<button>Upload</button>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: [] }, variants: [{ id: "v1", name: "Big", asset: a }] });
  const look = s.openThread(card.id, alice, { kind: "change", text: "Red", anchor: { variant: "v1", selector: "button", label: "Upload", style: [{ prop: "background-color", from: "rgb(0, 0, 0)", to: "var(--danger)" }, { nope: 1 }] } }).thread;
  assert.deepEqual(look.anchor.style, [{ prop: "background-color", from: "rgb(0, 0, 0)", to: "var(--danger)" }]);
  assert.equal(s.openThread(card.id, alice, { kind: "change", text: "Plain", anchor: { variant: "v1", label: "Upload" } }).thread.anchor.style, null);
});

test("an element's smart controls: options the page can show, one way each; a note keeps what was picked", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "People miss the save button." });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<button id=save>Save</button>", encoding: "utf8" }).asset.id;
  const kind = { id: "kind", label: "Button type", current: "primary", source: "web/src/components/ui/button.tsx", options: [
    { id: "primary", label: "Primary", apply: { class: { add: "primary", remove: "ghost" } } },
    { id: "ghost", label: "Ghost", apply: { template: "save-ghost" } },
    { id: "pill", label: "Pill", token: "--radius-full", apply: { style: { "border-radius": "var(--radius-full)" } } }] };
  const el = (x) => ({ id: "save", name: "Save button", change: "changed", selector: "#save", ...x });
  const up = (x) => s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: [] }, variants: [{ id: "v1", name: "Bold", asset, elements: [el(x)] }] });
  up({ controls: [kind] });
  assert.deepEqual(s.card(card.id).variants[0].elements[0].controls, [{ ...kind, kind: "choice", options: kind.options }]);
  for (const [why, x, msg] of [
    ["no selector", { selector: null, shot: null, controls: [kind] }, /selector|picture/],
    ["two ways", { controls: [{ ...kind, options: [{ ...kind.options[0], apply: { class: { add: "a" }, style: { color: "red" } } }, kind.options[1]] }] }, /apply is one of/],
    ["a current that is no option", { controls: [{ ...kind, current: "big" }] }, /current/],
    ["markup in a class", { controls: [{ ...kind, options: [{ ...kind.options[0], apply: { class: { add: "<b>" } } }, kind.options[1]] }] }, /class lists/],
    ["one option", { controls: [{ ...kind, options: [kind.options[0]] }] }, /options/],
    ["a style that loads a picture", { controls: [{ ...kind, options: [{ ...kind.options[0], apply: { style: { background: "URL(https://x.example/p.png)" } } }, kind.options[1]] }] }, /style is up to 8/],
    ["a style that loads a picture set", { controls: [{ ...kind, options: [{ ...kind.options[0], apply: { style: { "background-image": "-webkit-image-set(a.png 1x)" } } }, kind.options[1]] }] }, /style is up to 8/],
  ]) assert.throws(() => up(x), msg, why);
  const t = s.openThread(card.id, alice, { kind: "change", text: "Ghost", anchor: { variant: "v1", selector: "#save", label: "Save button", controls: [{ control: "kind", label: "Button type", from: "Primary", to: "Ghost", source: "web/src/components/ui/button.tsx" }] } }).thread;
  assert.deepEqual(t.anchor.controls, [{ control: "kind", label: "Button type", from: "Primary", to: "Ghost", source: "web/src/components/ui/button.tsx" }]);
});

test("the kit: one per Desk, replaced whole, kept to the names and sizes the page draws", () => {
  const s = fresh();
  assert.equal(s.getKit().kit, null, "none until the agent sends one");
  assert.throws(() => s.setKit([]), /object/);
  const { kit } = s.setKit({ repo: "acme/widgets", commit: "abc", root: "/home/agent/checkouts/x", tokens: { color: [{ name: "--primary", value: "#fff", file: "a.css", used_in: ["p.tsx", "p.tsx", ""] }, { name: "primary", value: "#000" }], "Bad Kind": [{ name: "--x", value: "1" }], shadow: [] },
    components: [{ name: "Button", file: "b.tsx", prop: "variant", how: "cva", default: "default", options: [{ name: "default", classes: "bg-primary", extra: 1 }] }, { name: "Empty", options: [] }] });
  assert.deepEqual(kit.tokens, { color: [{ name: "--primary", value: "#fff", file: "a.css", used_in: ["p.tsx"] }] }, "where it is used, once each; a name that is no custom property, a kind with a bad name, an empty kind: left out");
  assert.deepEqual(kit.components, [{ name: "Button", file: "b.tsx", prop: "variant", how: "cva", default: "default", options: [{ name: "default", classes: "bg-primary" }] }]);
  assert.equal(kit.root, undefined, "the agent's own paths stay off the Desk");
  assert.equal(s.setKit({ tokens: {}, components: [] }).kit.repo, null, "the next one replaces it whole");
});

test("a reply, an answer, a reopen and Mark done take the ability of what they start", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "People miss the upload button." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "triaged"); }
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<button>Upload</button>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: [] }, variants: [{ id: "v1", name: "Big", asset: a }] });
  const guest = { email: "guest@example.com", role: "guest" };
  const asks = (step) => s.openThread(card.id, { agent: true }, { kind: "asks", text: "Which one?", step }).thread.id;
  assert.deepEqual(["request", "explore", "build", "figma", "map"].map((step) => s.threadNeed(asks(step), guest)), ["request", "revise", "build", "figma", "add"], "an answer takes its step's ability");
  const note = s.openThread(card.id, alice, { kind: "change", text: "Bigger", anchor: { variant: "v1", selector: "button", label: "Upload" } }).thread.id;
  assert.deepEqual([s.threadNeed(note, guest), s.threadNeed(note, guest, "resolve")], ["change", "change"], "a change note's follow-up takes change");
  const talk = s.openThread(card.id, alice, { kind: "question", text: "Why blue?" }).thread.id;
  const own = s.openThread(card.id, guest, { kind: "question", text: "Why so big?" }).thread.id;
  assert.deepEqual([s.threadNeed(talk, guest), s.threadNeed(talk, guest, "resolve"), s.threadNeed(own, guest, "resolve"), s.threadNeed(talk, alice, "resolve")], ["comment", "resolve", "comment", "comment"], "anyone replies; marking another's done takes resolve");
  assert.deepEqual(["guest", "developer", "designer"].map((r) => can(r, "resolve")), [false, true, true]);
  assert.equal(abilities("guest").resolve, false, "the page and the People tab hear of it");
});

test("pictures and pages have a total: past it an upload is refused, and the refusal names what frees room", () => {
  const s = fresh();
  s.db.assets.A0 = { id: "A0", file: "A0.png", bytes: LIMITS.assetsBytes - 2 };
  assert.throws(() => s.addAsset({ kind: "image", name: "x", contentType: "image/png", data: "abc", encoding: "utf8" }), /deleting a closed request/);
  assert.equal(s.addAsset({ kind: "image", name: "x", contentType: "image/png", data: "ab", encoding: "utf8" }).asset.bytes, 2, "up to the total it is taken");
});

test("the rate windows forget idle callers past 500, never one still in a window", () => {
  const now = 100_000_000, WINDOW = 10 * 60 * 1000;
  const m = new Map(Array.from({ length: 501 }, (_, i) => [`p${i}`, { writes: [now - 2 * WINDOW], items: [] }]));
  m.set("writing", { writes: [now - 1000], items: [] });
  m.set("asked", { writes: [], items: [now - 30 * 60 * 1000] });
  forgetIdle(m, now, WINDOW);
  assert.deepEqual([...m.keys()], ["writing", "asked"]);
  const few = new Map([["idle", { writes: [], items: [] }]]);
  forgetIdle(few, now, WINDOW);
  assert.equal(few.size, 1, "a small map is left alone");
});

test("every state of a part: drawn per option, versioned, noted on its own; a build names what goes live", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "People miss the upload button." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "triaged"); }
  const page = (t) => s.addAsset({ kind: "variant", name: t, contentType: "text/html", data: `<p>${t}</p>`, encoding: "utf8" }).asset.id;
  const a = page("A"), b = page("B");
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: [] }, variants: [{ id: "v1", name: "Big", asset: a }, { id: "v2", name: "Small", asset: b }] });
  // A designer asks for every state of the part they selected.
  assert.throws(() => s.act(card.id, alice, "states", "", { variant: "v9" }), /Pick the design option/);
  assert.throws(() => s.act(card.id, alice, "states", " ", { variant: "v1" }), /Select the part/);
  const { inbox: item } = s.act(card.id, alice, "states", "Also a drag hover.", { variant: "v1", part: { selector: "body > button", label: "Button “Upload”", text: "Upload" } });
  assert.deepEqual([item.kind, item.variant, item.part.label], ["states", "v1", "Button “Upload”"]);
  assert.equal(inbox(s).open.find((i) => i.id === item.id).variant, "v1", "the inbox file names the option");
  assert.throws(() => s.act(card.id, alice, "states", "Again", { variant: "v2" }), /already working/);
  // The agent's question resumes the same option and part.
  s.claim(item.id, "run-2"); s.done(item.id, "run-2", "asked");
  const { thread: q } = s.openThread(card.id, { agent: true }, { kind: "asks", text: "The upload button?", step: "states" });
  const guest = { email: "guest@example.com", role: "guest" };
  assert.deepEqual([s.threadNeed(q.id, guest), can("guest", s.threadNeed(q.id, guest)), can("developer", s.threadNeed(q.id, bob))], ["revise", false, true], "an answer that resumes a step takes that step's ability");
  const { thread: talk } = s.openThread(card.id, alice, { kind: "question", text: "Why blue?" });
  assert.deepEqual([s.threadNeed(talk.id, guest), s.threadNeed(talk.id, guest, "resolve"), s.threadNeed(talk.id, alice, "resolve")], ["comment", "resolve", "comment"], "a guest replies, marks done only their own");
  const { inbox: resumed } = s.reply(q.id, alice, "Yes.");
  assert.deepEqual([resumed.kind, resumed.variant, resumed.part.label], ["states", "v1", "Button “Upload”"]);
  s.claim(resumed.id, "run-3"); s.done(resumed.id, "run-3", "drew");
  // The states: one page each, kept when an upsert leaves them out, versioned under their id.
  const h = page("hover"), e = page("error");
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Big", asset: a, states: [{ id: "x", name: "X", asset: "A-99" }] }] }), /no asset/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Big", asset: a, states: [{ id: "x", name: "X", asset: h, selector: "button" }, { id: "x", name: "Y", asset: e, selector: "button" }] }] }), /its own/);
  // A state with no picture of the part — no shot and no selector — cannot be read in the catalog:
  // the page would show the whole state page in a small box, so it is refused, not stored.
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Big", asset: a, states: [{ id: "hover", name: "Hovered", part: "Upload button", asset: h }] }, { id: "v2", version: 1, name: "Small", asset: b }] }), /catalog needs a picture of the part/);
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Big", asset: a, states: [{ id: "hover", name: "Hovered", how: "The pointer is over it.", part: "Upload button", asset: h, selector: "main > article:nth-child(1)" }, { id: "error", name: "Failed", part: "Upload button", asset: e, selector: "main > article:nth-child(1)" }] }, { id: "v2", version: 1, name: "Small", asset: b }] });
  assert.equal(s.getCard(card.id).variants[0].states[0].selector, "main > article:nth-child(1)", "a selector of its own is a picture the page can cut");
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Big", asset: a }, { id: "v2", version: 1, name: "Small", asset: b }] });
  assert.deepEqual(s.getCard(card.id).variants[0].states.map((x) => [x.id, x.version]), [["hover", 1], ["error", 1]], "leaving states out keeps them");
  // The design catalog: a picture of the part alone and the use case of the brief it serves.
  const pic = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const st = (x) => ({ id: "v1", version: 1, name: "Big", asset: a, states: s.getCard(card.id).variants[0].states.map((o) => (o.id === "hover" ? { ...o, ...x } : o)) });
  assert.throws(() => s.upsertCard({ id: card.id, variants: [st({ shot: h }), { id: "v2", version: 1, name: "Small", asset: b }] }), /shot must be an uploaded picture/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [st({ stories: ["not a story id!"] }), { id: "v2", version: 1, name: "Small", asset: b }] }), /user story ids/);
  s.upsertCard({ id: card.id, variants: [st({ shot: pic, stories: ["s1", "s1"], use: "Someone points at it before uploading." }), { id: "v2", version: 1, name: "Small", asset: b }] });
  const hov = s.getCard(card.id).variants[0].states[0];
  assert.deepEqual([hov.shot, hov.stories, hov.use, hov.version], [pic, ["s1"], "Someone points at it before uploading.", 1], "a new picture of the part alone is not a new version of the state");
  // The check reads the state the store keeps: a state sent unchanged keeps its picture, and a
  // redrawn one sent with its old picture and no selector would keep neither, so it is refused.
  s.upsertCard({ id: card.id, variants: [st({ shot: null, selector: null }), { id: "v2", version: 1, name: "Small", asset: b }] });
  assert.deepEqual([s.getCard(card.id).variants[0].states[0].shot, s.getCard(card.id).variants[0].states[0].selector], [pic, "main > article:nth-child(1)"], "a state sent unchanged keeps its shot and selector");
  assert.throws(() => s.upsertCard({ id: card.id, variants: [st({ asset: page("hover b"), selector: null }), { id: "v2", version: 1, name: "Small", asset: b }] }), /catalog needs a picture of the part — the state is redrawn/);
  assert.equal(s.getCard(card.id).variants[0].states[0].version, 1, "a refused redraw changes nothing");
  // A state stored before the rule with neither (C-34) is sent back as it was read, and kept.
  s.card(card.id).variants[0].states[1].selector = null;
  s.upsertCard({ id: card.id, variants: [st({}), { id: "v2", version: 1, name: "Small", asset: b }] });
  assert.equal(s.getCard(card.id).variants[0].states[1].selector, null, "an unchanged state without a picture stays as it is");
  s.upsertCard({ id: card.id, variants: [{ ...st({}), states: s.getCard(card.id).variants[0].states.map((o) => (o.id === "error" ? { ...o, selector: "main > article:nth-child(1)" } : o)) }, { id: "v2", version: 1, name: "Small", asset: b }] });
  assert.equal(s.getCard(card.id).variants[0].states[1].selector, "main > article:nth-child(1)", "a selector sent for an unchanged state is kept");
  // A note on one state names it; a state the option does not have is refused.
  assert.throws(() => s.openThread(card.id, alice, { kind: "change", text: "Red.", anchor: { variant: "v1", state: "loading" } }), /not drawn/);
  const { thread: note } = s.openThread(card.id, alice, { kind: "change", text: "Make it red.", anchor: { variant: "v1", state: "error", label: "the whole state" } });
  assert.equal(note.anchor.state, "error");
  const e2 = page("error 2");
  const states = s.getCard(card.id).variants[0].states.map((x) => (x.id === "error" ? { ...x, asset: e2 } : x));
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Big", asset: a, states }, { id: "v2", version: 1, name: "Small", asset: b }] });
  const err = s.getCard(card.id).variants[0].states.find((x) => x.id === "error");
  assert.deepEqual([err.version, err.asset, err.history[0].asset], [2, e2, e], "a redrawn state keeps the one it replaces");
  // Build it live: exactly the option and version the person checked.
  assert.throws(() => s.act(card.id, alice, "build", "v9", { variant: "v9" }), /Pick the design option to build/);
  assert.throws(() => s.act(card.id, alice, "build", "v1", { variant: "v1", version: 0 }), (x) => x.status === 409 && /newer version of Big/.test(x.message));
  // A state redrawn alone, or one the check did not show, is not what the person saw.
  assert.throws(() => s.act(card.id, alice, "build", "v1", { variant: "v1", version: 1, states: { hover: 1, error: 1 } }), (x) => x.status === 409);
  assert.throws(() => s.act(card.id, alice, "build", "v1", { variant: "v1", version: 1, states: { hover: 1 } }), (x) => x.status === 409);
  const { card: built, inbox: job } = s.act(card.id, alice, "build", "v1", { variant: "v1", version: 1, states: { hover: 1, error: 2 }, askFirst: true });
  assert.deepEqual([job.variant, job.version, job.note], ["v1", 1, "v1"]);
  assert.deepEqual([built.live_pick.variant, built.live_pick.version, built.live_pick.asset, built.live_pick.by.email], ["v1", 1, a, alice.email]);
  assert.deepEqual(built.live_pick.states.map((x) => [x.id, x.version, x.asset]), [["hover", 1, h], ["error", 2, e2]]);
  // The agent's card writes never carry it.
  s.upsertCard({ id: card.id, live_pick: { variant: "v2" } });
  assert.equal(s.getCard(card.id).live_pick.variant, "v1");
  // A revise of the option leaves its states drawn for the earlier version: no build until
  // they are drawn again for the new one.
  s.claim(job.id, "run-4"); s.done(job.id, "run-4", "live");
  const a2 = page("A2");
  const now = s.getCard(card.id).variants;
  s.upsertCard({ id: card.id, variants: [{ ...now[0], asset: a2 }, now[1]] });
  const v1 = s.getCard(card.id).variants[0];
  assert.deepEqual([v1.version, v1.states.map((x) => x.of)], [2, [1, 1]]);
  assert.throws(() => s.act(card.id, alice, "build", "v1", { variant: "v1", version: 2, states: { hover: 1, error: 2 } }), (x) => x.status === 409 && /drawn for an earlier version/.test(x.message));
  const h2 = page("hover 2"), e3 = page("error 3");
  // Redrawn, Hovered comes back with its old picture of the part, Failed with a new one: an old
  // picture shows the state as it was, so the catalog shows none until a new one comes.
  const pic2 = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png2").toString("base64") }).asset.id;
  s.upsertCard({ id: card.id, variants: [{ ...v1, states: [{ ...v1.states[0], asset: h2 }, { ...v1.states[1], asset: e3, shot: pic2 }] }, now[1]] });
  assert.deepEqual(s.getCard(card.id).variants[0].states.map((x) => [x.version, x.of, x.shot]), [[2, 2, null], [3, 2, pic2]]);
  assert.equal(s.act(card.id, alice, "build", "v1", { variant: "v1", version: 2, states: { hover: 2, error: 3 } }).card.live_pick.version, 2);
  // Two runs on one card: the one that read an older version is refused, not saved over.
  const fresh2 = s.getCard(card.id).variants;
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ ...fresh2[0], version: 1 }, fresh2[1]] }), (x) => x.status === 409 && /Big is at version 2 now; you read version 1/.test(x.message));
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ ...fresh2[0], states: [{ ...fresh2[0].states[0], version: 1, asset: page("old") }, fresh2[0].states[1]] }, fresh2[1]] }), (x) => x.status === 409 && /Hovered is at version 2/.test(x.message));
  assert.equal(s.getCard(card.id).variants[0].states[0].asset, h2, "a refused write changes nothing");
  // A run that sends no version, or leaves an option or a state out, is refused too.
  const noVersion = ({ version, ...x }) => x;
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ ...noVersion(fresh2[0]), asset: page("older") }, fresh2[1]] }), (x) => x.status === 409 && /send the version you read/.test(x.message));
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ ...fresh2[0], states: [noVersion(fresh2[0].states[0]), fresh2[0].states[1]] }, fresh2[1]] }), (x) => x.status === 409 && /Hovered is on the card at version 2/.test(x.message));
  assert.throws(() => s.upsertCard({ id: card.id, variants: [fresh2[0]] }), (x) => x.status === 409 && /Small is on the card but not in what you sent/.test(x.message));
  assert.throws(() => s.upsertCard({ id: card.id, variants: [{ ...fresh2[0], states: [fresh2[0].states[0]] }, fresh2[1]] }), (x) => x.status === 409 && /Failed is on the card but not in what you sent/.test(x.message));
  assert.throws(() => s.upsertCard({ id: card.id, variants: [...fresh2, { id: "v9", drop: true }] }), /no option v9/);
  assert.deepEqual(s.getCard(card.id).variants.map((x) => x.id), ["v1", "v2"], "nothing refused was saved");
  // A closed request has nothing going live.
  s.claim(Object.values(s.db.inbox).find((i) => i.kind === "build" && i.state === "open").id, "run-5");
  assert.equal(s.act(card.id, alice, "close").card.live_pick, undefined);
});

test("Send to Slack, Send the designs, is one slack item scoped send, and needs options", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "A new empty state." });
  assert.throws(() => s.act(card.id, alice, "slack-send", "{}"), /no design options/);
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Calm", asset: a }] });
  const { inbox: item } = s.act(card.id, alice, "slack-send", JSON.stringify({ variants: "all", note: "" }));
  assert.deepEqual([item.kind, item.scope], ["slack", "send"]);
  assert.deepEqual(inbox(s).open.find((i) => i.id === item.id).scope, "send");
  assert.throws(() => s.act(card.id, alice, "slack-send", "{}"), /already working/);
});

test("a person's answer to the agent's question resumes the blocked step", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Make it nicer." });
  const done = Object.values(s.db.inbox).find((i) => i.card === card.id);
  s.claim(done.id, "run-1"); s.done(done.id, "run-1", "asked");
  const { thread } = s.openThread(card.id, { agent: true }, { kind: "asks", text: "Which screen?", step: "request" });
  assert.throws(() => s.openThread(card.id, alice, { kind: "asks", text: "x", step: "request" }), /only Design Desk/);
  const { inbox: item } = s.reply(thread.id, alice, "The agents list.");
  assert.equal(item.kind, "request");
  assert.equal(s.listDecisions().length, 0);
  s.addDecision({ concepts: ["Spend"], text: "Spend is per week.", author: { email: alice.email }, origin: { kind: "desk", card: card.id } });
  assert.equal(s.listDecisions({ concept: "spend" }).length, 1);
});

test("before a build the agent asks a form; the answer resumes the build with its option", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Make it nicer." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "triaged"); }
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] } });
  const { inbox: build } = s.act(card.id, alice, "build", "v2", { askFirst: true });
  assert.equal(build.ask_first, true);
  assert.equal(inbox(s).open.find((i) => i.id === build.id).ask_first, true, "the inbox file carries it too");
  s.claim(build.id, "run-2"); s.done(build.id, "run-2", "asked");
  assert.throws(() => s.openThread(card.id, { agent: true }, { kind: "asks", text: "Two things.", step: "build", questions: [] }), /1 to 6/);
  assert.throws(() => s.openThread(card.id, { agent: true }, { kind: "asks", text: "One.", step: "build", questions: [{ text: "Empty list?", options: ["A hint"] }] }), /2 to 4 options/);
  assert.throws(() => s.openThread(card.id, { agent: true }, { kind: "asks", text: "One.", step: "build", questions: [{ text: "Empty list?", options: ["A hint", "Nothing"], suggested: "a hint" }] }), /suggested must be one/);
  const { thread } = s.openThread(card.id, { agent: true }, { kind: "asks", text: "Two things.", step: "build",
    questions: [{ text: "Empty list?", options: ["A hint", "Nothing"], suggested: "A hint" }, { text: "Button words?", options: ["Save", "Done"] }] });
  assert.throws(() => s.answerForm(thread.id, alice, [{ choice: "Maybe" }, {}]), /not an option/);
  const { inbox: again } = s.answerForm(thread.id, alice, [{ choice: "Nothing", note: "Keep it calm." }, { choice: null }]);
  assert.equal(again.kind, "build");
  assert.equal(again.note, "v2", "the answer keeps the option the designer picked");
  assert.match(s.thread(thread.id).messages[1].text, /Nothing — Keep it calm\.[\s\S]*Leave it to Design Desk/);
  assert.throws(() => s.answerForm(thread.id, alice, [{}, {}]), /already answered/);
  assert.deepEqual(s.thread(thread.id).answers[0], { choice: "Nothing", note: "Keep it calm." });
  const long = "q".repeat(300), opts = ["o".repeat(120), "p".repeat(120)];
  const { thread: big } = s.openThread(card.id, { agent: true }, { kind: "asks", text: "Six.", step: "build", questions: Array(6).fill({ text: long, options: opts }) });
  s.answerForm(big.id, alice, Array(6).fill({ choice: opts[0], note: "n".repeat(500) }));
  assert.equal(s.thread(big.id).state, "answered", "six full answers fit in the reply");
});

test("straight to implementation survives the handoff's questions", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Make it nicer." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "triaged"); }
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Only the look."] } });
  const { inbox: handoff, card: approved } = s.act(card.id, { agent: true }, "approve", "Grey header.", { implement: true });
  assert.deepEqual([handoff.kind, handoff.implement, approved.approved.implement], ["handoff", true, true]);
  assert.equal(inbox(s).open.find((i) => i.id === handoff.id).implement, true, "the inbox file carries it too");
  s.claim(handoff.id, "run-2"); s.done(handoff.id, "run-2", "asked");
  const { thread } = s.openThread(card.id, { agent: true }, { kind: "asks", text: "One thing.", step: "handoff", questions: [{ text: "Empty list?", options: ["A hint", "Nothing"] }] });
  const { inbox: again } = s.answerForm(thread.id, alice, [{ choice: "Nothing" }]);
  assert.deepEqual([again.kind, again.implement, again.note], ["handoff", true, "Grey header."]);
});

test("screenshots a person adds wake the agent once and keep who added them", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "change", title: "Spend in the list", source: { repo: "acme/widgets", pr: 9 } });
  const shot = () => s.addAsset({ kind: "screen", name: "x", contentType: "image/png", data: "iVBORw0KGgo=" }).asset.id;
  const first = s.addScreens(card.id, bob, [shot()]).inbox;
  const second = s.addScreens(card.id, alice, [shot()]).inbox;
  assert.equal(first.id, second.id);
  const screens = s.getCard(card.id).screens;
  assert.deepEqual(screens.map((x) => [x.source, x.by.email]), [["person", bob.email], ["person", alice.email]]);
  // The agent's caption keeps who added it.
  s.upsertCard({ id: card.id, screens: screens.map((x) => ({ ...x, caption: "The list" })) });
  assert.equal(s.getCard(card.id).screens[0].by.email, bob.email);
});

test("a picture keeps where the change is, and a place links only a screen or a part", () => {
  const s = fresh();
  const shot = s.addAsset({ kind: "screen", name: "x", contentType: "image/png", data: "iVBORw0KGgo=" }).asset.id;
  const screen = s.upsertCard({ kind: "screen", title: "Agents list" }).card;
  const { card } = s.upsertCard({ kind: "change", title: "Spend in the list", source: { repo: "acme/widgets", pr: 9 },
    screens: [{ asset: shot, stage: "after", pair: "list", marks: [{ x: 0.9, y: 0.1, w: 0.5, h: 0.2 }, { x: 0.1, y: 0.1, w: 0, h: 0.1 }] }],
    impact: { concept: "spend", places: [{ where: "Agents list", card: screen.id }, { where: "Alert", card: "C-404" }, { where: "Toolbar", card: "toString" }] } });
  assert.deepEqual(card.screens[0].marks, [{ x: 0.9, y: 0.1, w: 0.1, h: 0.2 }], "a box is kept inside the picture, an empty one goes");
  assert.deepEqual(card.impact.places.map((p) => p.card), [screen.id, null, null]);
  assert.throws(() => s.upsertCard({ id: card.id, screens: [{ asset: shot, marks: [{ x: "left" }] }] }), DeskError);
  assert.throws(() => s.upsertCard({ id: card.id, screens: [{ asset: shot, marks: Array(21).fill({ x: 0, y: 0, w: 0.1, h: 0.1 }) }] }), /at most 20/, "more marks than design diff gives are refused, not cut");
});

test("a picture keeps where it came from: an issue's own and an AI sketch too; an unknown source is dropped", () => {
  const s = fresh();
  const shot = () => s.addAsset({ kind: "screen", name: "x", contentType: "image/png", data: "iVBORw0KGgo=" }).asset.id;
  const { card } = s.upsertCard({ kind: "issue", title: "Spend", status: "open", bucket: "sprint", source: { repo: "acme/widgets", issue: 41 },
    screens: [{ asset: shot(), source: "issue" }, { asset: shot(), source: "made-up" }], sketches: [{ asset: shot(), source: "sketch" }] });
  assert.deepEqual(card.screens.map((x) => x.source), ["issue", undefined], "the issue's own picture says so; an unknown source is not kept");
  assert.equal(card.sketches[0].source, "sketch");
});

test("a Slack sync is not a new vote: a reaction counted before keeps its time, a changed one is new", () => {
  let now = Date.UTC(2026, 10, 1, 9);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const a = s.addAsset({ kind: "variant", name: "v", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "One button", asset: a }] });
  s.slackVotes(card.id, "v1", [{ key: "slack:U1", vote: "prefer", name: "Jana" }]);
  const first = s.getCard(card.id).votes.v1["slack:U1"].at;
  const votes = () => s.notifications(bob).items.filter((x) => x.event === "vote");
  assert.equal(votes().length, 1);
  now += 3 * 3600e3;
  s.slackVotes(card.id, "v1", [{ key: "slack:U1", vote: "prefer", name: "Jana" }]);
  assert.equal(s.getCard(card.id).votes.v1["slack:U1"].at, first, "the same reaction keeps its time");
  assert.deepEqual(votes().map((x) => x.at), [first], "a sync adds no vote to the bell");
  now += 3600e3;
  s.slackVotes(card.id, "v1", [{ key: "slack:U1", vote: "dislike", name: "Jana" }]);
  assert.notEqual(s.getCard(card.id).votes.v1["slack:U1"].at, first, "a changed reaction is a new vote");
});

test("Slack reactions become votes, a Desk vote wins, and a Slack reply is relayed once", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const a = s.addAsset({ kind: "variant", name: "v", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "One button", asset: a }] });
  assert.throws(() => s.act(card.id, alice, "slack-share", "{}") && s.act(card.id, alice, "slack-share", "{}"), /already working/);
  const { poll } = s.openPoll(card.id, { chat: "C0123", root_ts: "1.0", posts: [{ variant: "v1", ts: "1.1" }], closes: "2026-11-06T14:00:00Z", head_ts: "1.0", head_text: "Which design?" });
  assert.deepEqual(s.findPoll("1.1"), { card: card.id, poll: poll.id, state: "open", variant: "v1" });
  assert.deepEqual([poll.head_ts, poll.head_text], ["1.0", "Which design?"], "the opening message is kept, so the agent can edit it with the tally");
  assert.equal(s.openPoll(card.id, { chat: "C0123", root_ts: "2.0", posts: [{ variant: "v1", ts: "2.1" }], closes: "2026-11-06T14:00:00Z" }).poll.head_ts, null, "without one, no tally");
  s.vote(card.id, alice, { variant: "v1", vote: "concern" });
  s.slackVotes(card.id, "v1", [{ key: alice.email, vote: "prefer" }, { key: "slack:U1", vote: "prefer", name: "Jana" }]);
  assert.equal(s.getCard(card.id).votes.v1[alice.email].vote, "concern");
  assert.equal(s.getCard(card.id).votes.v1["slack:U1"].via, "slack");
  s.slackVotes(card.id, "v1", []);
  assert.equal(s.getCard(card.id).votes.v1["slack:U1"], undefined);
  // The agent's own legend 👍/👎 comes back among the reactions; it is a bot's, not a vote.
  s.slackVotes(card.id, "v1", [{ key: "slack:UBOT", vote: "prefer", is_bot: true, name: "Design Desk" }, { key: "slack:UBOT", vote: "dislike", is_bot: true, name: "Design Desk" },
    { key: "slack:U2", vote: "concern", name: "Petr" }, { key: "slack:U3", vote: "dislike", name: "Eva" }]);
  assert.equal(s.getCard(card.id).votes.v1["slack:UBOT"], undefined, "a bot's reaction is never a vote");
  assert.equal(s.getCard(card.id).votes.v1["slack:U2"], undefined, "Slack votes 👍 or 👎 only: a concern there is a reply, never a vote");
  assert.equal(s.getCard(card.id).votes.v1["slack:U3"].vote, "dislike", "a 👎 in Slack is a vote against the option");
  s.relayComment(card.id, { variant: "v1", name: "Jana", text: "Clearer.", slack_ts: "1.2" });
  assert.equal(s.relayComment(card.id, { variant: "v1", name: "Jana", text: "Clearer.", slack_ts: "1.2" }).duplicate, true);
  assert.equal(s.getCard(card.id).threads.filter((t) => t.slack_ts === "1.2")[0].messages[0].by.via, "slack");
  assert.equal(s.updatePoll(card.id, poll.id, { result: "One button: 1 👍" }).poll.state, "closed");
});

test("a council remembers its Slack thread, reopens once closed, and relays replies to the whole request", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  s.upsertCard({ id: card.id, origin: { channel: "slack", chat: "C0123", thread_ts: "2.0", message_ts: "2.0", reporter: "Jana" } });
  assert.deepEqual(s.findCouncil("2.0"), { card: card.id, council: null, state: null });
  const { council } = s.openCouncil(card.id, { chat: "C0123", thread_ts: "2.0" });
  assert.equal(council.id, "K-1");
  assert.deepEqual(s.findCouncil("2.0"), { card: card.id, council: "K-1", state: "open" });
  const other = s.createRequest(alice, { problem: "Another." }).card;
  assert.equal(s.openCouncil(other.id, { chat: "C0123", thread_ts: "2.0" }).duplicate, true);
  s.updateCouncil(card.id, "K-1", { synced: "2026-11-02T10:00:00Z", seen: "2.5" });
  assert.equal(s.getCard(card.id).councils[0].seen, "2.5");
  assert.equal(s.updateCouncil(card.id, "K-1", { result: "Agreed on One button v2" }).council.state, "closed");
  const reopened = s.openCouncil(card.id, { chat: "C0123", thread_ts: "2.0" }).council;
  assert.deepEqual([reopened.state, reopened.seen, reopened.result], ["open", "2.5", null]);
  assert.equal(s.getCard(card.id).councils.length, 1);
  const { thread } = s.relayComment(card.id, { name: "Jana", text: "Bigger, please.", slack_ts: "2.6" });
  assert.equal(thread.anchor, null);
  assert.equal(s.relayComment(card.id, { name: "Jana", text: "Bigger, please.", slack_ts: "2.6" }).duplicate, true);
  assert.throws(() => s.relayComment(card.id, { variant: "v9", name: "Jana", text: "x", slack_ts: "2.7" }), /no option/);
});

test("a relayed Slack reply names the people it mentions, or leaves a mention out", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Calmer list", problem: "The list shouts." });
  const say = (text, ts, mentions) => s.relayComment(card.id, { name: "Jana", text, slack_ts: ts, mentions }).thread.messages[0].text;
  assert.equal(say("<@U0A4HATCHJR> can you look?", "3.1", { U0A4HATCHJR: "Dana" }), "@Dana can you look?");
  assert.equal(say("Ask <@U0A4HATCHJR> first", "3.2"), "Ask first", "an unknown mention is left out");
  assert.equal(say("Ask <@U9|Pat>", "3.3"), "Ask @Pat", "the name Slack gave in the mention");
  assert.equal(say("<@U1>  see:\n    a  b", "3.4", { U1: { name: "x" } }), "see:\n    a  b", "a name that is not text is left out; the rest keeps its spacing");
});

test("the next call: only a designer adds it, with the option to present", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const a1 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Calm", asset: a1 }, { id: "v2", name: "Loud", asset: a1 }] });
  assert.throws(() => s.queueForCall(card.id, { agent: true }), (e) => e.status === 403);
  assert.throws(() => s.queueForCall(card.id, alice, "Pick one", "v9"), (e) => e.status === 400, "an unknown option is refused");
  const { inbox: item } = s.queueForCall(card.id, alice, "Pick one", "v2");
  assert.equal(item.kind, "agenda");
  assert.deepEqual(s.agenda().map((a) => [a.option, a.agenda.variant]), [["Loud", "v2"]]);
  s.unqueue(card.id, alice);
  s.vote(card.id, alice, { variant: "v2", vote: "prefer" });
  s.queueForCall(card.id, alice, "From an older page");
  assert.equal(s.agenda()[0].agenda.variant, "v2", "a page that sends no option presents the favourite");
});

test("the presentation: a designer marks one item presented, and Undo puts it back", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const { card: other } = s.createRequest(alice, { problem: "The header is too tall." });
  s.queueForCall(card.id, alice); s.queueForCall(other.id, alice);
  assert.throws(() => s.markPresented(card.id, bob), (e) => e.status === 403, "a developer does not mark it");
  s.markPresented(card.id, alice);
  assert.deepEqual(s.agenda().map((a) => a.id), [other.id], "the other one stays to present");
  assert.deepEqual(s.presented().map((a) => a.id), [card.id]);
  assert.equal(s.getCard(card.id).agenda.presented_by.email, alice.email);
  assert.throws(() => s.markPresented(card.id, alice), (e) => e.status === 400, "it is presented once");
  s.markPresented(card.id, alice, false);
  assert.deepEqual(s.agenda().map((a) => a.id).sort(), [card.id, other.id].sort(), "Undo puts it back on");
  assert.equal(s.getCard(card.id).agenda.call, undefined);
});

test("the presentation: Undo ends with the day; an earlier meeting's item keeps its record", () => {
  let now = Date.UTC(2026, 10, 3, 17);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const { card: other } = s.createRequest(alice, { problem: "The header is too tall." });
  s.queueForCall(card.id, alice); s.queueForCall(other.id, alice);
  s.markPresented(card.id, alice);
  s.closeCall(alice);
  assert.equal(s.getCard(card.id).agenda.undo_until, "2026-11-03T23:59:59Z", "the store writes the deadline");
  now += 23 * 36e5;
  for (const id of [card.id, other.id]) {
    const before = s.getCard(id).agenda;
    assert.throws(() => s.markPresented(id, alice, false), (e) => e.status === 400, "an earlier meeting's item is not taken back");
    assert.deepEqual(s.getCard(id).agenda, before, "its date and who presented it stay");
  }
  assert.equal(s.agenda().length, 0);
});

test("an element's redraw keeps its earlier look with the change that made the new one", () => {
  let t = 0;
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(Date.UTC(2026, 9, 1) + ++t * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const sheet = (html) => s.addAsset({ kind: "report", name: "sheet", contentType: "text/html", data: html, encoding: "utf8" }).asset.id;
  const source = { file: "src/AgentRow.tsx", export: "AgentRow" };
  const a1 = sheet("<p>one</p>");
  const el = s.upsertCard({ kind: "element", title: "Agent row", source: { ...source, commit: "aaa" }, sheet: a1, status: "current", states: [{ name: "Running" }] }).card;
  assert.deepEqual(el.history || [], []);
  // The same picture again is no new version.
  const same = sheet("<p>one</p>");
  s.upsertCard({ id: el.id, sheet: same });
  assert.deepEqual(s.getCard(el.id).history || [], []);
  const ch = s.upsertCard({ kind: "change", title: "Spend in the row", source: { repo: "acme/widgets", pr: 7, merged_at: new Date(Date.UTC(2026, 9, 1) + (t + 0.5) * 3600e3).toISOString() }, elements: [el.id] }).card;
  const open = s.upsertCard({ kind: "change", title: "Not shipped", source: { repo: "acme/widgets", pr: 8 }, elements: [el.id] }).card;
  const a2 = sheet("<p>two</p>");
  const now = s.upsertCard({ id: el.id, sheet: a2, source: { ...source, commit: "bbb" } }).card;
  assert.equal(now.history.length, 1);
  assert.equal(now.history[0].sheet, same);
  assert.equal(now.history[0].commit, "aaa");
  assert.deepEqual(now.history[0].states, ["Running"]);
  assert.deepEqual(now.made_by, [ch.id]);
  assert.ok(!now.made_by.includes(open.id));
  assert.equal(s.listCards({ kind: "element" })[0].looks, 1);
});

test("earlier looks drawn from the code's history go in by date; the same commit replaces", () => {
  const s = fresh();
  const sheet = (html) => s.addAsset({ kind: "report", name: "sheet", contentType: "text/html", data: html, encoding: "utf8" }).asset.id;
  const el = s.upsertCard({ kind: "element", title: "Picker", source: { file: "src/Picker.tsx", export: "Picker" }, sheet: sheet("<p>now</p>") }).card;
  const link = { label: "PR #3", url: "https://github.com/acme/widgets/pull/3" };
  s.addLook(el.id, { at: "2026-03-01T00:00:00Z", commit: "c3", sheet: sheet("<p>3</p>"), links: [link] });
  s.addLook(el.id, { at: "2026-01-01T00:00:00Z", commit: "c1", sheet: sheet("<p>1</p>"), states: ["Empty"] });
  const again = sheet("<p>3 again</p>");
  s.addLook(el.id, { at: "2026-03-01T00:00:00Z", commit: "c3", sheet: again, links: [link] });
  // An offset date (git log %cI) is stored in UTC and placed by its instant, not its text.
  s.addLook(el.id, { at: "2026-03-01T01:00:00+05:00", commit: "c2", sheet: sheet("<p>2</p>") });
  const h = s.getCard(el.id).history;
  assert.deepEqual(h.map((x) => x.commit), ["c3", "c2", "c1"]);
  assert.equal(h[1].at, "2026-02-28T20:00:00Z");
  assert.equal(h[0].sheet, again);
  assert.deepEqual(h[0].links, [link]);
  assert.equal(h[0].later, true);
  assert.throws(() => s.addLook(el.id, { at: "2999-01-01T00:00:00Z", sheet: again }), /newer than the current drawing/);
  assert.throws(() => s.addLook(el.id, { at: "2026-02-01T00:00:00Z", sheet: "A-999" }), /no asset/);
  assert.throws(() => s.addLook(el.id, { at: "2026-02-01T00:00:00Z", sheet: again, links: [{ label: "x", url: "javascript:alert(1)" }] }), /http/);
  const change = s.upsertCard({ kind: "change", title: "Spend", source: { repo: "acme/widgets", pr: 9 } }).card;
  assert.throws(() => s.addLook(change.id, { at: "2026-02-01T00:00:00Z", sheet: again }), /element or a screen/);
});

test("a screen keeps its earlier pictures; a designer asks for an element's history", () => {
  const s = fresh();
  const png = () => s.addAsset({ kind: "screen", name: "shot", contentType: "image/png", data: Buffer.from(String(Math.random())).toString("base64") }).asset.id;
  const first = png();
  const sc = s.upsertCard({ kind: "screen", title: "Agents list", path: "/agents", screens: [{ asset: first, caption: "light" }] }).card;
  const ch = s.upsertCard({ kind: "change", title: "Bigger rows", source: { repo: "acme/widgets", pr: 4, merged_at: "2999-01-01T00:00:00Z" } }).card;
  const next = s.upsertCard({ kind: "screen", path: "/agents", title: "Agents list", screens: [{ asset: png(), caption: "light" }], changes: [ch.id] }).card;
  assert.equal(next.id, sc.id);
  assert.equal(next.history[0].screens[0].asset, first);
  const el = s.upsertCard({ kind: "element", title: "Agent row", source: { file: "src/AgentRow.tsx", export: "AgentRow" } }).card;
  assert.throws(() => s.act(el.id, alice, "approve"), /redrawn or have its history drawn/);
  const { inbox: item } = s.act(el.id, alice, "history", "the last 3 changes");
  assert.equal(item.kind, "catalog");
  assert.equal(inbox(s).open.find((i) => i.id === item.id).scope, "history");
  assert.equal(s.getCard(el.id).waiting[0].scope, "history");
  assert.throws(() => s.act(el.id, alice, "refresh"), /already working/);
  assert.equal(can("developer", "history"), true);
  assert.equal(can("guest", "history"), false);
  assert.equal(can("designer", "history"), true);
});

test("needs a designer: the agent judges a change, a request's comes from where it stands", () => {
  const s = fresh();
  const att = (id) => s.listCards().find((c) => c.id === id).attention;
  const { card: change } = s.upsertCard({ kind: "change", title: "A new settings page", source: { repo: "acme/widgets", pr: 9 } });
  assert.equal(att(change.id), null, "a change nobody judged is not in the filter");
  assert.throws(() => s.upsertCard({ id: change.id, attention: { level: "urgent", reasons: ["x"] } }), (e) => e.status === 400);
  assert.throws(() => s.upsertCard({ id: change.id, attention: { level: "designer", reasons: [] } }), (e) => e.status === 400, "a judgement says why");
  s.upsertCard({ id: change.id, attention: { level: "designer", reasons: ["a new screen"] } });
  assert.deepEqual(att(change.id), { level: "designer", reasons: ["a new screen"] });
  s.upsertCard({ id: change.id, attention: { level: "fyi", reasons: ["follows the list pattern"] } });
  assert.equal(att(change.id).level, "fyi");

  const { card: req, inbox: triage } = s.createRequest(alice, { problem: "The empty list shouts." });
  assert.throws(() => s.upsertCard({ id: req.id, attention: { level: "designer", reasons: ["x"] } }), (e) => e.status === 400, "a request's is never written");
  assert.equal(att(req.id), null, "not checked yet: Design Desk's turn");
  s.claim(triage.id, "s1");
  s.upsertCard({ id: req.id, triage: { verdict: "design", reasons: ["Only the look."] } });
  assert.equal(att(req.id), null, "still Design Desk's turn until its triage is done");
  s.done(triage.id, "s1", "triaged");
  assert.deepEqual(att(req.id).reasons, ["Checked: draw options, decide or close it"]);
  s.act(req.id, alice, "explore");
  assert.equal(att(req.id), null, "while Design Desk draws, it waits for nobody");
  s.act(req.id, alice, "close");
  assert.equal(att(req.id), null, "a closed request waits for nobody");

  // A handed-off request waits for nobody, and every read agrees.
  const { card: shipped } = s.createRequest(alice, { problem: "The header is too tall." });
  s.upsertCard({ id: shipped.id, status: "handed-off" });
  assert.equal(att(shipped.id), null);
  assert.equal(s.getCard(shipped.id).attention, att(shipped.id), "the card read and the list read agree");
});

test("a screen or part a designer adds goes to the agent, and never becomes a second copy", () => {
  const s = fresh();
  const shot = s.addAsset({ kind: "screen", name: "x", contentType: "image/png", data: "iVBORw0KGgo=" }).asset.id;
  const el = s.addToProduct(alice, { kind: "element", part: "The agent row in the agents list. With a long name.", show: "empty, an error", screens: [{ asset: shot, source: "person" }] });
  assert.equal(el.inbox.kind, "catalog");
  assert.deepEqual([el.card.status, el.card.title, el.card.wanted.show, el.card.created_by.email], ["building", "The agent row in the agents list.", "empty, an error", alice.email]);
  const sc = s.addToProduct(alice, { kind: "screen", part: "Billing settings", where: "/settings/billing" });
  assert.equal(sc.inbox.kind, "map");
  assert.throws(() => s.addToProduct(alice, { kind: "change", part: "x" }), /screen or element/);
  assert.throws(() => s.addToProduct(alice, { kind: "screen", part: "  " }), /part is empty/);
  // The agent's question resumes the step; the card is filled in by its id.
  const { thread } = s.openThread(sc.card.id, { agent: true }, { kind: "asks", text: "The billing page or the invoices?", step: "map" });
  assert.equal(s.reply(thread.id, alice, "The billing page.").inbox.kind, "map");
  s.upsertCard({ id: sc.card.id, path: "/settings/billing", status: "current" });
  // The same address again is that card, with no new work.
  const again = s.addToProduct(bob, { kind: "screen", part: "Billing", where: "/settings/billing" });
  assert.deepEqual([again.existing, again.card.id, again.inbox], [true, sc.card.id, null]);
  // An element already drawn: the added card cannot take its source; it is dropped instead.
  s.upsertCard({ kind: "element", title: "Agent row", source: { file: "web/agent-row.tsx", export: "AgentRow" }, status: "current" });
  assert.throws(() => s.upsertCard({ id: el.card.id, source: { file: "web/agent-row.tsx", export: "AgentRow" } }), (e) => e.status === 409);
  s.upsertCard({ kind: "screen", title: "Invoices", path: "/invoices" });
  assert.throws(() => s.upsertCard({ id: sc.card.id, path: "/invoices" }), (e) => e.status === 409);
  assert.equal(s.upsertCard({ id: el.card.id, status: "dropped", sections: [{ title: "Already here", body: "It is the Agent row." }] }).card.status, "dropped");
});

test("an issue card: found again by its issue, short needs, pictures of now and a sketch", () => {
  const s = fresh();
  const source = { repo: "acme/widgets", issue: 30, url: "https://github.com/acme/widgets/issues/30", milestone: "Sprint 12" };
  const a = s.upsertCard({ kind: "issue", title: "See what each agent spends", bucket: "sprint", needs: ["A spend column in the agents list"], source }).card;
  assert.equal(a.status, "open");
  const b = s.upsertCard({ kind: "issue", title: "See what each agent spends this week", bucket: "assigned", source }).card;
  assert.equal(a.id, b.id, "one card per issue");
  assert.deepEqual(b.needs, ["A spend column in the agents list"], "needs stay when not rewritten");
  assert.throws(() => s.upsertCard({ kind: "issue", title: "x".repeat(91), source }), /longer than 90/);
  assert.throws(() => s.upsertCard({ id: a.id, needs: [] }), /1 to 3/);
  assert.throws(() => s.upsertCard({ id: a.id, needs: ["a", "b", "c", "d"] }), /at most 3/);
  assert.throws(() => s.upsertCard({ id: a.id, needs: ["n".repeat(201)] }), /longer than 200/);
  assert.throws(() => s.upsertCard({ id: a.id, bucket: "later" }), /bucket must be/);
  assert.throws(() => s.upsertCard({ id: a.id, status: "handled" }), /status must be one of open, archived/);
  const change = s.upsertCard({ kind: "change", title: "One", source: { repo: "acme/widgets", pr: 9 } }).card;
  assert.throws(() => s.upsertCard({ id: change.id, needs: ["x"] }), /belongs to an issue/);
  const shot = s.addAsset({ kind: "screen", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset;
  assert.throws(() => s.upsertCard({ id: a.id, sketches: [shot.id, shot.id, shot.id] }), /at most 2 sketches/);
  const drawn = s.upsertCard({ id: a.id, screens: [{ asset: shot.id, caption: "Agents list today", source: "instance" }], sketches: [{ asset: shot.id, caption: "A spend column" }], style: "acme/widgets@abc1234" }).card;
  assert.equal(drawn.sketches[0].caption, "A spend column");
  const row = s.listCards({ kind: "issue" })[0];
  assert.deepEqual([row.bucket, row.needs.length, row.sketches], ["assigned", 1, 1]);
});

test("an issue a request was sent to developers from, or to, is designed; the request links the issue's card", () => {
  const s = fresh();
  const from = s.upsertCard({ kind: "issue", title: "See spend", bucket: "sprint", needs: ["A spend column"], source: { repo: "acme/widgets", issue: 30, url: "https://github.com/acme/widgets/issues/30" } }).card;
  const sent = s.upsertCard({ kind: "issue", title: "Build the spend column", bucket: "assigned", needs: ["A spend column"], source: { repo: "acme/widgets", issue: 31, url: "https://github.com/Acme/Widgets/issues/31" } }).card;
  const r = s.createRequest(alice, { title: "Spend column", problem: "No spend.", type: "feature", from: from.id }).card;
  s.upsertCard({ id: r.id, status: "spec", spec: { issue_url: "https://github.com/acme/widgets/issues/31#issuecomment-5" } });
  assert.equal(s.getCard(from.id).designed, null, "not before it is sent");
  assert.equal(s.getCard(r.id).sent_card, sent.id, "the request links the issue its spec went to");
  s.upsertCard({ id: r.id, status: "handed-off" });
  const rows = Object.fromEntries(s.listCards({ kind: "issue" }).map((c) => [c.id, c.designed?.card]));
  assert.deepEqual(rows, { [from.id]: r.id, [sent.id]: r.id }, "both the issue it came from and the one it went to");
  assert.equal(s.getCard(sent.id).designed.title, "Spend column");
});

test("a change whose pull request builds a sent request's issue, or got its spec, links the request", () => {
  let t = 0;
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(Date.UTC(2026, 10, 1) + ++t * 3600e3).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const pr = (n, url = true) => s.upsertCard({ kind: "change", title: `PR ${n}`, source: { repo: "acme/widgets", pr: n, ...(url ? { url: `https://github.com/acme/widgets/pull/${n}` } : {}) } }).card;
  const viaIssue = pr(40), direct = pr(41), noUrl = pr(43, false), other = pr(42);
  const sent = (title, spec) => { const r = s.createRequest(alice, { title, problem: "Why.", type: "feature" }).card; return s.upsertCard({ id: r.id, status: "handed-off", spec }).card; };
  const r = sent("Spend column", { issue_url: "https://github.com/acme/widgets/issues/31" });
  assert.equal(s.getCard(viaIssue.id).builds, null, "not before the Desk read the issue's pull requests");
  s.putGithub([{ key: "acme/widgets#31", kind: "issue", title: "Spend column", state: "open", linked: [
    { title: "Build it", url: "https://github.com/Acme/Widgets/pull/40", state: "open" }, { title: "No url", url: "https://github.com/acme/widgets/pull/43", state: "open" }] }]);
  assert.deepEqual(s.getCard(viaIssue.id).builds, { card: r.id, title: "Spend column", at: s.getCard(r.id).updated, url: "https://github.com/acme/widgets/issues/31" },
    "a pull request listed under the spec's issue; builds names the issue the spec went to");
  assert.equal(s.getCard(noUrl.id).builds?.card, r.id, "a change with no source url is matched by its repo and number");
  const r2 = sent("Tidy", { pr_url: "https://github.com/acme/widgets/pull/41" });
  assert.equal(s.getCard(direct.id).builds.url, "https://github.com/acme/widgets/pull/41", "the spec's own pull request, named by its url");
  const r3 = sent("Spend column again", { issue_url: "https://github.com/acme/widgets/issues/31" });
  const rows = Object.fromEntries(s.listCards({ kind: "change" }).map((c) => [c.id, c.builds?.card || null]));
  assert.deepEqual(rows, { [viaIssue.id]: r3.id, [direct.id]: r2.id, [noUrl.id]: r3.id, [other.id]: null }, "the newest send wins; an unrelated pull request links nothing");
});

test("Draw it: a designer or a PM queues a drawing of an issue, once", () => {
  const s = fresh();
  const pm = { email: "pat@example.com", role: "pm" };
  assert.equal(can("pm", "draw"), true);
  assert.equal(can("developer", "draw"), true);
  assert.equal(can("guest", "draw"), false);
  const c = s.upsertCard({ kind: "issue", title: "A calmer empty Home", bucket: "label", needs: ["An empty state on Home"], source: { repo: "acme/widgets", issue: 31 } }).card;
  const { inbox: item } = s.act(c.id, pm, "draw", "try a checklist");
  assert.equal(item.kind, "draw");
  assert.throws(() => s.act(c.id, pm, "draw"), /already working/);
  assert.throws(() => s.act(c.id, pm, "explore"), /can only be drawn/);
  assert.deepEqual(s.getCard(c.id).waiting.map((w) => w.kind), ["draw"]);
  s.upsertCard({ id: c.id, status: "archived" });
  const d = s.upsertCard({ kind: "issue", title: "Closed one", bucket: "next", source: { repo: "acme/widgets", issue: 32 }, status: "archived" }).card;
  assert.throws(() => s.act(d.id, pm, "draw"), /closed/);
});

test("an issue's drawing record is a whole-number failure count and a short note", () => {
  const s = fresh();
  const c = s.upsertCard({ kind: "issue", title: "One", bucket: "sprint", source: { repo: "acme/widgets", issue: 50 } }).card;
  assert.deepEqual(s.upsertCard({ id: c.id, draw: { failures: 1, note: "The instance did not start." } }).card.draw, { failures: 1, note: "The instance did not start." });
  assert.throws(() => s.upsertCard({ id: c.id, draw: { failures: "1" } }), /whole number/);
  assert.throws(() => s.upsertCard({ id: c.id, draw: { failures: 1.5 } }), /whole number/);
  assert.throws(() => s.upsertCard({ id: c.id, draw: { note: "n".repeat(301) } }), /longer than 300/);
  assert.throws(() => s.upsertCard({ id: c.id, draw: [] }), /must be an object/);
  const change = s.upsertCard({ kind: "change", title: "Two", source: { repo: "acme/widgets", pr: 9 } }).card;
  assert.throws(() => s.upsertCard({ id: change.id, draw: { failures: 0 } }), /belongs to an issue/);
});

test("decisions: a number, who decided and where with a link; a store from before upgrades", () => {
  const s = fresh();
  const c = s.createRequest(alice, { title: "Prices", problem: "Show prices" }).card;
  const t = s.openThread(c.id, bob, { kind: "comment", text: "We always show prices with tax." }).thread;
  assert.throws(() => s.addDecision({ concepts: ["prices"], text: "Prices show tax", origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/4" } }), /who decided/);
  assert.throws(() => s.addDecision({ concepts: ["prices"], text: "Prices show tax", author: {}, origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/4" } }), /name, login or email/);
  assert.throws(() => s.addDecision({ concepts: ["prices"], text: "Prices show tax", author: { login: "dana" }, origin: { kind: "pr" } }), /needs a link/);
  assert.throws(() => s.addDecision({ concepts: ["prices"], text: "Prices show tax", author: { login: "dana" }, origin: { kind: "fax", url: "https://x.example" } }), /origin.kind/);
  const d = s.addDecision({ concepts: ["Prices"], text: "Prices show tax", author: { email: bob.email }, origin: { kind: "desk", card: c.id, thread: t.id, message: 0 } }).decision;
  assert.equal(d.id, "D-1");
  assert.equal(d.status, "active");
  assert.equal(s.db.threads[t.id].messages[0].decision, "D-1", "the comment shows its number");
  assert.equal(s.addDecision({ concepts: ["chat"], text: "Dark mode first", author: { name: "Op" }, origin: { kind: "chat" } }).decision.id, "D-2");
  // A record written before decisions named their author and origin.
  s.db.decisions["D-0"] = { id: "D-0", concepts: ["x"], text: "Old", why: "", source: { label: "PR #1", url: "https://x.example/1", card: null }, at: "2026-01-01T00:00:00Z", recorded: "2026-01-01T00:00:00Z" };
  s.save();
  const again = new Store(s.dir);
  assert.deepEqual([again.db.decisions["D-0"].status, again.db.decisions["D-0"].origin.kind, again.db.decisions["D-0"].author, again.db.decisions["D-0"].source], ["active", "other", null, undefined]);
  assert.deepEqual(again.listDecisions({ q: "d-1" }).map((x) => x.id), ["D-1"]);
});

test("decisions: a designer asks to record a person's comment, once", () => {
  const s = fresh();
  const c = s.createRequest(alice, { title: "Prices", problem: "Show prices" }).card;
  const t = s.openThread(c.id, bob, { kind: "comment", text: "We always show prices with tax." }).thread;
  s.answer(t.id, "Noted.");
  assert.equal(can("designer", "decide"), true);
  assert.equal(can("pm", "decide"), false);
  assert.throws(() => s.proposeDecision(t.id, alice, { message: 1 }), /does not decide/);
  assert.throws(() => s.proposeDecision(t.id, alice, { message: 5 }), /pick a message/);
  const { inbox: item } = s.proposeDecision(t.id, alice, { message: 0, note: "Prices always include tax" });
  assert.deepEqual([item.kind, item.thread, item.message, item.note], ["decision", t.id, 0, "Prices always include tax"]);
  assert.throws(() => s.proposeDecision(t.id, alice, { message: 0 }), /already working/);
  assert.ok(inbox(s).open.some((i) => i.kind === "decision"));
});

test("decisions: conflicts warn, wait for a designer and gate approval; revoking clears them", () => {
  const s = fresh();
  const d = s.addDecision({ concepts: ["prices"], text: "Prices show tax", author: { login: "dana" }, origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/4" } }).decision;
  const c = s.createRequest(alice, { title: "Prices", problem: "Show prices" }).card;
  assert.throws(() => s.upsertCard({ id: c.id, conflicts: [{ decision: "D-9", why: "x" }] }), /no decision D-9/);
  assert.throws(() => s.upsertCard({ id: c.id, conflicts: [{ decision: d.id, why: "x", variant: "v9" }] }), /no option v9/);
  s.upsertCard({ id: c.id, conflicts: [{ decision: d.id, why: "It drops the tax." }], decisions: [d.id] });
  assert.equal(s.listCards().find((x) => x.id === c.id).conflicts, 1);
  assert.deepEqual(s.listCards().find((x) => x.id === c.id).against, [d.id], "the list's red ! names it");
  assert.deepEqual(s.attentionOf(s.card(c.id)).reasons, [`Goes against ${d.id}`]);
  assert.equal(s.getCard(c.id).conflicts[0].text, "Prices show tax");
  assert.deepEqual(s.getDecision(d.id).refs.map((r) => [r.id, r.how]), [[c.id, "conflicts"]]);
  const later = s.addDecision({ concepts: ["prices"], text: "Net prices", author: { login: "bob" }, origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/5" }, conflicts: [{ decision: d.id, why: "No tax." }] }).decision;
  assert.equal(s.listDecisions().find((x) => x.id === later.id).conflicts[0].status, "active");
  s.db.cards[c.id].status = "feedback";
  assert.throws(() => s.act(c.id, alice, "approve"), (e) => e instanceof DeskError && e.status === 409 && /goes against D-1/.test(e.message));
  assert.deepEqual(s.act(c.id, alice, "approve", "", { overrule: true }).card.overruled.decisions, [d.id]);
  assert.throws(() => s.revokeDecision(d.id, alice, { reason: "" }), /reason is empty/);
  s.revokeDecision(d.id, alice, { reason: "We show net prices now." });
  assert.deepEqual([s.db.decisions[d.id].status, s.db.decisions[d.id].revoked.by.email], ["revoked", alice.email]);
  assert.equal(s.listCards().find((x) => x.id === c.id).conflicts, 0);
  assert.deepEqual(s.listCards().find((x) => x.id === c.id).against, []);
  assert.equal(s.listDecisions().find((x) => x.id === later.id).conflicts[0].status, "revoked", "a revoked one no longer warns in the list");
  assert.equal(s.db.decisions[later.id].conflicts[0].status, undefined, "the list does not write into the store");
  assert.equal(s.getCard(c.id).conflicts[0].status, "revoked");
  assert.throws(() => s.upsertCard({ id: c.id, conflicts: [{ decision: d.id, why: "x" }] }), /no longer in force/);
  assert.throws(() => s.revokeDecision(d.id, alice, { reason: "again" }), /already revoked/);
  for (const i of Object.values(s.db.inbox).filter((x) => x.kind === "handoff")) { s.claim(i.id, "run-1"); s.done(i.id, "run-1"); }
  assert.deepEqual(s.act(c.id, alice, "approve", "", { overrule: false }).card.overruled, undefined, "an approve with no conflict in force clears the earlier overrule");
  s.restoreDecision(d.id, alice);
  assert.deepEqual([s.db.decisions[d.id].status, s.db.decisions[d.id].history.map((h) => h.what)], ["active", ["revoked", "restored"]]);
});

test("decisions: a new one replaces an earlier one; the agent revokes in a person's name", () => {
  const s = fresh();
  const pr = { kind: "pr", url: "https://github.com/acme/widgets/pull/4" };
  const a = s.addDecision({ concepts: ["limits"], text: "Limits reset weekly", author: { login: "dana" }, origin: pr }).decision;
  const b = s.addDecision({ concepts: ["limits"], text: "Limits reset daily", author: { name: "Carla" }, origin: { kind: "slack", url: "https://acme.slack.com/archives/C0123ABCD/p1" }, replaces: [a.id] }).decision;
  assert.deepEqual([s.db.decisions[a.id].status, s.db.decisions[a.id].revoked.replaced_by], ["revoked", b.id]);
  assert.deepEqual(s.getDecision(a.id).refs.map((r) => [r.id, r.how]), [[b.id, "replaces"]]);
  assert.throws(() => s.addDecision({ concepts: ["limits"], text: "x", author: { name: "C" }, origin: pr, replaces: [a.id] }), /no longer in force/);
  s.restoreDecision(a.id, alice);
  assert.deepEqual([s.db.decisions[a.id].status, s.db.decisions[b.id].replaces], ["active", undefined], "a restored decision is no longer one another replaces");
  s.revokeDecision(a.id, alice, { reason: "Replaced after all", replaced_by: b.id });
  assert.throws(() => s.revokeDecision(b.id, { agent: true }, { reason: "Dropped", by: { name: "Carla" } }), /names its origin/);
  s.revokeDecision(b.id, { agent: true }, { reason: "Dropped in the call", by: { name: "Carla" }, origin: { kind: "chat" } });
  assert.deepEqual([s.db.decisions[b.id].revoked.by.name, s.listDecisions({ state: "revoked" }).length], ["Carla", 2]);
});

test("a decision written by hand without concepts, text or date still lists and opens", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-store-"));
  const db = { decisions: { "D-1": { id: "D-1", concept: "Prices", text: "Prices show tax", status: "active", recorded: "2026-11-01T10:00:00Z" }, "D-2": { id: "D-2", status: "active" } } };
  writeFileSync(join(dir, "db.json"), JSON.stringify(db));
  const s = new Store(dir);
  assert.deepEqual(s.listDecisions().map((d) => [d.id, d.concepts, d.text, d.at]), [["D-1", ["prices"], "Prices show tax", "2026-11-01T10:00:00Z"], ["D-2", [], "", ""]]);
  assert.deepEqual(s.listDecisions({ concept: "prices" }).map((d) => d.id), ["D-1"], "a concept search skips the one without concepts");
  assert.equal(s.getDecision("D-2").decision.id, "D-2");
});

test("a private ask: only its author and the agent see it; it sits on no card, nobody else reads or acts on it", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "change", title: "Spend in the list", source: { repo: "acme/widgets", pr: 7 } });
  const before = s.card(card.id).updated;
  const { thread, inbox: item } = s.openPrivate(alice, { text: "Explain this simply", starter: "explain", context: { card: card.id, label: "C-1 Spend in the list" } });
  assert.deepEqual([thread.owner, thread.needs_agent, thread.starter, thread.context.card, item.kind], ["alice@example.com", true, "explain", card.id, "question"]);
  assert.equal(inbox(s).open.find((i) => i.id === item.id).private, true, "the agent's item says it is private");
  assert.equal(s.claim(item.id, "run-1").thread.id, thread.id, "the agent's claim hands it the thread");
  assert.equal(s.card(card.id).updated, before, "a private ask does not move the card's last-changed time");
  for (const viewer of ["alice@example.com", "bob@example.com", undefined]) assert.equal(s.getCard(card.id, { viewer }).threads.length, 0, "on no card's list");
  assert.equal(s.listCards({ viewer: "bob@example.com" })[0].open_threads, 0);
  assert.deepEqual(s.privateAsks(alice).map((t) => t.id), [thread.id]);
  assert.deepEqual(s.privateAsks(bob), []);
  assert.deepEqual(s.privateAsks({ agent: true }), []);
  for (const act of [() => s.reply(thread.id, bob, "hi"), () => s.resolve(thread.id, bob), () => s.reopenThread(thread.id, bob), () => s.proposeDecision(thread.id, bob, { message: 0 })])
    assert.throws(act, /no thread/);
  assert.throws(() => s.proposeDecision(thread.id, alice, { message: 0 }), /not recorded as a decision/);
  assert.throws(() => s.openPrivate({ agent: true }, { text: "x" }), /person's own/);
  assert.throws(() => s.openThread(card.id, alice, { kind: "private", text: "x" }), /openPrivate/);
  assert.throws(() => s.openPrivate(alice, { text: "x", starter: "hack" }), /starter/);
  const page = s.openPrivate(alice, { text: "What is this page for?", context: { page: "product", label: "Product page" } }).thread;
  assert.deepEqual([page.card, page.context.page], [null, "product"]);
  assert.equal(s.openPrivate(alice, { text: "x", context: { page: "nowhere" } }).thread.context.page, "guide");
  s.answer(thread.id, "Think of it as a receipt.");
  assert.equal(s.card(card.id).updated, before);
  assert.throws(() => s.answer(thread.id, "x", { shots: [{ asset: "A-1", stage: "after" }] }), /answered in words/);
  s.answer(page.id, "It lists the product's screens and parts.");
  assert.equal(s.reply(page.id, alice, "And why?").inbox.kind, "question", "a follow-up goes back to the agent");
});

test("a private ask keeps exactly what was open: the option, its state and part, or the page and its filter; the agent's item carries it", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "request", title: "Limits" });
  s.card(card.id).variants = [{ id: "v1", name: "Rows", states: [{ id: "s1", part: "Meter", name: "Stopped" }] }];
  const ctx = { card: card.id, variant: "v1", state: "s1", part: { selector: ".meter", label: "Limit meter" }, label: "C-1 Limits · Rows · Stopped (C-1.1)" };
  const { thread, inbox: item } = s.openPrivate(alice, { text: "Why red?", context: ctx });
  assert.deepEqual(thread.context, { card: card.id, page: null, variant: "v1", state: "s1", part: { selector: ".meter", label: "Limit meter" }, label: ctx.label });
  assert.deepEqual(inbox(s).open.find((i) => i.id === item.id).context, thread.context, "the agent sees the context with the item");
  assert.deepEqual(s.openPrivate(alice, { text: "x", context: { card: card.id, variant: "v9", state: "s1" } }).thread.context, { card: card.id, page: null, label: "" }, "an unknown option or state is dropped");
  assert.equal(s.openPrivate(alice, { text: "x", context: { page: "product", filter: "elements" } }).thread.context.filter, "elements");
  const onDesigns = s.openPrivate(alice, { text: "x", context: { page: "designs", filter: "done" } }).thread.context;
  assert.deepEqual([onDesigns.page, onDesigns.filter], ["designs", "done"], "a private ask from the Designs list keeps its page");
  assert.throws(() => s.openPrivate(alice, { text: "x", context: { decision: "D-9" } }), /no decision/);
});

test("GitHub on the Desk: the agent keeps an issue with its comments, a new comment is fresh, a private ask carries the item's refs", () => {
  const s = fresh();
  const { card } = s.upsertCard({ kind: "change", title: "Limits", source: { repo: "Acme/Widgets", pr: 7, url: "https://github.com/acme/widgets/pull/7" } });
  assert.deepEqual(s.githubRefs(), ["acme/widgets#7"]);
  const rec = { key: "acme/widgets#7", kind: "pr", title: "Limits", state: "open", url: "https://github.com/acme/widgets/pull/7", body: "b", comments: [{ author: "pat", at: "2026-11-01T10:00:00Z", body: "Looks good" }] };
  assert.deepEqual(s.putGithub([rec]).fresh, [], "a first read has nothing new");
  const second = s.putGithub([{ ...rec, comments: [...rec.comments, { author: "lee", at: "2026-11-02T10:00:00Z", body: "Make the bar red?", url: "javascript:alert(1)" }] }]);
  assert.deepEqual(second.fresh.map((x) => [x.key, x.cards, x.comments.map((m) => m.author)]), [["acme/widgets#7", [card.id], ["lee"]]]);
  assert.equal(s.github(["ACME/widgets#7"])[0].comments[1].url, "", "only GitHub links are kept");
  assert.throws(() => s.putGithub([{ ...rec, key: "not a key" }]), /owner\/repo#number/);
  assert.deepEqual(s.openPrivate(alice, { text: "Why?", context: { card: card.id } }).thread.context.refs, ["acme/widgets#7"]);
});

test("GitHub on the Desk: the watch run marks an issue's design comments, the mark survives a read, a pull request's are not marked", () => {
  const s = fresh();
  const issue = { key: "acme/widgets#12", kind: "issue", title: "Filters", comments: [{ author: "bob", at: "2026-11-01T10:00:00Z", body: "Chips above the table?" }, { author: "ci", at: "2026-11-02T10:00:00Z", body: "Build passed." }] };
  s.putGithub([issue, { key: "acme/widgets#7", kind: "pr", title: "Limits", comments: [{ author: "pat", at: "2026-11-01T10:00:00Z", body: "LGTM" }] }]);
  assert.deepEqual(s.markGithub("Acme/Widgets#12", { at: "2026-11-01T10:00:00Z", author: "bob" }).comment, { at: "2026-11-01T10:00:00Z", author: "bob", design: true });
  s.putGithub([{ ...issue, comments: [...issue.comments, { author: "dave", at: "2026-11-03T10:00:00Z", body: "The empty state?" }] }]);
  assert.deepEqual(s.github(["acme/widgets#12"])[0].comments.map((m) => [m.author, Boolean(m.design)]), [["bob", true], ["ci", false], ["dave", false]], "a new read keeps the mark");
  s.markGithub("acme/widgets#12", { at: "2026-11-01T10:00:00Z", author: "bob", design: false });
  assert.equal(s.github(["acme/widgets#12"])[0].comments[0].design, undefined, "design: false takes the mark back");
  assert.throws(() => s.markGithub("acme/widgets#7", { at: "2026-11-01T10:00:00Z", author: "pat" }), /pull request/);
  assert.throws(() => s.markGithub("acme/widgets#12", { at: "2026-11-09T10:00:00Z", author: "bob" }), /no comment by bob/);
  assert.throws(() => s.markGithub("acme/widgets#99", { at: "x", author: "y" }), /no copy/);
});

test("a request's author, or one who may close it, renames it; a run's upsert keeps the name", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { title: "give me some prototypes", problem: "Try it" });
  assert.throws(() => s.renameRequest(card.id, alice, "Calmer header"), /Only the person who filed it/, "neither its author nor allowed to close it");
  assert.equal(s.renameRequest(card.id, alice, "Calmer header", { manage: true }).card.title, "Calmer header");
  assert.equal(s.renameRequest(card.id, bob, "  A calmer header  ").card.title, "A calmer header", "its author may");
  assert.throws(() => s.renameRequest(card.id, bob, " "), /title is empty/);
  assert.equal(s.upsertCard({ id: card.id, title: "Agent's name", summary: "s" }).card.title, "A calmer header", "a run's upsert leaves it");
  const { card: ch } = s.upsertCard({ kind: "change", title: "A change", source: { repo: "acme/widgets", pr: 9 } });
  assert.throws(() => s.renameRequest(ch.id, bob, "x", { manage: true }), /only a request/);
});

test("a person's own option: their pictures as an option once the request is checked, nothing queued, its author kept through a run's upsert", () => {
  const s = fresh();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const { card } = s.createRequest(alice, { title: "Lukas test", problem: "Try it", options: 0 });
  assert.throws(() => s.addOwnOption(card.id, alice, { images: [{ contentType: "image/png", data: png }] }), /checked the request/, "triage comes first");
  s.upsertCard({ id: card.id, triage: { verdict: "design" } });
  assert.doesNotThrow(() => s.act(card.id, alice, "add-option", "One more, drawn"), "a request that asked for none takes a drawn first option too");
  assert.throws(() => s.addOwnOption(card.id, alice, { images: [] }), /at least one picture/);
  assert.throws(() => s.addOwnOption(card.id, alice, { images: [{ contentType: "text/html", data: png }] }), /PNG, JPEG or WebP/);
  const open = inbox(s).open.length;
  const { card: c } = s.addOwnOption(card.id, alice, { name: "My <sketch>", note: "Filters on top", images: [{ contentType: "image/png", data: png }] });
  const v = c.variants[0];
  assert.deepEqual([v.id, v.name, v.fidelity, v.rationale, v.version, v.by.email, c.status, c.team_feedback.state], ["v1", "My <sketch>", "picture", "Filters on top", 1, alice.email, "variants", "waiting"], "ready, waiting for a person to ask the team");
  assert.equal(inbox(s).open.length, open, "nothing is queued: Design Desk draws nothing");
  const page = readFileSync(join(s.assetDir, s.db.assets[v.asset].file), "utf8");
  assert.match(page, /<title>My &lt;sketch&gt;<\/title>/, "the name is escaped on its page");
  assert.match(page, /<img alt="Picture 1" src="data:image\/png;base64,/);
  const { card: after } = s.upsertCard({ id: card.id, variants: [{ id: "v1", name: v.name, asset: v.asset, fidelity: "picture", version: 1 }] });
  assert.deepEqual([after.variants[0].fidelity, after.variants[0].by?.email], ["picture", alice.email], "a run's upsert keeps what it is and who added it");
});

test("GitHub on the Desk: every new comment is fresh even past the kept 60, a long title is cut, the pre-flight's refs file follows", () => {
  const s = fresh();
  s.upsertCard({ kind: "change", title: "Limits", source: { repo: "acme/widgets", pr: 7 } });
  const at = (i) => new Date(Date.UTC(2026, 10, 1) + i * 60000).toISOString();
  const rec = { key: "acme/widgets#7", kind: "pr", title: "x".repeat(500), comments: [{ author: "a", at: at(0), body: "first" }] };
  s.putGithub([rec]);
  assert.equal(s.github(["acme/widgets#7"])[0].title.length, 200, "a long title is cut, not refused");
  const many = Array.from({ length: 70 }, (_, i) => ({ author: "b", at: at(i + 1), body: `c${i}` }));
  const { fresh: got } = s.putGithub([{ ...rec, comments: [...rec.comments, ...many], updated: at(71) }]);
  assert.equal(got[0].comments.length, 70, "all 70 new comments are fresh");
  assert.equal(s.github(["acme/widgets#7"])[0].comments.length, 60, "the copy keeps the newest 60");
  assert.equal(s.putGithub([{ ...rec, comments: [...rec.comments, ...many], updated: at(71) }]).fresh.length, 0, "a read with nothing new is not fresh, the cut ones included");
  const refs = JSON.parse(readFileSync(join(s.dir, "github-refs.json"), "utf8")).refs;
  assert.deepEqual(refs, [{ key: "acme/widgets#7", updated: at(71), tries: 0 }]);
});

// One more option, three ways of a part, and an option's tab closed (docs/requests.md → Variants).
const withOptions = () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Filters are hard to find." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "triaged"); }
  const page = (t) => s.addAsset({ kind: "variant", name: t, contentType: "text/html", data: `<p>${t}</p>`, encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: [] }, variants: [{ id: "v1", name: "Table", asset: page("A") }, { id: "v2", name: "Cards", asset: page("B") }] });
  const finish = () => { for (const i of Object.values(s.db.inbox)) if (i.state !== "done") { s.claim(i.id, "run-2"); s.done(i.id, "run-2", "done"); } };
  return { s, id: card.id, page, finish };
};

test("add-option: one explore item with the person's words and the option it starts from", () => {
  const { s, id } = withOptions();
  assert.throws(() => s.act(id, alice, "add-option", " "), /what the new option should look like/);
  assert.throws(() => s.act(id, alice, "add-option", "Chips", { variant: "v9" }), /not on this request/);
  const { inbox: item } = s.act(id, bob, "add-option", "Chips on top", { variant: "v1" });
  assert.deepEqual([item.kind, item.scope, item.variant, item.note], ["explore", "add", "v1", "Chips on top"]);
  assert.throws(() => s.act(id, alice, "add-option", "Again"), /already working/);
});

test("alternatives and pick-alternative: three ways of a part, the one picked is the next version", () => {
  const { s, id, page, finish } = withOptions();
  assert.throws(() => s.act(id, alice, "alternatives", "Chips", { variant: "v1" }), /Select the part/);
  assert.throws(() => s.act(id, alice, "alternatives", " ", { variant: "v1", part: { label: "Filters" } }), /how you picture/);
  const { inbox: item } = s.act(id, alice, "alternatives", "Chips", { variant: "v1", part: { selector: "#f", label: "Filters" } });
  assert.deepEqual([item.kind, item.scope, item.variant, item.version, item.part.label], ["revise", "alternatives", "v1", 1, "Filters"]);
  const [x, y] = [page("X"), page("Y")];
  const v1 = s.getCard(id).variants[0];
  s.upsertCard({ id, variants: [{ id: "v1", version: 1, name: "Table", asset: v1.asset, alternatives: [{ id: "a", name: "Chips", part: "Filters", asset: x }, { id: "b", name: "Menu", part: "Filters", asset: y }] }, { id: "v2", version: 1, name: "Cards", asset: s.getCard(id).variants[1].asset }] });
  assert.equal(s.getCard(id).variants[0].alternatives.length, 2);
  assert.throws(() => s.act(id, alice, "pick-alternative", "a", { variant: "v1" }), /already working/);
  finish();
  assert.throws(() => s.act(id, alice, "pick-alternative", "z", { variant: "v1" }), /not drawn/);
  s.act(id, alice, "pick-alternative", "b", { variant: "v1" });
  const after = s.getCard(id).variants[0];
  assert.deepEqual([after.version, after.asset, after.history[0].asset, after.alternatives.length], [2, y, v1.asset, 0]);
  assert.equal(Object.values(s.db.inbox).some((i) => i.kind === "states" && i.state !== "done"), false, "an option without states has none to draw again");
});

test("drop-option: a designer closes an option's tab; the last, approved and presented ones stay, a stale run cannot bring it back", () => {
  const { s, id } = withOptions();
  assert.throws(() => s.act(id, alice, "drop-option", "", { variant: "v9" }), /not on this request/);
  s.queueForCall(id, alice, "", "v2");
  assert.throws(() => s.act(id, alice, "drop-option", "", { variant: "v2" }), /on the presentation/);
  // A presentation the team already saw keeps its option too.
  s.db.cards[id].agenda.status = "presented";
  assert.throws(() => s.act(id, alice, "drop-option", "", { variant: "v2" }), /presentation the team saw/);
  const read = s.getCard(id).variants;
  s.act(id, alice, "drop-option", "", { variant: "v1" });
  assert.deepEqual(s.getCard(id).variants.map((v) => v.id), ["v2"]);
  assert.equal(s.getCard(id).dropped_options[0].id, "v1");
  assert.throws(() => s.act(id, alice, "drop-option", "", { variant: "v2" }), /only option/);
  assert.throws(() => s.upsertCard({ id, variants: read.map((v) => ({ id: v.id, version: v.version, name: v.name, asset: v.asset })) }), /was removed/);
});

test("the new actions' roles: drawing is a designer's, a PM's or a developer's, removing an option a designer's", () => {
  for (const a of ["explore", "revise"]) { assert.equal(can("developer", a), true, a); assert.equal(can("guest", a), false, a); }
  assert.equal(can("designer", "choose"), true);
  assert.equal(can("developer", "choose"), false);
});

test("an option's elements: listed, their states under them, then into the design catalog once approved", () => {
  const s = fresh();
  const html = (t) => s.addAsset({ kind: "variant", contentType: "text/html", data: Buffer.from(`<p>${t}</p>`).toString("base64") }).asset.id;
  const pic = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const a = html("A"), b = html("B"), near = html("near"), hover = html("hover");
  const product = s.upsertCard({ kind: "element", title: "Provider card", group: "Settings", source: { repo: "acme/widgets", file: "src/Provider.tsx", export: "Provider" }, status: "current" }).card;
  const { card } = s.createRequest(alice, { title: "Daily limits", problem: "People do not see the limit." });
  const v = (x = {}) => ({ id: "v1", name: "Limits", asset: a, ...x });
  // What an element must say, and what it may point at.
  assert.throws(() => s.upsertCard({ id: card.id, variants: [v({ elements: [{ id: "p", name: "Card", change: "moved", selector: "#p" }] })] }), /new or changed/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [v({ elements: [{ id: "p", name: "Card", change: "new" }] })] }), /needs a picture of it/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [v({ elements: [{ id: "p", name: "Card", change: "changed", selector: "#p", element: card.id }] })] }), /not an element of the product/);
  assert.throws(() => s.upsertCard({ id: card.id, variants: [v({ elements: [{ id: "p", name: "Card", change: "new", shot: a }] })] }), /shot must be an uploaded picture/);
  s.upsertCard({ id: card.id, triage: { verdict: "design" }, status: "feedback", variants: [v({ elements: [
    { id: "provider", name: "Provider card", change: "changed", how: "Shows the limit.", selector: "#provider", element: product.id },
    { id: "banner", name: "Limit banner", change: "new", shot: pic } ],
    states: [{ id: "near", name: "Close to the limit", part: "Provider card", element: "provider", asset: near, selector: "#provider" }, { id: "hover", name: "Hovered", part: "Raise button", asset: hover, selector: "#raise" }] }),
    { id: "v2", name: "Rows", asset: b }] });
  // Leaving elements out keeps them; a state's part names a derived element when no listed one has it.
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Limits", asset: a }, { id: "v2", version: 1, name: "Rows", asset: b }] });
  const opt = s.getCard(card.id).variants[0];
  assert.deepEqual(opt.elements.map((e) => e.id), ["provider", "banner"]);
  assert.deepEqual(elementsOf(opt).map((e) => [e.key, e.states.map((x) => x.id)]), [["provider", ["near"]], ["banner", []], ["part-raise-button", ["hover"]]]);
  // Draw every state of one element: an element the option does not have is refused before anything is queued.
  assert.throws(() => s.act(card.id, alice, "states", "", { variant: "v1", element: "nope", part: { label: "Nope" } }), /not in this design option/);
  const { inbox: item } = s.act(card.id, alice, "states", "", { variant: "v1", element: "banner", part: { label: "Limit banner", selector: "#banner" } });
  assert.equal(item.element, "banner");
  assert.equal(inbox(s).open.find((x) => x.id === item.id).element, "banner", "the inbox file names the element");
  s.claim(item.id, "run-1"); s.done(item.id, "run-1", "drew");
  // Not before approval; then one element at a time, marked as from the design; pressed again, the same card.
  assert.throws(() => s.addDesignToCatalog(card.id, alice, "provider"), /Approve a design option first/);
  s.act(card.id, alice, "approve", "v1");
  s.upsertCard({ id: card.id, status: "handed-off" });
  assert.throws(() => s.addDesignToCatalog(card.id, bob, "nope"), /not in Limits/);
  const added = ["provider", "banner"].map((k) => s.addDesignToCatalog(card.id, bob, k).added);
  const cat = added.map((id) => s.getCard(id));
  assert.deepEqual(cat.map((x) => [x.title, x.design.change, x.design.of, x.design_states.length]), [["Provider card", "changed", product.id, 1], ["Limit banner", "new", null, 0]]);
  assert.equal(cat[0].group, "Settings", "it sits with the product's element it changes");
  assert.deepEqual(s.getCard(card.id).in_catalog.elements, { provider: added[0], banner: added[1] }, "the raise button stays out until someone adds it");
  assert.equal(s.addDesignToCatalog(card.id, bob, "banner").added, added[1], "pressed again, it updates the same card");
  assert.throws(() => s.act(added[0], alice, "refresh"), /approved design/);
  // Sent to developers, an element still gets its states drawn, and its catalog card follows them.
  const { inbox: again } = s.act(card.id, bob, "states", "", { variant: "v1", element: "banner", part: { label: "Limit banner" } });
  assert.equal(again.element, "banner");
  s.claim(again.id, "run-2");
  const kept = s.getCard(card.id).variants[0].states.map(({ id, name, part, asset, selector, element, version }) => ({ id, name, part, asset, selector, element, version }));
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Limits", asset: a, states: [...kept, { id: "shown", name: "Shown", part: "Limit banner", element: "banner", asset: html("banner"), selector: "#banner" }] }, { id: "v2", version: 1, name: "Rows", asset: b }] });
  s.done(again.id, "run-2", "drew");
  assert.deepEqual(s.getCard(added[1]).design_states.map((x) => x.name), ["Shown"], "the design catalog shows the states drawn since");
  assert.throws(() => s.act(card.id, bob, "revise"), /approved, so it no longer changes/, "nothing else changes it");
  // A new version of the option reaches the catalog: its card follows, and a state not drawn again says so.
  const now = s.getCard(card.id).variants;
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Limits", asset: html("A2") }, { id: "v2", version: 1, name: "Rows", asset: b }] });
  assert.deepEqual([s.getCard(added[0]).design.version, s.getCard(added[0]).design_states[0].stale], [2, true]);
  assert.equal(now[0].version, 1);
  // A part the option no longer lists leaves the catalog, its card kept and marked; back, it is current again.
  const els = s.getCard(card.id).variants[0].elements;
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 2, name: "Limits", asset: s.getCard(card.id).variants[0].asset, elements: els.filter((e) => e.id !== "banner") }, { id: "v2", version: 1, name: "Rows", asset: b }] });
  assert.deepEqual([s.getCard(added[1]).status, Boolean(s.getCard(added[1]).design.gone), s.getCard(added[0]).status], ["dropped", true, "current"]);
  assert.deepEqual(Object.keys(s.getCard(card.id).in_catalog.elements), ["provider"]);
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 2, name: "Limits", asset: s.getCard(card.id).variants[0].asset, elements: els }, { id: "v2", version: 1, name: "Rows", asset: b }] });
  assert.deepEqual([s.getCard(added[1]).status, s.getCard(added[1]).design.gone], ["current", null]);
  const listed = s.listCards({ kind: "element" }).find((x) => x.id === added[0]);
  assert.deepEqual([listed.design.card, listed.design.of], [card.id, product.id]);
  // What the watch run reads to find the design a shipped change builds.
  const [d] = s.approvedDesigns();
  assert.deepEqual([d.card, d.variant, d.elements.map((e) => [e.key, e.file])], [card.id, "v1", [["provider", "src/Provider.tsx"], ["banner", null], ["part-raise-button", null]]]);
});

test("a shipped change read against its approved design: what differs waits for a designer", () => {
  const s = fresh();
  const a = s.addAsset({ kind: "variant", contentType: "text/html", data: Buffer.from("<p>A</p>").toString("base64") }).asset.id;
  const pic = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const { card } = s.createRequest(alice, { title: "Daily limits", problem: "People do not see the limit." });
  s.upsertCard({ id: card.id, triage: { verdict: "design" }, status: "feedback", variants: [{ id: "v1", name: "Limits", asset: a }] });
  const change = { kind: "change", title: "Limits shipped", source: { repo: "acme/widgets", pr: 45 } };
  assert.throws(() => s.upsertCard({ ...change, design_check: { request: card.id, verdict: "matches" } }), /not an approved request/);
  s.act(card.id, alice, "approve", "v1");
  assert.throws(() => s.upsertCard({ ...change, design_check: { request: card.id, verdict: "differs" } }), /say what differs/);
  assert.throws(() => s.upsertCard({ ...change, design_check: { request: card.id, verdict: "differs", differences: [{ element: "Bar", what: "Grey", design: a }] } }), /must be an uploaded picture/);
  assert.throws(() => s.upsertCard({ id: card.id, design_check: { request: card.id, verdict: "matches" } }), /belongs to a change card/);
  const { card: ch } = s.upsertCard({ ...change, design_check: { request: card.id, verdict: "differs", differences: [{ element: "Bar", what: "It stays grey near the limit.", design: pic, shipped: pic }] } });
  assert.deepEqual([ch.design_check.variant, ch.design_check.differences[0].what], ["v1", "It stays grey near the limit."]);
  const row = s.listCards({ kind: "change" })[0];
  assert.deepEqual([row.design_check.verdict, row.attention.level, row.attention.reasons.includes(`Differs from the approved design ${card.id}`)], ["differs", "designer", true]);
  s.upsertCard({ id: ch.id, design_check: null });
  assert.equal(s.listCards({ kind: "change" })[0].design_check, null);
});

test("an item read against its frame in Figma: what differs, how much, each side; a request names its option", () => {
  const s = fresh();
  const pic = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const page = s.addAsset({ kind: "variant", contentType: "text/html", data: Buffer.from("<p>A</p>").toString("base64") }).asset.id;
  const frame = { url: "https://www.figma.com/design/AbC123/App?node-id=12-40", name: "Agents list", version: "9f2c", edited: "2026-11-04T10:00:00Z", shot: pic };
  const diff = { part: "Stopped dot", what: "a different red", severity: "minor", figma: "#E5484D", product: "bad #B3261E", figma_shot: pic, product_shot: pic };
  const { card: screen } = s.upsertCard({ kind: "screen", title: "Agents list", path: "/agents" });
  assert.throws(() => s.upsertCard({ id: screen.id, figma_check: { verdict: "differs", frame } }), /say what differs/);
  assert.throws(() => s.upsertCard({ id: screen.id, figma_check: { verdict: "matches", frame: { ...frame, url: "https://example.com/x" } } }), /link to the frame in Figma/);
  assert.throws(() => s.upsertCard({ id: screen.id, figma_check: { verdict: "differs", frame, differences: [{ ...diff, severity: "huge" }] } }), /severity must be major or minor/);
  assert.throws(() => s.upsertCard({ id: screen.id, figma_check: { verdict: "differs", frame, differences: [{ ...diff, figma_shot: page }] } }), /must be an uploaded picture/);
  const { card } = s.upsertCard({ id: screen.id, figma_check: { verdict: "differs", frame, product_shot: pic, differences: [diff, { ...diff, part: "Header", severity: "major" }] } });
  assert.deepEqual([card.figma_check.differences.length, card.figma_check.frame.edited, Boolean(card.figma_check.checked)], [2, "2026-11-04T10:00:00.000Z", true]);
  const row = s.listCards({ kind: "screen" })[0];
  assert.deepEqual(row.figma, { id: card.figma_check.id, verdict: "differs", count: 2, frame: "Agents list", checked: card.figma_check.checked, closed: false });
  // On a request it belongs to the option it compared.
  const { card: r } = s.createRequest(alice, { title: "Bigger send", problem: "Too small." });
  s.upsertCard({ id: r.id, variants: [{ id: "v1", name: "Calm", asset: page }] });
  assert.throws(() => s.upsertCard({ id: r.id, figma_check: { verdict: "matches", frame } }), /names the option it compares/);
  assert.equal(s.upsertCard({ id: r.id, figma_check: { verdict: "matches", frame, variant: "v1" } }).card.figma_check.variant, "v1");
  const issue = s.upsertCard({ kind: "issue", title: "Export as CSV", status: "open", bucket: "sprint", source: { repo: "acme/widgets", issue: 77 } }).card;
  assert.throws(() => s.upsertCard({ id: issue.id, figma_check: { verdict: "matches", frame } }), /belongs to a change, screen, element, request card/, "not on an issue");
  // A decision a frame goes against; null clears it.
  const { decision: dd } = s.addDecision({ concepts: ["send"], text: "The send button is always on the right.", author: { login: "alice" }, origin: { kind: "chat" } });
  assert.equal(s.setDecisionFigma(dd.id, { verdict: "differs", frame, differences: [{ ...diff, part: "Send button", severity: "major" }] }).decision.figma_check.differences[0].severity, "major");
  assert.equal(s.setDecisionFigma(dd.id, null).decision.figma_check, undefined);
  // A person takes a difference off the table: off the count too; it stays off while the frame is
  // the same, and comes back when the frame changes.
  assert.throws(() => s.dismissFigma(screen.id, alice, "Footer"), /not in the table/);
  s.dismissFigma(screen.id, alice, "Stopped dot");
  assert.deepEqual([s.listCards({ kind: "screen" })[0].figma.count, s.getCard(screen.id).figma_check.dismissed[0].by.email], [1, "alice@example.com"]);
  const check = { verdict: "differs", frame, product_shot: pic, differences: [diff, { ...diff, part: "Header", severity: "major" }] };
  assert.equal(s.upsertCard({ id: screen.id, figma_check: check }).card.figma_check.dismissed.length, 1, "the same frame: still off");
  assert.equal(s.upsertCard({ id: screen.id, figma_check: { ...check, frame: { ...frame, version: "a7b1" } } }).card.figma_check.dismissed, undefined, "an edited frame: back on");
  // Without a version nothing tells an unedited frame, so a removal never outlives the check.
  s.upsertCard({ id: screen.id, figma_check: { ...check, frame: { ...frame, version: null } } });
  s.dismissFigma(screen.id, alice, "Stopped dot");
  assert.equal(s.upsertCard({ id: screen.id, figma_check: { ...check, frame: { ...frame, version: null } } }).card.figma_check.dismissed, undefined, "no version: back on");
  assert.throws(() => s.upsertCard({ id: screen.id, figma_check: { ...check, differences: [diff, { ...diff, severity: "major" }] } }), /named twice/);
  s.upsertCard({ id: screen.id, figma_check: { ...check, frame: { ...frame, version: "a7b1" } } });
  s.dismissFigma(screen.id, alice, "Header"); s.dismissFigma(screen.id, alice, "Stopped dot");
  assert.deepEqual(s.listCards({ kind: "screen" })[0].figma, { id: s.getCard(screen.id).figma_check.id, verdict: "matches", count: 0, frame: "Agents list", checked: s.getCard(screen.id).figma_check.checked, closed: false }, "all off: it matches");
  s.dismissFigma(screen.id, alice, "Header", false);
  assert.equal(s.listCards({ kind: "screen" })[0].figma.count, 1, "brought back");
  s.upsertCard({ id: screen.id, figma_check: null });
  assert.equal(s.listCards({ kind: "screen" })[0].figma, null);
  // The search for a frame is kept, so it runs once; a question names its thread.
  assert.throws(() => s.upsertCard({ id: screen.id, figma_search: { state: "asked" } }), /names its thread/);
  assert.throws(() => s.upsertCard({ id: screen.id, figma_search: { state: "maybe" } }), /must be one of none, asked, no/);
  assert.throws(() => s.upsertCard({ id: r.id, figma_search: { state: "none" } }), /belongs to a screen or an element/);
  assert.equal(s.upsertCard({ id: screen.id, figma_search: { state: "no" } }).card.figma_search.state, "no");
  assert.equal(s.upsertCard({ id: screen.id, figma_search: null }).card.figma_search, null);
});

test("an answer says what a worked-in note goes against: a decision, the issue or a pull request, with its source", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Daily limits", problem: "People do not see the limit." });
  const d = s.addDecision({ concepts: ["limits"], text: "Limits reset weekly", author: { login: "dana" }, origin: { kind: "pr", label: "PR #40", url: "https://github.com/acme/widgets/pull/40" } }).decision;
  const { thread } = s.openThread(card.id, alice, { kind: "comment", text: "Show a daily bar." });
  assert.throws(() => s.answer(thread.id, "Done.", { warns: [{ what: "Weekly limits", source: { kind: "decision", ref: "D-99" } }] }), /no decision D-99/);
  assert.throws(() => s.answer(thread.id, "Done.", { warns: [{ what: "The issue", source: { kind: "issue", url: "javascript:alert(1)" } }] }), /http\(s\) link/);
  assert.throws(() => s.answer(thread.id, "Done.", { warns: [{ what: "X", source: { kind: "slack" } }] }), /decision, issue or pr/);
  s.answer(thread.id, "Done: a daily bar.", { warns: [
    { what: "Limits reset weekly", why: "The bar shows a day, the limit is a week.", source: { kind: "decision", ref: d.id } },
    { what: "The issue's weekly view", source: { kind: "issue", url: "https://github.com/acme/widgets/issues/12", label: "Issue #12" } }] });
  const m = s.getCard(card.id).threads.find((x) => x.id === thread.id).messages.at(-1);
  assert.deepEqual(m.warns.map((w) => [w.source.kind, w.source.ref || w.source.url, w.what]), [["decision", d.id, "Limits reset weekly"], ["issue", "https://github.com/acme/widgets/issues/12", "The issue's weekly view"]]);
  s.answer(thread.id, "Nothing against anything.");
  assert.equal(s.getCard(card.id).threads.find((x) => x.id === thread.id).messages.at(-1).warns, undefined, "no warns, no box");
});

test("the decision check: a design written without it queues one, a write with it closes it, a new decision checks the cards about it, a build against one is confirmed", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "Limits", problem: "Show the limit" });
  const asset = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: Buffer.from("<b>x</b>").toString("base64") }).asset.id;
  const checks = () => Object.values(s.db.inbox).filter((i) => i.kind === "decision-check" && i.card === card.id && i.state !== "done");
  s.upsertCard({ id: card.id, concepts: ["limits"], triage: { verdict: "design" } });
  assert.equal(checks().length, 0, "no decision to check against: nothing queued");
  const d = s.addDecision({ concepts: ["Limits"], text: "Limits reset weekly", author: { login: "dana" }, origin: { kind: "pr", url: "https://github.com/acme/widgets/pull/40" } }).decision;
  assert.equal(checks().length, 1, "a new decision about it checks the card");
  assert.match(checks()[0].note, new RegExp(`${d.id} is in force`));
  s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Bar", asset }] });
  assert.equal(checks().length, 1, "a design written without its check joins the check waiting");
  assert.throws(() => s.upsertCard({ id: card.id, decision_check: { concepts: [], read: [] } }), /what the design is about/);
  assert.throws(() => s.upsertCard({ id: card.id, decision_check: { concepts: ["limits"], read: ["D-9"] } }), /no decision D-9/);
  s.upsertCard({ id: card.id, conflicts: [{ decision: d.id, why: "The bar shows a day.", variant: "v1" }], decision_check: { concepts: ["Limits"], read: [d.id] } });
  assert.equal(checks().length, 0, "a write with its check closes it");
  assert.deepEqual([s.card(card.id).decision_check.concepts, s.card(card.id).decision_check.read, s.card(card.id).decision_check.options], [["limits"], [d.id], { v1: "1" }]);
  assert.deepEqual(s.decisionCheck(card.id).decisions.map((x) => x.id), [d.id]);
  assert.deepEqual(s.decisionCheck(card.id).conflicts.map((x) => x.decision), [d.id]);
  const other = s.createRequest(alice, { title: "Other", problem: "x" }).card;
  s.upsertCard({ id: other.id, concepts: ["header"], triage: { verdict: "design" } });
  assert.deepEqual(s.decisionCheck(other.id).decisions, [], "another concept reads nothing");
  assert.deepEqual(s.decisionCheck(other.id, { q: "weekly reset" }).decisions.map((x) => x.id), [d.id], "the words find it too");
  s.db.cards[card.id].status = "feedback";
  assert.throws(() => s.act(card.id, alice, "build", "v1"), (e) => e.status === 409 && new RegExp(`Bar goes against ${d.id}`).test(e.message));
  assert.equal(s.act(card.id, alice, "build", "v1", { overrule: true }).inbox.kind, "build", "built knowingly");
  s.addDecision({ concepts: ["limits"], text: "Limits show in the header", author: { name: "Alice" }, origin: { kind: "chat" } });
  assert.equal(checks().length, 1, "another decision about it checks it again");
  for (const i of Object.values(s.db.inbox).filter((x) => x.card === card.id && x.kind === "build")) { s.claim(i.id, "run-1"); s.done(i.id, "run-1"); }
  s.act(card.id, alice, "close");
  assert.deepEqual([checks().length, Object.values(s.db.inbox).find((i) => i.kind === "decision-check" && i.card === card.id && i.outcome === "not checked: closed") !== undefined], [0, true], "closing it ends the check waiting");
});

test("the decision check: each trigger queues one; a check a decision queued closes only once the write read it; a long read says it is cut", () => {
  const pr = { kind: "pr", url: "https://github.com/acme/widgets/pull/40" };
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const open = (s, id) => Object.values(s.db.inbox).filter((i) => i.kind === "decision-check" && i.card === id && i.state === "open");
  const decide = (s) => s.addDecision({ concepts: ["filters"], text: "Filters sit on the left", author: { login: "dana" }, origin: pr }).decision;

  // A picked alternative.
  { const { s, id, page, finish } = withOptions();
    s.upsertCard({ id, concepts: ["filters"] }); decide(s);
    s.act(id, alice, "alternatives", "Chips", { variant: "v1", part: { selector: "#f", label: "Filters" } });
    const vs = s.getCard(id).variants;
    s.upsertCard({ id, variants: [{ id: "v1", version: 1, name: "Table", asset: vs[0].asset, alternatives: [{ id: "a", name: "Chips", part: "Filters", asset: page("X") }] }, { id: "v2", version: 1, name: "Cards", asset: vs[1].asset }] });
    finish();
    s.act(id, alice, "pick-alternative", "a", { variant: "v1" });
    assert.equal(open(s, id).length, 1, "a picked alternative is checked"); }

  // A person's own option; a restored decision; what closes a check a decision queued.
  { const { s, id, finish } = withOptions();
    s.upsertCard({ id, concepts: ["filters"] }); const d = decide(s);
    assert.deepEqual(open(s, id).map((i) => i.decisions), [[d.id]], "the item names the decision that queued it");
    finish();
    s.addOwnOption(id, alice, { images: [{ contentType: "image/png", data: png }] });
    assert.equal(open(s, id).length, 1, "a person's own option is checked");
    finish();
    s.revokeDecision(d.id, alice, { reason: "Top now." }); s.restoreDecision(d.id, alice);
    assert.deepEqual(open(s, id).map((i) => i.decisions), [[d.id]], "a restored decision checks the cards about it");
    s.upsertCard({ id, decision_check: { concepts: ["filters"], read: [] } });
    assert.equal(open(s, id).length, 1, "a write that did not read it leaves it open");
    s.upsertCard({ id, decision_check: { concepts: ["filters"], read: [d.id] } });
    assert.equal(open(s, id).length, 0, "a write that read it closes it");
    s.upsertCard({ id, impact: { concept: "filters", places: [{ where: "Toolbar" }] } });
    assert.equal(open(s, id).length, 1, "a new impact is checked");

    // A new change card, and an open issue with a sketch.
    const change = s.upsertCard({ kind: "change", title: "One", summary: "Short.", source: { repo: "acme/widgets", pr: 9 },
      sections: [{ key: "what", title: "What changed", body: "Filters moved.", source: { label: "PR #9" } }] }).card;
    assert.equal(open(s, change.id).length, 1, "a change card written without its check is checked");
    const shot = s.addAsset({ kind: "screen", name: "s", contentType: "image/png", data: png }).asset.id;
    const issue = s.upsertCard({ kind: "issue", title: "See filters", status: "open", bucket: "sprint", source: { repo: "acme/widgets", issue: 41 }, sketches: [{ asset: shot, source: "sketch" }] }).card;
    assert.equal(open(s, issue.id).length, 1, "an issue's sketch is checked");

    for (let i = 0; i < 60; i++) s.addDecision({ concepts: ["filters"], text: `Rule ${i}`, author: { name: "Alice" }, origin: { kind: "chat" } });
    const read = s.decisionCheck(id);
    assert.deepEqual([read.decisions.length, read.total, read.truncated], [60, 61, true], "a long read is cut and says so");
    assert.deepEqual(s.decisionCheck(id, { q: "left" }).decisions.map((x) => x.text), ["Filters sit on the left"], "words read instead of the concepts narrow it");
  }
});

test("a decision someone other than a designer made is approved by a designer; it holds either way", () => {
  const s = fresh();
  const pr = { kind: "pr", url: "https://github.com/acme/widgets/pull/40" };
  const d = s.addDecision({ concepts: ["limits"], text: "Limits reset weekly", author: { login: "dana" }, origin: pr }).decision;
  assert.throws(() => s.approveDecision(d.id, { agent: true }), (e) => e.status === 403);
  const a = s.approveDecision(d.id, alice).decision;
  assert.deepEqual([a.status, a.approved.by.email, a.history.at(-1).what], ["active", alice.email, "approved"]);
  assert.throws(() => s.approveDecision(d.id, alice), /already approved/);
  const gone = s.addDecision({ concepts: ["rows"], text: "Rows stay roomy", author: { login: "dana" }, origin: pr }).decision;
  s.revokeDecision(gone.id, alice, { reason: "Dense now." });
  assert.throws(() => s.approveDecision(gone.id, alice), /restore it first/);
});

test("a designer adds a decision on the Desk in their own name, with its pictures; Design Desk does not", () => {
  const s = fresh();
  const pic = s.addAsset({ kind: "image", name: "decision-1", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const d = s.recordDecision(alice, { text: "Empty lists show a hint", why: "People got stuck.", concepts: ["Empty list", " onboarding "], pictures: [pic] }).decision;
  assert.deepEqual(d.author, { name: null, login: null, email: "alice@example.com", role: "designer" });
  assert.deepEqual(d.origin, { kind: "desk", label: "Added on the Desk", url: null, card: null, thread: null, message: null }, "decided on the Desk, with no link");
  assert.deepEqual(d.concepts, ["empty list", "onboarding"]);
  assert.deepEqual(d.pictures, [pic]);
  assert.throws(() => s.recordDecision(alice, { text: "x", concepts: [] }), /what it is about/);
  assert.throws(() => s.recordDecision(alice, { text: "x", concepts: ["a"], pictures: ["A-99"] }), /no asset A-99/);
  assert.throws(() => s.recordDecision({ agent: true }, { text: "x", concepts: ["a"] }), (e) => e.status === 403);
  assert.throws(() => s.addDecision({ concepts: ["a"], text: "x", author: { login: "dana" }, origin: { kind: "desk" } }), /needs a link/, "the agent's desk origin still names its card");
});

test("a closed request is deleted for good, with its conversations and pictures; an open one or one still worked on is not", () => {
  const s = fresh();
  const card = s.createRequest(alice, { title: "Softer colours", problem: "Too loud." }).card;
  s.openThread(card.id, bob, { text: "Why close it?" });
  assert.throws(() => s.deleteRequest(card.id, alice), /Close the request first/);
  s.act(card.id, alice, "close");
  assert.throws(() => s.deleteRequest(card.id, alice), /still working/, "not while an item on it is open");
  for (const it of Object.values(s.db.inbox)) if (it.card === card.id && it.state !== "done") { s.claim(it.id, "run-1"); s.done(it.id, "run-1"); }
  const pic = s.addAsset({ card: card.id, kind: "screen", name: "s", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  assert.deepEqual(s.deleteRequest(card.id, alice), { deleted: card.id });
  assert.equal(s.db.cards[card.id], undefined);
  assert.equal(s.db.assets[pic], undefined, "its pictures go");
  assert.equal(Object.values(s.db.threads).some((t) => t.card === card.id), false, "its conversations go");
  assert.equal(Object.values(s.db.inbox).some((i) => i.card === card.id), false);
  assert.throws(() => s.deleteRequest(card.id, alice), (e) => e.status === 404);
});

test("Check again: a screen goes back to Design Desk once, as a map item with scope refresh; the same pictures mark it checked", () => {
  const s = fresh();
  const shot = s.addAsset({ kind: "screen", name: "a", contentType: "image/png", data: Buffer.from("png-a").toString("base64") }).asset.id;
  const { card } = s.upsertCard({ kind: "screen", title: "Agents list", path: "/agents", status: "current", screens: [{ asset: shot, source: "instance" }] });
  assert.ok(card.drawn, "first pictures: drawn");
  const { inbox: item } = s.act(card.id, alice, "refresh");
  assert.deepEqual([item.kind, item.scope], ["map", "refresh"]);
  assert.throws(() => s.act(card.id, alice, "refresh"), /already working/);
  assert.throws(() => s.act(card.id, alice, "history"), /only be checked again/);
  const again = s.upsertCard({ id: card.id, screens: [{ asset: shot, source: "instance" }] }).card;
  assert.equal(again.drawn, card.drawn, "the same pictures: not redrawn");
  assert.ok(again.checked >= card.drawn, "but checked");
});

test("Where else this shows up: a screen opens its card in Product, and one Product does not have gets a card to draw", () => {
  const s = fresh();
  const { card: list } = s.upsertCard({ kind: "screen", title: "Agents list", path: "/agents", status: "current" });
  const { card: req } = s.createRequest(alice, { title: "Calmer spend", problem: "The spend shouts." });
  const im = s.upsertCard({ id: req.id, impact: { concept: "an agent's weekly spend", places: [
    { where: "Agents list → each row", kind: "screen" }, { where: "Billing", how: "the month's total", kind: "screen" }, { where: "Slack alert", kind: "message" }] } }).card.impact;
  assert.equal(im.places[0].card, list.id, "named as the screen is: linked");
  const added = s.card(im.places[1].card);
  assert.deepEqual([added.kind, added.status, added.title, added.created_by], ["screen", "building", "Billing", { agent: true }]);
  assert.ok(inbox(s).open.some((i) => i.kind === "map" && i.card === added.id), "the next run draws it");
  assert.equal(im.places[2].card, null, "a message is no screen");
  const again = s.upsertCard({ id: req.id, impact: { concept: "an agent's weekly spend", places: [{ where: "Billing", kind: "screen" }] } }).card.impact;
  assert.equal(again.places[0].card, added.id, "written again: the same card, no twin");
  s.upsertCard({ id: added.id, status: "dropped" });
  for (let k = 0; k < 2; k++) {
    const after = s.upsertCard({ id: req.id, impact: { concept: "an agent's weekly spend", places: [{ where: "Billing", kind: "screen" }] } }).card.impact;
    assert.equal(after.places[0].card, null, "named like a dropped screen: no link");
  }
  assert.equal(Object.values(s.db.cards).filter((x) => x.kind === "screen" && x.title === "Billing").length, 1, "and no new card, however often it is written");
});

test("a PM moves a request along but marks no presentation presented", () => {
  const s = fresh();
  const pat = { email: "pat@example.com", role: "pm" };
  const { card } = s.createRequest(alice, { title: "Calmer header", problem: "The header shouts." });
  assert.throws(() => s.markPresented(card.id, pat), (e) => e.status === 403, "an item: a designer's");
  assert.throws(() => s.closeCall(pat), (e) => e.status === 403, "the whole presentation: a designer's");
  assert.doesNotThrow(() => s.closeCall(alice));
});

test("Under the hood: a short plain text with its sources; a plain string is its text", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { title: "A daily bar", problem: "Show each day's spend." });
  const im = s.upsertCard({ id: card.id, impact: { concept: "an agent's spend", places: [], behind: { text: "The product only keeps the week's total today.", sources: [{ label: "PR #5", url: "https://example.com/pr/5" }] } } }).card.impact;
  assert.deepEqual(im.behind, { text: "The product only keeps the week's total today.", sources: [{ label: "PR #5", url: "https://example.com/pr/5", card: null }] });
  assert.equal(s.upsertCard({ id: card.id, impact: { concept: "x", behind: "Nothing changes behind the screens." } }).card.impact.behind.text, "Nothing changes behind the screens.");
  assert.equal(s.upsertCard({ id: card.id, impact: { concept: "x" } }).card.impact.behind, undefined, "none written: none shown");
});

test("notifications fold rows: one per item, family and day, at most 20 marks, each person once, votes too; a private answer on an archived card is not news", () => {
  let now = Date.UTC(2026, 9, 1, 8);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const tick = () => { now += 60e3; return s.clock(); };
  const pat = { email: "pat@example.com", role: "designer" }, kim = { email: "kim@example.com", role: "pm" }, lee = { email: "lee@example.com", role: "developer" };
  const { card } = s.createRequest(alice, { title: "Mine", problem: "x", screen: "S" });
  tick(); const t = s.openThread(card.id, pat, { kind: "comment", text: "1" });
  for (let n = 2; n <= 25; n++) { tick(); s.reply(t.thread.id, n % 2 ? pat : kim, String(n)); }
  s.db.cards[card.id].variants = [{ id: "v1", name: "Soft", version: 1 }];
  for (const who of [pat, kim, lee]) { tick(); s.vote(card.id, who, { variant: "v1", vote: "prefer" }); }
  const rows = s.notifications(alice).items;
  const talk = rows.filter((x) => ["comment", "reply"].includes(x.event));
  assert.equal(talk.length, 1, "25 messages on one item in one day: one row");
  assert.equal(talk[0].count, 25);
  assert.equal(talk[0].marks.length, 20, "at most 20 messages to light");
  assert.deepEqual(talk[0].people.map((p) => p.email), ["pat@example.com", "kim@example.com"], "each person once, newest first");
  const votes = rows.filter((x) => x.event === "vote");
  assert.equal(votes.length, 1, "votes fold too");
  assert.equal(votes[0].count, 3);
  // The next day starts a new row.
  now += 864e5; s.reply(t.thread.id, pat, "Next day");
  assert.equal(s.notifications(alice).items.filter((x) => ["comment", "reply"].includes(x.event)).length, 2);
  // A private answer on an archived card is not news, for its owner either.
  const ask = s.openPrivate(alice, { text: "Why?", context: { card: card.id } });
  tick(); s.answer(ask.thread.id, "Because");
  assert.equal(s.notifications(alice).items.filter((x) => x.private).length, 1);
  s.db.cards[card.id].status = "archived";
  assert.equal(s.notifications(alice).items.filter((x) => x.private).length, 0);
});

test("notifications: every event kind, the 30-day window, the row cap, newest first, skipped cards, For you from a vote or an approval; seen saves only on news", () => {
  let now = Date.UTC(2026, 9, 1);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const tick = (h = 1) => { now += h * 3600e3; return s.clock(); };
  const pat = { email: "pat@example.com", role: "designer" };
  // Older than the window: never in the bell.
  const old = s.createRequest(pat, { title: "Old one", problem: "x", screen: "S" }).card;
  tick(24 * 40);
  const r1 = s.createRequest(alice, { title: "Mine", problem: "x", screen: "S" }).card;
  const c1 = s.db.cards[r1.id];
  c1.variants = [{ id: "v1", name: "Soft", drawn: tick(), version: 1 }, { id: "v2", name: "Bold", drawn: tick(), version: 2 }];
  tick(); s.vote(r1.id, pat, { variant: "v1", vote: "concern" });
  c1.approved = { by: pat, at: tick(), variant: "v1" };
  c1.spec = { at: tick(), asset: "A-1" };
  c1.decided = { by: pat, at: tick(), text: "Keep it" };
  tick(); const d = s.addDecision({ concepts: ["badge"], text: "Soft badges", author: { name: "Pat", email: pat.email, role: "designer" }, origin: { kind: "desk", card: r1.id } }).decision;
  tick(); s.revokeDecision(d.id, pat, { reason: "Changed our mind" });
  // Pat's request Alice voted on, and one she approved: what Pat does there is for her.
  tick(); const r2 = s.createRequest(pat, { title: "Voted", problem: "x", screen: "S" }).card;
  s.db.cards[r2.id].variants = [{ id: "w1", name: "One", version: 1 }];
  tick(); s.vote(r2.id, alice, { variant: "w1", vote: "prefer" });
  tick(); s.openThread(r2.id, pat, { kind: "comment", text: "On the one you voted for" });
  tick(); const r3 = s.createRequest(pat, { title: "Approved", problem: "x", screen: "S" }).card;
  s.db.cards[r3.id].approved = { by: alice, at: tick(), variant: null };
  tick(); s.openThread(r3.id, pat, { kind: "comment", text: "On the one you approved" });
  tick(); const r4 = s.createRequest(pat, { title: "Not yours", problem: "x", screen: "S" }).card;
  // An archived card and a digest are not news.
  tick(); const gone = s.createRequest(pat, { title: "Archived", problem: "x", screen: "S" }).card; s.db.cards[gone.id].status = "archived";
  tick(); const dig = s.createRequest(pat, { title: "Digest", problem: "x", screen: "S" }).card; s.db.cards[dig.id].kind = "digest";
  tick();
  const items = s.notifications(alice).items;
  const ev = (e, item) => items.find((x) => x.event === e && (!item || x.item === item));
  assert.ok(!items.some((x) => x.item === old.id), "older than 30 days is out");
  assert.ok(!items.some((x) => [gone.id, dig.id].includes(x.item)), "archived and digest cards are skipped");
  assert.equal(ev("options-drawn", r1.id).variant, "v1");
  assert.equal(ev("options-redrawn", r1.id).variant, "v2");
  assert.equal(ev("vote", r1.id).detail, "Has a concern about Soft");
  assert.equal(ev("approved", r1.id).detail, "Soft");
  assert.equal(ev("spec", r1.id).by.agent, true);
  assert.equal(ev("decided", r1.id).by.email, pat.email);
  assert.equal(ev("new-decision").item, d.id);
  assert.equal(ev("revoked").detail, "Changed our mind");
  for (const e of ["options-drawn", "vote", "approved", "spec", "decided"]) assert.equal(ev(e, r1.id).for_you, true, `${e} on her own request is for her`);
  assert.equal(ev("comment", r2.id).for_you, true, "a vote makes the request hers");
  assert.equal(ev("comment", r3.id).for_you, true, "an approval makes the request hers");
  assert.equal(ev("new-request", r4.id).for_you, false, "a request she never touched is not for her");
  assert.deepEqual(items.map((x) => x.at), [...items.map((x) => x.at)].sort().reverse(), "newest first");
  assert.equal(s.notifications(alice, { limit: 3 }).items.length, 3, "at most the cap");
  // Opening the bell saves the newest event's time; opening it again with nothing new saves nothing.
  let saves = 0; const save = s.save.bind(s); s.save = () => { saves += 1; save(); };
  assert.equal(s.markSeen(alice).seen, items[0].at);
  assert.equal(saves, 1);
  tick();
  assert.equal(s.markSeen(alice).seen, items[0].at);
  assert.equal(saves, 1, "nothing new: no write");
  tick(); s.openThread(r1.id, pat, { kind: "comment", text: "News" });
  assert.equal(s.notifications(alice).unread, 1);
  s.markSeen(alice);
  assert.equal(saves, 3, "news: one write (the comment saved once too)");
  assert.equal(s.notifications(alice).unread, 0);
});

test("notifications: a click reads one row; a repeat click writes nothing, noted keeps only rows still in the bell, Mark as read empties it", () => {
  let now = Date.UTC(2026, 9, 1);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const tick = (h = 1) => { now += h * 3600e3; return s.clock(); };
  const pat = { email: "pat@example.com", role: "designer" };
  const r = s.createRequest(alice, { title: "Mine", problem: "x", screen: "S" }).card;
  tick(); s.openThread(r.id, pat, { kind: "comment", text: "First" });
  let saves = 0; const save = s.save.bind(s); s.save = () => { saves += 1; save(); };
  const row = () => s.notifications(alice).items.find((x) => x.item === r.id && x.for_you);
  // One row read on its click; a repeat click on a read row returns early, with no save.
  const first = row().id;
  assert.equal(s.markNoteRead(alice, first).read, true);
  assert.equal(saves, 1);
  assert.equal(s.markNoteRead(alice, first).read, true);
  assert.equal(saves, 1, "a repeat click writes nothing");
  assert.deepEqual(s.db.noted[alice.email], [first], "one id, never twice");
  // A new message on the item is a new row; reading it drops the id that left the bell.
  tick(); s.openThread(r.id, pat, { kind: "comment", text: "Second" });
  const next = row().id;
  assert.notEqual(next, first, "the folded row has a new id");
  s.markNoteRead(alice, next);
  assert.deepEqual(s.db.noted[alice.email], [next], "only rows still in the bell stay noted");
  // Mark as read covers every row with seen, and empties noted.
  tick(); s.openThread(r.id, pat, { kind: "comment", text: "Third" });
  s.markSeen(alice);
  assert.equal(s.db.noted[alice.email], undefined, "Mark as read empties noted");
  assert.equal(s.notifications(alice).unread, 0);
});

test("notifications: what others did lately, grouped per item, private answers for their owner, For you, seen", () => {
  const s = fresh();
  const carol = { email: "carol@example.com", role: "pm" };
  const { card } = s.createRequest(alice, { title: "Calmer cards", problem: "too loud", screen: "Agents list" });
  const t = s.openThread(card.id, bob, { kind: "comment", text: "The badges shout." });
  s.reply(t.thread.id, carol, "Agreed.");
  const ask = s.openPrivate(bob, { text: "Only mine", context: { card: card.id } });
  const mine = s.notifications(alice);
  // Alice's own request is not news to her; Bob's comment and Carol's reply are, as one row on her request.
  assert.equal(mine.items.length, 1);
  const talk = mine.items[0];
  assert.equal(talk.event, "reply"); assert.equal(talk.detail, "Agreed.");
  assert.equal(talk.count, 2);
  assert.deepEqual(talk.people.map((p) => p.email), ["carol@example.com", "bob@example.com"]);
  // The row lands on the newest message and names every message it folds.
  assert.equal(talk.thread, t.thread.id); assert.equal(talk.msg, 1);
  assert.deepEqual(talk.marks, [[t.thread.id, 1], [t.thread.id, 0]]);
  assert.equal(talk.item, card.id); assert.equal(talk.title, "Calmer cards"); assert.equal(talk.screen, "Agents list"); assert.equal(talk.for_you, true);
  assert.equal(mine.unread, 1);
  // Carol sees the request and Bob's comment, never her own reply nor Bob's private ask.
  const hers = s.notifications(carol).items;
  assert.deepEqual(hers.map((x) => x.event).sort(), ["comment", "new-request"]);
  assert.ok(hers.every((x) => !x.private));
  // Design Desk's answer to Bob's private ask is his alone, and for him.
  s.answer(ask.thread.id, "Only yours");
  const his = s.notifications(bob).items.find((x) => x.private);
  assert.equal(his.event, "answer"); assert.equal(his.thread, ask.thread.id); assert.equal(his.msg, 1); assert.equal(his.for_you, true); assert.equal(his.item, card.id);
  assert.ok(!s.notifications(alice).items.some((x) => x.private));
  // A new message in a thread she wrote in is for her, folded with Bob's comment.
  s.reply(t.thread.id, bob, "Thanks");
  const row = s.notifications(carol).items.find((x) => x.detail === "Thanks");
  assert.equal(row.for_you, true); assert.equal(row.count, 2); assert.equal(row.msg, 2);
  // An option drawn and a vote on it name that option, for the click to open its tab.
  s.db.cards[card.id].variants = [{ id: "v1", name: "Soft", drawn: s.clock(), version: 1 }];
  s.vote(card.id, bob, { variant: "v1", vote: "prefer" });
  const now = s.notifications(alice).items;
  assert.equal(now.find((x) => x.event === "options-drawn").variant, "v1");
  assert.equal(now.find((x) => x.event === "vote").variant, "v1");
  // Opening the bell marks it seen, for that person alone.
  s.markSeen(alice);
  assert.equal(s.notifications(alice).unread, 0);
  // Carol wrote in the request, so all of it is for her and counts, a row each: the request,
  // the talk, the option drawn and the vote.
  assert.equal(s.notifications(carol).unread, 4);
  // Dave took no part: he sees all of it under All, and his count stays 0.
  const dave = s.notifications({ email: "dave@example.com", role: "designer" });
  assert.ok(dave.items.length > 0 && dave.items.every((x) => !x.for_you));
  assert.equal(dave.unread, 0);
  assert.deepEqual(s.markSeen({ agent: true }), { seen: null });
});

test("Designs: a developer marks a design done and asks its designer, who gets it For you", () => {
  const s = fresh();
  const carol = { email: "carol@example.com", role: "designer" };
  const { card } = s.createRequest(alice, { title: "Daily limits", problem: "People do not see the limit." });
  for (const a of ["designs", "built"]) { assert.equal(can("developer", a), true, a); assert.equal(can("lead-developer", a), true, a); assert.equal(can("admin", a), true, a); assert.equal(can("designer", a), false, a); assert.equal(can("pm", a), false, a); }
  assert.throws(() => s.markBuilt(card.id, bob), /sent to developers/);
  assert.throws(() => s.openThread(card.id, bob, { text: "Why?", dev: true }), /sent to developers/);
  s.upsertCard({ id: card.id, status: "handed-off", dev_summary: "- Limits show on the dashboard (Alice)." });
  s.db.cards[card.id].approved = { by: { email: alice.email, role: "designer" }, at: s.clock() };
  assert.equal(s.getCard(card.id).dev_summary.text, "- Limits show on the dashboard (Alice).");
  const { thread } = s.openThread(card.id, bob, { text: "Is the banner sticky?", dev: true });
  assert.equal(thread.dev, true);
  const forAlice = s.notifications(alice).items.find((x) => x.thread === thread.id);
  assert.equal(forAlice.event, "dev-question");
  assert.deepEqual([forAlice.for_you, forAlice.designs], [true, true], "the approving designer's");
  assert.equal(s.notifications(carol).items.find((x) => x.thread === thread.id).for_you, false, "another designer's only when a non-designer approved");
  s.db.cards[card.id].approved.by = { email: bob.email, role: "developer" };
  assert.equal(s.notifications(carol).items.find((x) => x.thread === thread.id).for_you, true);
  s.markBuilt(card.id, bob);
  assert.equal(s.listCards({ kind: "request" })[0].built, s.getCard(card.id).built.at);
  assert.equal(s.notifications(alice).items.find((x) => x.event === "built").designs, true);
  s.markBuilt(card.id, bob, false);
  assert.equal(s.listCards({ kind: "request" })[0].built, null);
  // A summary written later (the 1.63.0 backfill) keeps when the request was sent.
  s.db.cards[card.id].updated = "2026-10-01T09:00:00.000Z";
  s.upsertCard({ id: card.id, dev_summary: "- Sticky on scroll (Alice)." });
  assert.deepEqual([s.getCard(card.id).updated, s.getCard(card.id).dev_summary.text], ["2026-10-01T09:00:00.000Z", "- Sticky on scroll (Alice)."]);
  s.upsertCard({ id: card.id, summary: "Limits." });
  assert.notEqual(s.getCard(card.id).updated, "2026-10-01T09:00:00.000Z", "any other write moves it");
  assert.throws(() => s.upsertCard({ kind: "change", title: "A change", source: { repo: "acme/widgets", pr: 9 }, dev_summary: "x" }), /dev_summary belongs to a request/);
  s.upsertCard({ id: card.id, dev_summary: null });
  assert.equal(s.getCard(card.id).dev_summary, null, "null takes the summary off");
  // Only a comment asks the designer: a question goes to Design Desk.
  assert.throws(() => s.openThread(card.id, bob, { kind: "question", text: "Why?", dev: true }), /sent to developers/);
  // Two questions for the designer in one day fold into one row; a plain comment of the same item and day stays a row of its own.
  s.openThread(card.id, { email: "dana@example.com", role: "developer" }, { text: "And on mobile?", dev: true });
  s.openThread(card.id, carol, { text: "Nice work." });
  const rows = s.notifications(alice).items.filter((x) => ["dev-question", "comment"].includes(x.event));
  assert.deepEqual(rows.map((x) => [x.event, x.count, Boolean(x.designs)]).sort(), [["comment", 1, false], ["dev-question", 2, true]]);
  // Done, then declined and reopened: sent again later, it is To build with a new summary, not the old Done.
  s.upsertCard({ id: card.id, dev_summary: "- Old decisions." });
  s.markBuilt(card.id, bob);
  s.upsertCard({ id: card.id, status: "declined" });
  s.act(card.id, alice, "reopen");
  assert.deepEqual([s.getCard(card.id).status, s.getCard(card.id).built, s.getCard(card.id).dev_summary], ["triage", undefined, undefined]);
  s.upsertCard({ id: card.id, status: "handed-off" });
  assert.equal(s.listCards({ kind: "request" }).find((x) => x.id === card.id).built, null);
});

// Research cites what a designer opens: an issue or a pull request, a Desk number, a Markdown page
// with its section and words; never a code file (docs/requests.md → Research, step 6).
test("research links: issues, pull requests, Desk numbers and pages with a section; no code files", () => {
  const s = fresh();
  const who = { email: "o@example.com", role: "admin", deskRole: "admin" };
  const r = s.createRequest(who, { title: "Pick a harness", problem: "The harness menu is hard to find today when a terminal starts." });
  const id = r.card?.id || Object.keys(s.db.cards).pop();
  const ok = { verdict: "clear", summary: "Asked in [#5](https://github.com/acme/widgets/issues/5); see C-1.", links: [
    { label: "Issue #5", url: "https://github.com/acme/widgets/issues/5" },
    { label: "PR #6", url: "https://github.com/acme/widgets/pull/6" },
    { ref: id.toLowerCase() },
    { label: "ADR 12", url: "https://github.com/acme/widgets/blob/main/docs/adr/0012-x.md#decision", section: "Decision", excerpt: "It starts on the default." },
  ] };
  s.upsertCard({ id, research: ok });
  const links = s.db.cards[id].research.links;
  assert.deepEqual(links[2], { ref: id, label: "Pick a harness" });
  assert.deepEqual(s.githubRefs(id).sort(), ["acme/widgets#5", "acme/widgets#6"]);
  assert.deepEqual(s.cardsOf("acme/widgets#5"), [], "a cited issue's comments are not the card's news");
  const refuse = (research, re) => assert.throws(() => s.upsertCard({ id, research: { ...ok, ...research } }), re);
  refuse({ links: [{ label: "menu", url: "https://github.com/acme/widgets/blob/main/src/menu.tsx" }] }, /never a code file/);
  refuse({ links: [{ label: "guide", url: "https://github.com/acme/widgets/blob/main/docs/guide.md" }] }, /section/);
  refuse({ links: [{ ref: "D-99" }] }, /no D-99/);
  refuse({ summary: "It lives in src/terminal-harness-menu.tsx." }, /code file/);
  refuse({ summary: "See [the guide](https://github.com/acme/widgets/blob/main/docs/guide.md)." }, /GitHub issue or pull request/);
  // A bare .js name is a library's, whatever library; with a folder it is a file.
  s.upsertCard({ id, research: { ...ok, summary: "Built on Node.js, Next.js, Moment.js, highlight.js and vue.js (see storybook.js.org), e.g. as before." } });
  for (const name of ["src/components/Menu.tsx", "HarnessMenu.tsx", "User.rb", "index.html", "main.c", "util.h", "Cargo.toml", "theme.CSS", "build.kts", "app.dart", "init.lua", "src/lib/moment.js"])
    refuse({ summary: `It lives in ${name}.` }, /code file/);
  // An issue cited only in the summary, as a bare link, is read for its preview too.
  s.upsertCard({ id, research: { ...ok, summary: "Asked again in https://github.com/acme/widgets/issues/77.", links: [] } });
  assert.deepEqual(s.githubRefs(id), ["acme/widgets#77"]);
  s.upsertCard({ id, research: ok });
  refuse({ summary: "See https://github.com/acme/widgets/commit/abc123." }, /GitHub issue or pull request/);
  refuse({ summary: "See https://github.com/acme/widgets/blob/main/src/menu.tsx." }, /GitHub issue or pull request/);
  refuse({ links: [{ label: "Issue #3", url: "https://gitlab.com/acme/widgets/issues/3" }] }, /only an issue/);
  // A numbered part, a folder of pages, an .mdx page; at most 20 sources.
  const page = (url) => ({ label: "Page", url, section: "Why", excerpt: "Because." });
  s.upsertCard({ id, research: { ...ok, links: [{ ref: `${id}.2` }, page("https://github.com/acme/widgets/tree/main/docs/adr/README.md"), page("https://github.com/acme/widgets/blob/main/docs/x.mdx#why")] } });
  assert.deepEqual(s.db.cards[id].research.links.map((l) => l.ref || l.url.split("/").pop()), [`${id}.2`, "README.md", "x.mdx#why"]);
  refuse({ links: [{ ref: `${id}.2.1` }] }, /ref is/);
  const many = Array.from({ length: 21 }, (_, i) => ({ label: `Issue #${i + 1}`, url: `https://github.com/acme/widgets/issues/${i + 1}` }));
  s.upsertCard({ id, research: { ...ok, links: many } });
  assert.equal(s.db.cards[id].research.links.length, 20, "the 21st source is dropped");
  assert.equal(s.db.cards[id].research.links.at(-1).url, "https://github.com/acme/widgets/issues/20");
});

// A ref github-sync cannot read counts its failed reads; after 3 in a row the watch gate skips it
// and the answer names it once; a read that works clears it (docs/watch.md → Comments on GitHub).
test("github refs that cannot be read: counted, given up after 3, cleared by a read", () => {
  const s = fresh();
  const who = { email: "o@example.com", role: "admin", deskRole: "admin" };
  const r = s.createRequest(who, { title: "Pick a harness", problem: "The harness menu is hard to find today when a terminal starts." });
  const id = r.card?.id || Object.keys(s.db.cards).pop();
  s.upsertCard({ id, research: { verdict: "clear", summary: "Asked in https://github.com/acme/widgets/issues/50000.", links: [] } });
  const refs = () => JSON.parse(readFileSync(join(s.dir, "github-refs.json"), "utf8")).refs;
  assert.deepEqual(refs(), [{ key: "acme/widgets#50000", updated: null, tries: 0 }]);
  assert.deepEqual(s.failGithub(["acme/widgets#50000", "other/repo#1"]).gave_up, [], "a ref no card cites is not counted");
  assert.deepEqual(s.failGithub(["acme/widgets#50000"]).gave_up, []);
  assert.deepEqual(s.failGithub(["acme/widgets#50000"]).gave_up, ["acme/widgets#50000"], "named on the 3rd failed read");
  assert.deepEqual(s.failGithub(["acme/widgets#50000"]).gave_up, [], "and only then");
  assert.equal(refs()[0].tries, 4);
  assert.equal(s.db.gh_failed["other/repo#1"], undefined);
  assert.throws(() => s.failGithub(["nope"]), /owner\/repo#number/);
  s.putGithub([{ key: "acme/widgets#50000", kind: "issue", title: "Found", updated: "2026-11-08T10:00:00Z" }]);
  assert.deepEqual(refs(), [{ key: "acme/widgets#50000", updated: "2026-11-08T10:00:00Z", tries: 0 }], "a read clears the count");
});

// docs/desk.md → Team feedback: End the vote.
test("End the vote: no more votes, an open Slack vote is due to close, a new round starts a new vote", () => {
  const s = fresh();
  const guest = { email: "gus@example.com", role: "guest" };
  const { card } = s.createRequest(alice, { problem: "Two ways to show the plan." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "checked"); }
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [{ id: "v1", name: "Table", asset: a }] });
  assert.throws(() => s.endVote(card.id, alice), (e) => e.status === 400 && /not voting/.test(e.message), "nothing to end before the team is asked");
  s.openFeedback(card.id, alice);
  s.vote(card.id, bob, { variant: "v1", vote: "prefer" });
  const { poll } = s.openPoll(card.id, { chat: "C0123", root_ts: "1.0", posts: [{ variant: "v1", ts: "1.1" }], closes: "2099-01-01T00:00:00Z" });
  assert.throws(() => s.endVote(card.id, guest), (e) => e.status === 403, "not a viewer's");
  const ended = s.endVote(card.id, bob).card;
  assert.equal(ended.vote_ended.by.email, "bob@example.com", "who ended it");
  assert.equal(ended.polls.find((x) => x.id === poll.id).closes, ended.vote_ended.at, "the vote in Slack is due to close now");
  assert.equal(ended.polls[0].state, "open", "closing it there stays the agent's");
  const row = () => s.listCards({ kind: "request" }).find((x) => x.id === card.id);
  assert.deepEqual([row().voted, row().voting], [true, false], "the list's row says the vote ended, though the poll is still open in Slack");
  assert.throws(() => s.vote(card.id, bob, { variant: "v1", vote: "dislike" }), (e) => e.status === 400 && /has ended/.test(e.message), "no more votes");
  assert.equal(s.card(card.id).votes.v1["bob@example.com"].vote, "prefer", "the votes cast stay");
  assert.throws(() => s.endVote(card.id, alice), (e) => e.status === 400 && /already ended/.test(e.message), "once");
  // The options go back to their people and to the team again: a new vote.
  s.upsertCard({ id: card.id, status: "variants" });
  s.openFeedback(card.id, alice);
  assert.equal(s.card(card.id).vote_ended, undefined, "asking for feedback again starts a new vote");
  s.vote(card.id, bob, { variant: "v1", vote: "dislike" });

  // Every other way into a feedback round starts a new vote too: a run's write from another
  // step, a person's own option on a request the agent filed, a closed request reopened.
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const filed = s.upsertCard({ kind: "request", title: "Softer colours", origin: { channel: "slack", reporter: "Carla" } }).card;
  s.upsertCard({ id: filed.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [{ id: "v1", name: "Calm", asset: a }] });
  // A later write moves the request back to feedback; its options stay as they are.
  const round = () => { s.upsertCard({ id: filed.id, status: "feedback" }); return s.card(filed.id); };
  assert.equal(s.card(filed.id).status, "feedback", "from Slack: on to the team by itself");
  s.endVote(filed.id, alice);
  s.upsertCard({ id: filed.id, status: "variants" });
  assert.equal(round().vote_ended, undefined, "a run's write back to feedback starts a new vote");
  s.endVote(filed.id, alice);
  s.upsertCard({ id: filed.id, status: "variants" });
  s.addOwnOption(filed.id, alice, { images: [{ contentType: "image/png", data: png }] });
  assert.deepEqual([s.card(filed.id).status, s.card(filed.id).vote_ended], ["feedback", undefined], "a person's own option after a redraw starts a new vote");
  s.vote(filed.id, bob, { variant: "v1", vote: "prefer" });
  s.endVote(filed.id, alice);
  s.act(filed.id, alice, "close");
  s.act(filed.id, alice, "reopen");
  assert.equal(s.card(filed.id).vote_ended, undefined, "a reopened request starts a new vote");
});

test("Ask for feedback tells every developer; a row says who voted; a claimed item says since when", () => {
  const s = fresh();
  const carol = { email: "carol@example.com", role: "designer" };
  const { card } = s.createRequest(alice, { problem: "Two ways to show the plan." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "checked"); }
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [{ id: "v1", name: "Table", asset: a }] });
  const asked = (who) => s.notifications(who).items.find((x) => x.event === "feedback-asked");
  assert.equal(asked(bob), undefined, "not while the options are held");
  s.openFeedback(card.id, alice);
  assert.equal(asked(bob).for_you, true, "a developer's, whoever filed it");
  assert.equal(asked(carol).for_you, false, "another designer sees it under All");
  assert.equal(asked(alice), undefined, "never one's own doing");
  s.vote(card.id, bob, { variant: "v1", vote: "prefer" });
  const row = (who) => s.listCards({ kind: "request", viewer: who.email, who }).find((x) => x.id === card.id);
  assert.deepEqual([row(bob).voted_mine, row(carol).voted_mine], [true, false]);
  // Approve with the box ticked: the spec goes as soon as it is written (docs/handoff.md).
  const r = s.act(card.id, alice, "approve", "v1", { autoSend: true });
  assert.equal(r.card.approved.auto_send, true);
  assert.equal(s.getCard(card.id).waiting.find((w) => w.kind === "handoff").started, undefined, "not started before its claim");
  s.claim(r.inbox.id, "run-2");
  assert.ok(s.getCard(card.id).waiting.find((w) => w.kind === "handoff").started);
});

test("a request from Slack never sends its spec unread", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "From a thread." });
  for (const i of Object.values(s.db.inbox)) { s.claim(i.id, "run-1"); s.done(i.id, "run-1", "checked"); }
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Look only."] } });
  s.db.cards[card.id].origin = { channel: "slack", reporter: "Dana" };
  assert.equal(s.act(card.id, alice, "approve", "Build it.", { autoSend: true }).card.approved.auto_send, undefined);
});

test("a merged change that builds a sent design marks it done, unless a person took it back", () => {
  const s = fresh();
  const sent = (title, n) => { const r = s.createRequest(alice, { title, problem: "Why.", type: "feature" }).card; return s.upsertCard({ id: r.id, status: "handed-off", spec: { pr_url: `https://github.com/acme/widgets/pull/${n}` } }).card; };
  const change = (n, merged) => s.upsertCard({ kind: "change", title: `PR ${n}`, source: { repo: "acme/widgets", pr: n, url: `https://github.com/acme/widgets/pull/${n}`, ...(merged ? { merged_at: "2026-11-01T10:00:00Z" } : {}) } }).card;
  const one = sent("Spend column", 41);
  const open = change(41, false);
  assert.equal(s.getCard(one.id).built, undefined, "an open pull request builds nothing yet");
  s.upsertCard({ id: open.id, source: { ...open.source, merged_at: "2026-11-01T10:00:00Z" } });
  assert.deepEqual([s.getCard(one.id).built.by, s.getCard(one.id).built.change], [{ agent: true }, open.id]);
  const two = sent("Tidy", 42);
  s.markBuilt(two.id, bob); s.markBuilt(two.id, bob, false);
  change(42, true);
  assert.equal(s.getCard(two.id).built, undefined, "Not done yet is a person's word");
  s.markBuilt(two.id, bob);
  assert.equal(s.getCard(two.id).built.by.email, bob.email);
});

test("a write on a card renews the claims on it; a claim on another card keeps its time", () => {
  let now = Date.UTC(2026, 9, 1, 8);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const one = s.createRequest(alice, { problem: "One." }), two = s.createRequest(alice, { problem: "Two." });
  s.claim(one.inbox.id, "run-1"); s.claim(two.inbox.id, "run-2");
  const at = s.item(one.inbox.id).claimed_at;
  now += 10 * 60e3;
  s.renewClaims({ card: one.card.id });
  assert.notEqual(s.item(one.inbox.id).claimed_at, at, "the lease starts again");
  assert.equal(s.item(one.inbox.id).claimed_started, at, "since when it is worked on stays");
  assert.equal(s.item(two.inbox.id).claimed_at, at);
  now += 10 * 60e3;
  assert.throws(() => s.claim(one.inbox.id, "run-3", { takeover: true }), /claimed by run-1/, "20 minutes after the claim, 10 after the write: still held");
  assert.equal(s.claim(two.inbox.id, "run-3", { takeover: true }).item.claimed_by, "run-3", "no write for 20 minutes: taken over");
  s.renewClaims({ thread: "T-999" }); s.renewClaims({});
});

test("People: an added person counts as opened once they loaded the Desk, whatever the letters' case", () => {
  const s = fresh();
  const admin = { email: "lee@example.com", role: "admin" };
  const roster = [{ email: "lee@example.com", role: "admin" }];
  const { inbox } = s.askForPerson(admin, { email: "dee@example.com", role: "designer" }, roster);
  s.claim(inbox.id, "run-1"); s.done(inbox.id, "run-1", "added");
  const opened = () => s.peopleAsks().find((a) => a.email === "dee@example.com").opened;
  assert.equal(opened(), false, "on the list, and the Desk not loaded yet");
  s.markOpened({ sub: "no-address" });
  assert.equal(opened(), false, "someone else's load, with no address, is not theirs");
  s.markOpened({ email: "Dee@Example.com", emails: ["Dee@Example.com"], role: "designer" });
  assert.equal(opened(), true, "a load alone counts: no card opened, no preference set");
  const at = s.db.opened["dee@example.com"];
  s.markOpened({ email: "dee@example.com", role: "designer" });
  assert.equal(s.db.opened["dee@example.com"], at, "the first load alone is kept");
});

test("a store from before the sign-in record starts it from who already used the Desk", () => {
  const s = fresh();
  const admin = { email: "lee@example.com", role: "admin" };
  for (const email of ["dee@example.com", "new@example.com"]) { const { inbox } = s.askForPerson(admin, { email, role: "designer" }, [{ email: "lee@example.com", role: "admin" }]); s.claim(inbox.id, "run-1"); s.done(inbox.id, "run-1", "added"); }
  // The store as an older version left it: no record, and Dee's preference under the address as she signed in.
  delete s.db.opened;
  s.db.prefs["Dee@Example.com"] = { theme: "dark" };
  s.db.seen["sub-123"] = "2026-10-01T08:00:00Z";
  s.save();
  const old = new Store(s.dir);
  const opened = (email) => old.peopleAsks().find((a) => a.email === email).opened;
  assert.equal(opened("dee@example.com"), true, "she set a preference: she loaded the Desk");
  assert.equal(opened("new@example.com"), false, "nothing known of them");
  assert.deepEqual(Object.keys(old.db.opened), ["dee@example.com"], "addresses only, lower-cased; a key that is no address is left out");
  old.markOpened({ email: "new@example.com", role: "designer" });
  assert.equal(new Store(s.dir).peopleAsks().find((a) => a.email === "new@example.com").opened, true, "a store with the record is read as it is");
});

test("a claimed item says how long its kind usually takes, once three of them finished", () => {
  let now = Date.UTC(2026, 9, 1, 8);
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const work = (minutes) => { const { card, inbox } = s.createRequest(alice, { problem: "x" }); s.claim(inbox.id, "run"); if (minutes != null) { now += minutes * 60e3; s.done(inbox.id, "run", "checked"); } return card; };
  work(4); work(20);
  assert.equal(s.getCard(work(null).id).waiting[0].usual_min, undefined, "two finished: no estimate yet");
  work(6);
  const w = s.getCard(work(null).id).waiting[0];
  assert.equal(w.usual_min, 6, "the median of 4, 6 and 20");
  assert.ok(w.started);
});

test("PR Changes and Issues: For Developers, a lead developer marks handled; a designer's otherwise", () => {
  const s = fresh();
  const lee = { email: "lee@example.com", role: "lead-developer" };
  const row = (id) => s.listCards().find((c) => c.id === id);
  const { card: small } = s.upsertCard({ kind: "change", title: "Tighter rows", source: { repo: "acme/widgets", pr: 11 }, attention: { level: "developer", reasons: ["spacing only"] } });
  assert.equal(row(small.id).for, "developers", "the agent's developer level puts it For Developers");
  assert.deepEqual(row(small.id).attention, { level: "developer", reasons: ["spacing only"] }, "not in Needs a designer");
  assert.equal(s.getCard(small.id).for, "developers", "the card read and the list read agree");
  assert.throws(() => s.handle(small.id, bob), (e) => e.status === 403, "a developer does not mark it");
  s.handle(small.id, lee);
  assert.equal(s.getCard(small.id).status, "handled");
  s.handle(small.id, lee, false);

  const { card: big } = s.upsertCard({ kind: "change", title: "A new settings page", source: { repo: "acme/widgets", pr: 12 }, attention: { level: "designer", reasons: ["a new screen"] } });
  assert.equal(row(big.id).for, "designers");
  assert.throws(() => s.handle(big.id, lee), (e) => e.status === 403 && /For Developers/.test(e.message), "For Designers stays a designer's");
  // A lead developer moves it; a difference from an approved design stays on its tab.
  s.setSize(big.id, lee, true);
  assert.deepEqual([row(big.id).for, row(big.id).attention.level], ["developers", "developer"]);
  s.handle(big.id, lee);
  assert.throws(() => s.setSize(big.id, lee, false), /already handled/);
  s.setSize(small.id, lee, false);
  assert.deepEqual([row(small.id).for, row(small.id).attention.level], ["designers", "designer"], "moved For Designers, it waits for a designer");

  // A change nobody needs to look at stays fyi: the page shows it auto handled.
  const { card: plain } = s.upsertCard({ kind: "change", title: "Same list", source: { repo: "acme/widgets", pr: 13 }, attention: { level: "fyi", reasons: ["follows the list pattern"] } });
  assert.deepEqual([row(plain.id).for, row(plain.id).attention.level], ["designers", "fyi"]);

  // Issues follow the same rules.
  const { card: is } = s.upsertCard({ kind: "issue", title: "Show the limit", status: "open", bucket: "sprint", source: { repo: "acme/widgets", issue: 5, url: "https://github.com/acme/widgets/issues/5" }, attention: { level: "developer", reasons: ["a column in the existing table"] } });
  assert.equal(row(is.id).for, "developers");
  assert.deepEqual(s.getCard(is.id).attention, { level: "developer", reasons: ["a column in the existing table"] }, "an issue's judgement reads back");
  assert.deepEqual(row(is.id).attention, s.getCard(is.id).attention, "the list read and the card read agree");
  s.handle(is.id, lee);
  assert.ok(s.getCard(is.id).handled);
  s.handle(is.id, lee, false);
  s.setSize(is.id, lee, false);
  assert.equal(row(is.id).for, "designers");
  assert.throws(() => s.handle(is.id, lee), (e) => e.status === 403);
  assert.equal(can("lead-developer", "handle-small"), true);
  assert.equal(can("developer", "handle-small"), false);
});

test("a merged change that builds an approved design adds its elements to the design catalog", () => {
  const s = fresh();
  const html = s.addAsset({ kind: "variant", contentType: "text/html", data: Buffer.from("<p>A</p>").toString("base64") }).asset.id;
  const pic = s.addAsset({ kind: "image", contentType: "image/png", data: Buffer.from("png").toString("base64") }).asset.id;
  const { card } = s.createRequest(alice, { title: "Daily limits", problem: "People do not see the limit." });
  s.upsertCard({ id: card.id, triage: { verdict: "design" }, status: "feedback", variants: [{ id: "v1", name: "Limits", asset: html, elements: [{ id: "banner", name: "Limit banner", change: "new", shot: pic }] }] });
  s.act(card.id, alice, "approve", "v1");
  s.upsertCard({ id: card.id, status: "handed-off" });
  const open = s.upsertCard({ kind: "change", title: "Limit banner", source: { repo: "acme/widgets", pr: 21 }, design_check: { request: card.id, verdict: "matches", summary: "As designed.", differences: [] } }).card;
  assert.equal(s.getCard(card.id).in_catalog, undefined, "not before it ships");
  s.upsertCard({ id: open.id, source: { repo: "acme/widgets", pr: 21, merged_at: "2026-11-10T10:00:00Z" } });
  const added = s.getCard(card.id).in_catalog.elements.banner;
  assert.equal(s.getCard(added).design.element, "banner");
  s.upsertCard({ id: open.id, summary: "Shipped." });
  assert.equal(s.listCards({ kind: "element" }).length, 1, "a second write adds nothing twice");
});

test("a request made from an open pull request: its spec waits, and goes back to that pull request as a comment", () => {
  const s = fresh();
  const { card: change } = s.upsertCard({ kind: "change", title: "Tighter rows", source: { repo: "acme/widgets", pr: 31, url: "https://github.com/acme/widgets/pull/31" } });
  const { card } = s.createRequest(alice, { title: "Airier rows", problem: "Too tight.", from: change.id });
  assert.deepEqual(s.getCard(card.id).from_pr, { card: change.id, pr: 31, repo: "acme/widgets", url: "https://github.com/acme/widgets/pull/31" });
  const spec = s.addAsset({ card: card.id, kind: "spec", name: "spec.md", contentType: "text/markdown", data: "# Spec", encoding: "utf8" }).asset.id;
  assert.throws(() => s.upsertCard({ id: card.id, status: "spec", spec: { asset: spec, review: "sent" } }), /waits for a person's Send/);
  s.upsertCard({ id: card.id, status: "spec", spec: { asset: spec, review: "draft" } });
  const { inbox: item } = s.specAction(card.id, alice, { action: "send", comment: true });
  assert.equal(item.comment_on, "https://github.com/acme/widgets/pull/31");
  assert.equal(s.getCard(card.id).spec.sent.implement, false);

  // Merged meanwhile: no comment route.
  const { card: other } = s.createRequest(alice, { title: "Bolder header", problem: "Too faint.", from: change.id });
  s.upsertCard({ id: change.id, source: { repo: "acme/widgets", pr: 31, url: "https://github.com/acme/widgets/pull/31", merged_at: "2026-11-10T10:00:00Z" } });
  assert.equal(s.getCard(other.id).from_pr, null);
});

test("every kind numbers its own series under its letter; items from before keep theirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "desk-store-"));
  // A store from before 1.78.0: cards C-n, an inbox item I-n, a vote P-n, a council S-n, and a
  // comparison with Figma and a sent design that had no number of their own.
  const frame = { url: "https://www.figma.com/design/AbC123/App?node-id=12-40", name: "Agents list" };
  writeFileSync(join(dir, "db.json"), JSON.stringify({ version: 1, seq: { card: 2, thread: 0, asset: 0, item: 4, decision: 0, poll: 2, council: 1 },
    cards: {
      "C-1": { id: "C-1", kind: "screen", title: "Agents list", status: "current", created: "2026-11-01T00:00:00Z", updated: "2026-11-01T00:00:00Z", figma_check: { verdict: "matches", frame, differences: [] }, threads: [] },
      "C-2": { id: "C-2", kind: "request", title: "Calmer header", status: "handed-off", created: "2026-11-02T00:00:00Z", updated: "2026-11-02T00:00:00Z", threads: [], sends: [{ closed: { at: "2026-11-02T00:00:00Z" }, threads: [] }],
        polls: [{ id: "P-2", state: "closed" }], councils: [{ id: "S-1", state: "closed" }] } },
    threads: {}, assets: {}, inbox: { "I-4": { id: "I-4", kind: "request", card: "C-2", state: "done" } }, decisions: {} }));
  const s = new Store(dir);
  assert.equal(s.card("C-1").figma_check.id, "F-1", "a comparison from before gets its number");
  assert.deepEqual([s.card("C-2").sends[0].design_id, s.card("C-2").design_id], ["G-1", "G-2"], "an earlier send first, then the one now");
  assert.equal(s.card("F-1").id, "C-1", "a comparison's number names its card");
  assert.equal(s.card("G-1").id, "C-2", "so does a sent design's");
  // New items: their own letter, each series from 1; a letter used before goes on past it.
  const change = s.upsertCard({ kind: "change", title: "A new header", source: { repo: "acme/widgets", pr: 7 } }).card;
  const screen = s.upsertCard({ kind: "screen", title: "Billing", path: "/billing" }).card;
  const req = s.createRequest(alice, { title: "Quieter list", problem: "It shouts." });
  assert.deepEqual([change.id, screen.id, req.card.id, req.inbox.id], ["P-3", "S-2", "R-1", "Q-1"]);
  const element = s.upsertCard({ kind: "element", title: "Button" }).card;
  const issue = s.upsertCard({ kind: "issue", title: "Spend per agent" }).card;
  const week = s.upsertCard({ kind: "digest", title: "Week 45" }).card;
  assert.deepEqual([element.id, issue.id, week.id], ["E-1", "I-5", "W-1"]);
  const checked = s.upsertCard({ id: screen.id, figma_check: { verdict: "matches", frame, differences: [] } }).card;
  assert.equal(checked.figma_check.id, "F-2");
  assert.equal(s.upsertCard({ id: screen.id, figma_check: { verdict: "matches", frame, differences: [] } }).card.figma_check.id, "F-2", "compared again, it keeps its number");
  assert.equal(s.listCards({ kind: "screen" }).find((c) => c.id === screen.id).figma.id, "F-2");
});

test("a change card's environment: https only, keeps when it was deployed, cleared by null", () => {
  let now = "2026-11-02T08:00:00Z";
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => now });
  const env = { url: "https://app-pr-7.env.example.com", label: "demo", login: { hint: "your platform account" }, steps: ["Open the agents list"], missing: "No processes there." };
  const c = s.upsertCard({ kind: "change", title: "Filter agents by owner", source: { repo: "acme/widgets", pr: 7 }, environment: env }).card;
  assert.deepEqual(c.environment, { ...env, since: "2026-11-02T08:00:00Z", expires: null, login: { user: "", password: "", hint: "your platform account" } });
  // The same address keeps its first date; a new one starts again; the agent's own date wins.
  now = "2026-11-05T08:00:00Z";
  assert.equal(s.upsertCard({ id: c.id, environment: env }).card.environment.since, "2026-11-02T08:00:00Z");
  assert.equal(s.upsertCard({ id: c.id, environment: { ...env, url: "https://app-pr-7b.env.example.com" } }).card.environment.since, "2026-11-05T08:00:00Z");
  assert.equal(s.upsertCard({ id: c.id, environment: { ...env, since: "2026-11-01T10:00:00.000Z" } }).card.environment.since, "2026-11-01T10:00:00Z");
  assert.throws(() => s.upsertCard({ id: c.id, environment: { url: "http://app.example.com" } }), /https/);
  assert.throws(() => s.upsertCard({ id: c.id, environment: { ...env, since: "soon" } }), /date/);
  assert.equal(s.upsertCard({ id: c.id, environment: { ...env, expires: "2026-11-19T08:00:00.000Z" } }).card.environment.expires, "2026-11-19T08:00:00Z");
  assert.equal(s.upsertCard({ id: c.id, environment: null }).card.environment, null);
});

test("a request keeps how its screen looks today, and Draw how it looks today queues only that", () => {
  const s = fresh();
  const { card } = s.createRequest(bob, { title: "Calmer header", problem: "The header shouts." });
  assert.throws(() => s.act(card.id, alice, "draw-now"), /still checking/);
  const asset = s.addAsset({ kind: "variant", name: "now", contentType: "text/html", data: "<b>today</b>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "variants", triage: { verdict: "design", reasons: ["Only the look."] }, variants: [{ id: "v1", name: "Grey", asset }] });
  const res = s.act(card.id, alice, "draw-now");
  assert.deepEqual([res.inbox.kind, res.inbox.scope], ["explore", "now"]);
  assert.equal(res.card.status, "variants", "the status stays as it is");
  assert.throws(() => s.act(card.id, alice, "draw-now"), /already|busy|working|wait/i, "a second ask for it waits");
  assert.equal(s.openFeedback(card.id, alice).card.status, "feedback", "the team is asked while it draws");
  assert.equal(s.act(card.id, alice, "add-option", "A darker one").inbox.scope, "add", "the options' own work goes on");
  assert.throws(() => s.upsertCard({ id: card.id, now: { asset: "A-999" } }), /no asset/);
  s.upsertCard({ id: card.id, now: { asset, name: "Orders" } });
  assert.deepEqual([s.card(card.id).now.asset, s.card(card.id).now.name], [asset, "Orders"]);
  s.upsertCard({ id: card.id, now: null });
  assert.equal(s.card(card.id).now, null);
});
