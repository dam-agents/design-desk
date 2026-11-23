#!/usr/bin/env node
// Development only: serves the Desk page with a made-up Desk in the browser (desk/dev/mock-data.mjs),
// no Desk server needed. The page is read again on every load.
//   node desk/dev/mock.mjs 5610
//   open "http://localhost:5610/?role=designer#R-1"        (designer; also admin, pm, developer, ui-dev-owner, guest)
//   open "http://localhost:5610/?role=designer&ws=1#R-1"   (opens the design workspace at once)
// The Desk shows light by default; &theme=dark shows it dark; &simple=1 starts in simple mode (a guest does anyway).
// The person menu's switches (simple mode, Figma, day or night) are kept while the mock runs, as the server keeps them.
// What a person sends changes the made-up Desk until the page reloads; a change note is
// claimed after 4 s and worked in after 25 s, so Design Desk's work shows as it happens.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { abilities, replaceText } from "../store.mjs";
import { CARDS, ASSETS, NOTES } from "./mock-data.mjs";

const [port = "5610"] = process.argv.slice(2);
const page = join(dirname(fileURLToPath(import.meta.url)), "..", "page.html");
const ROLES = ["admin", "designer", "pm", "ui-dev-owner", "developer", "guest"];
const CAN = Object.fromEntries(ROLES.map((r) => [r, abilities(r)]));

