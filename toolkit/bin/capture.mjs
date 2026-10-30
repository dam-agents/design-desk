// design capture <base-url> <outdir> --routes <routes.json> [--login <profile.json>] [--width 1440] [--dark]
// Screens of a running app: signs in once with the demo account the profile's engine
// prints (`proto.sh run C-<n> credentials`, passed as DESK_DEMO_USER / DESK_DEMO_PASSWORD),
// then visits every route and writes one JPEG per route, small enough for the Desk.
// routes.json: {"Agents list": "/agents", …}. Prints one JSON line per screen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, fail, launch } from "../lib/core.mjs";

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "screen";

export async function main(_cmd, argv) {
  const pos = []; let routesPath = "", loginPath = "", width = 1440, dark = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--routes") routesPath = argv[++i];
    else if (a === "--login") loginPath = argv[++i];
    else if (a === "--width") width = Number(argv[++i]);
    else if (a === "--dark") dark = true;
    else pos.push(a);
  }
  const [base, out] = pos;
  if (!base || !out || !routesPath) fail("usage: design capture <base-url> <outdir> --routes <routes.json> [--login <profile.json>]");
  let parsed; try { parsed = new URL(base); } catch { parsed = null; }
  if (!parsed || !/^https?:$/.test(parsed.protocol)) fail(`not an http(s) base URL: ${base}`);
  const routes = JSON.parse(readFileSync(routesPath, "utf8"));
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
