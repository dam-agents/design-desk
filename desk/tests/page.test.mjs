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

// Requests open on Your turn, which shows only what the viewer may act on. The tests look at
// every request, so they start on Open, as a browser that picked it; TURN_FIRST keeps the default.
const TURN_FIRST = "<script>window.TURN_FIRST = true;</script>";
const OPEN_FIRST = `<script>try { if (!window.TURN_FIRST && !localStorage.getItem("desk-turn")) { localStorage.setItem("desk-turn", "1"); if (!localStorage.getItem("desk-reqFilter")) localStorage.setItem("desk-reqFilter", "open"); } } catch {}</script>`;
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

// md()'s inline rules (docs/desk.md → Writing on the Desk), run on their own: a construct
// never lands inside another's attribute, so no person's text becomes markup.
test("markdown text never becomes an attribute or a handler", () => {
  const esc = page.match(/const esc = [^\n]+/)[0];
  const rules = page.match(/const INLINE = [\s\S]*?\n  };\n/)[0];
  const inline = new Function(`${esc}\n${rules}\nreturn inline;`)();
  const out = inline("![[x](asset:A-1)](https://a/src/onerror=alert(1)//)");
  assert.doesNotMatch(out, /<a\b/, "the link stays text after the picture");
  assert.equal((out.match(/"/g) || []).length % 2, 0);
  assert.match(out, /<img alt="\[x" data-asset="A-1" \/>/);
  assert.equal(inline('**a [b](https://x.test/"q) c** `<i>`'), '<b>a <a href="https://x.test/&quot;q" target="_blank" rel="noopener noreferrer">b</a> c</b> <code>&lt;i&gt;</code>');
  assert.equal(inline("[**b**](https://x.test)"), '<a href="https://x.test" target="_blank" rel="noopener noreferrer"><b>b</b></a>');
});

// A conversation's controls follow `may`, which the server sends with each one: a control the
// thread routes refuse for this reader is never drawn (docs/desk.md → Roles).
test("a conversation shows Reply, Answer, Mark done and Reopen only to a reader who may use them", () => {
  const mayIn = new Function(`${page.match(/const mayIn = [^\n]+/)[0]}\nreturn mayIn;`)();
  assert.deepEqual([mayIn({ may: { reply: false, resolve: true } }, "reply"), mayIn({ may: { reply: true, resolve: false } }, "resolve"), mayIn({ may: { reply: true } }, "reply")], [false, false, true]);
  const controls = { "data-send-reply": "reply", "data-send-form": "reply", "data-reopen": "reply", "data-resolve": "resolve" };
  for (const [attr, move] of Object.entries(controls)) {
    const at = [...page.matchAll(new RegExp(`${attr}="\\$\\{esc\\(th\\.id\\)\\}"`, "g"))].map((m) => m.index);
    assert.ok(at.length > 0, attr);
    // The guard opens the very template the control is in: no other backtick between them.
    for (const i of at) {
      const opened = page.slice(0, page.lastIndexOf("`", i) + 1);
      assert.ok(opened.endsWith(`mayIn(th, "${move}") ? \``), `${attr} at offset ${i} is drawn without mayIn(th, "${move}") right before it`);
    }
  }
});

test("the new option dialog sends on its close, as the page's other dialogs do", () => {
  const f = page.match(/<dialog id="option-dialog">[\s\S]*?<\/dialog>/)?.[0];
  assert.ok(f, "the page has the option-dialog");
  assert.match(f, /<button type="button" class="btn primary" data-close="ok"[^>]*>/);
  assert.match(page, /dlg\.onclose = async \(\) => \{\s*if \(dlg\.returnValue !== "ok"\) \{ resolve\(null\); return; \}\s*const own = [^\n]+\s*const note = f\.note\.value\.trim\(\), base/);
  assert.match(page, /action: "add-option"/);
  assert.match(page, /\/api\/cards\/\$\{c\.id\}\/options`/, "its own pictures go to the options route, nothing drawn");
});

// A stand-in bridge records every call; the server answers just enough for an admin's Desk
// with one shipped change, two weekly digests and two open requests, one of them waiting for
// an answer.
// /api/people as the server builds it: every role, with the default prototype_requesters.
const PEOPLE = JSON.stringify({ people: [{ email: "lead@example.com", role: "admin" }, { email: "pat@example.com", role: "pm" }],
  roles: Object.fromEntries(ROLES.map((r) => [r, abilities(r, ["designer", "pm", "admin"])])), addable: ADDABLE_ROLES });
const BRIDGE = `<script>
window.calls = [];
const change = { id: "ch1", kind: "change", title: "A new header", summary: "From PR #45.", source: { repo: "acme/widgets", pr: 45, url: "https://github.com/acme/widgets/pull/45", author: "dana" } };
const earlier = { id: "d0", kind: "digest", title: "22 Oct – 28 Oct 2026", period: "2026-W44", status: "new" };
const digest = { id: "d1", kind: "digest", title: "29 Oct – 4 Nov 2026", period: "2026-W45", status: "new" };
const requests = [
  { id: "r2", kind: "request", title: "Softer colours", status: "triage", asks: true, by: { agent: true }, origin: { channel: "slack", reporter: "Carla", url: "https://acme.slack.com/archives/C0123ABCD/p1" } },
  { id: "r3", kind: "request", title: "A wider sidebar", status: "triage", by: { agent: true }, origin: { channel: "chat", reporter: "Gita" } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  // failNext fails the next send only: the page polls with GETs every few seconds, and on a
  // slow machine a poll must not take the failure that a dialog's send is to get.
  if (window.failNext && method !== "GET") { window.failNext = false; return { status: 503, contentType: "text/plain", body: "" }; }
  const answer = path === "/api/me" ? { role: "admin", email: "lead@example.com", can: { request: true, close: true, screens: true, add: true, people: true },
      skills: [{ name: "copy", does: "Write the words", on: true }, { name: "brand", does: "Use a saved brand", on: false }] }
    : path === "/api/cards" ? { cards: [change, earlier, digest, ...requests] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/requests" ? { card: { id: "r1" } }
    : path === "/api/product" ? { card: { id: "e1", kind: "element" } }
    : path === "/api/cards/e1" ? { card: { id: "e1", kind: "element", title: "The agent row", status: "building", wanted: { part: "The agent row", where: "", show: "" }, created_by: { email: "lead@example.com", role: "admin" } } }
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
    res.end(r.url === "/desk" ? page.replace("<script>", bridge + OPEN_FIRST + "<script>")
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

    // Requests counts the open ones; amber while one waits for an answer.
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
    assert.equal(await desk.evaluate(() => document.querySelector("#rq-skills").open), false, "the skills start folded");
    assert.equal(await desk.isVisible("#rq-skill-list"), false, "their switches hide until it is opened");
    await desk.click("#rq-skills > summary");
    assert.equal(await desk.isVisible("#rq-skill-list input[data-skill]"), true, "opened, the switches show");
    await desk.click("#request-dialog #type-choice button[data-type=bug]");
    assert.equal(await desk.isVisible("#rq-skills"), false, "a bug offers no skills");
    assert.equal(await desk.isVisible("#rq-vision"), false, "a bug asks for no picture of how it should look");
    assert.equal(await desk.isVisible("#rq-count"), false, "a bug asks for no options");
    assert.equal(await desk.isVisible("#rq-grill"), false, "a bug asks for no questions first");
    await desk.click("#request-dialog #type-choice button[data-type=idea]");
    await rq.button("Send").click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/r1"));
    assert.equal(await rq.open(), false, "Send closes the dialog");
    assert.equal(await desk.getAttribute('[data-tab="requests"]', "aria-current"), "true", "a sent request opens Requests");
    const sent = await posts("/api/requests");
    assert.equal(sent.length, 1);
    assert.equal(JSON.parse(sent[0].body).problem, "Make the send button bigger");
    assert.deepEqual(JSON.parse(sent[0].body).skills, { copy: true, brand: false }, "each switch is sent as it was set");
    assert.deepEqual([JSON.parse(sent[0].body).options, JSON.parse(sent[0].body).grill], [3, false], "three options and no questions unless changed");
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

    // The confirmation dialog, through Close… beside the request's next step.
    const cf = dialog("confirm-dialog"), actions = "/api/cards/r1/actions";
    const closeRequest = async () => {
      assert.equal(await desk.locator('details.more [data-act="close"]').count(), 0, "Close is not under More");
      await desk.click('.next [data-act="close"]');
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
    assert.equal(await desk.locator('[data-card="d1"]').count(), 0, "a digest is not in Changes");
    await desk.click('[data-tab="product"]');
    await desk.click('[data-filter="productFilter:history"]');
    assert.equal(await desk.locator('.row.item:has([data-card="d1"]) .meta').count(), 0, "a digest is in Product → History, with no chips under it");
    assert.deepEqual(await desk.$$eval("#list .row.item .open", (els) => els.map((e) => e.dataset.card)), ["d1", "d0"], "History lists the newest week first");
    await desk.click('[data-filter="productFilter:screens"]');
    await desk.click('[data-tab="new"]');
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

    // Beside the list the list is the way back; where the list hides, an open item keeps its
    // way back on screen (the browser's Back leaves the Desk). An issue or pull request
    // number links to it.
    assert.equal(await desk.isVisible(".crumb [data-back]"), false, "beside the list, no back button");
    const frameWidth = (w) => top.evaluate((px) => { document.querySelector("iframe").style.width = px; }, w);
    await frameWidth("600px");
    await desk.waitForSelector(".crumb [data-back]", { state: "visible" }); // an open item shows its way back where the list hides
    assert.equal(await desk.getAttribute(".lead a", "href"), "https://github.com/acme/widgets/pull/45", "PR #45 links to its pull request");
    await desk.click(".crumb [data-back]");
    assert.equal(await desk.locator(".crumb").count(), 0, "Back closes the item");
    await frameWidth("1000px");

    // Every row in Changes and Requests says where it came from and who started it; its
    // links go to the source, the rest of the row opens the item.
    assert.match(await desk.textContent('.row.item:has([data-card="ch1"]) .prov'), /from: PR #45.*by: dana/);
    assert.doesNotMatch(await desk.textContent('.row.item:has([data-card="ch1"]) .prov'), /Automatic|shipped|↗/, "a change's row names its PR and author only");
    await desk.click('[data-tab="requests"]');
    const prov = '.row.item:has([data-card="r2"]) .prov';
    assert.match(await desk.textContent(prov), /from: Slack.*by: Carla/);
    assert.match(await desk.textContent('.row.item:has([data-card="r3"]) .prov'), /Chat with Design Desk.*by: Gita/, "the reporter is the author whatever the channel");
    assert.equal(await desk.getAttribute(`${prov} a`, "href"), "https://acme.slack.com/archives/C0123ABCD/p1", "the source links to the thread");
    await desk.click('.row.item:has([data-card="r2"]) .t', { force: true });
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
    assert.deepEqual(await desk.locator("table.people tbody tr").allInnerTexts(), ["lead@example.com you\tadmin", "pat@example.com\tPM"]);
    assert.deepEqual((await desk.locator(".roles h4").allInnerTexts()).map((t) => t.replace(/\s+/g, " ")), ["admin your role", "designer", "PM", "lead developer", "developer", "viewer"]);
    const panel = (i) => desk.locator(".roles .panel").nth(i).innerText();
    assert.match(await panel(0), /Everything a designer and a lead developer can, and:\s+See Designs[^\n]*\s+Ask Design Desk to add people to the list/, "only an admin adds people; Designs is a developer's, an admin's too");
    assert.doesNotMatch(await panel(1), /See Designs/, "a designer has no Designs in the menu");
    assert.doesNotMatch(await panel(0), /Move a request/, "moving a request between the tabs is named once, under a lead developer");
    assert.match(await panel(1), /Everything a PM can, and:\s+Approve designs[\s\S]*Add a decision/, "a role names the largest one below it");
    assert.doesNotMatch(await panel(1), /Move a request|Build live prototypes/, "a designer's card does not repeat a PM's");
    assert.match(await panel(2), /Everything a developer can, except Designs, and:\s+Close, reopen and delete requests\s+Approve or decide a request straight away[^\n]*\s+Build live prototypes/, "a PM moves a request along, under a designer; Designs stays a developer's");
    assert.doesNotMatch(await panel(2), /Approve designs|Choose what|Record a decision/, "approving against a decision stays a designer's");
    assert.match(await panel(3), /Everything a developer can, and:\s+Mark changes and issues For Developers handled\s+Move a request, a change or an issue to For Developers/, "a lead developer says what is For Developers");
    assert.match(await panel(4), /Everything a viewer can, and:\s+Vote on options[\s\S]*Start design options[\s\S]*Add a missing screen/, "a developer starts and changes, a designer decides");
    assert.doesNotMatch(await panel(4), /Approve designs|Choose what|Record a decision/);
    assert.match(await panel(4), /See Designs: ask a design's designer, mark it done/, "a developer sees Designs");
    assert.doesNotMatch(await panel(5), /Everything|Same as/, "the smallest role lists its own");

    // An admin asks Design Desk to add a person with a role; the roles to pick leave out admin.
    const pe = dialog("person-dialog");
    await desk.click("[data-add-person]");
    assert.equal(await pe.open(), true);
    assert.deepEqual(await desk.locator("#pe-roles input").evaluateAll((xs) => xs.map((x) => x.value)), ["designer", "pm", "lead-developer", "developer"]);
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
  { id: "c4", kind: "change", title: "Seen, and suggested", acked: true, suggested: { note: "A new pattern" }, attention: { level: "designer", reasons: ["its own grey", "Suggested for the presentation"] } },
  { id: "r1", kind: "request", title: "Calmer empty list", status: "feedback", attention: { level: "designer", reasons: ["Options are ready: pick one or ask for changes"] } },
  { id: "r2", kind: "request", title: "Bigger send button", status: "triage" },
  { id: "r3", kind: "request", title: "Shipped and worth showing", status: "handed-off", suggested: { note: "Worth showing" }, attention: { level: "designer", reasons: ["Suggested for the presentation"] } },
];
window.platform = { async request({ path }) {
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { request: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE} : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

// Requests open on Your turn: what the viewer may act on, here a vote not given yet.
test("Requests open on Your turn, and a vote given takes the request out of it", (t) => open(t, TURN_FIRST + LIST.replace("can: { request: true }", "can: { request: true, vote: true }"), async (desk) => {
  await desk.waitForSelector("#list .filters");
  assert.match(await desk.textContent("#list .filters .on"), /^Your turn\s*1$/, "the default, with its count");
  assert.deepEqual(await desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card)), ["r1"], "Team feedback waits for this viewer's vote");
}));
test("Your turn leaves out a request the viewer voted on", (t) => open(t, TURN_FIRST + LIST.replace("can: { request: true }", "can: { request: true, vote: true }").replace('status: "feedback",', 'status: "feedback", voted_mine: true,'), async (desk) => {
  await desk.waitForSelector("#list .filters");
  assert.deepEqual(await desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card)), []);
}));

// The page at the top level, so its browser storage survives a reload.
async function open(t, bridge, fn) {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const server = createServer((r, res) => { res.setHeader("content-type", "text/html"); res.end(page.replace("<script>", bridge + OPEN_FIRST + "<script>")); });
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

// A viewer, with no choice saved: simple mode until they switch it off in their menu.
const VIEWER = `<script>
window.posts = [];
window.platform = { async request({ method, path, body }) {
  if (method === "POST") { posts.push({ path, body }); return { status: 200, contentType: "application/json", body: JSON.stringify(path === "/api/prefs" ? { theme: null, simple: JSON.parse(body).simple } : {}) }; }
  const answer = path === "/api/me" ? { role: "guest", email: "v@example.com", key: "v@example.com", simple: null, can: {} }
    : path === "/api/cards" ? { cards: [] } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE} : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a viewer starts in simple mode; the switch in their menu shows it and keeps their choice on the Desk", (t) => open(t, VIEWER, async (desk) => {
  await desk.waitForSelector("#nav [data-tab]");
  const tabs = () => desk.$$eval("#nav [data-tab]", (xs) => xs.map((x) => x.dataset.tab));
  assert.deepEqual((await tabs()).filter((k) => ["issues", "product", "people"].includes(k)), [], "Issues, Product and People are hidden");
  assert.equal(await desk.getAttribute("#simple", "aria-pressed"), "true", "the switch says it is on");
  assert.equal(await desk.locator("header > #simple").count(), 0, "the switch sits in the menu under the person's name");
  await desk.click("#me");
  await desk.click("#simple");
  assert.equal(await desk.getAttribute("#simple", "aria-pressed"), "false");
  assert.ok((await tabs()).includes("product"), "full mode shows them again");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/prefs"));
  assert.deepEqual(await desk.evaluate(() => posts.filter((p) => p.path === "/api/prefs").map((p) => JSON.parse(p.body))), [{ simple: false }], "saved for this person");
}));

// LIST, and each of its cards opens.
const OPENS = LIST.replace('path === "/api/cards" ? { cards }', 'path === "/api/cards" ? { cards } : path.startsWith("/api/cards/") ? { card: cards.find((c) => c.id === path.split("/")[3]) }');

test("every tab but How it works shows its intro in the empty pane; People beside its list", (t) => open(t, OPENS, async (desk) => {
  const intro = "#detail .intro";
  await desk.waitForSelector(`${intro}[data-intro="requests"]`);
  assert.equal(await desk.locator("#banners .intro").count(), 0, "no intro under the menu");
  assert.match(await desk.textContent(intro), /Step by step/);
  assert.equal(await desk.locator(`${intro} figure.flow`).count(), 1, "the process is drawn first");
  assert.doesNotMatch(await desk.textContent(intro), /What you see here|not with your role/, "the steps of the process, never a tour of the screen");
  assert.doesNotMatch(await desk.textContent(`${intro} ol.steps`), /👍/, "an action the role may not do is left out");
  assert.match(await desk.textContent(`${intro} ol.steps li.mine`), /You can:[\s\S]*New request/, "a step the person acts in lists their buttons");
  for (const tab of ["new", "issues", "product"]) {
    await desk.click(`[data-tab="${tab}"]`);
    await desk.waitForSelector(`${intro}[data-intro="${tab}"]`);
  }
  await desk.click('[data-tab="people"]');
  await desk.waitForSelector("#detail > .guide");
  assert.equal(await desk.locator("#detail .intro").count(), 0, "People has no intro: its roles say what each may do");
  // Folding one intro folds every tab's, and it stays folded after a reload.
  await desk.click('[data-tab="requests"]');
  await desk.click(`${intro} > summary`);
  await desk.reload();
  await desk.waitForSelector(`${intro}[data-intro="requests"]`, { state: "attached" });
  assert.equal(await desk.$eval(intro, (d) => d.open), false, "a folded intro stays folded");
  await desk.click(`${intro} > summary`);
  await desk.click("#me");
  await desk.click('#help');
  assert.equal(await desk.locator(intro).count(), 0, "How it works is all intro");
  assert.equal(await desk.getAttribute("#help", "aria-current"), "true", "How it works opens from the menu under your name");
  assert.equal(await desk.locator('#detail .guide figure.flow svg[role="img"][aria-label] title').count(), 3, "How it works draws a request, an issue and a shipped change");
  assert.ok(await desk.locator("#detail .guide .process ol.steps").count() >= 4, "each process in How it works has its steps, a design's changes too");
  const guideActs = await desk.$$eval("#detail .guide .process .acts", (els) => els.map((e) => e.textContent).join(" "));
  assert.match(guideActs, /New request/, "How it works lists the buttons the person may press");
  assert.doesNotMatch(guideActs, /👍/, "and none their role may not");
  await desk.click('[data-tab="new"]');
  await desk.click("#list .row .open");
  await desk.waitForSelector("#detail .crumb", { state: "attached" });
  assert.equal(await desk.locator(intro).count(), 0, "an open item takes the pane");
}));

test("every button and label says on hover what it does or means", (t) => open(t, OPENS, async (desk) => {
  // A tooltip takes the title away: a button with no words in it keeps it as its aria-label.
  const unnamed = () => desk.$$eval("button", (els) => els.filter((e) => e.getClientRects().length && !/[\p{L}\p{N}]/u.test(e.textContent) && !e.getAttribute("aria-label")).map((e) => e.outerHTML.slice(0, 120)));
  // A list row's own button covers its card and says nothing: its labels and links say theirs.
  const bare = () => desk.$$eval("button, a.btn, summary.btn, .chip", (els) => els.filter((e) => e.getClientRects().length && !e.title && !e.dataset.tip && !e.matches(".row.item > .open")).map((e) => e.outerHTML.slice(0, 120)));
  const rowSays = () => desk.$$eval("#list .row.item > .open", (els) => els.filter((e) => e.title || e.dataset.tip).map((e) => e.outerHTML.slice(0, 120)));
  await desk.waitForSelector("#detail .intro");
  for (const tab of ["requests", "new", "issues", "product", "people"]) {
    await desk.click(`[data-tab="${tab}"]`);
    await desk.waitForSelector(tab === "people" ? "#detail > .guide" : `#detail [data-intro="${tab}"]`);
    assert.deepEqual(await bare(), [], `${tab}: everything has a title`);
    assert.deepEqual(await rowSays(), [], `${tab}: a card's own button in the list shows no line over the whole card`);
    assert.deepEqual(await unnamed(), [], `${tab}: a button with no words keeps a name`);
    if (tab === "requests") {
      await desk.click("#me");
      await desk.hover("#help");
      assert.equal(await desk.$("#tip"), null, "not at once");
      await desk.waitForSelector("#tip");
      assert.equal(await desk.textContent("#tip"), "How Design Desk works, with a picture of each flow", "the Desk's own tooltip shows after half a second");
      assert.equal(await desk.getAttribute("#help", "title"), null, "the browser's slow one does not");
      await desk.press("body", "Escape");
    }
    if (await desk.locator("#list .row .open").count()) {
      await desk.click("#list .row .open");
      await desk.waitForSelector("#detail .crumb", { state: "attached" });
      assert.deepEqual(await bare(), [], `${tab}, an open item: everything has a title`);
      assert.deepEqual(await unnamed(), [], `${tab}, an open item: a button with no words keeps a name`);
    }
  }
}));

test("Needs a designer filters Changes, Your turn filters Requests, and Changes opens on Open", (t) => open(t, LIST, async (desk) => {
  const rows = async () => { await desk.waitForSelector("#list .filters"); return desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card)); };
  // Requests leads the menu; Changes and Issues follow, then Product and People.
  await desk.waitForSelector('[data-tab="requests"][aria-current="true"]');
  assert.deepEqual(await desk.$$eval("#nav button", (bs) => bs.map((b) => b.dataset.tab)), ["requests", "new", "issues", "product", "people"], "the Desk opens on Requests");
  assert.match(await desk.textContent('[data-tab="new"]'), /^PR Changes/);
  await desk.click('[data-tab="new"]');
  assert.deepEqual(await rows(), ["c1", "c3", "c4"], "Changes opens on Open: none is handled, and the fyi change is auto handled");
  assert.match(await desk.textContent("#list .filters .on"), /^Open \d+$/, "Open carries its count");
  assert.equal(await desk.locator('[data-filter="newFilter:all"]').count(), 0, "there is no All");
  await desk.click('[data-filter="newFilter:auto"]');
  assert.deepEqual(await rows(), ["c2"], "Design Desk found nothing to look at: auto handled at once");
  await desk.click('[data-filter="newFilter:designer"]');
  assert.deepEqual(await rows(), ["c1", "c4"], "only what waits for a designer: not what you saw, unless it is suggested");
  assert.doesNotMatch(await desk.textContent("#list"), /Needs a designer:/, "the rows carry no Needs a designer chip");
  await desk.click('[data-tab="requests"]');
  assert.deepEqual(await desk.$$eval("#list .filters [data-filter]", (bs) => bs.map((b) => b.dataset.filter)), ["reqFilter:turn", "reqFilter:unread", "reqFilter:open", "reqFilter:closed"], "Requests filter by Your turn, Unread, Open and Closed");
  assert.match(await desk.textContent('[data-filter="reqFor:presentation"]'), /^For presentation/);
  await desk.click('[data-filter="reqFilter:turn"]');
  assert.deepEqual(await rows(), [], "Your turn: this viewer may neither vote nor approve");
  assert.match(await desk.textContent("#list"), /Nothing waits for you right now/);
  assert.match(await desk.textContent('[data-filter="reqFilter:turn"]'), /^Your turn$/);
  await desk.reload();
  await desk.click('[data-tab="new"]');
  assert.deepEqual(await rows(), ["c1", "c4"], "the filter you picked is kept");
}));

// A request's presentation actions sit under More, and stay there once the request is closed
// (docs/desk.md → The presentation): Add and Take off each send their call; Not now sits by the
// suggestion on the Presentation page.
const CALL = `<script>
window.calls = [];
const cards = [
  { id: "C-4", kind: "request", title: "Shipped, on the call", status: "handed-off", agenda: { status: "queued", by: { email: "d@example.com" } } },
  { id: "C-5", kind: "request", title: "Shipped, suggested", status: "handed-off", call_suggestion: { note: "Worth showing" }, suggested: { note: "Worth showing" } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { queue: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a closed request keeps Add to presentation and Take off under More; Not now is on the Presentation", (t) => open(t, CALL, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  const more = async (id) => {
    if (!desk.url().endsWith(`#${id}`)) await desk.goto(`${base}#${id}`);
    await desk.waitForFunction((n) => document.querySelector("#detail h2 .num")?.textContent === n, id);
    await desk.waitForSelector("#detail details.more", { state: "attached" });
    await desk.evaluate(() => { document.querySelector("#detail details.more").open = true; });
  };
  const sent = (method, path) => desk.waitForFunction(([m, p]) => calls.some((c) => c.method === m && c.path === p), [method, path]);

  await more("C-5");
  assert.doesNotMatch(await desk.textContent("#detail"), /suggests it for the presentation/, "no suggestion strip on the card");
  assert.equal(await desk.locator('#detail [data-act="not-now"]').count(), 0, "Not now is not under More");
  await desk.goto(`${base}#presentation`);
  await desk.click('#detail [data-not-now="C-5"]');
  await sent("DELETE", "/api/cards/C-5/suggestion");
  await more("C-5");
  await desk.click('#detail [data-act="queue"]');
  await desk.click("#cf-ok");
  await sent("POST", "/api/cards/C-5/agenda");

  await more("C-4");
  assert.match(await desk.textContent("#detail .sub"), /On the presentation/);
  assert.equal(await desk.locator('#detail [data-act="queue"]').count(), 0, "a queued request offers no second Add");
  await desk.click('#detail [data-act="unqueue"]');
  await sent("DELETE", "/api/cards/C-4/agenda");
}));

// Every item has a number by its title; a link with it, or Go to, opens the item in its tab
// (on the presentation for #presentation/C-n while it is on it); a number in text links to that item
// (docs/desk.md → Links to an item).
const LINKS = `<script>
window.copied = [];
Object.defineProperty(navigator, "clipboard", { value: { async writeText(t) { copied.push(t); } } });
const cards = [
  { id: "C-1", kind: "change", title: "A new header", acked: true, summary: "Follows C-2; nothing to do with C-99.", source: { repo: "acme/widgets", pr: 45, url: "https://github.com/acme/widgets/pull/45" } },
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
  // The Desk opens on Requests; the change C-1 is under Changes.
  await desk.click('[data-tab="new"]');
  await desk.waitForSelector('.row.item:has([data-card="C-1"]) .num');
  assert.equal(await desk.textContent('.row.item:has([data-card="C-1"]) .num'), "C-1", "each row shows its number");

  await desk.goto(`${base}#C-3`);
  assert.equal(await shown("requests", "Closed one"), "C-3", "a link opens the item in its own tab");
  assert.match(await desk.textContent("#list .filters .on"), /Closed/, "with a filter that shows it");
  const [num, title] = await desk.$eval("#detail h2", (h) => [getComputedStyle(h.querySelector(".num")).color, getComputedStyle(h).color]);
  assert.notEqual(num, title, "the number is grey, not the title's colour");
  await desk.click("#detail h2 [data-copy-link]");
  await desk.waitForFunction(() => copied.length === 1);
  assert.deepEqual(await desk.evaluate(() => copied), ["https://share.example.com/a/xY12#C-3"]);

  await desk.fill("#goto", "c 1");
  await desk.press("#goto", "Enter");
  assert.equal(await shown("new", "A new header"), "C-1", "Go to takes the number");
  assert.equal(await desk.locator('#detail a[data-ref="C-2"]').count(), 1, "a number in text links to that item");
  assert.equal(await desk.locator('#detail a[data-ref="C-99"]').count(), 0, "a number the Desk does not have stays text");
  await desk.click('#detail a[data-ref="C-2"]');
  assert.equal(await shown("requests", "Calmer empty list"), "C-2");

  await desk.goto(`${base}#presentation/C-2`);
  await desk.reload();
  assert.equal(await shown("requests", "Calmer empty list"), "C-2", "a link to the presentation opens it there, also on a fresh load");
  assert.match(await desk.textContent("#list .subtabs .on"), /^For presentation\s*1$/, "on the presentation page, a tab of Requests");
  assert.equal(await desk.locator("#list .filters").count(), 0, "the presentation has no filter of its own");
  await desk.click("#detail h2 [data-copy-link]");
  await desk.waitForFunction(() => copied.length === 1);
  assert.deepEqual(await desk.evaluate(() => copied), ["https://share.example.com/a/xY12#presentation/C-2"]);
  await desk.setViewportSize({ width: 600, height: 800 });
  await desk.click("[data-back]");
  await desk.waitForFunction(() => document.querySelector("#detail h2")?.textContent === "Presentation");
  await desk.setViewportSize({ width: 1280, height: 720 });

  await desk.goto(`${base}#call/C-3`);
  assert.equal(await shown("requests", "Closed one"), "C-3", "an older #call link still works; an item that is not on the presentation opens in its own tab");

  await desk.fill("#goto", "https://share.example.com/a/xY12#C-99");
  await desk.press("#goto", "Enter");
  await desk.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => /nothing numbered C-99/.test(t.textContent)));

  // The header's search: words over every item, a GitHub number, and a number the Desk has no card for.
  await desk.fill("#goto", "calmer");
  await desk.waitForSelector('#hits .hit[data-hit="C-2"]');
  await desk.press("#goto", "Enter");
  assert.equal(await shown("requests", "Calmer empty list"), "C-2", "Enter opens the first hit");
  await desk.fill("#goto", "#45");
  await desk.waitForFunction(() => /Pull request #45 on GitHub/.test(document.querySelector('#hits .hit[data-hit="C-1"]')?.textContent || ""));
  await desk.click('#hits .hit[data-hit="C-1"]');
  assert.equal(await shown("new", "A new header"), "C-1", "a GitHub pull request number finds its change");
  assert.equal(await desk.isHidden("#hits"), true, "the hits close once one opens");
}));

