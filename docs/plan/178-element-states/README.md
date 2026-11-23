# An element's states in its dialog

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #178 (part of #173)

## Goal

An element's states (hovered, disabled, loading, empty, an error, a long text…) can be seen
without leaving the element dialog's before / after view, in both modes:

- A **switcher** over the After picture steps through them: "As designed" first, then each
  state. Only After changes; the state's one-line note shows under it.
- **All states**, a fold under the pictures, shows every state at once; a click on one shows it
  in After, so the fold and the switcher always agree.
- **Draw all states** where none is drawn, **Redraw states** where the drawn ones are of an
  earlier version, nothing once all are current — beside the switcher, for those who may.
- A comment written while a state is shown is about that state, and says so.
- The dialog's **header stays** while it scrolls, with Close, and **steps between the option's
  elements** (‹ 2 of 4 ›), so another element opens without closing the dialog.
- **Every dialog** on the Desk closes with a lone **✕** in its top-right corner, and with Esc.

## Approach

All of it is `desk/page.html`; the store and server already carry what it needs.

- **The dialog**: `renderElementDialog()` draws it, `elementPair()` the Before / After pair (#177),
  `catalogItem()` a state's card (number, picture, note, the use case it covers), `elementTalk()`
  the comments and the box. Today the states follow as a `.catalog` list, closed by an
  `li.addstate` card that holds the draw button, the busy line or "✓ Every state is drawn".
- **States of a part**: `elementsOf(v)` gives each element its `states` (the option's `states`
  in their order); `statesComplete(v, e)` and `drawingStates(c, v, e)` say whether all are
  current and whether Design Desk is drawing them. A state has `id`, `name`, `how`, `shot` or
  `asset` + `selector`, `of` (the option version it was drawn for).
- **Drawing them**: `data-el-states` → `act("states")`, which asks with a confirm dialog and posts
  `{action: "states", variant, element, part}` — unchanged here but for its words.
- **The design workspace's switcher**: `wsStates()` (State menu, grouped by part, "As drawn"
  for none), `renderWsNotes()` (`nameOf`), `TIP.wsState`. Its order is the option's `states`
  order, the same as `elementsOf`.
- **A note about a state**: an anchor's `state` is already kept by the store (`cleanAnchor`) and
  checked against the option's states, for a thread (`store.mjs`, adding a thread) and for a
  draft sent with feedback. The workspace already writes it (`S.ws.state`) and opens a note at
  its state (`data-goto`). So no store, server or data change.
- **Pictures**: `elPic()`, `partFrame()` (a part cut live, drawn wide), `zoomAttrs()`;
  `loadPictures(dlg)` fills them after each render.
- The prototype (`feat/simple-mode`, the `simple()` branch of `renderElementDialog`, `S.el.st`,
  `S.el.all`, `elStep`, `elPick`, the `el-sw`, `el-all`, `el-grid`, `el-tile` styles) is for
  behaviour and layout only; never copy its code.

## Decisions

Agreed with the operator before planning:

- **Both modes** have the switcher, the fold and the draw button.
- **All states is one fold in both modes, drawn per mode**: simple mode a small tile per state,
  full mode the catalogue cards as they are (number, note, the use case each covers). Folded to
  start with in both (the operator, while reviewing 01); open or folded, the choice lasts while
  the page is open. In
  the fold a card's or tile's picture shows its state in After; After's picture enlarges.
- **"Add to catalog"** stays as it is.
- **Both ways to see states stay** (the switcher and the fold), to try them in use.
- **The draw button moves beside the switcher**; the `addstate` card and "✓ Every state is
  drawn" go.
- **One name, "As designed"**, for the option in no particular state, in the dialog and in the
  design workspace (which says "As drawn" today). Order is the option's `states` order in both.
- **A comment written while a state is shown is about that state**: its anchor carries the
  state, the box says so, and the comment and the draft show the state's name. **Open in
  design workspace** opens at the state shown.

Decided by the operator while reviewing 01:

- **All states starts folded** in both modes.
- **Add to feedback is the dialog's one primary button**, as in the design workspace; Open in
  design workspace is a plain button.
- **A fixed header, and stepping between elements** (slice 02): the header (name, chips, Open in
  design workspace, the element stepper, Close) stays at the top while the dialog scrolls. The
  stepper goes through the option's elements in the order of its All elements tiles, gaps left
  out, round from the last to the first; each arrow says which element it opens. Another element
  opens as designed; a comment being written stays with its element while the dialog is open.
