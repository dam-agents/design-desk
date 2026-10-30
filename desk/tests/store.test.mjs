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
  assert.throws(() => s.act(card.id, alice, "approve"), /already waiting/);
});

test("input limits and asset size are enforced", () => {
  const s = fresh();
  assert.throws(() => s.createRequest(alice, { title: "x".repeat(201), problem: "y" }), /longer than 200/);
  assert.throws(() => s.addAsset({ kind: "screen", contentType: "image/png", data: Buffer.alloc(800 * 1024).toString("base64") }), /at most/);
  const { asset } = s.addAsset({ kind: "variant", contentType: "text/html", encoding: "utf8", data: "<p>hi</p>" });
  assert.equal(s.getAsset(asset.id).data, "<p>hi</p>");
});
