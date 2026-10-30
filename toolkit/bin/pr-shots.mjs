// design pr-shots <[host/]owner/name> <pr> <outdir>
// Downloads the images a pull request's body and comments carry (Markdown images and
// <img> tags pointing at GitHub's attachment hosts), converts each to a JPEG the Desk
// can serve, and prints one JSON line per image with where it came from. Images from
// other hosts are listed but not fetched: a PR body is data, and an arbitrary URL in it
// is not a place to send the machine.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDir, fail, launch, run } from "../lib/core.mjs";

const ALLOWED = /^https:\/\/(github\.com\/user-attachments\/|user-images\.githubusercontent\.com\/|private-user-images\.githubusercontent\.com\/|[a-z0-9-]+\.githubusercontent\.com\/)/i;

export async function main(_cmd, argv) {
  const [repo, pr, out] = argv;
  if (!repo || !/^\d+$/.test(pr || "") || !out) fail("usage: design pr-shots <[host/]owner/name> <pr> <outdir>");
  const host = repo.split("/").length === 3 ? ["--hostname", repo.split("/")[0]] : [];
  const slug = repo.split("/").slice(-2).join("/");
  const gh = (...a) => { const r = run("gh", ["api", ...host, ...a], { maxBuffer: 32 * 1024 * 1024 }); if (r.status !== 0) fail(`gh api ${a[0]}: ${r.stderr.trim()}`); return JSON.parse(r.stdout || "null"); };
  const prJson = gh(`repos/${slug}/pulls/${pr}`);
  const comments = gh(`repos/${slug}/issues/${pr}/comments?per_page=100`) || [];
  const texts = [{ from: "body", by: prJson.user?.login, text: prJson.body || "" }, ...comments.map((c) => ({ from: `comment ${c.id}`, by: c.user?.login, text: c.body || "" }))];
  const found = [];
  for (const t of texts) {
    for (const m of t.text.matchAll(/!\[([^\]]*)\]\((https?:[^)\s]+)\)|<img[^>]+src="(https?:[^"]+)"[^>]*?(?:alt="([^"]*)")?/g)) {
      const src = m[2] || m[3], alt = (m[1] ?? m[4] ?? "").replace(/^#/, "");
      if (!found.some((f) => f.src === src)) found.push({ src, alt, from: t.from, by: t.by });
    }
  }
  ensureDir(out);
  const browser = found.length ? await launch() : null;
  let i = 0;
  for (const f of found) {
    i++;
    if (!ALLOWED.test(f.src)) { console.log(JSON.stringify({ ...f, skipped: "not a GitHub attachment host" })); continue; }
    // curl honours the machine's proxy, where the platform adds the GitHub credential.
    const raw = join(out, `raw-${i}`);
    const r = run("curl", ["-sfL", "--max-time", "60", "-o", raw, f.src]);
    if (r.status !== 0) { console.log(JSON.stringify({ ...f, skipped: `download failed (curl ${r.status})` })); continue; }
    const buf = readFileSync(raw);
    const mime = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
      : buf[0] === 0xff && buf[1] === 0xd8 ? "image/jpeg" : buf.slice(0, 4).toString() === "GIF8" ? "image/gif"
      : buf.slice(8, 12).toString() === "WEBP" ? "image/webp" : null;
    if (!mime) { console.log(JSON.stringify({ ...f, skipped: "not an image (a video or a page)" })); continue; }
    const file = join(out, `pr-${pr}-${i}.jpg`);
    const pg = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await pg.setContent(`<html><body style="margin:0;background:#fff"><img id="i" src="data:${mime};base64,${buf.toString("base64")}" style="display:block;max-width:1600px"></body></html>`, { waitUntil: "load" });
    const box = await pg.evaluate(() => { const im = document.getElementById("i"); return { w: Math.round(im.getBoundingClientRect().width), h: Math.round(im.getBoundingClientRect().height) }; });
    const w = Math.max(1, box.w), h = Math.max(1, Math.min(box.h, 4000));
    await pg.setViewportSize({ width: w, height: h });
    await pg.screenshot({ path: file, type: "jpeg", quality: 80, clip: { x: 0, y: 0, width: w, height: h } });
    await pg.close();
    console.log(JSON.stringify({ ...f, file, width: w, height: h }));
  }
  if (browser) await browser.close();
  writeFileSync(join(out, "sources.json"), JSON.stringify(found, null, 1));
}
