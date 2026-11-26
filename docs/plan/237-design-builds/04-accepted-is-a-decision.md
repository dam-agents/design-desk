# 04 — An accepted difference is a decision in force

**Depends on:** 03
**Part of:** Follow a design into its pull requests — see [README](./README.md)

## Context

Decided: Fine as built records a decision that counts at once, in the name of who accepted it,
approved by them. Designers hear of one a non-designer approved and may revoke it. The UI dev owner
may also approve the decisions a pull request's own notes record.

## Implementation plan

1. **Store**:
   - `designDifference(..., "fine")` records a decision: `origin: {kind: "desk", label: "Accepted
     as built", card: <change id>}`, `author` the person (role from the Desk), `concepts` from the
     request's concepts (or the element), `text` "<element>: built as it is in PR #<n>" plus the
     difference's `what`, and `approved: {by, at}` set to the same person — so `holds()` counts it.
     Keep the decision id on the difference (`accepted.decision`); taking Fine as built back revokes
     that decision with a reason.
   - `approveDecision`: a `ui-dev-owner` may approve too (the server's role check moves from
     `decide` to a new ability, or `decide` widens for this one route — keep revoke/restore a
     designer's). A decision approved by someone not on the design side notifies every designer
     For you, once.
2. **Server**: the approve route's role check; `/api/me` abilities for the page.
3. **Page**: the decision's status box shows Approve for a UI dev owner; its line names who
   approved (`approved by:`); a difference accepted shows its decision number linked.
4. **Docs**: desk.md → Decisions (Approved by a designer becomes "Approved": a designer, an admin or
   a UI dev owner; the origin table's `desk` row covers Accepted as built; designers are told),
   watch.md where step 4 records a PR's reasons.

## Acceptance criteria

- Store tests: Fine as built records a decision in force, approved, cited on the difference; undo
  revokes it; a UI dev owner approves a waiting decision and designers get one notification each.
- Server and page tests for the approve route and the box.
- Docs updated; `verify` passes.
