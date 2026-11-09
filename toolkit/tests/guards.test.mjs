// node --test toolkit/tests/guards.test.mjs — each guard against repository code, through the
// path a build takes, with one input it accepts and one it refuses: a removed guard fails here.
// Builds run in a child node (a refusal exits) with a token planted in its env, npm and git
// stand-ins first on PATH (they record each call; npm always fails, so nothing is fetched),
// and toolchains seeded from the toolkit's own packages.
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { TOOLKIT, launchWith, slugOf } from "../lib/core.mjs";

const TOKEN = "ghp_planted00000000000000000000000000000";
const T = mkdtempSync(join(tmpdir(), "dd-guards-"));
after(() => rmSync(T, { recursive: true, force: true }));   // no leftover in the temp folder
const DATA = join(T, "data"), BIN = join(T, "bin"), CALLS = join(T, "calls.log");
mkdirSync(BIN, { recursive: true });
const stand = (name, body) => { writeFileSync(join(BIN, name), `#!/bin/sh\necho "${name} $*" >> "${CALLS}"\n${body}\n`); chmodSync(join(BIN, name), 0o755); };
stand("npm", "exit 1");
// git: a clone of a branch fails (as a commit sha does), a plain clone makes its folder.
stand("git", `case "$*" in *--branch*) exit 1;; clone*) for a; do d="$a"; done; mkdir -p "$d";; *rev-parse*) echo abc1234;; esac\nexit 0`);
const calls = () => (existsSync(CALLS) ? readFileSync(CALLS, "utf8") : "");
const lib = (f) => JSON.stringify(pathToFileURL(join(TOOLKIT, "lib", f)).href);

function child(code) {
  writeFileSync(CALLS, "");
  return spawnSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, GH_TOKEN: TOKEN, DESIGN_DESK_DATA: DATA, DESIGN_DESK_SCRATCH: join(T, "scratch"), WORK_DIR: join(T, "work"), PATH: `${BIN}:${process.env.PATH}` },
  });
}
const version = (n) => JSON.parse(readFileSync(join(TOOLKIT, "node_modules", n, "package.json"), "utf8")).version;
// A toolchain as toolchain() finds it installed: its stamp, and a node_modules of links to
// the toolkit's packages (a link per package, so no install can reach the toolkit's own).
function seed(key, names) {
  const nm = join(DATA, "toolchains", key.replace(/[^A-Za-z0-9._-]+/g, "_"), "node_modules");
  mkdirSync(join(nm, ".bin"), { recursive: true });
  for (const n of names) {
    mkdirSync(join(nm, n, ".."), { recursive: true });
    if (!existsSync(join(nm, n))) symlinkSync(join(TOOLKIT, "node_modules", n), join(nm, n), "dir");
  }
  if (names.includes("tailwindcss") && !existsSync(join(nm, ".bin/tailwindcss"))) symlinkSync(join(TOOLKIT, "node_modules/.bin/tailwindcss"), join(nm, ".bin/tailwindcss"));
  writeFileSync(join(nm, "..", ".specs.json"), JSON.stringify(Object.fromEntries(names.map((n) => [n, version(n)]))));
}
// A repository: its files, and a package-lock.json when `locked` names versions.
function repo(name, files, locked) {
  const root = join(T, "repos", name);
  for (const [f, text] of Object.entries({ "package.json": `{"name":"${name}"}`, ...files })) {
    mkdirSync(join(root, f, ".."), { recursive: true }); writeFileSync(join(root, f), text);
  }
  if (locked) writeFileSync(join(root, "package-lock.json"), JSON.stringify({ packages: Object.fromEntries(Object.entries(locked).map(([n, v]) => [`node_modules/${n}`, { version: v }])) }));
  return root;
}

// <ui-component>: the real render path.
const components = (name, src, locked) => {
  const root = repo(name, { "src/C.jsx": src }, locked);
  seed(`comp-${slugOf(`acme/${name}`)}`, ["react", "react-dom", "esbuild"]);
  const style = { kind: "repo", repo: `acme/${name}`, dir: root, uiDir: root, profile: { versions: { react: version("react"), "react-dom": version("react-dom") } } };
  return child(`const { renderComponents } = await import(${lib("components.mjs")});
process.stdout.write(await renderComponents('<ui-component src="src/C.jsx"></ui-component>', ${JSON.stringify(style)}));`);
};

test("a component renders in a child that never sees the agent's env (components.mjs passes isolatedEnv)", () => {
  const r = components("comp-env", 'export default function C() { return <p>{`${process.env.GH_TOKEN}|${Object.keys(process.env).sort().join(",")}`}</p>; }');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /<p>undefined\|HOME,LANG,PATH,TMPDIR<\/p>/);
  assert.ok(!r.stdout.includes(TOKEN));
});