// The presentation (docs/desk.md → The presentation): a designer marks an item presented in
// the list and while presenting; Undo takes back one of today, never one of an earlier meeting.
const PRESENTATION = `<script>
window.calls = [];
const hour = 36e5, iso = (ms) => new Date(Date.now() - ms).toISOString();
const queued = { status: "queued", by: { email: "d@example.com" }, at: iso(2 * hour), variant: null, brief: "Pick one." };
const cards = [
  { id: "C-2", kind: "request", title: "Calmer empty list", status: "triage", agenda: queued },
  { id: "C-4", kind: "request", title: "Presented today", status: "triage", agenda: { ...queued, status: "presented", call: iso(hour), undo_until: iso(-hour) } },
  { id: "C-5", kind: "request", title: "Presented last week", status: "triage", agenda: { ...queued, status: "presented", call: iso(7 * 24 * hour), undo_until: iso(7 * 24 * hour - 2 * hour) } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { close: true, queue: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [cards[0]], presented: [cards[1], cards[2]] }
    : method === "GET" && one ? { card: one } : { card: cards[0] };
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("the presentation: mark an item presented, in the list and while presenting; Undo only for today's", (t) => open(t, PRESENTATION, async (desk) => {
  const sent = (path) => desk.evaluate((p) => calls.filter((c) => c.method === "POST" && c.path === p).map((c) => JSON.parse(c.body)), path);
  await desk.goto(desk.url().replace(/#.*$/, "") + "#presentation");
  await desk.reload();
  await desk.waitForFunction(() => document.querySelector("#detail h2")?.textContent === "Presentation");
  assert.match(await desk.textContent("#list"), /To present[\s\S]*Calmer empty list[\s\S]*Presented[\s\S]*Presented today[\s\S]*Presented last week/, "the queue, then what was presented");

  await desk.click('#detail [data-presented="C-2"]');
  await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/C-2/presented"));
  assert.deepEqual(await sent("/api/cards/C-2/presented"), [{ presented: true }]);

  await desk.click('#list [data-card="C-4"]');
  await desk.waitForSelector('#detail [data-unpresent="C-4"]', { state: "attached" });
  await desk.evaluate(() => { document.querySelector("#detail details.more").open = true; });
  await desk.click('#detail [data-unpresent="C-4"]');
  await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/C-4/presented"));
  assert.deepEqual(await sent("/api/cards/C-4/presented"), [{ presented: false }], "Undo sends presented: false");

  // Beside the list, the list is the way back.
  await desk.click('#list [data-card="C-5"]');
  await desk.waitForFunction(() => document.querySelector("#detail h2")?.textContent.startsWith("Presented last week"));
  assert.equal(await desk.locator("#detail [data-unpresent]").count(), 0, "no Undo for an earlier meeting's item");
  assert.equal(await desk.locator('#detail [data-act="queue"]').count(), 1, "it can go on again, once");

  await desk.click('[data-filter="reqFor:presentation"]');
  await desk.click('#detail [data-present="0"]');
  await desk.click('#present [data-presented="C-2"]');
  await desk.waitForFunction(() => calls.filter((c) => c.path === "/api/cards/C-2/presented").length === 2);
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
  variants: [{ id: "v1", name: "Calm", asset: "A-3", version: 1, states: [{ id: "error", name: "Failed", how: "The message did not go.", part: "Send button", asset: "A-3", shot: "A-1", use: "Someone sends a message while offline.", version: 1 }] }], prototype: { state: "none" },
  threads: [{ id: "t1", kind: "asks", state: "open", step: "build", messages: [{ by: { agent: true }, at: created, text: "Two things." }],
    questions: [{ text: "Empty list?", options: ["A hint", "Nothing"], suggested: "A hint" }, { text: "Button words?", options: ["Send", "Send message"] }] }] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", due_days: 21, can: { handle: true, build: true, comment: true, ask: true, revise: true } }
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
    assert.equal(await desk.locator(`${row} .meta`).count(), 0, "a row is its title and one line: no chips");
    const rows = () => desk.$$eval("#list .row .open", (rs) => rs.map((r) => r.dataset.card));
    assert.deepEqual(await rows(), ["ch2"], "Open, the default, lists only the changes nobody marked handled");
    await desk.click('[data-filter="newFilter:handled"]');
    assert.deepEqual(await rows(), ["ch3", "ch4"], "Handled lists the rest");
    assert.doesNotMatch(await desk.getAttribute('.row.item:has([data-card="ch3"])', "class"), /overdue/, "a handled change is not overdue");
    await desk.click('[data-filter="newFilter:designer"]');
    assert.deepEqual(await rows(), [], "a handled change leaves Needs a designer");
    await desk.click('[data-filter="newFilter:open"]');
    await desk.click('[data-card="ch2"]');
    await desk.waitForSelector("[data-handle]");
    assert.equal(await desk.getAttribute(".sec-head .chip a", "href"), "https://github.com/acme/widgets/pull/11", "a section links its source");
    assert.equal(await desk.locator("details.sec").count(), 1, "the explaining section can fold, what changed cannot");
    assert.equal(await desk.locator("details.sec[open]").count(), 1, "a short explaining section shows open");
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
    // ch4 is handled: it is listed under Handled.
    await desk.click('[data-filter="newFilter:handled"]');
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
    await desk.click('[data-filter="newFilter:open"]');
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

    // Every state of a part: under All elements, an option drawn before it listed elements shows
    // the part its states draw; it opens in a dialog with each state, a picture of the part alone
    // with the use case it covers, and which option it is of.
    const cf = (name) => desk.locator("#confirm-dialog .actions button", { hasText: name });
    assert.equal(await desk.locator('#detail [data-act="states"]').count(), 0, "the card has no Draw every state");
    assert.match(await desk.textContent("#detail .elements"), /All elements[\s\S]*Send button[\s\S]*1 state/);
    // A tile keeps white space around its picture, inside the same 192 px.
    assert.deepEqual(await desk.$eval('#detail [data-el="part-send-button"] .elpic', (e) => { const c = getComputedStyle(e); return [c.paddingTop, c.paddingLeft, e.getBoundingClientRect().height]; }), ["10px", "10px", 192], "a tile pads its picture");
    await desk.click('#detail [data-el="part-send-button"]');
    await desk.waitForSelector("#element-dialog[open] .catalog");
    assert.match(await desk.textContent("#element-dialog"), /Send button[\s\S]*Calm · version 1[\s\S]*Failed[\s\S]*The message did not go\.[\s\S]*Use case it covers[\s\S]*Someone sends a message while offline\./);
    assert.equal(await desk.getAttribute('#element-dialog .catalog [data-zoom] img', "data-asset"), "A-1");
    await desk.click("#element-dialog [data-el-close]");
    await desk.waitForSelector('.vbar [data-act="workspace"]');
    await desk.click('.vbar [data-act="workspace"]');
    await desk.click('[data-ws-state="error"]');
    assert.match(await desk.textContent("#ws-states"), /Send button[\s\S]*State 1 of 1[\s\S]*Failed: The message did not go\./);
    await desk.click('[data-ws-step="1"]');
    assert.match(await desk.textContent("#ws-states"), /1 state\b/, "the step goes back round to the option");
    await desk.click("[data-ws-close]");

    // Build opens the final check of the only option: it builds exactly the version it
    // shows, and asks first unless the designer unticks it.
    await desk.click('[data-act="build"]');
    await desk.waitForSelector("[data-ws-build]");
    assert.match(await desk.textContent("#ws-top"), /Final check: Calm goes live[\s\S]*version 1/);
    assert.equal(await desk.isChecked("#ws-ask-first"), true, "Ask me first is ticked");
    await desk.click("[data-ws-build]");
    assert.deepEqual(await sent("/api/cards/r2/actions", 1), { action: "build", note: "v1", variant: "v1", version: 1, states: { error: 1 }, ask_first: true });
    await desk.waitForSelector('[data-act="build"]');
    assert.equal(await desk.isVisible("#workspace"), false, "the check closes once it is sent");
    await desk.click('[data-act="build"]');
    await desk.uncheck("#ws-ask-first");
    await desk.click('[data-ws-state="error"]');
    assert.equal(await desk.isChecked("#ws-ask-first"), false, "a step to a state keeps the unticked box");
    await desk.click("[data-ws-build]");
    assert.equal((await sent("/api/cards/r2/actions", 2)).ask_first, false);

    // An option against a decision in force goes live only knowingly: Build it live asks first,
    // refuses an unticked box, and sends the confirmation (docs/desk.md → Decisions → The check).
    await desk.evaluate(() => { request.conflicts = [{ decision: "D-9", why: "The button shouts.", status: "active", text: "Buttons stay quiet", variant: "v1" }]; });
    await desk.click('[data-card="r2"]');
    await desk.waitForSelector('#detail .against');
    await desk.click('[data-act="build"]');
    await desk.waitForSelector("[data-ws-build]");
    await desk.click("[data-ws-build]");
    await desk.waitForSelector("#confirm-dialog[open]");
    assert.match(await desk.textContent("#confirm-dialog"), /Calm goes against D-9/);
    await cf("Build it live").click();
    await desk.waitForSelector("#confirm-dialog[open] .toast", { state: "attached" });
    assert.equal(await desk.evaluate(() => calls.filter((c) => c.method === "POST" && c.path === "/api/cards/r2/actions").length), 2, "nothing goes while the box is unticked");
    await desk.check("#confirm-form [name=check]");
    await cf("Build it live").click();
    assert.equal((await sent("/api/cards/r2/actions", 3)).overrule, true);
  } finally {
    await run.close();
  }
});

// A request's page: what was asked, with the pictures a person pasted, boxed apart from
// what Design Desk made; a link to an issue shows its preview on hover, on its row too.
// A request with a note on an element, a change citing it, and decisions in force and revoked.
const PEEKS = `<script>
const cards = [
  { id: "C-1", kind: "change", title: "A new header", acked: true, summary: "Follows C-2 and D-1.", source: { repo: "acme/widgets", pr: 45 } },
  { id: "C-2", kind: "request", title: "Calmer empty list", status: "feedback", summary: "The list is too loud.", request: { problem: "Too loud. It uses the brightest colour of the product and a big illustration, so people who have nothing to do yet think something broke. Two of them said so in last week's interviews, and support hears it every month. We would like it calm, small and plain, with one quiet line on what comes next." },
    research: { summary: "The empty list was drawn in 2024 for the launch. It uses the brightest colour of the product and a big illustration, so people who have nothing to do yet think something broke. Two of them said so in last week's interviews, and support hears it every month. We would like it calm, small and plain, with one quiet line on what comes next.", links: [] },
    variants: [{ id: "v1", name: "Quiet", asset: "A-1", version: 1 }],
    threads: [{ id: "t1", card: "C-2", kind: "comment", state: "open", anchor: { variant: "v1", selector: "#kit", text: "Kit <\\/script> update", label: "Text" },
      messages: [{ by: { name: "Pat" }, at: "2026-11-01T10:00:00Z", text: "Too bright here." }] }] },
];
const decisions = [{ id: "D-1", text: "Search sits in the header", status: "active", side: "design", at: "2026-10-01T00:00:00Z", concepts: [] },
  { id: "D-2", text: "One primary button", status: "revoked", side: "design", at: "2026-10-02T00:00:00Z", concepts: [] }];
