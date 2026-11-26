# Follow a design into its pull requests

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/design-desk/issues/237

## Goal

A design approved on the Desk is followed into the pull requests that build it. The request and
each pull request stay two items, clearly linked: the request shows a **Build** section (one line
per pull request, with its verdict) and a **Build** state while a ready pull request builds it; the
change card says **Builds R-<n>** and holds the comparison. Draft pull requests stay off the Desk.
Every push that touches the UI compares the pull request with the design again, each difference
keeping its identity. The UI dev owner sees the differences first and settles each one: **Fix in
code**, **Fine as built** (a decision in force at once) or **Ask the designer**. Links Design Desk
only guesses are suggestions a person confirms.

## Approach

The watch run (docs/watch.md) finds pull requests and writes change cards; the Desk's store
(desk/store.mjs) keeps cards and derives what the page reads (`buildsOf`, `attentionOf`, `forOf`,
`holds`); the server (desk/server.mjs) maps a person's button to a store method behind a role check
(`can()`, `need()`); the page (desk/page.html) is one file of plain JS rendering what the store sends.

- **Today's link** is `buildsIndex()`/`buildsOf()` (the spec's PR, or a PR the spec's issue lists in
  the GitHub copy) plus `design_check.request`, which the agent writes per watch step 11. Step 11 also
  links on "touches the file of an element it changes" — that rule becomes a suggestion.
- **Today's comparison** is `design_check` on a change card (`cleanDesignCheck`), written whole by
  the agent each time; the page draws it in `designCheckBox()`. The store adds "Differs from the
  approved design R-<n>" in `attentionOf()`.
- **Today's decision rule**: `holds(d)` — a decision from a developer or a `pr`/`issue`/`commit`/`doc`
  origin counts only once a designer approves it (`approveDecision`, role `decide`).

Docs are the definition: every behaviour change lands with its doc (watch.md, desk.md,
desk-page.md, config.md where a key's text changes) in the same commit. Read
docs/self-modification.md before editing; §11 (no repetition) and §12 (versioning) apply.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Drafts stay off; compare again on UI pushes | preflight, ledger, watch.md | — |
| 02 | Linked builds and the Build state | store, server, page, watch.md step 11, desk.md, desk-page.md | — |
| 03 | Differences that last across pushes, and their actions | store, server, page, watch.md, desk.md, desk-page.md | 01, 02 |
| 04 | An accepted difference is a decision in force | store, server, page, desk.md | 03 |

## Conventions & glossary

- **Linked**: a pull request builds a request, explicitly (the spec's issue or PR, a
  `design-desk/r<n>-…` branch, `R-<n>` named in the PR, the PR a request was filed from) or confirmed
  by a person (**Link**). **Suggested**: Design Desk found a reason (an element the design changes)
  but nobody confirmed; it counts for nothing until **Link**.
- **Build state**: a request sent to developers (`handed-off`), not built, with at least one linked
  change whose pull request is open and not a draft.
- **Difference key**: a difference's identity across pushes — its element card when it names one,
  else its element's name normalised as the page's `partKey()` does.
- Roles: `designer` (and `admin`) and `ui-dev-owner` act on differences; a difference on a change
  that goes against a decision in force is a designer's (as `mayHandle()` already rules).
- Words on the Desk follow docs/desk.md → Writing on the Desk: plain, the product's words, no code.
- Tests: the repository tests every behaviour (desk/tests/*.test.mjs with `node --test`,
  scripts/tests/test_*.sh); each slice adds the tests that fail without it.

## Whole-feature smoke test

`work/CONFIG.md` → `verify` passes. On the mock Desk (`node desk/dev/mock.mjs`, see
desk/dev/) a request sent to developers with a linked open PR reads **Build**, lists the PR in its
Build section; the change card says **Builds R-<n>**, shows its differences with the three actions;
Fine as built records a decision in force; a suggested link shows Link / Not this one.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for #237, one minor
version (1.121.0, or the next free one at rebase) with its CHANGELOG Upgrade block.
