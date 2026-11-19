# 04 — Marks and sending

**Depends on:** 03-change-view
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

With the view in place, the reviewer needs to see how far they got, move on quickly, and not
send feedback that silently skips a change. Sent feedback has to show what was marked fine, and
a conversation about a change has to lead back to it.

## Implementation plan

Apply `/frontend-design`.

1. **The mark of a change** (`markOf(c, key)`): `"changes"` when the viewer has a text draft on
   it; `"ok"` when they have an ok draft on it or `key` is in the card's `looks_good` (slice 02);
   else `""`. Each tab gets `data-m` (the guidelines' green and amber chips) and a `title`
   ("Looks good", "You ask for changes here; not sent yet", "Not looked at yet").
2. **Looks good moves on**: after the ok draft is added, show the next change with no mark; when
   none is left, open `reviewDialog(c, "approve")` if the viewer may approve, else
   `reviewDialog(c)`.
3. **Progress**: beside the **Changes** heading, "✓ All looked at" once every change has a mark
   (two or more changes only).
4. **The dialog warns** (`reviewDialog`, a change with two or more changes): when some have no
   mark, a warning above the drafts — "**2 changes not looked at yet:** <name>, <name>. You can
   still send; Cancel takes you back." Use the Desk's existing warning style (`--warn-soft`;
   check `desk/guidelines.html` → Colour / State for the callout it names); nothing new in the
   palette. The `ask()` helper's `html` carries it.
5. **Drafts listed** (Your feedback under the head, the dialog): an ok draft reads "✓ Looks good
   · <name>".
6. **Sent feedback** (`reviewBlock`): under the note, "✓ Looks good: <name>, <name>" from the
   review's `looks_good` (both modes).
7. **A conversation about a change** (`simpleThreads` and full mode's `renderThreads`): a thread
   with `change` that is a key gets a chip "◎ <name>" that shows that change (`S.chg`) and
   scrolls to the view; a key no longer among the changes reads as plain text.

## Docs and tests

- `docs/desk-page.md` → Simple mode: the marks, Looks good moving on, the warning, the chip in
  Comments; `docs/desk.md` → Reviews: the sent block shows Looks good.
- `desk/tests/page.test.mjs`: the chips' `data-m` from drafts and from `looks_good` (follow the
  option-chip test near line 4247); Looks good shows the next unmarked change, the last opens the
  dialog; the warning lists the unmarked names and is absent when all are marked; the sent block
  lists Looks good; the chip in Comments shows its change.

## Acceptance criteria

- [ ] Chips are green for Looks good (draft or current sent), amber for a note, empty otherwise;
      a new head empties the sent ones.
- [ ] Looks good on the last unmarked change opens the dialog.
- [ ] The dialog names every change not looked at; sending still works.
- [ ] Sent feedback shows the Looks good list; a conversation's chip opens its change.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/page.test.mjs`. On the mock Desk (slice 03's change, simple mode):
**Looks good** on tab 1 → chip 1 green, tab 2 shown; a note on tab 2 → chip 2 amber; **Send
feedback…** → "1 change not looked at yet: <tab 3's name>"; Cancel, **Looks good** on tab 3 →
the dialog opens with no warning; send Comment only → the block shows the note with "◎ <tab 2>"
and "✓ Looks good: <tab 1>, <tab 3>"; its chip shows tab 2.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
