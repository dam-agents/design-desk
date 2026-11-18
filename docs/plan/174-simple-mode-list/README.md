# Simple mode: one list of requests and pull requests, and a calmer detail page

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #174 (part of #173)

## Goal

A person in simple mode comes to the Desk to look at a design or a pull request's UI change and say
whether it is right. Today simple mode only hides parts of the full Desk, so they still meet many
sections, states and filters. This slice gives them one list of requests and pull request changes
with three plain states, a filter that shows only what narrows the list, and a calmer page for each
item with at most two actions. Full mode does not change.

## Approach

Everything is in the Desk page, `desk/page.html`, behind `simple()`; the server and the store keep
their data and their API (`docs/desk.md` → Server, Roles; `docs/handoff.md` → Review before it goes).
The behaviour and the layout come from the prototype (`origin/feat/simple-mode`, commit `251ebfc`:
`simpleCards`, `sState`, `openPill`, `sWhen`, `sHead`, `simpleRequest`, `simpleChange`, `sFound`,
`simpleThreads`, `sMsg`); its code is a reference only, never copied.

`docs/desk-page.md` → **The page** (the Simple mode paragraph) says simple mode "only hides": each
slice rewrites the part of that paragraph it changes, and slice 01 adds the state table below to
**A request's state in the list**.

### The simple state of an item

One pure function, `simpleState(c)` → `{ state, pill }`, is the only place that decides it; the
list, the filter counts, the row and the page header all read it. It is computed for requests and
changes on the viewer's side only (below); anything else is not in the list.

| Item | `state` | `pill` |
| --- | --- | --- |
| request, `status: declined` (`decided` or not) | `closed` | `closed` |
| request, `status: handed-off` and `built` | `closed` | `shipped` |
| request, approved (`status: spec`, or `handed-off` not built) | `dev` | — |
| request, `status: spec` with a spec draft waiting for a person (`spec.review: "draft"`, the viewer's `spec_review` on, no `approved.auto_send`) | `open` | — |
| request, any other status (`triage`, `variants`, `feedback`, `prototype`, `testing`, asking) | `open` | — |
| change, `archived` | not listed | — |
| change, neither `handled` nor `autoHandled(c)` | `open` | — |
| change, `handled` or `autoHandled(c)`, pull request not merged (`!source.merged_at`) | `dev` | — |
| change, `handled`, merged | `closed` | `shipped` |
| change, `autoHandled(c)` and not `handled`, merged | `closed` | `none` |

Words and inks: **Open** (green, the Desk's ok ink), **In dev** (the accent), **Shipped** (purple,
the ink of Merged), **No review needed** (grey), **Closed** (red). An item Design Desk works on
(`atWork(c)`) stays Open and its row and header show the Desk's spinner (`.dd-spin`), never the
pulsing dot. Every item has exactly one state; `docs/desk-page.md` carries this table in words.

### The viewer's side

Simple mode lists only the viewer's own side: For Developers for a `developer` or
`lead-developer`, For Designers for everyone else (`DEVELOPERS`, `forOf(c)`), as `reqFor()` and
`chgFor()` open today. No control switches it in simple mode; what developers need is #181's.

## Decisions

Taken with the operator while planning:

1. Three states, by who works on it: **Open** (needs a design decision), **In dev** (approved,
   developers build it, or reviewed and not merged), **Closed** (nobody works on it). Design Desk
   at work is not a state: Open with a spinner.
2. A closed row's pill says how it ended: **Shipped**, **No review needed**, **Closed** (declined,
   or closed with a decision; the page says which). There is no approval by an agent: a person
   approves every UI change.
3. The filter is one button opening a multiselect menu — State: Open, In dev, Closed; Kind:
   Requests, PR changes — with counts; beside the button only the active choices, as removable
   chips (both kinds on shows no Kind chip). Default: Open, both kinds. Kept per browser like the
   other list filters (`desk-simFilter`). OR inside a group, AND across groups. A row's pill hides
   when exactly one state is selected.
