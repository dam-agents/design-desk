// What in a style sheet, an inline style or an SVG file goes beyond the look: loading from
// another address, running script, or switching off or hiding controls people use. Each
// finding is a short text; the guard refuses a change that adds one.
//
// The check reads what the browser reads, not the text as written: CSS is tokenized
// (comments dropped, escapes decoded, any letter case), an SVG's entities are decoded and
// its elements are matched by local name, whatever their prefix. An address passes only
// when it is provably local: a plain path on the product's own origin or an image data
// URL. Anything else counts as another address.

// A plain path: no scheme, no host (`//`), no backslash, no whitespace, no query, no
// escape left undecoded; an optional #fragment.
const PLAIN_PATH = /^(?!\/\/)[\w.~@%+/-]*(#[\w.-]*)?$/;
const IMAGE_DATA = /^data:image\/[\w.+-]+[;,]/i;
const localAddress = (u) => (u.length > 0 && PLAIN_PATH.test(u)) || IMAGE_DATA.test(u);

// Selectors that reach a control: a button, a link, a field, a form or an ARIA control.
const INTERACTIVE = /(^|[\s>+~,(])(button|a|input|select|textarea|form|label|summary|details|option)(?=$|[\s.#:[>+~,)])|\[\s*(role\s*=\s*["']?(button|link|menuitem|tab|checkbox|switch|option|radio|textbox|combobox)|type|href|onclick|tabindex)/i;
// Functions whose string arguments are addresses.
const URL_FNS = new Set(["url", "src"]);
const IMAGE_FNS = new Set(["image-set", "-webkit-image-set", "image", "cross-fade", "-webkit-cross-fade"]);

// ---------- CSS tokens (CSS Syntax Level 3, the parts that carry an address) ----------

const WS = /[ \t\n\r\f]/;
const HEX = /[0-9a-fA-F]/;
const NAME = /[\w\-\u0080-\uFFFF]/;
const NAME_START = /[a-zA-Z_\u0080-\uFFFF]/;
const codePoint = (n) => (n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "\uFFFD");

function tokenize(css) {
  const s = String(css || ""), out = [];
  let i = 0;
  const validEscape = (k) => s[k] === "\\" && k + 1 < s.length && !/[\n\r\f]/.test(s[k + 1]);
  const escape = () => { // at a backslash: the character it stands for
    i++;
    let h = "";
    while (h.length < 6 && i < s.length && HEX.test(s[i])) h += s[i++];
    if (!h) return i < s.length ? s[i++] : "\uFFFD";
    if (s[i] === "\r" && s[i + 1] === "\n") i += 2; else if (WS.test(s[i] || "")) i++;
    return codePoint(parseInt(h, 16));
  };
  const name = () => { let v = ""; for (;;) { if (validEscape(i)) v += escape(); else if (i < s.length && NAME.test(s[i])) v += s[i++]; else return v; } };
  const startsName = (k) => NAME_START.test(s[k] || "") || validEscape(k) || (s[k] === "-" && (NAME_START.test(s[k + 1] || "") || s[k + 1] === "-" || validEscape(k + 1)));
  const urlToken = () => {
    let v = "", bad = false;
    while (i < s.length && s[i] !== ")") {
      const c = s[i];
      if (WS.test(c)) { while (i < s.length && WS.test(s[i])) i++; if (i < s.length && s[i] !== ")") bad = true; continue; }
      if (c === "\\") { if (validEscape(i)) v += escape(); else { bad = true; v += c; i++; } continue; }
      if (c === '"' || c === "'" || c === "(" || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(c)) bad = true;
      v += c; i++;
    }
    i++;
    return { t: "url", v, bad };
  };
  while (i < s.length) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "*") { const e = s.indexOf("*/", i + 2); i = e < 0 ? s.length : e + 2; continue; }
    if (WS.test(c)) { while (i < s.length && WS.test(s[i])) i++; out.push({ t: "ws" }); continue; }
    if (c === '"' || c === "'") {
      i++;
      let v = "", bad = false;
      while (i < s.length && s[i] !== c) {
        if (s[i] === "\\") { if (/[\n\r\f]/.test(s[i + 1] || "")) i += s[i + 1] === "\r" && s[i + 2] === "\n" ? 3 : 2; else v += escape(); continue; }
        if (/[\n\r\f]/.test(s[i])) { bad = true; break; }
        v += s[i++];
      }
      if (s[i] === c) i++;
      out.push({ t: "str", v, bad });
      continue;
    }
    if (c === "@" && startsName(i + 1)) { i++; out.push({ t: "at", v: name().toLowerCase() }); continue; }
    if (startsName(i)) {
      const v = name();
      if (s[i] !== "(") { out.push({ t: "ident", v }); continue; }
      i++;
      if (v.toLowerCase() === "url") {
        let k = i;
        while (k < s.length && WS.test(s[k])) k++;
        if (s[k] !== '"' && s[k] !== "'") { i = k; out.push(urlToken()); continue; }
      }
      out.push({ t: "fn", v: v.toLowerCase() });
      continue;
    }
    out.push({ t: "delim", v: c });
    i++;
  }
  return out;
}

// The tokens as plain text, for the declaration tests: a string's braces and semicolons
// cannot end a rule.
const serialize = (toks) => toks.map((x) => (x.t === "ws" ? " " : x.t === "str" ? `"${x.v.replace(/[{};"\\]/g, "_")}"` : x.t === "url" ? `url(${x.v})` : x.t === "fn" ? `${x.v}(` : x.t === "at" ? `@${x.v}` : x.v)).join("");

export function cssDangers(text) {
  const toks = tokenize(text), out = [];
  const sig = toks.filter((x) => x.t !== "ws");
  const ref = (what, x) => { if (x.bad || !localAddress(x.v)) out.push(`${what} ${x.v.slice(0, 80) || "(an empty address)"}`); };
  // `custom`: inside the value of a custom property (`--*`). var() can carry its strings
  // into image-set() or another image function, so each one must be a local address.
  const stack = [];
  let custom = false;
  for (let k = 0; k < sig.length; k++) {
    const x = sig[k];
    if (x.t === "fn") stack.push(x.v);
    else if (x.t === "delim" && x.v === "(") stack.push("(");
    else if (x.t === "delim" && x.v === ")") stack.pop();
    else if (x.t === "delim" && /[;{}]/.test(x.v)) { stack.length = 0; custom = false; }
    else if (x.t === "ident" && x.v.startsWith("--") && sig[k + 1]?.t === "delim" && sig[k + 1].v === ":") custom = true;
    if (x.t === "url") ref("loads", x);
    else if (x.t === "fn" && URL_FNS.has(x.v)) {
      if (sig[k + 1]?.t === "str") ref("loads", sig[++k]);
      else out.push(`loads ${x.v}(…) that is not one address`);
    } else if (x.t === "str" && (custom || stack.some((f) => IMAGE_FNS.has(f)))) ref("loads", x);
    else if (x.t === "at" && x.v === "import") {
      const a = sig[k + 1];
      if (a?.t === "str") { ref("imports", a); k++; }
      else if (!(a?.t === "url" || (a?.t === "fn" && URL_FNS.has(a.v)))) out.push("imports something that is not one address");
    }
  }
  const t = serialize(toks);
  if (/-moz-binding|(^|[;{\s])(-ms-)?behavior\s*:|expression\s*\(/i.test(t)) out.push("runs script from a style");
  for (const m of t.matchAll(/([^{};]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim().replace(/\s+/g, " "), decl = m[2];
    if (/pointer-events\s*:\s*none|@apply[^;]*\bpointer-events-none\b/i.test(decl)) out.push(`${sel} { pointer-events: none }`);
    if (/display\s*:\s*none|visibility\s*:\s*hidden|@apply[^;]*\b(hidden|invisible)\b/i.test(decl) && INTERACTIVE.test(sel)) out.push(`${sel} { hides a control }`);
  }
  return out;
}

// ---------- SVG ----------

const XML_NAMED = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
// Character references and the five XML entities, decoded (an unknown one stays as written).
export const xmlDecode = (v) => String(v).replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, h, d, n) => (h ? codePoint(parseInt(h, 16)) : d ? codePoint(parseInt(d, 10)) : XML_NAMED[n] ?? m));
// Text outside CDATA sections is decoded; a CDATA section is taken as written.
const xmlText = (t) => t.split(/(<!\[CDATA\[[\s\S]*?(?:\]\]>|$))/).map((p) => (p.startsWith("<![CDATA[") ? p.slice(9).replace(/\]\]>$/, "") : xmlDecode(p))).join("");
const PREFIX = "(?:[^\\s<>/:!?=\"']+:)?";
const ACTIVE_SVG = ["script", "foreignObject", "iframe", "frame", "embed", "object", "applet", "portal", "handler", "listener", "link", "meta", "base"];
const ACTIVE_RE = new RegExp(`<\\s*${PREFIX}(${ACTIVE_SVG.join("|")})(?=[\\s/>]|$)`, "gi");
const STYLE_RE = new RegExp(`<\\s*${PREFIX}style\\b[^>]*>([\\s\\S]*?)(?:<\\/\\s*${PREFIX}style\\s*>|$)`, "gi");

// The attributes of every start tag, as [name, raw value]. Comments, CDATA sections,
// processing instructions, declarations, end tags and text hold no attributes; a start
// tag ends at its first unquoted `>`. Where an XML and an HTML parser end a part at
// different places, the earlier end is taken, so more is read as markup: a comment also
// ends at `<!-->`, `<!--->` or `--!>`, a processing instruction at its first `>`.
// An unquoted value or a bare name (XML parse errors) is read too.
function startTagAttributes(t) {
  const out = [];
  let i = 0;
  const skipTo = (...ends) => { i = Math.min(t.length, ...ends.map(([e, from]) => { const k = t.indexOf(e, from); return k < 0 ? Infinity : k + e.length; })); };
  while (i < t.length) {
    const lt = t.indexOf("<", i);
    if (lt < 0) break;
    i = lt;
    if (t.startsWith("<!--", i)) skipTo(["-->", i + 2], ["--!>", i + 4]);
    else if (t.startsWith("<![CDATA[", i)) skipTo(["]]>", i + 9]);
    else if (t[i + 1] === "?" || t[i + 1] === "!" || t[i + 1] === "/") skipTo([">", i + 1]);
    else if (!/[^\s<>/=]/.test(t[i + 1] || "")) i++; // a lone `<` is text
    else {
      i++;
      while (i < t.length && !/[\s/>]/.test(t[i])) i++; // the element name
      for (;;) {
        while (i < t.length && /[\s/]/.test(t[i])) i++;
        if (i >= t.length || t[i] === ">") { i++; break; }
        let name = "";
        while (i < t.length && !/[\s/>=]/.test(t[i])) name += t[i++];
        while (/\s/.test(t[i] || "")) i++;
        if (t[i] !== "=") { if (name) out.push([name, ""]); continue; }
        i++;
        while (/\s/.test(t[i] || "")) i++;
        let v = "";
        if (t[i] === '"' || t[i] === "'") {
          const q = t[i++], e = t.indexOf(q, i);
          v = t.slice(i, e < 0 ? t.length : e);
          i = e < 0 ? t.length : e + 1;
        } else while (i < t.length && !/[\s>]/.test(t[i])) v += t[i++];
        if (name) out.push([name, v]);
      }
    }
  }
  return out;
}

// What an SVG file must not hold: script, event handlers, embedded documents, entity
// declarations, and addresses other than a #fragment or an image data URL.
export function svgDangers(text) {
  const t = String(text || "");
  const out = [];
  for (const m of t.matchAll(ACTIVE_RE)) out.push(`a <${m[1]}>`);
  if (/<\?\s*xml-stylesheet/i.test(t)) out.push("a style sheet link (<?xml-stylesheet?>)");
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(t)) out.push("an entity declaration");
  if (/javascript:/i.test(t)) out.push("a javascript: address");
  for (const [name, raw] of startTagAttributes(t)) {
    const local = name.split(":").pop().toLowerCase(), value = xmlDecode(raw);
    if (/^xmlns(:|$)/i.test(name)) continue;
    // The URL parser drops tabs and newlines, and spaces at either end.
    const addr = value.replace(/[\t\n\r]/g, "").replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
    if (local.startsWith("on")) out.push(`an event handler ${name}="${value.slice(0, 60)}"`);
    if (/(java|vb)script:/i.test(addr)) out.push(`a script address in ${name}`);
    if (local === "href" || local === "src") { if (!/^(#[\w.:-]*)?$/.test(addr) && !IMAGE_DATA.test(addr)) out.push(`a link to ${addr.slice(0, 80)}`); }
    else if (/^(values|from|to|by)$/.test(local) && addr.split(";").some((p) => /^([a-z][\w+.-]*:|[\\/][\\/])/i.test(p.trim()) && !IMAGE_DATA.test(p.trim()))) out.push(`a link to ${addr.slice(0, 80)}`);
    else for (const d of cssDangers(value)) out.push(`${name}: ${d}`); // fill="url(…)", style="…"
  }
  for (const m of t.matchAll(STYLE_RE)) out.push(...cssDangers(xmlText(m[1])));
  return out;
}
