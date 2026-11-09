// The design-only guard. A prototype may change how the product looks, never what it
// does; this reads a diff and says, file by file, which one it is.
//
// Paths: the profile's `boundary.deny` globs refuse a file outright, `boundary.allow`
// globs admit it to the check below, anything else is refused. A rename is judged by
// both of its paths.
// Code is judged by the language adapter whose extensions match (lib/lang/); a code file
// no adapter reads is refused, whatever the allow lists say. A style sheet or an SVG is
// read too (lib/css-check.mjs; one that cannot be read is refused); a symbolic link or a
// submodule is refused.
import { globRe, matchAny } from "./globs.mjs";
import { cssDangers, svgDangers } from "./css-check.mjs";
import * as tsxReact from "./lang/tsx-react.mjs";

export { globRe };
export { compare, fingerprint, DEFAULTS, isPresentationalImport } from "./lang/tsx-react.mjs";

const LANGS = [tsxReact];
const CODE_EXT = /\.(vue|svelte|astro|mdx|py|rb|go|rs|java|kt|kts|swift|php|cs|c|cc|cpp|h|hpp|m|scala|sh|bash|zsh|pl|lua|dart|ex|exs|erl|clj|elm|sql|graphql|gql|wasm)$/;
const langOf = (path) => LANGS.find((l) => l.exts.test(path));

// ---------- the whole diff ----------

// `git diff --raw -z --find-renames` → the changes judge() reads: status, path, the old
// path of a rename or copy, and both modes (a symbolic link or a submodule is refused).
export function parseRawDiff(z) {
  const f = String(z || "").split("\0").filter(Boolean), list = [];
  for (let i = 0; i < f.length;) {
    const [oldMode, mode, , , st] = f[i++].replace(/^:/, "").split(" ");
    if (!st) throw new Error(`unreadable diff line: ${f[i - 1].slice(0, 80)}`);
    if (st.startsWith("R") || st.startsWith("C")) { const oldPath = f[i++], path = f[i++]; list.push({ status: "M", path, oldPath, mode, oldMode }); }
    else list.push({ status: st[0], path: f[i++], mode, oldMode });
  }
  return list;
}

const PLAIN = {
  ok: "Only the look changed (layout, styles, copy or icons).",
  "ui-state": "Only the look changed, plus view-only state such as open/closed.",
  style: "Only styles changed.",
  global: "Changes styles used across the whole product.",
  asset: "An image or icon file.",
  logic: "Changes what the product does, not only how it looks.",
  removed: "Takes away something people can see or use today.",
  denied: "This file is outside what a design change may touch.",
};

export function plainVerdict(v) { return PLAIN[v] || v; }

export function classifyPath(path, profile, oldPath = null) {
  const b = profile.boundary || {};
  for (const p of oldPath && oldPath !== path ? [oldPath, path] : [path]) {
    if (matchAny(p, b.deny)) return { verdict: "denied", issues: [`${p} is on the profile's deny list`] };
    if (!matchAny(p, b.allow)) return { verdict: "denied", issues: [`${p} is not on the profile's allow list`] };
  }
  if (/\.(css|scss|sass|less|pcss)$/.test(path)) return { verdict: matchAny(path, b.global_styles) ? "global" : "style", issues: [] };
  if (/\.(png|jpe?g|gif|webp|svg|ico|avif|woff2?|ttf|otf)$/.test(path)) return { verdict: "asset", issues: [] };
  if (langOf(path)) return { verdict: "code", issues: [] };
  if (CODE_EXT.test(path)) return { verdict: "denied", issues: [`${path}: the guard cannot read .${path.split(".").pop()} code yet; a person must review it`] };
  if (matchAny(path, b.allow_other)) return { verdict: "ok", issues: [] };
  return { verdict: "denied", issues: [`${path}: a ${path.split(".").pop()} file is neither style, image nor component code`] };
}

const LINK_MODES = new Set(["120000", "160000"]);
const minus = (a, b) => { const left = [...b]; return a.filter((x) => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; }); };

