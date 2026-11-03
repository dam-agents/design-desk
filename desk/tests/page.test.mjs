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
import { ROLES, ADDABLE_ROLES, abilities } from "../store.mjs";

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
  roles: Object.fromEntries(ROLES.map((r) => [r, abilities(r, ["designer", "lead"])])), addable: ADDABLE_ROLES });
const BRIDGE = `<script>
window.calls = [];
const change = { id: "ch1", kind: "change", title: "A new header", summary: "From PR #45.", source: { repo: "acme/widgets", pr: 45, url: "https://github.com/acme/widgets/pull/45", author: "dana" } };
const digest = { id: "d1", kind: "digest", title: "This week", status: "new" };
const requests = [
  { id: "r2", kind: "request", title: "Softer colours", status: "triage", asks: true, by: { agent: true }, origin: { channel: "slack", reporter: "Carla", url: "https://acme.slack.com/archives/C0123ABCD/p1" } },
  { id: "r3", kind: "request", title: "A wider sidebar", status: "triage", by: { agent: true }, origin: { channel: "chat", reporter: "Gita" } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  if (window.failNext) { window.failNext = false; return { status: 503, contentType: "text/plain", body: "" }; }
  const answer = path === "/api/me" ? { role: "lead", email: "lead@example.com", can: { request: true, close: true, screens: true, add: true, people: true },
      skills: [{ name: "copy", does: "Write the words", on: true }, { name: "brand", does: "Use a saved brand", on: false }] }
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
    assert.equal(await desk.isVisible("#rq-skills"), true, "an idea offers the skills");
    await desk.click("#request-dialog #type-choice button[data-type=bug]");
    assert.equal(await desk.isVisible("#rq-skills"), false, "a bug offers no skills");
    assert.equal(await desk.isVisible("#rq-vision"), false, "a bug asks for no picture of how it should look");
    await desk.click("#request-dialog #type-choice button[data-type=idea]");
    await rq.button("Send").click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/r1"));
    assert.equal(await rq.open(), false, "Send closes the dialog");
    assert.equal(await desk.getAttribute("#banners details.intro", "data-intro"), "requests", "a sent request opens Requests with its intro");
    const sent = await posts("/api/requests");
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0].body).problem, "Make the send button bigger");
    assert.deepEqual(JSON.parse(sent[0].body).skills, { copy: true, brand: false }, "each switch is sent as it was set");
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
    assert.equal((await desk.textContent('.row.item:has([data-card="d1"]) .meta')).trim(), "Weekly digest", "a digest row shows no status word");
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

    // Every row in New and Requests says where it came from and who started it; its
    // links go to the source, the rest of the row opens the item.
    assert.match(await desk.textContent('.row.item:has([data-card="ch1"]) .prov'), /PR #45.*by dana.*Automatic/);
    await desk.click('[data-tab="requests"]');
    const prov = '.row.item:has([data-card="r2"]) .prov';
    assert.match(await desk.textContent(prov), /Slack.*by Carla/);
    assert.match(await desk.textContent('.row.item:has([data-card="r3"]) .prov'), /Chat with Design Desk.*by Gita/, "the reporter is the author whatever the channel");
    assert.equal(await desk.getAttribute(`${prov} a`, "href"), "https://acme.slack.com/archives/C0123ABCD/p1", "the source links to the thread");
    await desk.click('.row.item:has([data-card="r2"]) .meta', { force: true });
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/r2"));

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
    assert.match(await panel(0), /Everything a designer can, and:\s+Ask Design Desk to add people to the list/, "only a lead adds people");
    assert.match(await panel(1), /Everything a PM can, and:\s+Start design options[\s\S]*Build live prototypes/, "a role names the largest one below it");
    assert.match(await panel(2), /Everything a developer can, and:\s+Draw an issue/, "a PM also has issues drawn");
    assert.match(await panel(3), /Everything a viewer can, and:\s+Vote on options/);
    assert.doesNotMatch(await panel(4), /Everything|Same as/, "the smallest role lists its own");

    // A lead asks Design Desk to add a person with a role; the roles to pick leave out lead.
    const pe = dialog("person-dialog");
    await desk.click("[data-add-person]");
    assert.equal(await pe.open(), true);
    assert.deepEqual(await desk.locator("#pe-roles input").evaluateAll((xs) => xs.map((x) => x.value)), ["designer", "pm", "developer"]);
    await pe.button("Ask Design Desk").click();
    assert.equal(await pe.open(), true, "an Ask without an email stays open");
    await desk.fill("#person-form [name=email]", "alex@example.com");
    await desk.check('#pe-roles input[value="pm"]');
    await pe.button("Ask Design Desk").click();
    await desk.waitForFunction(() => calls.filter((c) => c.path === "/api/people").length >= 2);
    assert.deepEqual((await posts("/api/people")).map((c) => JSON.parse(c.body)), [{ email: "alex@example.com", role: "pm" }]);
  } finally {
    await run.close();
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
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE} : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

// The page at the top level, so its browser storage survives a reload.
async function open(t, bridge, fn) {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const server = createServer((r, res) => { res.setHeader("content-type", "text/html"); res.end(page.replace("<script>", bridge + "<script>")); });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const desk = await chrome.newPage();
    await desk.goto(`http://127.0.0.1:${server.address().port}/`);
    await fn(desk);
  } finally {
    await chrome.close();
    server.close();
  }
}

