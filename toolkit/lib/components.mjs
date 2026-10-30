// <ui-component>: render a real component from the repo to static HTML, so a prototype
// carries the repo's own logo, avatars, badges — or, for CSS-in-JS repos, its whole
// look. esbuild bundles the component (tsconfig path aliases included); React renders
// it. A dependency the component imports is installed at the repo's locked version on
// the first build that needs it, and kept for the next.
import { existsSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { createRequire } from "node:module";
import { TOOLKIT, SCRATCH, ensureDir, fail, warn, attrs, tagRe, slugOf } from "./core.mjs";

// Packages whose only job at import time is to throw when the app's secrets are missing.
// A prototype never has them, so they render through a stub (chrome/stubs/env.js).
const ENV_STUBS = ["@t3-oss/env-nextjs", "@t3-oss/env-core", "@t3-oss/env-nuxt", "envalid"];
import { toolchain } from "./toolchain.mjs";
import { lockedVersions, workspacePackages } from "./profile.mjs";

const parseProps = (s) => { if (!s) return {}; try { return JSON.parse(s); } catch (e) { fail(`props='${s}' is not JSON: ${e.message}`); } };

export async function renderComponents(html, style) {
  const tags = [...html.matchAll(tagRe("ui-component"))];
  if (!tags.length) return html;
  if (style.kind !== "repo") fail("<ui-component> renders components from a repo — it needs --style repo:<owner/name>");
  const { dir: root, uiDir, profile } = style;
  const reactV = profile.versions?.react || "18.3.1", domV = profile.versions?.["react-dom"] || reactV;
  let tc = toolchain(`comp-${slugOf(style.repo)}`, { react: reactV, "react-dom": domV, esbuild: "0.28.2" });

  // One entry exporting every requested component, bundled once.
  const reqs = tags.map((m, i) => ({ i, raw: m[0], a: attrs(m[1]) }));
  const entry = join(ensureDir(join(SCRATCH, "build")), "components-entry.jsx");
  writeFileSync(entry, reqs.map(({ i, a }) => {
    if (!a.src) fail(`<ui-component> needs src="path/in/repo.tsx": ${reqs[i].raw.slice(0, 80)}`);
    const file = resolve(root, a.src);
    if (!existsSync(file)) fail(`<ui-component src="${a.src}">: no such file in the clone (it moved?)`);
    return `export { ${a.export || "default"} as C${i} } from ${JSON.stringify(file)};`;
  }).join("\n"));

  const tsconfig = ["tsconfig.app.json", "tsconfig.json"].map((f) => join(uiDir, f)).find(existsSync);
  // Monorepo siblings resolve from the clone itself, never from npm.
  const workspace = workspacePackages(root);
  const stubs = Object.fromEntries(ENV_STUBS.map((n) => [n, join(TOOLKIT, "chrome/stubs/env.js")]));
  let code = "", installed = new Set();
  for (let round = 0; round < 6; round++) {
    const esbuild = tc.req("esbuild");
    try {
      const r = await esbuild.build({
        entryPoints: [entry], bundle: true, write: false, format: "cjs", platform: "node", jsx: "automatic",
        external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server"], logLevel: "silent",
        absWorkingDir: uiDir, nodePaths: [tc.nm], ...(tsconfig ? { tsconfig } : {}), alias: { ...workspace, ...stubs },
        loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl", ".css": "empty", ".scss": "empty" },
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
      });
      code = r.outputFiles[0].text; break;
    } catch (e) {
      const missing = [...new Set((e.errors || []).map((x) => x.text.match(/Could not resolve "([^"]+)"/)?.[1]).filter(Boolean)
        .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0])))].filter((n) => !installed.has(n) && !n.startsWith(".") && !workspace[n] && !stubs[n]);
      if (!missing.length) fail(`could not bundle the components: ${(e.errors || []).map((x) => x.text).join("; ") || e.message}`);
      const locked = lockedVersions(root, uiDir, missing);
      const specs = Object.fromEntries(missing.map((n) => [n, locked[n] || "latest"]));
      missing.forEach((n) => installed.add(n));
      tc = toolchain(`comp-${slugOf(style.repo)}`, specs);
    }
  }
  if (!code) fail("could not bundle the components after installing their dependencies");

  const creq = createRequire(join(tc.dir, "package.json"));
  const mod = { exports: {} };
  try { new Function("module", "exports", "require", code)(mod, mod.exports, creq); }
  catch (e) { fail(`a component failed to load (it reads browser globals, env vars or app state at import time?): ${e.message} — render a smaller part that doesn't import it, or copy its markup`); }
  const { createElement: h } = creq("react");
  const { renderToStaticMarkup } = creq("react-dom/server");
  for (const { i, raw, a } of reqs) {
    const C = mod.exports[`C${i}`];
    if (!C) fail(`${a.src} has no export "${a.export || "default"}"`);
    const props = { ...parseProps(a.props), ...(a.class ? { className: a.class } : {}) };
    let out = "";
    try { out = renderToStaticMarkup(h(C, props)); }
    catch (e) { fail(`<ui-component src="${a.src}" export="${a.export || "default"}"> threw while rendering: ${e.message} — it may need a provider or a hook's data; render a smaller part, or copy its markup by hand`); }
    html = html.replace(raw, out);
  }
  return html;
}