function judgeFile(c, profile, readSide, presentationalFiles) {
  if (LINK_MODES.has(c.mode) || LINK_MODES.has(c.oldMode)) return { verdict: "logic", issues: ["a symbolic link or a submodule: it can point at anything; a person must review it"], notes: [] };
  const where = classifyPath(c.path, profile, c.oldPath);
  if (where.verdict === "style" || where.verdict === "global" || (where.verdict === "asset" && /\.svg$/i.test(c.path))) {
    if (c.status === "D") return { ...where, notes: [] };
    const check = where.verdict === "asset" ? svgDangers : cssDangers;
    const head = readSide("head", c.path);
    if (head === null) return { verdict: "logic", issues: ["could not read the file; a person must review it"], notes: [] };
    const before = c.status === "A" ? [] : check(readSide("base", c.oldPath || c.path));
    const added = minus(check(head), before);
    if (added.length) return { verdict: "logic", issues: added.slice(0, 5).map((d) => `${where.verdict === "asset" ? "the image holds" : "the style"} ${d}`), notes: [] };
    return { ...where, notes: [] };
  }
  if (where.verdict !== "code") return { ...where, notes: [] };
  const before = c.status === "A" ? null : readSide("base", c.oldPath || c.path);
  const after = c.status === "D" ? null : readSide("head", c.path);
  try { return langOf(c.path).compare(before, after, c.path, profile, { presentationalFiles }); } catch (e) { return { verdict: "logic", issues: [`could not read the code (${e.message}); a person must review it`], notes: [] }; }
}

export function judge(changes, profile, readSide) {
  // A new file of this diff that only shows things may be rendered by another file of
  // it; that is known only once it is judged, so judge until the set stops growing.
  let pres = new Set(), files;
  for (let round = 0; round < 6; round++) {
    files = changes.map((c) => ({ path: c.path, status: c.status, ...judgeFile(c, profile, readSide, pres) }));
    const next = new Set(files.filter((f) => f.status === "A" && langOf(f.path) && ["ok", "ui-state"].includes(f.verdict)).map((f) => f.path));
    if (next.size === pres.size) break;
    pres = next;
  }
  const bad = files.filter((f) => ["denied", "logic", "removed"].includes(f.verdict));
  const counts = files.reduce((m, f) => (m[f.verdict] = (m[f.verdict] || 0) + 1, m), {});
  return {
    ok: files.length > 0 && bad.length === 0,
    empty: files.length === 0,
    counts,
    files: files.map((f) => ({ ...f, plain: plainVerdict(f.verdict) })),
    summary: files.length === 0 ? "No change to check." : bad.length ? `${bad.length} of ${files.length} files go beyond design: ${bad.map((f) => f.path).slice(0, 5).join(", ")}` : `All ${files.length} files change only the look.`,
  };
}

// ---------- files outside version control ----------

// The repository paths (without extension) the diff starts importing.
export function newImportTargets(changes, profile, readSide) {
  const out = new Set();
  for (const c of changes) {
    const lang = langOf(c.path);
    if (!lang || c.status === "D") continue;
    try {
      const head = lang.fingerprint(readSide("head", c.path) || "", c.path).specifiers;
      const base = c.status === "A" ? new Set() : lang.fingerprint(readSide("base", c.oldPath || c.path) || "", c.oldPath || c.path).specifiers;
      for (const m of head) if (!base.has(m)) { const p = lang.resolveImport(m, c.path, profile); if (p) out.add(p); }
    } catch { /* an unreadable file is refused by judge() */ }
  }
  return [...out];
}

// Ignored files never show in the diff, yet an install from the worktree ships them.
// Fine: dependency and build folders and logs at the repository root, in the UI folder
// (style.ui_dir) or outside the UI paths, and the profile's `ignored_ok` — never one the
// diff starts importing.
const BUILD_DIR = /^(node_modules|dist|build|out|coverage|\.turbo|\.next|\.cache|\.pnpm-store)$/;
export function judgeIgnored(entries, profile, imported = []) {
  const b = profile.boundary || {};
  const roots = new Set(["", ...(profile.style?.ui_dir ? [`${profile.style.ui_dir.replace(/\/+$/, "")}/`] : [])]);
  const uiGlobs = [...(b.allow || []), ...(profile.ui?.paths || [])];
  const underUi = (p) => matchAny(p, uiGlobs) || ["x.tsx", "x.ts", "x.js", "x.css", "x.svg", "x.png"].some((x) => matchAny(`${p}/${x}`, uiGlobs));
  const okByProfile = (f) => (b.ignored_ok || []).some((g) => globRe(g).test(f.replace(/\/$/, "")) || globRe(g).test(f));
  const bad = [];
  for (const f of entries) {
    const p = f.replace(/\/$/, "");
    const parent = p.includes("/") ? `${p.slice(0, p.lastIndexOf("/"))}/` : "";
    const hit = imported.find((t) => t === p || t.startsWith(`${p}/`) || tsxReact.IMPORT_EXTS.some((e) => t + e === p));
    if (hit) { bad.push({ path: f, why: `the change imports it (${hit}), but git ignores it` }); continue; }
    const placed = roots.has(parent) || !underUi(p);
    if (f.endsWith("/") && BUILD_DIR.test(p.split("/").pop()) && placed) continue;
    if (!f.endsWith("/") && /\.log$/.test(f) && placed) continue;
    if (okByProfile(f)) continue;
    bad.push({ path: f, why: "an ignored file in the worktree would ship with the prototype's install" });
  }
  return bad;
}