// LIST with a stand-in server that keeps the person's prefs where the page never looks
// (sessionStorage), so a reload with the page's own storage cleared shows what the server kept.
const KEPT = LIST.replace(/<\/script>$/, `
const listed = window.platform.request;
window.platform = { async request(r) {
  if (r.path === "/api/me/prefs") { sessionStorage.setItem("server-prefs", r.body); return { status: 200, contentType: "application/json", body: JSON.stringify({ prefs: JSON.parse(r.body) }) }; }
  const res = await listed(r);
  if (r.path === "/api/me") res.body = JSON.stringify({ ...JSON.parse(res.body), prefs: JSON.parse(sessionStorage.getItem("server-prefs") || "{}") });
  return res;
} };
</script>`);

test("every tab but How it works opens with its intro; folding one folds them all, and the server keeps it", (t) => open(t, KEPT, async (desk) => {
  const intro = '#banners details.intro';
  await desk.waitForSelector(`${intro}[data-intro="new"][open]`);
  assert.match(await desk.textContent(intro), /What you see here[\s\S]*What you can do[\s\S]*Step by step/);
  assert.match(await desk.textContent(`${intro} li.off`), /Got it[\s\S]*not with your role/, "an action the role may not do says so");
  for (const tab of ["requests", "call", "product", "people"]) {
    await desk.click(`[data-tab="${tab}"]`);
    await desk.waitForSelector(`${intro}[data-intro="${tab}"][open]`);
  }
  assert.match(await desk.textContent('#banners [data-intro="people"] li.off'), /Add a person[\s\S]*not with your role/, "a designer sees that adding people is a lead's");
  await desk.click('[data-tab="guide"]');
  assert.equal(await desk.locator(intro).count(), 0, "How it works is all intro");
  await desk.click('[data-tab="new"]');
  await desk.click(`${intro} > summary`);
  await desk.click('[data-tab="requests"]');
  await desk.waitForSelector(`${intro}[data-intro="requests"]`);
  assert.equal(await desk.locator(`${intro}[open]`).count(), 0, "folding one tab's intro folds the others");
  await desk.evaluate(() => localStorage.clear());
  await desk.reload();
  await desk.click('[data-tab="product"]');
  await desk.waitForSelector(`${intro}[data-intro="product"]`);
  assert.equal(await desk.locator(`${intro}[open]`).count(), 0, "it stays folded after a reload, without this browser's storage");
  await desk.click(`${intro} > summary`);
  await desk.click('[data-tab="new"]');
  await desk.waitForSelector(`${intro}[data-intro="new"][open]`);
}));