4. Simple mode has no For Designers / For Developers switch, no Your turn, Unread or Needs a
   designer, and no presentation: Open on the viewer's side is their turn.
5. A request's header offers **Approve** and **Request changes**. In simple mode Approve always
   sends the spec as soon as it is written (`auto_send: true`, no checkbox); where the store cannot
   (a Slack origin, a request from an open pull request) the spec draft comes back as Open with one
   action, **Send to developers**. Request changes is the existing revise with one note.
6. A change's header offers **Approve** (marks it handled, as today). **Request changes** and a
   review posted to GitHub are #175's, not this issue's.
7. The ⋯ menu: **Close…** (with "record a decision") and **Reopen** on a request, **Turn into a
   design request** (today's Adjust the design) on a change, and **Open on GitHub** where there is
   a link. The item's number and the link icon that copies its link stay in the title, as in full
   mode. Simple mode drops voting (a vote's result still shows), rename and the
   presentation.
8. A person with no name on the roster shows as the part of their address before the `@`, never the
   whole address.
9. The menu shows one entry, **Requests & PRs**, for both tabs (`requests` and `new`), and
   **+ New request**.
10. **Nothing important goes missing.** Before the PR is ready, the simple detail page is reviewed
    against full mode's for what a reviewer still needs (the number and the link icon were the
    first found); each one is kept, moved under ⋯, or dropped on purpose and listed in the PR.

### Open question, not in scope

Should every Design Desk request be a pull request — a draft pull request with a label such as
`design-desk-request`, its designs and spec kept in git? To discuss in its own issue.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | States and the merged list | `simpleState`, the one list, the filter menu, the rows, the menu entry | — | [[x] |
| 02 | The item header and its actions | sticky header, Approve / Request changes / Send to developers, the ⋯ menu | 01 | [[x] |
| 03 | The calmer page and comments | lead, designs or changes, What Design Desk found, folds, threads; version and changelog | 02 | [[x] |

## Conventions & glossary

- **Simple mode** — `simple()` in `desk/page.html`; everything here is behind it, and full mode is
  checked unchanged by the existing tests.
- **Side** — For Designers or For Developers (`forOf(c)`, `docs/desk.md` → For Developers or For
  Designers).
- Apply `/frontend-design` to the UI: the Desk's scale and inks only (`docs/desk-page.md` → The
  look; the page test "the page's styles keep to the Desk's scale" enforces it), light and dark.
- Every change ships with its docs and tests (`docs/self-modification.md` §9): each slice rewrites
  its part of `docs/desk-page.md` and extends `desk/tests/page.test.mjs`.
- Words people read follow `docs/desk.md` → Writing on the Desk (and the `copy` skill).
- The version and changelog are slice 03's alone (`docs/self-modification.md` §12).

## Verification

- `bash scripts/tests/run.sh` (runs `desk/tests/*.test.mjs` with node 20+; prints `PASS  node
  --test`). Scoped: `node --test --test-name-pattern "simple" desk/tests/page.test.mjs`.
- `bash scripts/validate-definition.sh .`
- The made-up Desk: `node desk/dev/mock.mjs 5610`, then
  `http://localhost:5610/?role=guest` (a viewer starts in simple mode) or
  `?role=designer` and the Simple mode switch in the menu under the name; `&theme=dark` for dark.
  `desk/dev/mock-data.mjs` may gain cards so every state shows (a built request, a declined one, a
  handled unmerged change).

## Whole-feature smoke test

On the made-up Desk as a viewer and as a designer, light and dark: the menu shows Requests & PRs;
the list holds both kinds on the viewer's side, newest change first, filtered Open by default; the
filter menu narrows by state and kind with right counts and chips; each state shows on some row
with its pill and words; a busy request shows the spinner; a request's and a change's page shows
the sticky header with its actions, the lead, the designs or changes, What Design Desk found, the
folds and the comment threads. Switching simple mode off shows full mode exactly as before.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