function shim() {
  const q = new URLSearchParams(location.search);
  const role = q.get("role") || "designer";
  const me = { role, email: "alice@example.com", emails: ["alice@example.com", "alice@slack.example.com"], names: { "alice@example.com": "Alice Novak", "alice@slack.example.com": "Alice Novak", "pat@example.com": "Pat Lee" }, name: "Alice Novak", my_name: "Alice Novak", can: CAN[role] || CAN.designer, figma: true, screens: q.get("screens") !== "0", theme: q.get("theme") || "light", due_days: 21, auto_days: 14 };
  me.link = "https://desk.example.com/a/mock"; // the Desk's own link: the title's link icon copies an item's link from it
  if (q.get("simple")) me.simple = q.get("simple") === "1";
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
      if (c.responsible?.who === "design-desk") delete c.responsible;
    }, 25000);
  };
  // A request before design shows only to whom the server shows it (docs/desk.md → Draft and Proposal).
  // Only a draft is private: its author's (who files drafts) and an admin's; a proposal is everyone's.
  const seen = (c) => c.stage !== "draft" || role === "admin" || (!["designer", "guest"].includes(role) && c.by?.email === me.email);
  const list = () => cards.filter(seen).map((c) => ({ ...c, variants: c.variants.length, threads: undefined }));
  const answer = (method, path, body) => {
    const p = path.replace(/\?.*$/, ""), m = (re) => p.match(re);
    if (p === "/api/me") return me;
    // A person's preferences, kept while the mock runs and answered as the server answers them.
    if (p === "/api/prefs" && method === "POST") {
      // /api/me's figma says whether Figma is on for the Desk; the person's own choice is figma_pref.
      if (body && "theme" in body) me.theme = body.theme;
      if (body && "simple" in body) me.simple = body.simple;
      if (body && "figma" in body) me.figma_pref = body.figma;
      return { theme: me.theme || null, simple: typeof me.simple === "boolean" ? me.simple : null, figma: typeof me.figma_pref === "boolean" ? me.figma_pref : null };
    }
    if (p === "/api/cards" && method === "GET") return { cards: list() };
    if (p.startsWith("/api/assets/")) return ASSETS[decodeURIComponent(p.slice(12))] || {};
    if (p === "/api/agenda") return { agenda: [] };
    if (p === "/api/notifications") return { seen: null, items: notes, unread: notes.filter((x) => x.for_you && !x.read).length };
    if (p === "/api/notifications/seen") return {};
    if (p === "/api/notifications/read") { const x = notes.find((y) => y.id === new URLSearchParams(path.split("?")[1]).get("id")); if (x) x.read = true; return {}; }
    if (p.startsWith("/api/decisions/")) { const id = decodeURIComponent(p.slice(15)); const d = cards[0].cited[id]; return d ? { decision: { id, ...d, side: "design", at: now(), concepts: [] } } : {}; }
    if (p.startsWith("/api/decisions")) return { decisions: Object.entries(cards[0].cited).map(([id, d]) => ({ id, ...d, side: "design", at: now(), concepts: [] })) };
    let x;
    if ((x = m(/^\/api\/cards\/([^/]+)$/)) && method === "GET") { const c = card(decodeURIComponent(x[1])); return c && seen(c) ? { card: structuredClone(c) } : { error: "no card" }; }
    if ((x = m(/^\/api\/cards\/([^/]+)\/stage$/)) && method === "POST") {
      const c = card(decodeURIComponent(x[1]));
      if (["design", "developers"].includes(body.to)) { delete c.stage; c.opened_at = now(); if (body.to === "developers") c.for = "developers"; } else c.stage = body.to;
      c.updated = now();
      return { card: structuredClone(c) };
    }
    // A review (docs/desk.md → Reviews): drafts kept for this person, sent as one review whose comments are threads.
    if ((x = m(/^\/api\/cards\/([^/]+)\/drafts$/))) {
      const c = card(decodeURIComponent(x[1]));
      // Looks good: a mark with no words on one change, once; a note on the change takes it back.
      if (method === "POST" && body.work_in) { if (!(c.drafts || []).some((d) => d.work_in === body.work_in)) (c.drafts ||= []).push({ id: `d${++n}`, work_in: body.work_in, at: now() }); }
      else if (method === "POST" && body.ok === true) { if (!(c.drafts || []).some((d) => d.ok && d.change === body.change)) (c.drafts ||= []).push({ id: `d${++n}`, ok: true, change: body.change, at: now() }); }
      else if (method === "POST") { if (body.change) c.drafts = (c.drafts || []).filter((d) => !(d.ok && d.change === body.change)); (c.drafts ||= []).push({ id: `d${++n}`, text: body.text, anchor: body.anchor || null, ...(body.change ? { change: body.change } : {}), at: now() }); }
      return { drafts: c.drafts || [] };
    }
    if ((x = m(/^\/api\/cards\/([^/]+)\/drafts\/([^/]+)$/))) { const c = card(decodeURIComponent(x[1])); c.drafts = (c.drafts || []).filter((d) => d.id !== x[2]); return { drafts: c.drafts }; }
    if ((x = m(/^\/api\/cards\/([^/]+)\/reviews$/))) {
      const c = card(decodeURIComponent(x[1])), all = c.drafts || [], ds = all.filter((d) => !d.ok && !d.work_in), oks = all.filter((d) => d.ok), wis = all.filter((d) => d.work_in), id = `U-${++n}`;
      if (!all.length && !body.note) return { error: "Write a comment or a note first." };
      const request = c.kind === "request", changes = body.verdict === "request-changes", first = body.variant || c.variants[0]?.id;
      const notes = ds.length ? ds : request && changes ? [{ text: body.note, anchor: null }] : [];
      const ts = notes.map((d) => ({ id: `T-${++n}`, kind: request && changes ? "change" : "comment", state: "open", review: id, may: { reply: true, resolve: true }, anchor: request && changes && !d.anchor?.variant ? { ...(d.anchor || {}), variant: first } : d.anchor, ...(d.change ? { change: d.change } : {}), messages: [{ by: { name: me.name, email: me.email, role }, at: now(), text: d.text }] }));
      c.threads.push(...ts); c.drafts = [];
      // Comments to work in: only with Request changes on a request, the same conversation turned into a change note.
      if (request && changes) for (const d of wis) { const t = c.threads.find((x) => x.id === d.work_in); if (t) { t.was = t.kind; t.kind = "change"; t.state = "open"; t.review = id; t.needs_agent = true; ts.push(t); } }
      // The mock has no head commit: a Looks good holds until the page reloads.
      const named = (k) => { const sh = (c.screens || []).find((x) => x.pair === k || x.asset === k); return sh?.pair || sh?.caption || k; };
      (c.reviews ||= []).push({ id, by: { name: me.name, email: me.email, role }, at: now(), verdict: body.verdict, note: body.note || "", threads: ts.map((t) => t.id), ...(oks.length ? { looks_good: oks.map((d) => ({ key: d.change, name: named(d.change) })) } : {}) });
      if (oks.length) c.looks_good = [...new Set([...(c.looks_good || []), ...oks.map((d) => d.change)])];
      if (request && changes) work(c, ts);
      if (!request && body.verdict === "approve") c.handled = { by: { email: me.email }, at: now() };
      if (changes) c.responsible = { who: request ? "design-desk" : "developer", review: id, since: now() };
      return { review: c.reviews.at(-1), inbox: !request && c.source?.pr ? { kind: "review" } : changes ? { kind: "revise" } : null };
    }
    if ((x = m(/^\/api\/cards\/([^/]+)\/threads$/))) {
      const c = card(x[1]), t = { id: `T-${++n}`, kind: body.kind, state: "open", may: { reply: true, resolve: true }, anchor: body.anchor, messages: [{ by: { name: me.name, email: me.email }, at: now(), text: body.text }] };
      c.threads.push(t); if (t.kind === "change") work(c, [t]);
      return { thread: t };
    }
    // A vote as the store keeps it: a thumb, and a concern beside it (store.mjs → vote).
    if ((x = m(/^\/api\/cards\/([^/]+)\/votes$/))) {
      const c = card(x[1]), box = ((c.votes ||= {})[body.variant] ||= {}), mineAt = Object.keys(box).filter((k) => me.emails.includes(k)), olds = mineAt.map((k) => box[k]).sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      for (const k of mineAt) delete box[k];
      let thumb = olds.map((x) => x.vote).find((t) => ["prefer", "dislike"].includes(t)) || null, worry = olds.some((x) => x.concern || x.vote === "concern");
      if (body.vote === "none") thumb = null; else if (body.vote === "concern") worry = true; else if (body.vote) thumb = body.vote;
      if (body.concern !== undefined) worry = body.concern;
      if (!thumb && !worry) delete box[me.email]; else box[me.email] = { vote: thumb, ...(worry ? { concern: true } : {}), role, at: now() };
      return { votes: c.votes };
    }
    if ((x = m(/^\/api\/cards\/([^/]+)\/work-in$/))) { const c = card(x[1]); const ts = c.threads.filter((t) => body.threads.includes(t.id)); for (const t of ts) t.kind = "change"; work(c, ts); return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/messages$/))) { const [, t] = thread(x[1]); t?.messages.push({ by: { name: me.name, email: me.email }, at: now(), text: body.text }); return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/resolve$/))) { const [, t] = thread(x[1]); if (t) t.state = "resolved"; return {}; }
    if ((x = m(/^\/api\/threads\/([^/]+)\/reopen$/))) { const [, t] = thread(x[1]); if (t) t.state = "open"; return {}; }
    // Edit text, saved: the words change in the page as its next version, as the server does.
    if ((x = m(/^\/api\/cards\/([^/]+)\/text$/))) {
      const c = card(x[1]), v = c.variants.find((y) => y.id === body.variant), d = body.state ? v.states.find((y) => y.id === body.state) : v;
      const html = replaceText(ASSETS[d.asset]?.data || "", body.from, body.to, body.nth, body.count);
      if (html == null) return { error: "This text can't be changed here: it is not in one piece of the design's page. Send the change to Design Desk." };
      const id = `${d.asset}-t${++n}`; ASSETS[id] = { ...ASSETS[d.asset], id, data: html };
      d.history = [{ version: d.version || 1, asset: d.asset, at: now() }, ...(d.history || [])]; d.version = (d.version || 1) + 1; d.asset = id;
      return { card: c, changed: true };
    }
    if ((x = m(/^\/api\/cards\/([^/]+)\/actions$/))) {
      const c = card(x[1]);
      if (body.action === "pick-alternative") { const v = c.variants.find((y) => y.id === body.variant), a = v.alternatives.find((y) => y.id === body.note); v.history = [{ version: v.version, asset: v.asset, at: now() }, ...(v.history || [])]; v.version++; v.asset = a.asset; v.alternatives = []; }
      if (body.action === "drop-option") c.variants = c.variants.filter((y) => y.id !== body.variant);
      // A part from the product: waits, then comes back as its picture before (docs/requests.md → The part before, from the product).
      if (body.action === "take-before") {
        const w = { kind: "explore", scope: "before", element: body.element, state: "queued", created: now() };
        c.waiting.push(w);
        setTimeout(() => { c.waiting = c.waiting.filter((y) => y !== w); c.before_shots = [...(c.before_shots || []).filter((y) => y.id !== body.element), { id: body.element, asset: "A-before-change", source: "instance", ref: "main", commit: "4286de5", at: now() }]; }, 6000);
        return { inbox: w };
      }
      return {};
    }
    return {};
  };
  window.platform = Object.freeze({
    sendPrompt(p) { console.log("[sendPrompt]", p); },
    async request({ method, path, body }) {
      const a = answer(method, path, body ? JSON.parse(body) : undefined);
      if (a?.error) return { status: 400, contentType: "application/json", body: JSON.stringify(a) };
      return { status: 200, contentType: "application/json", body: JSON.stringify(a) };
    },
    async whoami() { return { role, email: me.email, sub: "dev-" + me.email }; },
  });
  try { localStorage.setItem("desk-theme-last", me.email); localStorage.setItem(`desk-theme:${me.email}`, me.theme); localStorage.removeItem(`desk-theme-unsaved:${me.email}`); localStorage.setItem("desk-guide-seen", "1"); localStorage.setItem("desk-turn", "1"); localStorage.setItem("desk-reqFilter", "open"); } catch {}
  // ?ws=1: the design workspace opens as soon as the request shows its button.
  if (q.get("ws")) { const t = setInterval(() => { const b = document.querySelector('[data-act="workspace"]'); if (b) { clearInterval(t); b.click(); } }, 150); }
}

const SHIM = `<script>const replaceText = ${replaceText.toString()};
const CAN = ${JSON.stringify(CAN)}, CARDS = ${JSON.stringify(CARDS)}, NOTES = ${JSON.stringify(NOTES)}, ASSETS = ${JSON.stringify(ASSETS).replace(/</g, "\\u003c")};
(${shim.toString()})();</script>`;

createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(readFileSync(page, "utf8").replace("<head>", `<head>${SHIM}`));
}).listen(Number(port), "127.0.0.1", () => console.error(`mock Desk on http://localhost:${port}/?role=designer&ws=1#R-1`));
