// design capture <base-url> <outdir> (--routes <routes.json> | --recipe <recipe.json>) [--login <profile.json>] [--width 1440] [--dark]
// Screens of a running app: signs in once with the demo account the profile's engine
// prints (passed as DESK_DEMO_USER / DESK_DEMO_PASSWORD), then writes one JPEG per screen,
// small enough for the Desk. Prints one JSON line per screen.
//   routes.json  {"Agents list": "/agents", …}: visit each and shoot.
//   recipe.json  {"setup": [step…], "shots": [{"name", "steps": [step…], "themes": ["light", "dark"]}]}:
//                the steps bring the app into the state a shot shows. A step is one of
//                {"goto": "/path"}, {"click": "<selector>"}, {"fill": ["<selector>", "text"]},
//                {"press": "Enter"}, {"hover": "<selector>"}, {"select": ["<selector>", "value"]},
//                {"wait": "<selector>" | ms}, {"scroll": "<selector>"}. Selectors are Playwright's:
//                CSS, `text=…`, `role=button[name="…"]`. A step that fails shoots where it stopped
//                (`<shot>-stuck.jpg`) and reports the step, and the next shot starts from `setup`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, fail, launch } from "../lib/core.mjs";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "screen";

export async function main(_cmd, argv) {
  const pos = []; let routesPath = "", recipePath = "", loginPath = "", width = 1440, dark = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--routes") routesPath = argv[++i];
    else if (a === "--recipe") recipePath = argv[++i];
    else if (a === "--login") loginPath = argv[++i];
    else if (a === "--width") width = Number(argv[++i]);
    else if (a === "--dark") dark = true;
    else pos.push(a);
  }
  const [base, out] = pos;
  if (!base || !out || !(routesPath || recipePath)) fail("usage: design capture <base-url> <outdir> (--routes <routes.json> | --recipe <recipe.json>) [--login <profile.json>]");
  let parsed; try { parsed = new URL(base); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) fail(`not an http(s) base URL: ${base}`);
  const routes = routesPath ? JSON.parse(readFileSync(routesPath, "utf8")) : {};
  const recipe = recipePath ? JSON.parse(readFileSync(recipePath, "utf8")) : null;
  ensureDir(out);
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light", ignoreHTTPSErrors: true });
  const pg = await ctx.newPage();
  const url = (p) => new URL(p, base.endsWith("/") ? base : `${base}/`).href;

  if (loginPath) {
    const login = JSON.parse(readFileSync(loginPath, "utf8")).capture?.login;
    const user = process.env.DESK_DEMO_USER, pass = process.env.DESK_DEMO_PASSWORD;
    if (login && user && pass) {
      await pg.goto(url(login.path || "/"), { waitUntil: "domcontentloaded" });
      await pg.waitForSelector(login.user_field, { timeout: 30000 });
      await pg.fill(login.user_field, user);
      await pg.fill(login.password_field, pass);
      await Promise.all([pg.waitForLoadState("networkidle").catch(() => {}), pg.click(login.submit)]);
      await pg.waitForTimeout(1500);
    } else if (login) {
      console.error("design: warning: the profile has a login but DESK_DEMO_USER/DESK_DEMO_PASSWORD are not set — capturing signed out");
    }
  }

  if (recipe) { await followRecipe(pg, recipe, { url, base, out }); await browser.close(); return; }

  for (const [name, path] of Object.entries(routes)) {
    try {
      await pg.goto(url(path), { waitUntil: "networkidle", timeout: 45000 });
    } catch { await pg.waitForTimeout(2000); }
    await pg.evaluate(() => document.fonts?.ready).catch(() => {});
    await pg.waitForTimeout(800);
    const file = join(out, `${slug(name)}${dark ? "-dark" : ""}.jpg`);
    // JPEG at 80 keeps a full screen well under the Desk's 720 KB asset limit.
    await pg.screenshot({ path: file, type: "jpeg", quality: 80, fullPage: false });
    console.log(JSON.stringify({ name, path, file, url: pg.url() }));
  }
  await browser.close();
}

// The recipe's steps run against the app only: a `goto` outside the base address is refused.
async function step(pg, st, { url, base }) {
  const [kind] = Object.keys(st);
  const v = st[kind];
  const t = { timeout: 20000 };
  if (kind === "goto") {
    const target = url(String(v));
    if (new URL(target).origin !== new URL(base).origin) throw new Error(`goto leaves the app: ${v}`);
    await pg.goto(target, { waitUntil: "networkidle", timeout: 45000 }).catch(() => pg.waitForTimeout(2000));
  } else if (kind === "click") await pg.click(String(v), t);
  else if (kind === "fill") await pg.fill(String(v[0]), String(v[1] ?? ""), t);
  else if (kind === "press") await pg.keyboard.press(String(v));
  else if (kind === "hover") await pg.hover(String(v), t);
  else if (kind === "select") await pg.selectOption(String(v[0]), String(v[1]), t);
  else if (kind === "scroll") await pg.locator(String(v)).first().scrollIntoViewIfNeeded(t);
  else if (kind === "wait") { if (typeof v === "number") await pg.waitForTimeout(Math.min(v, 30000)); else await pg.waitForSelector(String(v), t); }
  else throw new Error(`unknown step ${kind}`);
}

async function followRecipe(pg, recipe, ctx) {
  const run = async (steps, label) => { for (const [i, st] of (steps || []).entries()) { try { await step(pg, st, ctx); } catch (e) { e.at = `${label} step ${i + 1} (${JSON.stringify(st).slice(0, 120)})`; throw e; } } };
  const setup = async () => run(recipe.setup, "setup");
  try { await setup(); } catch (e) { console.log(JSON.stringify({ error: e.message, at: e.at })); return; }
  for (const shot of recipe.shots || []) {
    const name = String(shot.name || "screen");
    try {
      await run(shot.steps, name);
      await pg.evaluate(() => document.fonts?.ready).catch(() => {});
      await pg.waitForTimeout(600);
      for (const theme of shot.themes || ["light"]) {
        await pg.emulateMedia({ colorScheme: theme === "dark" ? "dark" : "light" });
        await pg.waitForTimeout(300);
        const file = join(ctx.out, `${slug(name)}${theme === "dark" ? "-dark" : ""}.jpg`);
        await pg.screenshot({ path: file, type: "jpeg", quality: 80, fullPage: Boolean(shot.full) });
        console.log(JSON.stringify({ name, theme, file, url: pg.url() }));
      }
      await pg.emulateMedia({ colorScheme: "light" });
    } catch (e) {
      const file = join(ctx.out, `${slug(name)}-stuck.jpg`);
      await pg.screenshot({ path: file, type: "jpeg", quality: 70 }).catch(() => {});
      console.log(JSON.stringify({ name, error: e.message.split("\n")[0], at: e.at || null, file }));
      await setup().catch(() => {});
    }
  }
}
