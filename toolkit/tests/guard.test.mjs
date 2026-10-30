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
