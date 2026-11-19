# 08 — Release

**Depends on:** 01–07
**Part of:** Feedback and the pull request change by change — see [README](./README.md)

## Context

The repository-wide duties, once: the version, its changelog entry, a read-through of the docs
the slices touched, and the whole-feature smoke test.

## Implementation plan

1. `VERSION`: minor bump from main's at the time (1.103.0 → 1.104.0, or one above main's).
2. `CHANGELOG.md`: the entry, in the repository's form, with its **Upgrade** block (restart the
   Desk server, republish the page; no data migration; drafts and reviews keep their shape, a
   review gains `looks_good`, a draft may carry `ok` or `work_in`).
3. Read-through (`docs/self-modification.md` §9): every link to a heading that moved; "review"
   left in words a person reads in `docs/desk-page.md` and `docs/desk.md`; `wc -l` of every
   changed `.md` against main — growth only where the behaviour lives.
4. `desk/guidelines.html` → Comments: the sample shows "Your feedback", a Looks good line and the
   sent block's "✓ Looks good"; `node desk/dev/guidelines.mjs` if the CSS copy changed.
5. Delete `docs/plan/176-feedback-pr-changes/` in its own commit before the PR is marked ready.

## Docs and tests

`CHANGELOG.md`, `VERSION`, `desk/guidelines.html`; `desk/tests/guidelines.test.mjs` passes.

## Acceptance criteria

- [ ] `VERSION` equals the newest `CHANGELOG.md` heading; the entry has its Upgrade block.
- [ ] The README's whole-feature smoke test passes on the mock Desk, light and dark, both modes.
- [ ] `verify` passes.

## Smoke test

The README's **Whole-feature smoke test**, run on `node desk/dev/mock.mjs 5610`, with screenshots
of the change view (simple, full; light, dark), the dialog's warning, the element dialog and the
workspace's Your feedback tab for the pull request.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
