// node --test desk/tests/*.test.mjs — the Desk page runs in a sandboxed frame without
// allow-forms (docs/desk.md → Where it works): the browser blocks a form's submission
// before its submit event fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, req } from "../../toolkit/lib/core.mjs";

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

// A stand-in bridge records every call; the server answers just enough for a lead's Desk.
const BRIDGE = `<script>
window.calls = [];
window.platform = { async request({ method, path, body }) {
  calls.push({ method, path, body });
  const answer = path === "/api/me" ? { role: "lead", email: "lead@example.com", can: { request: true } }
    : path === "/api/cards" ? { cards: [] } : path === "/api/agenda" ? { agenda: [] }
    : path === "/api/requests" ? { card: { id: "r1" } }
    : path === "/api/cards/r1" ? { card: { id: "r1", kind: "request", title: "Bigger send button", status: "triage" } } : {};
  return { status: 200, contentType: "application/json", body: JSON.stringify(answer) };
} };
</script>`;

test("the request dialog sends once from a sandboxed frame, and only on Send", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch { return t.skip("toolkit dependencies are not installed"); }
  Object.assign(process.env, browser.env);
  const server = createServer((r, res) => {
    res.setHeader("content-type", "text/html");
    res.end(r.url === "/desk" ? page.replace("<script>", BRIDGE + "<script>")
      : `<!doctype html><iframe sandbox="allow-scripts allow-modals" src="/desk" style="width:1000px;height:700px"></iframe>`);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const top = await chrome.newPage();
    await top.goto(`http://127.0.0.1:${server.address().port}/`);
    const desk = top.frames().find((f) => f.url().endsWith("/desk"));
    const posts = () => desk.evaluate(() => calls.filter((c) => c.method === "POST"));
    const open = () => desk.evaluate(() => document.getElementById("request-dialog").open);
    const button = (name) => desk.locator("#request-dialog .actions button", { hasText: name });

    await desk.click("#new-request");
    await button("Cancel").click();
    assert.equal(await open(), false, "Cancel closes the dialog");

    await desk.click("#new-request");
    await button("Send").click();
    assert.equal(await open(), true, "an empty request stays open");

    await desk.fill("#request-dialog textarea[name=problem]", "Make the send button bigger");
    await button("Send").click();
    await desk.waitForFunction(() => calls.some((c) => c.path === "/api/cards/r1"));
    assert.equal(await open(), false, "Send closes the dialog");
    const sent = await posts();
    assert.deepEqual(sent.map((c) => c.path), ["/api/requests"]);
    assert.equal(JSON.parse(sent[0].body).problem, "Make the send button bigger");

    // A close with no value keeps the last one (as Escape does in some browsers):
    // the dialog clears it when it opens, so a Send is never sent twice.
    await desk.click("#new-request");
    await desk.evaluate(() => document.getElementById("request-dialog").close());
    assert.equal(await open(), false);
    await top.waitForTimeout(300);
    assert.equal((await posts()).length, 1, "a close after a Send sends nothing");
  } finally {
    await chrome.close();
    server.close();
  }
});
