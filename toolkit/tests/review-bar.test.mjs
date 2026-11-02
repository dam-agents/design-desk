// node --test toolkit/tests/review-bar.test.mjs — a design walks its flow: a control wired
// to another view opens it, Back retraces it, and what can be clicked shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { TOOLKIT, chromium, req } from "../lib/core.mjs";
import { danglingGotos } from "../bin/build.mjs";

const bar = readFileSync(join(TOOLKIT, "chrome/review-bar.html"), "utf8");
const PAGE = `<!doctype html><html><body>${bar}
  <div data-view="1" data-view-name="List"><p id="plain">Three plans</p><button id="open" data-goto-view="2">Open plan</button></div>
  <div data-view="2" data-view-name="Plan"><a href="#" id="edit" data-goto-view="3">Edit</a><button id="back" data-goto-view="back">Back</button></div>
  <div data-view="3" data-view-name="Edit plan"><p>Form</p></div>
</body></html>`;

test("a data-goto-view that names no view is found before the build ships it", () => {
  assert.deepEqual(danglingGotos(PAGE), []);
  assert.deepEqual(danglingGotos(`${PAGE}<button data-goto-view="9">x</button><button data-goto-view="9">y</button>`), ["9"]);
});

test("a click walks the flow, Back retraces it, a dead spot flashes what is clickable", async (t) => {
  const browser = chromium();
  if (!browser) return t.skip("no browser here");
  let pw;
  try { pw = req("playwright-core"); } catch (e) { if (e.code === "MODULE_NOT_FOUND") return t.skip("toolkit dependencies are not installed"); throw e; }
  Object.assign(process.env, browser.env);
  const chrome = await pw.chromium.launch({ executablePath: browser.executablePath, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const pg = await chrome.newPage();
    await pg.setContent(PAGE);
    await pg.evaluate(() => document.dispatchEvent(new Event("DOMContentLoaded")));
    const shown = () => pg.evaluate(() => document.querySelector("[data-view].review-shown")?.dataset.view);
    const pressed = () => pg.evaluate(() => document.querySelector('#review [data-review-view][aria-pressed="true"]')?.dataset.reviewView);
    assert.equal(await shown(), "1");
    assert.equal(await pg.isVisible("#review-back"), false);
    await pg.click("#open");
    await pg.click("#edit");
    assert.deepEqual([await shown(), await pressed()], ["3", "3"]);
    await pg.click("#review [data-review-back]");
    assert.equal(await shown(), "2");
    await pg.click("#back");
    assert.equal(await shown(), "1");
    assert.equal(await pg.isVisible("#review-back"), false);
    // A click on a spot that does nothing outlines the clickable parts for a moment.
    await pg.click("#plain");
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), true);
    await pg.waitForTimeout(900);
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), false);
    await pg.click("#review [data-hot]");
    await pg.waitForTimeout(900);
    assert.equal(await pg.evaluate(() => document.documentElement.classList.contains("review-hot")), true);
  } finally { await chrome.close(); }
});
