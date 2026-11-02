// node --test toolkit/tests/roster.test.mjs — the one row a lead's ask adds to ## Desk people.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
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

test("design config write: only over the file as it was read, and always under the lock", async () => {
  const { writeIfUnchanged, Changed } = await import("../bin/config.mjs");
  const { configSha } = await import("../lib/core.mjs");
  const work = mkdtempSync(join(tmpdir(), "config-"));
  writeFileSync(join(work, "CONFIG.md"), CONFIG);
  const read = configSha(CONFIG);
  // A lead's row lands between the operator's read and write: the write is refused, the row stays.
  addRosterRow(work, "alex@example.com", "pm");
  assert.throws(() => writeIfUnchanged(work, CONFIG.replace("Desk", "Studio"), read), (e) => e instanceof Changed);
  assert.match(readFileSync(join(work, "CONFIG.md"), "utf8"), /alex@example\.com/);
  const now = readFileSync(join(work, "CONFIG.md"), "utf8");
  writeIfUnchanged(work, now.replace("display_name: Desk", "display_name: Studio"), configSha(now));
  assert.match(readFileSync(join(work, "CONFIG.md"), "utf8"), /display_name: Studio[\s\S]*alex@example\.com/);
  assert.equal(existsSync(join(work, ".CONFIG.lock")), false);
});

// Two writers that meet one dead holder's lock (the review's reproduction): both changes land.
test("the lock: a dead holder's file goes, and two waiters never both take it", async () => {
  const core = new URL("../lib/core.mjs", import.meta.url).href;
  for (let round = 0; round < 5; round++) {
    const work = mkdtempSync(join(tmpdir(), "config-race-"));
    writeFileSync(join(work, "CONFIG.md"), CONFIG);
    mkdirSync(join(work, ".CONFIG.lock"));
    writeFileSync(join(work, ".CONFIG.lock", "999999999-dead"), "");
    const writer = (email) => new Promise((ok, no) => {
      const p = spawn(process.execPath, ["--input-type=module", "-e", `import { writeConfig, withRosterRow } from ${JSON.stringify(core)};
        writeConfig(${JSON.stringify(work)}, (t) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30); return withRosterRow(t, ${JSON.stringify(email)}, "pm"); });`], { stdio: "inherit" });
      p.on("exit", (code) => (code === 0 ? ok() : no(new Error(`writer exited ${code}`))));
    });
    await Promise.all([writer("a@example.com"), writer("b@example.com")]);
    const text = readFileSync(join(work, "CONFIG.md"), "utf8");
    assert.match(text, /a@example\.com/); assert.match(text, /b@example\.com/);
    assert.equal(existsSync(join(work, ".CONFIG.lock")), false);
  }
});

test("the lock: a live holder's lock is waited for, never taken", async () => {
  const { lockDir } = await import("../lib/core.mjs");
  const lock = join(mkdtempSync(join(tmpdir(), "config-live-")), ".CONFIG.lock");
  mkdirSync(lock); writeFileSync(join(lock, `${process.pid}-live`), "");
  utimesSync(lock, new Date(0), new Date(0));
  assert.throws(() => lockDir(lock, { timeoutMs: 300 }), /stayed locked/);
  assert.equal(existsSync(join(lock, `${process.pid}-live`)), true);
});
