// Per-repo toolchains: the exact package versions a repo's UI builds with, installed
// once into a persistent directory keyed by those versions, and reused across runs.
// A missing bare import (a Tailwind plugin, a component's dependency) is installed at
// the version the repo's lockfile names, never at "latest".
import { existsSync, readFileSync, writeFileSync, symlinkSync, rmSync, lstatSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { DATA, ensureDir, fail, run } from "./core.mjs";

export function toolchain(key, specs) {
  // specs: {name: version}. One directory per distinct set; adding a package reinstalls.
  const dir = ensureDir(join(DATA, "toolchains", key.replace(/[^A-Za-z0-9._-]+/g, "_")));
  const stampFile = join(dir, ".specs.json");
  const have = existsSync(stampFile) ? JSON.parse(readFileSync(stampFile, "utf8")) : {};
  const want = { ...have, ...specs };
  const missing = Object.entries(want).filter(([n, v]) => have[n] !== v || !existsSync(join(dir, "node_modules", n, "package.json")));
  if (missing.length) {
    if (!existsSync(join(dir, "package.json"))) writeFileSync(join(dir, "package.json"), '{"name":"design-desk-toolchain","private":true}\n');
    const list = Object.entries(want).map(([n, v]) => `${n}@${v}`);
    // Peer dependencies are installed (old icon packages need prop-types); only a peer
    // conflict between the repo's own pins falls back to --legacy-peer-deps.
    const base = ["i", "-q", "--no-audit", "--no-fund", "--no-save", "--ignore-scripts"];
    let r = run("npm", [...base, ...list], { cwd: dir });
    if (r.status !== 0 && /ERESOLVE|peer dep/i.test(r.stderr || "")) r = run("npm", [...base, "--legacy-peer-deps", ...list], { cwd: dir });
    if (r.status !== 0) fail(`npm could not install ${list.join(" ")}: ${(r.stderr || "").trim().split("\n").slice(-3).join(" | ")} — is registry.npmjs.org reachable?`);
    writeFileSync(stampFile, JSON.stringify(want, null, 2));
  }
  return { dir, nm: join(dir, "node_modules"), req: createRequire(join(dir, "package.json")), bin: (b) => join(dir, "node_modules/.bin", b) };
}

// Make `node_modules` resolvable from a directory inside a scratch clone, so the repo's
// CSS `@import "pkg"` and plugin requires find the toolchain's packages.
export function linkModules(nm, intoDir) {
  const target = join(intoDir, "node_modules");
  try { if (lstatSync(target)) rmSync(target, { recursive: true, force: true }); } catch {}
  symlinkSync(nm, target, "dir");
}

// Bare package names a CSS file or a JS config pulls in.
export function bareImports(text) {
  const names = new Set();
  const add = (s) => {
    if (!s || s.startsWith(".") || s.startsWith("/") || s.startsWith("~/") || /^(https?:|data:|node:)/.test(s)) return;
    const s2 = s.replace(/^~/, "");
    const parts = s2.split("/");
    names.add(s2.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  };
  for (const m of text.matchAll(/@(?:import|plugin|reference)\s+(?:url\()?["']([^"']+)["']/g)) add(m[1]);
  for (const m of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+(?:[^"';]+from\s+)?["']([^"']+)["']/g)) add(m[1]);
  return [...names].filter((n) => n !== "tailwindcss");
}
