// The product's kit: what its UI is made of, read from the code alone (docs/requests.md →
// Smart controls). Its named values (CSS custom properties: colors, shadows, radii, spacing,
// text sizes) and the variants of its components (cva() variants, a prop typed as a union of
// words, a CSS class family like .btn-primary / .btn-secondary). Deterministic and offline: it
// reads files, runs nothing. The variants skill picks each element's controls from it, so a
// part offers only what the product already has.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename, extname } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo", "vendor", "target", ".mise", "storybook-static", "out"]);
const CODE = /\.(tsx|jsx|ts|js|vue|svelte)$/, STYLE = /\.(css|scss|pcss)$/;
const LIMIT = { files: 4000, size: 300 * 1024, tokens: 200, components: 80, options: 16 };

function* walk(dir) {
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (SKIP.has(e) || e.startsWith(".")) continue;
    const p = join(dir, e);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) yield* walk(p);
    else if ((CODE.test(e) || STYLE.test(e)) && st.size < LIMIT.size && !/\.(test|spec|stories)\.[jt]sx?$|\.d\.ts$/.test(e)) yield p;
  }
}

// The text from `open` (a `{` or `(`) to its matching close, skipping strings and comments.
export function balanced(text, open) {
  const pairs = { "{": "}", "(": ")", "[": "]" };
  const stack = [];
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; for (i++; i < text.length && text[i] !== q; i++) if (text[i] === "\\") i++; continue; }
    if (c === "/" && text[i + 1] === "/") { i = text.indexOf("\n", i); if (i < 0) return null; continue; }
    if (c === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i); if (i < 0) return null; i++; continue; }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === stack[stack.length - 1]) { stack.pop(); if (!stack.length) return text.slice(open, i + 1); }
  }
  return null;
}

// The text without its comments; strings stay as they are.
export function uncomment(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") { const from = i; for (i++; i < text.length && text[i] !== c; i++) if (text[i] === "\\") i++; out += text.slice(from, i + 1); continue; }
    if (c === "/" && text[i + 1] === "/") { const e = text.indexOf("\n", i); i = e < 0 ? text.length : e - 1; continue; }
    if (c === "/" && text[i + 1] === "*") { const e = text.indexOf("*/", i + 2); i = e < 0 ? text.length : e + 1; continue; }
    out += c;
  }
  return out;
}

// The top-level `key: value` pairs of an object literal's text, values as raw text.
export function entries(obj) {
  const out = [], body = obj.slice(1, -1);
  let i = 0;
  while (i < body.length) {
    const m = /^\s*(?:,\s*)?(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$-]*))\s*:\s*/.exec(body.slice(i));
    if (!m) { const next = body.indexOf(",", i); if (next < 0) break; i = next + 1; continue; }
    const key = m[1] ?? m[2] ?? m[3];
    i += m[0].length;
    let end = i;
    if ("{[(".includes(body[i])) { const b = balanced(body, i); end = i + (b ? b.length : body.length); }
    else { for (; end < body.length && body[end] !== ","; end++) { const c = body[end]; if (c === '"' || c === "'" || c === "`") { for (end++; end < body.length && body[end] !== c; end++) if (body[end] === "\\") end++; } } }
    out.push([key, body.slice(i, end).trim()]);
    i = end;
  }
  return out;
}