const leftPad = 'import pad from "left-pad-desk-test"; export default function C() { return <p>{String(pad)}</p>; }';
test("a component's import the lockfile names no version of is refused, never installed at latest", () => {
  const r = components("comp-unlocked", leftPad);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /left-pad-desk-test, which the repo's lockfile names no version of/);
  assert.doesNotMatch(calls(), /^npm /m);
});
test("a component's import the lockfile pins is installed at that version", () => {
  const r = components("comp-locked", leftPad, { "left-pad-desk-test": "1.0.0" });
  assert.equal(r.status, 1); // the npm stand-in fails
  assert.match(calls(), /^npm .*left-pad-desk-test@1\.0\.0/m);
  assert.doesNotMatch(calls(), /@latest/);
});

// Tailwind: the real compile path, v4.
const tailwind = (name, css, files = {}, locked) => {
  const root = repo(name, { "app.css": css, ...files }, locked);
  const v = version("tailwindcss");
  seed(`tw-${slugOf(`acme/${name}`)}`, ["tailwindcss", "@tailwindcss/cli"]);
  const style = { kind: "repo", repo: `acme/${name}`, dir: root, uiDir: root, profile: { styling: "tailwind", css_entry: "app.css", tailwind_major: 4, versions: { tailwindcss: v } } };
  return child(`const { compileCss } = await import(${lib("style.mjs")});
compileCss(${JSON.stringify(style)}, "<p class='p-4'>x</p>");`);
};

test("Tailwind and the repo's plugins run in a child that never sees the agent's env (style.mjs passes isolatedEnv)", () => {
  const seen = join(T, "tw-env.json");
  const r = tailwind("tw-env", '@import "tailwindcss";\n@plugin "./plugin.cjs";\n', {
    "plugin.cjs": `require("fs").writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ token: process.env.GH_TOKEN || null, keys: Object.keys(process.env).sort() }));\nmodule.exports = function () {};\n`,
  });
  assert.ok(existsSync(seen), `the plugin did not run: ${r.stderr}`);
  const env = JSON.parse(readFileSync(seen, "utf8"));
  assert.equal(env.token, null);
  assert.ok(!env.keys.some((k) => /TOKEN|DESIGN_DESK|WORK_DIR/.test(k)), env.keys.join(","));
});

test("a CSS import the lockfile names no version of is refused, never installed at latest", () => {
  const r = tailwind("tw-unlocked", '@import "tailwindcss";\n@import "ui-kit-desk-test/theme.css";\n');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ui-kit-desk-test, which its lockfile names no version of/);
  assert.doesNotMatch(calls(), /^npm /m);
});
test("a CSS import the lockfile pins is installed at that version", () => {
  const r = tailwind("tw-locked", '@import "tailwindcss";\n@import "ui-kit-desk-test/theme.css";\n', {}, { "ui-kit-desk-test": "2.0.0" });
  assert.equal(r.status, 1); // the npm stand-in fails
  assert.match(calls(), /^npm .*ui-kit-desk-test@2\.0\.0/m);
  assert.doesNotMatch(calls(), /@latest/);
});

test("a font family becomes a Fontsource package only as a plain name, installed with no script", () => {
  const r = child(`const { installFontsource } = await import(${lib("style.mjs")});
process.stdout.write(JSON.stringify([installFontsource("../../evil"), installFontsource("x --registry=http://e"), installFontsource("Inter Tight")]));`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), [null, null, null]);
  const npm = calls().split("\n").filter((l) => l.startsWith("npm "));
  assert.equal(npm.length, 1, `only the plain name reaches npm: ${npm.join(" | ")}`);
  assert.match(npm[0], /@fontsource\/inter-tight/);
  assert.match(npm[0], /--ignore-scripts/);
});

test("a clone ref git would read as an option is refused before git runs; a commit is checked out as one", () => {
  const clone = (ref) => child(`const { cloneRepo } = await import(${lib("profile.mjs")});
process.stdout.write(JSON.stringify(cloneRepo("acme/widgets", ${JSON.stringify(ref)})));`);
  let r = clone("--upload-pack=touch /tmp/x");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is not a branch, tag or commit/);
  assert.doesNotMatch(calls(), /^git /m);
  r = clone("deadbeef");
  assert.equal(r.status, 0, r.stderr);
  assert.match(calls(), /^git -C \S+ checkout -q deadbeef --$/m);
});

test("Chromium starts with its own sandbox first and without file access between pages", async () => {
  const seen = [];
  assert.equal(await launchWith({ launch: async (o) => { seen.push(o); return "browser"; } }, "/x/chrome"), "browser");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].chromiumSandbox, true);
  assert.ok(!seen[0].args.some((a) => /no-sandbox|allow-file-access/.test(a)), seen[0].args.join(" "));
  const tries = [];
  const pw = { launch: async (o) => { tries.push(o.chromiumSandbox); if (o.chromiumSandbox) throw new Error("No usable sandbox!"); return "fallback"; } };
  assert.equal(await launchWith(pw, "/x/chrome"), "fallback");
  assert.deepEqual(tries, [true, false], "the fallback without a sandbox comes only after the sandbox failed");
});
