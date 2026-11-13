#!/usr/bin/env node
// Development only: serves the Desk page with a made-up Desk in the browser (desk/dev/mock-data.mjs),
// no Desk server needed. The page is read again on every load.
//   node desk/dev/mock.mjs 5610
//   open "http://localhost:5610/?role=designer#R-1"        (designer; also admin, pm, developer, lead-developer, guest)
//   open "http://localhost:5610/?role=designer&ws=1#R-1"   (opens the design workspace at once)
// The Desk shows light by default; &theme=dark shows it dark.
// What a person sends changes the made-up Desk until the page reloads; a change note is
// claimed after 4 s and worked in after 25 s, so Design Desk's work shows as it happens.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abilities } from "../store.mjs";
import { CARDS, ASSETS, NOTES } from "./mock-data.mjs";

const [port = "5610"] = process.argv.slice(2);
const page = join(dirname(fileURLToPath(import.meta.url)), "..", "page.html");
const ROLES = ["admin", "designer", "pm", "lead-developer", "developer", "guest"];
const CAN = Object.fromEntries(ROLES.map((r) => [r, abilities(r)]));

function shim() {
  const q = new URLSearchParams(location.search);
  const role = q.get("role") || "designer";
  const me = { role, email: "alice@example.com", name: "Alice Novak", my_name: "Alice Novak", can: CAN[role] || CAN.designer, figma: true, theme: q.get("theme") || "light", due_days: 21, auto_days: 14 };
  const cards = structuredClone(CARDS), notes = structuredClone(NOTES);
  const now = () => new Date().toISOString();
  const card = (id) => cards.find((c) => c.id === id);
  const thread = (id) => cards.flatMap((c) => c.threads.map((t) => [c, t])).find(([, t]) => t.id === id) || [];
  let n = 100;
  // A change note: queued, claimed after 4 s, worked in after 25 s with a reply and a new version.
  const work = (c, threads) => {
    const v = c.variants.find((x) => x.id === threads[0]?.anchor?.variant);
    const w = { kind: "revise", state: "queued", created: now(), ...(v ? { variant: v.id } : {}) };
    c.waiting.push(w);
    setTimeout(() => Object.assign(w, { state: "claimed", started: now(), usual_min: 1 }), 4000);
    setTimeout(() => {
      c.waiting = c.waiting.filter((x) => x !== w);
      for (const t of threads) { t.state = "resolved"; t.messages.push({ by: { agent: true }, at: now(), text: `Done in version ${(v?.version || 1) + 1}.` }); }
      if (v) { v.history = [{ version: v.version || 1, asset: v.asset, at: now() }, ...(v.history || [])]; v.version = (v.version || 1) + 1; v.drawn = now(); }
    }, 25000);
  };
  const list = () => cards.map((c) => ({ ...c, variants: c.variants.length, threads: undefined }));
  const answer = (method, path, body) => {
    const p = path.replace(/\?.*$/, ""), m = (re) => p.match(re);
    if (p === "/api/me") return me;
    if (p === "/api/cards" && method === "GET") return { cards: list() };
    if (p.startsWith("/api/assets/")) return ASSETS[decodeURIComponent(p.slice(12))] || {};
    if (p === "/api/agenda") return { agenda: [] };
    if (p === "/api/notifications") return { seen: null, items: notes, unread: notes.filter((x) => x.for_you && !x.read).length };
    if (p === "/api/notifications/seen") return {};
    if (p === "/api/notifications/read") { const x = notes.find((y) => y.id === new URLSearchParams(path.split("?")[1]).get("id")); if (x) x.read = true; return {}; }
    if (p.startsWith("/api/decisions/")) { const id = decodeURIComponent(p.slice(15)); const d = cards[0].cited[id]; return d ? { decision: { id, ...d, side: "design", at: now(), concepts: [] } } : {}; }
    if (p.startsWith("/api/decisions")) return { decisions: Object.entries(cards[0].cited).map(([id, d]) => ({ id, ...d, side: "design", at: now(), concepts: [] })) };
    let x;
    if ((x = m(/^\/api\/cards\/([^/]+)$/)) && method === "GET") return { card: structuredClone(card(decodeURIComponent(x[1]))) };
    if ((x = m(/^\/api\/cards\/([^/]+)\/threads$/))) {
      const c = card(x[1]), t = { id: `T-${++n}`, kind: body.kind, state: "open", may: { reply: true, resolve: true }, anchor: body.anchor, messages: [{ by: { name: me.name, email: me.email }, at: now(), text: body.text }] };
      c.threads.push(t); if (t.kind === "change") work(c, [t]);
      return { thread: t };
    }
    // A vote as the store keeps it: a thumb, and a concern beside it (store.mjs → vote).
    if ((x = m(/^\/api\/cards\/([^/]+)\/votes$/))) {
      const c = card(x[1]), box = ((c.votes ||= {})[body.variant] ||= {}), was = box[me.email] || {};
      let thumb = ["prefer", "dislike"].includes(was.vote) ? was.vote : null, worry = Boolean(was.concern);
      if (body.vote === "none") thumb = null; else if (body.vote === "concern") worry = true; else if (body.vote) thumb = body.vote;
      if (body.concern !== undefined) worry = body.concern;
      if (!thumb && !worry) delete box[me.email]; else box[me.email] = { vote: thumb, ...(worry ? { concern: true } : {}), role, at: now() };
      return { votes: c.votes };
    }
    if ((x = m(/^\/api\/cards\/([^/]+)\/work-in$/))) { const c = card(x[1]); const ts = c.threads.filter((t) => body.threads.includes(t.id)); for (const t of ts) t.kind = "change"; work(c, ts); return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/messages$/))) { const [, t] = thread(x[1]); t?.messages.push({ by: { name: me.name, email: me.email }, at: now(), text: body.text }); return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/resolve$/))) { const [, t] = thread(x[1]); if (t) t.state = "resolved"; return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/reopen$/))) { const [, t] = thread(x[1]); if (t) t.state = "open"; return {}; }
    if ((x = m(/^\/api\/cards\/([^/]+)\/actions$/))) {
      const c = card(x[1]);
      if (body.action === "pick-alternative") { const v = c.variants.find((y) => y.id === body.variant), a = v.alternatives.find((y) => y.id === body.note); v.history = [{ version: v.version, asset: v.asset, at: now() }, ...(v.history || [])]; v.version++; v.asset = a.asset; v.alternatives = []; }
      if (body.action === "drop-option") c.variants = c.variants.filter((y) => y.id !== body.variant);
      return {};
    }
    return {};
  };
  window.platform = Object.freeze({
    sendPrompt(p) { console.log("[sendPrompt]", p); },
    async request({ method, path, body }) {
      const a = answer(method, path, body ? JSON.parse(body) : undefined);
      return { status: 200, contentType: "application/json", body: JSON.stringify(a) };
    },
    async whoami() { return { role, email: me.email, sub: "dev-" + me.email }; },
  });
  try { localStorage.setItem("desk-theme-last", me.email); localStorage.setItem(`desk-theme:${me.email}`, me.theme); localStorage.removeItem(`desk-theme-unsaved:${me.email}`); localStorage.setItem("desk-guide-seen", "1"); localStorage.setItem("desk-turn", "1"); localStorage.setItem("desk-reqFilter", "open"); } catch {}
  // ?ws=1: the design workspace opens as soon as the request shows its button.
  if (q.get("ws")) { const t = setInterval(() => { const b = document.querySelector('[data-act="workspace"]'); if (b) { clearInterval(t); b.click(); } }, 150); }
}

const SHIM = `<script>const CAN = ${JSON.stringify(CAN)}, CARDS = ${JSON.stringify(CARDS)}, NOTES = ${JSON.stringify(NOTES)}, ASSETS = ${JSON.stringify(ASSETS).replace(/</g, "\\u003c")};
(${shim.toString()})();</script>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(readFileSync(page, "utf8").replace("<head>", `<head>${SHIM}`));
}).listen(Number(port), "127.0.0.1", () => console.error(`mock Desk on http://localhost:${port}/?role=designer&ws=1#R-1`));
