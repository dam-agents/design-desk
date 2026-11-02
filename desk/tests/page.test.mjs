// node --test desk/tests/page.test.mjs — the Desk page runs in a sandboxed frame without
// allow-forms (docs/desk.md → Where it works): the browser blocks a form's submission
// before its submit event fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, req } from "../../toolkit/lib/core.mjs";
import { ROLES, abilities } from "../store.mjs";

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "page.html"), "utf8");

test("nothing on the page submits a form", () => {
  const forms = page.match(/<form\b[\s\S]*?<\/form>/g) || [];
  assert.ok(forms.length > 0, "the page has its dialog forms");
  for (const f of forms)
    for (const b of f.match(/<button\b[^>]*>/g) || [])
      assert.match(b, /\btype="button"/, `${f.match(/id="([^"]+)"/)?.[1]}: ${b}`);
  assert.doesNotMatch(page, /<input\b[^>]*\btype=["']?(submit|image)\b/i);
  assert.doesNotMatch(page, /\brequestSubmit\(|\.submit\(\)|\bonsubmit\b/);
  assert.doesNotMatch(page, /addEventListener\("submit",\s*guard\(/);
});

// A stand-in bridge records every call; the server answers just enough for a lead's Desk
// with one shipped change, a weekly digest and two open requests, one of them waiting for
// an answer.
// /api/people as the server builds it: every role, with the default prototype_requesters.
const PEOPLE = JSON.stringify({ people: [{ email: "lead@example.com", role: "lead" }, { email: "pat@example.com", role: "pm" }],
  roles: Object.fromEntries(ROLES.map((r) => [r, abilities(r, ["designer", "lead"])])) });
const BRIDGE = `<script>
window.calls = [];
const change = { id: "ch1", kind: "change", title: "A new header", summary: "From PR #45.", source: { repo: "acme/widgets", pr: 45, url: "https://github.com/acme/widgets/pull/45" } };
const digest = { id: "d1", kind: "digest", title: "This week", status: "new" };
const requests = [{ id: "r2", kind: "request", title: "Softer colours", status: "triage", asks: true }, { id: "r3", kind: "request", title: "A wider sidebar", status: "triage" }];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  if (window.failNext) { window.failNext = false; return { status: 503, contentType: "text/plain", body: "" }; }
  const answer = path === "/api/me" ? { role: "lead", email: "lead@example.com", can: { request: true, close: true, screens: true, add: true } }
    : path === "/api/cards" ? { cards: [change, digest, ...requests] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/requests" ? { card: { id: "r1" } }
    : path === "/api/product" ? { card: { id: "e1", kind: "element" } }
    : path === "/api/cards/e1" ? { card: { id: "e1", kind: "element", title: "The agent row", status: "building", wanted: { part: "The agent row", where: "", show: "" }, created_by: { email: "lead@example.com", role: "lead" } } }
    : path === "/api/cards/r1" ? { card: { id: "r1", kind: "request", title: "Bigger send button", status: "triage" } }
    : path === "/api/cards/ch1" ? { card: change }
    : path === "/api/people" ? ${PEOPLE} : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

// The page in a sandboxed frame with a stand-in bridge; null (the test skipped) when this
// machine has no browser or no toolkit dependencies.
async function launch(t, bridge) {
  const browser = chromium();
  if (!browser) { t.skip("no browser here"); return null; }
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") { t.skip("toolkit dependencies are not installed"); return null; } throw e; }
  Object.assign(process.env, browser.env);
  const server = createServer((r, res) => {
    res.setHeader("content-type", "text/html");
    res.end(r.url === "/desk" ? page.replace("<script>", bridge + "<script>")
      : `<!doctype html><iframe sandbox="allow-scripts allow-modals" src="/desk" style="width:1000px;height:700px"></iframe>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  const top = await chrome.newPage();
  await top.goto(`http://127.0.0.1:${server.address().port}/`);
  const desk = top.frames().find((f) => f.url().endsWith("/desk"));
  const posts = (path) => desk.evaluate((p) => calls.filter((c) => c.method === "POST" && c.path === p), path);
  const settled = async (path, n, why) => { await top.waitForTimeout(300); assert.equal((await posts(path)).length, n, why); };
  return { top, desk, posts, settled, close: async () => { await chrome.close(); server.close(); } };
}

test("every dialog acts once from a sandboxed frame, and only on its own button", async (t) => {
  const run = await launch(t, BRIDGE);
  if (!run) return;
  const { top, desk, posts, settled } = run;
  try {
    const dialog = (id) => ({
      open: () => desk.evaluate((i) => document.getElementById(i).open, id),
      button: (name) => desk.locator(`#${id} .actions button`, { hasText: name }),
      // A close with no value keeps the last one (as Escape does in some browsers).
      close: () => desk.evaluate((i) => document.getElementById(i).close(), id),
    });

    // Requests counts the open ones, like Next call; amber while one waits for an answer.
    await desk.waitForSelector('[data-tab="requests"] .count');
    assert.equal(await desk.textContent('[data-tab="requests"] .count'), "2", "the tab counts every open request");
    assert.equal(await desk.getAttribute('[data-tab="requests"] .count', "class"), "count warn", "one waits for an answer");

    // The request dialog.
    const rq = dialog("request-dialog");
    await desk.click("#new-request");
    await rq.button("Cancel").click();
    assert.equal(await rq.open(), false, "Cancel closes the dialog");
    await desk.click("#new-request");
    await rq.button("Send").click();
    assert.equal(await rq.open(), true, "an empty request stays open");
    await desk.fill("#request-dialog textarea[name=problem]", "Make the send button bigger");
    await rq.button("Send").click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/r1"));
    assert.equal(await rq.open(), false, "Send closes the dialog");
    const sent = await posts("/api/requests");
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0].body).problem, "Make the send button bigger");
    await desk.click("#new-request");
    await rq.close();
    await settled("/api/requests", 1, "a close after a Send sends nothing");
    await desk.click("#new-request");
    await desk.fill("#request-dialog textarea[name=problem]", "Sent with Enter");
    await desk.press("#request-dialog input[name=screen]", "Enter");
    await desk.waitForFunction(() => calls.filter((c) => c.path === "/api/requests").length === 2);
    assert.equal(await rq.open(), false, "Enter in a field sends the request");
    await desk.click("#new-request");
    await desk.fill("#request-dialog textarea[name=problem]", "Still typing");
    await desk.evaluate(() => document.querySelector("#request-dialog input[name=screen]")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true })));
    await settled("/api/requests", 2, "an Enter that ends a composition sends nothing");
    await rq.button("Cancel").click();
    await desk.click("#new-request");
    await desk.fill("#request-dialog textarea[name=problem]", "Kept after a failure");
    await desk.evaluate(() => { window.failNext = true; });
    await rq.button("Send").click();
    await desk.waitForSelector("#request-dialog[open] .toast", { state: "attached" });
    assert.equal(await desk.inputValue("#request-dialog textarea[name=problem]"), "Kept after a failure", "a failed send keeps the text");
    await rq.button("Send").click();
    await desk.waitForFunction(() => calls.filter((c) => c.path === "/api/requests").length === 4);
    assert.equal(await rq.open(), false, "a second Send goes through");

    // The confirmation dialog, through "Close this request…".
    const cf = dialog("confirm-dialog"), actions = "/api/cards/r1/actions";
    const closeRequest = async () => {
      await desk.waitForSelector("details.more", { state: "attached" });
      await desk.evaluate(() => { document.querySelector("details.more").open = true; });
      await desk.click('[data-act="close"]');
      assert.equal(await cf.open(), true);
    };
    await closeRequest();
    await cf.button("Cancel").click();
    await settled(actions, 0, "Cancel confirms nothing");
    await closeRequest();
    await desk.evaluate(() => { document.querySelector("#confirm-form [name=note]").value = "Kept after a failure"; window.failNext = true; });
    await cf.button("Close it").click();
    await desk.waitForSelector("#confirm-dialog[open] .toast", { state: "attached" });
    assert.equal(await desk.inputValue("#confirm-form [name=note]"), "Kept after a failure", "a failed action keeps what was typed");
    await cf.button("Close it").click();
    await desk.waitForFunction((p) => calls.filter((c) => c.method === "POST" && c.path === p).length === 2, actions);
    assert.equal(await cf.open(), false, "a second OK goes through");
    await closeRequest();
    await cf.close();
    await settled(actions, 2, "a close after an OK confirms nothing");

    // The screenshot dialog, on a shipped change.
    const sh = dialog("shots-dialog"), screens = "/api/cards/ch1/screens";
    await desk.click('[data-tab="new"]');
    assert.equal((await desk.textContent('[data-card="d1"] .meta')).trim(), "Weekly digest", "a digest row shows no status word");
    await desk.click('[data-card="ch1"]');
    const withPicture = async () => {
      await desk.click("[data-add-shots]");
      await desk.setInputFiles("#sh-file", { name: "shot.png", mimeType: "image/png", buffer: PNG });
      await desk.waitForSelector("#sh-thumbs img", { state: "attached" });
    };
    await desk.click("[data-add-shots]");
    await sh.button("Add").click();
    await settled(screens, 0, "Add with no picture sends nothing");
    await withPicture();
    await sh.button("Cancel").click();
    await settled(screens, 0, "Cancel sends nothing");
    await withPicture();
    await desk.evaluate(() => { window.failNext = true; });
    await sh.button("Add").click();
    await desk.waitForSelector("#shots-dialog[open] .toast", { state: "attached" });
    assert.equal(await desk.locator("#sh-thumbs img").count(), 1, "a failed Add keeps the picture");
    await sh.button("Add").click();
    await desk.waitForFunction((p) => calls.filter((c) => c.method === "POST" && c.path === p).length === 2, screens);
    await withPicture();
    await sh.close();
    await settled(screens, 2, "a close after an Add sends nothing");

    // An open item keeps its way back on screen (the browser's Back leaves the Desk), and
    // an issue or pull request number links to it.
    assert.ok(await desk.isVisible(".crumb [data-back]"), "an open item shows its way back");
    assert.equal(await desk.getAttribute(".lead a", "href"), "https://github.com/acme/widgets/pull/45", "PR #45 links to its pull request");
    await desk.click(".crumb [data-back]");
    assert.equal(await desk.locator(".crumb").count(), 0, "Back closes the item");

    // The Add to Product dialog: a screen needs Design Desk's own copy, which is off here.
    const pd = dialog("product-dialog"), product = "/api/product";
    await desk.click('[data-tab="product"]');
    await desk.click("[data-add-product]");
    assert.equal(await pd.open(), true);
    assert.equal(await desk.inputValue("#product-form [name=kind]"), "element", "without the copy, a part is the default");
    await desk.click('#kind-choice [data-kind="screen"]');
    assert.equal(await pd.button("Add").isDisabled(), true, "a screen can't be added without the copy");
    await desk.click('#kind-choice [data-kind="element"]');
    await pd.button("Add").click();
    assert.equal(await pd.open(), true, "an empty Add stays open");
    await pd.button("Cancel").click();
    await settled(product, 0, "Cancel adds nothing");
    await desk.click("[data-add-product]");
    await desk.fill("#product-dialog textarea[name=part]", "The agent row");
    await desk.evaluate(() => { window.failNext = true; });
    await pd.button("Add").click();
    await desk.waitForSelector("#product-dialog[open] .toast", { state: "attached" });
    assert.equal(await desk.inputValue("#product-dialog textarea[name=part]"), "The agent row", "a failed Add keeps the text");
    await pd.button("Add").click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/e1"));
    assert.equal(await pd.open(), false, "a second Add goes through");
    const asked = await posts(product);
    assert.equal(asked.length, 2);
    assert.deepEqual([JSON.parse(asked[1].body).kind, JSON.parse(asked[1].body).part], ["element", "The agent row"]);
    await desk.click("[data-add-product]");
    await pd.close();
    await settled(product, 2, "a close after an Add adds nothing");

    // People: the roster with its roles, and what each role adds to the one below it.
    await desk.click('[data-tab="people"]');
    await desk.waitForSelector("table.people");
    assert.deepEqual(await desk.locator("table.people tbody tr").allInnerTexts(), ["lead@example.com you\tlead", "pat@example.com\tPM"]);
    assert.deepEqual((await desk.locator(".roles h4").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")), ["lead your role", "designer", "PM", "developer", "viewer"]);
    const panel = (i) => desk.locator(".roles .panel").nth(i).innerText();
    assert.match(await panel(0), /Same as a designer\./, "a role with a later one's rights says so");
    assert.match(await panel(1), /Everything a PM or developer can, and:\s+Start design options[\s\S]*Build live prototypes/, "tied roles below are named together");
    assert.match(await panel(2), /Same as a developer\./);
    assert.match(await panel(3), /Everything a viewer can, and:\s+Vote on options/);
    assert.doesNotMatch(await panel(4), /Everything|Same as/, "the smallest role lists its own");
  } finally {
    await chrome.close();
    server.close();
  }
});

