// design repo clone|detect|save|show
import { readFileSync } from "node:fs";
import { fail, req } from "../lib/core.mjs";
import { cloneRepo, detect, saveProfile, loadProfile } from "../lib/profile.mjs";

export async function main(_cmd, [sub, a, b]) {
  const YAML = req("yaml");
  if (sub === "clone") { if (!a) fail("usage: design repo clone <owner/name> [ref]"); console.log(JSON.stringify(cloneRepo(a, b))); return; }
  if (sub === "detect") {
    if (!a) fail("usage: design repo detect <owner/name> [ref]");
    const { dir, commit } = cloneRepo(a, b);
    const { profile, notes } = detect(a, dir, commit);
    if (b) profile.ref = b;
    process.stdout.write(YAML.stringify(profile));
    for (const n of notes) console.error(`note: ${n}`);
    console.error(`clone: ${dir}`);
    return;
  }
  if (sub === "save") {
    if (!a) fail("usage: design repo save <profile.yaml>");
    const p = YAML.parse(readFileSync(a, "utf8"));
    if (!p?.repo) fail("the profile has no `repo:`");
    for (const k of p.kind === "none" ? [] : ["ui_dir", "styling"]) if (!p[k]) fail(`the profile has no \`${k}:\``);
    console.log(JSON.stringify({ saved: saveProfile(p) }));
    return;
  }
  if (sub === "show") { const p = loadProfile(a || ""); if (!p) fail(`no saved profile for ${a}`); process.stdout.write(YAML.stringify(p)); return; }
  fail("usage: design repo clone|detect|save|show …");
}
