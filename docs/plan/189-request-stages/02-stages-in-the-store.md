# 02 — Stages in the store

**Depends on:** 01-ui-dev-owner
**Part of:** Draft and Proposal — see [README](./README.md)

## Context

The data and the rules: a request's `stage`, how it starts, the four moves and who may make
them, and what a staged request refuses. No hiding yet (slice 03) and no page (04, 05): this
slice is verified through the store and the API.

## Implementation plan

1. `desk/store.mjs`:
   - `export const REQUEST_STAGES = ["draft", "proposal"]`.
   - `createRequest(who, {…, stage = null})`: the server passes the stage (step 2); the store
     keeps it only for a person (`!who?.agent`), validated against `REQUEST_STAGES`. Agent-filed
     requests never get one.
   - A new method `moveStage(cardId, who, to)` for `to` in `proposal | design | developers |
     draft` (README → contract). Rules (README → Who may do what): the author by `filedBy`; the
     roles via `can()` (step 3). On leaving the last stage: delete `stage`, set `opened_at`,
     and for `developers` set `size = {small: true, by, at}` (as `setSize` does), for `design`
     `size.small = false`. Push `{from, to, by, at}` on `staged`; bump `updated`; save.
     A request with no stage, or closed (`declined`, `handed-off`), refuses every move.
   - What a staged request refuses (README → What a staged request refuses), one guard
     `notStaged(c, what)` throwing `bad("This request is still a draft|proposal: send it to design first.")`:
     in `act()` for `approve`, `build`, `slack-share`, `slack-send` and the spec; in
     `decideAndClose`, `openFeedback`, `endVote`, `vote`, `queueForCall`, `openPoll`, `openCouncil`,
     `specAction`. Leave Design Desk's work (`explore`, `revise`, `states`, `now`, `before`,
     `figma-*`), comments, drafts and reviews alone; `sendReview` refuses only `approve` on a staged request.
   - Closing: `act(…, "close")` on a draft by its author, and on a proposal by the
     `ui-dev-owner` or `admin`, is allowed whatever `can(role, "close")` says (the server's
     `need("close")` must let these through: step 2).
   - `listCards` rows and `getCard` carry `stage` and `opened_at` (`getCard` returns the card,
     so `staged` too).
2. `desk/server.mjs`:
   - `POST /api/requests`: the stage by the filer's role — `designer` → none; `guest` never gets
     here; everyone else → `"draft"`. Put the rule in one store helper (`stageFor(role)`) so the
     page and tests read the same.
   - `POST /api/cards/<id>/stage {to}` → `store.moveStage`.
   - The `actions` route: `close` on a staged request goes to the store's own check instead of `need("close")`.
   - `/api/me`'s `can` gains what step 3 adds.
3. `can()`: `stage-propose` (`developer`, `ui-dev-owner`, `admin`), `stage-design`
   (`pm`, `ui-dev-owner`, `admin`; `designer` too — harmless, they never have a draft),
   `stage-own` (`ui-dev-owner`, `admin`: moves on anyone's proposal); add them to `ACTIONS`.
4. `desk/mcp.mjs`: an MCP peer that files a request gets a draft by its role like a person;
   check `PEER_ROUTES` lets `/stage` through only if peers should move stages — they should not:
   leave it out.

## Docs and tests

- Docs: a new `### Draft and Proposal` section in `docs/desk.md` under Roles (the home of
  every rule above: who files what, the moves, what a staged request refuses), the Roles table's
  new rows; `docs/requests.md` (how a request starts: a draft unless a designer or the agent
  files it) links it; `docs/desk.md` → For Developers or For Designers: Keep for developers.
- Tests: `desk/tests/store.test.mjs` — filing by each role; each move by each role (allowed and
  refused, with the words); a closed or open request refuses moves; `developers` sets
  `size.small`; `opened_at`; each refused action on a draft and a proposal; Design Desk's
  `revise` and a Request changes review still work on a draft. `server.test.mjs` — the route,
  `POST /api/requests` by role, `/api/me` `can`.

## Acceptance criteria

- [ ] A developer's request is a draft; a designer's is open; the agent's is open.
- [ ] Each move works for exactly the roles in the README and refuses others with plain words.
- [ ] A staged request refuses approve, votes, team feedback, Slack, the presentation, a prototype.
- [ ] Existing requests (no `stage`) behave exactly as before; the whole suite passes.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/server.test.mjs` passes. With the mock server
(`node desk/dev/mock.mjs`): `curl -s -XPOST 'localhost:5610/api/requests?role=developer' -d '{"title":"t","problem":"p"}'`
returns a card with `"stage":"draft"` (adapt to how the mock takes a role); `POST
/api/cards/<id>/stage {"to":"design"}` as that developer → 403; `{"to":"proposal"}` → stage
proposal; as `ui-dev-owner` `{"to":"design"}` → no stage, `opened_at` set.
