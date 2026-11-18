# 03 — The calmer page and comments

**Depends on:** 02-header-and-actions
**Part of:** Simple mode list and detail page — see [README](./README.md)

## Context

Under the header, one order for both kinds: a short lead, the thing to judge (the designs or the
changes), what Design Desk checked, the long reads folded, then the conversation. This slice also
carries the PR's repository-wide duties.

## Implementation plan

Apply `/frontend-design` and `/copy`.

1. **`simpleRequest(c)` and `simpleChange(c)`** in `desk/page.html`: in simple mode,
   `renderRequest` and `renderChange` draw `simpleHead(c)` (slice 02) then these, instead of their
   full-mode body:
   - **the lead**: the item's short summary (a request's `note` / first paragraph, a change's
     explanation's first paragraph), two or three lines;
   - **the designs** (a request: its options as today's option tabs and mockup, All elements open)
     or **the changes** (a change: its before/after screens as today);
   - a vote's result, when there was one, as one read-only line (no vote buttons);
   - **What Design Desk found** (`sFound`): what the Desk checked against — decisions in force
     (`conflicts`, with the D-numbers), the approved design, Figma (only with Figma on for the
     viewer), and the CI gate's hold — each a line with its source; "Nothing to flag" when empty;
     this replaces the red **!** and the attention line in simple mode;
   - **folds in one style** (`<details>`, closed): "What changed and why", "Where else this shows
     up", "Under the hood", "Earlier decisions about it" — each only when the card has it;
   - **Comments**.
2. **Comments** (`simpleThreads(c)`, beside `renderThreads`): each thread a card with avatars, the
   author's name (the name rule) and role (`ROLE`, designer and developer told apart by its icon),
   a short date (`sWhen`); replies indented under the first message; a resolved thread folds to one
   line ("Resolved by <name> · <date>") that opens on click; the existing reply box and resolve
   action, with `may: {reply, resolve}` as today. Private asks and the design workspace are not
   changed.
3. **Version and changelog**: `VERSION` minor bump (one above `main`'s at merge time; 1.99.0 when
   `main` is 1.98.x) and its `CHANGELOG.md` entry, **Upgrade:** republish the page
   (`docs/desk.md` → Publishing the page): simple mode shows one list of requests and pull
   requests with three states and a calmer page; no data migration.
4. **Docs**: `docs/desk-page.md` → The page → Simple mode: the page's order, What Design Desk found,
   the folds and the comments; the sentence that simple mode "only hides" is gone, and what it
   still hides stays listed. Size sweep (`wc -l` against `main`, `docs/self-modification.md` §9).
5. **What went missing**: go through full mode's request and change pages and list what a
   reviewer still needs that simple mode no longer shows (decision 10 in the README); keep it,
   move it under ⋯, or drop it on purpose. Bring the list to the operator before the commit, and
   name what was dropped in the PR body.
6. **Manifest check**: nothing public changes (no trigger, label, marker or skill); say so in the
   PR body.

## Docs and tests

- `docs/desk-page.md`, `VERSION`, `CHANGELOG.md` as steps 3–4.
- `desk/tests/page.test.mjs` (`DESK(...)`, `simple: true`):
  - a request's page shows, in order, the lead, the designs, What Design Desk found, the folds, the
    comments; a change's the same with its changes;
  - What Design Desk found names a decision a request goes against and says Nothing to flag
    without one;
  - a thread with a reply shows it indented; a resolved one is one line and opens on click; an
    address-only author shows the part before the `@`;
  - full mode's request and change pages are unchanged (existing tests stay green).

## Acceptance criteria

- [ ] In simple mode a request's and a change's page shows the header, lead, designs or changes,
      What Design Desk found, the folds and the comment threads, in that order, on real data.
- [ ] Threads tell a designer from a developer, indent replies and fold when resolved.
- [ ] `VERSION` is bumped once with its `CHANGELOG.md` **Upgrade** entry; `docs/desk-page.md` no
      longer says simple mode only hides and carries the state table.
- [ ] Full mode's detail pages were reviewed for what simple mode lost; each item is kept, under ⋯,
      or dropped with the operator's agreement and named in the PR body.
- [ ] `bash scripts/validate-definition.sh .` and `bash scripts/tests/run.sh` pass.

## Smoke test

`bash scripts/tests/run.sh` and `bash scripts/validate-definition.sh .`, then the made-up Desk
(`node desk/dev/mock.mjs 5610`, `?role=designer`, Simple mode on, light and `&theme=dark`): open a
request with options and comments — lead, designs, What Design Desk found, folds closed, threads
with indented replies and a resolved one folded; open a change — the same with its screens. Then
the README's whole-feature smoke test.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
