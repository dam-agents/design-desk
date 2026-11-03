// node --test desk/tests/store.test.mjs — the Desk store: roles, the inbox, claims and answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
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
  assert.equal(can("developer", "add"), false);
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

test("claims: one session per item, takeover only past the TTL", () => {
  let now = "2026-10-30T10:00:00Z";
  const s = new Store(mkdtempSync(join(tmpdir(), "desk-store-")), { clock: () => now });
  const { inbox: item } = s.createRequest(alice, { title: "Calmer empty state", problem: "It shouts." });
  s.claim(item.id, "s1");
  assert.throws(() => s.claim(item.id, "s2"), (e) => e instanceof DeskError && e.status === 409);
  now = "2026-10-30T11:00:00Z";
  assert.throws(() => s.claim(item.id, "s2", { takeover: true }), /claimed by s1/);
  now = "2026-10-30T13:00:00Z";
  assert.equal(s.claim(item.id, "s2", { takeover: true }).item.claimed_by, "s2");
  assert.throws(() => s.done(item.id, "s1"), /claimed by s2/);
  assert.equal(s.done(item.id, "s2", "triaged").item.state, "done");
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
  const v = s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "One button", asset: a2 }] }).card.variants[0];
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
  s.upsertCard({ id: card.id, variants: [{ id: "v1", name: "Table", asset: a }] });
  assert.equal(s.getCard(card.id).chosen, undefined, "an option that is gone is no longer the winner");
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
  s.addDecision({ concepts: ["Spend"], text: "Spend is per week.", source: { card: card.id } });
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
  assert.equal(can("developer", "history"), false);
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
  assert.deepEqual(att(req.id).reasons, ["Checked: draw options or close it"]);
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

test("Draw it: a designer or a PM queues a drawing of an issue, once", () => {
  const s = fresh();
  const pm = { email: "pat@example.com", role: "pm" };
  assert.equal(can("pm", "draw"), true);
  assert.equal(can("developer", "draw"), false);
  assert.equal(can("guest", "draw"), false);
  const c = s.upsertCard({ kind: "issue", title: "A calmer empty Home", bucket: "backlog", needs: ["An empty state on Home"], source: { repo: "acme/widgets", issue: 31 } }).card;
  const { inbox: item } = s.act(c.id, pm, "draw", "try a checklist");
  assert.equal(item.kind, "draw");
  assert.throws(() => s.act(c.id, pm, "draw"), /already working/);
  assert.throws(() => s.act(c.id, pm, "explore"), /can only be drawn/);
  assert.deepEqual(s.getCard(c.id).waiting.map((w) => w.kind), ["draw"]);
  s.upsertCard({ id: c.id, status: "archived" });
  const d = s.upsertCard({ kind: "issue", title: "Closed one", bucket: "backlog", source: { repo: "acme/widgets", issue: 32 }, status: "archived" }).card;
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
