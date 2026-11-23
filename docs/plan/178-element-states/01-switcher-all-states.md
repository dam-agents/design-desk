# 01 — Switcher and All states

**Part of:** An element's states in its dialog — see [README](./README.md)

## Context

The dialog's states move from a list under the pictures into the before / after view: a
switcher over After, a fold with all of them, and the button that draws them beside the
switcher. The design workspace's State menu takes the same name for no state, "As designed".

## Implementation plan

All in `desk/page.html` unless named.

1. **State shown.** `S.el` gains `st` (a state id or null). `openElement(variant, key, { look,
   state })` sets it. In `renderElementDialog()`, `st = e.states.find((x) => x.id === S.el.st)
   || null`, and a state no longer drawn resets `S.el.st` to null.
2. **After shows it.** `elementPair(c, v, e, look, st, tools)`: After's picture is the state's
   (`shot`, else `asset` + `selector`, base `v.asset`) or `look`; its label names the state; a
   state without a picture says "No picture of this state yet". Under it, for a state: its name,
   its `how`, and the "drawn for an earlier version" chip when `of` is below the option's
   version; else today's "As <option> draws it, version n." Each column's label sits in an
   `.el-head` row; After's carries `tools`.
3. **The switcher** (`elSwitcher(e, st)`), only when the part has states: a `.pl-step` with ‹
   (`data-el-step="-1"`), a `<select id="el-state">` ("As designed", then each state by name),
   › (`data-el-step="1"`). The step wraps round. Click handler beside `elClose`; the `<select>`
   in the document `change` listener (beside `ws-version`); focus stays on the control used.
   `TIP.elStep` for the arrows.
4. **The draw button in `tools`**, after the switcher: busy (`drawingStates`) → an info chip
   "● Drawing its states" titled with `WORK.states`; else `may && !statesComplete(v, e)` →
   `data-el-states`, "Draw all states" with no states, "Redraw states" with some. Nothing
   otherwise. `act("states")`'s confirm says "Draw all states of …" or "Redraw the states of …",
   and why for a redraw. Remove the `li.addstate` card and its `.catalog li.addstate*` styles.
5. **All states** (`elAllStates(c, v, e, look, st)`), only with states: `<details class="el-all"
   data-el-all>`, summary "All states" and the count; open per `S.elAll`, which starts folded in
   both modes. A press on its summary keeps `S.elAll` (read before the fold toggles: a redraw
   between the press and the fold's `toggle` event would lose it). Entries: "As designed" (`look`) then each state, each with `data-el-pick="<id>"`
   (empty for As designed) and `aria-pressed` for the one shown.
   - Simple mode: `.el-grid` of `.el-tile` buttons (picture, name).
   - Full mode: `.catalog` with an "As designed" card, then `catalogItem(c, v, x, shown)` for
     each, whose picture becomes a `.el-cpick` button (no `zoomAttrs` on the card: After
     enlarges); the card shown is ringed (`.el-shown.on`). Keep its `id`, number, note, use case.
   - The pick handler sets `S.el.st`, redraws and scrolls the pair into view.
6. **Styles**: `.el-head`, `.el-sw` (its `<select>` between the stepper's buttons), `.el-all`
   (summary, + / −), `.el-grid`, `.el-tile`, `.el-cpick`, `.el-shown.on` — on the scale, ringed
   in ink for the one shown. Then `node desk/dev/guidelines.mjs`.
7. **The workspace says "As designed"**: `wsStates()` (menu item and pick label, its title),
   `renderWsNotes()` `nameOf`, `TIP.wsState`.
8. **Docs**: `docs/desk-page.md` → The element dialog (replace "Its states follow…" with the
   switcher, All states per mode, the button's three cases); `docs/requests.md` → Every state
   of a part (the button's names and where it is, "nothing when all are current");
   `docs/actions.md` `states` row ("Draw all states"); `desk/guidelines.html` → Stepper's "On the
   Desk" adds the element dialog.
9. **Tests** (`desk/tests/page.test.mjs`): update "Draw every state" → "Draw all states" and
   the `.catalog` / "As drawn" assertions in the existing tests; add one test on a request with
   an element with two states, one of an earlier version: the switcher steps and wraps, the
   `<select>` picks, After's asset and note follow, the fold's pick agrees with the switcher, it
   starts folded, full mode shows cards and simple mode tiles, the fold's state survives a reopen,
   **Redraw states** shows; and one where all are current: no button.

## Acceptance criteria

- [ ] An element with states shows the switcher over After in both modes; stepping and picking
      change only After and its note; the step wraps through "As designed".
- [ ] All states shows every state (tiles in simple mode, cards with use cases in full); a click
      shows it in After and the switcher agrees; folding is kept while the page is open.
- [ ] The button says Draw all states / Redraw states / nothing, per the three cases; never for a
      guest, a declined request, or a dialog opened only to look (`look`).
- [ ] The workspace's State menu says "As designed"; no "As drawn" is left in `desk/`.
- [ ] The docs and the guidelines say the same; `desk/guidelines.css` is current.
- [ ] `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs` passes.

## Smoke test

Run `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`. Then on the mock
Desk (`node desk/dev/mock.mjs 5610`, `?role=designer#R-1`), steps 1–4 of the README's
whole-feature smoke test.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