window.platform = { async request({ path }) {
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { vote: true, change: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] }
    : path.startsWith("/api/decisions/") ? { decision: decisions.find((d) => d.id === path.slice(15)) }
    // The Decisions page asks for those in force; a prefix search asks for every one.
    : path.startsWith("/api/decisions") ? { decisions: /state=(&|$)/.test(path) ? decisions : decisions.filter((d) => d.status === "active") }
    : path === "/api/assets/A-1" ? { id: "A-1", contentType: "text/html", encoding: "utf8", data: '<body><h1>List</h1><button id="kit">Kit</button></body>' }
    : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("numbers, notes and pins preview what they name; the search lists every number as typed; the request's text shows whole the first time, folded after", (t) => open(t, PEEKS, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#C-1`);
  await desk.waitForSelector('#detail a[data-ref="D-1"]');
  await desk.hover('#detail a[data-ref="C-2"]');
  assert.equal(await desk.$("#peek"), null, "not at once");
  await desk.waitForSelector("#peek");
  assert.match(await desk.textContent("#peek"), /Calmer empty list[\s\S]*The list is too loud/, "an item's number previews the item");
  await desk.mouse.move(0, 0);
  await desk.hover('#detail a[data-ref="D-1"]');
  await desk.waitForFunction(() => /Search sits in the header/.test(document.querySelector("#peek")?.textContent || ""));
  assert.match(await desk.textContent("#peek"), /In force/, "a decision's number previews the decision");
  await desk.mouse.move(0, 0);

  await desk.fill("#goto", "D-");
  await desk.waitForFunction(() => document.querySelectorAll("#hits .hit").length === 2);
  assert.match(await desk.textContent("#hits"), /One primary button/, "the prefix search lists revoked decisions too");
  await desk.fill("#goto", "C-");
  await desk.waitForFunction(() => document.querySelectorAll("#hits .hit").length === 2);
  await desk.fill("#goto", "");

  await desk.goto(`${base}#C-2`);
  await desk.waitForSelector(".brief:not(.clamped) [data-brief-toggle]");
  assert.equal(await desk.locator(".top2 > .brief.clamped").count(), 0, "the first visit shows the request and what Design Desk found whole");
  await desk.click("[data-brief-toggle]");
  await desk.waitForSelector(".brief.clamped");
  assert.deepEqual(await desk.evaluate(() => JSON.parse(localStorage.getItem("desk-seen-requests"))), ["C-2"], "the browser keeps that it was seen");
  await desk.goto(`${base}#C-1`);
  await desk.waitForSelector('#detail a[data-ref="D-1"]');
  await desk.goto(`${base}#C-2`);
  await desk.waitForFunction(() => document.querySelectorAll(".top2 > .brief").length === 2 && document.querySelectorAll(".top2 > .brief.clamped").length === 2);
  await desk.click(".top2 > .brief:not(.made-col) [data-brief-toggle]");
  await desk.waitForSelector(".top2 > .brief:not(.made-col):not(.clamped)");

  await desk.click("[data-convo] > summary");
  await desk.hover('[data-snip="A-1"]');
  await desk.waitForSelector("#peek.snip iframe");
  const doc = await desk.$eval("#peek.snip iframe", (f) => f.srcdoc);
  assert.match(doc, /"#kit"/, "the note's element is cut from its option by its path");
  assert.equal(doc.match(/<\/script>/g).length, 1, "a note's text cannot end the preview's script");
  await desk.mouse.move(0, 0);

  await desk.click('[data-act="workspace"]');
  await desk.waitForSelector("#ws-frame");
  const pin = (data) => desk.evaluate((d) => { const f = document.querySelector("#ws-frame"); dispatchEvent(new MessageEvent("message", { data: d, source: f.contentWindow })); }, data);
  await pin({ type: "desk-pin-tip", note: "t1", rect: { left: 40, top: 60, bottom: 72, width: 0 } });
  await desk.waitForSelector("#tip");
  assert.match(await desk.textContent("#tip"), /#1 · Pat: Too bright here\./, "a note's pin shows what the note says");
  await pin({ type: "desk-pin-open", note: "t1" });
  await desk.waitForSelector('[data-ws-note="t1"][aria-current="true"]');
}));

test("a request's brief sits apart from Design Desk's part; an issue link previews the issue", async (t) => {
  const cards = `const issue = { id: "is1", kind: "issue", status: "open", title: "See what each agent spends", bucket: "sprint", summary: "Nobody knows what an agent costs.", needs: ["A spend column in the agents list"],
    source: { repo: "acme/widgets", issue: 41, url: "https://github.com/acme/widgets/issues/41" } };
  const made = { id: "r9", kind: "request", title: "Spend column options", status: "triage", from: "is1", by: { email: "lead@example.com" } };
  const full = { ...made, request: { type: "feature", problem: "Show the spend.", from: "is1", screen: "Agents → list" }, threads: [],
    screens: [{ asset: "a1", caption: "", source: "person" }, { asset: "a2", caption: "How it looks now", source: "instance" }] };`;
  const bridge = BRIDGE.replace("const digest =", `${cards}\nconst digest =`)
    .replace("cards: [change, earlier, digest, ...requests]", "cards: [change, earlier, digest, ...requests, issue, made]")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/cards/r9" ? { card: full }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk } = run;
  try {
    await desk.waitForSelector('[data-tab="requests"]');
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r9"]');
    await desk.waitForSelector("#detail .brief");
    assert.match(await desk.textContent("#detail .brief"), /asked[\s\S]*Show the spend\./);
    assert.deepEqual(await desk.locator("#detail .brief:not(.made-col) figure").evaluateAll((xs) => xs.map((x) => x.dataset.zoom)), ["a1"], "the pasted picture belongs to the request");
    assert.deepEqual(await desk.locator("#detail .made-col figure").evaluateAll((xs) => xs.map((x) => x.dataset.zoom)), ["a2"], "Design Desk's picture sits under its part");
    assert.doesNotMatch(await desk.textContent("#detail"), /Screen: Agents/, "the screen line is gone");

    // The request's steps close on a click outside them and on Escape; a click inside keeps them open.
    const stepsOpen = () => desk.$eval("#detail details.stepper", (d) => d.open);
    await desk.click("#detail details.stepper > summary");
    await desk.click("#detail details.stepper ol");
    assert.equal(await stepsOpen(), true, "a click inside keeps the steps open");
    await desk.click("#detail h2");
    assert.equal(await stepsOpen(), false, "a click outside closes the steps");
    await desk.click("#detail details.stepper > summary");
    await desk.press("body", "Escape");
    assert.equal(await stepsOpen(), false, "Escape closes the steps");

    await desk.hover("#detail .linked .anchor");
    await desk.waitForSelector("#peek");
    assert.match(await desk.textContent("#peek"), /See what each agent spends[\s\S]*This sprint[\s\S]*Issue #41[\s\S]*Nobody knows what an agent costs[\s\S]*A spend column in the agents list/);
    await desk.hover("#detail h2");
    await desk.waitForSelector("#peek", { state: "detached" });

    // In the list the issue's link previews it, never the whole card.
    await desk.click('[data-tab="issues"]');
    await desk.hover('.row.item [data-card="is1"]');
    await desk.waitForTimeout(800);
    assert.equal(await desk.$("#peek"), null, "the card itself shows no preview");
    await desk.hover('.row.item .prov a[href="https://github.com/acme/widgets/issues/41"]');
    await desk.waitForSelector("#peek");
    assert.match(await desk.textContent("#peek"), /A spend column in the agents list/, "the row's issue link, now without its needs, previews them");
  } finally {
    await run.close();
  }
});

// A link to a pull request previews its change like an issue's link: on a request it came
// from, and on the change's own row.
test("a pull request link previews its change", async (t) => {
  const pr = `const fromPr = { id: "r6", kind: "request", title: "Header too tall", status: "triage", origin: { channel: "github", kind: "pr", number: 45, url: "https://github.com/acme/widgets/pull/45", reporter: "dana" } };`;
  const bridge = BRIDGE.replace("const digest =", `${pr}\nconst digest =`)
    .replace("cards: [change, earlier, digest, ...requests]", "cards: [change, earlier, digest, ...requests, fromPr]")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/cards/r6" ? { card: { ...fromPr, threads: [] } }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk } = run;
  try {
    await desk.waitForSelector('[data-tab="requests"]');
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r6"]');
    await desk.hover('#detail a[href="https://github.com/acme/widgets/pull/45"]');
    await desk.waitForSelector("#peek");
    assert.match(await desk.textContent("#peek"), /A new header[\s\S]*PR #45[\s\S]*by dana[\s\S]*From PR #45\./);
    await desk.hover("#detail h2");
    await desk.waitForSelector("#peek", { state: "detached" });

    // Any link to it previews it, whatever follows the number; one the Desk does not know says so.
    await desk.evaluate(() => document.querySelector("#detail h2").insertAdjacentHTML("afterend", '<p><a id="files" href="https://github.com/acme/widgets/pull/45/files">the diff</a> <a id="other" href="https://github.com/acme/widgets/issues/77">issue #77: a calmer list</a></p>'));
    await desk.hover("#files");
    await desk.waitForSelector("#peek");
    assert.match(await desk.textContent("#peek"), /A new header/, "a link past the number previews the change");
    await desk.hover("#other");
    await desk.waitForFunction(() => /a calmer list[\s\S]*Issue #77[\s\S]*acme\/widgets[\s\S]*Not on the Desk/.test(document.querySelector("#peek")?.textContent || ""));

    await desk.click('[data-tab="new"]');
    await desk.hover('.row.item [data-card="ch1"]');
    await desk.waitForTimeout(800);
    assert.equal(await desk.$("#peek"), null, "the change's card itself shows no preview");
    await desk.hover('.row.item .prov a[href="https://github.com/acme/widgets/pull/45"]');
    await desk.waitForSelector("#peek");
    assert.match(await desk.textContent("#peek"), /A new header/, "the change's pull request link in its row previews it");
  } finally {
    await run.close();
  }
});

// Two requests from one issue: each on its own line, and at a phone's width the title cuts
// short so its number and state stay inside the box.
test("two requests from an issue: one line each, inside the box at a phone's width", async (t) => {
  const issues = `const issue = { id: "is1", kind: "issue", status: "open", title: "See what each agent spends", bucket: "sprint", needs: ["A spend column"], sketches: 0,
    source: { repo: "acme/widgets", issue: 41, url: "https://github.com/acme/widgets/issues/41", author: "alice" }, waiting: [], threads: [] };
  const one = { id: "r9", kind: "request", title: "Spend column options for the agents list and its totals", status: "triage", from: "is1", by: { email: "lead@example.com" } };
  const two = { id: "r10", kind: "request", title: "A calmer spend chip", status: "feedback", from: "is1", by: { email: "lead@example.com" } };`;
  const bridge = BRIDGE.replace("const digest =", `${issues}\nconst digest =`)
    .replace("cards: [change, earlier, digest, ...requests]", "cards: [change, earlier, digest, ...requests, issue, one, two]")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/cards/is1" ? { card: issue }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { top, desk } = run;
  try {
    await desk.click('[data-tab="issues"]');
    await desk.click('.row.item [data-card="is1"]');
    await desk.waitForSelector("#detail .linked");
    // The Desk runs in a frame: a phone's width is the frame's.
    await top.$eval("iframe", (f) => { f.style.width = "380px"; });
    await desk.waitForFunction(() => innerWidth <= 380);
    assert.equal(await desk.$eval("#detail .linked", (l) => l.classList.contains("many")), true, "two requests: the list form");
    assert.equal(await desk.locator("#detail .linked .lk").count(), 2, "one line per request");
    const out = await desk.$eval("#detail .linked", (l) => { const box = l.getBoundingClientRect(); return [...l.querySelectorAll(".lk .chip")].filter((c) => c.getBoundingClientRect().right > box.right + 0.5).length; });
    assert.equal(out, 0, "every state chip ends inside the box");
  } finally {
    await run.close();
  }
});

// The Issues tab: the sprint's issues first, what the UI will need in each row, and an
// issue's Draw it and Design this.
test("the Issues tab lists the planned issues; Draw it and Design this act once", async (t) => {
  const issues = `const issue = { id: "is1", kind: "issue", status: "open", title: "See what each agent spends", bucket: "sprint", needs: ["A spend column in the agents list"], sketches: 0,
    source: { repo: "acme/widgets", issue: 41, url: "https://github.com/acme/widgets/issues/41", author: "alice", milestone: "Sprint 12", assignees: ["bob"] }, waiting: [], threads: [] };
  const later = { id: "is2", kind: "issue", status: "open", title: "A calmer empty Home", bucket: "label", needs: ["An empty state on Home"], sketches: 0, source: { repo: "acme/widgets", issue: 40, author: "erin" } };
  const gone = { id: "is3", kind: "issue", status: "archived", title: "Closed", bucket: "sprint", source: { repo: "acme/widgets", issue: 39 } };
  const made = { id: "r9", kind: "request", title: "Spend column options", status: "declined", from: "is1", by: { email: "lead@example.com" } };`;
  const bridge = BRIDGE.replace("const digest =", `${issues}\nconst digest =`)
    .replace("cards: [change, earlier, digest, ...requests]", "cards: [change, earlier, digest, ...requests, issue, later, gone, made]")
    .replace("can: { request: true,", "can: { draw: true, \"follow-up\": true, request: true,")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/cards/is1" ? { card: issue }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk, posts, settled } = run;
  try {
    await desk.waitForSelector('[data-tab="issues"] .count');
    assert.equal(await desk.textContent('[data-tab="issues"] .count'), "2", "the tab counts every open issue: not closed, handled or designed");
    await desk.click('[data-tab="issues"]');
    assert.deepEqual(await desk.$$eval("#list .filters [data-filter]", (bs) => bs.map((b) => b.dataset.filter)), ["issueFilter:all", "issueFilter:sprint", "issueFilter:next", "issueFilter:assigned", "issueFilter:label", "issueFilter:handled"], "All first, then the plan, then Handled; no Designed");
    await desk.click('[data-filter="issueFilter:sprint"]');
    assert.equal(await desk.locator(".row.item").count(), 1, "a closed issue is not listed");
    const row = '.row.item:has([data-card="is1"])';
    assert.match(await desk.textContent(`${row} .prov`), /from: Issue #41.*by: alice.*assigned to bob/);
    assert.equal(await desk.locator(`${row} .s`).count(), 0, "an issue's row carries no description; its page and its preview do");
    assert.match(await desk.textContent(`${row} .prov`), /in: Sprint 12/, "where the team planned it is a word of the line");
    await desk.click('[data-filter="issueFilter:label"]');
    assert.deepEqual(await desk.locator(".row.item [data-card]").evaluateAll((xs) => xs.map((x) => x.dataset.card)), ["is2"]);
    await desk.click('[data-filter="issueFilter:sprint"]');
    await desk.click('[data-card="is1"]');
    await desk.waitForSelector("text=What the UI will need");
    assert.match(await desk.textContent("#detail"), /No picture yet[\s\S]*Design Desk sketches it in one of its next daily checks/);
    assert.match(await desk.textContent("#detail .linked"), /A request from this.*Spend column options/, "the issue lists the request made from it");

    const cf = (name) => desk.locator("#confirm-dialog .actions button", { hasText: name });
    await desk.click('[data-act="draw"]');
    await cf("Cancel").click();
    await settled("/api/cards/is1/actions", 0, "Cancel draws nothing");
    await desk.click('[data-act="draw"]');
    await desk.fill("#confirm-form [name=note]", "try a chart");
    await cf("Draw it").click();
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/is1/actions"));
    assert.deepEqual(JSON.parse((await posts("/api/cards/is1/actions"))[0].body), { action: "draw", note: "try a chart" });

    // Its request was closed, so Design this is back; while one is open, the issue offers only the link to it.
    await desk.click("[data-adjust]");
    assert.equal(await desk.textContent("#rq-title"), "Design this issue");
    assert.equal(await desk.inputValue("#request-dialog textarea[name=problem]"), "", "the request is the person's words: the issue's needs are not put in for them");
    await desk.fill("#request-dialog textarea[name=problem]", "A spend column in the agents list");
    await desk.fill("#request-dialog input[name=options]", "5");
    assert.equal(await desk.textContent("#rq-count-say"), "5 options");
    await desk.fill("#request-dialog input[name=options]", "0");
    assert.equal(await desk.textContent("#rq-count-say"), "None", "none: only a check of what can be done");
    await desk.click("#rq-grill input");
    await desk.locator("#request-dialog .actions button", { hasText: "Send" }).click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/requests"));
    const body = JSON.parse((await posts("/api/requests"))[0].body);
    assert.deepEqual([body.from, body.options, body.grill], ["is1", 0, true], "from the issue, with no options and questions first");
  } finally { await run.close(); }
});

// A request from an issue: what the issue says about the design, and how each option meets its stories.
const BRIDGE_STORIES = `<script>
window.calls = [];
const issue = { id: "is1", kind: "issue", status: "open", title: "See what each agent spends", bucket: "sprint", source: { repo: "acme/widgets", issue: 41, url: "https://github.com/acme/widgets/issues/41" } };
const request = { id: "r7", kind: "request", title: "Spend in the list", status: "feedback", created: new Date().toISOString(), triage: { verdict: "design", reasons: [] }, prototype: { state: "none" }, threads: [],
  request: { type: "feature", problem: "A spend column", from: "is1", options: 2, grill: true }, grill: { state: "done", asked: 2, summary: "- Weekly spend" },
  issue_brief: { text: "Each agent shows its weekly spend.", stories: [{ id: "s1", text: "As an admin I see what each agent spends" }, { id: "s2", text: "I can sort by spend", derived: true }] },
  variants: [{ id: "v1", name: "Column", asset: "A-1", fidelity: "mockup", stories: [{ story: "s1", met: "yes", how: "A spend column on every row.", parts: [{ selector: "#spend", label: "Spend column" }] }, { story: "s2", met: "partly", how: "Sorting needs a developer.", parts: [{ selector: "#sort", label: "Sort" }] }] },
    { id: "v2", name: "Badge", asset: "A-1", fidelity: "mockup" }] };
window.platform = { async request({ method, path }) {
  calls.push({ method, path });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }
    : path === "/api/cards" ? { cards: [issue, { ...request, from: "is1", variants: 2, threads: undefined }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/r7" ? { card: request }
    : path === "/api/assets/A-1" ? { contentType: "text/html", encoding: "utf8", data: '<body><table><tr><th id="spend">Spend</th></tr></table></body>' } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a request from an issue names it, folds what the issue says, and shows how each option meets each user story", (t) => open(t, BRIDGE_STORIES, async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-card="r7"]');
  await desk.waitForSelector("text=User stories");
  assert.match(await desk.textContent("#detail .linked"), /Designs the issue.*See what each agent spends.*Issue #41/, "the request names the issue it designs");
  assert.match(await desk.textContent("#detail details.fold summary >> nth=0"), /What the issue says about the design\s*2 user stories/);
  assert.doesNotMatch(await desk.textContent("#detail"), /Asked for:/, "the request does not repeat how many options it asked for");
  assert.match(await desk.textContent("#detail"), /What we agreed before the design\s*2 questions/);
  assert.equal(await desk.evaluate(() => document.querySelector("details[data-stories]").open), false, "user stories start folded");
  await desk.click("details[data-stories] > summary");
  assert.equal(await desk.textContent('[data-story="s1"] .met'), "✓");
  // The stories sit under the option's own design: no second switch of options, no second picture.
  assert.equal(await desk.locator(".vpanel #stories").count(), 1, "the stories are the option's");
  assert.equal(await desk.locator("#story-frame").count(), 0, "no second picture of the design");
  assert.equal(await desk.locator("#detail .tabs [data-variant]").count(), 2, "one switch of options, the tabs over the panel");
  assert.equal(await desk.locator('[data-story="s1"] .how').count(), 0, "a story the option meets needs no word on it");
  await desk.waitForFunction(() => document.querySelector("#variant-frame")?.srcdoc.includes('id="spend"'));
  // A story pressed plays in the design above: the pointer names its parts there, in order
  // (their numbered frames show only with the design's Show hotspots switch on).
  await desk.click('[data-story="s1"]');
  const design = desk.frameLocator("#variant-frame");
  await design.locator("text=1. Spend column").first().waitFor();
  assert.match(await desk.textContent("#story-player"), /Playing/, "the bar with Pause and Stop shows while it plays");
  await desk.click('#story-player [data-play-ctl="stop"]');
  // A story whose parts are not in this version of the design says so, instead of playing nothing.
  await desk.click('[data-story="s2"]');
  await desk.waitForFunction(() => /Can't play it/.test(document.querySelector("#story-player")?.textContent || ""));
  await desk.click('#story-player [data-play-ctl="stop"]');
  assert.equal(await desk.locator("#story-player").count(), 0, "and goes on Close");
  assert.match(await desk.textContent('[data-story="s2"]'), /I can sort by spend.*from the issue's text/);
  assert.equal(await desk.evaluate(() => document.querySelector("details[data-stories]").open), true, "picking a story keeps the section open");
  assert.match(await desk.textContent('[data-story="s2"] .how.partly'), /needs a developer/, "one it meets in part says why, in amber");
  await desk.click('.vtabs [data-variant="v2"]');
  assert.match(await desk.textContent(".stories"), /has not said yet how Badge meets this story/);
}));

// An issue with a request: while the request is open the issue offers only its link; one sent
// to developers (or closed) brings Design this back.
const BRIDGE_ISSUE_REQUEST = (status) => BRIDGE_STORIES
  .replace('title: "Spend in the list", status: "feedback"', `title: "Spend in the list", status: "${status}"`)
  .replace('can: { vote: true, comment: true } }', 'can: { vote: true, comment: true, "follow-up": true } }')
  .replace(': path === "/api/cards/r7"', ': path === "/api/cards/is1" ? { card: issue }\n    : path === "/api/cards/r7"');
for (const [status, buttons] of [["feedback", 0], ["handed-off", 1]]) {
  test(`an issue whose request is ${status === "feedback" ? "open offers only the link to it" : "with developers offers Design this again"}`, (t) => open(t, BRIDGE_ISSUE_REQUEST(status), async (desk) => {
    await desk.click('[data-tab="issues"]');
    await desk.click('#list [data-card="is1"]');
    await desk.waitForSelector("#detail .linked");
    assert.match(await desk.textContent("#detail .linked"), /A request from this.*Spend in the list/, "the link to the request is there");
    assert.equal(await desk.locator("#detail [data-adjust]").count(), buttons);
  }));
}

// At Team feedback the step pill always offers a move on: a live prototype for Design only,
// else a developer for parts design cannot do, else Approve, else Send to Slack….
const BRIDGE_PILL = (triage, me) => BRIDGE_STORIES
  .replace('triage: { verdict: "design", reasons: [] }', `triage: ${JSON.stringify(triage)}`)
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', JSON.stringify(me));
const PILLS = [
  ["Build a live prototype", { verdict: "design", reasons: [] }, { role: "designer", email: "alice@example.com", can: { vote: true, comment: true, build: true } }, '[data-act="build"]'],
  ["Contact a developer", { verdict: "needs-developer", reasons: [], cannot: ["Sort by spend: the list has no such order."] }, { role: "designer", email: "alice@example.com", can: { vote: true, comment: true, build: true } }, "[data-dev-ask]"],
  ["Approve", { verdict: "product", reasons: [] }, { role: "designer", email: "alice@example.com", can: { vote: true, comment: true, approve: true, close: true } }, '[data-act="approve"]'],
  ["Send to Slack…", { verdict: "product", reasons: [] }, { role: "designer", email: "alice@example.com", slack: true, can: { vote: true, comment: true, share: true } }, '[data-act="slack"]'],
];
// At Options drawn the step after Contact a developer is Team feedback, never Approve.
test("at Options drawn, once Contact a developer is opened, the step pill offers Ask for feedback", (t) => open(t, BRIDGE_PILL({ verdict: "needs-developer", reasons: [], cannot: ["Sort by spend: the list has no such order."] }, { role: "designer", email: "alice@example.com", can: { vote: true, comment: true, approve: true, close: true, revise: true } }).replace('status: "feedback"', 'status: "variants"'), async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-card="r7"]');
  await desk.waitForSelector("#detail .steppill [data-dev-ask]");
  await desk.click("#detail .steppill [data-dev-ask]");
  await desk.waitForSelector("#detail .steppill [data-team-feedback]");
  assert.equal(await desk.locator('#detail .steppill [data-act="approve"]').count(), 0, "never Approve at Options drawn");
}));

for (const [label, triage, me, sel] of PILLS) {
  test(`at Team feedback the step pill offers ${label}`, (t) => open(t, BRIDGE_PILL(triage, me), async (desk) => {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r7"]');
    await desk.waitForSelector("#detail .steppill");
    assert.equal(await desk.locator(`#detail .steppill ${sel}`).count(), 1, `the pill holds ${label}`);
    assert.equal(await desk.locator("#detail .steppill .step-next").count(), 1, "one move, no more");
    if (me.can.approve) assert.equal(await desk.locator('#detail .next .btn[data-act="approve"]').count(), 1, "the green Approve stays in the row too");
    // The state's ⓘ draws every way on: a move the viewer may make plainly, one they may not
    // greyed with why and who can.
    const help = await desk.textContent("#detail .s-word .info .tip");
    if (me.can.approve) assert.doesNotMatch(help, /✕ Approve/, "an approver's help offers Approve");
    else assert.match(help, /✕ ApproveNot now: A designer, a PM or a lead developer approves it/, "anyone else's says who approves it");
  }));
}

// Every state of a request's header, for every kind of viewer that changes it: the state's word,
// its ink, its step, the step pill's one move, and the list's dot in the same ink. The ink says
// whom the request waits on — blue Design Desk (its mark blinks only while Design Desk works,
// and then the pill says Wait), amber the team's votes or tries, magenta a person's move — so a
// blue header never offers a move of a person's own. At Options drawn (step 2) the pill holds
// Contact a developer, then Ask for feedback: never Approve (it stays in the row), and no live
// prototype (step 4) anywhere, not under ⋯ nor in the ⓘ; votes and Slack come at Team feedback.
const ME = (can, extra = {}) => ({ role: "designer", email: "alice@example.com", ...extra, can: { vote: true, comment: true, ...can } });
const DESIGN = { verdict: "design", reasons: [] }, PRODUCT = { verdict: "product", reasons: [] };
const CANNOT = { verdict: "design", reasons: [], cannot: ["Sort by spend: the list has no such order."] };
const ALL = { build: true, revise: true, approve: true, close: true, share: true, explore: true };
const AT = "2026-11-01T00:00:00Z", WORK = (kind, scope) => [{ kind, ...(scope ? { scope } : {}), state: "claimed", created: AT }];
const ASKS = [{ id: "T-1", kind: "asks", state: "open", messages: [{ text: "Which list should the column go in?" }] }];
const OK = { variant: "v1", by: { email: "bob@example.com" }, at: AT };
const LATER = "2099-01-01T00:00:00Z";
const HEADERS = [
  // [name, the request as it stands, viewer, word, ink, step, the pill's move (null: none), Design Desk at work]
  ["Checking, Design Desk at work", { status: "triage", triage: null, variants: [], waiting: WORK("request") }, ME(ALL), "Checking", "checking", 1, "Wait", true],
  ["Checking, not started yet", { status: "triage", triage: null, variants: [] }, ME(ALL), "Checking", "checking", 1, "Wait", false],
  ["Checking, a question to answer", { status: "triage", triage: null, variants: [], threads: ASKS }, ME(ALL), "Checking", "turn", 1, "Answer", false],
  ["Checked, someone who starts the options", { status: "triage", triage: DESIGN, variants: [] }, ME(ALL), "Checked", "turn", 1, "Draw design options", false],
  ["Checked, someone who may not start them", { status: "triage", triage: DESIGN, variants: [] }, ME({}), "Checked", "turn", 1, "Wait for a designer", false],
  ["Drawing options, Design Desk at work", { status: "variants", triage: DESIGN, variants: [], waiting: WORK("explore") }, ME(ALL), "Drawing options", "checking", 2, "Wait", true],
  ["Options drawn, Design Desk changes them", { status: "variants", triage: DESIGN, team_feedback: { state: "waiting" }, waiting: WORK("revise") }, ME(ALL), "Drawing options", "checking", 2, "Wait", true],
  ["Options drawn, parts for a developer", { status: "variants", triage: CANNOT }, ME(ALL, { slack: true }), "Options drawn", "turn", 2, "Contact a developer", false],
  ["Options drawn, a designer who builds", { status: "variants", triage: DESIGN }, ME(ALL, { slack: true }), "Options drawn", "turn", 2, "Ask for feedback", false],
  ["Options drawn, held for its people", { status: "variants", triage: DESIGN, team_feedback: { state: "waiting" } }, ME(ALL, { slack: true }), "Options drawn", "turn", 2, "Ask for feedback", false],
  ["Options drawn, held, parts for a developer", { status: "variants", triage: CANNOT, team_feedback: { state: "waiting" } }, ME(ALL), "Options drawn", "turn", 2, "Contact a developer", false],
  ["Options drawn, Product", { status: "variants", triage: PRODUCT }, ME(ALL, { slack: true }), "Options drawn", "turn", 2, "Ask for feedback", false],
  ["Options drawn, someone who may not ask", { status: "variants", triage: DESIGN, team_feedback: { state: "waiting" } }, ME({}), "Options drawn", "turn", 2, "Wait for a designer", false],
  ["Team feedback, a designer who builds", { status: "feedback", triage: DESIGN, team_feedback: { state: "open" } }, ME(ALL), "Team feedback", "waiting", 3, "Build a live prototype", false],
  ["Team feedback, parts for a developer, no build", { status: "feedback", triage: { ...CANNOT, verdict: "needs-developer" }, team_feedback: { state: "open" } }, ME({ approve: true, close: true }), "Team feedback", "waiting", 3, "Contact a developer", false],
  ["Team feedback, an approver", { status: "feedback", triage: PRODUCT, team_feedback: { state: "open" } }, ME({ approve: true, close: true, share: true }, { slack: true }), "Team feedback", "waiting", 3, "Approve", false],
  ["Team feedback, Slack for who cannot approve", { status: "feedback", triage: PRODUCT, team_feedback: { state: "open" } }, ME({ share: true }, { slack: true }), "Team feedback", "waiting", 3, "Send to Slack…", false],
  ["Team feedback, no move of one's own", { status: "feedback", triage: PRODUCT, team_feedback: { state: "open" } }, ME({}), "Team feedback", "waiting", 3, "Wait for the team", false],
  ["Team feedback, Design Desk redraws", { status: "feedback", triage: DESIGN, team_feedback: { state: "open" }, waiting: WORK("revise") }, ME(ALL), "Team feedback", "checking", 3, "Wait", true],
  ["Building the prototype", { status: "prototype", triage: DESIGN, prototype: { state: "building" }, waiting: WORK("build") }, ME(ALL), "Building prototype", "checking", 4, "Wait", true],
  ["Live, try it", { status: "testing", triage: DESIGN, prototype: { state: "live", url: "https://example.com/p", expires: LATER } }, ME(ALL), "Live — try it", "waiting", 4, "Open the prototype", false],
  ["The prototype failed", { status: "prototype", triage: DESIGN, prototype: { state: "failed" } }, ME(ALL), "Prototype didn't work", "turn", 4, "Try again", false],
  ["The prototype was switched off", { status: "testing", triage: DESIGN, prototype: { state: "torn-down", expires: LATER } }, ME(ALL), "Prototype switched off", "turn", 4, "Build it again", false],
  ["Writing the spec", { status: "spec", triage: DESIGN, approved: OK, waiting: WORK("handoff") }, ME(ALL), "Writing the spec", "checking", 6, "Wait", true],
  ["The spec, a question to answer", { status: "spec", triage: DESIGN, approved: OK, threads: ASKS }, ME(ALL), "Writing the spec", "turn", 6, "Answer", false],
  ["Spec draft to read and send", { status: "spec", triage: DESIGN, approved: OK, spec: { review: "draft" } }, ME(ALL, { spec_review: true }), "Spec draft — read it, then send", "turn", 6, "Send to developers…", false],
  ["Sending to developers", { status: "spec", triage: DESIGN, approved: OK, spec: { review: "sent" }, waiting: WORK("handoff", "deliver") }, ME(ALL, { spec_review: true }), "Sending to developers", "checking", 7, "Wait", true],
  ["Sent, someone who sees Designs", { status: "handed-off", triage: DESIGN, approved: OK }, ME({ ...ALL, designs: true }), "Sent to developers", "approved", 6, "Show the design", false],
  ["Sent, someone who does not", { status: "handed-off", triage: DESIGN, approved: OK }, ME(ALL), "Sent to developers", "approved", 6, null, false],
  ["Closed", { status: "declined", triage: DESIGN }, ME(ALL), "Closed", "closed", null, null, false],
  ["Decided without a design", { status: "declined", triage: DESIGN, decided: { by: { email: "bob@example.com" }, at: AT, text: "Keep the list as it is." } }, ME(ALL), "Decided without a design", "decided", null, null, false],
  ["Team feedback, the Slack vote ended", { status: "feedback", triage: PRODUCT, team_feedback: { state: "open" }, polls: [{ state: "closed", closed: AT, result: "Column won" }] }, ME({ approve: true, close: true, share: true }, { slack: true }), "Team feedback (finished)", "waiting", 3, "Approve", false],
  ["Team feedback, the Slack vote still runs", { status: "feedback", triage: PRODUCT, team_feedback: { state: "open" }, polls: [{ state: "closed", closed: AT }, { state: "open", closes: LATER }] }, ME({ approve: true, close: true, share: true }, { slack: true }), "Team feedback", "waiting", 3, "Approve", false],
  ["No options, every one taken out", { status: "variants", triage: DESIGN, variants: [], team_feedback: { state: "waiting" } }, ME(ALL), "No options", "turn", 2, "Draw design options", false],
  ["No options, someone who may not draw them", { status: "variants", triage: DESIGN, variants: [], team_feedback: { state: "waiting" } }, ME({}), "No options", "turn", 2, "Wait for a designer", false],
  ["The prototype failed, someone who may not build", { status: "prototype", triage: DESIGN, prototype: { state: "failed" } }, ME({}), "Prototype didn't work", "turn", 4, "Wait for a designer", false],
  ["Spec draft, someone who may not send it", { status: "spec", triage: DESIGN, approved: OK, spec: { review: "draft" } }, ME({}, { spec_review: true }), "Spec draft — read it, then send", "turn", 6, "Wait for a designer", false],
];
// The request as the test stands it, on its page and as the list's row (a count, busy, asks).
const BRIDGE_HEADER = (patch, me) => BRIDGE_STORIES
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', JSON.stringify(me))
  .replace('{ id: "v2", name: "Badge", asset: "A-1", fidelity: "mockup" }] };', `{ id: "v2", name: "Badge", asset: "A-1", fidelity: "mockup" }] };\nObject.assign(request, ${JSON.stringify(patch)});`)
  .replace('localStorage.setItem("desk-guide-seen", "1");', `localStorage.setItem("desk-guide-seen", "1"); localStorage.setItem("desk-reqFilter", "${["handed-off", "declined"].includes(patch.status) ? "closed" : "open"}");`)
  // The list gets the store's own projection (desk/store.mjs listCards), not the card: a field the
  // projection leaves out shows here as a dot in the wrong ink or with the wrong word.
  .replace("{ ...request, from: \"is1\", variants: 2, threads: undefined }", LIST_ROW);
const LIST_ROW = `{ id: request.id, kind: "request", title: request.title, status: request.status, created: request.created, updated: request.created,
  variants: (request.variants || []).length, triage: request.triage?.verdict || null, prototype: request.prototype?.state || null, team_feedback: request.team_feedback || null,
  spec: request.spec ? { review: request.spec.review || null } : null, voting: (request.polls || []).some((x) => x.state === "open"), voted: (request.polls || []).some((x) => x.state === "closed"),
  busy: (request.waiting || []).length > 0, asks: (request.threads || []).some((t) => t.kind === "asks" && t.state === "open"),
  decided: request.status === "declined" && request.decided?.at || null, type: request.request?.type || null, for: "designers", from: "is1", read: true, origin: null, by: null }`;
const pillText = (desk) => desk.evaluate(() => document.querySelector("#detail .steppill .step-next, #detail .status > .s-line .step-next")?.textContent.trim() ?? null);
for (const [name, patch, me, word, ink, step, pill, busy] of HEADERS) {
  test(`header: ${name} → ${word}, ${ink}, ${pill ?? "no move"}`, (t) => open(t, BRIDGE_HEADER(patch, me), async (desk) => {
    await desk.click('[data-tab="requests"]');
    // The list's dot (a closed request under Closed): the same ink, blinking only while Design Desk works.
    const dot = '.row.item:has([data-card="r7"]) .sdot';
    await desk.waitForSelector(dot);
    assert.equal(await desk.getAttribute(dot, "data-s"), ink, "the dot's ink");
    assert.equal(await desk.locator(`${dot} .tag.busy`).count(), busy ? 1 : 0, busy ? "the dot blinks" : "the dot stays lit");
    assert.equal((await desk.textContent(`${dot} .w`)).trim(), word, "the dot's word, the same as the page's");
    await desk.click('[data-card="r7"]');
    await desk.waitForSelector("#detail .status");
    assert.equal(await desk.evaluate(() => [...document.querySelector("#detail .s-word").childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()), word);
    assert.equal(await desk.getAttribute("#detail .status", "data-o"), ink, "the header's ink");
    assert.equal(await desk.locator("#detail .status[data-busy]").count(), busy ? 1 : 0, busy ? "the mark blinks" : "the mark stays lit");
    if (step) assert.match(await desk.textContent("#detail .steppill summary"), new RegExp(`^Step ${step}/`));
    else assert.equal(await desk.locator("#detail .steppill").count(), 0, "a closed request has no steps");
    assert.equal(await desk.locator("#detail .step-next").count(), pill ? 1 : 0, "one move, no more");
    assert.equal(await pillText(desk), pill);
    // Blue is Design Desk's turn: never a move of a person's own beside it.
    if (ink === "checking") assert.equal(pill, "Wait", "a blue header waits, on Design Desk: plain Wait");
    if (!busy && pill?.startsWith("Wait") && ink !== "checking") assert.match(pill, /^Wait for /, "waiting on a person names whom");
    if (pill === "Wait" && busy) assert.equal(ink, "checking", "Design Desk at work is blue");
    if (patch.status === "variants" && !busy && word === "Options drawn") {
      const help = await desk.textContent("#detail .s-word .info .tip");
      assert.equal(await desk.locator('#detail .steppill [data-act="build"], #detail .steppill [data-act="approve"], #detail .steppill [data-act="slack"]').count(), 0, "never a live prototype, Approve or Slack at Options drawn");
      assert.doesNotMatch(help, /Vote and comment/, "nobody votes before Team feedback");
      assert.doesNotMatch(help, /live prototype/, "no live prototype before Team feedback");
      assert.equal(await desk.locator('#detail [data-act="build"]').count(), 0, "no Build anywhere at Options drawn");
      assert.match(help, /Ask for feedback/, "the way on is to ask the team");
      assert.equal(await desk.locator("#detail .btn.vote").count(), 0, "no vote pills yet");
    }
    // Every option taken out: drawing them again is the way on, and the row keeps Approve and Close.
    if (word === "No options") {
      assert.match(await desk.textContent("#detail .s-word .info .tip"), /Draw design options/, "the help offers to draw them again");
      assert.equal(await desk.locator('#detail [data-act="build"], #detail [data-team-feedback]').count(), 0, "no live prototype, no Ask for feedback without options");
      if (me.can.close) assert.equal(await desk.locator('#detail .next .btn[data-act="close"]').count(), 1, "Close stays in the row");
    }
    if (["variants", "feedback"].includes(patch.status) && !busy && me.can.approve) assert.equal(await desk.locator('#detail .next .btn[data-act="approve"]').count(), 1, "the green Approve stays in the row");
    // Contact a developer opened: the pill moves on to the step's next move.
    if (pill === "Contact a developer" && patch.status === "variants") {
      await desk.click("#detail .steppill [data-dev-ask]");
      await desk.waitForFunction(() => document.querySelector("#detail .steppill .step-next")?.textContent.trim() === "Ask for feedback");
    }
  }));
}

// Requests open on the viewer's own tab every visit, whatever tab the browser saw last: For
// Developers for a developer or a lead developer, For Designers for everyone else.
for (const [role, tab] of [["designer", "designers"], ["admin", "designers"], ["developer", "developers"], ["lead-developer", "developers"]]) {
  for (const last of ["designers", "developers"]) {
    test(`a ${role} opens Requests on For ${tab === "designers" ? "Designers" : "Developers"}, though ${last} was picked last`, (t) => open(t, BRIDGE_STORIES
      .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', JSON.stringify({ role, email: "alice@example.com", can: { vote: true, comment: true } }))
      .replace('localStorage.setItem("desk-guide-seen", "1");', `localStorage.setItem("desk-guide-seen", "1"); localStorage.setItem("desk-reqFor", "${last}");`), async (desk) => {
      await desk.click('[data-tab="requests"]');
      await desk.waitForSelector('[data-filter="reqFor:designers"]');
      assert.equal(await desk.getAttribute(`[data-filter="reqFor:${tab}"]`, "aria-current"), "page", "the viewer's own tab is on");
      // A tab picked holds on this page, and the browser does not keep it.
      const other = tab === "designers" ? "developers" : "designers";
      await desk.click(`[data-filter="reqFor:${other}"]`);
      assert.equal(await desk.getAttribute(`[data-filter="reqFor:${other}"]`, "aria-current"), "page");
      assert.equal(await desk.evaluate(() => localStorage.getItem("desk-reqFor")), last, "the pick is not kept");
    }));
  }
}

// An item opened from another one's link opens on its own tab: the menu says where you are.
test("a link to an issue opens it under Issues, and the menu says so", (t) => open(t, BRIDGE_STORIES
  .replace(': path === "/api/cards/r7"', ': path === "/api/cards/is1" ? { card: issue }\n    : path === "/api/cards/r7"'), async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('#list [data-card="r7"]');
  await desk.waitForSelector('#detail .linked [data-card="is1"]');
  assert.equal(await desk.getAttribute('#nav [data-tab="requests"]', "aria-current"), "true");
  await desk.click('#detail .linked [data-card="is1"]');
  await desk.waitForFunction(() => document.querySelector('#nav [data-tab="issues"]')?.getAttribute("aria-current") === "true");
  assert.equal(await desk.getAttribute('#nav [data-tab="requests"]', "aria-current"), "false", "Requests is no longer lit");
}));

// A request filed in Slack under the address Slack knows a person by is theirs on the Desk
// too, when their row of the people list names both addresses.
test("a request from Slack names you by the address Slack knows you by", (t) => open(t, BRIDGE_STORIES
  .replace('prototype: { state: "none" }, threads: [],', 'prototype: { state: "none" }, threads: [], origin: { channel: "slack", reporter: "lukas.j@work.example.com", email: "lukas.j@work.example.com" },')
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', '{ role: "designer", email: "alice@example.com", emails: ["alice@example.com", "lukas.j@work.example.com"], can: { vote: true, comment: true } }'), async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.waitForSelector('.row.item:has([data-card="r7"]) .prov');
  assert.match(await desk.textContent('.row.item:has([data-card="r7"]) .prov'), /by:\s*you/i, "by: you, not the Slack address");
}));
test("a request from Slack names its author by the people list's name, not the address", (t) => open(t, BRIDGE_STORIES
  .replace('prototype: { state: "none" }, threads: [],', 'prototype: { state: "none" }, threads: [], origin: { channel: "slack", reporter: "dana.k@work.example.com", email: "dana.k@work.example.com" },')
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', '{ role: "designer", email: "alice@example.com", names: { "dana.k@work.example.com": "Dana Kovar" }, can: { vote: true, comment: true } }'), async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.waitForSelector('.row.item:has([data-card="r7"]) .prov');
  const line = await desk.textContent('.row.item:has([data-card="r7"]) .prov');
  assert.match(line, /by:\s*Dana Kovar/);
  assert.doesNotMatch(line, /dana\.k@/, "no address where a name is known");
}));
// Your own name from the people list is what the menu shows; the Desk's name stays the page's title.
test("the menu names you by your row of the people list, the title stays the Desk's", (t) => open(t, BRIDGE_STORIES
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', '{ role: "designer", email: "alice@example.com", my_name: "Alice Hale", name: "Acme Desk", can: { vote: true, comment: true } }'), async (desk) => {
  await desk.waitForFunction(() => /Alice Hale/.test(document.querySelector("#me")?.textContent || ""));
  assert.doesNotMatch(await desk.textContent("#me"), /Acme Desk/, "not the Desk's name");
  assert.equal(await desk.title(), "Acme Desk");
}));

