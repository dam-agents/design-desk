// node --test toolkit/tests/kit.test.mjs — design kit reads a product's named values and its
// components' variants from the code, for an element's smart controls.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readKit, cvaVariants, unionVariants, classFamilies, cssTokens, kindOf } from "../lib/kit.mjs";

const design = new URL("../bin/design.mjs", import.meta.url).pathname;

function repo() {
  const root = mkdtempSync(join(tmpdir(), "dd-kit-"));
  const put = (p, text) => { mkdirSync(join(root, p, ".."), { recursive: true }); writeFileSync(join(root, p), text); };
  put(".design-desk/acme/profile.json", JSON.stringify({ style: { ui_dir: "web" } }));
  put("web/src/app.css", `:root { --primary: #3b5bdb; --muted-foreground: oklch(0.55 0.02 260); --radius: 0.5rem;
  --shadow-sm: 0 1px 2px rgba(0,0,0,.08); --space-4: 16px; --text-sm: 14px; --line-height: 1.5; }
.dark { --primary: #91a7ff; }
.btn-primary { color: red } .btn-secondary { color: blue } .btn-ghost {}`);
  put("web/src/components/ui/button.tsx", `import { cva } from "class-variance-authority";
const buttonVariants = cva("inline-flex items-center", {
  variants: {
    // the kinds of button
    variant: { default: "bg-primary text-white", secondary: ["bg-muted", "text-fg"], ghost: "hover:bg-muted" },
    size: { sm: "h-8 px-3", lg: "h-11 px-8" },
  },
  defaultVariants: { variant: "default", size: "sm" },
});
export function Button() { return null; }`);
  put("web/src/components/ui/badge.tsx", `type Props = { tone?: "neutral" | "success" | "danger"; label: string };
export function Badge({ tone = "neutral" }: Props) { return null; }`);
  put("web/src/components/ui/button.test.tsx", `type T = { variant?: "x" | "y" };`);
  put("server/api.ts", `type Q = { status?: "open" | "closed" };`);
  return root;
}

test("a kit: the light theme's named values by kind, and every component's variants with its file", () => {
  const kit = readKit(repo(), { uiDir: "web" });
  assert.deepEqual(kit.tokens.color.map((t) => [t.name, t.value]), [["--primary", "#3b5bdb"], ["--muted-foreground", "oklch(0.55 0.02 260)"]], "the first definition wins, a dark override does not");
  assert.deepEqual(Object.keys(kit.tokens).sort(), ["color", "font-size", "radius", "shadow", "space"], "a line height is no kind the palette offers");
  assert.equal(kit.tokens.shadow[0].file, "web/src/app.css");
  const by = (name, prop) => kit.components.find((c) => c.name === name && c.prop === prop);
  assert.deepEqual(by("Button", "variant"), { name: "Button", file: "web/src/components/ui/button.tsx", prop: "variant", how: "cva", default: "default",
    options: [{ name: "default", classes: "bg-primary text-white" }, { name: "secondary", classes: "bg-muted text-fg" }, { name: "ghost", classes: "hover:bg-muted" }] });
  assert.equal(by("Button", "size").default, "sm");
  assert.deepEqual(by("Badge", "tone").options.map((o) => o.name), ["neutral", "success", "danger"]);
  assert.deepEqual(by("Btn", "class").options.map((o) => o.class), ["btn-primary", "btn-secondary", "btn-ghost"]);
  assert.equal(kit.components.some((c) => c.prop === "status" || c.options.some((o) => o.name === "x")), false, "outside the UI folder and tests are not read");
});

test("the readers each find their own shape, and leave what is not one", () => {
  assert.deepEqual(cvaVariants(`const x = cva("a", { variants: { tone: { only: "b" } } })`, "f.ts"), [], "one option is no choice");
  assert.deepEqual(unionVariants(`id?: "a" | "b"`, "f.tsx"), [], "a prop that is no look");
  assert.deepEqual(classFamilies(`.card-primary {}`, "f.css"), [], "one class is no family");
  assert.deepEqual(cssTokens(`.x { --brand: #fff; }`, "f.css"), [], "a value on another rule is not the product's");
  assert.deepEqual(cssTokens(`html.dark { --primary: #000; } @media (prefers-color-scheme: dark) { :root { --fg: #eee; } } [data-theme="light"] { --accent: #f00; } :root { --primary: #fff; }`, "f.css").map((t) => t.name + "=" + t.value),
    ["--accent=#f00", "--primary=#fff"], "a dark theme read first is still no product value; a light one is");
  assert.throws(() => readKit(join(tmpdir(), "dd-kit-none")), /cannot read/, "a root that is not there is no empty kit");
  assert.throws(() => readKit(repo(), { uiDir: "app" }), /UI folder app/, "nor is a UI folder that is not there");
  assert.equal(kindOf("--ring", "var(--primary)"), "color");
  assert.equal(kindOf("--font-sans", "Inter, sans-serif"), null);
});

test("design kit prints the kit of a clone, its UI folder from the profile", async () => {
  const root = repo();
  const { stdout } = await promisify(execFile)(process.execPath, [design, "kit", "--root", root], { timeout: 30000 });
  const kit = JSON.parse(stdout);
  assert.equal(kit.ui_dir, "web");
  assert.equal(kit.counts.components, kit.components.length);
  assert.ok(kit.components.length >= 4);
});
