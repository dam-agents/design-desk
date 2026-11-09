// The child that loads a repository's bundled components and renders them to static
// markup for components.mjs, so repository code never runs in the agent's own process.
// It starts with PATH alone in its environment, and its cwd and HOME a fresh private folder
// (core.mjs → isolatedEnv, which says what this does not cover).
// stdin: {bundle, react: <dir that resolves react>, out, wrappers: [{props}], tags: [{i, props, mocks}]}
// It writes to `out` (stdout is the components' to scribble on):
//   {ok: [{i, out}]} | {error: {stage: "load" | "export" | "render", i, message, stack}}
const { createRequire } = require("node:module");
const { join } = require("node:path");
const { readFileSync, writeFileSync } = require("node:fs");

const input = JSON.parse(readFileSync(0, "utf8"));
const done = (o) => { writeFileSync(input.out, JSON.stringify(o)); process.exit(0); };
const msg = (e) => String((e && e.message) || e);
const creq = createRequire(join(input.react, "package.json"));
const mod = { exports: {} };
try { new Function("module", "exports", "require", readFileSync(input.bundle, "utf8"))(mod, mod.exports, creq); }
catch (e) { done({ error: { stage: "load", message: msg(e) } }); }
const { createElement: h } = creq("react");
const { renderToStaticMarkup } = creq("react-dom/server");
const ok = [];
for (const t of input.tags) {
  const C = mod.exports[`C${t.i}`];
  if (!C) done({ error: { stage: "export", i: t.i } });
  globalThis.__deskMocks = t.mocks || {};
  const tree = input.wrappers.reduceRight((child, w, k) => h(mod.exports[`W${k}`], w.props || null, child), h(C, t.props));
  try { ok.push({ i: t.i, out: renderToStaticMarkup(tree) }); }
  catch (e) { done({ error: { stage: "render", i: t.i, message: msg(e), stack: e && e.stack } }); }
  globalThis.__deskMocks = {};
}
done({ ok });
