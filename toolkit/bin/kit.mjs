// design kit --root <repo clone> [--repo <owner/name>] [--ui-dir <dir>]
// The product's kit: its named values (colors, shadows, radii, spacing, text sizes) and the
// variants of its components, read from the code (toolkit/lib/kit.mjs). Prints JSON. The
// variants skill picks each element's smart controls from it (docs/requests.md → Smart controls).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail, run } from "../lib/core.mjs";
import { readKit } from "../lib/kit.mjs";

// The profile's UI folder, when the clone has a design profile.
function uiDirOf(root) {
  try { for (const d of readdirSync(join(root, ".design-desk"))) { try { return JSON.parse(readFileSync(join(root, ".design-desk", d, "profile.json"), "utf8")).style?.ui_dir || ""; } catch {} } } catch {}
  return "";
}

export async function main(_cmd, argv) {
  let root = "", uiDir = null, repo = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--ui-dir") uiDir = argv[++i];
    else if (argv[i] === "--repo") repo = argv[++i];
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!root) fail("usage: design kit --root <repo clone> [--repo <owner/name>] [--ui-dir <dir>]");
  root = resolve(root);
  // The commit read, so the Desk says what the kit is of; not a git clone: none.
  const head = run("git", ["-C", root, "rev-parse", "HEAD"]);
  const commit = head.status === 0 ? head.stdout.trim() : null;
  process.stdout.write(JSON.stringify({ repo, commit, ...readKit(root, { uiDir: uiDir ?? uiDirOf(root) }) }, null, 1) + "\n");
}