// The words a value holds: its string literals, joined (a cva value may be a string or a list).
const words = (raw) => [...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`$]*)`/g)].map((m) => m[1] ?? m[2] ?? m[3]).join(" ").replace(/\s+/g, " ").trim();
const nameOf = (file) => basename(file, extname(file)).replace(/[-_.]+(\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());

// cva("base", { variants: { variant: { default: "…", secondary: "…" } }, defaultVariants: {…} })
export function cvaVariants(text, file) {
  const out = [];
  for (const m of text.matchAll(/(?:const|let|var)\s+(\w+)\s*=\s*(?:cva|tv)\s*\(/g)) {
    const raw = balanced(text, m.index + m[0].length - 1);
    if (!raw) continue;
    const call = uncomment(raw);
    const at = call.search(/\bvariants\s*:\s*\{/);
    if (at < 0) continue;
    const vars = balanced(call, call.indexOf("{", at));
    const defs = (() => { const d = call.search(/\bdefaultVariants\s*:\s*\{/); const b = d < 0 ? null : balanced(call, call.indexOf("{", d)); return b ? Object.fromEntries(entries(b).map(([k, v]) => [k, words(v)])) : {}; })();
    const base = m[1].replace(/(Variants?|Styles?|Classes)$/i, "");
    for (const [prop, raw] of entries(vars || "{}")) {
      if (!raw.startsWith("{")) continue;
      const options = entries(raw).map(([name, v]) => ({ name, classes: words(v) })).slice(0, LIMIT.options);
      if (options.length < 2) continue;
      out.push({ name: base.replace(/^\w/, (c) => c.toUpperCase()), file, prop, how: "cva", default: defs[prop] || options[0].name, options });
    }
  }
  return out;
}

// A prop typed as a union of words: `variant?: "primary" | "secondary" | "ghost"`.
const UNION_PROPS = /^(variant|size|kind|tone|intent|appearance|shape|density|emphasis|color|colour|look|level|status|severity|type)$/;
export function unionVariants(text, file) {
  const out = [];
  for (const m of text.matchAll(/\b(\w+)\??\s*:\s*((?:"[\w-]+"|'[\w-]+')(?:\s*\|\s*(?:"[\w-]+"|'[\w-]+'))+)/g)) {
    if (!UNION_PROPS.test(m[1])) continue;
    const options = [...new Set([...m[2].matchAll(/["']([\w-]+)["']/g)].map((x) => x[1]))].slice(0, LIMIT.options).map((name) => ({ name }));
    const def = new RegExp(`\\b${m[1]}\\s*=\\s*["']([\\w-]+)["']`).exec(text)?.[1];
    out.push({ name: nameOf(file), file, prop: m[1], how: "prop", default: def || options[0].name, options });
  }
  return out;
}

// A CSS class family: .btn-primary, .btn--ghost, .badge-success…
const MODS = "primary|secondary|tertiary|ghost|outline|outlined|link|text|plain|subtle|solid|soft|danger|destructive|error|success|warning|info|neutral|default|muted|accent|sm|md|lg|xl|small|medium|large|compact";
export function classFamilies(text, file) {
  const fam = new Map();
  for (const m of text.matchAll(new RegExp(`\\.([a-z][\\w]*(?:-[a-z]+)*?)(--|-|__)(${MODS})(?![\\w-])`, "g"))) {
    const key = m[1] + m[2];
    if (!fam.has(key)) fam.set(key, new Set());
    fam.get(key).add(m[3]);
  }
  return [...fam].filter(([, s]) => s.size >= 2).map(([key, s]) => ({ name: nameOf(key.replace(/[-_]+$/, "")), file, prop: "class", how: "class",
    default: null, options: [...s].slice(0, LIMIT.options).map((x) => ({ name: x, class: key + x })) }));
}

// Named values in CSS: custom properties defined on :root, html, @theme or a theme class.
export function cssTokens(text, file) {
  const out = [];
  for (const m of text.matchAll(/(:root|html|@theme(?:\s+\w+)?|\[data-theme[^\]]*\]|\.light)\b[^{]*\{/g)) {
    const block = balanced(text, m.index + m[0].length - 1);
    if (!block) continue;
    for (const d of block.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+);/g)) {
      const name = d[1], value = d[2].trim().replace(/\s+/g, " ");
      const kind = kindOf(name, value);
      if (kind) out.push({ name, value: value.slice(0, 160), kind, file });
    }
  }
  return out;
}
const COLOR = /^(#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(|oklab\(|lab\(|lch\(|color\(|color-mix\()/i;
export function kindOf(name, value) {
  if (/shadow/i.test(name) || /\d+px[^,;]*\b(rgba?|hsla?|oklch)\(/i.test(value) && /\d+px\s+\d+px/.test(value)) return "shadow";
  if (/radius|rounded/i.test(name)) return "radius";
  if (/(^--(font-)?weight|font-weight)/i.test(name)) return "font-weight";
  if (/(font-size|^--text-|^--fs-)/i.test(name) && !/line-height|leading|tracking|--text-color/i.test(name)) return /^-?[\d.]+(px|rem|em)$/.test(value) || /clamp\(/.test(value) ? "font-size" : null;
  if (/(space|spacing|gap|^--size-)/i.test(name) && /^-?[\d.]+(px|rem|em)$/.test(value)) return "space";
  if (/(border-width|stroke)/i.test(name) && /^[\d.]+px$/.test(value)) return "border";
  if (COLOR.test(value) || (/color|^--(bg|fg|background|foreground|primary|secondary|accent|muted|border|ring|destructive|danger|success|warning|surface|ink|brand)\b/i.test(name) && /^(var\(--|#|[\d.]+\s+[\d.]+%?\s+[\d.]+%?)/.test(value))) return "color";
  return null;
}

// The kit of a clone: `{root, ui_dir, tokens: {color: […], …}, components: […], counts}`.
export function readKit(root, { uiDir = "" } = {}) {
  const base = uiDir ? join(root, uiDir) : root;
  const tokens = [], comps = [];
  let n = 0;
  for (const p of walk(base)) {
    if (++n > LIMIT.files) break;
    let text; try { text = readFileSync(p, "utf8"); } catch { continue; }
    const rel = relative(root, p);
    if (STYLE.test(p)) { tokens.push(...cssTokens(text, rel)); comps.push(...classFamilies(text, rel)); continue; }
    if (/<style[\s>]/.test(text)) { for (const s of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) { tokens.push(...cssTokens(s[1], rel)); comps.push(...classFamilies(s[1], rel)); } }
    const cva = /\b(cva|tv)\s*\(/.test(text) ? cvaVariants(text, rel) : [];
    comps.push(...cva);
    if (/\.(tsx|jsx|ts|vue|svelte)$/.test(p)) comps.push(...unionVariants(text, rel).filter((u) => !cva.some((c) => c.prop === u.prop)));
  }
  // The first definition of a name wins (the light theme, before a dark override elsewhere).
  const byKind = {};
  const seen = new Set();
  for (const t of tokens) { if (seen.has(t.name)) continue; seen.add(t.name); (byKind[t.kind] ||= []).push({ name: t.name, value: t.value, file: t.file }); }
  for (const k of Object.keys(byKind)) byKind[k] = byKind[k].slice(0, LIMIT.tokens);
  // One entry per component and prop; a component's own file before a re-export.
  const key = (c) => `${c.name}|${c.prop}|${c.options.map((o) => o.name).join(",")}`;
  const components = [...new Map(comps.map((c) => [key(c), c])).values()].slice(0, LIMIT.components);
  return { root, ui_dir: uiDir || null, tokens: byKind, components, counts: { files: n, tokens: seen.size, components: components.length } };
}
