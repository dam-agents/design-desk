// design skill [<action>] [--repo <[host/]owner/name>]
// Which skill does an action (docs/actions.md), as JSON: the one work/CONFIG.md's
// `## Skills` table names, else the one the product's design profile names, else the
// bundled one; a chosen skill that is not installed falls back and says so.
// Without an action: every action with its skill.
import { join } from "node:path";
import { TOOLKIT, cfgTable, fail, run } from "../lib/core.mjs";
import { ACTIONS, resolve } from "../lib/actions.mjs";

export async function main(_cmd, argv) {
  const pos = []; let repo = "";
  for (let i = 0; i < argv.length; i++) { if (argv[i] === "--repo") repo = argv[++i]; else pos.push(argv[i]); }
  const config = Object.fromEntries(cfgTable("Skills").filter((r) => r.action && r.skill).map((r) => [r.action.trim(), r.skill.trim()]));
  let profile = {};
  if (repo) {
    const r = run(process.execPath, [join(TOOLKIT, "bin/design.mjs"), "profile", repo]);
    try { profile = JSON.parse(r.stdout).skills || {}; } catch { fail(`could not read the profile of ${repo}: ${r.stderr.trim()}`); }
  }
  const [action] = pos;
  if (action && !ACTIONS[action]) fail(`no action "${action}"; actions: ${Object.keys(ACTIONS).join(", ")}`);
  const out = action ? resolve(action, { config, profile }) : Object.keys(ACTIONS).map((a) => resolve(a, { config, profile }));
  console.log(JSON.stringify(out, null, 1));
}
