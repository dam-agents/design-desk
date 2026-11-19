# 02 — Looks good on the server

**Depends on:** 01-feedback-words
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

A reviewer marks a pull request's change as fine. On the server that is a draft with no text,
sent as a list on the review, shown as current until the pull request's next version, and
written into the post on GitHub.

## Implementation plan

Apply the repository's conventions in `desk/store.mjs` (one home per rule, `bad()` refusals).

1. **A change's key** — `changesOf(c)` in `desk/store.mjs` (exported for tests): from
   `c.screens`, one entry per `pair` among screens with a `stage`, then one per screen without
   one: `{key, name}`, `key` the `pair` or the lone screen's `asset`, `name` the `pair` or the
   screen's `caption` (else "Screen <n>"). Slice 03's page helper mirrors it; say so in both comments.
2. **`addDraft(cardId, who, {text, anchor, change, ok})`**:
   - `ok: true` only on a `change` card, with `change` a key of `changesOf(c)`; no `text`
     (refused with one). One per person and change: adding it again returns the list as it is.
     Refused while that person has a text draft on the same change ("Remove your notes on it first").
   - A text draft with a `change` that is a key drops that person's `ok` draft on it.
   - A text draft's `change`, when the card is a change, must be a key or empty (today it is any
     text; keep accepting any text for request cards).
3. **`sendReview`**: `ok` drafts make no conversation; the review gets `looks_good: [{key, name}]`
   for those still in `changesOf(c)`. "Write a comment or a note first" accepts a review whose
   only content is Looks good. Allowed with every verdict.
4. **A card read** (`getCard`, where it spreads `responsible`; and the list's row in
   `listCards`, beside `responsible: this.responsibleOf(c)`, for slice 04's chips): on a change,
   `looks_good: [key…]` — the union of `looks_good` keys of the card's reviews whose `sha` equals
   `this.headOf(c)`; empty when there is no head. A new head empties it.
5. **The route**: `POST /api/cards/<id>/drafts` passes `ok` through (`desk/server.mjs`). The
   mock Desk's drafts and reviews routes (`desk/dev/mock.mjs`) do the same, and its card read
   computes `looks_good`, so the page can be tried without a server.
6. **GitHub** — `docs/watch.md` → Reviews on GitHub, step 1: after the note, one line
   "✓ Looks good: <name>, <name>" when `looks_good` is not empty. Check that `design desk item`
   returns the review whole (it carries `looks_good` with no change); if it projects fields, add it.

## Docs and tests

- `docs/desk.md` → Reviews: a Looks good draft, its rules, `looks_good` on the review and on a card
  read, until the next version. `docs/watch.md` as above.
- `desk/tests/store.test.mjs`: `changesOf` (pairs, lone screens, names); ok drafts (refused on a
  request, on an unknown key, with text, with notes on the change; idempotent; dropped by a text
  draft); a review with only Looks good; `looks_good` on the review; the card read's
  `looks_good` with the head equal, then another head → empty.
- `desk/tests/server.test.mjs`: the drafts route with `ok`.

## Acceptance criteria

- [ ] An ok draft is kept, listed and removed like any draft, and only its author sees it.
- [ ] Sent, it adds no conversation and appears in `looks_good` on the review with its name.
- [ ] A card read's `looks_good` holds it until `headOf(c)` changes.
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/server.test.mjs` passes with the new cases.
The page has no Looks good button until slice 03, so the end-to-end check is the store test that
adds an ok draft, sends Comment only, reads the card (`looks_good` holds the key), moves the
GitHub copy's head and reads it again (empty).

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