// The developer spec waits for a person: Send to developers is the next step, Edit and
// Ask for changes sit in the row, and nothing goes before a send (docs/handoff.md → Review before it goes).
test("a spec in draft waits for a person: read it, edit it, then send it", (t) => open(t, BRIDGE_STORIES
  .replace('title: "Spend in the list", status: "feedback"', 'title: "Spend in the list", status: "spec", approved: { by: { email: "alice@example.com" }, variant: "v1" }, spec: { asset: "A-9", review: "draft" }')
  .replace('{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true } }', '{ role: "designer", email: "alice@example.com", can: { vote: true, comment: true, approve: true, close: true } }')
  .replace(': path === "/api/assets/A-1"', ': path === "/api/assets/A-9" ? { contentType: "text/markdown", encoding: "utf8", data: "# The spec\\n\\nGrey header." }\n    : path === "/api/assets/A-1"'), async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-card="r7"]');
  await desk.waitForSelector("#detail .steppill [data-spec-send]");
  assert.equal(await desk.locator("#detail .spec-tools [data-spec-edit]").count(), 1, "Edit on the spec itself");
  assert.equal(await desk.locator("#detail .spec-tools [data-spec-changes]").count(), 1, "and Ask for changes…");
  assert.equal(await desk.locator("#detail .next [data-spec-edit]").count(), 0, "not in the row");
  await desk.waitForFunction(() => /Grey header/.test(document.querySelector("#spec-body")?.textContent || ""));
  assert.match(await desk.textContent("#detail"), /Spec draft — read it, then send/, "the state says the spec has not gone");
  await desk.click("#detail [data-spec-edit]");
  await desk.waitForFunction(() => /Grey header/.test(document.querySelector("#spec-text")?.value || ""), null, { timeout: 5000 });
  await desk.fill("#spec-text", "# The spec\n\nGrey header, 14 px.");
  await desk.click("#detail [data-spec-save]");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/r7/spec"));
  assert.equal(await desk.evaluate(() => calls.filter((c) => c.method === "POST" && c.path === "/api/cards/r7/spec").length), 1, "the edit is one save; nothing is sent");
}));

// A folded list folds only where its arrow is: Guide keeps its page, and so does a phone's width.
test("a folded list leaves Guide and a narrow window their page", (t) => open(t, BRIDGE_STORIES, async (desk) => {
  await desk.setViewportSize({ width: 1300, height: 800 });
  await desk.click("#list-fold");
  assert.equal(await desk.$eval("#main", (m) => m.classList.contains("folded")), true, "the arrow folds the list");
  assert.equal(await desk.$eval("#list", (l) => getComputedStyle(l).display), "none");
  await desk.click("#me");
  await desk.click("#help");
  assert.ok(await desk.$eval("#detail", (d) => d.getBoundingClientRect().width) > 600, "Guide has the whole width");
  await desk.setViewportSize({ width: 700, height: 800 });
  assert.ok(await desk.$eval("#detail", (d) => d.getBoundingClientRect().width) > 600, "and so does a phone's width");
  await desk.evaluate(() => document.querySelector("#main").classList.remove("has-detail"));
  assert.notEqual(await desk.$eval("#list", (l) => getComputedStyle(l).display), "none", "with no item open there, the folded list shows");
}));

// A decision a developer made waits for a designer's approval; one of the design side does not.
const APPROVALS = `<script>
const calls = [];
const decisions = [{ id: "D-1", text: "Search sits in the header", status: "active", side: "design", at: "2026-10-01T00:00:00Z", concepts: ["search"], author: { name: "Alice" } },
  { id: "D-2", text: "Limits reset weekly", status: "active", side: "developer", unapproved: true, at: "2026-10-02T00:00:00Z", concepts: ["limits"], author: { login: "dana" }, origin: { kind: "pr", label: "PR #40", url: "https://github.com/acme/widgets/pull/40" } }];
const cards = [{ id: "C-1", kind: "change", title: "A new header", acked: true, summary: "Follows D-2.", source: { repo: "acme/widgets", pr: 45 } },
  { id: "C-7", kind: "request", title: "Show a daily spend bar", status: "prototype", created: "2026-11-05T09:00:00Z", request: { problem: "Show today's spend." },
    triage: { verdict: "design", reasons: [] }, variants: [], threads: [], prototype: { state: "failed" },
    conflicts: [{ decision: "D-2", why: "A daily bar suggests a daily reset.", status: "active", text: "Limits reset weekly" }] }];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { decide: true, build: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] }
    : path.endsWith("/approve") ? { decision: { ...decisions[1], unapproved: false, approved: { by: { email: "d@example.com" }, at: "2026-11-06T10:00:00Z" } } }
    : path.startsWith("/api/decisions/") ? { decision: decisions.find((d) => d.id === path.slice(15)), refs: [] }
    : path.startsWith("/api/decisions") ? { decisions: /state=unapproved/.test(path) ? decisions.filter((d) => d.unapproved) : decisions }
    : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a decision someone other than a designer made says Not approved in its peek, its row and its page; a designer approves it there; Not approved filters", (t) => open(t, APPROVALS, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#C-1`);
  await desk.waitForSelector('#detail a[data-ref="D-2"]');
  await desk.hover('#detail a[data-ref="D-2"]');
  await desk.waitForFunction(() => /Limits reset weekly/.test(document.querySelector("#peek")?.textContent || ""));
  assert.match(await desk.textContent("#peek"), /Not approved/, "the peek says it");
  await desk.mouse.move(0, 0);
  await desk.goto(`${base}#D-2`);
  await desk.waitForSelector("#detail [data-approve-decision]");
  assert.match(await desk.textContent("#detail .status"), /Not approved/, "its status box says it");
  assert.match(await desk.textContent('#list [data-decision="D-2"]'), /Not approved/, "its dot says it");
  assert.doesNotMatch(await desk.textContent('#list [data-decision="D-1"]'), /Not approved/, "a designer's does not");
  await desk.click("#detail [data-approve-decision]");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/decisions/D-2/approve"));
  await desk.click('[data-dstate="unapproved"]');
  await desk.waitForFunction(() => calls.some((c) => /state=unapproved/.test(c.path)));
  await desk.waitForSelector('#list [data-decision="D-2"]');
  assert.equal(await desk.$('#list [data-decision="D-1"]'), null, "the filter lists only the ones waiting");

  // A request with no options that goes against a decision builds only knowingly.
  await desk.goto(`${base}#C-7`);
  await desk.waitForSelector('#detail [data-act="build"]');
  await desk.click('#detail [data-act="build"]');
  await desk.waitForSelector("#confirm-dialog[open]");
  assert.match(await desk.textContent("#confirm-dialog"), /It goes against D-2/);
  const ok = desk.locator("#confirm-dialog .actions button", { hasText: "Build it" });
  await ok.click();
  await desk.waitForSelector("#confirm-dialog[open] .toast", { state: "attached" });
  assert.equal(await desk.evaluate(() => calls.filter((c) => c.method === "POST" && c.path === "/api/cards/C-7/actions").length), 0, "nothing goes while the box is unticked");
  await desk.check("#confirm-form [name=check2]");
  await ok.click();
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/C-7/actions"));
  assert.equal(await desk.evaluate(() => JSON.parse(calls.find((c) => c.method === "POST" && c.path === "/api/cards/C-7/actions").body).overrule), true);
}));

// An option that names the decisions it rests on, one of them revoked.
const BRIDGE_WHY = BRIDGE_STORIES
  .replace('{ id: "v2", name: "Badge", asset: "A-1", fidelity: "mockup" }] };', `{ id: "v2", name: "Badge", asset: "A-1", fidelity: "mockup" }],
  cited: { "D-3": { text: "Spend always shows per week", status: "active" }, "D-4": { text: "Totals in bold", status: "revoked" } } };
request.variants[0].reasons = [{ decision: "D-3", how: "The column reads per week.", parts: [{ selector: "#spend", label: "Spend column" }] }, { decision: "D-4", how: "The total is bold.", parts: [] }];`);

test("an option says why it looks as it does: its decisions on the request and in the workspace panel", (t) => open(t, BRIDGE_WHY, async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-card="r7"]');
  await desk.waitForSelector(".why-strip");
  assert.match(await desk.textContent(".why-strip"), /Why it looks like this.*D-3.*Spend always shows per week.*D-4.*Totals in bold/);
  assert.equal(await desk.locator('.why-strip [data-why="D-4"] .dtag.gone').count(), 1, "a revoked decision is crossed out");
  await desk.click('.why-strip [data-why="D-3"]');
  await desk.waitForSelector("#ws-side .why");
  assert.equal(await desk.getAttribute('.reason[data-reason="D-3"]', "aria-current"), "true", "the decision clicked is picked in the workspace");
  assert.match(await desk.textContent("#ws-side .why"), /2 decisions[\s\S]*1 decision no longer in force[\s\S]*The column reads per week[\s\S]*Spend column/);
  assert.match(await desk.textContent('.reason[data-reason="D-4"]'), /no longer holds/);
  await desk.click('.reason[data-reason="D-3"]');
  assert.equal(await desk.getAttribute('.reason[data-reason="D-3"]', "aria-current"), "false", "a second click lets it go");
  await desk.click("[data-ws-why]");
  assert.match(await desk.textContent("#ws-side"), /2 decisions shaped this option/, "hidden, the panel keeps one line to bring it back");
  await desk.click("#ws-side [data-ws-why]");
  assert.equal(await desk.locator("#ws-side .why").count(), 1);
}));

// The same option with nested parts: D-3 shaped the table and its Spend cell, the revoked D-4 its row.
const BRIDGE_WHY_NESTED = BRIDGE_WHY.replace('parts: [{ selector: "#spend", label: "Spend column" }] }, { decision: "D-4", how: "The total is bold.", parts: [] }',
  'parts: [{ selector: "#spend", label: "Spend column" }, { selector: "table", label: "Table" }] }, { decision: "D-4", how: "The total is bold.", parts: [{ selector: "tr", label: "Row" }] }');

test("the design tags the parts a decision shaped: the picked one framed solid, a nested part without a repeat, a revoked one red; a selected part names every decision it sits in", (t) => open(t, BRIDGE_WHY_NESTED, async (desk) => {
  await desk.click('[data-tab="requests"]');
  await desk.click('[data-card="r7"]');
  await desk.click('.why-strip [data-why="D-3"]');
  const frame = await (await desk.waitForSelector("#ws-frame")).contentFrame();
  await frame.waitForSelector("#spend");
  const tags = () => frame.evaluate(() => [...document.querySelectorAll("div")].filter((d) => /^rgb\((13, 125, 120|179, 38, 30)\)/.test(d.style.borderColor))
    .map((d) => ({ red: d.style.borderColor.startsWith("rgb(179"), solid: d.style.borderStyle === "solid", faint: d.style.opacity === "0.3", label: d.textContent })));
  await frame.waitForFunction(() => [...document.querySelectorAll("div")].filter((d) => /^rgb\((13, 125, 120|179, 38, 30)\)/.test(d.style.borderColor)).length === 3);
  assert.deepEqual(await tags(), [
    { red: false, solid: true, faint: false, label: "" },
    { red: false, solid: true, faint: false, label: "◆ D-3" },
    { red: true, solid: false, faint: true, label: "" },
  ], "D-3 picked: its table framed solid with its number, the Spend cell inside without a repeat, the revoked row red and faint");
  await frame.waitForFunction(() => document.documentElement.style.cursor === "crosshair");
  // On CI a pick sometimes never reaches the side panel (2 runs of many; the cause is not found):
  // a pick that did not arrive is clicked once or twice more. Clicking a part again only picks it again.
  for (let i = 0; i < 3 && !(await desk.$("#ws-side .why-sel")); i++) {
    await frame.click("#spend");
    await desk.waitForSelector("#ws-side .why-sel", { timeout: 5000 }).catch(() => {});
  }
  await desk.waitForSelector("#ws-side .why-sel");
  assert.match(await desk.textContent("#ws-side .why-sel"), /Why it is like this[\s\S]*D-3[\s\S]*Spend always shows per week[\s\S]*D-4[\s\S]*Totals in bold/,
    "the Spend cell names D-3 and the D-4 of the row it sits in");
}));

test("Draw design options asks how many, starting at the request's own count, and sends the one picked", async (t) => {
  const bridge = BRIDGE_STORIES.replace('status: "feedback"', 'status: "triage"').replace("can: { vote: true, comment: true }", "can: { vote: true, comment: true, explore: true }")
    .replace("calls.push({ method, path });", "calls.push({ method, path, body });").replace("async request({ method, path })", "async request({ method, path, body })");
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk, posts, settled } = run;
  try {
    await desk.click('[data-tab="requests"]');
    // The frame keeps no storage, so Requests open on Your turn; this request is under Open.
    await desk.click('[data-filter="reqFilter:open"]');
    await desk.click('[data-card="r7"]');
    await desk.click('[data-act="explore"]');
    assert.equal(await desk.isChecked('#confirm-form input[name=choice][value="2"]'), true, "the request asked for two");
    const cf = (name) => desk.locator("#confirm-dialog .actions button", { hasText: name });
    await cf("Cancel").click();
    await settled("/api/cards/r7/actions", 0, "Cancel draws nothing");
    await desk.click('[data-act="explore"]');
    await desk.check('#confirm-form input[name=choice][value="4"]');
    await cf("Draw them").click();
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/r7/actions"));
    assert.deepEqual(JSON.parse((await posts("/api/cards/r7/actions"))[0].body), { action: "explore", note: "", count: 4 });
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
    note("t2", "concern", "open", "Too many tabs"),
    // Worked in: Design Desk's answer carries the place before and after, the change outlined on both.
    note("t3", "comment", "resolved", "Typo in the title", { messages: [{ by, at, text: "Typo in the title" }, { by: { agent: true }, at, text: "Fixed the title.",
      shots: [{ asset: "A-8", stage: "before", pair: "Title", caption: "", marks: [{ x: 0.25, y: 0, w: 0.5, h: 0.5 }] }, { asset: "A-9", stage: "after", pair: "Title", caption: "", marks: [{ x: 0.25, y: 0, w: 0.5, h: 0.5 }] }] }] })] };
