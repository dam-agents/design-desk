// Shared paths and helpers for the Design Desk toolkit. Every bin/ script imports this.
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, mkdirSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const TOOLKIT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const HOME = process.env.HOME || "/home/agent";
export const WORK = process.env.WORK_DIR || join(HOME, "work");
// Persistent: survives hibernation and restarts. Per-repo toolchains and fonts live here.
export const DATA = process.env.DESIGN_DESK_DATA || join(HOME, ".local/share/design-desk");
export const req = createRequire(join(TOOLKIT, "package.json"));

export const fail = (msg) => { console.error(`design: ${msg}`); process.exit(1); };

// A directory only this user can enter: made 0700, and refused when another user (or a
// symlink) already holds the name — a shared /tmp path is someone else's to plant.
export function privateDir(d) {
  try { mkdirSync(d, { recursive: true, mode: 0o700 }); } catch (e) { fail(`cannot make ${d}: ${e.message}`); }
  const st = lstatSync(d);
  if (!st.isDirectory() || (process.getuid && st.uid !== process.getuid())) fail(`${d} is not this user's own directory — refusing to use it`);
  if ((st.mode & 0o077) !== 0) chmodSync(d, 0o700);
  return d;
}
// Ephemeral: emptied at every boot. Fresh clones and build scratch live here, per user;
// every writer takes its folder through `scratch()`, which checks the root is private.
export const SCRATCH = process.env.DESIGN_DESK_SCRATCH
  || (process.env.XDG_RUNTIME_DIR ? join(process.env.XDG_RUNTIME_DIR, "design-desk") : join(tmpdir(), `design-desk.${process.getuid ? process.getuid() : "user"}`));
export const scratch = (...parts) => ensureDir(join(privateDir(SCRATCH), ...parts));

// Repository code (a component bundle, a Tailwind config and its plugins) runs in a child
// node whose environment holds PATH and nothing else: no token, no session variable.
// Stopgap (docs/self-modification.md §5a): it still runs as the agent's user and can read
// what is on disk (~/.config/gh, work/); the real fix is an OS sandbox or an Environment
// for repository code, which the agent image does not offer yet.
export function isolatedEnv(home) {
  return { PATH: [dirname(process.execPath), process.env.PATH || "/usr/bin:/bin"].join(":"), HOME: home, TMPDIR: home, LANG: "C.UTF-8" };
}
// A fresh private directory under SCRATCH for one such child (its cwd and HOME).
export const privateTmp = (prefix) => mkdtempSync(join(privateDir(SCRATCH), `${prefix}-`));

export const warn = (msg) => console.error(`design: warning: ${msg}`);
export const ensureDir = (d) => { mkdirSync(d, { recursive: true }); return d; };
export const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
export const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });

