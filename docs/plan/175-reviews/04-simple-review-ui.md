# 04 — Simple mode: drafts and the review dialog

**Depends on:** 02-send-review
**Part of:** Reviews — see [README](./README.md)

## Context

The page side in simple mode: adding drafts where a comment is written, seeing and removing
them, and sending them as one review from the header.

## Implementation plan

Apply `/frontend-design`; take behaviour and layout from the prototype (`feat/simple-mode`:
`drafts`, `addDraft`, `setDrafts`, `finishReview`, `sWait`, the `html` option of `ask`), not its code.

1. `desk/page.html`, state: `S.drafts[cardId]` loaded with the card (`GET …/drafts`) when it
   opens; helpers `addDraft(c, {text, anchor})`, `removeDraft(c, id)`, `draftsOf(c)` — the one
   helper #176/#177 call from their boxes.
2. Comment boxes in simple mode: where a note is written on an option (or a part, through the
   design workspace's note), **Add to review** (primary) and **Comment now**; the box at the end
   of the page posts at once, its button **Comment**.
3. **Your review**: under the item's head while drafts exist — each draft as a compact bubble
   (what it is about: the option/part/state name; its text; × to remove).
4. Head (`simpleHead`): with drafts, **Request changes** shows the count ("Request changes · 2")
   and becomes the primary button; it opens the review dialog instead of #184's one-note
   dialog. A change gets **Request changes** beside **Approve** for who may handle it.
5. The review dialog (`ask` with an `html` body): the drafts as bubbles, the verdict (Request
   changes, Approve, Comment only — each offered only to who may), the optional note, **Send
   review**. Approve on a request runs today's approve flow first (its own dialog and checks),
   then sends the review with `approve`; on a change it sends `approve` (the store marks it
   handled). Errors keep the drafts.
6. Toasts in the Desk's words: "Review sent. Design Desk draws the next version." / "Review
   sent. It goes to the pull request on GitHub." / "Review sent."

## Docs and tests

- `docs/desk-page.md` → The page (Simple mode paragraph): the boxes, Your review, the header's
  Request changes and the dialog — replacing #184's "Request changes … a note" sentence and the
  "left to #175" note.
- `desk/tests/page.test.mjs`: Add to review stores a draft (POST seen), Your review lists and
  removes it, the head's count and primary, the dialog's verdicts per role, Send posts one
  `/reviews` call; Comment now posts a thread.

## Acceptance criteria

- [ ] Drafts added in simple mode show under Your review on reload and on another browser.
- [ ] The dialog offers only the verdicts the viewer may send and sends one review.
- [ ] The end-of-page box posts at once; nothing it posts goes to GitHub.

## Smoke test

`node --test desk/tests/page.test.mjs`; then the mock Desk (`node desk/dev/mock.mjs`, its
printed URL) in simple mode: open a request with options, Add to review twice, Request changes · 2,
send — the drafts are gone and the review is in Comments.
