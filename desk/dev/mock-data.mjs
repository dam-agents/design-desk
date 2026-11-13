// Development only: made-up requests that put the design workspace in every state it can
// show — options, pages, states, alternatives, versions, decisions, smart controls, notes in
// each state, and Design Desk at work on one option. The designs are screens of DAM, the
// agent app this tool serves. Read by desk/dev/mock.mjs.
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const BAR = readFileSync(join(here, "..", "..", "toolkit", "chrome", "review-bar.html"), "utf8");
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();

const I = {
  home: '<path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  folder: '<path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8A1.5 1.5 0 0 1 20.5 9v8.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/>',
  gift: '<path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13M12 7c-2-3-5-3-5-1s3 1 5 1c2 0 5 1 5-1s-3-2-5 1"/>',
  doc: '<path d="M4 5h7v14H4zM13 5h7v14h-7zM6 9h3M6 12h3M15 9h3M15 12h3"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="M15 6l-6 6 6 6"/>', info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>',
  chev: '<path d="M7 10l5 5 5-5"/>', check: '<path d="M7.5 12.5l3 3 6-6.5"/>',
};
const ic = (k, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${I[k]}</svg>`;
const face = (c = "#d4573b") => `<svg class="face" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 0 1 16 0" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><path d="M5 15a8 8 0 0 0 14 0" fill="none" stroke="${c}" stroke-width="2.4" stroke-linecap="round"/><circle cx="9.5" cy="11" r="1.7" fill="${c}"/><circle cx="14.5" cy="11" r="1.7" fill="${c}"/></svg>`;

// One drawn option of DAM's agent settings: three pages (Providers, Usage, General), the agent's
// menu, an empty state, design notes. `limit` is how the daily limit is drawn.
function design({ title, ink = "#16181d", accent = "#16181d", radius = 8, dense = false, big = false, change = "btn-secondary", limit = "bar", state = "" }) {
  const pad = dense ? 14 : 22;
  const changeBtn = state === "loading" ? `<button id="limit-change" class="btn ${change}" disabled><span class="sp"></span> Saving…</button>`
    : state === "failed" ? `<button id="limit-change" class="btn btn-danger">Try again</button>` : `<button id="limit-change" class="btn ${change}${state === "hover" ? " hov" : ""}" data-clickable>Change</button>`;
  const meter = (pct, spent, of) => limit === "ring"
    ? `<div id="limit-bar" class="ring" style="--p:${pct}"><span>${pct}%</span></div><div><div id="limit-text" class="amount">${spent} of ${of} today</div><div class="sub">Resets at 02:00 your time.</div></div>`
    : limit === "numbers" ? `<div><div id="limit-text" class="amount big">${spent} <span class="of">of ${of}</span></div><div class="sub" id="limit-bar">${pct}% used today · resets at 02:00 your time.</div></div>`
    : `<div class="grow"><div id="limit-text" class="amount${big ? " big" : ""}">${spent} of ${of} today</div><div class="barrow"><div id="limit-bar" class="bar${limit === "steps" ? " steps" : ""}"><i style="width:${pct}%"></i></div><span class="pct">${pct}%</span></div><div class="sub">Resets at 02:00 your time.</div></div>`;
  const card = (name, logo, on, body, also) => `<section class="card">
      <div class="ch">${logo}<div><div class="pn">${name} <span class="ok">${ic("check")}</span></div><div class="sub">supports: <span class="chip">▦</span> <span class="chip">◧</span></div></div>
        <button class="toggle${on ? " on" : ""}" ${name === "Anthropic" ? 'id="toggle-anthropic"' : ""} data-clickable aria-pressed="${on}"><i></i></button></div>
      <div class="cb">${body}<div class="also">Also counted by ${also}<span class="grow"></span>${ic("chev")}</div></div></section>`;
  const providers = state === "empty" ? "" : card("Anthropic", `<span class="logo">A\\</span>`, true,
      `<div class="lh"><span class="k">Daily limit ${ic("info")}</span>${changeBtn}</div><div class="meter">${meter(22, "$1.10", "$5.00")}</div>
       ${state === "failed" ? `<div class="err" id="limit-error">The limit was not saved. Check your connection and try again.</div>` : ""}`,
      `<b class="warn">98% · stops first</b> <span class="muted">Σ 76%</span>`)
    + card("Bob", `<span class="logo img"></span>`, true,
      `<div class="lh"><span class="k">Daily limit ${ic("info")}</span><button id="limit-set" class="btn btn-secondary" data-clickable>Set a limit</button></div><div class="amount">$4.00 today · <span class="muted">No limit</span></div>`,
      `<b class="bad">100% · stops first</b>`);
  const nav = (cur) => [["3", "General", "claude-code · claude-sonnet-5"], ["", "People", "Just you"], ["1", "Providers", "2 providers"], ["", "Connections", "1 connection"], ["", "Skills", "4 enabled"], ["", "Schedules", "2 enabled"], ["2", "Usage", "$30.30 today"]]
    .map(([v, n, s]) => `<button class="sn${n === cur ? " on" : ""}"${v ? ` data-goto-view="${v}"` : ""}><b>${n}</b><span>${s}</span></button>`).join("");
  const page = (view, name, cur, body) => `<div data-view="${view}" data-view-name="${name}" class="app">
    <aside class="side"><div class="brand">DAM <span class="grow"></span>${ic("back")}</div>
      <a>${ic("home")}Home</a><a>${ic("folder")}Artifacts</a><a>${ic("gift")}Starter kits</a>
      <div class="sh">AGENTS <span class="grow"></span>${ic("plus")}</div>
      <a class="on">${face()}Release notes</a><a class="subl">Today</a><a class="subl">A week of signups</a>
      <a class="sel">${face()}Build watcher</a><a>${face("#e8857a")}Ops helper</a>
      <span class="grow"></span><a>${ic("doc")}Documentation</a><a>${ic("gear")}Settings</a></aside>
    <nav class="settings"><button id="agent-menu" class="agent" data-menu-trigger="amenu" data-menu-align="start">${face()}<b>Release notes</b>${ic("chev")}</button>${nav(cur)}</nav>
    <main class="content">${body}</main></div>`;
  return `<!doctype html><html data-review-title="${title}" data-review-style="Style: acme/dam@4f2a9c1"><head><meta charset="utf-8"><title>${title}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&display=swap"><style>
  :root { --ink: ${ink}; --accent: ${accent}; --muted: #646a78; --line: #e2e4ea; --soft: #f1f2f5; --bg: #ffffff; --warn: #c2620b; --bad: #da1e28; --ok: #24a148; --radius: ${radius}px; }
  .dark { --ink: #eceef2; --accent: #eceef2; --muted: #9298a6; --line: #2a2e36; --soft: #1a1d23; --bg: #111317; }
  body { margin: 0; font: 400 14px/1.5 "IBM Plex Sans", system-ui, sans-serif; color: var(--ink); background: var(--bg); }
  .app { display: grid; grid-template-columns: 196px ${dense ? 200 : 230}px minmax(0, 1fr); min-height: 100vh; }
  .grow { flex: 1; } .muted { color: var(--muted); }
  .i { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .face { width: 17px; height: 17px; flex: none; }
  .side { display: flex; flex-direction: column; gap: 2px; padding: 14px 8px; border-right: 1px solid var(--line); }
  .side .brand { display: flex; align-items: center; font-weight: 600; font-size: 12px; padding: 4px 8px 12px; letter-spacing: .02em; }
  .side a { display: flex; align-items: center; gap: 10px; padding: 6px 8px; border-radius: 8px; color: var(--ink); text-decoration: none; cursor: pointer; }
  .side a.on, .side a.sel { background: var(--soft); } .side a.subl { padding-left: 35px; color: var(--muted); padding-block: 3px; }
  .side .sh { display: flex; align-items: center; font-size: 11px; letter-spacing: .12em; color: var(--muted); padding: 14px 8px 6px; }
  .settings { display: flex; flex-direction: column; gap: 4px; padding: ${pad}px 12px; }
  .agent { display: flex; align-items: center; gap: 10px; border: 0; background: none; font: inherit; font-size: 17px; color: var(--ink); padding: 4px 8px 14px; cursor: pointer; }
  .agent .face { width: 24px; height: 24px; } .agent .i { width: 14px; color: var(--muted); }
  .sn { display: grid; text-align: left; border: 0; background: none; font: inherit; color: var(--ink); padding: ${dense ? 6 : 10}px 12px; border-radius: 10px; cursor: pointer; }
  .sn span { color: var(--muted); } .sn.on { background: var(--soft); } .sn:hover { background: var(--soft); }
  .content { padding: ${pad + 4}px ${pad + 6}px; min-width: 0; }
  #title { font-size: ${big ? 30 : 26}px; font-weight: 600; margin: 4px 0 4px; letter-spacing: -.01em; }
  .lead { color: var(--muted); margin: 0 0 ${dense ? 14 : 22}px; }
  #provider-list { display: grid; gap: ${dense ? 10 : 14}px; }
  .card { border: 1px solid var(--line); border-radius: var(--radius); }
  .ch { display: flex; gap: 12px; align-items: flex-start; padding: ${dense ? 12 : 16}px ${dense ? 14 : 18}px; border-bottom: 1px solid var(--line); }
  .ch > div { flex: 1; } .pn { display: flex; align-items: center; gap: 6px; font-size: 16px; font-weight: 500; }
  .ok { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: 50%; background: var(--ok); color: #fff; } .ok .i { width: 13px; height: 13px; stroke-width: 2.4; }
  .logo { width: 30px; height: 30px; display: grid; place-items: center; font: 700 17px/1 system-ui; letter-spacing: -.08em; } .logo.img { border: 1px solid var(--line); border-radius: 4px; width: 24px; height: 24px; }
  .sub { color: var(--muted); font-size: 13px; } .chip { display: inline-block; color: var(--muted); margin-left: 4px; }
  .toggle { width: 38px; height: 22px; border-radius: 999px; border: 0; background: #c6c9d1; position: relative; cursor: pointer; flex: none; }
  .toggle i { position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; } .toggle.on { background: var(--accent); } .toggle.on i { left: 19px; }
  .cb { padding: ${dense ? 10 : 14}px ${dense ? 14 : 18}px; display: grid; gap: ${dense ? 6 : 10}px; }
  .lh { display: flex; align-items: center; justify-content: space-between; } .k { display: inline-flex; align-items: center; gap: 6px; color: var(--muted); } .k .i { width: 15px; height: 15px; }
  .meter { display: flex; align-items: center; gap: 16px; } .amount { font-size: 15px; } .amount.big { font-size: ${big ? 26 : 22}px; font-weight: 600; } .amount .of { font-size: 15px; color: var(--muted); font-weight: 400; }
  .barrow { display: flex; align-items: center; gap: 12px; margin: 8px 0 4px; } .pct { color: var(--muted); font-size: 13px; font-variant-numeric: tabular-nums; }
  .bar { flex: 1; height: ${big ? 10 : 7}px; border-radius: 999px; background: var(--soft); overflow: hidden; } .bar i { display: block; height: 100%; background: var(--accent); border-radius: inherit; }
  .bar.steps { background: repeating-linear-gradient(90deg, var(--soft) 0 calc(20% - 3px), transparent calc(20% - 3px) 20%); border-radius: 2px; } .bar.steps i { border-radius: 2px; }
  .ring { --p: 0; width: 64px; height: 64px; border-radius: 50%; background: conic-gradient(var(--accent) calc(var(--p) * 1%), var(--soft) 0); display: grid; place-items: center; flex: none; }
  .ring span { width: 48px; height: 48px; border-radius: 50%; background: var(--bg); display: grid; place-items: center; font-size: 13px; font-weight: 600; }
  .also { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px; } .also .i { width: 15px; }
  .warn { color: var(--warn); font-weight: 400; } .bad { color: var(--bad); font-weight: 400; }
  .btn { border-radius: ${Math.min(radius, 8)}px; padding: 6px 14px; font: 500 14px "IBM Plex Sans", system-ui; cursor: pointer; border: 1px solid transparent; }
  .btn-primary { background: var(--ink); color: var(--bg); } .btn-secondary { background: var(--bg); color: var(--ink); border-color: var(--line); }
  .btn-ghost { background: none; color: var(--ink); text-decoration: underline; } .btn-danger { background: var(--bad); color: #fff; }
  .btn.hov { background: var(--soft); border-color: #c6c9d1; } .btn-sm { padding: 3px 10px; font-size: 12px; } .btn-lg { padding: 9px 20px; font-size: 15px; }
  .sp { display: inline-block; width: 10px; height: 10px; border: 2px solid currentColor; border-right-color: transparent; border-radius: 50%; animation: s 1s linear infinite; vertical-align: -1px; } @keyframes s { to { transform: rotate(360deg); } }
  .err { color: var(--bad); font-size: 13px; }
  #empty-hint { border: 1px dashed var(--line); border-radius: var(--radius); padding: 36px 20px; text-align: center; color: var(--muted); }
  .stat { display: flex; gap: 14px; } .stat > div { flex: 1; border: 1px solid var(--line); border-radius: var(--radius); padding: 14px 16px; } .stat b { display: block; font-size: 22px; font-weight: 600; }
  .rows { margin-top: 16px; border: 1px solid var(--line); border-radius: var(--radius); } .rows div { display: flex; justify-content: space-between; padding: 10px 16px; border-top: 1px solid var(--line); } .rows div:first-child { border-top: 0; }
  .form { display: grid; gap: 14px; max-width: 420px; } .form label { display: grid; gap: 4px; color: var(--muted); } .form input, .form select { font: inherit; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; color: var(--ink); background: var(--bg); }
  #amenu { background: var(--bg); border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.14); padding: 4px; display: grid; min-width: 180px; }
  #amenu button { border: 0; background: none; text-align: left; padding: 7px 10px; border-radius: 6px; font: inherit; color: var(--ink); cursor: pointer; } #amenu button:hover { background: var(--soft); }
  </style></head><body>
  ${BAR}
  ${page(1, "Providers", "Providers", `<h1 id="title">Providers</h1><p class="lead">Choose which of your connected LLM providers this agent can use.</p>
    <div id="provider-list" data-populated>${providers}</div>
    <div id="empty-hint" data-empty-view data-design-note="An empty list says what to do next, never just “Nothing here”.">No providers yet. Connect one in Settings, then turn it on here.</div>`)}
  ${page(2, "Usage", "Usage", `<h1 id="usage-title" style="font-size:26px;font-weight:600;margin:4px 0 18px">Usage</h1>
    <div class="stat"><div id="usage-total" data-design-note="Today's spend first: it is what people check."><span class="muted">Today</span><b>$30.30</b></div><div><span class="muted">This week</span><b>$141.80</b></div></div>
    <div class="rows"><div><span>Anthropic</span><span>$26.30</span></div><div><span>Bob</span><span>$4.00</span></div></div>`)}
  ${page(3, "General", "General", `<h1 style="font-size:26px;font-weight:600;margin:4px 0 18px">General</h1>
    <div class="form"><label>Name<input value="Release notes"></label><label>Harness<select><option>claude-code</option></select></label><label>Model<select><option>claude-sonnet-5</option></select></label>
    <div><button id="general-save" class="btn btn-primary" data-clickable>Save</button></div></div>`)}
  <div id="amenu"><button data-goto-view="3">Agent settings</button><button data-goto-view="2">Usage</button><button>Pause the agent</button></div>
  <template data-desk-option="change-split"><span id="limit-change" style="display:inline-flex"><button class="btn btn-secondary" style="border-radius:8px 0 0 8px">Change</button><button class="btn btn-secondary" style="border-radius:0 8px 8px 0;border-left:0;padding-inline:8px">▾</button></span></template>
  </body></html>`;
}

const A = {};
const put = (id, html) => { A[id] = { id, contentType: "text/html", encoding: "utf8", data: html }; return id; };

// R-1: three options; Calm has states, versions, decisions and smart controls; Bold has
// alternatives and Design Desk changing it; Compact is quiet.
put("A-calm-3", design({ title: "Calm" }));
put("A-calm-2", design({ title: "Calm", radius: 4, change: "btn-primary" }));
put("A-calm-1", design({ title: "Calm", radius: 0, change: "btn-primary", limit: "numbers" }));
put("A-calm-hover", design({ title: "Calm", state: "hover" }));
put("A-calm-loading", design({ title: "Calm", state: "loading" }));
put("A-calm-failed", design({ title: "Calm", state: "failed" }));
put("A-calm-empty", design({ title: "Calm", state: "empty" }));
put("A-bold-1", design({ title: "Bold", accent: "#0f62fe", radius: 14, big: true, change: "btn-primary" }));
put("A-bold-alt-a", design({ title: "Bold", accent: "#0f62fe", radius: 14, big: true, change: "btn-primary", limit: "ring" }));
put("A-bold-alt-b", design({ title: "Bold", accent: "#0f62fe", radius: 14, big: true, change: "btn-primary", limit: "numbers" }));
put("A-bold-alt-c", design({ title: "Bold", accent: "#0f62fe", radius: 14, big: true, change: "btn-primary", limit: "steps" }));
put("A-compact-1", design({ title: "Compact", dense: true, radius: 4, change: "btn-ghost" }));
// R-2: one option, a request that waits for a new option being drawn.
put("A-r2-1", design({ title: "Plain", state: "empty" }));

const ALICE = { name: "Alice Novak", email: "alice@example.com" };
const PAT = { name: "Pat Lee", email: "pat@example.com" };
const DEV = { name: "Dana Kim", email: "dana@example.com" };
const AGENT = { agent: true };
const may = { reply: true, resolve: true };
const anchor = (variant, selector, label, extra = {}) => ({ variant, selector, label, text: label, tag: "button", ...extra });

const changeControls = [
  { id: "kind", label: "Kind", kind: "choice", current: "secondary", source: "src/ui/Button.tsx", options: [
    { id: "primary", label: "Primary", apply: { class: { add: "btn-primary", remove: "btn-secondary btn-ghost" } } },
    { id: "secondary", label: "Second", apply: { class: { add: "btn-secondary", remove: "btn-primary btn-ghost" } } },
    { id: "ghost", label: "Ghost", apply: { class: { add: "btn-ghost", remove: "btn-primary btn-secondary" } } },
    { id: "split", label: "Split", apply: { template: "change-split" } }] },
  { id: "size", label: "Size", kind: "scale", current: "md", source: "src/ui/Button.tsx", options: [
    { id: "sm", label: "Small", apply: { class: { add: "btn-sm", remove: "btn-lg" } } },
    { id: "md", label: "Medium", apply: { class: { add: "", remove: "btn-sm btn-lg" } } },
    { id: "lg", label: "Large", apply: { class: { add: "btn-lg", remove: "btn-sm" } } }] },
];

const r1 = {
  id: "R-1", kind: "request", title: "Make the daily limit easier to read", status: "variants", created: ago(60 * 26), updated: ago(3),
  by: ALICE, triage: { verdict: "design", reasons: ["Only the look of the Providers page changes."] }, team_feedback: { state: "waiting", since: ago(60 * 20) },
  request: { type: "adjustment", problem: "People miss that another counter stops the agent first: the daily limit card shows the bar, but “stops first” is small grey text at the bottom. Two owners asked support last week why their agent stopped at 40% of its limit; both had a workspace limit lower than the agent's own. The card should say plainly which limit is hit first, and how far that one is." },
  research: { summary: "Someone is already changing this card: PR #6467, which adds a second counter to the daily limit card, is still open, so its author can take the wording in before it ships.\n\n**Already asked for:** no issue is about which limit stops first. Issue #4311 asks for one place that lists every limit of an agent, and the Usage page already shows the workspace limit beside the agent's own.\n\n**Made of:** the card is the shared Limit card; the bar and its label come from the Progress element, so a change to the label shows on every page that uses it.", links: [{ url: "https://github.com/example/app/pull/6467", label: "PR #6467" }, { url: "https://github.com/example/app/issues/4311", label: "Issue #4311" }] },
  cited: { "D-12": { text: "One primary button per screen", status: "active" }, "D-7": { text: "Limits show money, not tokens", status: "revoked" } },
  variants: [
    { id: "v1", name: "Calm", asset: "A-calm-3", version: 3, drawn: ago(60 * 5), fidelity: "mockup",
      history: [{ version: 2, asset: "A-calm-2", at: ago(60 * 12) }, { version: 1, asset: "A-calm-1", at: ago(60 * 24) }],
      states: [
        { id: "hover", name: "Hovered", part: "Change button", how: "The pointer is on Change.", asset: "A-calm-hover", selector: "#limit-change", version: 1, of: 3, element: "change" },
        { id: "loading", name: "Saving", part: "Change button", how: "The new limit is being saved.", asset: "A-calm-loading", selector: "#limit-change", version: 1, of: 3, element: "change" },
        { id: "failed", name: "Failed", part: "Change button", how: "The new limit was not saved.", asset: "A-calm-failed", selector: "#limit-change", version: 2, of: 3, element: "change" },
        { id: "empty", name: "No providers", part: "Provider list", how: "A new agent with no provider turned on.", asset: "A-calm-empty", selector: "#provider-list", version: 1, of: 2 }],
      elements: [{ id: "change", name: "Change button", change: "changed", selector: "#limit-change", how: "Secondary, so the card has no loud button.", controls: changeControls },
        { id: "bar", name: "Limit bar", change: "same", selector: "#limit-bar", how: "" }],
      reasons: [{ decision: "D-12", how: "Save is the only primary button; Change stays secondary.", parts: [{ selector: "#limit-change", label: "Change button" }, { selector: "#general-save", label: "Save button", view: "3", view_name: "General" }] },
        { decision: "D-7", how: "The limit is in dollars.", parts: [{ selector: "#limit-text", label: "Limit amount" }] }] },
    { id: "v2", name: "Bold", asset: "A-bold-1", version: 1, drawn: ago(60 * 20), fidelity: "mockup",
      alternatives: [
        { id: "alt-a", part: "Daily limit", name: "Ring", how: "A ring with the percent in it, beside the amount.", ask: "Can the limit be read at a glance?", asset: "A-bold-alt-a", of: 1 },
        { id: "alt-b", part: "Daily limit", name: "Numbers only", how: "A big amount, the percent in words; no bar.", ask: "Can the limit be read at a glance?", asset: "A-bold-alt-b", of: 1 },
        { id: "alt-c", part: "Daily limit", name: "Bar in steps", how: "The bar in five steps of a dollar each.", ask: "Can the limit be read at a glance?", asset: "A-bold-alt-c", of: 1 }] },
    { id: "v3", name: "Compact", asset: "A-compact-1", version: 1, drawn: ago(60 * 20), fidelity: "wireframe" },
  ],
  threads: [
    { id: "T-1", kind: "comment", state: "open", may, anchor: anchor("v1", "#limit-change", "Button “Change”"), messages: [
      { by: PAT, at: ago(300), text: "Should Change be primary? It is the one thing to do on this card." },
      { by: ALICE, at: ago(280), text: "I would keep it quiet. Most people only read the card." },
      { by: AGENT, at: ago(270), text: "It follows D-12: one primary button per screen. Change stays secondary; a ghost button is possible, say so and I draw it." }] },
    { id: "T-2", kind: "question", state: "open", may, anchor: anchor("v1", "#limit-bar", "Bar “Daily limit”", { tag: "div" }), messages: [
      { by: DEV, at: ago(200), text: "Does the bar fill to the limit set here, or to the counter that stops first?" },
      { by: AGENT, at: ago(190), text: "To the limit set here, as the product does today (src/providers/Limit.tsx). The counter that stops first shows under it." }] },
    { id: "T-3", kind: "comment", state: "resolved", may, anchor: anchor("v1", "#title", "Heading “Providers”", { tag: "h1" }), messages: [
      { by: PAT, at: ago(900), text: "Title a bit smaller?" }, { by: AGENT, at: ago(880), text: "Done in version 2: 26 px." }] },
    { id: "T-4", kind: "comment", state: "open", may, anchor: { variant: "v1", label: "the whole option" }, messages: [
      { by: ALICE, at: ago(100), text: "Overall this is the direction I like most." }] },
    { id: "T-5", kind: "comment", state: "open", may, anchor: anchor("v1", "#limit-error", "Text “The limit was not saved…”", { state: "failed", tag: "div" }), messages: [
      { by: PAT, at: ago(80), text: "Can the error keep the amount I typed?" }] },
    { id: "T-6", kind: "comment", state: "open", may, anchor: anchor("v1", "#general-save", "Button “Save”", { view: "3", view_name: "General" }), messages: [
      { by: DEV, at: ago(60), text: "General saves on change in the product; is this button needed?" }] },
  ],
  waiting: [{ kind: "revise", state: "claimed", created: ago(4), started: ago(3), usual_min: 12, variant: "v2" }],
  prototype: { state: "none" },
};

const r2 = {
  id: "R-2", kind: "request", title: "Empty provider list for new agents", status: "variants", created: ago(60 * 6), updated: ago(1),
  by: PAT, triage: { verdict: "design", reasons: ["A new state of one screen."] }, team_feedback: { state: "waiting", since: ago(60 * 2) },
  request: { type: "idea", problem: "A new agent shows an empty Providers page and people think it is broken." },
  variants: [{ id: "w1", name: "Plain", asset: "A-r2-1", version: 1, drawn: ago(60 * 3), fidelity: "mockup" }],
  threads: [], waiting: [{ kind: "explore", state: "claimed", created: ago(2), started: ago(2), usual_min: 9 }], prototype: { state: "none" },
};

// R-3: a design drawn without the review bar: no pages, no switches.
put("A-r3-1", '<body><h1>List</h1><button id="kit">Kit</button></body>');
const r3 = {
  id: "R-3", kind: "request", title: "A bare design", status: "feedback", created: ago(60 * 30), updated: ago(30),
  by: PAT, triage: { verdict: "design", reasons: [] }, request: { type: "idea", problem: "A design with no review bar." },
  variants: [{ id: "q1", name: "Quiet", asset: "A-r3-1", version: 1 }],
  threads: [{ id: "T-30", kind: "comment", state: "open", may, anchor: { variant: "q1", selector: "#kit", text: "Kit", label: "Text" }, messages: [{ by: PAT, at: ago(40), text: "Too bright here." }] }],
  waiting: [], prototype: { state: "none" },
  // Alice's 👎 came from Slack under her other address: it is hers, one vote (store.mjs → vote).
  votes: { q1: { "alice@slack.example.com": { vote: "dislike", role: "developer", via: "slack", name: "Alice Novak", at: ago(50) }, [PAT.email]: { vote: "prefer", role: "designer", at: ago(45) } } },
};

// The bell: notes on comments in the design workspace, each opening its comment in place.
const note = (id, min, event, thread, msg, by, detail, extra = {}) => ({ id, at: ago(min), event, item: "R-1", kind: "request", title: r1.title, status: r1.status,
  by, detail, thread, msg, for_you: true, count: 1, people: by.email ? [{ email: by.email }] : [], marks: [[thread, msg]], ...extra });
export const NOTES = [
  note("n1", 2, "comment", "T-6", 0, DEV, "General saves on change in the product; is this button needed?"),
  note("n2", 5, "answer", "T-2", 1, AGENT, "To the limit set here, as the product does today."),
  note("n3", 9, "reply", "T-1", 2, AGENT, "It follows D-12: one primary button per screen.", { count: 2, marks: [["T-1", 2], ["T-1", 1]] }),
  note("n4", 30, "comment", "T-5", 0, PAT, "Can the error keep the amount I typed?", { for_you: false }),
  note("n5", 60, "resolved", "T-3", 1, AGENT, "Done in version 2: 26 px.", { for_you: false }),
];

export const CARDS = [r1, r2, r3];
export const ASSETS = A;
