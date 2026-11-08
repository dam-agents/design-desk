// What in a style sheet (or an inline style) goes beyond the look: loading from another
// host, running script, or switching off or hiding controls people use. Each finding is
// a short text; the guard refuses a change that adds one.
const REMOTE = /^([a-z][\w+.-]*:|\/\/)/i;
const SAFE_DATA = /^data:(image|font)\//i;
// Selectors that reach a control: a button, a link, a field, a form or an ARIA control.
const INTERACTIVE = /(^|[\s>+~,(])(button|a|input|select|textarea|form|label|summary|details|option)(?=$|[\s.#:[>+~,)])|\[\s*(role\s*=\s*["']?(button|link|menuitem|tab|checkbox|switch|option|radio|textbox|combobox)|type|href|onclick|tabindex)/i;

export function cssDangers(text) {
  const out = [];
  const t = String(text || "").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of t.matchAll(/@import\s+(?:url\(\s*)?["']?\s*([^"')\s;]+)/gi)) if (REMOTE.test(m[1])) out.push(`imports ${m[1]}`);
  for (const m of t.matchAll(/url\(\s*(["']?)\s*([^"')]*)/gi)) {
    const u = m[2].trim();
    if (REMOTE.test(u) && !SAFE_DATA.test(u)) out.push(`loads ${u}`);
  }
  if (/-moz-binding|(^|[;{\s])behavior\s*:|expression\s*\(/i.test(t)) out.push("runs script from a style");
  for (const m of t.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " "), decl = m[2];
    if (/pointer-events\s*:\s*none|@apply[^;]*\bpointer-events-none\b/i.test(decl)) out.push(`${sel} { pointer-events: none }`);
    if (/display\s*:\s*none|visibility\s*:\s*hidden|@apply[^;]*\b(hidden|invisible)\b/i.test(decl) && INTERACTIVE.test(sel)) out.push(`${sel} { hides a control }`);
  }
  return out;
}

// The url(...) references in an inline style expression that are not a fixed local path:
// another host, a data URL that is not an image, or a value built at run time.
export function styleUrlDangers(text) {
  const out = [];
  for (const m of String(text || "").matchAll(/url\(([^)]*)\)?/gi)) {
    const arg = m[1].trim();
    const ok = /^(["']?)(data:image\/[^"'`$+{}]*|(?![a-z][\w+.-]*:|\/\/)[^"'`$+{}]*)\1$/i.test(arg);
    if (!ok) out.push(`url(${arg.slice(0, 80)})`);
  }
  return out;
}

// Text an SVG file must not hold: script, event handlers, embedded HTML, outside links.
export function svgDangers(text) {
  const t = String(text || "");
  const out = [];
  if (/<script\b/i.test(t)) out.push("a <script>");
  if (/\son[a-z]+\s*=/i.test(t)) out.push("an event handler (on…)");
  if (/<foreignObject\b/i.test(t)) out.push("a <foreignObject>");
  if (/<(iframe|embed|object)\b/i.test(t)) out.push("an embedded document");
  if (/javascript:/i.test(t)) out.push("a javascript: address");
  if (/(xlink:)?href\s*=\s*["']\s*(?!data:image\/)([a-z][\w+.-]*:|\/\/)/i.test(t)) out.push("a link to another address");
  out.push(...cssDangers((t.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) || []).join("\n")));
  return out;
}
