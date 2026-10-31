// design plugins [<[host/]owner/name>]
// The plug-ins the agent can use, as JSON (docs/plugins.md): the bundled ones in this
// definition's plugins/, and for a repository the ones its design profile lists.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { TOOLKIT, fail, run } from "../lib/core.mjs";

// The SKILL.md front matter: `key: value` lines, a `[a, b]` list, a folded `>-` value.
export function frontMatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  const out = {};
  let key = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      const v = kv[2].trim();
      out[key] = v.startsWith("[") ? v.slice(1, -1).split(",").map((s) => s.trim()).filter(Boolean) : v === ">-" || v === ">" ? "" : v;
    } else if (key && /^\s+\S/.test(line)) out[key] = `${out[key]} ${line.trim()}`.trim();
  }
  return out;
}

function read(dir, source) {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) return null;
  const fm = frontMatter(readFileSync(file, "utf8"));
  if (!fm?.name || !fm.kind) fail(`${file}: a plug-in needs name and kind in its front matter`);
  return { name: fm.name, kind: fm.kind, description: fm.description || "", config: fm.config || [], source, path: file };
}

export async function main(_cmd, [repo]) {
  const bundled = join(TOOLKIT, "..", "plugins");
  const list = existsSync(bundled)
    ? readdirSync(bundled).sort().map((d) => read(join(bundled, d), "bundled")).filter(Boolean)
    : [];
  if (repo) {
    const r = run(process.execPath, [join(TOOLKIT, "bin/design.mjs"), "profile", repo]);
    let p; try { p = JSON.parse(r.stdout); } catch { fail(`could not read the profile of ${repo}: ${r.stderr.trim()}`); }
    for (const rel of p.plugins || []) {
      const pl = p.dir && read(join(p.dir, rel), `product:${repo}`);
      if (pl) list.push(pl);
    }
  }
  console.log(JSON.stringify(list, null, 1));
}