const pic = (c) => ({ contentType: "image/svg+xml", encoding: "utf8", data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"><rect width="4" height="3" fill="' + c + '"/></svg>' });
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", slack_send: false, can: { comment: true, change: true, choose: true, share: true, vote: true } }
    : path === "/api/cards" ? { cards: [{ ...request, variants: 2, threads: undefined }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/r5" ? { card: request }
    : path === "/api/cards/r5/work-in" ? { threads: JSON.parse(body).threads.map((id) => ({ id })), inbox: { id: "I-1" } }
    : path === "/api/assets/A-1" ? { contentType: "text/html", encoding: "utf8", data: '<body><div data-view="1"><button>Next</button></div><div data-view="2"><button>Save</button></div></body>' }
    : path === "/api/assets/A-8" ? pic("red") : path === "/api/assets/A-9" ? pic("blue") : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a worked-in note shows the place before and after, outlined, in the thread and in the workspace notes", async (t) => {
  const run = await launch(t, BRIDGE_NOTES);
  if (!run) return;
  const { desk } = run;
  // Both pictures of the answer: their labels, a loaded image each, and the after one's marks on both.
  const pictures = (root) => desk.$$eval(`${root} .changed figure`, (fs) => fs.map((f) => ({
    label: f.querySelector("figcaption b")?.textContent, loaded: Boolean(f.querySelector("img")?.src), marks: f.querySelectorAll(".mark").length })));
  const both = [{ label: "Before", loaded: true, marks: 1 }, { label: "After", loaded: true, marks: 1 }];
  const loaded = (root) => desk.waitForFunction((r) => { const imgs = [...document.querySelectorAll(`${r} .changed img`)]; return imgs.length === 2 && imgs.every((i) => i.src); }, root);
  try {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r5"]');
    await desk.click("[data-convo] > summary");
    await desk.waitForSelector("#th-t3 .changed");
    await loaded("#th-t3");
    assert.match(await desk.textContent("#th-t3 .changed"), /Title/, "the pair names the place");
    assert.deepEqual(await pictures("#th-t3"), both, "the thread shows before and after");
    assert.equal(await desk.locator("#th-t1 .changed").count(), 0, "a message without pictures shows none");

    await desk.click('[data-act="workspace"]');
    await desk.waitForSelector("#ws-side .notes");
    await desk.click('[data-ws-filter="done"]');
    await desk.click('[data-ws-note="t3"]');
    await desk.waitForSelector("#ws-side .changed");
    await loaded("#ws-side");
    assert.deepEqual(await pictures("#ws-side"), both, "the workspace note shows before and after");
  } finally {
    await run.close();
  }
});

test("notes in the workspace: open and done, a whole conversation, worked in together; no winner to pick; designs go to the Slack thread", async (t) => {
  const run = await launch(t, BRIDGE_NOTES);
  if (!run) return;
  const { desk, posts } = run;
  const sent = async (path, n) => { await desk.waitForFunction(([p, k]) => calls.filter((c) => c.method === "POST" && c.path === p).length === k, [path, n]); return JSON.parse((await posts(path))[n - 1].body); };
  try {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r5"]');
    await desk.waitForSelector('[data-act="workspace"]');
    assert.equal(await desk.locator("[data-choose]").count(), 0, "no option is picked as the winner");
    assert.deepEqual(await desk.locator(".vbar [data-vote]").evaluateAll((xs) => xs.map((x) => x.dataset.vote)), ["prefer", "dislike", "concern"], "at Team feedback people vote for, against or with a concern");
    assert.equal(await desk.locator('[data-work-in="t1"]').count(), 1, "a comment on an option can be worked in from the thread");
    assert.match(await desk.textContent('[data-goto="t1"]'), /Billing/, "a note names the view it is on");

    // One Slack button; without the Slack app for votes, its dialog only sends the designs.
    await desk.click('[data-act="slack"]');
    assert.match(await desk.textContent("#sl-send-hint"), /Slack thread this request came from/);
    assert.equal(await desk.locator("#sl-mode").isHidden(), true, "a vote is not offered without the Slack app");
    await desk.locator("#slack-dialog .actions button", { hasText: "Send" }).click();
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
// The second option has the same Billing screen under another number, and a Plans screen the first lacks.
const WITH_BAR_2 = `<body>${BAR}<div data-view="1" data-view-name="Start"><button>Next</button></div><div data-view="2" data-view-name="Plans"><button>Pick</button></div><div data-view="3" data-view-name="Billing"><button>Pay</button></div></body>`;
const BRIDGE_BAR = `<script>
window.calls = [];
const at = new Date().toISOString();
const request = { id: "r6", kind: "request", title: "Plans page", status: "feedback", created: at, triage: { verdict: "design", reasons: [] }, prototype: { state: "none" },
  variants: [{ id: "v1", name: "Tabs", asset: "A-1", fidelity: "wireframe", elements: [{ id: "save", name: "Save button", change: "new", selector: '[data-view="2"] button', view: "2", view_name: "Billing" }] }, { id: "v2", name: "One page", asset: "A-2", fidelity: "wireframe" }], threads: [] };
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "designer", email: "alice@example.com", can: { comment: true, change: true, choose: true } }
    : path === "/api/cards" ? { cards: [{ ...request, variants: 2, threads: undefined }] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/cards/r6" ? { card: request }
    : path === "/api/assets/A-1" ? { contentType: "text/html", encoding: "utf8", data: ${JSON.stringify(WITH_BAR).replace(/</g, "\\u003c")} }
    : path === "/api/assets/A-2" ? { contentType: "text/html", encoding: "utf8", data: ${JSON.stringify(WITH_BAR_2).replace(/</g, "\\u003c")} } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("in Select mode the review bar acts: a hover or a click on it picks nothing, a click on the design picks; an element of the option has every state drawn", async (t) => {
  const run = await launch(t, BRIDGE_BAR.replace("can: { comment: true,", "can: { revise: true, comment: true,"));
  if (!run) return;
  const { top, desk, posts } = run;
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

    // Draw every state is an element's, under the option: the workspace has none; the element's
    // dialog sends the option, the element and its part.
    assert.equal(await desk.locator('#ws-side [data-act="states"]').count(), 0, "the workspace has no Draw every state");
    await desk.click("[data-ws-close]");
    await desk.click('#detail [data-el="save"]');
    await desk.waitForSelector("#element-dialog[open] [data-el-states]");
    assert.match(await desk.textContent("#element-dialog"), /Save button[\s\S]*New[\s\S]*Tabs · version 1[\s\S]*In the design[\s\S]*Draw every state/);
    await desk.click("#element-dialog [data-el-states]");
    await desk.fill("#confirm-form [name=note]", "The error first.");
    await desk.locator("#confirm-dialog .actions button", { hasText: "Draw the states" }).click();
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/r6/actions"));
    const body = JSON.parse((await posts("/api/cards/r6/actions"))[0].body);
    assert.deepEqual([body.action, body.note, body.variant, body.element, body.part.text, body.part.label, body.part.view, body.part.view_name, body.part.selector], ["states", "The error first.", "v1", "save", "Save button", "Save button", "2", "Billing", '[data-view="2"] button']);
  } finally {
    await run.close();
  }
});

test("a decision: what goes against it warns with a link to it; a designer revokes it with a reason", async (t) => {
  const decision = `const decision = { id: "D-1", concepts: ["header"], text: "The header stays one line", why: "", author: { name: "Dana", login: "dana" }, origin: { kind: "pr", label: "PR #40", url: "https://github.com/acme/widgets/pull/40" }, at: "2026-10-01T00:00:00Z", status: "active", side: "developer" };`;
  const bridge = BRIDGE.replace("const digest =", `${decision}\nchange.conflicts = [{ decision: "D-1", why: "It wraps the header to two lines.", text: decision.text, status: "active" }];\nchange.against = ["D-1"]; earlier.against = ["D-10", "D-11", "D-12", "D-13"];\nchange.decisions = ["D-2"]; change.cited = { "D-2": { text: "Headers use the brand colour", status: "revoked" } };\nchange.impact = { concept: "the header", places: [], decisions: [{ id: "D-2", when: "2026-09-01" }] };\nconst digest =`)
    .replace("can: { request: true,", "can: { decide: true, request: true,")
    .replace(': path === "/api/cards/ch1"', ': path === "/api/decisions/D-1" ? { decision, refs: [{ id: "ch1", kind: "change", title: "A new header", how: "conflicts" }] }\n    : path.startsWith("/api/decisions?") ? { decisions: [decision] }\n    : path === "/api/cards/ch1"');
  const run = await launch(t, bridge);
  if (!run) return;
  const { desk, posts } = run;
  try {
    await desk.click('[data-tab="new"]');
    assert.equal(await desk.textContent('.row.item:has([data-card="ch1"]) .vdot'), "Goes against D-1", "the list row has a red ! that unfolds into it");
    assert.equal(await desk.locator(".row.item .vdot").count(), 1, "only on what goes against a decision");
    await desk.click('[data-tab="product"]');
    await desk.click('[data-filter="productFilter:history"]');
    const many = '.row.item:has([data-card="d0"]) .vdot';
    assert.equal(await desk.textContent(many), "Goes against D-10, D-11, D-12 +1", "the label names three, then +N");
    assert.match(await desk.getAttribute(`${many} .tag`, "data-tip") || await desk.getAttribute(`${many} .tag`, "title"), /D-10, D-11, D-12, D-13/, "the hint names them all");
    await desk.click('[data-tab="new"]');
    await desk.click('[data-card="ch1"]');
    await desk.waitForSelector("#detail .against");
    assert.match(await desk.textContent("#detail .against"), /Goes against D-1: The header stays one line[\s\S]*wraps the header/);
    assert.match(await desk.textContent("#detail"), /Follows D-2 revoked/, "a cited decision no longer in force says so");
    assert.equal(await desk.locator('#detail .impact [data-ref="D-2"]').count(), 1, "the impact cites a decision by its number");
    await desk.click('#detail .against [data-ref="D-1"]');
    await desk.waitForSelector("#detail .status .s-meta");
    assert.match(await desk.textContent("#detail .status .s-meta"), /by:\s*Dana \(dana\)[\s\S]*from:\s*Pull request — PR #40/, "the status box says who decided it and where, on its line");
    assert.equal(await desk.locator('#detail .status .s-meta .role-ic').getAttribute("data-tip") ?? await desk.locator('#detail .status .s-meta .role-ic').getAttribute("title"), "A developer", "a developer's icon by the name");
    assert.match(await desk.textContent("#detail"), /A new header ch1[\s\S]*goes against it/);
    assert.match(await desk.textContent('.row.item:has([data-decision="D-1"])'), /The header stays one line[\s\S]*In force[\s\S]*decided:[\s\S]*from: PR #40[\s\S]*by: Dana/, "a decision's row is drawn as every list's");
    assert.equal(await desk.locator("#list .side-head").count(), 0, "one list, not kept apart by who decided");
    await desk.locator('.row.item:has([data-decision="D-1"]) .prov > span', { hasText: "by:" }).click();
    assert.match(await desk.textContent("#list .pf-bar"), /Filtered by\s*by:\s*Dana/, "a value in a row filters the list by it");
    await desk.click("#list [data-pf-clear]");
    assert.equal(await desk.locator("#list .pf-bar").count(), 0, "its × shows every row again");
    await desk.click('[data-revoke="D-1"]');
    await desk.fill("#confirm-form [name=note]", "Two lines are fine now");
    await desk.locator("#confirm-dialog .actions button", { hasText: "Revoke it" }).click();
    await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/decisions/D-1/revoke"));
    assert.deepEqual(JSON.parse((await posts("/api/decisions/D-1/revoke"))[0].body), { reason: "Two lines are fine now", replaced_by: null });
  } finally { await run.close(); }
});

test("the screen shown stays when the person switches options, where the other option has it", async (t) => {
  const run = await launch(t, BRIDGE_BAR);
  if (!run) return;
  const { desk } = run;
  const frameShows = async (view) => {
    const frame = await (await desk.waitForSelector("#ws-frame")).contentFrame();
    await frame.waitForFunction((v) => document.querySelector("[data-view].review-shown")?.dataset.view === v, view);
    return frame;
  };
  try {
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-card="r6"]');
    await desk.click('[data-act="workspace"]');
    const frame = await frameShows("1");
    await frame.waitForFunction(() => document.documentElement.style.cursor === "crosshair");
    await frame.click('#review [data-review-view="2"]');
    await desk.click('[data-ws-variant="v2"]');
    await frameShows("3"); // Billing, under its own number in this option
    await desk.click('[data-ws-variant="v1"]');
    const back = await frameShows("2");
    await back.click('#review [data-review-view="1"]');
    await desk.click('[data-ws-variant="v2"]');
    await frameShows("1");
  } finally {
    await run.close();
  }
});

// For Developers (docs/desk.md → For Developers or For Designers): who sees which button, and what the card says.
const SMALL = `<script>
window.calls = [];
const as = new URLSearchParams(location.search).get("as") || "lou";
const ME = { lou: { role: "lead-developer", can: { size: true, explore: true } }, dana: { role: "developer", can: { explore: true } }, bob: { role: "developer", can: { explore: true } } }[as];
const bob = { email: "bob@example.com", role: "developer" }, lou = { email: "lou@example.com", role: "lead-developer" }, dana = { email: "dana@example.com", role: "developer" };
const at = "2026-11-03T10:00:00Z", live = { state: "live", url: "https://example.com/p" }, triage = { verdict: "design", reasons: [] };
const cards = [
  { id: "C-1", kind: "request", title: "Not sized", status: "testing", prototype: live, triage, created_by: bob },
  { id: "C-2", kind: "request", title: "Small", status: "testing", prototype: live, triage, created_by: bob, size: { small: true, by: lou, at } },
  { id: "C-3", kind: "request", title: "Small, approved", status: "spec", triage, created_by: bob, size: { small: true, by: lou, at }, approved: { by: dana, at, small: true } },
  { id: "C-4", kind: "request", title: "Small, against a decision", status: "testing", prototype: live, triage, created_by: bob, size: { small: true, by: lou, at },
    conflicts: [{ decision: "D-1", why: "It tightens them.", text: "Rows stay roomy", status: "active" }] },
  { id: "C-5", kind: "request", title: "Small, filed from Slack", status: "testing", prototype: live, triage, created_by: { agent: true }, size: { small: true, by: lou, at },
    origin: { channel: "slack", reporter: "Dana", email: "dana@example.com" } },
  { id: "C-7", kind: "request", title: "Sent", status: "handed-off", updated: at, triage, created_by: bob, spec: { issue_url: "https://github.com/acme/w/issues/31" }, sent_card: "C-8" },
  { id: "C-8", kind: "issue", title: "Build the spend column", status: "open", bucket: "sprint", designed: { card: "C-7", title: "Sent", at } },
  { id: "C-9", kind: "issue", title: "Still open", status: "open", bucket: "sprint" },
  { id: "C-6", kind: "request", title: "Spec with a question", status: "spec", triage, created_by: bob, spec: { asset: "A-9" },
    threads: [{ id: "T-1", kind: "asks", state: "open", step: "handoff", messages: [{ by: { agent: true }, at, text: "The spec waits for one answer." }],
      questions: [{ text: "What does an empty list show?", why: "No option shows it.", options: ["A short hint", "Nothing"], suggested: "A short hint" }] }] },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { ...ME, email: as + "@example.com" }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("For Developers: the lead developer moves it there, a developer but its author approves, the card says who", (t) => open(t, SMALL, async (desk) => {
  const base = desk.url().replace(/[?#].*$/, "");
  const card = async (who, id) => {
    await desk.goto(`${base}?as=${who}#${id}`);
    await desk.waitForFunction((n) => document.querySelector("#detail h2 .num")?.textContent === n, id);
    return desk.textContent("#detail");
  };
  const count = (sel) => desk.locator(`#detail ${sel}`).count();

  await card("lou", "C-1");
  assert.equal(await count('details.more [data-size="small"]'), 1, "the lead developer marks an open request, under More");
  assert.equal(await count('[data-act="approve"]'), 0, "and approves no request that is not For Developers");
  await desk.click("#detail details.more > summary");
  await desk.click('#detail [data-size="small"]');
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/C-1/size"));
  assert.deepEqual(JSON.parse(await desk.evaluate(() => calls.find((c) => c.path === "/api/cards/C-1/size").body)), { small: true });

  const small = await card("dana", "C-2");
  assert.match(small, /For Developers — a developer approves[\s\S]*lou@example\.com/, "the card names who marked it");
  assert.equal(await count('.btn[data-act="approve"]'), 1, "another developer approves a request For Developers");
  assert.equal(await count("[data-size]"), 0, "a developer does not mark it");

  assert.match(await card("bob", "C-2"), /not bob@example\.com who filed it/);
  assert.equal(await count('[data-act="approve"]'), 0, "its author does not approve it");

  assert.match(await card("dana", "C-4"), /A designer approves it/, "the hint names a designer");
  assert.equal(await count('[data-act="approve"]'), 0, "For Developers against a decision in force is a designer's");
  assert.match(await card("dana", "C-5"), /not dana@example\.com who filed it/);
  assert.equal(await count('[data-act="approve"]'), 0, "the reporter of a request filed for them does not approve it");
  await card("bob", "C-5");
  assert.equal(await count('.btn[data-act="approve"]'), 1, "another developer does");

  assert.match(await card("lou", "C-3"), /Approved[\s\S]*dana@example\.com[\s\S]*for developers/, "the card names who approved it");
  assert.equal(await count("[data-size]"), 0, "an approved request keeps its size");

  // docs/handoff.md step 4: a question the spec leaves open is asked on the Desk, next to the spec.
  assert.match(await card("dana", "C-6"), /Before it goes to developers, Design Desk needs your answers/);
  assert.equal(await count("[data-send-form]"), 1, "the question is a form on the card");
  assert.equal(await count("details.fold[open] #spec-body"), 1, "the spec it will send is open to read");

  // docs/issues.md → On the Desk: the sent issue is linked both ways and leaves the open lists.
  assert.match(await card("dana", "C-7"), /Sent to developers[\s\S]*Issue #31 ↗[\s\S]*see it in Issues\s*C-8/);
  assert.equal(await count('.follow-prs [data-card="C-8"]'), 1, "the issue's row links its card on Issues");
  assert.match(await card("dana", "C-8"), /Already through Design Desk[\s\S]*Sent/);
  assert.equal(await count('[data-act="draw"]'), 0, "a designed issue is not drawn");
  await desk.click('[data-tab="issues"]');
  await desk.click('[data-filter="issueFilter:sprint"]');
  assert.deepEqual(await desk.$$eval("#list button.open[data-card]", (xs) => xs.map((x) => x.dataset.card)), ["C-9"], "not among the plan's");
  await desk.click('[data-filter="issueFilter:all"]');
  assert.deepEqual((await desk.$$eval("#list button.open[data-card]", (xs) => xs.map((x) => x.dataset.card))).sort(), ["C-8", "C-9"], "All keeps it, with its Designed dot");
  assert.equal(await desk.locator('.row.item:has([data-card="C-8"]) .sdot[data-s="issue-designed"]').count(), 1);
}));

// docs/desk.md → GitHub on the Desk: the sent box's rows, and a pull request's card back to the request.
const FOLLOW = `<script>
const at = "2026-11-03T10:00:00Z", triage = { verdict: "design", reasons: [] }, bob = { email: "bob@example.com", role: "designer" };
const cards = [
  { id: "C-1", kind: "request", title: "Waiting", status: "handed-off", updated: at, triage, created_by: bob, spec: { issue_url: "https://github.com/acme/w/issues/31" } },
  { id: "C-2", kind: "request", title: "Being built", status: "handed-off", updated: at, triage, created_by: bob, spec: { issue_url: "https://github.com/acme/w/issues/32" } },
  { id: "C-3", kind: "change", title: "Spend column", status: "new", source: { repo: "acme/w", pr: 50, url: "https://github.com/acme/w/pull/50" },
    builds: { card: "C-2", title: "Being built", at, url: "https://github.com/acme/w/issues/32" } },
];
const records = [
  { key: "acme/w#31", kind: "issue", state: "open", assignees: [], labels: [], linked: [] },
  { key: "acme/w#32", kind: "issue", state: "open", assignees: ["dana"], labels: [], linked: [{ title: "Spend column", url: "https://github.com/acme/w/pull/50", state: "merged", author: "dana" }] },
];
window.platform = { async request({ method, path }) {
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "bob@example.com", can: {} }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path.startsWith("/api/github") ? { records } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("Sent to developers: one row per issue and pull request; a pull request's card links its request", (t) => open(t, FOLLOW, async (desk) => {
  const base = desk.url().replace(/[?#].*$/, "");
  const rows = async (id) => {
    await desk.goto(`${base}#${id}`);
    await desk.waitForFunction((n) => document.querySelector("#detail h2 .num")?.textContent === n && document.querySelectorAll("#detail .follow-prs li").length > 1, id);
    return desk.$$eval("#detail .follow-prs li", (xs) => xs.map((x) => [x.firstElementChild, x.lastElementChild].map((e) => e.textContent.replace(/\s+/g, " ").trim()).join(" | ")));
  };
  assert.deepEqual(await rows("C-1"), ["Open | Issue #31 ↗", "None | Pull request"], "no pull request yet is a grey None row; no read time");
  assert.equal(await desk.locator("#detail .follow-prs .chip:not([data-o])").count(), 1, "None has no state colour");
  assert.doesNotMatch(await desk.textContent("#detail .sent"), /When it ships|No pull request builds it yet|on GitHub ↗/, "the old lines are gone from the box");
  assert.deepEqual(await rows("C-2"), ["Open | Issue #32 ↗·assigned to dana", "Merged | PR #50 ↗·Spend column·by dana·see it in PR ChangesC-3"], "each pull request on its own row, linked to its card");
  assert.equal(await desk.getAttribute('#detail .follow-prs a[href$="/pull/50"]', "href"), "https://github.com/acme/w/pull/50");
  await desk.click('#detail .follow-prs [data-card="C-3"]');
  await desk.waitForFunction(() => document.querySelector("#detail h2 .num")?.textContent === "C-3");
  assert.match(await desk.textContent("#detail"), /Builds a design from Design Desk[\s\S]*Being built[\s\S]*Issue #32 ↗/, "the change card links the request it builds");
  assert.equal(await desk.locator('#detail .sent [data-card="C-2"]').count(), 1);
}));

// Deciding straight away (docs/desk.md → Deciding straight away): the lead developer's buttons,
// the options folded under a live prototype, and Approve taking the prototype's option.
const SKIP = `<script>
window.calls = [];
const lou = { email: "lou@example.com", role: "lead-developer" }, bob = { email: "bob@example.com", role: "developer" };
const triage = { verdict: "design", reasons: [] }, variants = [{ id: "v1", name: "Quiet" }, { id: "v2", name: "Bold" }];
const cards = [
  { id: "C-1", kind: "request", title: "Checked", status: "triage", triage, created_by: bob },
  { id: "C-2", kind: "request", title: "Live", status: "testing", prototype: { state: "live", url: "https://example.com/p" }, triage, variants, live_pick: { variant: "v2", name: "Bold", version: 2, states: [], by: lou, at: "2026-11-03T10:00:00Z" }, created_by: bob },
  { id: "C-3", kind: "request", title: "Failed", status: "prototype", prototype: { state: "failed" }, triage, variants, created_by: bob },
  { id: "C-4", kind: "request", title: "Expired", status: "testing", prototype: { state: "expired" }, triage, variants, created_by: bob },
  { id: "C-5", kind: "request", title: "Against", status: "triage", triage, created_by: bob, conflicts: [{ decision: "D-1", why: "x", text: "Rows stay roomy", status: "active" }] },
  { id: "C-6", kind: "request", title: "Adjust", status: "triage", triage, created_by: bob, request: { type: "adjustment" } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { ...lou, can: { size: true, explore: true, skip: true, build: true, revise: true }, handoff: { idea: "desk", adjustment: "coding-agent" } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("deciding straight away: a lead developer approves or decides; a live prototype folds the options and approves its own", (t) => open(t, SKIP, async (desk) => {
  const base = desk.url().replace(/[?#].*$/, "");
  const card = async (id) => {
    await desk.goto(`${base}#${id}`);
    await desk.waitForFunction((n) => document.querySelector("#detail h2 .num")?.textContent === n, id);
  };
  await card("C-1");
  assert.equal(await desk.locator('#detail .btn[data-act="approve"]').count(), 1, "send to developers before any option");
  assert.equal(await desk.locator('#detail [data-act="close"]').count(), 1, "or close it with a decision");
  await desk.click('#detail [data-act="close"]');
  assert.equal(await desk.locator("#cf-choices input").count(), 0, "a lead developer only closes with a decision");
  await desk.fill("#confirm-form [name=note]", "Headers stay as they are.");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/C-1/decide"));
  assert.deepEqual(JSON.parse(await desk.evaluate(() => calls.find((c) => c.path === "/api/cards/C-1/decide").body)), { text: "Headers stay as they are." });

  await card("C-2");
  assert.equal(await desk.locator("#detail details.fold:not(.sect):has(#variant-frame)").evaluate((x) => x.open), false, "the options fold while the prototype is live");
  assert.equal(await desk.locator('#detail details.fold [data-act="build"]').count(), 1, "building again sits with them");
  await desk.click('#detail .next [data-act="approve"]');
  assert.match(await desk.textContent("#cf-body"), /Bold\*?\*?, version 2/, "the dialog names the prototype's option and version");
  assert.equal(await desk.locator("#cf-choices input").count(), 0, "and offers no other");
  assert.equal(await desk.locator("#cf-check2-wrap").isHidden(), true, "an idea's spec stays on the Desk: no straight to implementation");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/C-2/actions"));
  assert.equal(JSON.parse(await desk.evaluate(() => calls.find((c) => c.path === "/api/cards/C-2/actions").body)).note, "v2");

  for (const id of ["C-3", "C-4"]) {
    await card(id);
    assert.equal(await desk.locator("#detail details.fold:not(.sect):has(#variant-frame)").count(), 0, `${id}: no live prototype, the options stay open`);
    assert.equal(await desk.locator('#detail .next [data-act="close"]').count(), 1, `${id}: close with a decision on a switched-off prototype`);
  }
  await card("C-5");
  assert.equal(await desk.locator('#detail [data-act="approve"]').count(), 0, "against a decision in force a lead developer does not send it");
  assert.equal(await desk.locator('#detail [data-act="close"]').count(), 1);
  await card("C-6");
  await desk.click('#detail [data-act="approve"]');
  assert.equal(await desk.locator("#cf-check2-wrap").isVisible(), true, "an adjustment reaches the coding agent: the box is offered");
  await desk.check("#confirm-form [name=check2]");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => calls.some((c) => c.method === "POST" && c.path === "/api/cards/C-6/actions"));
  assert.equal(JSON.parse(await desk.evaluate(() => calls.find((c) => c.path === "/api/cards/C-6/actions").body)).implement, true);
}));

test("the Desk opens on Requests, a first visit too", (t) => open(t, SKIP.replace(`try { localStorage.setItem("desk-guide-seen", "1"); } catch {}`, `try { localStorage.clear(); } catch {}`), async (desk) => {
  await desk.waitForSelector('[data-tab="requests"][aria-current="true"]');
  assert.equal(await desk.getAttribute("#help", "aria-current"), "false", "How it works waits under the question mark");
}));

// One request with a public comment; the viewer's own private ask answered about it.
const PRIVATE = `<script>
const card = { id: "C-5", kind: "request", title: "Show limits", status: "variants", variants: [], threads: [
  { id: "T-1", kind: "comment", state: "open", messages: [{ by: { email: "d@example.com" }, at: "2026-11-04T10:00:00Z", text: "A public note." }] }] };
const asks = [{ id: "T-9", kind: "private", owner: "d@example.com", state: "answered", context: { page: "product", label: "Product page" }, created: "2026-11-04T09:00:00Z",
  messages: [{ by: { email: "d@example.com" }, at: "2026-11-04T09:00:00Z", text: "Asked on another page" }] }, { id: "T-2", kind: "private", created: "2026-11-04T10:00:00Z", owner: "d@example.com", state: "answered", context: { card: "C-5", label: "C-5 Show limits" },
  messages: [{ by: { email: "d@example.com" }, at: "2026-11-04T10:00:00Z", text: "Why does it look like this today?" }, { by: { agent: true }, at: "2026-11-04T10:01:00Z", text: "Like a fuel gauge. It shows one total." }] }];
const posted = [];
window.platform = { async request({ path, method, body }) {
  if (method === "POST") posted.push({ path, body: JSON.parse(body || "{}") });
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: { ask: true, comment: true } }
    : path === "/api/cards" ? { cards: [card] } : path === "/api/private" && method !== "POST" ? { asks } : path.startsWith("/api/cards/C-5") && method !== "POST" ? { card } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE} : { inbox: { id: "I-1" } };
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("a private ask: a corner chat that names its context, says only you see it, starters and own text send, a brief goes public only by hand", (t) => open(t, PRIVATE, async (desk) => {
  await desk.goto(desk.url().replace(/#.*$/, "") + "#C-5");
  await desk.waitForSelector("#detail h2");
  assert.equal(await desk.$$eval("#detail .thread", (x) => x.length), 1, "the card shows only the public comment");
  assert.match(await desk.textContent("[data-ask-open]"), /Ask privately about this request/, "the button names what is open");
  await desk.click("[data-ask-open]");
  await desk.waitForSelector('.ask-panel [data-brief="T-2"]');
  assert.deepEqual(await desk.$$eval(".ask-msg", (x) => x.map((n) => [...n.classList].pop())), ["me", "agent"], "one chat: the question on the right, the answer on the left");
  assert.doesNotMatch(await desk.textContent(".ask-body"), /Asked on another page/, "each item has its own chat");
  assert.equal(await desk.$$eval("#ask [data-reply]", (x) => x.length), 0, "no follow-up box: the chat is one line");
  assert.match(await desk.textContent(".ask-ctx"), /About: C-5 Show limits/, "the chat says what it is about");
  assert.match(await desk.$eval(".ask-panel header .chip", (c) => c.title || c.dataset.tip || ""), /Only you and Design Desk see these.*nothing goes to Slack/, "it says only you see it");
  assert.equal(await desk.$eval(".ask-body", (b) => Math.round(b.scrollTop + b.clientHeight) >= b.scrollHeight - 1), true, "it opens on the newest message");
  assert.equal(await desk.$$eval("[data-ask-starter]", (x) => x.length), 5, "five starters");
  // One size for both sides: the person's bubble once inherited 12px from the header's `.me` chip
  // while the answer read at 14px.
  const sizes = await desk.$$eval(".ask-msg", (x) => x.map((n) => getComputedStyle(n).fontSize));
  assert.deepEqual(sizes, ["14px", "14px"], "a question and its answer read at the same size");
  await desk.click('[data-ask-starter="fixed"]');
  await desk.waitForFunction(() => posted.length === 1);
  assert.deepEqual(await desk.evaluate(() => posted[0]), { path: "/api/private", body: { text: "What can't change, and why?", starter: "fixed", context: { card: "C-5", label: "C-5 Show limits" } } });
  await desk.fill("#ask-text", "Is the bar too thin?");
  await desk.click("[data-ask-send]");
  await desk.waitForFunction(() => posted.length === 2);
  assert.deepEqual(await desk.evaluate(() => [posted[1].body.text, posted[1].body.starter]), ["Is the bar too thin?", null], "a question of their own");
  // A redraw replaces the box; it keeps the caret and the focus of whoever was typing in it. The
  // card redraws on a hashchange, as when an answer lands; the box must be a new one after it.
  await desk.fill("#ask-text", "Typing while an answer lands");
  await desk.focus("#ask-text");
  await desk.evaluate(() => { const t = document.querySelector("#ask-text"); t.setSelectionRange(9, 9); t.dataset.before = "1"; });
  await desk.evaluate(() => window.dispatchEvent(new HashChangeEvent("hashchange")));
  await desk.waitForFunction(() => { const t = document.querySelector("#ask-text"); return t && !t.dataset.before; });
  assert.equal(await desk.evaluate(() => document.activeElement?.id), "ask-text", "the box keeps the focus");
  assert.equal(await desk.evaluate(() => document.querySelector("#ask-text").selectionStart), 9, "and the caret");
  assert.equal(await desk.inputValue("#ask-text"), "Typing while an answer lands", "and what was typed");
  await desk.click('[data-brief="T-2"]');
  assert.match(await desk.inputValue("#composer-text"), /fuel gauge/, "the brief lands as text in the page's public comments box");
  assert.equal(await desk.evaluate(() => posted.length), 2, "nothing is sent until the person sends it from the public box");
}));

// docs/desk-page.md → Lists and Folds stay folded; docs/requests.md → Triage. The page runs where local
// storage throws, as in its sandboxed frame.
const FOLD = `<script>
Object.defineProperty(window, "localStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
window.calls = [];
const at = (d) => "2026-11-0" + d + "T10:00:00Z";
const triage = { verdict: "needs-developer", reasons: ["The price per seat is not in the data."], cannot: ["Show the price per seat: the screen has no such number."] };
const full = { id: "C-2", kind: "request", title: "Clearer plan cards", status: "feedback", created: at(2), updated: at(9), triage, prototype: { state: "none" }, threads: [],
  request: { type: "idea", problem: "The plan cards are hard to compare. It uses the brightest colour of the product and a big illustration, so people who have nothing to do yet think something broke. Two of them said so in last week's interviews, and support hears it every month. We would like it calm, small and plain, with one quiet line on what comes next." },
  research: { verdict: "deliberate", summary: "The cards were made so on purpose. It uses the brightest colour of the product and a big illustration, so people who have nothing to do yet think something broke. Two of them said so in last week's interviews, and support hears it every month. We would like it calm, small and plain, with one quiet line on what comes next.", links: [] },
  variants: [{ id: "v1", name: "Quiet", asset: "A-1" }, { id: "v2", name: "Bold", asset: "A-1" }] };
const plain = { id: "C-6", kind: "request", title: "Softer colours", status: "feedback", created: "2026-10-31T10:00:00Z", updated: at(7), triage: { verdict: "design", reasons: [] },
  prototype: { state: "none" }, threads: [], request: { type: "idea", problem: "Softer colours." } };
const cards = [
  { id: "C-1", kind: "request", title: "Oldest", status: "feedback", created: at(1), updated: at(8) },
  { ...full, triage: "needs-developer", variants: 2 },
  { id: "C-3", kind: "request", title: "Newest", status: "feedback", created: at(3), updated: at(4) },
  { ...plain, triage: "design" },
  { id: "C-4", kind: "change", title: "Shipped first", created: at(6), updated: at(6), source: { pr: 1, merged_at: at(1) } },
  { id: "C-5", kind: "change", title: "Shipped last", created: at(5), updated: at(5), source: { pr: 2, merged_at: at(4) } },
];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "admin", email: "lead@example.com", can: { explore: true, choose: true, vote: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path === "/api/cards/C-2" ? { card: full } : path === "/api/cards/C-6" ? { card: plain }
    : path.startsWith("/api/assets/") ? { id: "A-1", kind: "variant", content: "<p>An option</p>" } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;

test("lists show the newest first; a folded box stays folded on another option; neither Design only nor Needs a developer is a label by the title, every verdict is in the steps", (t) => open(t, FOLD, async (desk) => {
  const base = desk.url().replace(/[?#].*$/, "");
  await desk.goto(`${base}#C-2`);
  await desk.waitForFunction(() => document.querySelector("#detail h2 .num")?.textContent === "C-2");
  const rows = () => desk.$$eval("#list button.open[data-card]", (xs) => xs.map((x) => x.dataset.card));
  assert.deepEqual(await rows(), ["C-3", "C-2", "C-1", "C-6"], "requests by the day they came, not by their last update");
  assert.equal(await desk.locator("#list .chip", { hasText: "Design only" }).count(), 0, "no Design only label in the list");

  assert.equal(await desk.locator("#detail .sub .chip", { hasText: "Needs a developer" }).count(), 0, "no Needs a developer label beside the title");
  assert.match(await desk.textContent("#detail details.stepper ol"), /Filed\s*Needs a developer/, "the steps name it");
  assert.equal(await desk.locator(".made-col h4", { hasText: "What can be done" }).count(), 0, "no What can be done in the box");
  assert.doesNotMatch(await desk.textContent(".made-col"), /deliberate decision/, "no label on what is already known");
  assert.match(await desk.textContent(".standing details.fold summary"), /1 part needs a developer/, "what design cannot do folds under the status");
  await desk.click(".steppill [data-dev-ask]");
  assert.equal(await desk.$eval("#dev-parts", (d) => d.open), true, "the step Contact a developer opens what design cannot do");
  assert.equal(await desk.locator(".steppill [data-dev-ask]").count(), 0, "once opened, the step moves on to the one after it");
  assert.equal(await desk.locator("#dev-parts [data-dev-copy]").count(), 1, "with a question for a developer to copy");

  await desk.click('[data-brief-toggle="made"]');
  assert.equal(await desk.locator(".made-col.clamped").count(), 1, "folded");
  await desk.click('[data-variant="v2"]');
  await desk.waitForFunction(() => document.querySelector('[data-variant="v2"]')?.getAttribute("aria-pressed") === "true");
  assert.equal(await desk.locator(".made-col.clamped").count(), 1, "still folded on another option");

  await desk.goto(`${base}#C-6`);
  await desk.waitForFunction(() => document.querySelector("#detail h2 .num")?.textContent === "C-6");
  assert.equal(await desk.locator(".top2 > .brief:not(.made-col) .brief-toggle:not([hidden])").count(), 0, "a request of one short line has nothing to fold: no Show or Hide");
  assert.equal(await desk.locator(".top2 > .brief.clamped").count(), 0, "and it is never folded");
  assert.equal(await desk.locator("#detail .sub .chip", { hasText: "Design only" }).count(), 0, "no Design only label by the title");
  assert.match(await desk.textContent("#detail details.stepper ol"), /Filed\s*Design only/, "the steps name the verdict");

  await desk.click('[data-tab="new"]');
  await desk.click('[data-filter="newFilter:open"]');
  assert.deepEqual(await rows(), ["C-5", "C-4"], "changes by the day they shipped");
}));

// A preview of a part (the hover peek, All elements, the enlarged part) hides the review bar,
// and with it the outline its Show hotspots switch draws from the start.
test("a preview of a design shows neither the review bar nor the hotspots' outline", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const src = (re) => { const m = page.match(re); assert.ok(m, `the page has ${re}`); return m[0]; };
  const { SNIP_SCRIPT, ZOOM_SCRIPT } = new Function(`${src(/const js = \(v\) => [^\n]+;/)}
    ${src(/const SNIP_SCRIPT = [\s\S]*?<\\\/script>`;/)}
    ${src(/const ZOOM_SCRIPT = [\s\S]*?<\\\/script>`;/)}
    return { SNIP_SCRIPT, ZOOM_SCRIPT };`)();
  const sel = '[data-view="2"] button';
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const pg = await chrome.newPage();
    const state = () => pg.evaluate(() => ({ bar: getComputedStyle(document.getElementById("review")).display,
      hot: document.documentElement.classList.contains("review-hot"), checked: document.querySelector("#review [data-hot]").getAttribute("aria-checked") }));
    await pg.setContent(WITH_BAR);
    const own = await state();
    assert.deepEqual([own.hot, own.checked], [true, "true"], "the design itself starts with Show hotspots on");
    for (const [name, sc] of [["a part's preview", SNIP_SCRIPT(sel, "", false)], ["the whole design's preview", SNIP_SCRIPT("", "", false)], ["an enlarged part", ZOOM_SCRIPT(sel)]]) {
      await pg.setContent(WITH_BAR.replace("</body>", `${sc}</body>`));
      assert.deepEqual(await state(), { bar: "none", hot: false, checked: "false" }, name);
    }
  } finally {
    await chrome.close();
  }
});

// Differences from Figma (docs/desk.md → Differences from Figma): a screen and a request
// compared with their frames, an admin with Figma on for the Desk.
const FIGMA = `<script>
window.posts = [];
const frame = { url: "https://www.figma.com/design/AbC123/App?node-id=12-40", name: "Agents list", version: "9f2c", edited: "2026-11-04T10:00:00Z" };
const diffs = [{ part: "Rows", what: "less space between rows", severity: "minor", figma: "gap 16px", product: "gap 12px" },
  { part: "Header", what: "the title is smaller", severity: "major", figma: "24 / 500", product: "20 / 500" }];
const row = { verdict: "differs", count: 2, frame: "Agents list", checked: "2026-11-05T10:00:00Z" };
const cards = [
  { id: "C-1", kind: "screen", title: "Agents list", status: "current", path: "/agents", figma: { ...row }, figma_check: { verdict: "differs", frame: { ...frame, shot: "A-2" }, checked: "2026-11-05T10:00:00Z", differences: diffs } },
  { id: "C-2", kind: "request", title: "Bigger send button", status: "feedback", request: { problem: "Too small.", figma: frame.url }, triage: { verdict: "design" },
    variants: [{ id: "v1", name: "Calm", asset: "A-1", version: 1 }], figma: row,
    figma_check: { verdict: "differs", variant: "v1", frame, checked: "2026-11-05T10:00:00Z", differences: diffs } },
];
window.platform = { async request({ method, path, body }) {
  if (method === "POST") {
    posts.push({ path, body: JSON.parse(body || "{}") });
    // The Desk keeps the person's choice: /api/me answers it from then on, as the server does.
    if (path === "/api/prefs") window.figmaPref = JSON.parse(body).figma;
    // Close keeps its state, as the store does: the list and the page read it back.
    if (path === "/api/cards/C-1/figma-close") { const on = JSON.parse(body).on; cards[0].figma.closed = on; if (on) cards[0].figma_check.closed = { by: { email: "a@example.com" }, at: "2026-11-06T10:00:00Z" }; else delete cards[0].figma_check.closed; }
    return { status: 200, contentType: "application/json", body: JSON.stringify(path === "/api/prefs" ? { figma: window.figmaPref } : { figma_check: {} }) };
  }
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "admin", email: "a@example.com", key: "a@example.com", figma: true, figma_pref: window.figmaPref ?? true, can: { handle: true, revise: true, figma: true, request: true, queue: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE}
    : path === "/api/assets/A-1" ? { id: "A-1", contentType: "text/html", encoding: "utf8", data: "<body><button>Send</button></body>" }
    : path === "/api/assets/A-2" ? { id: "A-2", contentType: "image/png", encoding: "base64", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=" }
    : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("Differences from Figma: the Product page lists what is in the product, a box folds to one line, × and Work into the design send, the menu switch hides it", (t) => open(t, FIGMA, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#product`);
  await desk.click('[data-filter="productFilter:differences"]');
  await desk.waitForSelector("#list .row");
  assert.deepEqual(await desk.$$eval("#list .row [data-card]", (xs) => xs.map((x) => x.dataset.card)), ["C-1"], "a screen is listed; a request is not");
  assert.match(await desk.textContent("#list .row"), /2 differences[\s\S]*Screen[\s\S]*Agents list/);
  // A row opens its comparison: the status box, then the table with the major one first.
  await desk.click('#list [data-card="C-1"]');
  await desk.waitForSelector("#detail .status");
  assert.match(await desk.textContent("#detail .status"), /2 differences from Figma[\s\S]*Open in Figma[\s\S]*Open the screen/);
  assert.deepEqual(await desk.$$eval("#detail .ft-r .ft-d b", (xs) => xs.map((x) => x.textContent)), ["Header", "Rows"], "major first");
  // The row's red !: its words open on hover, its tooltip one whole sentence.
  assert.equal(await desk.textContent('#list [data-card="C-1"] .vdot .w'), "2 differences from Figma");
  assert.equal(await desk.getAttribute('#list [data-card="C-1"] .vdot .tag', "data-tip"), "It differs from its frame in Figma in 2 places", "the title becomes the Desk's own tooltip");
  assert.match(await desk.textContent("#list .row .prov"), /checked:[\s\S]*type:[\s\S]*Screen[\s\S]*frame:[\s\S]*Agents list/, "the line under the title reads like a request's");
  // A side with no picture: an empty box, its caption under it as under a picture.
  assert.deepEqual(await desk.$$eval("#detail .figdiffs figcaption", (xs) => xs.map((x) => x.textContent)), ["In Figma", "In the product"]);
  assert.equal(await desk.textContent("#detail .figdiffs .nopic-f .nopic-box"), "No picture");
  // Under ⋯: Close and Add to presentation. Close moves it to Closed; Reopen the last one goes back to Differs.
  await desk.click("#detail .status .more summary");
  assert.equal(await desk.locator('#detail .status .menu [data-act="queue"]').count(), 1, "Add to presentation is under ⋯");
  await desk.click('#detail .status [data-fig-close="1"]');
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/figma-close"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/figma-close").body), { on: true });
  await desk.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => t.textContent.startsWith("Closed for everyone")));
  await desk.waitForSelector('[data-filter="figFilter:closed"]');
  assert.equal(await desk.locator('#list [data-card="C-1"]').count(), 0, "off Differs");
  await desk.click('[data-filter="figFilter:closed"]');
  await desk.waitForSelector('#list [data-card="C-1"]');
  assert.equal(await desk.locator('#list [data-card="C-1"] .vdot').count(), 0, "a closed one keeps no !");
  await desk.click('#list [data-card="C-1"]');
  await desk.waitForSelector('#detail .status[data-o="closed"]');
  await desk.click("#detail .status .more summary");
  await desk.click('#detail .status [data-fig-close="0"]');
  await desk.waitForFunction(() => posts.filter((p) => p.path === "/api/cards/C-1/figma-close").length === 2);
  assert.deepEqual(await desk.evaluate(() => posts.filter((p) => p.path === "/api/cards/C-1/figma-close")[1].body), { on: false }, "Reopen sends on: false");
  await desk.waitForFunction(() => [...document.querySelectorAll(".toast")].some((t) => t.textContent === "Back on Product → Differences."));
  await desk.waitForFunction(() => !document.querySelector('[data-filter="figFilter:closed"]'));
  assert.equal(await desk.getAttribute('[data-filter="figFilter:differs"]', "aria-pressed"), "true", "back on Differs, a lit filter");

  // On the screen itself: folded to one line with the counts; × takes one off for everyone.
  await desk.goto(`${base}#C-1`);
  await desk.waitForSelector("[data-figbox]");
  assert.equal(await desk.$eval("[data-figbox]", (x) => x.open), false, "folded at first");
  assert.match(await desk.textContent("[data-figbox] summary"), /2 differences from Figma: Agents list[\s\S]*1 major[\s\S]*1 minor/);
  await desk.click("[data-figbox] summary");
  await desk.click('[data-figbox] [data-fig-dismiss="Rows"]');
  await desk.waitForFunction(() => posts.some((p) => p.path.endsWith("/figma-dismiss")));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path.endsWith("/figma-dismiss"))), { path: "/api/cards/C-1/figma-dismiss", body: { part: "Rows", on: true } });

  // On a request: tick the differences to work in; only the ticked ones go, on the option.
  await desk.goto(`${base}#C-2`);
  await desk.waitForSelector("[data-figbox]");
  await desk.click("[data-figbox] summary");
  await desk.click("[data-fig-pick]");
  await desk.waitForSelector("[data-fig-d]");
  await desk.uncheck('[data-fig-d="0"]');
  await desk.click("[data-fig-send]");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-2/threads"));
  const note = await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-2/threads").body);
  assert.deepEqual([note.kind, note.anchor.variant], ["change", "v1"]);
  assert.match(note.text, /Header: the title is smaller/);
  assert.doesNotMatch(note.text, /Rows/, "an unticked one stays out");

  // The Figma switch in the menu: off, no Differences page and no box, saved for this person.
  await desk.click("#me");
  assert.equal(await desk.getAttribute("#figma", "aria-pressed"), "true", "on: this person turned it on");
  await desk.click("#figma");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/prefs"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/prefs").body), { figma: false });
  assert.equal(await desk.locator("[data-figbox]").count(), 0, "no box");
  // The new request form has no Figma link while Figma is off for this person.
  await desk.click("#new-request");
  assert.equal(await desk.locator("#rq-figma").isHidden(), true, "no Figma link with Figma off");
  await desk.keyboard.press("Escape");
  await desk.goto(`${base}#product`);
  await desk.waitForSelector('[data-filter="productFilter:screens"]');
  assert.equal(await desk.locator('[data-filter="productFilter:differences"]').count(), 0, "no Differences page");
}));

