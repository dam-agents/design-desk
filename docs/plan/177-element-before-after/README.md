# An element's before and after, with a way into the design workspace

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #177 (part of #173)

## Goal

When a design option changes a part of the product, the element dialog shows that part
**Before** (the product today) and **After** (the design), side by side, in both modes. A part
the option adds shows one picture, **New**. From the dialog a person opens the design workspace
at that part, and comments on the part right there.

"Before" is what confirms a design change, so where it comes from is always said:

- **By default** it is cut from the request's *How it looks today* drawing (`now`), which
  Design Desk already draws with a request's first options in the product's own styles and
  sample data — cheap, and drawn like the options, but it is a redrawing.
- **On demand**, any member presses a button and Design Desk takes the part from the real
  product: its screens instance `main` (docs/screens.md), cropped to the part. That picture
  wins over the redrawn one.
- Neither: the dialog says plainly that there is no picture from before.

## Approach

Three layers, one contract between them (below):

1. **Store and server** (`desk/store.mjs`, `desk/server.mjs`) keep where each shared part
   sits in the `now` drawing and the pictures taken from the product, and queue the button's
   work as an inbox item.
2. **The agent** (`toolkit/bin/capture.mjs`, `docs/requests.md`) records the parts' places
   when it draws `now`, and works the button's item: capture on `main`, crop, upload, upsert.
3. **The page** (`desk/page.html`) draws the dialog: Before / After, the button, Open in design
   workspace, the comments.

Seams that already exist and are reused, not rebuilt:

- **Cutting a part from a page**: an `<iframe data-snip-asset data-snip-sel>` filled by
  `loadPictures` (`snipDoc`, `SNIP_SCRIPT`) — the tiles and the dialog already cut the
  option's parts this way. "Before" is the same iframe on `c.now.asset` with the part's
  `now.elements` selector.
- **`now`**: `docs/requests.md` → How it looks today; stored by `upsert` (`store.mjs`, the
  `k === "now"` branch); queued by the `draw-now` action (`act()`, `kinds`, `item.scope = "now"`).
  The new `take-before` action copies that pattern.
- **The request's parts**: `shared_elements` (docs/requests.md → The same elements in every
  option, #179). Every option's element for a shared part has the shared `id`; "before" is the
  product's, so it is the same for every option and is keyed by that id.
- **Queued work on a card**: `waitingFor()` in the store, `c.waiting` on the page
  (`drawingStates` reads it).
- **The screens instance and capture**: docs/screens.md, `design capture` with a recipe, the
  `show-me` skill.
- **Notes on a part**: `POST /api/cards/<id>/threads` with `kind: "change"` and an `anchor`
  (the design workspace posts these).

### The contract

Request card fields (agent fields, set with `design desk upsert`):

```jsonc
"now": {
  "asset": "A-12", "name": "Agents list", "at": "…",          // as today
  "elements": [                                                 // new
    { "id": "card", "selector": "[data-view=\"1\"] .agent-card", "view": 1, "view_name": "Agents" }
  ]
},
"before_shots": [                                               // new
  { "id": "card", "asset": "A-40", "source": "instance",
    "ref": "main", "commit": "4286de5", "at": "…" }
]
```

- `now.elements[].id` and `before_shots[].id` are ids of the request's `shared_elements`; the
  store refuses (400) any other. A request without `shared_elements` has neither.
- `now.elements`: at most 24; `selector` required, at most 480 characters (the workspace's
  path limit); `view` a number or null, `view_name` at most 80. A `now` sent with a new asset
  and no `elements` clears them; with the same asset, keeps them. `now: null` clears them.
- `before_shots` merges by `id`: an entry replaces that part's; `{id, asset: null}` removes it.
  `asset` is the card's own `screen` asset; `source` is `"instance"`; `ref` at most 80;
  `commit` 7–40 hex; `at` is set by the store's clock. At most 24. `now` changing never
  touches `before_shots` (they come from the product, not the drawing).
- **Action `take-before`**: `POST /api/cards/<id>/actions` `{action: "take-before", element:
  "<shared id>"}` queues an `explore` item with `scope: "before"` and `element: "<id>"`.
  - Ability **`before`**: every member, not a guest (`can()`, `ACTIONS`, the server's ability
    words).
  - The server refuses (400) when `screens` is off: "Pictures from the product need Design
    Desk's own copy of it, which is not turned on yet. Ask <contact>."
  - The store refuses (400) an id not in `shared_elements`, and a closed request.
  - Busy: one open `take-before` per part (409 with `BUSY`); it neither blocks nor waits for
    the options' own work (as `draw-now`).
  - `waitingFor()` passes `element` on, so the page shows the part busy.

