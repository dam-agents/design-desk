// node --test desk/tests — the Desk store: roles, the inbox, claims and answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, can, DeskError } from "../store.mjs";

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
