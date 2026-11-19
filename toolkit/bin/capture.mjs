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
//                A shot with `"element": "<selector>"` is cut to that part, 8 px round it
//                (`<shot>[-dark]-element.jpg`): a part as it is in the product, for its dialog on
//                the Desk (docs/requests.md → The part before, from the product). A recipe of parts
//                alone shoots at two screen pixels per CSS pixel, so a small part stays sharp.
import { readFileSync, rmSync, statSync } from "node:fs";
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
  const partsOnly = Boolean(recipe?.shots?.length) && recipe.shots.every((x) => x?.element);
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: dark ? "dark" : "light", ignoreHTTPSErrors: true, deviceScaleFactor: partsOnly ? 2 : 1 });
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

// One part of the page alone, 8 px round it and never past the page's edge; a part that is
// missing or not shown fails the shot like a step that failed. A part that fits the window is cut
// from what the window shows, so a sticky or fixed part is cut where it is seen; a larger one is
// shot as the element itself, without the padding. Past 700 KiB (the Desk takes at most 720 KiB) it is shot again at one
// screen pixel per CSS pixel, then at a lower quality.
const PAD = 8, MAX_BYTES = 700 * 1024;
async function cutTo(pg, selector, file) {
  const el = pg.locator(selector).first();
  await el.waitFor({ state: "visible", timeout: 20000 }).catch(() => { throw new Error(`element ${selector} is not on the page or not shown`); });
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const b = await el.evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, sx: scrollX, sy: scrollY, vw: innerWidth, vh: innerHeight, pw: document.documentElement.scrollWidth, ph: document.documentElement.scrollHeight }; });
  if (!b.w || !b.h) throw new Error(`element ${selector} has no size`);
  // Whole in the window, either way: cut from what it shows. Taller or wider: Playwright shoots
  // the element itself, which handles a part larger than the window (no padding round it then).
  const inView = b.h + 2 * PAD <= b.vh && b.y >= 0 && b.w + 2 * PAD <= b.vw && b.x >= 0;
  const x = Math.max(0, b.x - PAD), y = Math.max(0, b.y - PAD);
  const clip = { x, y, width: Math.min(b.vw - x, b.x + b.w + PAD - x), height: Math.min(b.vh - y, b.y + b.h + PAD - y) };
  for (const opts of [{ quality: 80 }, { quality: 80, scale: "css" }, { quality: 60, scale: "css" }]) {
    if (inView) await pg.screenshot({ path: file, type: "jpeg", clip, ...opts });
    else await el.screenshot({ path: file, type: "jpeg", ...opts });
    if (statSync(file).size <= MAX_BYTES) break;
  }
  // A picture too large is never left under the name of one taken: the next run would upload it.
  if (statSync(file).size > MAX_BYTES) { rmSync(file, { force: true }); throw new Error(`element ${selector} is more than 700 KiB even at one screen pixel per CSS pixel: shoot a smaller part`); }
  return { x: Math.round(b.x + b.sx), y: Math.round(b.y + b.sy), w: Math.round(b.w), h: Math.round(b.h) };
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
        if (shot.element) {
          const file = join(ctx.out, `${slug(name)}${theme === "dark" ? "-dark" : ""}-element.jpg`);
          const box = await cutTo(pg, String(shot.element), file);
          console.log(JSON.stringify({ name, theme, file, url: pg.url(), element: true, box }));
          continue;
        }
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
