// design profile <[host/]owner/name> [--clone <dir>] [--check]
// design profile --check-dir <.design-desk/<name>>
// The product's design profile (docs/profile.md), as JSON: `.design-desk/<name>/profile.json`
// from the repository's default branch, else the style profile saved for the repository,
// else defaults. Adds `source` (repo|saved|default), `dir` and `profile_md`.
// --check and --check-dir validate the profile's shape instead (ok/FAIL lines, exit 1 on a FAIL).
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { HOME, cfg, fail, run, warn } from "../lib/core.mjs";
import { loadProfile } from "../lib/profile.mjs";

const isList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string");
const has = (dir, rel) => typeof rel === "string" && existsSync(join(dir, rel));

// The shape the agent relies on; values are the product team's.
export function checkProfile(p, dir, root) {
  const out = [];
  const req = (ok, id, msg) => out.push(ok ? { ok: true, id } : { ok: false, id, msg });
  req(p.schema === "design-desk-profile/v1", "schema", `schema is ${JSON.stringify(p.schema)}, expected "design-desk-profile/v1"`);
  req(typeof p.product === "string" && p.product, "product", "product (the name people know) is missing");
  req(isList(p.ui?.paths) && p.ui.paths.length > 0, "ui.paths", "ui.paths must list the globs of UI files");
  const b = p.boundary || {};
  req(isList(b.allow) && b.allow.length > 0, "boundary.allow", "boundary.allow is empty: nothing could be a design change");
  for (const k of ["deny", "global_styles", "allow_other", "ignored_ok", "presentational_imports"]) if (b[k] !== undefined) req(isList(b[k]), `boundary.${k}`, `boundary.${k} must be a list of strings`);
  for (const re of b.presentational_imports || []) { try { new RegExp(re); } catch { req(false, "boundary.presentational_imports", `not a regular expression: ${re}`); } }
  if (p.style) {
    req(typeof p.style.ui_dir === "string" && has(root, p.style.ui_dir), "style.ui_dir", `style.ui_dir ${p.style.ui_dir} is not a directory of the repository`);
    if (p.style.css_entry) req(has(root, p.style.css_entry), "style.css_entry", `style.css_entry ${p.style.css_entry} does not exist`);
    for (const w of p.style.render_wrappers || []) req(has(root, w.src) && typeof w.export === "string", "style.render_wrappers", `render wrapper ${w.src}#${w.export} does not exist`);
    if (p.style.mock_modules !== undefined) req(isList(p.style.mock_modules), "style.mock_modules", "style.mock_modules must be a list of patterns");
  }
  for (const [name, file] of Object.entries(p.screens || {})) req(has(root, file), "screens", `screen "${name}": ${file} does not exist`);
  for (const e of p.catalog?.elements || []) req(e && e.name && has(root, e.file) && e.export, "catalog.elements", `catalog element ${e?.name || "?"}: ${e?.file} (export ${e?.export}) does not exist`);
  if (p.engine) {
    const eps = p.engine.endpoints || [];
    req(eps.length > 0 && eps.every((e) => e.name && Number.isInteger(e.port)), "engine.endpoints", "engine.endpoints needs {name, port} entries");
    req(eps.some((e) => e.name === p.engine.open_endpoint), "engine.open_endpoint", `engine.open_endpoint ${p.engine.open_endpoint} is not one of the endpoints`);
    req(has(dir, "bin/env"), "engine.bin", "an engine needs bin/env next to profile.json (docs/profile.md → The engine contract)");
    for (const e of p.engine.egress || []) req(e.host && e.why, "engine.egress", `egress entry ${JSON.stringify(e)} needs host and why`);
  }
  for (const pl of p.plugins || []) req(has(dir, join(pl, "SKILL.md")), "plugins", `plug-in ${pl}: no SKILL.md under the profile`);
  req(has(dir, "PROFILE.md"), "PROFILE.md", "PROFILE.md (the words for people) is missing");
  return out;
}

function report(results) {
  for (const r of results) if (!r.ok) console.log(`FAIL ${r.id} — ${r.msg}`);
  const bad = results.filter((r) => !r.ok).length;
  console.log(bad ? `RESULT: ${bad} problem(s) in the profile` : `ok   profile — ${results.length} checks passed`);
  process.exit(bad ? 1 : 0);
}

export async function main(_cmd, argv) {
  const pos = []; let clone = "", check = false, checkDir = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--clone") clone = argv[++i];
    else if (argv[i] === "--check") check = true;
    else if (argv[i] === "--check-dir") checkDir = argv[++i];
    else pos.push(argv[i]);
  }
  if (checkDir) {
    const dir = resolve(checkDir);
    let p; try { p = JSON.parse(readFileSync(join(dir, "profile.json"), "utf8")); } catch (e) { fail(`${dir}/profile.json: ${e.message}`); }
    report(checkProfile(p, dir, resolve(dir, "../..")));
  }
  const repo = pos[0];
  if (!repo) fail("usage: design profile <[host/]owner/name> [--clone <dir>] [--check] | --check-dir <dir>");
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
    if (check) report(checkProfile(p, dir, clone));
    console.log(JSON.stringify({ ...p, source: "repo", repo, dir, profile_md: existsSync(join(dir, "PROFILE.md")) ? join(dir, "PROFILE.md") : null, engine_bin: existsSync(join(dir, "bin/env")) ? join(dir, "bin/env") : null }, null, 1));
    return;
  }
  if (check) fail(`${repo} has no .design-desk profile to check`);
  const saved = loadProfile(repo);
  const paths = cfg("watch_paths", "**/*.tsx,**/*.jsx,**/*.vue,**/*.svelte,**/*.css,**/*.scss,**/*.html").split(",").map((s) => s.trim()).filter(Boolean);
  console.log(JSON.stringify({ schema: "design-desk-profile/v1", source: saved ? "saved" : "default", repo, dir: null, profile_md: null, engine_bin: null, ui: { paths }, style: saved || null, boundary: null }, null, 1));
}
