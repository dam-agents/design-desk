// node --test toolkit/tests/roster.test.mjs — the one row a lead's ask adds to ## Desk people.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withRosterRow } from "../lib/core.mjs";
import { personVerdict, addRosterRow } from "../bin/desk.mjs";

const CONFIG = "- display_name: Desk\n\n## Desk people\n\n| email | role |\n| --- | --- |\n| lee@example.com | lead |\n\n## Skills\n\n| action | skill |\n";

test("the row goes after the table's last row, and nothing else changes", () => {
  const out = withRosterRow(CONFIG, "alex@example.com", "pm");
  assert.equal(out, CONFIG.replace("| lee@example.com | lead |\n", "| lee@example.com | lead |\n| alex@example.com | pm |\n"));
});

test("no table yet: one at the end", () => {
  assert.match(withRosterRow("- display_name: Desk\n", "alex@example.com", "pm"), /\n## Desk people\n\n\| email \| role \|\n\| --- \| --- \|\n\| alex@example\.com \| pm \|\n$/);
});

test("an email on the list, or a cell that breaks the table, is refused", () => {
  assert.throws(() => withRosterRow(CONFIG, "LEE@example.com", "pm"), /already on the list/);
  assert.throws(() => withRosterRow(CONFIG, "a|b@example.com", "pm"), /cannot go in the table/);
  assert.throws(() => withRosterRow(CONFIG, "a@example.com", "pm\n| x | lead"), /cannot go in the table/);
});

// The ask as the store writes it: a roster lead's, or the owner's (by.owner).
const ask = (by, role = "pm", email = "alex@example.com") => ({ kind: "person", person: { email, role }, by });

test("the re-check: a lead or the owner adds; a demoted lead does not; a row already there is added", () => {
  assert.deepEqual(personVerdict(ask({ email: "lee@example.com", role: "lead" }), CONFIG), { write: true });
  assert.deepEqual(personVerdict(ask({ email: "own@example.com", role: "lead", owner: true }), CONFIG), { write: true }, "the owner is not on the roster");
  const demoted = CONFIG.replace("| lee@example.com | lead |", "| lee@example.com | designer |");
  assert.match(personVerdict(ask({ email: "lee@example.com", role: "lead" }), demoted).outcome, /^not added: lee@example\.com is no longer a lead/);
  assert.match(personVerdict(ask({ email: "own@example.com", role: "lead", owner: true }, "lead"), CONFIG).outcome, /^not added: a lead cannot give the role lead/);
  const written = withRosterRow(CONFIG, "alex@example.com", "pm");
  assert.deepEqual(personVerdict(ask({ email: "lee@example.com", role: "lead" }), written), { outcome: "added" }, "a run that died before done");
  assert.match(personVerdict(ask({ email: "lee@example.com", role: "lead" }, "designer"), written).outcome, /already on the list/);
});

test("the write: under the lock, once; a dead writer's lock is taken over", () => {
  const work = mkdtempSync(join(tmpdir(), "roster-"));
  writeFileSync(join(work, "CONFIG.md"), CONFIG);
  const lock = join(work, ".CONFIG.lock");
  mkdirSync(lock);
  const old = new Date(Date.now() - 120 * 1000); utimesSync(lock, old, old);
  addRosterRow(work, "alex@example.com", "pm");
  assert.equal(readFileSync(join(work, "CONFIG.md"), "utf8"), withRosterRow(CONFIG, "alex@example.com", "pm"));
  assert.equal(existsSync(lock), false, "the lock is released");
  assert.throws(() => addRosterRow(work, "alex@example.com", "pm"), /already on the list/);
  assert.equal(existsSync(lock), false, "a refused write releases the lock too");
});
