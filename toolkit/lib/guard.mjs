// The design-only guard. A prototype may change how the product looks, never what it
// does; this reads a diff and says, file by file, which one it is.
//
// Paths: the profile's `boundary.deny` globs refuse a file outright, `boundary.allow`
// globs admit it to the check below, anything else is refused. A rename is judged by
// both of its paths.
// Code is judged by the language adapter whose extensions match (lib/lang/); a code file
// no adapter reads is refused, whatever the allow lists say.
import { globRe, matchAny } from "./globs.mjs";
import * as tsxReact from "./lang/tsx-react.mjs";

export { globRe };
export { compare, fingerprint, DEFAULTS, isPresentationalImport } from "./lang/tsx-react.mjs";

const LANGS = [tsxReact];
const CODE_EXT = /\.(vue|svelte|astro|mdx|py|rb|go|rs|java|kt|kts|swift|php|cs|c|cc|cpp|h|hpp|m|scala|sh|bash|zsh|pl|lua|dart|ex|exs|erl|clj|elm|sql|graphql|gql|wasm)$/;
const langOf = (path) => LANGS.find((l) => l.exts.test(path));

// ---------- the whole diff ----------

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

export function judge(changes, profile, readSide) {
  const files = [];
  for (const c of changes) {
    const where = classifyPath(c.path, profile, c.oldPath);
    if (where.verdict !== "code") { files.push({ path: c.path, status: c.status, ...where, notes: [] }); continue; }
    const before = c.status === "A" ? null : readSide("base", c.oldPath || c.path);
    const after = c.status === "D" ? null : readSide("head", c.path);
    let r;
    try { r = langOf(c.path).compare(before, after, c.path, profile); } catch (e) { r = { verdict: "logic", issues: [`could not read the code (${e.message}); a person must review it`], notes: [] }; }
    files.push({ path: c.path, status: c.status, ...r });
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
