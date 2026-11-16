// node --test toolkit/tests/anchors.test.mjs — the names people's notes hang on (data-anchor,
// docs/requests.md → Names notes hang on): one per part and view, checked by the build.
import { test } from "node:test";
import assert from "node:assert/strict";
import { anchorProblems } from "../bin/build.mjs";

test("the build refuses a name twice in one view, and a name that is not one; the same name in two views is fine", () => {
  const view = (n, body) => `<div data-view="${n}" data-view-name="V${n}">${body}</div>`;
  assert.deepEqual(anchorProblems(view(1, '<ul data-anchor="spender-list"><li>a</li></ul>') + view(2, '<ul data-anchor="spender-list"></ul>')), []);
  assert.deepEqual(anchorProblems(view(1, '<ul data-anchor="spender-list"><li>a<li>b</ul><p data-anchor="spender-list">x</p>')), ['data-anchor="spender-list" twice in view 1']);
  // A view closed by its own tag: what follows is outside it, a page-wide part.
  assert.deepEqual(anchorProblems(view(1, '<div><br><img src=x><b data-anchor="total">1</b></div>') + '<footer data-anchor="total">x</footer>'), []);
  assert.deepEqual(anchorProblems('<p data-anchor="Spender List">x</p>'), ['data-anchor="Spender List" in the page is not a name: lowercase letters, digits and dashes, at most 40']);
  // Scripts, styles, comments and a control's templates are not the page's parts.
  assert.deepEqual(anchorProblems(view(1, '<b data-anchor="x">1</b><template data-desk-option="y"><b data-anchor="x">2</b></template><!-- <b data-anchor="x"> --><script>const s = \'<b data-anchor="x">\';</script>')), []);
});

test("a redraw carries each note's name onto its part: moved, renamed round it, or gone, never guessed", async (t) => {
  const { chromium } = await import("../lib/core.mjs");
  if (!chromium()) return t.skip("no browser here");
  try { (await import("../lib/core.mjs")).req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  const { carryNames } = await import("../lib/anchors.mjs");
  const page = (home, chat) => `<!doctype html><html><body><div data-view="1" data-view-name="Home">${home}</div><div data-view="2" data-view-name="Chat">${chat}</div><script>document.body.dataset.ran = 1</script></body></html>`;
  const before = page('<h2>Top spenders</h2><ul class="spenders"><li>Rent</li><li>Food</li></ul>', '<ul><li>a.pdf</li><li>b.pdf</li><li>c.pdf</li></ul><button>Send</button>');
  const after = page('<h2>Who spent most</h2><p>This month</p><ul class="spenders"><li>Rent</li><li>Food</li></ul>',
    '<section><p>Files</p><ul><li>b.pdf</li><li>a.pdf</li><li>a.pdf</li></ul></section><button data-anchor="send">Send</button>');
  const at = (view, view_name, selector, name) => ({ view, view_name, selector, name });
  const notes = [
    { thread: "T-1", ...at("1", "Home", 'div[data-view="1"] > ul', "spender-list") }, // the text round it changed: found by its path
    { thread: "T-2", ...at("2", "Chat", 'div[data-view="2"] > ul > li:nth-of-type(2)', "list-item-b-pdf") }, // moved: found by its words
    { thread: "T-3", ...at("2", "Chat", 'div[data-view="2"] > ul > li:nth-of-type(1)', "list-item-a-pdf") }, // its words twice now: not guessed
    { thread: "T-4", ...at("2", "Chat", 'div[data-view="2"] > ul > li:nth-of-type(3)', "list-item-c-pdf") }, // gone
    { thread: "T-5", ...at("2", "Chat", 'div[data-view="2"] > button', "send") }, // the new markup has the name already
    { thread: "T-6", ...at("1", "Home", 'div[data-view="1"] > ul > li:nth-of-type(2)', null) }, // stored before names: named, then carried
    { thread: "T-7", ...at("2", "Chat", 'div[data-view="2"] > ul > li:nth-of-type(2)', "list-item-b-pdf") }, // a second note on a part
  ];
  const r = await carryNames(before, after, notes);
  const by = (list) => Object.fromEntries(list.map((x) => [x.thread, x.how || x.why]));
  assert.deepEqual(by(r.carried), { "T-1": "path", "T-2": "text", "T-5": "name", "T-6": "path", "T-7": "name" });
  assert.deepEqual(Object.keys(by(r.gone)), ["T-3", "T-4"]);
  assert.deepEqual(r.named, [{ thread: "T-6", name: "list-item-food" }]);
  const has = (sel) => r.html.match(new RegExp(sel))?.[0];
  assert.ok(has('<ul class="spenders" data-anchor="spender-list">'), "the list keeps its name where it is");
  assert.ok(has('<li data-anchor="list-item-b-pdf">b.pdf</li>'), "the moved file takes its name along");
  assert.ok(has('<li data-anchor="list-item-food">Food</li>'), "a note stored before names gets one");
  assert.equal((r.html.match(/data-anchor="list-item-a-pdf"/g) || []).length, 0, "two parts alike: no name guessed");
  assert.ok(r.html.includes("<script>document.body.dataset.ran = 1</script>") && !r.html.includes("data-ran"), "the page is read, never run");
  assert.ok(r.html.startsWith("<!DOCTYPE html>"));
  // Nothing to carry: the page goes as it is.
  const same = await carryNames(after, after, [{ thread: "T-5", ...at("2", "Chat", "button", "send") }]);
  assert.equal(same.html, after);
});
