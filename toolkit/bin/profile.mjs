// design profile <[host/]owner/name> [--clone <dir>]
// The product's design profile (docs/profile.md), as JSON: `.design-desk/<name>/profile.json`
// from the repository's default branch, else the style profile saved for the repository,
// else defaults. Adds `source` (repo|saved|default), `dir` and `profile_md`.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HOME, cfg, fail, run, warn } from "../lib/core.mjs";
import { loadProfile } from "../lib/profile.mjs";

export async function main(_cmd, argv) {
  const pos = []; let clone = "";
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--clone") clone = argv[++i]; else pos.push(argv[i]); }
  const repo = pos[0];
  if (!repo) fail("usage: design profile <[host/]owner/name> [--clone <dir>]");
  if (!clone) {
    const r = run("bash", [join(HOME, "scripts/checkout.sh"), repo]);
    let co = {}; try { co = JSON.parse(r.stdout); } catch {}
    if (r.status !== 0 || !co.dir) fail(`could not check out ${repo}: ${co.error || r.stderr.trim()}`);
    clone = co.dir;
  }
  // The clone's working tree is the default branch (checkout.sh detaches it there); a
  // worktree of a prototype is never passed here.
  const base = join(clone, ".design-desk");
  const configured = cfg("profile", "auto");
  let name = "";
  if (configured !== "auto") {
    const [r, d] = configured.split(":");
    if (r === repo && d) name = d.replace(/^\.design-desk\//, "");
  }
  if (!name && existsSync(base)) {
    const found = run("bash", ["-c", 'ls -1 "$0" 2>/dev/null', base]).stdout.split("\n").filter((d) => d && existsSync(join(base, d, "profile.json"))).sort();
    if (found.length > 1) warn(`${repo} has ${found.length} design profiles (${found.join(", ")}); using ${found[0]} — set profile: ${repo}:<dir> to choose`);
    name = found[0] || "";
  }
  if (name && existsSync(join(base, name, "profile.json"))) {
    let p;
    try { p = JSON.parse(readFileSync(join(base, name, "profile.json"), "utf8")); } catch (e) { fail(`${repo}: .design-desk/${name}/profile.json is not JSON (${e.message})`); }
    const dir = join(base, name);
    console.log(JSON.stringify({ ...p, source: "repo", repo, dir, profile_md: existsSync(join(dir, "PROFILE.md")) ? join(dir, "PROFILE.md") : null, engine_bin: existsSync(join(dir, "bin/env")) ? join(dir, "bin/env") : null }, null, 1));
    return;
  }
  const saved = loadProfile(repo);
  const paths = cfg("watch_paths", "**/*.tsx,**/*.jsx,**/*.vue,**/*.svelte,**/*.css,**/*.scss,**/*.html").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(JSON.stringify({ schema: "design-desk-profile/v1", source: saved ? "saved" : "default", repo, dir: null, profile_md: null, engine_bin: null, ui: { paths }, style: saved || null, boundary: null }, null, 1));
}