test("Needs a designer filters New and Requests, and New opens on All", (t) => open(t, LIST, async (desk) => {
  const rows = async () => { await desk.waitForSelector("#list .filters"); return desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card)); };
  assert.deepEqual(await rows(), ["c1", "c2", "c3", "c4"], "New opens on All");
  assert.match(await desk.textContent("#list .filters .on"), /^All$/);
  await desk.click('[data-filter="newFilter:designer"]');
  assert.deepEqual(await rows(), ["c1", "c4"], "only what waits for a designer: not what you saw, unless it is suggested");
  assert.match(await desk.textContent("#list .row"), /Needs a designer: a new screen/);
  assert.match(await desk.textContent('.row.item:has([data-card="c4"])'), /Needs a designer: Suggested for the next call/, "a seen change shows only its suggestion");
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-filter="reqFilter:designer"]');
  assert.deepEqual(await rows(), ["r1", "r3"], "a closed request stays while it is suggested");
  assert.match(await desk.textContent('[data-filter="reqFilter:designer"]'), /Needs a designer \(2\)/);
  await desk.reload();
  await desk.click('[data-tab="new"]');
  assert.deepEqual(await rows(), ["c1", "c4"], "the filter you picked is kept");
}));

// Every item has a number by its title; a link with it, or Go to, opens the item in its tab
// (in Next call for #call/C-n); a number in text links to that item (docs/desk.md → Links to an item).
const LINKS = `<script>
window.copied = [];
Object.defineProperty(navigator, "clipboard", { value: { async writeText(t) { copied.push(t); } } });
const cards = [
  { id: "C-1", kind: "change", title: "A new header", acked: true, summary: "Follows C-2; nothing to do with C-99." },
  { id: "C-2", kind: "request", title: "Calmer empty list", status: "feedback" },
  { id: "C-3", kind: "request", title: "Closed one", status: "declined" },
];
window.platform = { async request({ path }) {
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: {}, link: "https://share.example.com/a/xY12" }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [{ ...cards[1], agenda: { brief: "Pick one." } }] } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("an item's number and link: shown grey by its title, copied, opened from a link, Go to or a number in text", (t) => open(t, LINKS, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  const shown = async (tab, title) => {
    await desk.waitForFunction(([tb, ti]) => document.querySelector(`[data-tab="${tb}"]`)?.getAttribute("aria-current") === "true" && document.querySelector("#detail h2")?.textContent.startsWith(ti), [tab, title]);
    return desk.textContent("#detail h2 .num");
  };
  await desk.waitForSelector('#list .row .num');
  assert.equal(await desk.textContent('.row.item:has([data-card="C-1"]) .num'), "C-1", "each row shows its number");

  await desk.goto(`${base}#C-3`);
  assert.equal(await shown("requests", "Closed one"), "C-3", "a link opens the item in its own tab");
  assert.match(await desk.textContent("#list .filters .on"), /Closed/, "with a filter that shows it");
  const [num, title] = await desk.$eval("#detail h2", (h) => [getComputedStyle(h.querySelector(".num")).color, getComputedStyle(h).color]);
  assert.notEqual(num, title, "the number is grey, not the title's colour");
  await desk.click("[data-copy-link]");
  await desk.waitForFunction(() => copied.length === 1);
  assert.deepEqual(await desk.evaluate(() => copied), ["https://share.example.com/a/xY12#C-3"]);

  await desk.fill("#goto", "c 1");
  await desk.press("#goto", "Enter");
  assert.equal(await shown("new", "A new header"), "C-1", "Go to takes the number");
  assert.equal(await desk.locator('#detail a[data-ref="C-2"]').count(), 1, "a number in text links to that item");
  assert.equal(await desk.locator('#detail a[data-ref="C-99"]').count(), 0, "a number the Desk does not have stays text");
  await desk.click('#detail a[data-ref="C-2"]');
  assert.equal(await shown("requests", "Calmer empty list"), "C-2");

  await desk.goto(`${base}#call/C-2`);
  await desk.reload();
  assert.equal(await shown("call", "Calmer empty list"), "C-2", "a link to Next call opens it there, also on a fresh load");
  await desk.click("[data-copy-link]");
  await desk.waitForFunction(() => copied.length === 1);
  assert.deepEqual(await desk.evaluate(() => copied), ["https://share.example.com/a/xY12#call/C-2"]);

  await desk.fill("#goto", "https://share.example.com/a/xY12#C-99");
  await desk.press("#goto", "Enter");
  await desk.waitForSelector(".toast");
  assert.match(await desk.textContent(".toast"), /nothing numbered C-99/);
}));

