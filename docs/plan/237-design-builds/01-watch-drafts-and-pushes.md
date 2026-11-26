# 01 — Drafts stay off; compare again on UI pushes

**Part of:** Follow a design into its pull requests — see [README](./README.md)

## Context

Today the watch pre-flight lists open pull requests, drafts included, once they touch a UI file, and
a carded open pull request is due again only when it merges (ledger status `open`). Decided: no draft
pull request gets onto the Desk; a carded open pull request is compared again on every push that
touches UI files, whether or not `ci_gate` is on.

## Implementation plan

1. `scripts/preflight.sh` (watch pass, the open-PR search around `is:pr is:open`): leave drafts out
   — `draft:false` in the search, and skip any item whose `draft` is true. A draft is not ledgered,
   so it becomes a candidate the pass it is marked ready. A PR already carded that went back to
   draft keeps its card: nothing is due for it while it is a draft.
2. Head tracking: `ledger.sh open <repo> <pr> <card> [<head sha>]` records the head the card was
   judged on (in the note, e.g. `head <sha>`; keep the TSV columns as they are). The pre-flight, for
   each PR whose last row is `open` and that is still open and not a draft, reads its head
   (`repos/<slug>/pulls/<n>`, one lookup, counted in `MAX_LOOKUPS`); when it differs from the
   recorded head, it compares the two (`repos/<slug>/compare/<old>...<new>`) and keeps the UI files
   touched. None → append an `open` row with the new head (no work). Some → due, with
   `kind: "push"`, `head`, and `ui_files` of the push. No head recorded (rows from before) → record
   the current head without a run. A failed read is logged and retried next pass, as today.
3. `docs/watch.md`: the opening paragraph (drafts never carded, carded once ready; a PR back to
   draft keeps its card), step 9 (`ledger.sh open … <head>`), and a short **A new push** part — a
   `kind: push` entry updates the same card: what the new commits change for people, its
   `attention`, and step 11's comparison on the new head (`design_check.sha`, slice 03 keeps
   differences across pushes), then `ledger.sh open` with the new head. The CI gate's "A new commit"
   bullet points to it instead of repeating it. `docs/config.md` → `watch_open_prs`: ready pull
   requests, not drafts.
4. `scripts/ledger.sh` usage comment and its `open` command accept the optional head.

## Acceptance criteria

- A draft open PR with UI files is not in `changes_due`; the same PR, ready, is.
- A carded open PR whose head moved with UI files touched is due as `kind: push`; one whose new
  commits touch no UI file is not, and its recorded head moves on.
- `scripts/tests/test_watch.sh` covers: draft left out, ready listed, push with UI files due, push
  without UI files not due, no recorded head records one. (`scripts/tests/bin` holds the fake `gh`.)
- `work/CONFIG.md` → `verify` passes.
