# 01 — Drafts on the server

**Part of:** Reviews — see [README](./README.md)

## Context

A person's draft comments on a card, kept by the store so they follow the person to any
device, and seen by nobody else. No UI yet: slice 04 uses this API.

## Implementation plan

1. `desk/store.mjs`:
   - `emptyDb()` gains `drafts: {}`; the loader fills it in for an older `db` (as `seen`/`noted`).
   - Shape: `db.drafts[<viewerKey>][<cardId>] = [{id, text, anchor, at}]`, `id` a short
     random one (`randomUUID().slice(0, 8)`), not a numbered series: nobody else ever sees it. `anchor` through `cleanAnchor`, plus an optional
     `change` (a change card's screen or pair name, for #176) kept as text (≤120).
   - `drafts(cardId, who)` → the viewer's list; `addDraft(cardId, who, {text, anchor})`
     (checks the card exists and is a `request` or `change`, `clean(text, LIMITS.text)`,
     an anchored variant/state exists as `openThread` checks, at most `LIMITS.draftsPerCard`
     = 50 per person and card); `removeDraft(cardId, who, id)`; `clearDrafts(cardId, who)`.
   - The agent (no `viewerKey`) has no drafts: refuse with `bad`.
   - Drafts are left out of every card read, list, stats and notification.
2. `desk/server.mjs` (`/api` routes): `GET /api/cards/:id/drafts`, `POST /api/cards/:id/drafts`
   (`need("comment")`, inside the write budget like a thread), `DELETE /api/cards/:id/drafts/:draft`.
   Peers (`PEER_ROUTES`) get none of them.
3. A deleted card (`deleteRequest`) drops its drafts for everyone.

## Docs and tests

- `docs/desk-page.md` → The page: one short paragraph on drafts (private, kept on the Desk,
  every device) — slice 04 extends it with the UI.
- `desk/tests/store.test.mjs`: add, list, remove, limit, another person sees none, a card read
  carries none, a deleted card drops them.
- `desk/tests/server.test.mjs`: the three routes, a guest without `comment` refused, another
  person's `GET` empty.

## Acceptance criteria

- [ ] A person's drafts survive a store reload and are returned only to them.
- [ ] No card, list, notification or stats response carries a draft.
- [ ] The routes refuse what `openThread` would refuse for the same anchor.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/server.test.mjs` passes, including the new cases.
