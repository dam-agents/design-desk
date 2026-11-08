// node --test toolkit/tests/isolation.test.mjs — repository code runs in a child that sees
// no token, and scratch folders are this user's alone.
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLKIT, isolatedEnv, privateDir } from "../lib/core.mjs";

const child = (box, code) => {
  const bundle = join(box, "bundle.cjs");
  writeFileSync(bundle, code);
  const input = { bundle, react: TOOLKIT, out: join(box, "out.json"), wrappers: [], tags: [{ i: 0, props: { className: "x" }, mocks: {} }] };
  process.env.GH_TOKEN = "ghp_not_for_the_child_000000000000";
  const r = spawnSync(process.execPath, [join(TOOLKIT, "lib/component-child.cjs")], { cwd: box, env: isolatedEnv(box), input: JSON.stringify(input), encoding: "utf8" });
  delete process.env.GH_TOKEN;
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(readFileSync(input.out, "utf8"));
};

test("a component renders in a child whose env holds PATH, HOME, TMPDIR and LANG only", () => {
  const box = mkdtempSync(join(tmpdir(), "design-desk-iso-"));
  const res = child(box, `const { createElement: h } = require("react");
console.log("noise on stdout does not break the answer");
exports.C0 = (p) => h("p", { className: p.className }, Object.keys(process.env).sort().join(","));`);
  assert.deepEqual(res.ok, [{ i: 0, out: '<p class="x">HOME,LANG,PATH,TMPDIR</p>' }]);
});

test("a component that throws at import is reported, not raised", () => {
  const box = mkdtempSync(join(tmpdir(), "design-desk-iso-"));
  const res = child(box, `throw new Error("needs window");`);
  assert.equal(res.error.stage, "load");
  assert.match(res.error.message, /needs window/);
});

test("a scratch folder is made, or made again, private", () => {
  const d = join(mkdtempSync(join(tmpdir(), "design-desk-iso-")), "scratch");
  mkdirSync(d, { mode: 0o755 }); chmodSync(d, 0o755);
  privateDir(d);
  assert.equal(statSync(d).mode & 0o777, 0o700);
});
