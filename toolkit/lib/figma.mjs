// Figma's REST API, read only (the figma skill → The connection). The token comes from the
// platform's Custom Header connection (X-Figma-Token, injected on the wire) or, where the
// agent runs without one, from FIGMA_TOKEN. Nothing here writes to Figma: REST cannot
// create layers, and comments or links in a team's file are the skill's call to make.
import { createHash } from "node:crypto";

export const API = process.env.FIGMA_API || "https://api.figma.com";

// A link names the file and the node: https://www.figma.com/design/<key>/<name>?node-id=<a>-<b>
// (also /file/ and /proto/, and a branch: /design/<key>/branch/<branch-key>/<name>).
export function parseLink(url) {
  let u;
  try { u = new URL(String(url)); } catch { return null; }
  if (!/(^|\.)figma\.com$/.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/(?:design|file|proto|board)\/([A-Za-z0-9]+)(?:\/branch\/([A-Za-z0-9]+))?/);
  if (!m) return null;
  const raw = u.searchParams.get("node-id");
  const node = raw ? raw.replace(/-/g, ":") : null;
  return { key: m[2] || m[1], node, url: String(url) };
}

export const linkTo = (key, node, name = "") =>
  `https://www.figma.com/design/${key}/${encodeURIComponent(String(name || "file").replace(/\s+/g, "-"))}${node ? `?node-id=${String(node).replace(/:/g, "-")}` : ""}`;

const hex2 = (x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0");
export const hexOf = (c, opacity = 1) => {
  if (!c) return null;
  const a = (c.a ?? 1) * opacity;
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`.toUpperCase() + (a < 0.999 ? hex2(a).toUpperCase() : "");
};

// What a frame is made of, small enough to read next to the product's tokens: its colours,
// type, spacing and corners with how often each is used and on which parts, the component
// instances, and the texts. `hash` changes when any of it changes, so a check can tell a
// frame edited since the last comparison without drawing it again.
export function summarize(node, components = {}, { maxTexts = 80, maxParts = 3 } = {}) {
  const colors = new Map(), fonts = new Map(), spacing = new Map(), radii = new Map(), used = new Map(), texts = [];
  const bump = (map, key, part, extra = {}) => {
    const x = map.get(key) || { ...extra, uses: 0, parts: [] };
    x.uses += 1;
    if (part && x.parts.length < maxParts && !x.parts.includes(part)) x.parts.push(part);
    map.set(key, x);
  };
  const walk = (n, depth = 0) => {
    if (!n || n.visible === false) return;
    const part = n.name || n.type;
    for (const [list, role] of [[n.fills, "fill"], [n.strokes, "stroke"]])
      for (const p of Array.isArray(list) ? list : []) if (p.type === "SOLID" && p.visible !== false) bump(colors, hexOf(p.color, p.opacity ?? 1), part, { role });
    if (n.type === "TEXT" && n.style) {
      const s = n.style, font = `${s.fontFamily} ${s.fontSize} / ${s.fontWeight}`;
      bump(fonts, font, part, { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight, line: s.lineHeightPx ? Math.round(s.lineHeightPx) : null });
      if (texts.length < maxTexts && n.characters) texts.push({ part, text: String(n.characters).slice(0, 200), font });
    }
    if (n.layoutMode && n.layoutMode !== "NONE") {
      if (n.itemSpacing) bump(spacing, `gap ${n.itemSpacing}`, part);
      for (const k of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]) if (n[k]) bump(spacing, `padding ${n[k]}`, part);
    }
    if (n.cornerRadius) bump(radii, `radius ${n.cornerRadius}`, part);
    if (n.type === "INSTANCE") {
      const c = components[n.componentId];
      bump(used, c?.name || n.name, part, { key: c?.key || null });
    }
    for (const ch of n.children || []) walk(ch, depth + 1);
  };
  walk(node);
  const list = (map, name) => [...map.entries()].map(([k, v]) => ({ [name]: k, ...v })).sort((a, b) => b.uses - a.uses);
  const out = {
    name: node?.name || "", type: node?.type || "",
    size: node?.absoluteBoundingBox ? { w: Math.round(node.absoluteBoundingBox.width), h: Math.round(node.absoluteBoundingBox.height) } : null,
    colors: list(colors, "hex"), fonts: list(fonts, "font"), spacing: list(spacing, "value"), radii: list(radii, "value"),
    components: list(used, "name"), texts,
  };
  out.hash = createHash("sha256").update(JSON.stringify([out.colors, out.fonts, out.spacing, out.radii, out.components, out.texts, out.size])).digest("hex").slice(0, 16);
  return out;
}

// The pages of a file and what sits on them (frames, sections and the frames in them,
// components): where a screen's or an element's design may be. A frame marked ready for
// development says so (`ready`).
export function framesOf(file, key, words = "") {
  const want = String(words || "").toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (s) => !want.length || want.every((w) => s.toLowerCase().includes(w));
  const out = [];
  for (const page of file?.document?.children || []) {
    const visit = (n, section = "") => {
      if (["FRAME", "COMPONENT", "COMPONENT_SET"].includes(n.type) && hit(`${page.name} ${section} ${n.name}`))
        out.push({ page: page.name, section: section || null, name: n.name, node: n.id, type: n.type.toLowerCase(), ready: n.devStatus?.type === "READY_FOR_DEV", url: linkTo(key, n.id, file.name) });
      if (n.type === "SECTION") for (const ch of n.children || []) visit(ch, n.name);
    };
    for (const n of page.children || []) visit(n);
  }
  return out;
}

export function headers() {
  const t = process.env.FIGMA_TOKEN;
  return t ? { "X-Figma-Token": t } : {};
}

// One GET with Figma's answers in plain words: no access, a rate limit with its wait.
export async function get(path, { fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`${API}${path}`, { headers: headers() });
  if (r.status === 403) throw new Error("Figma refused (403): the token is missing, expired, or has no access to this file");
  if (r.status === 404) throw new Error("Figma has no such file or node (404)");
  if (r.status === 429) throw new Error(`Figma's rate limit (429): try again in ${r.headers.get("retry-after") || "a while"} seconds; check fewer frames per run`);
  if (!r.ok) throw new Error(`Figma answered ${r.status}`);
  return r.json();
}
