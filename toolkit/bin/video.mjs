// design video <page.html[?shot=Name]> <out.mp4> [fps=30] [music.mp3]
// design stills <page.html> <shot|""> <t1,t2,...> <outdir>
// design vendor <dir>   copy React, ReactDOM, Babel and the Plex fonts into <dir>/vendor
// The page exposes window.__ready, window.__duration and window.__setTime(t) (a promise
// that resolves after paint); each frame is set, screenshotted and piped to ffmpeg.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { TOOLKIT, ensureDir, fail, launch, req } from "../lib/core.mjs";
import { resolveStyle, fontCss } from "../lib/style.mjs";
import { palette } from "../lib/theme.mjs";

const pageUrl = (input, extra = "") => {
  const [file, query = ""] = input.split("?");
  return pathToFileURL(resolve(file)).href + "?render=1" + (query ? "&" + query : "") + extra;
};

async function open(url) {
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(url);
  try { await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 }); }
  catch { await browser.close(); fail(`the page never set window.__ready — ${errors[0] || "check the console in the preview"}`); }
  return { browser, page, errors };
}

export async function main(cmd, argv) {
  if (cmd === "video-new") {
    const [root = ".", flag, value] = argv;
    const style = resolveStyle(flag === "--style" ? value : undefined);
    const st = style.kind === "repo" ? { kind: "carbon" } : style;
    const dir = ensureDir(join(root, "vendor"));
    const nm = join(TOOLKIT, "node_modules");
    copyFileSync(join(nm, "react/umd/react.production.min.js"), join(dir, "react.js"));
    copyFileSync(join(nm, "react-dom/umd/react-dom.production.min.js"), join(dir, "react-dom.js"));
    copyFileSync(join(nm, "@babel/standalone/babel.min.js"), join(dir, "babel.js"));
    writeFileSync(join(dir, "fonts.css"), fontCss(st));
    const page = join(root, "video.html");
    if (!existsSync(page)) {
      const p = palette(st.brand), t = readFileSync(join(TOOLKIT, "templates/video.html"), "utf8");
      writeFileSync(page, t.replace("accent: '#0f62fe',", `accent: '${p.accent}',`)
        .replace(/'IBM Plex Sans', system-ui/g, `'${p.sans}', system-ui`).replace(/'IBM Plex Mono', ui-monospace/g, `'${p.mono}', ui-monospace`)
        .replace("wordmark: 'Product',", `wordmark: '${(st.brand?.name || "Product").replace(/'/g, "\\'")}',`));
    }
    console.log(JSON.stringify({ page: resolve(page), vendor: resolve(dir), style: style.kind === "repo" ? "carbon (a video recreates screens by hand; take the repo's colors from its CSS)" : style.label }));
    return;
  }
  if (cmd === "stills") {
    const [file, shot = "", times = "0", outdir = "stills"] = argv;
    if (!file) fail("usage: design stills <page.html> <shot|\"\"> <t1,t2,...> <outdir>");
    ensureDir(outdir);
    const { browser, page, errors } = await open(pageUrl(file, shot ? "&shot=" + encodeURIComponent(shot) : ""));
    console.error(`duration ${await page.evaluate(() => window.__duration)}s`);
    for (const t of times.split(",").map(Number)) {
      await page.evaluate((v) => window.__setTime(v), t);
      const p = `${outdir}/${(shot || "all").replace(/\W+/g, "_")}_${t.toFixed(1)}.png`;
      await page.screenshot({ path: p }); console.log(p);
    }
    await browser.close();
    if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`); process.exitCode = 1; }
    return;
  }
  const [input, out = "demo.mp4", fpsArg = "30", music] = argv;
  if (!input) fail("usage: design video <page.html[?shot=Name]> <out.mp4> [fps] [music.mp3]");
  const fps = Number(fpsArg);
  const ffmpeg = req("ffmpeg-static");
  if (!ffmpeg) fail("ffmpeg-static has no binary for this platform");
  const { browser, page, errors } = await open(pageUrl(input));
  const dur = await page.evaluate(() => window.__duration);
  const frames = Math.round(dur * fps);
  console.error(`rendering ${frames} frames (${dur.toFixed(1)}s @ ${fps}fps) → ${out}`);
  const args = ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"];
  if (music) args.push("-stream_loop", "-1", "-i", music, "-filter_complex",
    `[1:a]volume=0.18,afade=t=in:d=2,afade=t=out:st=${Math.max(0, dur - 3)}:d=3[a]`, "-map", "0:v", "-map", "[a]", "-c:a", "aac", "-b:a", "192k", "-t", String(dur));
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", out);
  const ff = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "inherit"] });
  const started = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.__setTime(t), i / fps);
    const buf = await page.screenshot({ type: "jpeg", quality: 95 });
    if (!ff.stdin.write(buf)) await once(ff.stdin, "drain");
    if (i % (fps * 5) === 0) process.stderr.write(`\r${Math.round((i / frames) * 100)}%`);
  }
  ff.stdin.end();
  const [code] = await once(ff, "close");
  await browser.close();
  if (code !== 0) fail(`ffmpeg exited ${code}`);
  console.log(JSON.stringify({ video: resolve(out), seconds: Number(dur.toFixed(1)), frames, render_seconds: Math.round((Date.now() - started) / 1000) }));
  if (errors.length) { console.error(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`); process.exitCode = 1; }
}
