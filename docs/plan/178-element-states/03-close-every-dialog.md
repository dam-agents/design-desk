# 03 — ✕ and Esc close every dialog

**Depends on:** 02-header-step-elements
**Part of:** An element's states in its dialog — see [README](./README.md)

## Context

The Desk closes its dialogs in different ways: "✕ Close" on the element dialog and the enlarged
picture, a lone ✕ on the private questions and the presentation, and only Cancel on the eight
form dialogs. Every dialog gets one way: a lone ✕ in its top-right corner, and Esc. Asked by the
operator while reviewing 01; it lands with this feature because the element dialog's header is
where it started.

## Implementation plan

All in `desk/page.html` unless named.

1. **One ✕**: a button `class="dlg-x"`, `aria-label="Close"`, `title="Close (Esc)"`, text ✕, in the
   top-right corner of its dialog (absolutely placed; the dialog's heading keeps room for it).
   On the scale; neutral, as the guidelines' buttons say.
2. **The form dialogs** (`request-dialog`, `product-dialog`, `shots-dialog`, `decision-dialog`,
   `person-dialog`, `option-dialog`, `slack-dialog`, `confirm-dialog`): the ✕ first in each form,
   `type="button"`. It does what Esc does: through `leave(d)` (asks "Close without sending?" when
   the form changed since it opened), at once for `confirm-dialog`. Cancel stays.
3. **The element dialog**: its header's "✕ Close" becomes the ✕ (`data-el-close` kept).
4. **The enlarged picture** (`.zoom`, two places: "✕ Close") and **the private questions**
   (`data-ask-close`): the same ✕ and look; the presentation's exit is the same ✕ too.
5. **Esc closes each**: the form dialogs by their native `cancel` (the guard for a changed form
   stays); the element dialog as today (an enlarged picture first); the zoom, the private
   questions and the presentation by the page's `keydown`. Check each, fix where one does not.
6. **Guidelines** (`desk/guidelines.html` → Dialogs and forms): a rule "Close is ✕, alone, in the
   top-right corner; Esc closes too; a form that changed asks first", with the example dialog
   carrying its ✕. `desk/tests/guidelines.test.mjs`: the page has no "✕ Close", and every
   `<dialog>` in `desk/page.html` carries a `dlg-x` (the element dialog's is drawn by its renderer).
7. **Docs**: `docs/desk-page.md` → where dialogs are described (Where it works / the dialog rules
   in `docs/desk.md` it links): ✕ and Esc, and what each does with a changed form.
8. **Tests** (`desk/tests/page.test.mjs`): for each form dialog, ✕ closes it untouched and asks
   once something is typed; Esc the same; the element dialog's ✕ and Esc; the zoom's ✕ and Esc.
   Update the assertions that read "✕ Close".

## Acceptance criteria

- [ ] Every dialog, the enlarged picture and the private questions have a lone ✕ top-right, named
      "Close"; no "✕ Close" is left in `desk/`.
- [ ] Esc and ✕ close each; a form with something typed or picked asks first, both ways.
- [ ] Cancel still closes a form at once.
- [ ] The guidelines show the rule; their test and the page tests pass.

## Smoke test

Run `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`. Then on the mock Desk,
step 8 of the README's whole-feature smoke test.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
