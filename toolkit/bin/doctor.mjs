// design doctor — is the toolchain usable right now? One line per check, JSON summary last.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { TOOLKIT, DATA, WORK, req, run, chromium, launch, fontsourceDir } from "../lib/core.mjs";

export async function main() {
  const res = [];
  const add = (ok, check, detail, fix = "") => { res.push({ ok, check, detail, ...(ok || !fix ? {} : { fix }) }); console.log(`${ok ? "ok  " : "FAIL"} ${check} — ${detail}${!ok && fix ? ` — fix: ${fix}` : ""}`); };
  const installFix = "bash ~/scripts/install-toolkit.sh";
  add(existsSync(join(TOOLKIT, "node_modules/tailwindcss")), "toolkit packages", TOOLKIT, installFix);
  const c = chromium();
  add(!!c, "browser", c ? c.executablePath : "none found", installFix);
  if (c) {
    try { const b = await launch(); const p = await b.newPage(); await p.setContent("<p style='font:20px IBM Plex Sans'>x</p>"); await b.close(); add(true, "browser launches", "headless page rendered"); }
    catch (e) { add(false, "browser launches", e.message.split("\n")[0], installFix); }
  }
  let ff = ""; try { ff = req("ffmpeg-static"); } catch {}
  const ffok = ff && existsSync(ff) && run(ff, ["-hide_banner", "-encoders"]).stdout.includes("libx264");
  add(!!ffok, "ffmpeg (H.264)", ff || "missing", installFix);
  add(!!fontsourceDir("IBM Plex Sans"), "default fonts", "IBM Plex Sans/Mono inlined from npm", installFix);
  const npm = run("npm", ["ping", "--silent"]);
  add(npm.status === 0, "npm registry", npm.status === 0 ? "reachable (repo toolchains and fonts install on demand)" : "unreachable", "the agent's network access must allow registry.npmjs.org");
  const gh = run("gh", ["api", "user", "--jq", ".login"]);
  add(true, "GitHub", gh.status === 0 ? `connected as ${gh.stdout.trim()}` : "not connected — repo mode works on public repos only");
  add(existsSync(WORK), "work/", WORK, "follow ONBOARDING.md");
  console.log(JSON.stringify({ ok: res.every((r) => r.ok), failed: res.filter((r) => !r.ok).map((r) => r.check), data: DATA }));
  if (!res.every((r) => r.ok)) process.exitCode = 1;
}