// Close is for whoever may mark items handled: without it, ⋯ holds no Close.
const FIGMA_NO_HANDLE = FIGMA.replace("can: { handle: true, ", "can: { ");
test("Differences from Figma: Close is only for whoever may mark items handled", (t) => open(t, FIGMA_NO_HANDLE, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#product`);
  await desk.click('[data-filter="productFilter:differences"]');
  await desk.click('#list [data-card="C-1"]');
  await desk.waitForSelector("#detail .status");
  assert.equal(await desk.locator("#detail .status [data-fig-close]").count(), 0, "no Close without handle");
  assert.equal(await desk.locator('#detail .status [data-act="queue"]').count(), 1, "Add to presentation stays");
}));

// A person who never chose: /api/me answers no choice (null), and Figma is off for them.
const FIGMA_UNSET = FIGMA.replace("figma_pref: window.figmaPref ?? true", "figma_pref: window.figmaPref ?? null");
test("Figma with no choice saved: the switch is off, no Differences page, until the person turns it on", (t) => open(t, FIGMA_UNSET, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#product`);
  await desk.waitForSelector('[data-filter="productFilter:screens"]');
  assert.equal(await desk.locator('[data-filter="productFilter:differences"]').count(), 0, "no Differences page");
  await desk.click("#me");
  assert.equal(await desk.getAttribute("#figma", "aria-pressed"), "false", "off: no choice saved");
  await desk.click("#figma");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/prefs"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/prefs").body), { figma: true });
  await desk.waitForSelector('[data-filter="productFilter:differences"]');
}));

