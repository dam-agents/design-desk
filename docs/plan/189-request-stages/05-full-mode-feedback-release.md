# 05 — Full mode, Send feedback, release

**Depends on:** 04-simple-mode
**Part of:** Draft and Proposal — see [README](./README.md)

## Context

Full mode shows the stages too, the feedback button reads the same in every stage and both
modes, and a request that opened shows what was said before it under **Before design**. Then the
release: VERSION, CHANGELOG and a read-through of every doc the issue touched.

## Implementation plan

1. `desk/page.html`, full mode:
   - The request's dot and state box (`A request's state in the list`): Draft (grey) and
     Proposal (amber) with their words, before every other state; never pulses differently.
   - Requests filters (`FILTERS.reqFilter`): a staged request counts under Open and Your turn
     (the author's draft, the UI dev owner's proposal); it is on the viewer's tab whatever its
     side. The state box holds the same moves as simple mode's head (share the code).
   - What a staged request refuses (slice 02) is not offered: vote buttons, Ask for a vote, the
     presentation, Build a live prototype, Approve.
2. **Send feedback** in both modes: "Send review…" (Your review), the dialog's title and OK
   ("Send your review"/"Send review") → "Send feedback…", "Send feedback"; toasts say "Feedback
   sent." `verdictsFor(c)` offers no Approve while staged. Keep the API (`/reviews`) and the data
   names: only words change.
3. **Before design**: in both modes' conversations, a request with `opened_at` folds the
   conversations started before it (a thread's first message `at` < `opened_at`) into one fold,
   **Before design · n**, closed by default, at the top of Comments. Reviews from before go with
   their threads.
4. Release: `VERSION` minor bump (one above main's at merge); `CHANGELOG.md` **Upgrade**:
   restart the Desk server and republish the page; a roster's `Lead developer` still reads (offer
   the operator to rename rows to `UI dev owner`, never do it); no data migration.
5. Read through `docs/desk.md`, `docs/desk-page.md`, `docs/requests.md`, `docs/config.md`,
   `docs/digest.md`, `docs/mcp.md` for one home per rule and no stale "lead developer" or
   "Send review"; delete `docs/plan/189-request-stages/` in its own last commit
   (`chore(plan): drop 189-request-stages plan`).

## Docs and tests

- Docs: `docs/desk-page.md` → A request's state in the list (full mode's dot), Pages and filters,
  Simple mode (Send feedback, Before design); `docs/desk.md` → Reviews (the button's name; verdicts
  by stage, linking Draft and Proposal).
- Tests: `page.test.mjs` — full-mode dot and label of a draft and a proposal; Open filter counts
  them; the feedback button and dialog words in both modes; no Approve verdict while staged;
  Before design folds only conversations older than `opened_at`. `scripts/tests` — the changelog /
  version checks the validator already runs.

## Acceptance criteria

- [ ] Full mode shows Draft and Proposal like simple mode, with the same moves.
- [ ] No "Send review" left on the page; Send feedback in both modes.
- [ ] A request sent to design shows its earlier conversations folded under Before design.
- [ ] `VERSION` and `CHANGELOG.md` updated; `verify` passes; the plan folder is gone.

## Smoke test

`verify` (work/CONFIG.md) passes. Mock server, full mode: `?role=developer` → the draft's dot
is grey and reads Draft; add a draft comment → **Send feedback…** → dialog offers Request changes
and Comment only, no Approve. `?role=ui-dev-owner` → Send to design on the proposal;
`?role=designer` → it is Open, and Comments starts with **Before design · 1** folded.
