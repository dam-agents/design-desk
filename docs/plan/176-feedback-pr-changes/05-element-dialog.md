# 05 — Feedback in the element dialog

**Depends on:** 01-feedback-words
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

#186's element dialog (one part of an option, before beside after) has a box whose **Comment**
posts at once (`elementTalk` in `desk/page.html`, `docs/desk-page.md` → The element dialog). It
gets the same two buttons as every other box, so a note on a part can wait in the feedback.

## Implementation plan

Apply `/frontend-design`.

1. `elementTalk(c, v, e)`: the box's buttons become **Add to feedback** (primary) and
   **Comment** (today's, posts at once). Add to feedback → `addDraft(c, {text, anchor})` with
   the same anchor today's Comment builds (option, the part's `selector`, `name`, `label`, and
   the state when the dialog shows one), so the draft is checked by the server as that comment
   would be. Shown under the same rule as today (who may comment or change, not on a closed request).
2. Above the box, the viewer's drafts on this part (`draftsOf(c)` with the same option and the
   part's selector, else its label as `notesOnPart` matches): "Not sent yet" bubbles with ✕.
   The dialog's **Comments · n** count stays the sent ones.
3. After Add to feedback the dialog re-renders (`renderElementDialog`) and keeps the textarea empty.

## Docs and tests

- `docs/desk-page.md` → The element dialog: the **Comments** bullet.
- `desk/tests/page.test.mjs`: the element dialog test (search `element-dialog`): **Add to
  feedback** posts a draft with the part's anchor and lists it in the dialog and in Your
  feedback; **Comment** still posts a thread.

## Acceptance criteria

- [ ] The dialog's box has Add to feedback and Comment, nothing else.
- [ ] A draft from it carries the part's anchor and shows in the dialog and in Your feedback, with ✕.
- [ ] Sent with Request changes, it becomes a change note on that part (the store's rule, unchanged).
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/page.test.mjs`. Mock Desk, `?role=designer#R-1`: open an option's
**All elements** tile → the dialog; type a note, **Add to feedback** → "Not sent yet" in the
dialog and **Your feedback · 1** on the page; **Send feedback…** with Request changes → a change
note on that part in Comments.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