// The bell: a comment For you and a new request for everyone; a click on a row reads it.
const BELL = `<script>
window.posts = [];
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\\.\\d{3}Z$/, "Z");
const thread = { id: "t1", card: "C-1", kind: "comment", state: "open", messages: [{ by: { email: "pat@example.com" }, at: ago(5), text: "Looks good" }] };
const cards = [{ id: "C-1", kind: "change", title: "A new header", status: "open", summary: "The header changed.", source: { repo: "acme/widgets", pr: 45 }, threads: [thread] },
  { id: "C-2", kind: "request", title: "Calmer list", status: "triage", request: { problem: "Too loud." } },
  { id: "C-3", kind: "request", title: "Quieter rows", status: "feedback", triage: { verdict: "design", reasons: [] }, prototype: { state: "none" }, request: { problem: "Rows shout." },
    variants: [{ id: "v1", name: "Calm", asset: "A-1", version: 1 }],
    threads: [{ id: "t2", card: "C-3", kind: "comment", state: "open", anchor: { variant: "v1", selector: "button", text: "Send", label: "The send button" },
      messages: [{ by: { email: "pat@example.com" }, at: ago(3), text: "Too big" }] }] }];
const items = [
  { id: "n3", at: ago(3), event: "comment", item: "C-3", kind: "request", title: "Quieter rows", by: { email: "pat@example.com" }, detail: "Too big", thread: "t2", msg: 0, for_you: false, count: 1, people: [{ email: "pat@example.com" }], marks: [["t2", 0]] },
  { id: "n1", at: ago(5), event: "comment", item: "C-1", kind: "change", title: "A new header", by: { email: "pat@example.com" }, detail: "Looks good", thread: "t1", msg: 0, for_you: true, count: 1, people: [{ email: "pat@example.com" }], marks: [["t1", 0]] },
  { id: "n2", at: ago(9), event: "new-request", item: "C-2", kind: "request", title: "Calmer list", by: { email: "pat@example.com" }, for_you: false, count: 1, people: [{ email: "pat@example.com" }] }];
window.platform = { async request({ method, path }) {
  if (method === "POST") { posts.push(path); return { status: 200, contentType: "application/json", body: JSON.stringify(path === "/api/notifications/seen" ? { seen: items[0].at } : {}) }; }
  const answer = path === "/api/me" ? { role: "designer", email: "a@example.com", key: "a@example.com", can: { comment: true } }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE}
    : path === "/api/notifications" ? { items, seen: null, unread: 1 }
    : path === "/api/cards/C-1" ? { card: cards[0] } : path === "/api/cards/C-2" ? { card: cards[1] } : path === "/api/cards/C-3" ? { card: cards[2] }
    : path === "/api/assets/A-1" ? { id: "A-1", contentType: "text/html", encoding: "utf8", data: "<body><button>Send</button></body>" } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;
// Simple mode and the bell: a row about a page simple mode hides (Issues, Product) leaves the
// list and the count; switching simple mode off brings them back.
const SIMPLE_BELL = `<script>
window.posts = [];
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\\.\\d{3}Z$/, "Z");
const row = (m, event, item, kind, title) => ({ at: ago(m), event, item, kind, title, by: { email: "pat@example.com" }, for_you: true, count: 1, people: [{ email: "pat@example.com" }] });
const items = [row(1, "new-issue", "C-7", "issue", "An issue"), row(2, "comment", "C-8", "screen", "A screen"), row(3, "comment", "C-9", "element", "An element"),
  row(4, "new-decision", "D-1", "decision", "A decision"), row(5, "new-request", "C-2", "request", "A request")];
window.platform = { async request({ method, path, body }) {
  if (method === "POST") { posts.push(path); return { status: 200, contentType: "application/json", body: JSON.stringify(path === "/api/prefs" ? { theme: null, simple: JSON.parse(body).simple } : path === "/api/notifications/seen" ? { seen: items[0].at } : {}) }; }
  const answer = path === "/api/me" ? { role: "designer", email: "a@example.com", key: "a@example.com", simple: true, can: { comment: true } }
    : path === "/api/cards" ? { cards: [] } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE}
    : path === "/api/notifications" ? { items, seen: null, unread: items.length } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;
test("in simple mode the bell leaves out issues, screens, elements and decisions, in its rows and its count; switching simple mode off brings them back", (t) => open(t, SIMPLE_BELL, async (desk) => {
  await desk.waitForFunction(() => document.querySelector("#bell-count")?.hidden === false);
  assert.equal(await desk.textContent("#bell-count"), "1", "simple mode counts only the request");
  await desk.click("#me");
  await desk.click("#simple");
  await desk.waitForFunction(() => document.querySelector("#bell-count")?.textContent === "5");
  await desk.click("#me");
  await desk.click("#simple");
  await desk.waitForFunction(() => document.querySelector("#bell-count")?.textContent === "1");
  await desk.click("#bell-btn");
  for (const only of ["1", "0"]) {
    await desk.click(`#notes [data-only="${only}"]`);
    assert.deepEqual(await desk.$$eval("#notes [data-note] .ti .num", (els) => els.map((e) => e.textContent)), ["C-2"], `only the request, ${only === "1" ? "For you" : "All"}`);
  }
  // The switch sits in another menu, so the bell closes on its click; open again, every row is back.
  await desk.click("#me");
  await desk.click("#simple");
  await desk.waitForFunction(() => !document.querySelector("#bell").open);
  await desk.click("#bell-btn");
  await desk.click('#notes [data-only="0"]');
  assert.deepEqual(await desk.$$eval("#notes [data-note] .ti .num", (els) => els.map((e) => e.textContent)), ["C-7", "C-8", "C-9", "D-1", "C-2"], "full mode shows every row again");
}));

test("the bell counts what is For you, opens on it, reads a row only on its click, shows All on a click, and a row lands on its message; a menu button without data-keep still closes its menu", (t) => open(t, BELL, async (desk) => {
  await desk.waitForFunction(() => document.querySelector("#bell-count")?.hidden === false);
  assert.equal(await desk.textContent("#bell-count"), "1", "the count is what is For you");
  await desk.click("#bell-btn");
  assert.equal(await desk.textContent("#bell-count"), "1", "opening it reads nothing");
  assert.equal(await desk.evaluate(() => posts.length), 0, "and writes nothing");
  await desk.waitForSelector("#notes [data-note]");
  assert.equal(await desk.locator("#notes [data-mark-read]").count(), 1, "Mark as read in the header while a row is unread");
  await desk.click("#notes [data-mark-read]");
  await desk.waitForFunction(() => posts.includes("/api/notifications/seen"));
  assert.equal(await desk.evaluate(() => document.querySelector("#bell").open), true, "Mark as read keeps the panel open");
  assert.equal(await desk.getAttribute('#notes [data-only="1"]', "aria-pressed"), "true", "it opens on For you");
  assert.equal(await desk.locator("#notes [data-note]").count(), 1);
  assert.match(await desk.textContent("#notes [data-note]"), /New comment[\s\S]*PR change:[\s\S]*A new header/, "what happened, the kind in grey, the title");
  await desk.click('#notes [data-only="0"]');
  assert.equal(await desk.locator("#notes [data-note]").count(), 3, "All shows the rest too");
  assert.equal(await desk.evaluate(() => document.querySelector("#bell").open), true, "a tab keeps the panel open");
  await desk.click('#notes [data-only="1"]');
  await desk.click("#notes [data-note]");
  await desk.waitForSelector('#th-t1 [data-m="0"].spot');
  assert.ok(await desk.evaluate(() => posts.includes("/api/notifications/read?id=n1")), "the click reads that row");
  assert.equal(await desk.locator("#bell-count").isHidden(), true, "and the count drops");
  assert.equal(await desk.evaluate(() => document.querySelector("#bell").open), false, "the panel closes");
  assert.equal(await desk.evaluate(() => document.querySelector("[data-convo]").open), true, "the conversation is unfolded");
  // A note from the design workspace opens the workspace on its option, its note picked and lit;
  // the bell's row styles stay in the bell.
  await desk.click("#bell-btn");
  await desk.click('#notes [data-only="0"]');
  await desk.click('#notes [data-note="0"]');
  await desk.waitForSelector('[data-ws-note="t2"][aria-current="true"] .m.spot');
  assert.notEqual(await desk.$eval('[data-ws-note="t2"]', (li) => getComputedStyle(li).display), "grid", "a workspace note is not drawn as a bell row");
  await desk.click("[data-ws-close]");
  // The shared click-away rule: a menu button without data-keep closes its menu.
  await desk.click("#me");
  assert.equal(await desk.evaluate(() => document.querySelector(".me-menu").open), true);
  await desk.click("#theme");
  await desk.waitForFunction(() => !document.querySelector(".me-menu").open);
}));

// Every landing of a notification (docs/desk-page.md → Notifications): its option's tab, its votes,
// the spec, a revoked decision's why, a private answer in the chat, every message a row folds.
const LANDINGS = `<script>
window.posts = [];
const ago = (m) => new Date(Date.now() - m * 60e3).toISOString().replace(/\\.\\d{3}Z$/, "Z");
const card = { id: "C-3", kind: "request", title: "Quieter rows", status: "feedback", triage: { verdict: "design", reasons: [] }, prototype: { state: "none" }, request: { problem: "Rows shout." },
  variants: [{ id: "v1", name: "Calm", asset: "A-1", version: 1 }, { id: "v2", name: "Bold", asset: "A-1", version: 1 }],
  votes: { v2: { "pat@example.com": { vote: "prefer", role: "designer", at: ago(8) } } },
  spec: { asset: "A-2", at: ago(7), by: { agent: true } },
  threads: [{ id: "t3", card: "C-3", kind: "comment", state: "open", messages: [{ by: { email: "pat@example.com" }, at: ago(4), text: "First" }, { by: { email: "kim@example.com" }, at: ago(3), text: "Second" }] }] };
const ask = { id: "p1", kind: "private", state: "answered", created: ago(6), context: { card: "C-3", variant: "v2", label: "C-3 Quieter rows · Bold" },
  messages: [{ by: { email: "a@example.com" }, at: ago(6), text: "Why bold?" }, { by: { agent: true }, at: ago(5), text: "It reads at a glance." }] };
const decision = { id: "D-1", text: "Soft badges", status: "revoked", at: ago(60), concepts: [], revoked: { by: { email: "pat@example.com" }, at: ago(2), reason: "Changed our mind" } };
const row = (x) => ({ kind: "request", item: "C-3", title: "Quieter rows", by: { email: "pat@example.com" }, for_you: false, count: 1, people: [{ email: "pat@example.com" }], ...x });
const items = [row({ at: ago(9), event: "options-drawn", variant: "v2", by: { agent: true } }), row({ at: ago(8), event: "vote", variant: "v2" }), row({ at: ago(7), event: "spec", by: { agent: true } }),
  { at: ago(2), event: "revoked", item: "D-1", kind: "decision", title: "Soft badges", by: { email: "pat@example.com" }, detail: "Changed our mind", for_you: false, count: 1, people: [] },
  row({ at: ago(5), event: "answer", by: { agent: true }, thread: "p1", msg: 1, private: true, for_you: true }),
  row({ at: ago(3), event: "reply", thread: "t3", msg: 1, count: 2, marks: [["t3", 1], ["t3", 0]] })];
window.platform = { async request({ method, path }) {
  if (method === "POST") { posts.push(path); return { status: 200, contentType: "application/json", body: JSON.stringify(path === "/api/notifications/seen" ? { seen: ago(0) } : {}) }; }
  const answer = path === "/api/me" ? { role: "designer", email: "a@example.com", key: "a@example.com", can: { comment: true, ask: true, vote: true } }
    : path === "/api/cards" ? { cards: [card] } : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE}
    : path === "/api/notifications" ? { items, seen: null, unread: 1 } : path === "/api/private" ? { asks: [ask] }
    : path === "/api/cards/C-3" ? { card } : path === "/api/decisions/D-1" ? { decision, refs: [] } : path.startsWith("/api/decisions") ? { decisions: [decision] }
    : path === "/api/assets/A-1" ? { id: "A-1", contentType: "text/html", encoding: "utf8", data: "<body><button>Send</button></body>" }
    : path === "/api/assets/A-2" ? { id: "A-2", contentType: "text/markdown", encoding: "utf8", data: "# The spec" } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;
test("a notification lands on its source: the option's tab, the votes, the spec (lit again after a redraw, dark after 3 s), a revoked decision's why, a private answer, every message of a folded row", (t) => open(t, LANDINGS, async (desk) => {
  await desk.waitForFunction(() => document.querySelector("#bell-count")?.hidden === false);
  const land = async (i) => {
    if (!(await desk.evaluate(() => document.querySelector("#bell").open))) await desk.click("#bell-btn");
    await desk.click('#notes [data-only="0"]');
    await desk.click(`#notes [data-note="${i}"]`);
  };
  await land(0);
  await desk.waitForSelector('.vtabs [data-variant="v2"].spot');
  assert.equal(await desk.getAttribute('.vtabs [data-variant="v2"]', "aria-pressed"), "true", "options drawn: their tab is picked");
  await land(1);
  await desk.waitForSelector(".vbar .votes.spot");
  await land(2);
  await desk.waitForSelector("#spec.spot");
  assert.equal(await desk.$eval("#spec", (d) => d.open), true, "the spec unfolds");
  // The page draws again: the glow finds the spec anew; then it ends.
  await desk.evaluate(() => { document.querySelector("#spec").dataset.old = "1"; });
  await desk.click('[data-variant="v1"]');
  await desk.waitForSelector("#spec.spot:not([data-old])");
  await desk.waitForFunction(() => !document.querySelector(".spot"), null, { timeout: 6000 });
  await land(3);
  await desk.waitForSelector(".against.spot");
  assert.match(await desk.textContent(".against.spot"), /Changed our mind/, "a revoked decision: why it was revoked");
  await land(4);
  await desk.waitForSelector('#ask [data-m="p1:1"].spot');
  await land(5);
  await desk.waitForSelector('#th-t3 [data-m="1"].spot');
  assert.equal(await desk.locator('#th-t3 [data-m="0"].spot').count(), 1, "a folded row lights every message it holds");
  assert.equal(await desk.locator("#ask .ask-panel").count(), 0, "a public notification closes the private chat");
}));

// Designs (docs/desk-page.md → Designs): a developer's tab of approved designs; a designer reaches one only from a notification.
const designsBridge = (role) => `<script>
window.posts = [];
const ask = { id: "T-1", card: "C-1", kind: "comment", dev: true, state: "open", messages: [{ by: { email: "bob@example.com", role: "developer" }, at: "2026-11-07T10:00:00Z", text: "Is the banner sticky?" }] };
const done = { id: "T-2", card: "C-1", kind: "comment", dev: true, state: "resolved", messages: [{ by: { email: "dana@example.com", role: "developer" }, at: "2026-11-06T10:00:00Z", text: "Which grey is the border? ${"It reads lighter than the rest of the page. ".repeat(4)}" }] };
const sent = { id: "C-1", kind: "request", title: "Daily limit banner", status: "handed-off", built: null, from: "C-4", by: { email: "alice@example.com" } };
const change = { id: "C-4", kind: "change", title: "Widgets reorder", status: "new", source: { repo: "acme/widgets", pr: 318, url: "https://github.com/acme/widgets/pull/318" } };
const open = { id: "C-3", kind: "request", title: "Still open", status: "triage" };
const card = { ...sent, request: { problem: "Limits are missed.", from: "C-4", figma: "https://www.figma.com/design/abc/Limits" }, variants: [{ id: "v1", name: "Banner", asset: "A-1" }, { id: "v2", name: "Inline", asset: "A-2" }],
  approved: { by: { email: "alice@example.com", role: "designer" }, at: "2026-11-05T09:00:00Z", variant: "v1" }, spec: { asset: "A-3", review: "sent", issue_url: "https://github.com/acme/widgets/issues/142" },
  dev_summary: { text: "- Above the widgets, not a toast (Alice).", at: "2026-11-05T09:00:00Z" }, threads: [done, ask] };
window.platform = { async request({ method, path, body }) {
  if (method === "POST") { posts.push({ path, body: JSON.parse(body || "{}") }); return { status: 200, contentType: "application/json", body: JSON.stringify(path.endsWith("/built") ? { card: { ...card, built: { by: { email: "bob@example.com" }, at: "2026-11-07T11:00:00Z" } } } : {}) }; }
  const answer = path === "/api/me" ? { role: "${role}", email: "${role}@example.com", key: "${role}@example.com", simple: false, names: { "alice@example.com": "Alice", "dana@example.com": "Dana" },
      can: ${role === "developer" ? `{ comment: true, ask: true, designs: true, built: true }` : `{ comment: true, ask: true, approve: true }`} }
    : path === "/api/cards" ? { cards: [sent, change, open] } : path === "/api/agenda" ? { agenda: [] } : path === "/api/private" ? { asks: [] }
    : path === "/api/cards/C-1" ? { card } : path === "/api/cards/C-4" ? { card: change } : path === "/api/cards/C-3" ? { card: { ...open, threads: [] } }
    : path === "/api/notifications" ? { seen: null, unread: 1, items: [{ at: "2026-11-07T10:00:00Z", event: "dev-question", item: "C-1", kind: "request", title: "Daily limit banner", status: "handed-off",
        by: { email: "bob@example.com", role: "developer" }, people: [{ email: "bob@example.com" }], count: 1, for_you: true, designs: true, thread: "T-1", msg: 0, marks: [["T-1", 0]], detail: "Is the banner sticky?" }] } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;

test("Designs: a developer opens an approved design from its own tab, read-only, marks it done and asks its designer", (t) => open(t, designsBridge("developer"), async (desk) => {
  await desk.waitForSelector('[data-tab="designs"]');
  assert.equal(await desk.textContent('[data-tab="designs"] .count'), "1", "the tab counts what is still to build");
  await desk.click('[data-tab="designs"]');
  assert.deepEqual(await desk.locator("#list .row.item .t > span:first-child").allInnerTexts(), ["Daily limit banner"], "only a request sent to developers");
  // A private ask from the Designs list names the Designs page and its filter.
  await desk.click('[data-filter="designFilter:done"]');
  await desk.click("[data-ask-open]");
  await desk.fill("#ask-text", "What goes here?");
  await desk.click("[data-ask-send]");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/private"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/private").body.context), { page: "designs", filter: "done", label: "Designs page · done" });
  await desk.click("[data-ask-close]");
  await desk.waitForSelector("#ask .ask-panel", { state: "detached" });
  await desk.click('[data-filter="designFilter:todo"]');
  await desk.click("#list .row.item .open");
  await desk.waitForSelector("#detail .status");
  assert.equal(await desk.getAttribute('[data-tab="designs"]', "aria-current"), "true", "a row opens on Designs, not on Requests");
  assert.match(await desk.textContent("#detail .status"), /Approved\s*approved by Alice/);
  assert.deepEqual(await desk.locator("#detail .status a.btn").allInnerTexts(), ["Issue ↗", "PR ↗", "Figma ↗"], "the issue, the PR it comes from, Figma; no numbers");
  assert.equal(await desk.getAttribute('#detail .status a.btn:has-text("PR")', "href"), "https://github.com/acme/widgets/pull/318");
  assert.equal(await desk.locator("#detail .vtabs, #detail [data-act], #detail .votes").count(), 0, "read-only: no options to pick, no actions, no votes");
  assert.match(await desk.textContent("#detail"), /UX decisions\s*AI\s*Above the widgets, not a toast/);
  // The open question leads; the done one folds to one line: its asker — its first words.
  assert.deepEqual(await desk.locator("#detail .design-asks > *").evaluateAll((els) => els.map((e) => e.tagName)), ["ARTICLE", "DETAILS"]);
  assert.match(await desk.textContent("#detail .thread.mini > summary"), /Developer asks\s*Dana — Which grey/);
  // Document order: the list, then the folded question inside it.
  const [list, box] = await desk.$$eval("#detail .thread.mini, #detail .design-asks", (els) => els.map((e) => e.getBoundingClientRect().width));
  assert.ok(box <= list + 1, "a long folded question keeps to the column");
  const bare = await desk.$$eval("#detail button, #detail a.btn, #detail .chip", (els) => els.filter((e) => e.getClientRects().length && !e.title && !e.dataset.tip && !e.getAttribute("aria-label")).map((e) => e.outerHTML.slice(0, 120)));
  assert.deepEqual(bare, [], "everything says on hover what it does");
  await desk.click("[data-built]");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/built"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/built").body), { built: true });
  await desk.fill("#composer-text", "Does it show on mobile?");
  await desk.click('[data-post="designer"]');
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/threads"));
  assert.deepEqual(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/threads").body), { kind: "comment", text: "Does it show on mobile?", dev: true });
  // The design and its request open each other: Open the request, then the step pill's Show the design.
  await desk.click("[data-show-request]");
  await desk.waitForSelector("#detail .steppill [data-show-design]");
  assert.equal(await desk.getAttribute('[data-tab="requests"]', "aria-current"), "true", "the request opens on Requests");
  assert.equal(await desk.textContent("#detail .steppill .step-next"), "Show the design");
  await desk.click("[data-show-design]");
  await desk.waitForSelector("#detail [data-show-request]");
  assert.equal(await desk.getAttribute('[data-tab="designs"]', "aria-current"), "true", "back on Designs");
}));

test("Designs: a designer has no tab, opens a design from its notification or its link, without the box to ask or Mark as done", (t) => open(t, designsBridge("designer"), async (desk) => {
  await desk.waitForSelector('[data-tab="requests"]');
  assert.equal(await desk.locator('[data-tab="designs"]').count(), 0);
  // A request's comment box: Comment leads, Ask Design Desk is the second button.
  await desk.evaluate(() => { location.hash = "#C-3"; });
  await desk.waitForSelector("#composer .bar");
  assert.deepEqual(await desk.locator("#composer .bar button").allInnerTexts(), ["Comment", "Ask Design Desk"]);
  assert.deepEqual(await desk.locator("#composer .bar button.primary").evaluateAll((els) => els.map((e) => e.dataset.post)), ["comment"]);
  // A developer's question lands on Designs, its message lit.
  await desk.click("#bell-btn");
  await desk.click('#notes [data-note="0"]');
  await desk.waitForSelector('#th-T-1 [data-m="0"].spot');
  assert.ok(await desk.locator("#detail .status").count(), "the design's page, not the request's");
  assert.equal(await desk.locator("#detail .vtabs").count(), 0);
  // Its link opens it too: the hash is still the request's from above.
  await desk.click('[data-tab="requests"]');
  await desk.evaluate(() => { location.hash = "#designs/C-1"; });
  await desk.waitForSelector("#detail .design-asks");
  assert.equal(await desk.locator("#detail [data-built], #detail [data-post]").count(), 0, "the designer answers in the thread");
  assert.equal(await desk.locator("#detail .design-asks article [data-send-reply]").count(), 1);
  // Its request is a click away; the request's step pill has no Show the design without Designs.
  await desk.click("[data-show-request]");
  await desk.waitForSelector("#detail .steppill");
  assert.equal(await desk.locator("#detail [data-show-design]").count(), 0);
}));

// A request sent, reopened and sent again (docs/desk-page.md → Designs, docs/handoff.md step 6); a live prototype switched off (docs/prototype.md → Teardown).
const sendsBridge = (role, over) => `<script>
window.posts = [];
const closed = { by: { email: "lee@example.com", role: "admin" }, at: "2026-11-07T12:00:00Z" };
const card = { id: "C-1", kind: "request", title: "Daily limit banner", by: { email: "alice@example.com" }, triage: { verdict: "design", reasons: ["Look only."] }, request: { problem: "Limits are missed." },
  variants: [{ id: "v1", name: "Banner", asset: "A-1" }], threads: [],
  sends: [{ approved: { by: { email: "alice@example.com", role: "designer" }, at: "2026-11-01T09:00:00Z", variant: "v1" }, spec: { issue_url: "https://github.com/acme/widgets/issues/99" }, dev_summary: { text: "- The first try." }, built: null, threads: [], closed }],
  ...${JSON.stringify(over)} };
