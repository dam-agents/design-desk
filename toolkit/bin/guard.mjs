// design guard <worktree> --base <ref> [--profile <profile.json>] [--patch <out.patch>]
// The design-only check of a prototype: every file the worktree changed since <ref>
// (committed, staged, unstaged and untracked) gets a verdict; prints one JSON object.
// Exit 0 when every file changes only the look, 1 when one goes beyond design, 2 when
// the check could not run. A failed check is never a pass.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, run } from "../lib/core.mjs";
import { judge } from "../lib/guard.mjs";

export async function main(_cmd, argv) {
  const pos = []; let base = "", profilePath = "", patch = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i];
    else if (argv[i] === "--profile") profilePath = argv[++i];
    else if (argv[i] === "--patch") patch = argv[++i];
    else pos.push(argv[i]);
  }
  const dir = pos[0];
  if (!dir || !base) fail("usage: design guard <worktree> --base <ref> [--profile <profile.json>] [--patch <out.patch>]");
  const git = (...a) => {
    const r = run("git", ["-C", dir, ...a], { maxBuffer: 64 * 1024 * 1024 });
    if (r.status !== 0) { console.log(JSON.stringify({ ok: false, error: `git ${a.join(" ")}: ${(r.stderr || "").trim()}` })); process.exit(2); }
    return r.stdout;
  };
  let profile = {};
  if (profilePath) {
    try { profile = JSON.parse(readFileSync(profilePath, "utf8")); } catch (e) { console.log(JSON.stringify({ ok: false, error: `profile: ${e.message}` })); process.exit(2); }
  }
  if (!profile.boundary?.allow?.length) { console.log(JSON.stringify({ ok: false, error: "the profile has no boundary.allow list, so nothing can be judged a design change (docs/boundary.md)" })); process.exit(2); }

  const mergeBase = git("merge-base", base, "HEAD").trim();
  // Intent-to-add makes untracked files part of the diff without staging their content.
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  if (untracked.length) git("add", "--intent-to-add", "--", ...untracked);
  const changes = git("diff", "--name-status", "-z", "--find-renames", mergeBase).split("\0").filter(Boolean);
  const list = [];
  for (let i = 0; i < changes.length;) {
    const st = changes[i++];
    if (st.startsWith("R") || st.startsWith("C")) { const oldPath = changes[i++], path = changes[i++]; list.push({ status: "M", path, oldPath }); }
    else list.push({ status: st[0], path: changes[i++] });
  }
  const readSide = (side, path) => {
    if (side === "head") { try { return readFileSync(join(dir, path), "utf8"); } catch { return null; } }
    const r = run("git", ["-C", dir, "show", `${mergeBase}:${path}`], { maxBuffer: 64 * 1024 * 1024 });
    return r.status === 0 ? r.stdout : null;
  };
  const result = judge(list, profile, readSide);
  // An ignored file never shows in the diff, yet an install from the worktree ships it
  // (a .env.local, a build output with secrets). Only dependency and build folders may be there.
  const okIgnored = /(^|\/)(node_modules|dist|build|out|coverage|\.turbo|\.next|\.cache|\.pnpm-store)\/?$|\.log$/;
  const ignored = git("ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z").split("\0").filter(Boolean).filter((f) => !okIgnored.test(f));
  if (ignored.length) {
    result.ok = false;
    result.files.push(...ignored.slice(0, 20).map((path) => ({ path, status: "?", verdict: "denied", issues: ["an ignored file in the worktree would ship with the prototype's install"], notes: [], plain: "A file outside version control would be installed with the prototype." })));
    result.summary = `${result.summary} Ignored files in the worktree: ${ignored.slice(0, 5).join(", ")}.`;
  }
  if (patch) writeFileSync(patch, git("diff", "--binary", mergeBase));
  console.log(JSON.stringify({ base: mergeBase.slice(0, 12), ...result }, null, 1));
  process.exit(result.ok ? 0 : 1);
}
