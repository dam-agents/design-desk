# 04 — Simple mode

**Depends on:** 02-stages-in-the-store, 03-hidden
**Part of:** Draft and Proposal — see [README](./README.md)

## Context

What a person sees in simple mode: the two new states as their own pills, a filter that lists
only the states the viewer can have items in, the stage moves in the request's head, and New
request making a draft. A designer's simple mode does not change.

## Implementation plan

All in `desk/page.html` (`/frontend-design`; the guidelines page and the scale tests win):

1. `simpleState(c)`: a request with `stage` → `{state: "draft"|"proposal"}` before anything
   else. `SIM_STATES` becomes Draft, Proposal, Open, In dev, Closed; `SIM_PILL`/`SIM_TIP` gain
   Draft ("Only you see it while you work on it") and Proposal ("The dev team discusses it before
   it goes to design"). Pill inks: Draft grey (outlined, as a pull request's Draft), Proposal amber
   — through the existing `.spill[data-s]` rules.
   A staged request is on the viewer's side whatever `forOf` says (its side is decided on opening).
2. The filter (`simpleFilterBar`, `SIM_DEFAULT`, the saved `desk-simFilter`): only the states the
   viewer can have items in — Draft when they may file a draft (`can.stage_propose ||
   can.stage_design`, not a designer), Proposal for `developer`, `ui-dev-owner`, `admin`.
   **Reset to default** = every listed state before In dev. A saved filter with a state the
   viewer cannot see drops it.
3. `simpleOverview()`: Draft and Proposal boxes only when they have items, before Open.
4. `simpleHead(c)` moves (at most two buttons, rest under ⋯):
   - Draft, author: **Send to design** (primary) where `can.stage_design`, else **Propose**
     (primary); a `ui-dev-owner` gets both (Send to design primary). Request changes (from #187)
     as second when options exist. ⋯: **Close…**.
   - Proposal, `ui-dev-owner`/`admin`: **Send to design** (primary) + Request changes; ⋯ **Keep for
     developers**, **Back to draft**, **Close…**. A developer: Request changes only.
   - Each move: `POST /api/cards/<id>/stage`, a toast in plain words ("Sent to design: designers
     see it as Open now."), then refresh. Send to design and Keep for developers confirm first
     (an `ask` dialog: designers will see it, it cannot come back).
5. New request (`#new` form): for a filer whose request starts as a draft the submit says
   **Create draft** and a line under it says who sees it; a designer's says as today. After
   creating, the request opens in its Draft state.
6. `desk/dev/mock-data.mjs`: one draft (by the mock developer) and one proposal, so the mock
   shows both.

## Docs and tests

- Docs: `docs/desk-page.md` → Simple mode (the filter's states by role, Reset to default, the
  boxes, the head's moves, New request) and → A request's state in the list (the two pills, In
  simple mode paragraph).
- Tests: `desk/tests/page.test.mjs` — `simpleState` of a draft/proposal; the filter's states for
  designer, pm, developer, ui-dev-owner; a saved filter dropping an unseen state; the head's moves
  per role and stage; New request's button word. Follow how existing simple-mode tests load the page.

## Acceptance criteria

- [ ] A designer's simple mode is unchanged (filter, boxes, list) — an existing test proves it.
- [ ] A developer sees Draft, Proposal, Open, In dev, Closed; default ticks Draft, Proposal, Open.
- [ ] The head offers exactly the moves of the README per role and stage, and they work.
- [ ] New request makes a draft for everyone but a designer.

## Smoke test

`node --test desk/tests/page.test.mjs` passes. `node desk/dev/mock.mjs`, simple mode on:
`http://localhost:5610/?role=developer` → the list shows the mock draft (grey Draft pill) and
proposal (amber); Filter lists five states. Open the draft → Propose. `?role=ui-dev-owner` → the
proposal shows Send to design; press it → Open. `?role=designer` → the filter has three states
and the proposal is not listed until sent.
