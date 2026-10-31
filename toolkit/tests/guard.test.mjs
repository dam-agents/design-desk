// node --test toolkit/tests — the design-only guard's verdicts on small diffs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { compare, classifyPath, judge } from "../lib/guard.mjs";

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
