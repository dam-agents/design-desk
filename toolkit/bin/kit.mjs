// design kit --root <repo clone> [--ui-dir <dir>]
// The product's kit: its named values (colors, shadows, radii, spacing, text sizes) and the
// variants of its components, read from the code (toolkit/lib/kit.mjs). Prints JSON. The
// variants skill picks each element's smart controls from it (docs/requests.md → Smart controls).
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "../lib/core.mjs";
import { readKit } from "../lib/kit.mjs";

// The profile's UI folder, when the clone has a design profile.
function uiDirOf(root) {
  try { for (const d of readdirSync(join(root, ".design-desk"))) { try { return JSON.parse(readFileSync(join(root, ".design-desk", d, "profile.json"), "utf8")).style?.ui_dir || ""; } catch {} } } catch {}
  return "";
}

export async function main(_cmd, argv) {
  let root = "", uiDir = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--ui-dir") uiDir = argv[++i];
    else fail(`unknown argument ${argv[i]}`);
  }
  if (!root) fail("usage: design kit --root <repo clone> [--ui-dir <dir>]");
  root = resolve(root);
  process.stdout.write(JSON.stringify(readKit(root, { uiDir: uiDir ?? uiDirOf(root) }), null, 1) + "\n");
}