## Decisions

Taken with the operator before planning:

- **Both modes**: the dialog is the same in simple and full mode.
- **The default "before" is the redrawn `now`**, labelled as redrawn from the code; the
  **real product's picture is on demand**, by a button.
- **The button is for every member, not guests.** It shows only when the screens instance is
  on (`/api/me` → `screens`); it is off where the operator has not enabled it, the product's
  profile has no engine, or the platform has no Environments (docs/screens.md).
- **"Before" belongs to the request's shared parts** (`shared_elements`); a request drawn
  before that list exists shows "No picture from before".
- **Comments are posted at once**, as a note on the part (a `change` thread, as the design
  workspace makes). Draft comments sent as one review are #175's; when it lands it can turn
  these into drafts.
- **Not here**: the prototype's state switcher and "All states" grid are #178; the dialog
  keeps today's list of states under the pair.
- From the issue: take behaviour and layout from the prototype (`feat/simple-mode`, the
  `simple()` branch of `renderElementDialog`, `elWs`, `elDraft`, the `el-*` styles); never copy
  its code.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | Store and server | `now.elements`, `before_shots`, the `take-before` action and its ability | — | [x] |
| 02 | Capture and the agent's procedure | `design capture` crops a shot to an element; `requests.md` says how `now.elements` and `scope: "before"` are done | 01 | [x] |
| 03 | The dialog: before and after | Before / After or New, where each picture came from, the button, Open in design workspace, same-width drawing | 01 | [x] |
| 04 | The dialog: comments on the part; release | The part's notes, a box, Comment; `VERSION` and `CHANGELOG.md` | 03 | [x] |

02 and 03 both need only 01, in either order.

## Conventions & glossary

- **Part / element**: one entry of an option's `elements`; **shared part**: one of the
  request's `shared_elements`, which every option draws or leaves out.
- **Redrawn before**: the part cut from the `now` drawing. **Product before**: a
  `before_shots` picture from the screens instance.
- Every change ships with its tests and its docs (`docs/self-modification.md` §9); docs say
  each thing once and link (§11). Plain words for people on the page (`docs/desk.md` → Writing
  on the Desk).
- People's text never goes on a command line (CLAUDE.md → Hard invariants).
- Skills: `/frontend-design` for the dialog (the Desk has no house UI skill; follow
  `docs/desk-page.md` and the page's existing classes and tokens).
- Versioning (§12): one **minor** bump with its `CHANGELOG.md` **Upgrade** block, in slice 04
  only. Re-number at merge if another release lands first (#184 is open on the same files).

## Verification

- The repository's check (`verify` in `work/CONFIG.md`): `bash -n` on scripts, `npm ci` in
  `toolkit/`, `node --check` on every `.mjs`, `bash scripts/validate-definition.sh .`,
  `bash scripts/tests/run.sh` (runs `toolkit/tests` and `desk/tests` with node 20+; Python
  `jsonschema` is needed by the manifest gate).
- Scoped: `node --test desk/tests/store.test.mjs desk/tests/server.test.mjs
  desk/tests/page.test.mjs toolkit/tests/capture.test.mjs`.
- The page by hand: `node desk/dev/mock.mjs 5610`, then
  `http://localhost:5610/?role=designer#R-1` (also `role=guest`, `theme=dark`), in
  `agent-browser`.

## Whole-feature smoke test

On the mock Desk (`node desk/dev/mock.mjs 5610`), a request with `shared_elements`, `now` with
`elements`, one part with a `before_shots` picture and one part `new`:

1. As a designer, open an option → All elements → a changed part with a product picture: the
   dialog shows Before (the product's picture, "the product at main (<commit>), made-up data")
   beside After. Close; open a changed part with no product picture: Before is cut from the
   `now` drawing, "redrawn from the code".
2. Open the new part: one picture, **New**, no button.
3. Press **Take it from the product** on a changed part: the button turns busy (the item
   waits); a guest sees no button; with screens off (`&screens=0`) nobody does.
4. **Open in design workspace**: the dialog closes, the workspace opens on that option with
   the part selected.
5. Write a comment and press **Comment**: it shows under the pictures and, in the workspace, as
   a note on the part.
6. The same in simple mode, and dark.

Then once against a real Desk with the screens instance on: press the button, let an inbox run
work the item, and see the product's picture replace the redrawn one.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
