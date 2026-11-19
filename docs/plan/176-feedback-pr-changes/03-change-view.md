# 03 — The change view

**Depends on:** 02-looks-good-server
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

A pull request change's page shows its screens as one block (`shots(c.screens)`) with one box
for "the changes". This slice replaces that block, in simple and in full mode, with one tab per
change, the pictures of the change shown, and a box under it whose feedback is about that change.

## Implementation plan

Apply `/frontend-design`; follow `desk/guidelines.html` → Tabs and switchers → "Underline tabs
with a number chip" (the option tabs' markup: `.tabs.vtabs.utabs`, `.ono`, `data-m`).
Reference only: the prototype's `changesOf`, `cvAt`, `changeViewer` (`git show
251ebfc:desk/page.html`); take behaviour, not code.

1. **`changesOf(c)`** in `desk/page.html`, the same as the store's (slice 02), with a comment
   pointing at it. Each entry: `{key, name, before, after, diff, lone}`.
2. **Which change is shown**: `S.chg = {card, key}`; the first change when unset or gone. A
   `#<card>` link with `?chg=<key>` is not needed.
3. **`changeView(c)`**, called from `renderChange` in both branches, replacing simple mode's
   `<h3>The changes</h3>…shots(c.screens)…reviewBox(c, {what: "the changes"})` and full mode's
   `<h3>Screens</h3>…shots…reviewBox(…)`:
   - `<h3>Changes <span class="hint">n</span></h3>`.
   - With two or more changes, the tabs: one button per change, `data-chg="<key>"`, the chip
     `.ono` with its number, its name; `aria-pressed` on the one shown. One row that scrolls
     sideways and keeps the shown tab in view, as the option tabs (`.vscroll`).
   - The pictures of the change shown, with the existing `figure()` so zoom, the source line
     and the numbers stay: **Before** beside **After** for a pair (the `.shots.stages` grid with
     two columns); **After** alone for a lone screen or a pair with no before. The `diff` picture
     is not shown; `outlineToggle` over the pictures stays, and the marks on After.
   - The caption (`after.caption`, else `before.caption`) under the pictures, as `.hint`.
   - **No screenshots yet** (no screens): one hint that says what is true, from
     `docs/screens.md`: "No screenshots yet. Design Desk takes them on its copy of the product
     (<when `S.me.screens`>), or when the pull request merges." Keep **Add screenshots**.
4. **The box under the change** (replacing `reviewBox(c, {what: "the changes"})`), shown where
   `reviewBox` shows today (`can("comment") && !c.send && !closed(c)`):
   - a textarea "What should change here?", **Add to feedback** (primary) → `addDraft(c, {text,
     change: key, anchor: {label: name}})`, **Looks good** → `addDraft(c, {ok: true, change: key})`.
     No Comment button here (README → Decisions).
   - Your drafts on this change above the textarea (`draftBubble`, with ✕); an ok draft reads
     "✓ You marked it as good" with **Undo** (removes the draft).
   - "n comments on this change ↓" when sent conversations carry `change === key`; a click
     scrolls to the first in Comments.
5. `addDraft` in the page accepts `ok`; `aboutOf` names a change by its name (from the key).
6. **The mock Desk** (`desk/dev/mock-data.mjs`): one open pull request change with a pair and
   two lone screens, so the view can be tried.
7. **Guidelines**: `desk/guidelines.html` → Tabs and switchers → the chip tabs' entry names the
   change tabs as a second use; run `node desk/dev/guidelines.mjs` if the CSS copy changes.

## Docs and tests

- `docs/desk-page.md` → Simple mode (the page's **The changes** → **Changes**, the box under a
  change) and the full-mode change page's Screens; one home: the change view is described once
  (Simple mode) and full mode links to it.
- `desk/tests/page.test.mjs`: update the change-page tests that read `shots` (the pairs around
  line 800); new test: three changes → three tabs, the pair shows Before and After, a lone
  screen After only, no diff picture; a click on a tab shows its pictures; **Add to feedback**
  posts a draft with `change`; **Looks good** posts `{ok: true, change}`; both modes.
- `desk/tests/guidelines.test.mjs` passes (the switcher is named).

## Acceptance criteria

- [ ] On a change with screens, both modes show one tab per change and the pictures of one.
- [ ] A lone screen reads After; a pair Before and After; no "What changed" picture; outlines still toggle.
- [ ] The box's two buttons post the right drafts; there is no Comment button under a change.
- [ ] A change with no screens says how it gets them.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`. Then `node
desk/dev/mock.mjs 5610`, open `http://localhost:5610/?role=designer&simple=1#<the new change's
id>`: three tabs; tab 1 Before | After; tab 2 After only; type a note, **Add to feedback** → it
shows under the change and in **Your feedback · 1**; **Looks good** on tab 3 → "✓ You marked it
as good". Again without `&simple=1` (full mode), and with `&theme=dark`.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
