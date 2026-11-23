# 02 — Fixed header, step between elements

**Depends on:** 01-switcher-all-states
**Part of:** An element's states in its dialog — see [README](./README.md)

## Context

The element dialog is long (Before and After, All states, comments). Its header stays at the top
while it scrolls, with Close always at hand, and it steps between the option's elements, so a
person reviewing an option goes through its parts without closing and reopening the dialog.
Asked by the operator while reviewing 01.

## Implementation plan

All in `desk/page.html` unless named.

1. **Fixed header**: `.elbar` (name, chips, Open in design workspace, the stepper, Close — slice
   03 makes Close a lone ✕) is `position: sticky; top: 0` in the dialog's scroll box, on the
   panel's background with a line under it, the full width of the dialog (`#el-body`'s top padding
   moves into it, so nothing jumps when it sticks). The enlarged picture (`.zoom`) stays above it.
2. **The elements to step through**: `alignedElements(c, v)` without its gaps (`e.gap`) — the
   order of the All elements tiles. With more than one, the header has a `.pl-step` (the
   guidelines' Stepper): ‹ (`data-el-nav="-1"`), "n of m", › (`data-el-nav="1"`), before Close;
   each arrow's `title` names the element it opens ("Next: Limit bar"), `TIP.elNav` as fallback.
   Round from the last to the first.
3. **Stepping**: the handler sets `S.el.key`, `S.el.st = null` (a state is one element's), keeps
   `look`, redraws, scrolls the dialog to its top, and gives focus back to the arrow pressed.
4. **What was being written stays with its element**: before the step, the box's text goes into
   `S.elTyped` by card, option and element; a dialog drawn for an element takes its own text back
   (the redraw that keeps text and caret, in `renderElementDialog()`, reads it when the element
   changed). Emptied when the comment is sent.
5. **Docs**: `docs/desk-page.md` → The element dialog: the header that stays, with the stepper
   and Close; another element opens as designed; the text written stays with its element.
   `desk/guidelines.html` → Stepper's "On the Desk" adds the element dialog's elements.
6. **Tests** (`desk/tests/page.test.mjs`, `bridgeBefore`): the header is sticky; "1 of 3" and the
   arrows' titles; › opens the next element (its name in the header, As designed), past the last
   the first, ‹ back round; a state picked does not carry over; text typed in one element's box
   comes back on returning and does not show in another's.

## Acceptance criteria

- [ ] Scrolled down, the dialog's header (name, Open in design workspace, the stepper, Close) is
      still at its top.
- [ ] With two elements or more, ‹ n of m › steps through them in the All elements order, round,
      each arrow naming the element it opens; with one, no stepper.
- [ ] Another element opens as designed, at the top of the dialog; a comment being written stays
      with its element.
- [ ] Docs and guidelines say so; `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs` passes.

## Smoke test

Run `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`. Then on the mock Desk,
step 7 of the README's whole-feature smoke test.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
