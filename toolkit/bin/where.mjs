// design where <file.tsx> [--export <Component>] --root <repo clone> [--words "<words>"] [--field <name>]...
// Where else the thing an element shows appears: every file that uses the same data (the
// types of its props, the hooks it calls, the fields it reads) or the same words people
// read, grouped by file, with the screen each belongs to. Candidates for the impact skill
// to read, not a verdict. Prints JSON.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fail } from "../lib/core.mjs";
import { componentStates, findTsconfig } from "../lib/states.mjs";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", "vendor", "target", ".mise"]);
const TEXT = /\.(tsx?|jsx?|mjs|vue|svelte|md|mdx|json|ya?ml|go|py|rs|html|hbs|txt)$/;
const GENERIC = new Set(["id", "name", "type", "title", "label", "value", "data", "length", "status", "state", "kind", "url", "key", "items", "children", "className"]);
const PRIMITIVE = /^(string|number|boolean|null|undefined|any|unknown|void|never|object|Date|ReactNode|JSX\.Element|Array|Record|Promise)\b/;

function* walk(dir, root) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e) || e.startsWith(".") && e !== ".design-desk") continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p, root);
    else if (TEXT.test(e) && st.size < 400 * 1024) yield p;
  }
}

// What a path is to a person: a screen, a part of one, a message, a document, other code.
function kindOf(rel, uiDir) {
  if (/(^|\/)(__tests__|tests?|e2e|spec)(\/|$)|\.(test|spec)\.[jt]sx?$/.test(rel)) return "test";
  if (/slack|email|mail|notif|message|template/i.test(rel) && !rel.startsWith(uiDir)) return "message";
  if (/\.(md|mdx)$/.test(rel)) return "document";
  if (uiDir && rel.startsWith(uiDir)) return /\/views?\//.test(rel) ? "screen" : "component";
  if (/(^|\/)cli\//.test(rel)) return "command line";
  return "other code";
}

function profileOf(root) {
  try {
    const base = join(root, ".design-desk");
    for (const d of readdirSync(base)) { try { return JSON.parse(readFileSync(join(base, d, "profile.json"), "utf8")); } catch {} }
  } catch {}
  return {};
}

export async function main(_cmd, argv) {
  const pos = [], fields = []; let exportName = "", root = "", words = "";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--export") exportName = argv[++i];
    else if (argv[i] === "--root") root = argv[++i];
    else if (argv[i] === "--words") words = argv[++i];
    else if (argv[i] === "--field") fields.push(argv[++i]);
    else pos.push(argv[i]);
  }
  if (!pos[0] || !root) fail('usage: design where <file.tsx> [--export <Component>] --root <repo clone> [--words "<words>"] [--field <name>]...');
  root = resolve(root);
  const file = resolve(pos[0]);
  let st;
  try { st = componentStates(file, { exportName, tsconfig: findTsconfig(file, root), root }); } catch (e) { fail(e.message); }
  const profile = profileOf(root);
  const self = relative(root, file);
  // Without a profile, the element's own package is the UI.
  const uiDir = profile.style?.ui_dir ? `${profile.style.ui_dir.replace(/\/$/, "")}/` : (self.match(/^(.*?\/)src\//)?.[1] || "");
  const screens = Object.entries(profile.screens || {}).map(([name, f]) => [name, String(f)]);

  // The data: prop types that are the product's own, hooks, and the fields read.
  const types = [...new Set((st.props || []).map((p) => String(p.type || "").replace(/\[\]$/, "").split(/[<|& ]/)[0]).filter((t) => t && !PRIMITIVE.test(t) && /^[A-Z]/.test(t)))];
  const hooks = [...new Set((st.hooks || []).map((h) => h.name).filter(Boolean))];
  const read = (st.reads || []).map((r) => String(r.expr || "").split(".").pop()).filter((f) => f && !GENERIC.has(f) && f.length > 3);
  const fieldTerms = [...new Set([...fields, ...(fields.length ? [] : read)])];
  const wordTerms = words ? words.split(",").map((w) => w.trim()).filter(Boolean) : [];
  const res = [
    ...types.map((t) => ["type", t, new RegExp(`\\b${t}\\b`)]),
    ...hooks.map((h) => ["hook", h, new RegExp(`\\b${h}\\b`)]),
    ...fieldTerms.map((f) => ["field", f, new RegExp(`[.?]${f}\\b|\\b${f}\\s*:`)]),
    ...wordTerms.map((w) => ["words", w, new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")]),
  ];

  const places = [];
  for (const p of walk(root, root)) {
    const rel = relative(root, p);
    if (rel === self) continue;
    let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
    const lines = text.split("\n");
    const hits = [];
    for (const [kind, term, re] of res) {
      if (kind !== "words" && !/\.(tsx?|jsx?|mjs|vue|svelte|go|py|rs)$/.test(rel)) continue;
      const at = lines.findIndex((l) => re.test(l));
      if (at >= 0) hits.push({ kind, term, line: at + 1 });
    }
    if (!hits.length) continue;
    const screen = screens.find(([, f]) => f === rel || rel.startsWith(f.replace(/[^/]+$/, "")))?.[0] || null;
    places.push({ file: rel, kind: kindOf(rel, uiDir), screen, hits });
  }
  places.sort((a, b) => new Set(b.hits.map((h) => h.term)).size - new Set(a.hits.map((h) => h.term)).size || a.file.localeCompare(b.file));
  console.log(JSON.stringify({
    element: { file: self, export: st.component || exportName || null },
    terms: { types, hooks, fields: fieldTerms, words: wordTerms },
    places: places.filter((p) => p.kind !== "test").slice(0, 60),
    tests: places.filter((p) => p.kind === "test").map((p) => p.file).slice(0, 20),
  }, null, 1));
}
