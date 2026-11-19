# Feedback: one way to ask for a change, and a pull request reviewed change by change

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #176 (part of #173)

## Goal

Feedback becomes the one way to ask for a change on the Desk, in simple and in full mode. A
person collects notes — under an option, on a part in the element dialog, on a pin or a look
edit in the design workspace, under a pull request's change — and sends them together with a
verdict. Sent feedback goes where the item's next version is made: to Design Desk on a request,
to the developer (and, with `review_post`, the pull request on GitHub) on a change.

A pull request's UI changes are looked at one at a time: one tab per change, before beside after,
and under it **Add to feedback** and **Looks good**. The chips show how far the person got;
sending warns about the changes not looked at yet.

## Approach

Builds on #175's reviews (`docs/desk.md` → Reviews; `addDraft`, `sendReview`, `responsibleOf`
in `desk/store.mjs`; `reviewBox`, `yourReview`, `reviewDialog`, `reviewBlock` in
`desk/page.html`) and on #188's tabs (`desk/guidelines.html` → Tabs and switchers: underline
tabs with a number chip, `data-m="ok|changes"`).

- **Words, not data.** Everything a person reads says *feedback*; the API, the store and the
  numbers stay `reviews`, `drafts`, `U-<n>`. No migration.
- **A change** of a pull request is one entry of the card's `screens`: a `pair` (its pictures by
  `stage`: before, after, diff), or a screen with no `stage` alone. Its **key** is the `pair`, or
  for a lone screen its `asset`; its **name** is the `pair`, or the screen's caption. A draft
  about a change carries the key in `change` (the field exists, `addDraft`).
- **Looks good** is a draft with no text: `{ok: true, change}`. Sent, it becomes no
  conversation: the review keeps `looks_good: [<key>]`. A card read carries `looks_good` (the
  keys) from the reviews whose `sha` is the pull request's head as the Desk has it
  (`headOf(c)`): a new version empties it, as it ends `responsible`.
- **Two buttons at most in a box.** Under an option, a part, a workspace pin: **Add to
  feedback** (primary) and **Comment** (posted at once, for the team, nothing changes). Under a
  change: **Add to feedback** and **Looks good**. The box at the end of the page posts at once.
