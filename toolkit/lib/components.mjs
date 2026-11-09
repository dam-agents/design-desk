// <ui-component>: render a real component from the repo to static HTML, so a prototype
// carries the repo's own logo, avatars, badges — or, for CSS-in-JS repos, its whole
// look. esbuild bundles the component (tsconfig path aliases included); React renders
// it in a child process. A dependency the component imports is installed at the repo's
// locked version on the first build that needs it, and kept for the next.
import { existsSync, writeFileSync, readFileSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { TOOLKIT, scratch, privateTmp, isolatedEnv, run, fail, attrs, tagRe, slugOf } from "./core.mjs";

// Packages whose only job at import time is to throw when the app's secrets are missing.
// A prototype never has them, so they render through a stub (chrome/stubs/env.js).
const ENV_STUBS = ["@t3-oss/env-nextjs", "@t3-oss/env-core", "@t3-oss/env-nuxt", "envalid"];
import { toolchain } from "./toolchain.mjs";
import { lockedVersions, workspacePackages } from "./profile.mjs";
import { mockPlugin } from "./mocks.mjs";

// Records the stylesheets the components import (they do not run here), so the build can
// append them to the page's CSS.
function cssCollector(files) {
  return {
    name: "desk-css",
    setup(build) {
      build.onResolve({ filter: /\.css$/ }, async (args) => {
        if (args.pluginData?.deskInner) return null;
        const r = await build.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { deskInner: true } });
        if (r.errors.length || !r.path) return null;
        files.add(r.path);
        return { path: r.path, namespace: "desk-css" };
      });
      build.onLoad({ filter: /.*/, namespace: "desk-css" }, () => ({ contents: "", loader: "js" }));
    },
  };
}

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
  const entry = join(scratch("build"), "components-entry.jsx");
  // Providers the app wraps every screen in (a tooltip provider, a theme), from the
  // profile's `render_wrappers`: each component renders inside them, outermost first.
  const wrappers = (profile.render_wrappers || []).map((w, i) => {
    const file = resolve(root, w.src);
    if (!existsSync(file)) fail(`render_wrappers[${i}]: no ${w.src} in the clone`);
    return `export { ${w.export || "default"} as W${i} } from ${JSON.stringify(file)};`;
  });
  writeFileSync(entry, [...wrappers, ...reqs.map(({ i, a }) => {
    if (!a.src) fail(`<ui-component> needs src="path/in/repo.tsx": ${reqs[i].raw.slice(0, 80)}`);
    const file = resolve(root, a.src);
    if (!existsSync(file)) fail(`<ui-component src="${a.src}">: no such file in the clone (it moved?)`);
    return `export { ${a.export || "default"} as C${i} } from ${JSON.stringify(file)};`;
  })].join("\n"));

  const tsconfig = ["tsconfig.app.json", "tsconfig.json"].map((f) => join(uiDir, f)).find(existsSync);
  // Monorepo siblings resolve from the clone itself, never from npm.
  const workspace = workspacePackages(root);
  // Monorepo packages resolve as installed packages (a node_modules of symlinks), so
  // their package.json `exports` map is honoured: `pkg/avatar/svg` finds its file.
  const wsNm = join(scratch("build"), "ws-node_modules");
  rmSync(wsNm, { recursive: true, force: true });
  for (const [name, dir] of Object.entries(workspace)) {
    const link = join(wsNm, name);
    mkdirSync(join(link, ".."), { recursive: true });
    try { symlinkSync(dir, link, "dir"); } catch {}
  }
  const stubs = Object.fromEntries(ENV_STUBS.map((n) => [n, join(TOOLKIT, "chrome/stubs/env.js")]));
  let code = "", installed = new Set();
  const cssFiles = new Set();
  for (let round = 0; round < 6; round++) {
    const esbuild = tc.req("esbuild");
    try {
      const r = await esbuild.build({
        entryPoints: [entry], bundle: true, write: false, metafile: true, format: "cjs", platform: "node", jsx: "automatic",
        external: ["react", "react-dom", "react/jsx-runtime", "react-dom/server"], logLevel: "silent",
        absWorkingDir: uiDir, nodePaths: [wsNm, tc.nm], ...(tsconfig ? { tsconfig } : {}), alias: { ...stubs },
        loader: { ".svg": "dataurl", ".png": "dataurl", ".jpg": "dataurl", ".webp": "dataurl", ".css": "empty", ".scss": "empty" },
        // Data access, app hooks and stores render from each tag's `mocks` (docs/catalog.md).
        plugins: [mockPlugin(root, profile.mock_modules), cssCollector(cssFiles)],
        define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
      });
      code = r.outputFiles[0].text;
      // A component's own stylesheet (an avatar's moods, say) is part of its look: the
      // build appends it to the page's CSS.
      style.componentCss = [...cssFiles].filter((f) => !f.includes("/node_modules/"))
        .map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
      break;
    } catch (e) {
      if (process.env.DESK_DEBUG) console.error((e.errors || []).map((x) => `${x.text} @ ${x.location?.file}`).join("\n"));
      const missing = [...new Set((e.errors || []).map((x) => x.text.match(/Could not resolve "([^"]+)"/)?.[1]).filter(Boolean)
        .map((s) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0])))].filter((n) => n && !installed.has(n) && !n.startsWith(".") && !n.startsWith("/") && !n.startsWith("@/") && n !== "@" && !workspace[n] && !stubs[n]);
      if (!missing.length) fail(`could not bundle the components: ${(e.errors || []).map((x) => x.text).join("; ") || e.message}`);
      const locked = lockedVersions(root, uiDir, missing);
      // Never "latest": a public package of that name need not be the one the repo means.
      const unlocked = missing.filter((n) => !locked[n]);
      if (unlocked.length) fail(`the components import ${unlocked.join(", ")}, which the repo's lockfile names no version of — it is never installed from npm at "latest" (a public package of that name may not be the repo's); render a part that doesn't import it, or copy its markup`);
      const specs = Object.fromEntries(missing.map((n) => [n, locked[n]]));
      missing.forEach((n) => installed.add(n));
      tc = toolchain(`comp-${slugOf(style.repo)}`, specs);
    }
  }
  if (!code) fail("could not bundle the components after installing their dependencies");

  // The bundle is the repository's code: it loads and renders in a child node
  // (component-child.cjs) with an env of PATH alone, never in this process.
  const box = privateTmp("components");
  const input = {
    bundle: join(box, "bundle.cjs"), react: tc.dir, out: join(box, "out.json"),
    wrappers: (profile.render_wrappers || []).map((w) => ({ props: w.props || null })),
    tags: reqs.map(({ i, a }) => ({ i, props: { ...parseProps(a.props), ...(a.class ? { className: a.class } : {}) }, mocks: parseProps(a.mocks) })),
  };
  writeFileSync(input.bundle, code);
  const r = run(process.execPath, [join(TOOLKIT, "lib/component-child.cjs")], { cwd: box, env: isolatedEnv(box), input: JSON.stringify(input), timeout: 180000, maxBuffer: 64 << 20 });
  if (process.env.DESK_DEBUG) console.error(`${r.stdout || ""}${r.stderr || ""}`);
  let res = null;
  try { res = JSON.parse(readFileSync(input.out, "utf8")); } catch {}
  rmSync(box, { recursive: true, force: true });
  if (!res) fail(`the components did not render (node ${r.signal ? `stopped by ${r.signal}` : `exited ${r.status}`}): ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")}`);
  if (res.error) {
    const e = res.error, a = reqs.find((q) => q.i === e.i)?.a || {};
    if (process.env.DESK_DEBUG && e.stack) console.error(e.stack);
    if (e.stage === "load") fail(`a component failed to load (it reads browser globals, env vars or app state at import time?): ${e.message} — render a smaller part that doesn't import it, or copy its markup`);
    if (e.stage === "export") fail(`${a.src} has no export "${a.export || "default"}"`);
    fail(`<ui-component src="${a.src}" export="${a.export || "default"}"> threw while rendering: ${e.message} — it may need a provider or a hook's data; render a smaller part, or copy its markup by hand`);
  }
  const outs = Object.fromEntries(res.ok.map((o) => [o.i, o.out]));
  for (const { i, raw } of reqs) {
    let out = outs[i] || "";
    // React escapes & and ' in attributes; Tailwind reads class lists as raw text
    // (`[&_svg]:size-4`, `content-['·']`), so a rendered class list gets them back.
    out = out.replace(/class="([^"]*)"/g, (_, c) => `class="${c.replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&gt;/g, ">").replace(/&lt;/g, "<")}"`);
    html = html.replace(raw, () => out);
  }
  return html;
}