- **✕ and Esc close every dialog** (slice 03): every dialog, the enlarged picture and the private
  questions close with a lone ✕ in the top-right corner (named "Close", "Close (Esc)" on hover),
  never "✕ Close"; Esc closes each too. ✕ does what Esc does: a form with something typed or
  picked asks first. Cancel stays beside a form's main button. The guidelines say so.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | Switcher and All states | The switcher over After, the fold, the draw button beside the switcher, "As designed" in the workspace; docs; page tests | — | [x] |
| 02 | Fixed header, step between elements | The header stays while the dialog scrolls; ‹ n of m › through the option's elements | 01 | [x] |
| 03 | ✕ and Esc close every dialog | A lone ✕ top-right on every dialog, the enlarged picture and the private questions; Esc closes each; the guidelines' rule | 02 | [x] |
| 04 | Comments on a state; release | Comments and drafts carry the state shown and say so; the workspace opens at it, and the dialog at the workspace's; `VERSION`, `CHANGELOG.md` | 01–03 | [x] |

## Conventions & glossary

- **Part / element**: one entry of an option's `elements` (or one its states name), as
  `elementsOf` returns it. **State**: one of the option's `states` of that part.
  **As designed**: the part as the option draws it, in no particular state.
- **Stepper**: the guidelines' part for "variants of one thing in an order: an element's states"
  (`desk/guidelines.html` → Tabs and switchers → Stepper, `.pl-step`). The switcher is one, with
  a `<select>` in its middle naming where you are.
- Every change ships with its tests and its docs (`docs/self-modification.md` §9); docs say
  each thing once and link (§11). Plain words on the page (`docs/desk.md` → Writing on the Desk).
  Every new button and label says on hover what it does (`docs/desk-page.md` → Tooltips): a
  `title`, or its line in `TIP`.
- The page's styles keep to the Desk's scale (`desk/tests/page.test.mjs` → "the page's styles
  keep to the Desk's scale"): sizes from `--fs-*`, corners `--r-sm`/`--radius`, spaces in 4 px.
  A change to the page's `<style>` regenerates `desk/guidelines.css` (`node desk/dev/guidelines.mjs`).
- Skills: `/frontend-design` for the dialog; follow `docs/desk-page.md`, the guidelines page and
  the page's existing classes and tokens.
- Versioning (§12): one **minor** bump with its `CHANGELOG.md` **Upgrade** block, in slice 04
  only. Re-number at merge if another release lands first (#190 is open on the same files).

## Verification

- The repository's check (`verify` in `work/CONFIG.md`): `bash -n` on scripts, `npm ci` in
  `toolkit/`, `node --check` on every `.mjs`, `bash scripts/validate-definition.sh .`,
  `bash scripts/tests/run.sh` (Python `jsonschema` is needed by the manifest gate).
- Scoped: `node --test desk/tests/page.test.mjs desk/tests/guidelines.test.mjs`.
- The page by hand: `node desk/dev/mock.mjs 5610`, then
  `http://localhost:5610/?role=designer#R-1` (also `role=guest`, `theme=dark`, simple mode
  from the person menu), in `agent-browser`. The mock's request has an element with states.

## Whole-feature smoke test

On the mock Desk, the request whose option has an element with drawn states:

1. As a designer in full mode, open the option → All elements → the element with states. After
   has the switcher; step forward: After shows the first state, its note under it; step back
   past the first: "As designed". Pick a state from the list: the same.
2. **All states** is folded; open it: an "As designed" card then each state's card with its use case;
   the card shown is ringed. Click another card's picture: After shows it, the switcher agrees.
   Click After: it enlarges.
3. Fold All states again, close, reopen: still folded; open it, close, reopen: still open. Switch to simple mode: tiles.
4. An element with no states: no switcher, **Draw all states**; with states of an earlier
   version: **Redraw states**; all current: no button. A guest sees none.
5. Pick a state, write a comment: the box says it is about that state; **Comment** posts it with
   the state, and it is listed with the state's name. **Add to feedback** the same, as a draft.
6. **Open in design workspace** with a state shown: the workspace opens at that state; its State
   menu says "As designed" for none. From the workspace's **Every state (n)**, the dialog opens
   on the state the workspace shows.
7. Scroll the dialog: its header stays, Close in it. Step to the next element with › in the
   header: the dialog shows it, as designed; past the last, the first. Write a comment, step
   away and back: it is still there.
8. Every dialog (New request, Add to Product, a confirmation…), the enlarged picture and the
   private questions: a lone ✕ top-right closes it, and so does Esc; with something typed in a
   form, both ask first.
9. The same in dark.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
