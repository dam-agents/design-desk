# 05 — The review in the conversation, the state, the bell

**Depends on:** 02-send-review, 04-simple-review-ui
**Part of:** Reviews — see [README](./README.md)

## Context

What others see once a review is sent: one block in the conversation, the item's state and
who is responsible, and the bell's events.

## Implementation plan

1. `desk/page.html`:
   - `simpleThreads` and full mode's `renderThreads`: threads with `review` gather under one
     block per review — avatar, who, the verdict as a word with its colour (Request changes
     amber, Approve green, Comment neutral), the note, then each comment as today's thread card
     with its replies; a review's posted link ("On GitHub ↗") when `posted.url`.
   - `simpleState`: a change with `responsible.who === "developer"` is `dev`; the head's line
     reads "Changes requested · developer" (`sh-line`), and a request with `design-desk` keeps
     Open with the spinner's words "Drawing the next version". A list row keeps the pill alone,
     as #184 draws it; its tooltip names who works on it.
2. `desk/store.mjs` → `notifications`: events `review` (a review sent; detail the verdict in
   words and the note's start; For you for the item's people as today), `new-version` for a
   change whose head changed after a request-changes review (`options-redrawn` already covers a
   request). Add their labels and icons to the page's bell table.

## Docs and tests

- `docs/desk-page.md` → A request's state in the list (the In dev rule for a change after
  Request changes; Open for a request), Notifications (the table's two rows), The page (the
  review block).
- `desk/tests/page.test.mjs`: the block in simple and full mode; the In dev pill and line;
  `desk/tests/store.test.mjs`: the two bell events.

## Acceptance criteria

- [ ] A sent review shows once, as one block, in both modes.
- [ ] A change with changes requested is In dev with its line, and Open again after a new head.
- [ ] The bell lists a review and a new version.

## Smoke test

`node --test desk/tests/page.test.mjs desk/tests/store.test.mjs`; on the mock Desk, a mock
change with a request-changes review (`desk/dev/mock-data.mjs`) shows In dev and its line.
