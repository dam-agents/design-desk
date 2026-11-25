// design assets commit <clone> <R-n> <bundle-dir> [--remote <url>] — the handoff bundle as one commit on the
// product's `design-desk/assets` branch (docs/handoff.md → The bundle), made in the product's
// clone without a checkout and never pushed: the agent pushes the printed sha.
// The branch is an orphan: it shares no history with the default branch, so merging it into
// the product needs a person to force it, and it is never deleted, so every commit a comment
// links to stays reachable. A commit adds or replaces `.design-desk/handoff/R-<n>/` and
// nothing else; one that would change anything more, or a branch that shares history with
// the default branch, is refused.
import { lstatSync, mkdirSync, readdirSync, rmdirSync, rmSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative, resolve, sep } from "node:path";
import { fail } from "../lib/core.mjs";

export const ASSETS_BRANCH = "design-desk/assets";
export const folderOf = (card) => `.design-desk/handoff/${card}`;

// Every regular file under `dir`, as a path relative to it. A symlink or anything else is
// refused: the push carries exactly the files the bundle wrote.
export function filesOf(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e), st = lstatSync(p);
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) out.push(relative(dir, p).split(sep).join("/"));
      else throw new Error(`${relative(dir, p)} is not a regular file`);
    }
  };
  walk(dir);
  return out;
}

// The paths a commit changes, beside the folder it may change: what is outside it.
export function outside(paths, folder) { return paths.filter((p) => !p.startsWith(`${folder}/`)); }

// `remote` is where the commit is pushed (prototype_remote's URL), so its tip is read from there,
// not from the clone's origin. The fetch and the refs it writes take the clone's lock, the one
// scripts/checkout.sh takes.
export function commitAssets(clone, card, dir, { git = gitIn(clone), now = new Date(), remote = "origin" } = {}) {
  if (!/^R-\d+$/.test(card)) throw new Error(`${card} is not a request card (R-<n>)`);
  const files = filesOf(dir);
  if (!files.length) throw new Error(`${dir} holds no files`);
  return withCloneLock(clone, () => commitLocked(clone, card, dir, files, { git, now, remote }));
}

function commitLocked(clone, card, dir, files, { git, now, remote }) {
  const folder = folderOf(card), ref = `refs/design-desk/${ASSETS_BRANCH.split("/")[1]}-tip`;
  // The branch as GitHub has it now: absent is a first handoff, a failed answer is no guess.
  const ls = git(["ls-remote", "--heads", remote, ASSETS_BRANCH]);
  if (ls.status !== 0) throw new Error(`cannot read the remote's branches: ${ls.stderr.trim().split("\n")[0]}`);
  let parent = null;
  if (ls.stdout.trim()) {
    const f = git(["fetch", "-q", remote, `+refs/heads/${ASSETS_BRANCH}:${ref}`]);
    if (f.status !== 0) throw new Error(`cannot fetch ${ASSETS_BRANCH}: ${f.stderr.trim().split("\n")[0]}`);
    parent = must(git(["rev-parse", "--verify", `${ref}^{commit}`]), "rev-parse").trim();
    // An orphan shares no commit with the default branch: merge-base finds none (exit 1).
    const base = git(["merge-base", "origin/HEAD", parent]);
    if (base.status === 0) throw new Error(`${ASSETS_BRANCH} shares history with the default branch; a person must remove or rename it before a handoff pushes there`);
    if (base.status !== 1) throw new Error(`cannot compare ${ASSETS_BRANCH} with the default branch: ${base.stderr.trim().split("\n")[0]}`);
  }
  // A private index: the clone's own index, checkout and HEAD stay as they were.
  const index = join(must(git(["rev-parse", "--absolute-git-dir"]), "rev-parse").trim(), `design-desk-assets-${process.pid}.index`);
  const env = { GIT_INDEX_FILE: index };
  try {
    must(git(parent ? ["read-tree", parent] : ["read-tree", "--empty"], env), "read-tree");
    must(git(["rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", folder], env), "rm");
    for (const f of files) {
      const sha = must(git(["hash-object", "-w", "--", join(resolve(dir), f)]), "hash-object").trim();
      must(git(["update-index", "--add", "--cacheinfo", `100644,${sha},${folder}/${f}`], env), "update-index");
    }
    const tree = must(git(["write-tree"], env), "write-tree").trim();
    const msg = `Design Desk handoff ${card}\n\n${folder}/ as sent on ${now.toISOString()}.\n`;
    const sha = must(git(["commit-tree", tree, ...(parent ? ["-p", parent] : []), "-m", msg], identity(git)), "commit-tree").trim();
    // What the commit changes, checked on the commit itself, not on how it was built.
    const changed = must(git(parent ? ["diff", "--name-only", "--no-renames", parent, sha] : ["ls-tree", "-r", "--name-only", sha]), "diff")
      .split("\n").filter(Boolean);
    const extra = outside(changed, folder);
    if (extra.length) throw new Error(`the commit would change ${extra.length} path(s) outside ${folder}/: ${extra.slice(0, 3).join(", ")}`);
    return { branch: ASSETS_BRANCH, sha, parent, folder, files: files.map((f) => `${folder}/${f}`), push: `${sha}:refs/heads/${ASSETS_BRANCH}` };
  } finally { rmSync(index, { force: true }); }
}

// The clone's lock (`<clone>.lock`, scripts/checkout.sh): taken for the call, a dead run's (older
// than 5 minutes) taken over, and after 60 s of waiting the call goes on without it, as there.
export function withCloneLock(clone, fn, { waitMs = 60000, staleMs = 300000 } = {}) {
  const lock = `${resolve(clone).replace(/\/+$/, "")}.lock`, until = Date.now() + waitMs;
  let held = false;
  while (Date.now() < until) {
    try { mkdirSync(lock); held = true; break; }
    catch (e) {
      if (e.code !== "EEXIST") break;
      try { if (Date.now() - statSync(lock).mtimeMs > staleMs) { rmdirSync(lock); continue; } } catch {}
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
  try { return fn(); } finally { if (held) try { rmdirSync(lock); } catch {} }
}

// The clone's own identity when it has one; else the Desk's, as scripts/work-backup.sh names it:
// a clone from scripts/checkout.sh sets none, and the sandbox may have no global one.
export const DESK_IDENTITY = { name: "design-desk", email: "design-desk@agents.local" };
function identity(git) {
  if (git(["var", "GIT_AUTHOR_IDENT"]).status === 0 && git(["var", "GIT_COMMITTER_IDENT"]).status === 0) return {};
  const { name, email } = DESK_IDENTITY;
  return { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
}

function must(r, what) {
  if (r.status !== 0) throw new Error(`git ${what} failed: ${(r.stderr || "").trim().split("\n")[0]}`);
  return r.stdout;
}

function gitIn(clone) {
  return (args, env = {}) => {
    const r = spawnSync("git", ["-C", clone, ...args], { encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || (r.error ? r.error.message : "") };
  };
}

export async function main(_cmd, argv) {
  const at = argv.indexOf("--remote"), remote = at >= 0 ? argv[at + 1] : "origin";
  const [verb, clone, card, dir] = at >= 0 ? argv.filter((_, i) => i !== at && i !== at + 1) : argv;
  if (verb !== "commit" || !clone || !card || !dir || !remote) fail("usage: design assets commit <clone> <R-n> <bundle-dir> [--remote <url>]");
  try { process.stdout.write(`${JSON.stringify(commitAssets(clone, card, dir, { remote }))}\n`); }
  catch (e) { fail(e.message); }
}