- **Nothing skips feedback** in the workspace: its **Send to Design Desk** buttons go; a look
  edit waits in the browser, as today, and **Send feedback** turns it into a draft at that moment.
  Untouched: **Ask Design Desk** (a private question), **Edit text → Save**, the Figma box's
  **Work into the design** (#193).

Docs it touches: [desk-page.md](../../desk-page.md) (Simple mode, The element dialog, the design
workspace, Notifications), [desk.md](../../desk.md) (Reviews), [watch.md](../../watch.md) (Reviews
on GitHub), [requests.md](../../requests.md) (revise: a look edit's note), `desk/guidelines.html`.

## Decisions

Taken with the operator before planning:

- **One PR** for all of it: the change view, the element dialog, the workspace, the words.
- **"Feedback"** everywhere a person reads it; it also covers a developer's notes on a request
  still in Draft or Proposal (#190, which takes the words when it rebases).
- **Send to Design Desk goes** from the workspace, in both modes; a change is asked through feedback.
- **Under a change**, no Desk-only comment: what is written there is for the developer.
- **Both modes** get the change view; the "What changed" diff picture goes, its outline stays.
- **A single picture** reads **After** under its caption. No screen data says a pull request
  added a screen, so there is no **New screen** label (the prototype's is not taken).
- **No screenshots yet**: the hint says what is true (`docs/screens.md`): Design Desk takes them
  on its copy of the product while one is free, else when the pull request merges.
- **Many changes**: tabs in one row that scroll sideways, as the option tabs.
- **A sent Looks good** keeps its change green until the next version (head commit), and goes in
  the feedback the developer sees, on the Desk and on GitHub.
- **Look edits** go through feedback, kept in the browser until sent (no server draft for them);
  a reload loses them, as today.
- **Figma** differences are out of scope: #193.
- **`review_post`** keeps its default (off).
- **Work it in** reads **Add to my feedback**: a draft that points at the comment, worked in
  when the feedback is sent with Request changes — one conversation, not a copy.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | Feedback words | Every word a person reads; Comment now → Comment; GitHub post's first line | — | [x] |
| 02 | Looks good on the server | `{ok, change}` drafts, `looks_good` on a review and on a card read, the GitHub post | 01 | [x] |
| 03 | The change view | Tabs per change, before / after, the box under a change, both modes | 02 | [x] |
| 04 | Marks and sending | Chips, Looks good moves on, "not looked at yet" warning, links from Comments | 03 | [ ] |
| 05 | Feedback in the element dialog | Add to feedback + Comment, your drafts on the part | 01 | [ ] |
| 06 | The workspace: notes and Your feedback | No Send to Design Desk on its boxes; a Your feedback tab in the side panel | 01, 05 | [ ] |
| 07 | Look edits and Add to my feedback | The look panel adds to feedback; Work it in becomes a draft | 06 | [ ] |
| 08 | Release | VERSION, CHANGELOG, doc read-through, whole-feature smoke | all | [ ] |

## Conventions & glossary

- **Feedback** (on screen) = a **review** (in code and data). **A draft**: a note not sent yet,
  its author's alone. **A change**: one screen pair or lone screen of a pull request's card.
  **A mark**: Looks good, or commented, on a change.
- Every slice ships its docs and tests (`docs/self-modification.md` §9, §11): one home per rule,
  links elsewhere. Tests: `desk/tests/store.test.mjs`, `server.test.mjs`, `page.test.mjs`,
  `guidelines.test.mjs`, as each slice names.
- `VERSION` (minor: 1.103.0 → 1.104.0, or one above main's at merge) and its `CHANGELOG.md`
  **Upgrade** entry belong to slice 08 alone.
- Writing for people: plain English, the Desk's words ([desk.md](../../desk.md) → Writing on the Desk).
- UI work: `/frontend-design`; the page's scale tests (`desk-page.md` → The look) and the
  guidelines (`desk/guidelines.html`); a new switcher is named there or `guidelines.test.mjs` fails.
- The Desk's request stage **Feedback** (full mode's flow: Checking, Options, Feedback, …)
  already exists and means the same moment; keep its word.

## Verification

- `verify` from `work/CONFIG.md`: shell syntax, toolkit `npm ci`, `node --check`, the
  definition validator and `bash scripts/tests/run.sh` (needs Python `jsonschema`).
- Scoped: `node --test desk/tests/store.test.mjs desk/tests/server.test.mjs`,
  `node --test desk/tests/page.test.mjs`, `node --test desk/tests/guidelines.test.mjs`.
- Manual: the mock Desk (`node desk/dev/mock.mjs`, data in `desk/dev/mock-data.mjs`), light and
  dark, simple and full mode; `desk/dev/guidelines.mjs` regenerates `desk/guidelines.css`.

## Whole-feature smoke test

On the mock Desk, simple mode, as a designer:

1. A pull request change with three changes (one pair, two lone screens): three tabs; the pair
   shows Before and After, a lone screen After. **Looks good** on the first → its chip green, the
   second shown. A note on the second with **Add to feedback** → chip amber, **Your feedback · 1**.
   **Send feedback…** → the dialog warns "1 change not looked at yet: <name>"; send with Request
   changes → In dev, the feedback block shows the note under its change and "✓ Looks good: <name>".
   A new head commit on the GitHub copy → the chips start empty.
2. A request: open an element, **Add to feedback** → it lists under the part and in Your feedback.
   In the design workspace, a pin's note with **Add to feedback**, and a look edit on a part: the
   **Your feedback** tab lists both and the element's note; no **Send to Design Desk** anywhere.
   **Send feedback** with Request changes → one revise with three change notes, the look edit's
   carrying `anchor.style`.
3. Repeat 1 in full mode.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