// A designer's Desk with an overdue change of two pictures, one with where it changed, and
// places that are in Product; and a request whose build waits for the answers to the agent's form.
const DAY = 864e5;
const BRIDGE_NEW = `<script>
window.calls = [];
const created = new Date(Date.now() - 30 * ${DAY}).toISOString();
const svg = (c, h = 3) => ({ contentType: "image/svg+xml", encoding: "utf8", data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="' + h + '"><rect width="4" height="' + h + '" fill="' + c + '"/></svg>' });
// Two before-and-after pairs with the after picture's marks: same size, and a taller after.
const m = [{ x: 0.25, y: 0, w: 0.5, h: 0.5 }];
const pairs = { id: "ch4", kind: "change", title: "Two pairs", created, handled: created, status: "handled", source: { repo: "acme/widgets", pr: 12 },
  screens: [{ asset: "A-4", stage: "before", pair: "Same", marks: m }, { asset: "A-5", stage: "after", pair: "Same", marks: m },
    { asset: "A-6", stage: "before", pair: "Taller", marks: m }, { asset: "A-7", stage: "after", pair: "Taller", marks: m }] };
const change = { id: "ch2", kind: "change", title: "See which agents stopped", summary: "A red dot marks a stopped agent.", created, handled: null,
  source: { repo: "acme/widgets", pr: 11 }, screens: [{ asset: "A-1", caption: "The list", marks: [{ x: 0.25, y: 0, w: 0.5, h: 1 / 3 }] }, { asset: "A-2", caption: "The card" }],
  impact: { concept: "a stopped agent", places: [{ where: "Agents list", kind: "screen" }, { where: "The agent row", card: "e9", kind: "component" }, { where: "Slack alert", kind: "message" }, { where: "Agents list", kind: "message" }] },
  sections: [{ key: "what", title: "What changed", body: "- A red dot.", source: { label: "PR #11", url: "https://github.com/acme/widgets/pull/11" } },
    { key: "why", title: "Why it is like this", body: "- Owners missed stopped agents.", source: { label: "not documented" } }] };
const request = { id: "r2", kind: "request", title: "Bigger send button", status: "feedback", created, triage: { verdict: "design", reasons: [] },
  variants: [{ id: "v1", name: "Calm", asset: "A-3" }], prototype: { state: "none" },
  threads: [{ id: "t1", kind: "asks", state: "open", step: "build", messages: [{ by: { agent: true }, at: created, text: "Two things." }],
    questions: [{ text: "Empty list?", options: ["A hint", "Nothing"], suggested: "A hint" }, { text: "Button words?", options: ["Send", "Send message"] }] }] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", due_days: 21, can: { handle: true, build: true, comment: true, ask: true } }
    : path === "/api/cards" ? { cards: [{ ...change, screens: 2 }, { id: "ch3", kind: "change", title: "Handled already", status: "handled", created, handled: created, attention: { level: "designer", reasons: ["a new screen"] } }, { ...request, variants: 1, threads: undefined, asks: true }, { id: "s9", kind: "screen", title: "Agents list" }, { ...pairs, screens: 4 }, { id: "e9", kind: "element", title: "Agent row" }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/ch2" ? { card: change } : path === "/api/cards/ch4" ? { card: pairs }
    : path === "/api/assets/A-4" || path === "/api/assets/A-5" || path === "/api/assets/A-6" ? svg("white") : path === "/api/assets/A-7" ? svg("white", 6) : path === "/api/cards/r2" ? { card: request }
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
    const row = '.row.item:has([data-card="ch2"])';
    assert.match(await desk.getAttribute(row, "class"), /overdue/, "a change past due_days is marked in the list");
    assert.match(await desk.textContent(`${row} .meta`), /Overdue · 30 days open/);
    assert.doesNotMatch(await desk.getAttribute('.row.item:has([data-card="ch3"])', "class"), /overdue/, "a handled change is not overdue");
    const rows = () => desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card));
    await desk.click('[data-filter="newFilter:open"]');
    assert.deepEqual(await rows(), ["ch2"], "Not handled lists only the changes nobody marked handled");
    await desk.click('[data-filter="newFilter:designer"]');
    assert.deepEqual(await rows(), [], "a handled change leaves Needs a designer");
    await desk.click('[data-filter="newFilter:all"]');
    await desk.click('[data-card="ch2"]');
    await desk.waitForSelector("[data-handle]");
    assert.equal(await desk.getAttribute(".sec-head .chip a", "href"), "https://github.com/acme/widgets/pull/11", "a section links its source");
    assert.equal(await desk.locator("details.sec").count(), 1, "the explaining section is folded, what changed is not");
    assert.match(await desk.textContent("details.sec summary"), /Why it is like this[\s\S]*Source: not documented/);
    assert.deepEqual(await desk.$$eval(".detail .secs", (ss) => ss.map((s) => [...s.children].map((c) => c.textContent.match(/What changed|Why it is like this/)?.[0]))),
      [["What changed", "Why it is like this"]], "one grid holds the card's sections, so they stand side by side on a wide window");
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

    // The filters stay on one line in the list's width.
    assert.equal(new Set(await desk.$$eval("#list .filters .btn", (bs) => bs.map((b) => b.offsetTop))).size, 1, "the filters do not wrap");

    // Where the change is: outlined until the switch is off, and in the gallery too.
    const mark = '.shot[data-zoom="A-1"] .mark';
    assert.equal(await desk.isChecked("[data-outline]"), true, "outlines are on at first");
    assert.equal(await desk.isVisible(mark), true);
    assert.deepEqual(await desk.$eval(mark, (m) => [m.style.left, m.style.width]), ["25%", "50%"]);
    assert.equal(await desk.locator('.shot[data-zoom="A-2"] .mark').count(), 0, "a picture without marks has none");
    await desk.uncheck("[data-outline]");
    assert.equal(await desk.isVisible(mark), false, "unticked hides every outline");
    await desk.check("[data-outline]");
    await desk.click('[data-zoom="A-1"]');
    await desk.waitForSelector(".zoom .mark", { state: "visible" });
    await desk.press("body", "Escape");

    // A before picture keeps the after picture's marks only when the two are the same size.
    await desk.click('[data-card="ch4"]');
    await desk.waitForFunction(() => document.querySelectorAll("figure[data-frame]").length === 0 && document.querySelector('[data-zoom="A-7"] img')?.naturalHeight);
    assert.deepEqual(await desk.$$eval(".shot", (fs) => fs.map((f) => [f.dataset.zoom, f.querySelectorAll(".mark").length])),
      [["A-4", 1], ["A-5", 1], ["A-6", 0], ["A-7", 1]], "the shorter before picture loses its frames");
    assert.equal(await desk.getAttribute('[data-zoom="A-6"]', "data-marks"), null, "and the gallery draws none on it");
    // Until the sizes are compared, the frames stay hidden, on the card and in the gallery.
    await desk.$eval('[data-zoom="A-4"]', (f) => { f.dataset.frame = "A-5"; });
    assert.equal(await desk.isVisible('[data-zoom="A-4"] .mark'), false);
    await desk.click('[data-zoom="A-4"]');
    await desk.waitForSelector(".zoom img");
    assert.equal(await desk.locator(".zoom .mark").count(), 0);
    await desk.press("body", "Escape");
    await desk.click('[data-card="ch2"]');
    await desk.waitForSelector(".impact", { state: "attached" });

    // A place that is a screen or a part in Product opens it: by its card, or a screen or
    // component place by its name.
    assert.deepEqual(await desk.$$eval(".impact li", (ls) => ls.map((l) => l.querySelector(".link")?.dataset.card || null)), ["s9", "e9", null, null], "a message named like a screen does not open it");

    // The agent's form: one answer and one left to it, then all left to it.
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r2"]');
    await desk.waitForSelector("#form-t1");
    assert.equal(await desk.locator(".detail .secs").count(), 0, "a card without sections has no section grid");
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

// The Issues tab: the sprint's issues first, what the UI will need in each row, and an
// issue's Draw it and Design this.
test("the Issues tab lists the planned issues; Draw it and Design this act once", async (t) => {
  const issues = `const issue = { id: "is1", kind: "issue", status: "open", title: "See what each agent spends", bucket: "sprint", needs: ["A spend column in the agents list"], sketches: 0,
    source: { repo: "acme/widgets", issue: 41, url: "https://github.com/acme/widgets/issues/41", author: "alice", milestone: "Sprint 12", assignees: ["bob"] }, waiting: [], threads: [] };
  const later = { id: "is2", kind: "issue", status: "open", title: "A calmer empty Home", bucket: "backlog", needs: ["An empty state on Home"], sketches: 0, source: { repo: "acme/widgets", issue: 40, author: "erin" } };
  const gone = { id: "is3", kind: "issue", status: "archived", title: "Closed", bucket: "sprint", source: { repo: "acme/widgets", issue: 39 } };`;
  const bridge = BRIDGE.replace("const digest =", `${issues}\nconst digest =`)
    .replace("cards: [change, digest, ...requests]", "cards: [change, digest, ...requests, issue, later, gone]")
    .replace("can: { request: true,", "can: { draw: true, \"follow-up\": true, request: true,")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/cards/is1" ? { card: issue }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk, posts, settled } = run;
  try {
    await desk.waitForSelector('[data-tab="issues"] .count');
    assert.equal(await desk.textContent('[data-tab="issues"] .count'), "1", "the tab counts the open issues of the sprint");
    await desk.click('[data-tab="issues"]');
    assert.equal(await desk.locator(".row.item").count(), 1, "This sprint is the first view; a closed issue is not listed");
    const row = '.row.item:has([data-card="is1"])';
    assert.match(await desk.textContent(`${row} .prov`), /Issue #41.*by alice.*assigned to bob/);
    assert.match(await desk.textContent(`${row} .s`), /UI: A spend column in the agents list/);
    assert.match(await desk.textContent(`${row} .meta`), /Sprint 12/);
    await desk.click('[data-filter="issueFilter:backlog"]');
    assert.deepEqual(await desk.locator(".row.item [data-card]").evaluateAll((xs) => xs.map((x) => x.dataset.card)), ["is2"]);
    await desk.click('[data-filter="issueFilter:sprint"]');
    await desk.click('[data-card="is1"]');
    await desk.waitForSelector("text=What the UI will need");
    assert.match(await desk.textContent("#detail"), /No picture yet[\s\S]*Design Desk sketches it in its next daily check/);

    const cf = (name) => desk.locator("#confirm-dialog .actions button", { hasText: name });
    await desk.click('[data-act="draw"]');
    await cf("Cancel").click();
    await settled("/api/cards/is1/actions", 0, "Cancel draws nothing");
    await desk.click('[data-act="draw"]');
    await desk.fill("#confirm-form [name=note]", "try a chart");
    await cf("Draw it").click();
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/is1/actions"));
    assert.deepEqual(JSON.parse((await posts("/api/cards/is1/actions"))[0].body), { action: "draw", note: "try a chart" });

    await desk.click("[data-adjust]");
    assert.equal(await desk.textContent("#rq-title"), "Design this issue");
    assert.equal(await desk.inputValue("#request-dialog textarea[name=problem]"), "A spend column in the agents list", "the needs start the request");
    await desk.locator("#request-dialog .actions button", { hasText: "Send" }).click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/requests"));
    assert.equal(JSON.parse((await posts("/api/requests"))[0].body).from, "is1", "the request comes from the issue");
  } finally { await run.close(); }
});

// A designer's request from Slack with two options and three comments on the first: one done.
const BRIDGE_NOTES = `<script>
window.calls = [];
const at = new Date().toISOString();
const by = { email: "pat@example.com", role: "pm" };
const note = (id, kind, state, text, more = {}) => ({ id, kind, state, anchor: { variant: "v1", selector: "button", label: "Button “Save”", view: "2", view_name: "Billing" }, messages: [{ by, at, text }], ...more });
const request = { id: "r5", kind: "request", title: "Plans page", status: "feedback", created: at, triage: { verdict: "design", reasons: [] }, prototype: { state: "none" },
  origin: { channel: "slack", reporter: "Carla", url: "https://acme.slack.com/archives/C0123ABCD/p1" },
  variants: [{ id: "v1", name: "Tabs", asset: "A-1", fidelity: "wireframe" }, { id: "v2", name: "One page", asset: "A-1", fidelity: "wireframe" }],
  threads: [note("t1", "comment", "open", "Save is easy to miss", { messages: [{ by, at, text: "Save is easy to miss" }, { by: { email: "alice@example.com", role: "designer" }, at, text: "Agreed" }] }),
    note("t2", "concern", "open", "Too many tabs"), note("t3", "comment", "resolved", "Typo in the title")] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", slack_send: false, can: { comment: true, change: true, choose: true, share: true, vote: true } }
    : path === "/api/cards" ? { cards: [{ ...request, variants: 2, threads: undefined }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/r5" ? { card: request }
    : path === "/api/cards/r5/work-in" ? { threads: JSON.parse(body).threads.map((id) => ({ id })), inbox: { id: "I-1" } }
    : path === "/api/assets/A-1" ? { contentType: "text/html", encoding: "utf8", data: '<body><div data-view="1"><button>Next</button></div><div data-view="2"><button>Save</button></div></body>' } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("notes in the workspace: open and done, a whole conversation, worked in together; a designer picks the winner; designs go to the Slack thread", async (t) => {
  const run = await launch(t, BRIDGE_NOTES);
  if (!run) return;
  const { desk, posts } = run;
  const sent = async (path, n) => { await desk.waitForFunction(([p, k]) => calls.filter((c) => c.method === "POST" && c.path === p).length === k, [path, n]); return JSON.parse((await posts(path))[n - 1].body); };
  try {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r5"]');
    await desk.waitForSelector('[data-act="workspace"]');
    assert.match(await desk.textContent("#detail"), /a designer picks the winner/);
    assert.equal(await desk.locator('[data-work-in="t1"]').count(), 1, "a comment on an option can be worked in from the thread");
    assert.match(await desk.textContent('[data-goto="t1"]'), /Billing/, "a note names the view it is on");

    await desk.click('[data-choose="v1"]');
    assert.deepEqual(await sent("/api/cards/r5/chosen", 1), { variant: "v1" });

    await desk.click('[data-act="slack-send"]');
    assert.match(await desk.textContent("#cf-body"), /Slack thread this request came from/);
    await desk.locator("#confirm-dialog .actions button", { hasText: "Send" }).click();
    assert.deepEqual(await sent("/api/cards/r5/actions", 1), { action: "slack-send", note: JSON.stringify({ variants: "all", note: "" }) });

    await desk.waitForSelector('[data-act="workspace"]');
    await desk.click('[data-act="workspace"]');
    await desk.waitForSelector("#ws-side .notes");
    const shown = () => desk.$$eval("#ws-side [data-ws-note]", (ns) => ns.map((n) => n.dataset.wsNote));
    assert.deepEqual(await shown(), ["t1", "t2"], "Open lists what is not done");
    await desk.click('[data-ws-filter="done"]');
    assert.deepEqual(await shown(), ["t3"]);
    await desk.click('[data-ws-note="t3"]');
    await desk.click('#ws-side [data-reopen="t3"]');
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/threads/t3/reopen"));
    await desk.click('[data-ws-filter="open"]');
    await desk.click('[data-ws-note="t1"]');
    assert.match(await desk.textContent('[data-ws-note="t1"]'), /Save is easy to miss[\s\S]*Agreed/, "a picked note shows its whole conversation");
    await desk.fill('#ws-side [data-reply="t1"]', "Make it primary");
    await desk.click('#ws-side [data-send-reply="t1"]');
    assert.deepEqual(await sent("/api/threads/t1/messages", 1), { text: "Make it primary" });
    await desk.waitForSelector('#ws-side [data-work-in="t1,t2"]');
    await desk.click('#ws-side [data-work-in="t1,t2"]');
    assert.deepEqual(await sent("/api/cards/r5/work-in", 1), { threads: ["t1", "t2"] });
  } finally {
    await run.close();
  }
});

// The review bar a build puts into every design (toolkit/chrome/review-bar.html), in the
// workspace's frame: it acts in Select mode, and only a click on the design picks.
const BAR = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "toolkit", "chrome", "review-bar.html"), "utf8");
const WITH_BAR = `<body>${BAR}<div data-view="1" data-view-name="Start"><button>Next</button></div><div data-view="2" data-view-name="Billing"><button>Save</button></div></body>`;
const BRIDGE_BAR = `<script>
window.calls = [];
const at = new Date().toISOString();
const request = { id: "r6", kind: "request", title: "Plans page", status: "feedback", created: at, triage: { verdict: "design", reasons: [] }, prototype: { state: "none" },
  variants: [{ id: "v1", name: "Tabs", asset: "A-1", fidelity: "wireframe" }], threads: [] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", can: { comment: true, change: true, choose: true } }
    : path === "/api/cards" ? { cards: [{ ...request, variants: 1, threads: undefined }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/r6" ? { card: request }
    : path === "/api/assets/A-1" ? { contentType: "text/html", encoding: "utf8", data: ${JSON.stringify(WITH_BAR).replace(/</g, "\\u003c")} } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("in Select mode the review bar acts: a hover or a click on it picks nothing, a click on the design picks", async (t) => {
  const run = await launch(t, BRIDGE_BAR);
  if (!run) return;
  const { top, desk } = run;
  try {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r6"]');
    await desk.click('[data-act="workspace"]');
    const frame = await (await desk.waitForSelector("#ws-frame")).contentFrame();
    await frame.waitForSelector('#review [data-review-view="2"]');
    await frame.waitForFunction(() => document.documentElement.style.cursor === "crosshair"); // Select mode reached the frame
    // The frame outlines what the pointer is on with a dashed box; nothing else here is dashed.
    const outlined = () => frame.evaluate(() => [...document.querySelectorAll("div")].some((d) => d.style.borderStyle === "dashed"));

    await frame.hover('[data-view="1"] button');
    await frame.waitForFunction(() => [...document.querySelectorAll("div")].some((d) => d.style.borderStyle === "dashed"));
    await frame.hover('#review [data-review-view="2"]');
    await top.waitForTimeout(300);
    assert.equal(await outlined(), false, "a hover on the review bar outlines nothing");

    await frame.click('#review [data-review-view="2"]');
    await top.waitForTimeout(300);
    assert.match(await frame.getAttribute('[data-view="2"]', "class"), /review-shown/, "the bar switched the view");
    assert.equal(await desk.textContent("#ws-side .sel b"), "Nothing selected", "a click on the review bar picks nothing");

    await frame.click('[data-view="2"] button');
    await desk.waitForFunction(() => /Save/.test(document.querySelector("#ws-side .sel b")?.textContent || ""));
    assert.match(await desk.textContent("#ws-side .sel"), /in Billing/, "a click on the design picks it, with its view");
  } finally {
    await run.close();
  }
});
