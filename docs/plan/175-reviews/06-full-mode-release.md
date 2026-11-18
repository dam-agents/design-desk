# 06 — Full mode: drafts and the dialog; release

**Depends on:** 04-simple-review-ui, 05-review-block-state-bell
**Part of:** Reviews — see [README](./README.md)

## Context

Full mode gets the same drafts and review dialog in its own layout; then the release duties.

## Implementation plan

1. `desk/page.html` (full mode): the comment composer under an option and in the design
   workspace's note offers **Add to review** beside its send; a **Your review (n)** bar above
   the conversations with the bubbles and **Finish review…**, which opens slice 04's dialog.
   Reuse slice 04's helpers; no second dialog.
2. `desk/dev/mock-data.mjs`: a request and a change with drafts and a sent review, for the
   smoke test.
3. `VERSION` 1.101.0 (or one minor above main's at merge) and `CHANGELOG.md` entry —
   **Upgrade**: republish the page; restart the Desk server (new routes); no data migration
   (`drafts`, `reviews` start empty).
4. Read `docs/desk-page.md`, `docs/desk.md`, `docs/requests.md`, `docs/watch.md` through for
   leftovers ("left to #175", "only hides"), and run the size sweep (§9).

## Docs and tests

- `docs/desk-page.md` → The page: full mode's Your review bar (one sentence; the rest links to
  the simple mode paragraph).
- `desk/tests/page.test.mjs`: full mode's Add to review and Finish review.

## Acceptance criteria

- [ ] Full mode collects and sends a review with the same dialog.
- [ ] `VERSION` bumped once, `CHANGELOG.md` entry with its Upgrade block; the validator passes.
- [ ] `verify` passes in full.

## Smoke test

`verify` from `work/CONFIG.md`; the mock Desk in full mode: Add to review on an option,
Finish review…, Comment only — the review block shows.