// work/CONFIG.md reader, same contract as scripts/lib/config.sh: `- <key>: <value>`,
// first match wins, trailing # comment and one layer of quotes stripped.
export function cfg(key, fallback = "") {
  let text = "";
  try { text = readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch { return fallback; }
  for (const line of text.split("\n")) {
    const m = line.match(new RegExp(`^- ${key}:[\\t ]*(.*)$`));
    if (!m) continue;
    const v = m[1].replace(/\s*#.*$/, "").trim().replace(/^[`"']/, "").replace(/[`"']$/, "");
    return v || fallback;
  }
  return fallback;
}

// Rows of the Markdown table under `## <heading>` in work/CONFIG.md, as objects keyed
// by the lowercased header cells; same contract as cfg_table in scripts/lib/config.sh.
export function cfgTable(heading) {
  let text = "";
  try { text = readFileSync(join(WORK, "CONFIG.md"), "utf8"); } catch { return []; }
  return tableIn(text, heading);
}

// The same rows, from CONFIG.md text already read (a reader that must tell a missing
// file from an empty table reads the file itself).
export function tableIn(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return [];
  const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const rows = [];
  let head = null;
  for (const l of lines.slice(start + 1)) {
    if (/^#{1,2} /.test(l)) break;
    if (!l.trim().startsWith("|")) continue;
    if (!head) { head = cells(l).map((h) => h.toLowerCase()); continue; }
    if (/^\|?\s*:?-{3,}/.test(l.trim())) continue;
    const c = cells(l);
    rows.push(Object.fromEntries(head.map((h, i) => [h, (c[i] || "").replace(/^[`"']|[`"']$/g, "")])));
  }
  return rows;
}

// Every writer of work/CONFIG.md goes through here (docs/config.md → Writing the file):
// the lock, the file read again under it (missing: empty), `change(text)` applied to what
// is there now, and the whole file replaced by a rename.
export const configSha = (text) => createHash("sha256").update(text).digest("hex");
export function writeConfig(work, change) {
  const path = join(work, "CONFIG.md");
  const release = lockDir(join(work, ".CONFIG.lock"));
  try {
    let text = "";
    try { text = readFileSync(path, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    const next = change(text);
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, next);
    renameSync(tmp, path);
    return next;
  } finally { release(); }
}

// A lock that a dead holder never keeps and two waiters never both take. The lock is a
// directory holding one file named after its holder (`<pid>-<random>`); a writer that made
// the directory holds it once its own file is the only one there. A waiter removes a dead
// holder's file by that unique name, so a new holder's file is never touched, and then the
// directory only when it is empty (rmdir refuses one with a file in it). A holder whose
// directory vanished before its file went in, or that finds another file, starts over.
const alive = (name) => { try { process.kill(Number.parseInt(name, 10), 0); return true; } catch (e) { return e.code === "EPERM"; } };
const nap = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function lockDir(lock, { timeoutMs = 120000 } = {}) {
  const me = `${process.pid}-${createHash("sha256").update(`${Math.random()}${Date.now()}`).digest("hex").slice(0, 12)}`;
  const files = () => { try { return readdirSync(lock); } catch { return null; } };
  for (const until = Date.now() + timeoutMs; ;) {
    let made = true;
    try { mkdirSync(lock); } catch (e) { if (e.code !== "EEXIST") throw e; made = false; }
    if (made) {
      try { writeFileSync(join(lock, me), "", { flag: "wx" }); } catch (e) { if (e.code === "ENOENT") continue; throw e; }
      const held = files();
      if (held?.length === 1 && held[0] === me) return () => { try { unlinkSync(join(lock, me)); } catch {} try { rmdirSync(lock); } catch {} };
      try { unlinkSync(join(lock, me)); } catch {}
    } else {
      const held = files() || [];
      for (const f of held) if (!alive(f)) try { unlinkSync(join(lock, f)); } catch {}
      // Empty: a dead holder's, or one a writer made a moment ago; only an old one goes.
      let age = 0; try { age = Date.now() - statSync(lock).mtimeMs; } catch {}
      if (held.every((f) => !alive(f)) && (held.length > 0 || age > 5000)) try { rmdirSync(lock); } catch {}
    }
    if (Date.now() > until) throw new Error("work/CONFIG.md stayed locked for two minutes");
    nap(50 + Math.floor(Math.random() * 200));
  }
}

// work/CONFIG.md with one more `| email | role |` row in `## Desk people`: after its
// last row, or a new table at the end. A cell that could break the table, or an email
// already on it, is refused (docs/desk.md → People).
export function withRosterRow(text, email, role) {
  for (const v of [email, role]) if (!/^[^\s|`<>]+$/.test(String(v || ""))) throw new Error(`"${v}" cannot go in the table`);
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Desk people");
  const row = `| ${email} | ${role} |`;
  if (start < 0) return `${text.replace(/\n*$/, "\n")}\n## Desk people\n\n| email | role |\n| --- | --- |\n${row}\n`;
  let end = lines.length, last = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i])) { end = i; break; }
    if (lines[i].trim().startsWith("|")) last = i;
  }
  const taken = lines.slice(start + 1, end).some((l) => l.trim().startsWith("|") && (l.split("|")[1] || "").trim().replace(/^[`"']|[`"']$/g, "").toLowerCase() === email.toLowerCase());
  if (taken) throw new Error(`${email} is already on the list`);
  if (last < 0) lines.splice(start + 1, 0, "", "| email | role |", "| --- | --- |", row);
  else lines.splice(last + 1, 0, row);
  return lines.join("\n");
}

// The browser every screenshot, PDF and video uses. Order: $CHROMIUM, the image's
// Playwright Chromium, the one install-toolkit.sh unpacked into DATA, one on PATH.
export function chromium() {
  if (process.env.CHROMIUM && existsSync(process.env.CHROMIUM)) return { executablePath: process.env.CHROMIUM, env: {} };
  const pw = "/opt/ms-playwright";
  if (existsSync(pw)) {
    const dirs = readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) {
      const exe = join(pw, d, "chrome-linux64/chrome");
      if (existsSync(exe)) return { executablePath: exe, env: {} };
    }
  }
  const own = join(DATA, "chromium/chromium");
  if (existsSync(own)) {
    const base = join(DATA, "chromium");
    return { executablePath: own, env: { LD_LIBRARY_PATH: `${base}/lib:${base}`, FONTCONFIG_PATH: `${base}/fonts` } };
  }
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const r = run("sh", ["-c", `command -v ${name}`]);
    if (r.status === 0 && r.stdout.trim()) return { executablePath: r.stdout.trim(), env: {} };
  }
  return null;
}

// Chromium's own sandbox first. Stopgap (docs/self-modification.md §5a): the agent's
// container (an unprivileged user, no user namespaces, the @sparticuz/chromium build) usually
// cannot start that sandbox, so a failed launch falls back to --no-sandbox with one warning
// per process. The fix belongs to the agent image (user namespaces or a setuid sandbox);
// until then a page rendered here must stay the agent's own HTML. Pages never read sibling
// files over XHR: no --allow-file-access-from-files.
let sandboxWarned = false;
export async function launch() {
  const found = chromium();
  if (!found) fail("no Chromium found — run `bash ~/scripts/install-toolkit.sh` (it installs one), or set CHROMIUM=/path/to/chrome");
  Object.assign(process.env, found.env);
  const { chromium: pw } = req("playwright-core");
  const opts = { executablePath: found.executablePath, args: ["--disable-gpu", "--font-render-hinting=none"] };
  try { return await pw.launch({ ...opts, chromiumSandbox: true }); }
  catch (e) {
    if (!sandboxWarned) warn(`Chromium's sandbox did not start (${String(e.message || e).split("\n")[0].slice(0, 160)}); rendering without it`);
    sandboxWarned = true;
    return pw.launch({ ...opts, chromiumSandbox: false });
  }
}

// @font-face rules with the font files inlined, so a deliverable never needs a font CDN.
// `families` is [{family, weights:[300,400], dir}] where dir holds fontsource-style files.
export function fontFaces(families) {
  const out = [];
  for (const { family, weights, dir, files } of families) {
    if (files) { // uploaded brand fonts: [{path, weight, style}]
      for (const f of files) {
        const ext = f.path.split(".").pop().toLowerCase();
        const fmt = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" }[ext] || "woff2";
        const data = readFileSync(f.path).toString("base64");
        out.push(`@font-face{font-family:"${family}";font-style:${f.style || "normal"};font-weight:${f.weight || 400};font-display:swap;src:url(data:font/${ext};base64,${data}) format("${fmt}")}`);
      }
      continue;
    }
    for (const w of weights) {
      const file = readdirSync(dir).find((f) => new RegExp(`-latin-${w}-normal\\.woff2$`).test(f));
      if (!file) { warn(`no ${family} ${w} latin file in ${dir}`); continue; }
      const data = readFileSync(join(dir, file)).toString("base64");
      out.push(`@font-face{font-family:"${family}";font-style:normal;font-weight:${w};font-display:swap;src:url(data:font/woff2;base64,${data}) format("woff2")}`);
    }
  }
  return out.join("\n");
}

// Fontsource package dir for a family, from the toolkit (Plex) or DATA/fonts (on demand).
export function fontsourceDir(family) {
  const pkg = `@fontsource/${family.toLowerCase().replace(/\s+/g, "-")}`;
  for (const base of [join(TOOLKIT, "node_modules"), join(DATA, "fonts/node_modules")]) {
    const d = join(base, pkg, "files");
    if (existsSync(d)) return d;
  }
  return null;
}

export const PLEX = [
  { family: "IBM Plex Sans", weights: [300, 400, 500, 600, 700] },
  { family: "IBM Plex Mono", weights: [400, 500, 600] },
];

export function plexFaces() {
  return fontFaces(PLEX.map((f) => ({ ...f, dir: fontsourceDir(f.family) })));
}

export const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
export const readJSON = (p) => JSON.parse(readFileSync(p, "utf8"));
export const slugOf = (repo) => repo.replace(/^https?:\/\//, "").replace(/\.git$/, "").replace(/[^A-Za-z0-9._-]+/g, "__");
export const attrs = (s) => Object.fromEntries([...s.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)')/g)].map((m) => [m[1], m[2] ?? m[3]]));
export const tagRe = (name) => new RegExp(`<${name}\\b([^>]*?)\\s*(?:/>|>\\s*</${name}>)`, "g");
