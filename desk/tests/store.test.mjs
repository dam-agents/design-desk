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
  assert.throws(() => s.upsertCard({ kind: "change", title: "Ghost", summary: "x".repeat(700) }), /longer than 600/);
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
  assert.deepEqual(att(req.id).reasons, ["Suggested for the next call"], "a suggestion waits for a designer even while Design Desk works");
  s.act(req.id, alice, "close");
  assert.equal(att(req.id), null, "a closed request waits for nobody");

  // A suggestion keeps a handed-off request in the filter, and every read agrees.
  const { card: shipped } = s.createRequest(alice, { problem: "The header is too tall." });
  s.upsertCard({ id: shipped.id, status: "handed-off" });
  assert.equal(att(shipped.id), null);
  s.suggestForCall(shipped.id, "Worth showing");
  assert.deepEqual(att(shipped.id), { level: "designer", reasons: ["Suggested for the next call"] });
  assert.deepEqual(s.getCard(shipped.id).attention, att(shipped.id), "the card read and the list read agree");
  s.suggestForCall(change.id, "A new pattern");
  assert.deepEqual(s.getCard(change.id).attention, { level: "designer", reasons: ["Suggested for the next call"] }, "a suggestion outranks the agent's fyi");
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
