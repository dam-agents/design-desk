# 03 — Differences that last across pushes, and their actions

**Depends on:** 01, 02
**Part of:** Follow a design into its pull requests — see [README](./README.md)

## Context

Each push re-runs the comparison (01). A difference must keep its identity, and a person's choice
on it, across those runs. Each difference gets three actions. The UI dev owner sees them first.

## Implementation plan

1. **Store**:
   - `design_check` gains `sha` (the head compared). On each write the store merges with the card's
     previous check by difference key (README → glossary): a key in both keeps its person-set
     `action`; a key gone gets `fixed: {sha, at}` and is kept (shown as fixed, not counted); a key
     new since an earlier check gets `new_in: <sha>`. `LIMITS.designDifferences` counts only the
     agent's current ones.
   - Actions, `designDifference(changeId, who, key, action, text?)`: `fix` (Fix in code: adds the
     person's review draft about it, as Figma differences do — `{design: key, text}` beside the
     existing `{figma: part, text}` drafts — so Submit feedback posts it on the PR with
     `review_post`), `fine` (Fine as built: `accepted: {by, at}`; 04 adds the decision), `ask` (Ask
     the designer: `asked: {by, at}`), and `none` to take an action back. Who: designers, admins,
     UI dev owners; on a change that goes against a decision in force, designers and admins only.
   - Open differences = not fixed, not accepted. `attentionOf`: "Differs from the approved design"
     counts only open ones; an asked one adds a designer reason ("A UI dev owner asks a designer
     about <element>") whatever the tab; none open → no such reason. A change that builds a request
     starts For Developers (`forOf`: linked and judged → developers unless `size` moved it).
   - The request's Build line (02) counts open differences; Shipped by itself (the merged-change
     rule) also needs none open.
   - Ask the designer notifies the request's approver For you (see how notifications are pushed,
     `push(...)` in the notifications read).
2. **Server**: `POST /api/cards/<id>/design-difference {key, action, text}`.
3. **Page**: `designCheckBox()` becomes a table like the Figma one: per difference its element,
   what differs, both pictures, its state (New, Fixed in `<short sha>`, Fine as built · who, Asked a
   designer · who) and the three buttons for who may; fixed ones fold under "Fixed · n". Its hint no
   longer says only a designer decides.
4. **Docs**: watch.md step 11 (`sha`; write the full current list each time, the store keeps
   identity), desk.md (Needs a designer, For Developers: differences go to the UI dev owner first;
   Reviews: a draft about a difference), desk-page.md (the differences box).

## Acceptance criteria

- Store tests: identity kept across writes (action kept, fixed, new_in); each action and who may;
  attention counts open ones only; asked → designer reason; Shipped waits for open differences.
- Server and page tests for the route, the table, the states and the buttons by role.
- Docs updated; `verify` passes.
