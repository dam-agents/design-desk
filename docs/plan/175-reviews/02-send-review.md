# 02 — Sending a review

**Depends on:** 01-drafts-store
**Part of:** Reviews — see [README](./README.md)

## Context

Sending a person's drafts as one review with a verdict: the store turns them into
conversations, applies the verdict with what already exists, and records who makes the next
version. Server side only; the page comes in slices 04–06.

## Implementation plan

1. `desk/store.mjs`:
   - `emptyDb()` gains `reviews: {}`; `LETTERS` gains `review: "N"` (check it is unused;
     `nextOf("review")`).
   - `sendReview(cardId, who, {verdict, note})`, `verdict` one of `request-changes`,
     `approve`, `comment`. Takes the viewer's drafts (none and no note → `bad`). Per draft,
     `openThread(cardId, who, {kind, text, anchor})` with `kind: "change"` when the verdict is
     `request-changes` on a request and the draft names an option (else `comment`; a
     request-changes draft with no option goes to the shown/first option as #184's Request
     changes does — take the `variant` from the body when given), then sets `t.review = id`.
     The note, when given, is the review's own text (no thread).
   - Verdict effects (abilities are checked by the server, step 2):
     - `request-changes` on a request: the change notes already queue one `revise` item
       (`pendingOrNew`); with only a note, open one change note from it.
     - `request-changes` on a change: nothing on the card's status; `review.sha` = the
       GitHub copy's `head` of its pull request when known (slice 03 fills `head`).
     - `approve` on a change: `this.handle(cardId, who, true)` (its own checks hold).
     - `approve` on a request: refused unless `c.approved` is already set — the page runs
       today's approve action first (slice 04).
     - `comment`: nothing more.
   - Writes `db.reviews[id] = {id, card, by: person(who), at, verdict, note, threads: [...]}`,
     clears the drafts, `c.reviews = [...ids]`, `c.updated`. All in one `save()`; a failing
     `openThread` leaves drafts and threads untouched (validate every draft first).
   - `responsibleOf(c)`: the newest review of the card with `request-changes` and no later
     `approve` → `{who: "design-desk", review, since}` on a request while no option's `drawn`
     is after `review.at`; `{who: "developer", …}` on a change while the GitHub copy's `head`
     equals `review.sha` (unknown `sha` → while no commit was seen after: `updated` ≤ `at`).
     Else `null`. Returned on every card read and list row as `responsible`.
   - `getCard` returns the card's `reviews` records (each `{id, by, at, verdict, note,
     threads}`); `listCards` returns only `responsible`.
2. `desk/server.mjs`: `POST /api/cards/:id/reviews` — `comment` needs `comment`;
   `request-changes` needs `revise` on a request and what `handle` needs on a change
   (`handle`, or `handle-small` For Developers); `approve` as the existing approve/handle.
   With an agent ping (`withPing`) when it queued work.
3. `desk/mcp.mjs`/`toolkit/bin/desk.mjs`: `design desk item` returns the review with an item
   that names one (slice 03 adds the item).

## Docs and tests

- `docs/desk.md`: a short **Reviews** section after Questions (what a review is, the verdicts
  and what each does, who may send which, responsible) — the one home; `docs/requests.md` →
  Variants: one line that a review's change notes are worked as one revise.
- `desk/tests/store.test.mjs`: each verdict on each kind, drafts cleared, threads tagged,
  invalid draft leaves state untouched, `responsible` set and cleared (option redrawn; head
  changed), approve on a request not yet approved refused.
- `desk/tests/server.test.mjs`: abilities per verdict (a guest may only comment).

## Acceptance criteria

- [ ] A review turns every draft into its own conversation and clears the drafts, atomically.
- [ ] Each verdict does what README → Approach says, nothing more; the CI check is never queued by a review except through `handle`.
- [ ] `responsible` is right on card reads and list rows and clears on a new version.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/server.test.mjs`.