window.platform = { async request({ method, path, body }) {
  if (method === "POST") { posts.push({ path, body: JSON.parse(body || "{}") }); return { status: 200, contentType: "application/json", body: JSON.stringify({ card }) }; }
  const answer = path === "/api/me" ? { role: "${role}", email: "${role}@example.com", key: "${role}@example.com", simple: false, spec_review: true, handoff: { idea: "issue" }, names: {},
      can: { comment: true, ask: true, designs: true, built: true, build: true, approve: true, skip: true, reopen: true, close: true } }
    : path === "/api/cards" ? { cards: [{ id: "C-1", kind: "request", title: card.title, status: card.status, built: null, sends: card.sends.map((s) => ({ closed: s.closed, built: null })), by: card.by }] }
    : path === "/api/agenda" ? { agenda: [] } : path === "/api/private" ? { asks: [] } : path === "/api/notifications" ? { seen: null, unread: 0, items: [] }
    : path === "/api/cards/C-1" ? { card }
    : path.startsWith("/api/github") ? { records: [{ key: "acme/widgets#99", kind: "issue", state: "open", assignees: ["dana-dev"], labels: [] }] } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;

test("Designs: an earlier send of a reopened request is its own closed row under Done, read-only", (t) => open(t, sendsBridge("developer", { status: "variants", team_feedback: { state: "waiting" } }), async (desk) => {
  await desk.waitForSelector('[data-tab="designs"]');
  await desk.click('[data-tab="designs"]');
  await desk.click('[data-filter="designFilter:done"]');
  assert.match(await desk.textContent("#list .row.item"), /Daily limit banner\s*C-1 · earlier send/);
  await desk.click("#list .row.item .open");
  await desk.waitForSelector("#detail .status");
  assert.match(await desk.textContent("#detail .status"), /Closed[\s\S]*reopened by/);
  assert.equal(await desk.getAttribute('#detail .status a.btn:has-text("Issue")', "href"), "https://github.com/acme/widgets/issues/99", "the earlier send's issue");
  assert.equal(await desk.locator("#detail [data-built], #detail #composer").count(), 0, "no Mark as done, no box to ask");
}));

test("a send after a reopen shows the earlier issue's state and assignee, and closes it only when ticked", (t) => open(t, sendsBridge("designer", { status: "spec", approved: { by: { email: "designer@example.com", role: "designer" }, at: "2026-11-07T13:00:00Z", variant: "v1" }, spec: { asset: "A-3", review: "draft" } }), async (desk) => {
  await desk.evaluate(() => { location.hash = "#C-1"; });
  await desk.click("[data-spec-send]");
  await desk.waitForSelector("#cf-check3-wrap:not([hidden])");
  assert.match(await desk.textContent("#confirm-dialog"), /The earlier send:\s*Issue #99 · Open · assignee: dana-dev/);
  assert.match(await desk.textContent("#cf-check3-label"), /Close Issue #99 on GitHub/);
  assert.equal(await desk.isChecked('[name="check3"]'), false, "off until ticked");
  await desk.check('[name="check3"]');
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/spec"));
  assert.equal(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/spec").body.close_earlier), true);
}));

test("only an admin reopens a sent request, from ⋯, behind a confirmation", (t) => open(t, sendsBridge("admin", { status: "handed-off", sends: [], approved: { by: { email: "alice@example.com", role: "designer" }, at: "2026-11-05T09:00:00Z", variant: "v1" }, spec: { issue_url: "https://github.com/acme/widgets/issues/142", review: "sent" } }), async (desk) => {
  await desk.evaluate(() => { location.hash = "#C-1"; });
  await desk.click("#detail .status details.more > summary");
  await desk.click('#detail .status [data-act="reopen"]');
  assert.match(await desk.textContent("#confirm-dialog"), /Reopen a request sent to developers\?[\s\S]*before the team's vote[\s\S]*stays as it is/);
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/actions"));
  assert.equal(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/actions").body.action), "reopen");
}));

test("a live prototype is switched off behind a confirmation; the demo hint and a passed check do not show", (t) => open(t, sendsBridge("designer", { status: "testing", sends: [], live_pick: { variant: "v1", name: "Banner", version: 1 }, prototype: { state: "live", url: "https://example.com/p", expires: "2030-12-01T10:00:00Z", login: { user: "designer", password: "x", hint: "A demo account of this prototype only." }, guard: { ok: true } } }), async (desk) => {
  await desk.evaluate(() => { location.hash = "#C-1"; });
  await desk.waitForSelector("[data-switch-off]");
  assert.doesNotMatch(await desk.textContent("#detail"), /A demo account of this prototype only|Look-only check/, "no hint, no passed check");
  await desk.click("[data-switch-off]");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => posts.some((p) => p.path === "/api/cards/C-1/actions"));
  assert.equal(await desk.evaluate(() => posts.find((p) => p.path === "/api/cards/C-1/actions").body.action), "switch-off");
}));

test("a prototype switched off before its expiry names no date and no cause", (t) => open(t, sendsBridge("designer", { status: "testing", sends: [], prototype: { state: "torn-down", expires: "2030-12-01T10:00:00Z" } }), async (desk) => {
  await desk.evaluate(() => { location.hash = "#C-1"; });
  await desk.waitForSelector("#detail .status");
  const text = await desk.textContent("#detail .status");
  assert.match(text, /This prototype was switched off\./);
  assert.doesNotMatch(text, /2030|free its place/);
}));

// What's already known: every source starts with what it is; a page previews its section and
// words as text; a link to code is left out, any other saved earlier shows as a plain Link
// (docs/requests.md → Research, step 6).
const SOURCES = `<script>
const req = { id: "C-2", kind: "request", title: "Pick a harness", status: "triage", request: { problem: "The harness menu is hard to find." },
  research: { verdict: "clear", summary: "Asked before.", links: [
    { label: "Issue #5", url: "https://github.com/acme/widgets/issues/5" },
    { label: "Menu #6", url: "https://github.com/acme/widgets/pull/6" },
    { ref: "C-1", label: "A new header" },
    { ref: "D-1", label: "Search sits in the header" },
    { label: "Terminals guide", url: "https://github.com/acme/widgets/blob/main/docs/terminals.md#start", section: "Start", excerpt: "Press <b>New</b> & pick one." },
    { label: "0012 Harness", url: "https://github.com/acme/widgets/blob/main/docs/adr/0012-harness.md#decision", section: "Decision", excerpt: "The default starts first." },
    { label: "menu.tsx", url: "https://github.com/acme/widgets/blob/main/src/menu.tsx" },
    { label: "Design note", url: "https://www.figma.com/design/abc/Notes" },
    { label: "Old guide", url: "https://github.com/acme/widgets/blob/main/docs/old.md" },
    { ref: "C-99" },
    { label: "a1b2c3", url: "https://github.com/acme/widgets/commit/a1b2c3" },
    { label: "raw.ts", url: "https://raw.githubusercontent.com/acme/widgets/main/src/a.ts" },
    { label: "Menu.TSX", url: "https://github.com/acme/widgets/tree/main/src/Menu.TSX" },
    { label: "build.kts", url: "https://github.com/acme/widgets/raw/main/build.kts" },
  ] } };
const cards = [{ id: "C-1", kind: "change", title: "A new header", source: { repo: "acme/widgets", pr: 45 } }, req];
window.platform = { async request({ path }) {
  const one = path.startsWith("/api/cards/") && cards.find((c) => c.id === decodeURIComponent(path.slice(11)));
  const answer = path === "/api/me" ? { role: "designer", email: "d@example.com", can: {} }
    : path === "/api/cards" ? { cards } : path === "/api/agenda" ? { agenda: [] }
    : path.startsWith("/api/decisions/") ? { decision: { id: "D-1", text: "Search sits in the header", status: "active", concepts: [] } }
    : path.startsWith("/api/github") ? { records: [] } : one ? { card: one } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;

test("research sources say what they are; a page previews its section; code links are left out, older links show plainly", (t) => open(t, SOURCES, async (desk) => {
  const base = desk.url().replace(/#.*$/, "");
  await desk.goto(`${base}#C-2`);
  await desk.waitForSelector(".made-sec ul li");
  const rows = await desk.$$eval(".made-sec ul li", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  assert.deepEqual(rows, ["Issue · #5", "PR · Menu #6", "PR Change · C-1 A new header", "Decision · D-1 Search sits in the header",
    "Doc · Terminals guide", "ADR · 0012 Harness", "Link · Design note", "Doc · Old guide", "Item · C-99"],
    "each starts with its kind; a commit and every code file (blob, tree, raw, any case) are left out; the older link and a number no longer on the Desk stay");
  assert.equal(await desk.$$eval(".made-sec a[data-doc]", (els) => els.map((e) => e.textContent).join("|")), "Terminals guide|0012 Harness", "a page saved with no excerpt previews nothing");
  await desk.hover(".made-sec a[data-doc-kind='Doc']");
  await desk.waitForSelector("#peek");
  assert.match(await desk.textContent("#peek"), /Terminals guide[\s\S]*Doc[\s\S]*§ Start[\s\S]*“Press <b>New<\/b> & pick one\.”/, "a page previews its section and its words");
  assert.equal(await desk.$("#peek b b"), null, "the words are text, never markup");
}));

// Questions and comments folds under its heading: open for everyone at first, as the person
// left it while the page is open, and open again wherever the page writes into it or points at
// a thread in it (a post, a concern vote, a brief from a private ask, a thread's notification).
test("Questions and comments starts open, keeps how it was left, and reopens where the page needs it", async (t) => {
  const fold = /<details class="talk" data-sect="talk"\$\{S\.sect\.talk === false \? "" : " open"\}><summary><h3>Questions and comments<\/h3><\/summary>/;
  assert.match(page, fold, "the part is a fold, open unless the person shut it");
  assert.match(page, /if \(ds\.post\) \{ S\.convoOpen = true; S\.sect\.talk = true;/, "a post opens it");
  assert.match(page, /if \(vote === "concern"\) S\.sect\.talk = true;\s*await openCard\(S\.card\.id\);/, "a concern vote opens it before the box is filled");
  assert.match(page, /const talk = pub\.closest\("details\.talk"\); S\.sect\.talk = true; if \(talk\) talk\.open = true;\s*pub\.value = briefFrom\(th\)/, "a brief opens it before the box is filled");
  assert.match(page, /if \(x\.thread && !x\.private\) \{ S\.convoOpen = true; S\.sect\.talk = true; \}/, "a thread's notification opens it");
  const run = await launch(t, BRIDGE);
  if (!run) return;
  const { desk, close } = run;
  try {
    await desk.waitForSelector('[data-tab="new"]');
    await desk.click('[data-tab="new"]');
    await desk.click('[data-card="ch1"]');
    await desk.waitForSelector("details.talk");
    assert.equal(await desk.evaluate(() => document.querySelector("details.talk").open), true, "open at first");
    await desk.click("details.talk > summary");
    await desk.waitForFunction(() => !document.querySelector("details.talk").open);
    await desk.click('[data-tab="requests"]');
    await desk.click('[data-tab="new"]');
    await desk.click('[data-card="ch1"]');
    await desk.waitForSelector("details.talk");
    assert.equal(await desk.evaluate(() => document.querySelector("details.talk").open), false, "shut, it stays shut on the item's next open");
  } finally { await close(); }
});

// A Desk for the help, the poll and the request work line: one bridge, the person and the cards
// as each test needs them. `window.more` adds a request, `window.rename` renames one, so a poll
// redraws the menu or the list.
const DESK = (me, cards) => `<script>
const cards = ${JSON.stringify(cards)};
window.platform = { async request({ path }) {
  const all = () => [...cards.map((c) => window.rename && c.id === "r2" ? { ...c, title: "Renamed" } : c), ...(window.more ? [{ id: "r9", kind: "request", title: "One more", status: "triage" }] : [])];
  const answer = path === "/api/me" ? ${JSON.stringify(me)}
    : path === "/api/cards" ? { cards: all() } : path.startsWith("/api/cards/") ? { card: all().find((c) => c.id === path.split("/")[3]) }
    : path === "/api/agenda" ? { agenda: [] } : path === "/api/people" ? ${PEOPLE}
    : path.startsWith("/api/assets/") ? { contentType: "image/svg+xml", encoding: "utf8", data: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>' } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
try { localStorage.setItem("desk-guide-seen", "1"); } catch {}
</script>`;
const DESIGNER = { role: "designer", email: "d@example.com", simple: false, can: { request: true } };
// A request Design Desk is drawing for: the page polls every 4 seconds while it is open.
const BUSY = { id: "r1", kind: "request", title: "Busy", status: "triage", waiting: [{ kind: "explore", state: "open", created: "2026-11-01T00:00:00Z" }] };

test("a poll redraw keeps keyboard focus, and an unchanged menu is left as it is", (t) => open(t, DESK(DESIGNER, [BUSY, { id: "r2", kind: "request", title: "Other", status: "triage" }]), async (desk) => {
  await desk.waitForSelector('#list [data-card="r1"]');
  await desk.click('#list [data-card="r1"]');
  await desk.waitForSelector("#detail .crumb", { state: "attached" });
  const focused = () => desk.evaluate(() => ({ tab: document.activeElement?.dataset.tab || null, card: document.activeElement?.dataset.card || null }));
  // Nothing changed: the menu stays the same element, focus with it.
  await desk.focus('#nav [data-tab="product"]');
  const before = await desk.$('#nav [data-tab="product"]');
  await desk.waitForTimeout(6000);
  assert.equal(await before.evaluate((e) => document.contains(e)), true, "an unchanged menu is not redrawn");
  assert.equal((await focused()).tab, "product");
  // A new request changes the count: the menu is drawn anew, and focus comes back to the same tab.
  await desk.evaluate(() => { window.navProbe = document.querySelector('#nav [data-tab="product"]'); window.more = true; });
  await desk.waitForFunction(() => !document.contains(window.navProbe), null, { timeout: 10000 });
  assert.equal((await focused()).tab, "product", "a redrawn menu focuses the same tab again");
  // A renamed request redraws the list: focus stays on its row.
  await desk.focus('#list [data-card="r2"]');
  const row = await desk.$('#list [data-card="r2"]');
  await desk.evaluate(() => { window.rename = true; });
  await desk.waitForFunction(() => document.querySelector('#list [data-card="r2"]')?.textContent.includes("Renamed"), null, { timeout: 10000 });
  assert.equal(await row.evaluate((e) => document.contains(e)), false, "the list was drawn anew");
  assert.equal((await focused()).card, "r2", "a redrawn list focuses the same row again");
}));

// A request whose options were drawn after its item was filed: that item's work is done for the
// person. One reopened and checked again, its item filed after its options: it still checks.
const OPTION = { id: "v1", name: "Calm", asset: "A-1", version: 1, drawn: "2026-11-02T00:00:00Z" };
const CHECKED = { kind: "request", status: "feedback", triage: { verdict: "design", reasons: ["Look only."] }, variants: [OPTION] };
test("a request's own work line leaves once its options are drawn, and shows again when it is reopened", (t) => open(t, DESK(DESIGNER, [
  { ...CHECKED, id: "r1", title: "Drawn", waiting: [{ kind: "request", state: "claimed", created: "2026-11-01T00:00:00Z" }] },
  { ...CHECKED, id: "r2", title: "Reopened", waiting: [{ kind: "request", state: "open", created: "2026-11-05T00:00:00Z" }] }]), async (desk) => {
  const lines = () => desk.$$eval("#detail .working, #detail .s-work", (els) => els.map((e) => e.textContent).join(" "));
  await desk.click('#list [data-card="r1"]');
  await desk.waitForSelector("#detail .crumb", { state: "attached" });
  assert.doesNotMatch(await lines(), /Reading the screen/, "options drawn after the item: no Checking line");
  await desk.click('#list [data-card="r2"]');
  await desk.waitForFunction(() => document.querySelector("#detail h2")?.textContent.includes("Reopened"));
  assert.match(await lines(), /Reading the screen/, "a reopened request, checked again, says so");
}));

test("a caption that only repeats its stage is not said twice", (t) => open(t, DESK(DESIGNER, [{ id: "ch1", kind: "change", title: "Pairs", source: { repo: "acme/widgets", pr: 3 },
  screens: [{ asset: "A-1", caption: "Before", stage: "before", pair: "home" }, { asset: "A-2", caption: "After the redesign", stage: "after", pair: "home" }] }]), async (desk) => {
  await desk.click('[data-tab="new"]');
  await desk.click('#list [data-card="ch1"]');
  await desk.waitForSelector("#detail figcaption");
  const caps = await desk.$$eval("#detail figcaption", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  assert.doesNotMatch(caps[0], /Before Before/, "Before under Before is said once");
  assert.match(caps[1], /^After After the redesign/, "a caption that says more stays");
}));

test("How it works and Designs show the developer's process; simple mode leaves out its steps", (t) => open(t, DESK({ role: "developer", email: "dev@example.com", simple: false, can: { request: true, designs: true, built: true } }, []), async (desk) => {
  await desk.waitForSelector('[data-tab="designs"]');
  await desk.click('[data-tab="designs"]');
  await desk.waitForSelector('#detail [data-intro="designs"] ol.steps');
  assert.match(await desk.textContent('#detail [data-intro="designs"] .acts'), /Ask the designer/, "Designs has its own steps, with the developer's buttons");
  await desk.click("#me");
  await desk.click("#help");
  await desk.waitForSelector("#detail > .guide");
  const heads = await desk.$$eval("#detail .guide h3", (els) => els.map((e) => e.textContent));
  assert.ok(heads.includes("Sent to developers"), "a role that sees Designs gets its process in How it works");
  assert.match(await desk.textContent("#detail .guide"), /Mark as done/);
}));

test("simple mode leaves the live prototype step out of the help", (t) => open(t, DESK({ ...DESIGNER, simple: true, can: { request: true, build: true } }, [BUSY]), async (desk) => {
  await desk.waitForSelector('#detail [data-intro="requests"] ol.steps');
  const steps = await desk.textContent('#detail [data-intro="requests"] ol.steps');
  assert.match(steps, /New request/);
  assert.doesNotMatch(steps, /live prototype/i, "a step only about what simple mode hides leaves with it");
}));

// A dialog with something typed or picked asks before Escape or a click outside closes it;
// its own Cancel closes it at once. The For Designers / For Developers switch is a lead
// developer's and an admin's (docs/desk.md → Where it works, For Developers or For Designers).
test("a dialog with work in it asks before Escape or a click outside closes it; Cancel closes it at once", (t) => open(t, DESK(DESIGNER, [BUSY]), async (desk) => {
  const isOpen = (id) => desk.evaluate((i) => document.getElementById(i).open, id);
  await desk.waitForSelector("#new-request");
  await desk.click("#new-request");
  assert.equal(await desk.isVisible("#rq-for"), false, "a designer does not pick the tab");
  await desk.keyboard.press("Escape");
  assert.equal(await isOpen("request-dialog"), false, "an empty dialog closes on Escape");

  await desk.click("#new-request");
  await desk.fill("#request-dialog textarea[name=problem]", "Make the list calmer");
  await desk.keyboard.press("Escape");
  await desk.waitForSelector("#confirm-dialog[open]");
  assert.match(await desk.textContent("#cf-title"), /Close without sending/);
  assert.equal(await isOpen("request-dialog"), true, "Escape keeps what was typed until the person says so");
  await desk.click("#confirm-dialog .actions button:has-text('Cancel')");
  assert.deepEqual([await isOpen("confirm-dialog"), await isOpen("request-dialog")], [false, true], "Cancel in the question goes back to the dialog");
  await desk.mouse.click(4, 4);
  await desk.waitForSelector("#confirm-dialog[open]");
  assert.equal(await isOpen("request-dialog"), true, "a click outside asks too");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => !document.getElementById("confirm-dialog").open && !document.getElementById("request-dialog").open, null, { timeout: 5000 });

  await desk.click("#new-request");
  await desk.click("#request-dialog #type-choice button[data-type=bug]");
  await desk.keyboard.press("Escape");
  await desk.waitForSelector("#confirm-dialog[open]");
  assert.equal(await isOpen("request-dialog"), true, "a picked choice counts as work too");
  await desk.click("#cf-ok");
  await desk.waitForFunction(() => !document.getElementById("request-dialog").open, null, { timeout: 5000 });

  await desk.click("#new-request");
  await desk.fill("#request-dialog textarea[name=problem]", "Make the list calmer");
  await desk.click("#request-dialog .actions button:has-text('Cancel')");
  assert.deepEqual([await isOpen("confirm-dialog"), await isOpen("request-dialog")], [false, false], "the dialog's own Cancel closes it at once");
}));

test("a lead developer picks For Designers or For Developers when filing", (t) => open(t, DESK({ ...DESIGNER, role: "lead-developer", can: { request: true, size: true } }, [BUSY]), async (desk) => {
  await desk.waitForSelector("#new-request");
  await desk.click("#new-request");
  assert.equal(await desk.isVisible("#rq-for"), true);
}));

// A picture dropped anywhere on a dialog is added as if chosen with "choose a file".
test("a picture dropped on a dialog is added to it", (t) => open(t, DESK(DESIGNER, [BUSY]), async (desk) => {
  await desk.waitForSelector("#new-request");
  await desk.click("#new-request");
  await desk.evaluate(async () => {
    const c = Object.assign(document.createElement("canvas"), { width: 40, height: 30 });
    c.getContext("2d").fillRect(0, 0, 40, 30);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
    const on = document.querySelector("#rq-problem-label");
    on.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
    on.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await desk.waitForSelector("#rq-thumbs img");
  assert.equal(await desk.locator("#rq-thumbs img").count(), 1);
  assert.match(await desk.textContent("#rq-drop"), /drop it here/);
}));

// The step pill's next move: Wait while Design Desk works, with a few words on what it does;
// Answer while it waits on a person, when nothing pulses.
const ASKING = { id: "r3", kind: "request", title: "Asking", status: "triage", asks: true,
  threads: [{ id: "t9", kind: "asks", state: "open", step: "request", messages: [{ by: { agent: true }, at: "2026-11-01T00:00:00Z", text: "One question first." }],
    questions: [{ text: "Which one?", options: ["A", "B"], suggested: "A" }] }] };
test("the step pill says Wait while Design Desk works and Answer while it waits on a person", (t) => open(t, DESK(DESIGNER, [BUSY, ASKING]), async (desk) => {
  await desk.waitForSelector('#list [data-card="r1"]');
  await desk.click('#list [data-card="r1"]');
  await desk.waitForSelector("#detail .steppill .step-next");
  assert.equal(await desk.textContent("#detail .steppill .step-next"), "Wait");
  assert.equal(await desk.textContent("#detail .status .s-work"), "Drawing the options", "a few words on what it does");
  assert.equal(await desk.textContent("#detail .status .s-eta"), "· in the queue, starts within 10 minutes", "and how long: not picked up yet");
  assert.equal(await desk.locator("#detail .status > .working").count(), 0, "no second working line");
  await desk.click('#list [data-card="r3"]');
  await desk.waitForFunction(() => document.querySelector("#detail .steppill .step-next")?.textContent === "Answer");
  assert.equal(await desk.getAttribute("#detail .status", "data-o"), "turn", "a person's move, not checking");
  assert.match(await desk.textContent("#detail .status .s-act"), /1 question below/);
  assert.equal(await desk.$eval("#detail .status .s-mark", (m) => getComputedStyle(m).animationName), "none", "nothing pulses");
}));

// The state's mark pulses only while Design Desk works: a checked request that waits for a
// person to start the options reads Checked, in a person's ink, and its mark stays still.
const STILL = { id: "r5", kind: "request", title: "Checked", status: "triage", triage: { verdict: "design", reasons: ["Look only."] } };
test("the state's mark pulses while Design Desk works and stays still while it waits on a person", (t) => open(t, DESK({ ...DESIGNER, can: { request: true, explore: true } }, [BUSY, STILL]), async (desk) => {
  await desk.waitForSelector('#list [data-card="r1"]');
  await desk.click('#list [data-card="r1"]');
  await desk.waitForSelector("#detail .status[data-busy]");
  assert.equal(await desk.$eval("#detail .status .s-mark", (m) => getComputedStyle(m).animationName), "pulse", "it works: the mark pulses");
  await desk.click('#list [data-card="r5"]');
  await desk.waitForFunction(() => document.querySelector("#detail .status") && !document.querySelector("#detail .status[data-busy]"));
  assert.equal(await desk.getAttribute("#detail .status", "data-o"), "turn", "a person's move");
  assert.match(await desk.textContent("#detail .s-word"), /^Checked/, "Checked, no longer Checking");
  assert.equal(await desk.$eval("#detail .status .s-mark", (m) => getComputedStyle(m).animationName), "none", "it waits: nothing pulses");
}));

// What's already known: each part of Design Desk's short report is its own paragraph; a
// request that asked for no options keeps the options box, with its one line in it.
const KNOWN = { id: "r4", kind: "request", title: "Known", status: "feedback", request: { problem: "Calmer.", options: 0 }, triage: { verdict: "design", reasons: ["Look only."] },
  research: { verdict: "clear", summary: "Nothing in the way. Where it lives: the Agents list. Already asked for: none found. History: spaced out in May.", links: [] } };
test("the research summary splits into its parts; no options asked for keeps the options box", (t) => open(t, DESK({ ...DESIGNER, can: { request: true, explore: true } }, [KNOWN]), async (desk) => {
  await desk.waitForSelector('#list [data-card="r4"]');
  await desk.click('#list [data-card="r4"]');
  await desk.waitForSelector("#detail .made-sec");
  const ps = await desk.$$eval("#detail .made-sec .md p", (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(ps, ["Nothing in the way.", "Where it lives: the Agents list.", "Already asked for: none found.", "History: spaced out in May."]);
  assert.deepEqual(await desk.$$eval("#detail .made-sec .md p b", (els) => els.map((e) => e.textContent)), ["Where it lives:", "Already asked for:", "History:"]);
  assert.match(await desk.textContent("#detail .vpanel .frame.vempty"), /No options were asked for/);
}));