// Needs a designer (docs/desk.md): New opens on All, the filter keeps what waits for a
// designer, a seen change leaves it, and the choice survives a reload.
const LIST = `<script>
const cards = [
  { id: "c1", kind: "change", title: "A new settings page", acked: false, attention: { level: "designer", reasons: ["a new screen"] } },
  { id: "c2", kind: "change", title: "Tighter rows", acked: false, attention: { level: "fyi", reasons: ["follows the list pattern"] } },
  { id: "c3", kind: "change", title: "Seen already", acked: true, attention: { level: "designer", reasons: ["its own grey"] } },
  { id: "c4", kind: "change", title: "Seen, and suggested", acked: true, suggested: { note: "A new pattern" }, attention: { level: "designer", reasons: ["its own grey", "Suggested for the next call"] } },
  { id: "r1", kind: "request", title: "Calmer empty list", status: "feedback", attention: { level: "designer", reasons: ["Options are ready: pick one or ask for changes"] } },
  { id: "r2", kind: "request", title: "Bigger send button", status: "triage" },
  { id: "r3", kind: "request", title: "Shipped and worth showing", status: "handed-off", suggested: { note: "Worth showing" }, attention: { level: "designer", reasons: ["Suggested for the next call"] } },
];
window.platform = { async request({ path }) {
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { request: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("Needs a designer filters New and Requests, and New opens on All", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const server = createServer((r, res) => { res.setHeader("content-type", "text/html"); res.end(page.replace("<script>", LIST + "<script>")); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const desk = await chrome.newPage();
    await desk.goto(`http://127.0.0.1:${server.address().port}/`);
    const rows = async () => { await desk.waitForSelector("#list .filters"); return desk.$$eval("#list .row", (rs) => rs.map((r) => r.dataset.card)); };
    assert.deepEqual(await rows(), ["c1", "c2", "c3", "c4"], "New opens on All");
    assert.match(await desk.textContent("#list .filters .on"), /^All$/);
    await desk.click('[data-filter="newFilter:designer"]');
    assert.deepEqual(await rows(), ["c1", "c4"], "only what waits for a designer: not what you saw, unless it is suggested");
    assert.match(await desk.textContent("#list .row"), /Needs a designer: a new screen/);
    assert.match(await desk.textContent('[data-card="c4"]'), /Needs a designer: Suggested for the next call/, "a seen change shows only its suggestion");
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-filter="reqFilter:designer"]');
    assert.deepEqual(await rows(), ["r1", "r3"], "a closed request stays while it is suggested");
    assert.match(await desk.textContent('[data-filter="reqFilter:designer"]'), /Needs a designer \(2\)/);
    await desk.reload();
    await desk.click('[data-tab="new"]');
    assert.deepEqual(await rows(), ["c1", "c4"], "the filter you picked is kept");
  } finally {
    await run.close();
  }
});

