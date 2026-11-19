# 03 — Hidden from who may not see it

**Depends on:** 02-stages-in-the-store
**Part of:** Draft and Proposal — see [README](./README.md)

## Context

The first items on the Desk that not everyone may read. The server hides them — the page only
renders what it gets. Every path a person (or an MCP peer) reads a card through must apply
one rule, `visibleTo(c, who)` (README → Who sees a staged request). The agent sees everything,
and its own runs leave staged requests out of what they publish.

## Implementation plan

1. `desk/store.mjs`:
   - `visibleTo(c, who)`: true for a card with no `stage`, for `who.agent` or no `who`
     (agent routes), the author (`filedBy` by any address), `admin`, and on a proposal
     `developer` / `ui-dev-owner`. Needs the caller's role: `actor` in `server.mjs` carries
     `role` already.
   - Apply it in every person's read — find each loop over `this.db.cards` (`rg -n
     "Object.values\(this.db.cards\)" desk/store.mjs`) and decide per site; at least:
     `listCards` (pass `who`), `getCard` (throw `missing` with the same words as an unknown card),
     `notifications` (skip; and a staged-then-opened request's `new-request` event is at
     `opened_at`, so designers hear of it when it opens — not at `created`), `getDecision` refs,
     `agenda`/`presented`, `peopleActivity`, `drafts`/`addDraft`/`sendReview`/`openThread`/`reply`
     (a person who may not see the card cannot write on it: same 404), `markRead`, `getAsset`
     for an asset of a staged card (`asset.card`), `github()` records only point at cards — leave.
   - `threadFor`: a thread on a staged card follows the card.
2. `desk/server.mjs`: pass `actor` (with role) to `getCard` / `listCards`; `withPing` and every
   write route go through store methods that check. The agent routes stay unfiltered; `/agent/cards`
   rows carry `stage`.
3. The agent's own runs:
   - `scripts/preflight.sh`: the digest's counts and lists (`requests_new`, …) and anything that
     posts or shows requests to the team (`slack_due`, `polls_due`, `councils_due`, `agenda_due`)
     skip a card with `stage` — find where it reads `db.json` with jq.
   - `docs/digest.md`, `.agents/skills/intake-slack/SKILL.md` (never merge a Slack report into a
     staged request: file a new one), `.agents/skills/impact/SKILL.md` (never cite a staged request
     on another card), `docs/requests.md` → Chat and Slack (never name a staged request to
     someone who may not see it). One sentence each, linking `docs/desk.md` → Draft and Proposal.
4. `docs/mcp.md`: a peer sees by its `mcp_role`.

## Docs and tests

- Docs: `docs/desk.md` → Draft and Proposal gets **Who sees it** (the one home); `docs/desk-page.md`
  → Notifications (a new request is told when it opens); `docs/desk.md` → Private asks style
  wording is the model. Others as step 3.
- Tests: `store.test.mjs` — for a draft and a proposal, each role's `listCards`, `getCard`
  (404 words), `notifications` (and the event at `opened_at`), `getDecision` refs, agenda;
  `server.test.mjs` — `GET /api/cards`, `/api/cards/<id>`, threads and drafts as a designer
  vs the author vs a UI dev owner; `mcp.test.mjs` — a peer with `mcp_role: designer` does not see
  a proposal; `scripts/tests/` — the preflight test that covers digest counts gains a staged request.

## Acceptance criteria

- [ ] A designer, a PM and a guest get no trace of a draft or a proposal through any `/api` route;
      a developer gets none of another person's draft.
- [ ] The author and admin always see theirs; developers and the UI dev owner see proposals.
- [ ] The bell tells designers of a request when it opens, not before.
- [ ] The agent's routes see it; its digest and Slack work leave it out.

## Smoke test

`node --test desk/tests/*.test.mjs` and `bash scripts/tests/run.sh` pass. With the mock server:
as a developer file a request (draft); `GET /api/cards?role=designer` has no row for it and
`GET /api/cards/<id>` as a designer → 404 `no card <id>`; Propose; as `developer` (another
address) it is listed, as `pm` it is not; Send to design as `ui-dev-owner`; as `designer` it is
listed and the bell has a new-request row dated now.
