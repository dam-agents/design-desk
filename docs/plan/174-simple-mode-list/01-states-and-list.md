# 01 — States and the merged list

**Part of:** Simple mode list and detail page — see [README](./README.md)

## Context

The frame of the new simple mode: every request and change on the viewer's side gets one of three
states, and they show in one list with a filter that names only what narrows it. Nothing in the
detail page changes yet.

## Implementation plan

Apply `/frontend-design` (the Desk's scale and inks, light and dark) and `/copy` to the words.

1. **`simpleState(c)`** in `desk/page.html`, beside `closed`, `atWork` and `autoHandled`: returns
   `{ state: "open" | "dev" | "closed", pill: null | "shipped" | "none" | "closed" }` exactly as the
   README's table; `null` for anything not listed (another kind, an archived change, the other
   side). `S_WORD` and the pill inks live next to it.
2. **The viewer's side**: `mySide()` = `DEVELOPERS.includes(S.me?.role) ? "developers" : "designers"`;
   only cards with `forOf(c) === mySide()` are listed.
3. **The list**: `simpleList()` (simple mode, tab `requests` or `new`, not presenting) makes
   `visibleCards()` return `simpleCards()`: requests and changes with a state, filtered by
   `S.simFilter = { states: Set, kinds: Set }`, sorted by last change (`c.updated`, else
   `dateOf(c)`) newest first. Add the filter to the `view` key in `renderListRows` so a change of
   filter starts the list again at `LIST_PAGE` rows.
4. **The filter menu** (replaces `head` and `filter` in `renderListRows` while `simpleList()`):
   a button with a filter icon (`aria-haspopup`, `aria-expanded`) opening a popover with two groups
   of checkboxes, State (Open, In dev, Closed) and Kind (Requests, PR changes), each with its
   count from `simpleCards` with that one option toggled, and **Reset to default**. Beside the
   button, a chip per active state (and per kind when only one kind is on), each with × to drop it.
   At least one option stays on in each group (the last one cannot be unticked). Escape and a click
   outside close it; arrow keys move through the options. Kept as `desk-simFilter` in local
   storage (JSON of both sets), read like `FILTERS`; default `{ states: [open], kinds: [request,
   change] }`. Write it so #180 can name it a component: one function `filterMenu(key, groups)`.
5. **The row** (`renderListRows`' row for a request and a change, under `simple()`): the kind's
   icon (request / pull request), the title, the date with the time (`sWhen`: "Today, 14:32",
   "Mon 16, 11:05", the year only when it is not this year), and the pill — hidden when exactly one
   state is selected. An item at work shows `.dd-spin` with its hint. No dot, no source line, no
   red **!** in simple mode (the page says it, slice 03).
6. **The menu**: under `simple()`, one entry **Requests & PRs** (`data-tab="requests"`, current on
   `requests` and `new`) instead of Requests and PR Changes; **+ New request** stays. A link to
   `#new` or a change still opens it, in the merged list.
7. **Mock data**: `desk/dev/mock-data.mjs` gains what it lacks so each state and pill shows (a built
   request, a declined one, one closed with a decision, a handled unmerged change, a merged
   auto-handled one).
8. **Docs**: `docs/desk-page.md` → The page → Simple mode: replace "only hides" for the menu and the
   lists with the merged list, its filter and the side; drop "A list's filters stay as they are
   drawn … Needs a designer among them" for simple mode. → A request's state in the list: a
   paragraph "In simple mode" with the README's table in words.

## Docs and tests

- `docs/desk-page.md` as step 8.
- `desk/tests/page.test.mjs`, with the existing `DESK(...)` bridge and `simple: true`:
  - every row of the README's table gets its state and pill (one card per row);
  - the list merges both kinds on the viewer's side only, newest first; the other side's items are
    absent; a developer sees the developers' side;
  - default Open; ticking In dev and Closed shows their rows and chips; × on a chip drops it; the
    last state cannot be unticked; the choice survives a reload (`desk-simFilter`);
  - a row's pill hides with one state selected and shows with two;
  - the menu shows Requests & PRs and no PR Changes in simple mode; full mode's menu and filters are
    unchanged (existing tests stay green).

## Acceptance criteria

- [ ] In simple mode the menu shows **Requests & PRs** and **+ New request**, and the list holds
      requests and changes of the viewer's side only, newest change first.
- [ ] Each item listed has exactly one state, as the README's table says, and its pill.
- [ ] The filter menu filters by state and kind with right counts; only active choices show as
      chips; the choice is kept per browser.
- [ ] An item Design Desk works on shows the spinner and stays Open.
- [ ] Full mode is unchanged; `bash scripts/tests/run.sh` passes.

## Smoke test

`node --test --test-name-pattern "simple" desk/tests/page.test.mjs`, then
`node desk/dev/mock.mjs 5610` and open `http://localhost:5610/?role=guest`: the list shows Open
items of both kinds; open the filter, tick In dev and Closed — the counts match the rows, chips
appear, pills show; untick Requests — a Kind chip appears; reload — the filter is kept. Then
`?role=designer`, Simple mode off: full mode's Requests and PR Changes with their old filters.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
