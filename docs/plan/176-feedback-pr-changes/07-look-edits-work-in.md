# 07 — Look edits and Add to my feedback

**Depends on:** 06-workspace-notes
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

Two more ways skip the feedback today: the look panel's **Send to Design Desk** (a part's look
edits, sent at once as a change note with `anchor.style` / `anchor.controls`), and **Work it in**
on a comment (`POST /api/cards/<id>/work-in`, which turns the comment into a change note). Both
move into the feedback.

## Implementation plan

Apply `/frontend-design`.

**Look edits** (README → Decisions: kept in the browser, no server draft):

1. The look panel (`desk/page.html` ~7257: per part **Undo** and **Send to Design Desk**, and
   **Send all**): the send buttons become **Add to feedback** (and **Add all to feedback**). It
   marks the part's edits as in the feedback (`looksNow()[selector].fb = true`, kept per drawing
   in `S.ws.looks` as today); the preview keeps showing them. Undo removes them, from the feedback too.
2. **Listed**: the Your feedback tab (slice 06) and the page's Your feedback show, after the
   drafts, one line per part with edits in the feedback: "Look of <label> · <n> changes · this
   browser", with ✕ (as Undo). The count includes them.
3. **Sent**: `reviewDialog` lists them too and, on send, first adds each as a draft —
   `addDraft(c, {text: lookText(e), anchor})` with the anchor `sendLooks` builds today (style,
   controls, selector, view…) — then posts the review as today, then `lookSent(selector)` for
   each. The dialog says, when any are listed: "Look edits are drawn only with Request changes;
   with another choice they go as comments." `cleanAnchor` already keeps `style` and `controls`
   (`desk/store.mjs`); check `addDraft`'s anchor check accepts them, with a store test.
4. Leaving the Desk or reloading drops them, as today; the line's "this browser" says it.

**Add to my feedback** (Work it in):

5. **Server**: `addDraft` accepts `{work_in: "<thread id>"}` with no text: an open comment
   (`kind: "comment"`) on this card that the person may work in (`workable`'s rule, the
   `change` ability); one per thread. `sendReview` with **Request changes** works each one in
   (the logic of `workIn(cardId, who, ids)`, its `was` and `work_in` kept) and tags the thread
   with the review; with another verdict a `work_in` draft is dropped and said in the reply
   (`skipped: n`). Route: the drafts POST passes `work_in`.
6. **Page**: **Work it in** on a comment reads **Add to my feedback** (draft with `work_in`);
   **Work in all n open comments** reads **Add all n to my feedback**. A comment in the feedback
   shows "In your feedback" instead of the button; the draft lists as "Work in: <first words>".
   The dialog notes they are worked in only with Request changes.
7. Words elsewhere: `HINT.workIn`, the flow drawings ("Work it in" at ~2015, ~3068, ~3093) and
   the option hint "Comments are not built in unless someone presses Work it in" (~6932).

## Docs and tests

- `docs/desk-page.md` → the look palette ("**Send** makes one `change` note per part" → added to
  the feedback, sent with it) and the comment actions; `docs/desk.md` → Reviews (look edits and
  work-in drafts, what each verdict does with them); `docs/requests.md` → revise (a comment worked
  in now arrives with a review: `review` on the thread).
- `desk/tests/store.test.mjs`: a draft with `anchor.style` / `controls` kept; `work_in` drafts —
  refused on a non-comment, on another card, twice; Request changes works them in with the
  review; Comment only drops them and says so.
- `desk/tests/page.test.mjs`: look panel → Add to feedback lists the part; send with Request
  changes posts a draft with `anchor.style` then the review; Add to my feedback posts `work_in`.

## Acceptance criteria

- [ ] No **Send to Design Desk** is left in the workspace; look edits wait in the feedback and
      reach Design Desk with Request changes as today's change notes.
- [ ] **Work it in** is **Add to my feedback**; the comment is worked in when the feedback is
      sent with Request changes, as one conversation, not a copy.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/page.test.mjs`. Mock Desk `?role=designer&ws=1#R-1`:
select a part, **Change the look** → bigger padding → **Add to feedback** → Your feedback shows
"Look of <part> · 1 change · this browser", the preview keeps it; on a comment, **Add to my
feedback** → listed; **Send feedback…** → Request changes → Comments shows the look note (its
values) and the comment as change notes in one feedback block.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
