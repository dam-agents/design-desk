// The names people's notes hang on, carried into a redraw (docs/requests.md → Names notes hang on).
// Each note's part is found in the drawing as it was (by its name in its view, else its path) and
// matched in the new markup: by the name when the new markup has it, else by the old path (the same
// tag, and its words or its class), else by tag and text, else by tag and class, else by the old path
// alone when the part there says nothing another part of the old version said (its own words changed
// in place) — each only when exactly one part qualifies. The name is then written on that part. With
// no match, or several, nothing is guessed: the note is listed as gone.
// Both pages are read with scripts off, as markup, never run.
import { launch } from "./core.mjs";

// Runs in the page: `old` reads each note's part, `new` places the names.
function inPage({ step, notes, prints }) {
  const viewNamed = (v) => v.dataset.viewName || "View " + v.dataset.view;
  const viewRoot = (x) => { if (!x.view && !x.view_name) return document; const vs = [...document.querySelectorAll("[data-view]")]; return (x.view_name && vs.find((v) => viewNamed(v) === x.view_name)) || (x.view && vs.find((v) => v.dataset.view === String(x.view))) || null; };
  const q = (v) => '"' + String(v).replace(/["\\]/g, "\\$&") + '"';
  // Every part in the view the selector matches; a path written under another number of its view is read as this view.
  const all = (root, sel) => { if (!sel) return []; try { const s = root === document ? sel : sel.replace(/\[data-view="[^"]*"\]/, "[data-view=" + q(root.dataset.view) + "]"); return [...(root !== document && root.matches(s) ? [root] : []), ...root.querySelectorAll(s)]; } catch { return []; } };
  const named = (root, name) => all(root, "[data-anchor=" + q(name) + "]")[0] || null;
  const text = (el) => (el.textContent || el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ");
  // As the workspace's frame names a part (desk/page.html → nameFor), from the same words.
  const kind = (el) => { const t = el.tagName.toLowerCase(), r = el.getAttribute("role"); if (t === "button" || r === "button") return "Button"; if (t === "a") return "Link"; if (/^h[1-6]$/.test(t)) return "Heading"; if (["input", "textarea", "select"].includes(t)) return "Field"; if (["img", "svg", "path"].includes(t)) return "Image"; if (t === "li") return "List item"; if (t === "label") return "Label"; if (["p", "span", "small", "strong", "em", "b"].includes(t)) return "Text"; if (t === "nav") return "Navigation"; if (t === "header") return "Header"; if (["table", "tr", "td"].includes(t)) return "Table"; return "Area"; };
  const slug = (t) => String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (step === "old") {
    const out = [];
    for (const n of notes) {
      const root = viewRoot(n), el = root && ((n.name && named(root, n.name)) || all(root, n.selector)[0]);
      if (!el) { out.push({ thread: n.thread, name: n.name || null, missing: true }); continue; }
      let name = n.name || el.getAttribute("data-anchor");
      if (!name) {
        const taken = new Set([...all(root, "[data-anchor]")].map((x) => x.getAttribute("data-anchor")).concat(notes.filter((x) => x.name && viewRoot(x) === root).map((x) => x.name)));
        const words = slug(el.getAttribute("aria-label") || text(el)).split("-").filter(Boolean).slice(0, 3).join("-");
        const base = (slug(kind(el)) + (words ? "-" + words : "")).slice(0, 36).replace(/-+$/, "");
        name = base; for (let i = 2; taken.has(name); i++) name = base + "-" + i;
      }
      // A second note on the part finds the name the first one gave it.
      if (!el.hasAttribute("data-anchor")) el.setAttribute("data-anchor", name);
      // What the other parts of its kind in the view said: one of them at the part's place in the new
      // version is that part moved up, not this one with new words.
      const others = [...new Set(all(root, el.tagName.toLowerCase()).filter((x) => x !== el).map((x) => text(x).slice(0, 300)))].slice(0, 300);
      out.push({ thread: n.thread, name, fresh: !n.name, tag: el.tagName.toLowerCase(), text: text(el).slice(0, 300), cls: el.getAttribute("class") || "", others, path: n.selector, view: n.view, view_name: n.view_name });
    }
    return out;
  }
  const carried = [], gone = [];
  for (const p of prints) {
    if (p.missing) { gone.push({ thread: p.thread, name: p.name, why: "its part is not in the version before either" }); continue; }
    const root = viewRoot(p);
    if (!root) { gone.push({ thread: p.thread, name: p.name, why: `the view ${p.view_name || p.view} is gone` }); continue; }
    if (named(root, p.name)) { carried.push({ thread: p.thread, name: p.name, how: "name" }); continue; }
    const one = (xs) => (xs.length === 1 ? xs[0] : null), same = all(root, p.tag);
    const at = all(root, p.path), byPath = at.length === 1 && at[0].tagName.toLowerCase() === p.tag && (text(at[0]) === p.text || (p.cls && at[0].getAttribute("class") === p.cls)) ? at[0] : null;
    const byText = !byPath && p.text ? one(same.filter((x) => text(x) === p.text)) : null;
    const byClass = !byPath && !byText && p.cls ? one(same.filter((x) => x.getAttribute("class") === p.cls)) : null;
    // Its own words changed where it stands: the one part of its kind at its old place, unless that part
    // says what another part of the old version said (that one moved into the place this one left).
    const byPlace = !byPath && !byText && !byClass && at.length === 1 && at[0].tagName.toLowerCase() === p.tag && !p.others.includes(text(at[0]).slice(0, 300)) ? at[0] : null;
    const el = byPath || byText || byClass || byPlace;
    if (!el) { gone.push({ thread: p.thread, name: p.name, why: "no one part of the new version matches it" }); continue; }
    if (el.hasAttribute("data-anchor")) { gone.push({ thread: p.thread, name: p.name, why: `its part there is named ${el.getAttribute("data-anchor")} already` }); continue; }
    el.setAttribute("data-anchor", p.name);
    carried.push({ thread: p.thread, name: p.name, how: byPath ? "path" : byText ? "text" : byClass ? "class" : "place" });
  }
  const changed = carried.some((x) => x.how !== "name");
  return { carried, gone, html: changed ? (document.doctype ? "<!DOCTYPE " + document.doctype.name + ">\n" : "") + document.documentElement.outerHTML : null };
}

// notes: [{thread, selector, name, view, view_name}] of one drawing (an option or one of its states).
// Returns the new page with the names on it, what was carried and how, what is gone and why, and the
// names given to notes that had none ([{thread, name}], for the store).
export async function carryNames(oldHtml, newHtml, notes) {
  if (!notes.length) return { html: newHtml, carried: [], gone: [], named: [] };
  const browser = await launch();
  try {
    const context = await browser.newContext({ javaScriptEnabled: false });
    await context.route("**/*", (r) => (r.request().url().startsWith("data:") ? r.continue() : r.abort()));
    const page = await context.newPage();
    await page.setContent(oldHtml, { waitUntil: "domcontentloaded" });
    const prints = await page.evaluate(inPage, { step: "old", notes });
    await page.setContent(newHtml, { waitUntil: "domcontentloaded" });
    const r = await page.evaluate(inPage, { step: "new", prints });
    return { html: r.html ?? newHtml, carried: r.carried, gone: r.gone, named: prints.filter((x) => x.fresh).map((x) => ({ thread: x.thread, name: x.name })) };
  } finally {
    await browser.close();
  }
}
