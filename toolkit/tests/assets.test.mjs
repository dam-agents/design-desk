// The handoff bundle on the product's design-desk/assets branch (docs/handoff.md → The bundle):
// an orphan, one commit per handoff, nothing outside .design-desk/handoff/R-<n>/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSETS_BRANCH, commitAssets, outside } from "../bin/assets.mjs";
import { existsSync } from "node:fs";

// No identity anywhere, as in a clone from scripts/checkout.sh on a sandbox with no global one:
// the seed commits below name theirs, the command must bring its own.
for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL", "EMAIL"]) delete process.env[k];
Object.assign(process.env, { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" });
const git = (dir, ...a) => {
  const r = spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

// A product repository with a default branch, and a clone of it as checkout.sh leaves one.
function product() {
  const root = mkdtempSync(join(tmpdir(), "design-desk-assets-"));
  const origin = join(root, "origin.git"), seed = join(root, "seed"), clone = join(root, "clone");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "init", "-q", "-b", "main", seed);
  writeFileSync(join(seed, "app.js"), "ui\n");
  git(seed, "add", "app.js"); git(seed, "commit", "-q", "-m", "product");
  git(seed, "push", "-q", origin, "main");
  git(root, "clone", "-q", origin, clone);
  return { root, origin, clone };
}

function bundle(root, name, files) {
  const dir = join(root, name);
  for (const [p, text] of Object.entries(files)) { mkdirSync(join(dir, p, ".."), { recursive: true }); writeFileSync(join(dir, p), text); }
  return dir;
}

test("the first handoff makes design-desk/assets an orphan holding only its folder", (t) => {
  const { root, origin, clone } = product();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const head = git(clone, "rev-parse", "HEAD");
  const out = commitAssets(clone, "R-8", bundle(root, "b8", { "design.json": "{}\n", "pictures/A-1.webp": "x", "shots/s1.webp": "y" }));
  assert.equal(out.branch, ASSETS_BRANCH);
  assert.equal(out.parent, null);
  assert.equal(out.push, `${out.sha}:refs/heads/design-desk/assets`);
  assert.deepEqual(git(clone, "ls-tree", "-r", "--name-only", out.sha).split("\n"),
    [".design-desk/handoff/R-8/design.json", ".design-desk/handoff/R-8/pictures/A-1.webp", ".design-desk/handoff/R-8/shots/s1.webp"]);
  assert.equal(git(clone, "rev-list", "--count", out.sha), "1", "a root commit");
  assert.equal(git(clone, "log", "-1", "--format=%an <%ae>", out.sha), "design-desk <design-desk@agents.local>", "a clone with no identity gets the Desk's");
  assert.equal(git(clone, "rev-parse", "HEAD"), head, "the clone's checkout is left alone");
  assert.equal(git(clone, "status", "--porcelain"), "", "and its index too");
  git(clone, "push", "-q", origin, out.push);
  assert.equal(spawnSync("git", ["-C", clone, "merge-base", "origin/HEAD", out.sha]).status, 1, "no history shared with main");
});

test("a later handoff adds one commit on top, and a resend replaces only its own folder", (t) => {
  const { root, origin, clone } = product();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const a = commitAssets(clone, "R-8", bundle(root, "b8", { "design.json": "{}\n", "shots/old.webp": "o" }));
  git(clone, "push", "-q", origin, a.push);
  const b = commitAssets(clone, "R-9", bundle(root, "b9", { "design.json": "{\"r\":9}\n" }));
  assert.equal(b.parent, a.sha);
  git(clone, "push", "-q", origin, b.push);
  const c = commitAssets(clone, "R-8", bundle(root, "b8again", { "design.json": "{\"k\":2}\n" }));
  assert.equal(c.parent, b.sha);
  assert.deepEqual(git(clone, "ls-tree", "-r", "--name-only", c.sha).split("\n"),
    [".design-desk/handoff/R-8/design.json", ".design-desk/handoff/R-9/design.json"], "the old shot is gone, R-9 stays");
  assert.equal(git(clone, "cat-file", "-p", `${a.sha}:.design-desk/handoff/R-8/shots/old.webp`), "o", "an older commit still has what its comment shows");
});

test("a design-desk/assets branch that shares history with the default branch is refused", (t) => {
  const { root, origin, clone } = product();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(clone, "push", "-q", origin, "HEAD:refs/heads/design-desk/assets");
  assert.throws(() => commitAssets(clone, "R-8", bundle(root, "b8", { "design.json": "{}" })), /shares history with the default branch/);
});

test("only a request card, and only regular files", (t) => {
  const { root, clone } = product();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.throws(() => commitAssets(clone, "../R-8", bundle(root, "b", { "a": "1" })), /not a request card/);
  const dir = bundle(root, "s", { "a": "1" });
  symlinkSync("/etc/passwd", join(dir, "link"));
  assert.throws(() => commitAssets(clone, "R-8", dir), /link is not a regular file/);
});

test("a path outside the handoff's folder is named", () => {
  assert.deepEqual(outside([".design-desk/handoff/R-8/a", ".design-desk/handoff/R-80/a", "app.js"], ".design-desk/handoff/R-8"),
    [".design-desk/handoff/R-80/a", "app.js"]);
});

test("the tip is read from the remote the commit is pushed to, and the clone's lock is let go", (t) => {
  const { root, origin, clone } = product();
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const other = join(root, "other.git");
  git(root, "init", "-q", "--bare", "-b", "main", other);
  const first = commitAssets(clone, "R-1", bundle(root, "b1", { "design.json": "{}\n" }), { remote: other });
  git(clone, "push", "-q", other, first.push);
  const second = commitAssets(clone, "R-2", bundle(root, "b2", { "design.json": "{}\n" }), { remote: other });
  assert.equal(second.parent, first.sha, "the other repository's tip, not origin's (which has none)");
  assert.equal(spawnSync("git", ["-C", clone, "ls-remote", "--heads", origin, ASSETS_BRANCH], { encoding: "utf8" }).stdout, "", "origin is untouched");
  assert.equal(existsSync(`${clone}.lock`), false, "the lock is released");
});