// A designer's Desk with an overdue change of two pictures, and a request whose build waits
// for the answers to the agent's form.
const DAY = 864e5;
const BRIDGE_NEW = `<script>
window.calls = [];
const created = new Date(Date.now() - 30 * ${DAY}).toISOString();
const svg = (c) => ({ contentType: "image/svg+xml", encoding: "utf8", data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="' + c + '"/></svg>' });
const change = { id: "ch2", kind: "change", title: "See which agents stopped", summary: "A red dot marks a stopped agent.", created, handled: null,
  source: { repo: "acme/widgets", pr: 11 }, screens: [{ asset: "A-1", caption: "The list" }, { asset: "A-2", caption: "The card" }],
  sections: [{ key: "what", title: "What changed", body: "- A red dot.", source: { label: "PR #11", url: "https://github.com/acme/widgets/pull/11" } },
    { key: "why", title: "Why it is like this", body: "- Owners missed stopped agents.", source: { label: "not documented" } }] };
const request = { id: "r2", kind: "request", title: "Bigger send button", status: "feedback", created, triage: { verdict: "design", reasons: [] },
  variants: [{ id: "v1", name: "Calm", asset: "A-3" }], prototype: { state: "none" },
  threads: [{ id: "t1", kind: "asks", state: "open", step: "build", messages: [{ by: { agent: true }, at: created, text: "Two things." }],
    questions: [{ text: "Empty list?", options: ["A hint", "Nothing"], suggested: "A hint" }, { text: "Button words?", options: ["Send", "Send message"] }] }] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", due_days: 21, can: { handle: true, build: true, comment: true, ask: true } }
    : path === "/api/cards" ? { cards: [{ ...change, screens: 2 }, { ...request, variants: 1, threads: undefined, asks: true }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/ch2" ? { card: change } : path === "/api/cards/r2" ? { card: request }
    : path === "/api/assets/A-1" ? svg("red") : path === "/api/assets/A-2" ? svg("blue") : path === "/api/assets/A-3" ? { contentType: "text/html", encoding: "utf8", data: "<p>Calm</p>" } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;

test("a change shows its age and gets handled, pictures step through, the form and the build send what they show", async (t) => {
  const run = await launch(t, BRIDGE_NEW);
  if (!run) return;
  const { desk, posts } = run;
  const sent = async (path, n) => { await desk.waitForFunction(([p, k]) => calls.filter((c) => c.method === "POST" && c.path === p).length === k, [path, n]); return JSON.parse((await posts(path))[n - 1].body); };
  try {
    // An overdue change, its sources and its folded explanation.
    await desk.click('[data-tab="new"]');
    await desk.waitForSelector('[data-card="ch2"]');
    assert.match(await desk.getAttribute('[data-card="ch2"]', "class"), /overdue/, "a change past due_days is marked in the list");
    assert.match(await desk.textContent('[data-card="ch2"] .meta'), /Overdue · 30 days open/);
    await desk.click('[data-card="ch2"]');
    await desk.waitForSelector("[data-handle]");
    assert.equal(await desk.getAttribute(".sec-head .chip a", "href"), "https://github.com/acme/widgets/pull/11", "a section links its source");
    assert.equal(await desk.locator("details.sec").count(), 1, "the explaining section is folded, what changed is not");
    assert.match(await desk.textContent("details.sec summary"), /Why it is like this[\s\S]*Source: not documented/);
    await desk.click('[data-handle="1"]');
    assert.deepEqual(await sent("/api/cards/ch2/handled", 1), { handled: true });

    // The gallery steps through the change's pictures.
    await desk.click('[data-zoom="A-1"]');
    await desk.waitForSelector(".zoom figcaption");
    assert.equal(await desk.textContent(".zoom figcaption"), "1 / 2 · The list");
    await desk.press("body", "ArrowRight");
    await desk.waitForFunction(() => document.querySelector(".zoom figcaption").textContent.startsWith("2 / 2"));
    await desk.click(".zoom .gal.next");
    await desk.waitForFunction(() => document.querySelector(".zoom figcaption").textContent === "1 / 2 · The list");
    await desk.press("body", "Escape");
    assert.equal(await desk.locator(".zoom").count(), 0, "Escape closes the gallery");

    // The agent's form: one answer and one left to it, then all left to it.
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r2"]');
    await desk.waitForSelector("#form-t1");
    await desk.check('#form-t1 input[name="q-t1-0"][value="Nothing"]');
    await desk.fill('#form-t1 fieldset[data-q="0"] [data-q-note]', "Keep it calm.");
    await desk.click('[data-send-form="t1"]');
    assert.deepEqual(await sent("/api/threads/t1/answers", 1), { answers: [{ choice: "Nothing", note: "Keep it calm." }, { choice: null, note: "" }] });
    await desk.waitForSelector('[data-skip-form="t1"]');
    await desk.click('[data-skip-form="t1"]');
    assert.deepEqual(await sent("/api/threads/t1/answers", 2), { answers: [{ choice: null, note: "" }, { choice: null, note: "" }] });

    // Build asks first unless the designer unticks it.
    const cf = (name) => desk.locator("#confirm-dialog .actions button", { hasText: name });
    await desk.click('[data-act="build"]');
    assert.equal(await desk.isChecked("#confirm-form [name=check]"), true, "Ask me first is ticked");
    await cf("Build it").click();
    assert.deepEqual(await sent("/api/cards/r2/actions", 1), { action: "build", note: "v1", ask_first: true });
    await desk.waitForSelector('[data-act="build"]');
    await desk.click('[data-act="build"]');
    await desk.uncheck("#confirm-form [name=check]");
    await cf("Build it").click();
    assert.equal((await sent("/api/cards/r2/actions", 2)).ask_first, false);
  } finally {
    await run.close();
  }
});
