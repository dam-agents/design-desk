// node --test desk/tests/store.test.mjs — the Desk store: roles, the inbox, claims and answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, can, DeskError, ACTIONS, abilities, rosterOf } from "../store.mjs";

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
  assert.equal(can("pm", "explore"), false);
  assert.equal(can("lead", "add"), true);
});

test("the roster: the first row of an email counts, an unknown role is a guest's", () => {
  assert.deepEqual(rosterOf([{ email: " Alice@Example.com ", role: "Designer" }, { email: "alice@example.com", role: "lead" }, { email: "dave@example.com", role: "ops" }, { email: "", role: "pm" }]),
    [{ email: "alice@example.com", role: "designer" }, { email: "dave@example.com", role: "guest" }]);
});

test("a lead asks for a new person: one item with no card, the roster and open asks refuse twins", () => {
  assert.equal(can("lead", "people"), true);
  assert.equal(can("designer", "people"), false);
  const s = fresh();
  const lead = { email: "lee@example.com", role: "lead" };
  const roster = [{ email: "alice@example.com", role: "designer" }];
  const { inbox: item } = s.askForPerson(lead, { email: " Alex@Example.com ", role: "pm" }, roster);
  assert.equal(item.card, null);
  assert.deepEqual(inbox(s).open.map((i) => [i.kind, i.person]), [["person", { email: "alex@example.com", role: "pm" }]]);
  assert.throws(() => s.askForPerson(lead, { email: "alex@example.com", role: "designer" }, roster), /already working/);
  assert.throws(() => s.askForPerson(lead, { email: "alice@example.com", role: "pm" }, roster), /already on the list/);
  assert.throws(() => s.askForPerson(lead, { email: "carol@example.com", role: "lead" }, roster), /role must be one of/);
  assert.throws(() => s.askForPerson(lead, { email: "a|b@example.com", role: "pm" }, roster), /not an email/);
  // The agent claims it without a card and answers it with its outcome.
  assert.equal(item.by.owner, undefined, "a roster lead is not the owner");
  assert.equal(s.askForPerson({ email: "own@example.com", role: "lead" }, { email: "dee@example.com", role: "developer" }, roster, { owner: true }).inbox.by.owner, true);
  assert.equal(s.claim(item.id, "run-1").card, null);
  s.done(item.id, "run-1", "added");
  // An item without its payload (an older store, a hand-made one) never breaks the list.
  s.enqueue("person", null, null, lead);
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

test("a change card stays short, and a designer marks it handled", () => {
  const s = fresh();
  assert.throws(() => s.upsertCard({ kind: "change", title: "x".repeat(91) }), /longer than 90/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", summary: "y".repeat(181) }), /longer than 180/);
  assert.throws(() => s.upsertCard({ kind: "change", title: "One", sections: [{ key: "what", title: "What changed", body: "z".repeat(401), source: { label: "PR #9" } }] }), /longer than 400/);
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
  assert.throws(() => s.handle(r.id, alice), /only a change/);
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

test("a small change: a lead developer marks it, any developer but its author approves, the card says who", () => {
  const s = fresh();
  const lee = { email: "lee@example.com", role: "lead-developer" };
  const dana = { email: "dana@example.com", role: "developer" };
  assert.equal(can("lead-developer", "size"), true);
  assert.equal(can("lead", "size"), true);
  for (const r of ["designer", "developer", "pm", "guest"]) assert.equal(can(r, "size"), false, r);
  assert.equal(can("lead-developer", "approve"), false, "a developer approves only a small change, per card");
  assert.deepEqual(rosterOf([{ email: "x@example.com", role: "Lead Developer" }]), [{ email: "x@example.com", role: "lead-developer" }]);

  const { card, inbox: item } = s.createRequest(bob, { title: "Tighter row spacing", problem: "Rows are too airy." });
  s.claim(item.id, "s1"); s.done(item.id, "s1", "triaged");
  s.upsertCard({ id: card.id, status: "feedback", triage: { verdict: "design", reasons: ["Spacing only."] } });
  assert.equal(s.attentionOf(s.card(card.id)).level, "designer", "options ready: a designer's, until it is a small change");
  assert.throws(() => s.act(card.id, dana, "approve"), (e) => e.status === 403 && /Only designers/.test(e.message), "not a small change yet: a designer's");
  assert.throws(() => s.setSize(card.id, lee, "yes"), /true or false/);
  const marked = s.setSize(card.id, lee, true).card;
  assert.deepEqual(marked.size, { small: true, by: { email: "lee@example.com", role: "lead-developer" }, at: marked.size.at });
  assert.equal(s.attentionOf(marked), null, "a small change waits for a developer, not a designer");
  assert.throws(() => s.act(card.id, bob, "approve"), (e) => e.status === 403 && /You filed this request/.test(e.message));
  assert.throws(() => s.act(card.id, { email: "pat@example.com", role: "pm" }, "approve"), (e) => e.status === 403);
  const ok = s.act(card.id, dana, "approve");
  assert.equal(ok.inbox.kind, "handoff");
  assert.deepEqual(ok.card.approved, { by: { email: "dana@example.com", role: "developer" }, at: ok.card.approved.at, small: true });

  s.act(card.id, alice, "close");
  assert.throws(() => s.setSize(card.id, lee, false), /closed/);
  s.act(card.id, alice, "reopen");
  assert.equal(s.card(card.id).approved, undefined, "a reopened request waits for a new approval");
  assert.equal(s.setSize(card.id, lee, false).card.size.small, false);
});

test("a small change: the reporter of a request the agent filed is its author; a decision in force needs a designer", () => {
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
  for (const r of ["lead", "designer", "lead-developer"]) assert.equal(can(r, "skip"), true, r);
  for (const r of ["developer", "pm", "guest"]) assert.equal(can(r, "skip"), false, r);

  const { card, inbox: item } = s.createRequest(bob, { title: "Calmer header", problem: "The header shouts." });
  assert.throws(() => s.act(card.id, lee, "approve"), /still checking/, "not before it is checked");
  assert.throws(() => s.act(card.id, lee, "approve"), /Approve it once/, "the refusal names the approval");
  assert.throws(() => s.decideAndClose(card.id, lee, { text: "No." }), /Decide it once/, "nor decided");
  assert.throws(() => s.decideAndClose(card.id, { agent: true }, { text: "No." }), (e) => e.status === 403 && e.message === "Design Desk does not decide: a person does");
  s.claim(item.id, "s1"); s.upsertCard({ id: card.id, triage: { verdict: "design", reasons: ["Only the look."] } }); s.done(item.id, "s1", "triaged");
  assert.throws(() => s.act(card.id, dana, "approve"), /nothing to approve yet/, "a developer waits for options, small change or not");
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
  const brief = { text: "People see each agent's weekly spend.", url: "https://github.com/acme/widgets/issues/41", stories: [{ id: "s1", text: "As a lead I see what each agent spends." }, { id: "s2", text: "I can sort by spend.", derived: true }] };
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

test("only a designer picks the winning option; votes only suggest one", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "Two ways to show the plan." });
  const triaged = Object.values(s.db.inbox).find((i) => i.card === card.id);
  s.claim(triaged.id, "run-1"); s.done(triaged.id, "run-1", "checked");
  const a = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Table", asset: a }, { id: "v2", name: "Cards", asset: a }] });
  s.vote(card.id, alice, { variant: "v1", vote: "prefer" });
  assert.equal(can("designer", "choose"), true);
  assert.equal(can("pm", "choose"), false);
  assert.throws(() => s.choose(card.id, { agent: true }, "v2"), (e) => e.status === 403);
  assert.throws(() => s.choose(card.id, alice, "v9"), /Pick one/);
  assert.equal(s.choose(card.id, alice, "v2").card.chosen.variant, "v2");
  assert.match(s.getCard(card.id).attention.reasons.join(), /picked an option/);
  // The agent's card writes never carry the pick.
  s.upsertCard({ id: card.id, chosen: { variant: "v1" } });
  assert.equal(s.getCard(card.id).chosen.variant, "v2");
  // The next call presents the designer's pick, not the vote's favourite.
  assert.equal(s.queueForCall(card.id, alice).card.agenda.variant, "v2");
  assert.equal(s.choose(card.id, alice, null).card.chosen, undefined);
  s.choose(card.id, alice, "v2");
  s.upsertCard({ id: card.id, variants: [{ id: "v1", version: 1, name: "Table", asset: a }, { id: "v2", drop: true }] });
  assert.equal(s.getCard(card.id).chosen, undefined, "an option that is gone is no longer the winner");
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

test("Send designs to Slack is one slack item scoped send, and needs options", () => {
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

test("Slack reactions become votes, a Desk vote wins, and a Slack reply is relayed once", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const a = s.addAsset({ kind: "variant", name: "v", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "One button", asset: a }] });
  assert.throws(() => s.act(card.id, alice, "slack-share", "{}") && s.act(card.id, alice, "slack-share", "{}"), /already working/);
  const { poll } = s.openPoll(card.id, { chat: "C0123", root_ts: "1.0", posts: [{ variant: "v1", ts: "1.1" }], closes: "2026-11-06T14:00:00Z" });
  assert.deepEqual(s.findPoll("1.1"), { card: card.id, poll: poll.id, state: "open", variant: "v1" });
  s.vote(card.id, alice, { variant: "v1", vote: "concern" });
  s.slackVotes(card.id, "v1", [{ key: alice.email, vote: "prefer" }, { key: "slack:U1", vote: "prefer", name: "Jana" }]);
  assert.equal(s.getCard(card.id).votes.v1[alice.email].vote, "concern");
  assert.equal(s.getCard(card.id).votes.v1["slack:U1"].via, "slack");
  s.slackVotes(card.id, "v1", []);
  assert.equal(s.getCard(card.id).votes.v1["slack:U1"], undefined);
  // The agent's own legend 👍/⚠️ comes back among the reactions; it is a bot's, not a vote.
  s.slackVotes(card.id, "v1", [{ key: "slack:UBOT", vote: "prefer", is_bot: true, name: "Design Desk" },
    { key: "slack:U2", vote: "concern", name: "Petr" }]);
  assert.equal(s.getCard(card.id).votes.v1["slack:UBOT"], undefined, "a bot's reaction is never a vote");
  assert.equal(s.getCard(card.id).votes.v1["slack:U2"].vote, "concern");
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
  assert.equal(council.id, "S-1");
  assert.deepEqual(s.findCouncil("2.0"), { card: card.id, council: "S-1", state: "open" });
  const other = s.createRequest(alice, { problem: "Another." }).card;
  assert.equal(s.openCouncil(other.id, { chat: "C0123", thread_ts: "2.0" }).duplicate, true);
  s.updateCouncil(card.id, "S-1", { synced: "2026-11-02T10:00:00Z", seen: "2.5" });
  assert.equal(s.getCard(card.id).councils[0].seen, "2.5");
  assert.equal(s.updateCouncil(card.id, "S-1", { result: "Agreed on One button v2" }).council.state, "closed");
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

test("the next call: the agent suggests, a designer adds it with the option to present", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  const a1 = s.addAsset({ kind: "variant", name: "v1", contentType: "text/html", data: "<p>1</p>", encoding: "utf8" }).asset.id;
  s.upsertCard({ id: card.id, status: "feedback", variants: [{ id: "v1", name: "Calm", asset: a1 }, { id: "v2", name: "Loud", asset: a1 }] });
  assert.throws(() => s.queueForCall(card.id, { agent: true }), (e) => e.status === 403);
  s.suggestForCall(card.id, "Design Desk proposes");
  assert.equal(s.agenda().length, 0, "a suggestion is not on the call");
  assert.equal(s.listCards().find((c) => c.id === card.id).suggested.note, "Design Desk proposes");
  assert.throws(() => s.dismissSuggestion(card.id, bob), (e) => e.status === 403);
  assert.throws(() => s.queueForCall(card.id, alice, "Pick one", "v9"), (e) => e.status === 400, "an unknown option is refused");
  const { inbox: item } = s.queueForCall(card.id, alice, "Pick one", "v2");
  assert.equal(item.kind, "agenda");
  assert.deepEqual(s.agenda().map((a) => [a.option, a.agenda.variant]), [["Loud", "v2"]]);
  assert.equal(s.getCard(card.id).call_suggestion, undefined, "adding it takes the suggestion away");
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

test("the next call: a designer's Not now holds, a closed request takes no suggestion", () => {
  const s = fresh();
  const { card } = s.createRequest(alice, { problem: "The empty list shouts." });
  s.suggestForCall(card.id, "Design Desk proposes");
  s.dismissSuggestion(card.id, alice);
  assert.equal(s.suggestForCall(card.id, "Design Desk proposes again").reason, "a designer said Not now to it");
  assert.equal(s.getCard(card.id).call_suggestion, undefined, "Not now is not undone by the next suggestion");
  const { card: other } = s.createRequest(alice, { problem: "The header is too tall." });
  s.suggestForCall(other.id, "Slack vote: a tie");
  s.act(other.id, alice, "close");
  assert.equal(s.getCard(other.id).call_suggestion, undefined, "closing a request drops its suggestion");
  s.suggestForCall(other.id, "Again");
  assert.equal(s.getCard(other.id).call_suggestion, undefined, "a closed request takes no suggestion");
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
  assert.equal(can("pm", "history"), false);
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
  s.suggestForCall(req.id, "A decision is due");
  assert.deepEqual(att(req.id).reasons, ["Suggested for the presentation"], "a suggestion waits for a designer even while Design Desk works");
  s.act(req.id, alice, "close");
  assert.equal(att(req.id), null, "a closed request waits for nobody");

  // A suggestion keeps a handed-off request in the filter, and every read agrees.
  const { card: shipped } = s.createRequest(alice, { problem: "The header is too tall." });
  s.upsertCard({ id: shipped.id, status: "handed-off" });
  assert.equal(att(shipped.id), null);
  s.suggestForCall(shipped.id, "Worth showing");
  assert.deepEqual(att(shipped.id), { level: "designer", reasons: ["Suggested for the presentation"] });
  assert.deepEqual(s.getCard(shipped.id).attention, att(shipped.id), "the card read and the list read agree");
  s.suggestForCall(change.id, "A new pattern");
  assert.deepEqual(s.getCard(change.id).attention, { level: "designer", reasons: ["Suggested for the presentation"] }, "a suggestion outranks the agent's fyi");
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
  assert.deepEqual(s.attentionOf(s.card(c.id)).reasons, [`Goes against ${d.id}`]);
  assert.equal(s.getCard(c.id).conflicts[0].text, "Prices show tax");
  assert.deepEqual(s.getDecision(d.id).refs.map((r) => [r.id, r.how]), [[c.id, "conflicts"]]);
  s.db.cards[c.id].status = "feedback";
  assert.throws(() => s.act(c.id, alice, "approve"), (e) => e instanceof DeskError && e.status === 409 && /goes against D-1/.test(e.message));
  assert.deepEqual(s.act(c.id, alice, "approve", "", { overrule: true }).card.overruled.decisions, [d.id]);
  assert.throws(() => s.revokeDecision(d.id, alice, { reason: "" }), /reason is empty/);
  s.revokeDecision(d.id, alice, { reason: "We show net prices now." });
  assert.deepEqual([s.db.decisions[d.id].status, s.db.decisions[d.id].revoked.by.email], ["revoked", alice.email]);
  assert.equal(s.listCards().find((x) => x.id === c.id).conflicts, 0);
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
  assert.deepEqual(refs, [{ key: "acme/widgets#7", updated: at(71) }]);
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

test("the new actions' roles: drawing is a designer's or developer's, removing an option a designer's", () => {
  for (const a of ["explore", "revise"]) { assert.equal(can("developer", a), true, a); assert.equal(can("pm", a), false, a); }
  assert.equal(can("designer", "choose"), true);
  assert.equal(can("developer", "choose"), false);
});
