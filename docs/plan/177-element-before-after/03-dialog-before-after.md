# 03 — The dialog: before and after

**Depends on:** 01-store-server
**Part of:** an element's before and after — see [README](./README.md)

## Context

The element dialog (`renderElementDialog` in `desk/page.html`) shows today the part as the
design draws it ("In the design", only while it has no states) and its states. This slice puts
**Before** beside **After** at the top, in both modes, with where each "before" came from, the
button that takes it from the product, and **Open in design workspace** at the part. Behaviour
and layout follow the prototype's `simple()` branch (`feat/simple-mode`); its code is not
copied.

## Implementation plan

Apply `/frontend-design`, within `docs/desk-page.md`'s tokens and the page's existing classes
(`.cv-pair`/`.cv-col` exist only in the prototype — name new classes `el-*`).

1. **Which "before".** A helper `beforeOf(c, e)` returns, for a part with `change !== "new"`
   and an `id` in `c.shared_elements`:
   - the `before_shots` entry with that id → `{shot, source: "instance", ref, commit, at}`;
   - else the `now.elements` entry and `c.now.asset` → `{asset, selector, view, source: "now", at: c.now.at}`;
   - else `null`.
2. **The pair.** At the top of the dialog body, after the header and `how`:
   - `change === "new"` → one column, label **New**, the part as the design draws it (today's
     `look` picture).
   - otherwise two columns: **Before** — the picture from `beforeOf` (an `<img data-asset>` for
     a shot; a snip iframe on `c.now.asset` with its selector for `now`), or a box "No picture
     from before"; **After** — the design's part (today's `look`).
   - Under Before, one line of where it came from: "The product at main (<commit>), with
     made-up data · <when>" or "Redrawn from the code by Design Desk · <when>"
     (`fmtWhen`/the page's date helper). Both pictures zoom like today (`zoomAttrs`).
   - Remove today's "In the design" first card (After shows it); the states list stays under
     the pair as it is (#178 reworks it).
3. **Same width.** Both halves must compare like with like: the snip frames draw at the
   design's own width and scale down to the column (check what `SNIP_SCRIPT` does with a narrow
   frame; if it reflows, give the iframe a fixed layout width — the option's view width — and
   `transform: scale()` it into the column, keeping its height in proportion). The tiles under
   All elements get the same treatment if it is the same function — the issue's narrow-tile
   question; note in the PR what real designs did.
4. **The button.** For a changed shared part, when `S.me.screens` and `can("before")`:
   **Take it from the product** (the product picture exists → **Take it again**), title saying
   it uses Design Desk's copy of the product with made-up data. It calls `act("take-before")`
   with `element: e.id` — extend `act()`/its body (`data-act` handler) to send `element`.
   While `c.waiting` has an `explore` with `scope: "before"` and `element === e.id`: a busy
   line with the page's spinner instead ("Taking it from the product…"); add the word to the
   busy pill's `WORK` table for that scope.
5. **Open in design workspace.** A primary button in the dialog's header (the prototype's
   `data-el-ws`): close the dialog, `S.variant = v.id`, reset `S.ws` the way the prototype's
   `elWs` handler does, `S.ws.selected = {selector, text: "", tag: "", label: e.name, view,
   view_name}` when the part has a selector, open the workspace (`renderWorkspace`). Check the
   frame selects it on load (`frameSay({type: "desk-select", …})`, as `ds.why` opens with a
   part); a part with only a `shot` opens the option without a selection.
6. **Mock data.** `desk/dev/mock-data.mjs`: on one request, `shared_elements`, a `now` asset
   with `elements`, a `before_shots` entry (a small screen asset) for one part, and a `new`
   part. `desk/dev/mock.mjs`: `screens: q.get("screens") !== "0"` in `me`; answer
   `take-before` by adding a waiting item, then a `before_shots` entry after a few seconds,
   like its change-note stand-in.

## Docs and tests

- `desk/tests/page.test.mjs` (extend its existing dialog/elements cases): the pair for a
  changed part with a product shot, with only `now`, with neither ("No picture from before");
  one **New** for a new part; the button absent for a guest, absent with `screens` false,
  busy while its item waits; Open in design workspace sets the workspace's selection.
- `docs/requests.md` → The option's elements: the sentence "one opens in a dialog with its
  states" becomes: before and after (or new), where "before" comes from, the button, the way
  into the workspace — linking the procedure from 02, not restating it.
- `docs/desk-page.md`: one short paragraph for the element dialog in both modes (the
  label lines and the button's visibility), where the page's request section describes All
  elements (near the simple-mode paragraph at line ~179 that says All elements starts open).

## Acceptance criteria

- [ ] A changed shared part shows Before and After; the label says product or redrawn, with
      the commit or the date.
- [ ] A new part shows one picture, **New**, and no button.
- [ ] A changed part with no source says "No picture from before".
- [ ] The button shows for members only and only with the screens instance on; pressing it
      queues the item and shows the part busy.
- [ ] Open in design workspace opens that option with the part selected.
- [ ] Both halves draw at the same width; nothing squeezes in a narrow column.
- [ ] Same in simple and full mode, light and dark; `node --test desk/tests/page.test.mjs`
      passes.

## Smoke test

`node desk/dev/mock.mjs 5610`; in `agent-browser` open
`http://localhost:5610/?role=designer#R-1` → an option → All elements:

1. The part with a product shot: Before shows it with "The product at main (…)".
2. A part with only `now`: Before cut from the drawing, "Redrawn from the code".
3. The new part: one picture, New.
4. Press **Take it from the product**: busy, then the product picture after the stand-in delay.
5. `?role=guest` and `&screens=0`: no button.
6. **Open in design workspace**: the workspace, the part outlined.
7. Repeat with simple mode on and `&theme=dark`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
