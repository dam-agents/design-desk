# The spec flow: questions first, one at a time, then a spec to read and send

> Working plan — temporary, committed on the feature branch. Deleted once the feature ships.

**Issue:** https://github.com/dam-agents/design-desk/issues/206

## Goal

After a person approves a request, Design Desk writes the developer spec. Today it can ask
questions on the way. The person barely notices those questions, and in simple mode the request
already reads **In dev** while they wait:

- In simple mode, Approve always sets `approved.auto_send`. `specInReview()` (`desk/page.html`)
  keeps a spec in its review only without `auto_send`, so `simpleState()` reads **In dev** from
  Approve on: while the spec is written, while questions wait, and after.
- The handoff pass writes spec v1 **and then** asks (`docs/handoff.md` step 4). The questions
  show all at once in a beige block (`asksBox`) above a blue spec banner that says "Version 1".
  The answers lead to a rewrite that, with `auto_send`, goes to developers unread.

What will be different:

1. **Questions first.** The first handoff pass only asks what the Desk did not settle, and
   writes no spec. The answers start the one and only spec write. With no questions it writes
   the spec in the same pass, as today.
2. **One question at a time, in the spec banner.** The banner carries the whole flow from
   Approve to Send. While questions wait, the banner is a stepper: one question, its options,
   **Back** / **Next**, progress, then a summary with **Send answers**. Nothing pops up.
3. **No auto-send in simple mode.** Every spec ends as *Spec ready* in the banner, for a person
   to read and **Send to developers**. Full mode's opt-in checkbox stays as it is.
4. **The request says where it stands.** In simple mode it stays in its review (Design review or
   Dev review) until the spec is sent. Its pill names the phase: **Writing spec**,
   **Answers needed**, **Spec ready**. **In dev** means only "developers have it".
5. **The store guards it.** Nothing is marked sent or handed off while a question is open,
   whoever writes it.

## Approach

The Desk is three pieces this feature touches: the store (`desk/store.mjs`, the cards and the
rules on writing them), the page (`desk/page.html`, one file, no build) and the agent's
procedure (`docs/handoff.md`, followed by the handoff pass). See `ARCHITECTURE.md` and
`docs/desk-page.md` → The page, The spec banner, A request's state in the list.

**The phases of the spec flow.** One page function, `specPhase(c)` (sub-issue 02), says where an
approved request stands, and the state pill, the strip, **Next:**, the banner and the list all
read it:

| Phase | When (card fields) | Banner | Pill (simple mode) |
| --- | --- | --- | --- |
| `writing` | approved (`c.approved`), not sent, no open `asks` thread, no `spec.asset` or a handoff item queued or claimed for it; covers both the first pass ("may have questions") and the pass after the answers | blue, spinner. Before any answers: *Design Desk is reading the design and may have a few questions before it writes the spec.* After answers: *Design Desk is writing the spec with your answers.* Plus the ETA line the status already computes (`started 2 min ago, usually about 6 min`) | **Writing spec** |
| `asks` | `status: spec` (or shown so by `asShown`) with an open `asks` thread that has `questions` | magenta (a person's move): the stepper, headed *Before Design Desk writes the spec · Question 1 of N* | **Answers needed** |
| `ready` | `status: spec`, `spec.review: "draft"`, a `spec.asset`, no open `asks` | green, as designed in #213 (unchanged) | **Spec ready** |
| `rewriting` | `spec.review: "changes"` | blue, as designed in #213 (unchanged) | **Writing spec** |
| `sent` | `status: handed-off`, or `spec.review: "sent"` | none: the closed fold further down, as today | **In dev** (unchanged) |

The state behind the pill stays the review (`proposal` For Developers, `open` For Designers).
The filter and the counts don't change: the pill only names the phase, as Dev review already
shows a **Proposal** pill.

**Answers.** The stepper posts the same `POST /api/threads/<id>/answers` with the same `answers`
array (`store.answerForm`) as the form does today. No server change. While a person steps through,
their picks and notes live in the browser (`store.set` → local storage, key
`desk-asks-<thread id>`) until they press **Send answers**. The first person to send wins.
Everyone else's draft is dropped and their banner reads *Answered by <name> · <when>* until
the next phase arrives. Answers can't be edited once sent: a later change goes through
**Ask for changes…** on the spec, or a comment.

**Scope.** Handoff questions (`--step handoff`) only, in both modes. Question forms of other
steps (after checking, `build`, revise) keep the beige `asksBox` for now. The stepper is one
function, so they can move to it later. No Slack DM when questions arrive (a later issue). The
pre-design grill ("Ask me questions first", `renderGrill`) is a different mechanism (the agent
asks one ask at a time) and doesn't change.

## Sub-issues

| #  | Title | Scope | Depends on |
|----|-------|-------|------------|
| 01 | Questions before the spec, never sent unread | Store guard; simple-mode Approve stops asking for `auto_send`; `docs/handoff.md` asks before it writes; the mock gets a request with questions open | — |
| 02 | Where the spec flow stands, everywhere it is shown | `specPhase(c)`; simple-mode state and pills; full mode's strip and Next; the bell row; docs on the state | 01 |
| 03 | The banner carries the whole flow, with the question stepper | The banner from Approve to Send; the stepper; draft in the browser; answered-by; toast on arrival; the Approve dialog's line; docs on the banner and the questions form | 02 |

## Conventions & glossary

- **Handoff pass**: the agent's run of a `handoff` item (`docs/handoff.md`). **Question form**:
  an `asks` thread with `questions` (`design desk ask … --form`), answered by `store.answerForm`.
- Words on the page follow `docs/desk.md` → Writing on the Desk and the `copy` skill: plain words,
  never a status key (`spec`, `asks`) shown to a person.
- The page is plain JS in one HTML file: follow the patterns already there (`esc`, `txt`, `md`,
  `store.get/set`, `toast`, the `data-*` click dispatch near `desk/page.html:9283`), the
  guidelines in `desk/guidelines.html` (the toast, buttons, the banner's tones), and the
  repository's `CLAUDE.md`.
- Each sub-issue follows the repository's release habit: bump `VERSION`, add the version's
  **Upgrade** steps to `CHANGELOG.md` (republish the page, restart the Desk server where the store
  changed), and update the docs it changes, as recent PRs (#214, #219) do. Since the feature
  lands as one PR, the last sub-issue may fold the earlier bumps into one version.
- Tests: this repository's PRs ship page and store tests with each change
  (`desk/tests/*.test.mjs`); each sub-issue names the ones to add or update.

## Whole-feature smoke test

1. `node desk/dev/mock.mjs 5610`, open `http://localhost:5610/?role=designer#R-<new mock request>`
   (simple mode, the default).
2. In the list, the request shows **Design review** with the pill **Answers needed**, not In dev.
3. The page shows the spec banner, magenta, *Question 1 of N*. Pick an option, **Next**, reload:
   the pick is still there. Go to the last question, see the summary, **Back** to change one,
   **Send answers**.
4. The banner turns blue: *Design Desk is writing the spec with your answers*. The pill reads
   **Writing spec**. After the mock's delay, the banner is green *Spec ready*, with
   **Send to developers**. Nothing was sent on its own.
5. **Send to developers** → the request is **In dev**, the spec a closed fold.
6. Approve another request in simple mode: the dialog says Design Desk may ask a few questions,
   and the banner shows *reading the design and may have a few questions* at once.
7. `&simple=0`: the same banner and stepper. The strip reads *Questions for you*, and **Next:**
   reads *Answer N questions*.
8. Run `verify` from `work/CONFIG.md`. Every suite passes.

## Delivery

Each sub-issue is one atomic commit. The whole feature lands as a single PR for
https://github.com/dam-agents/design-desk/issues/206 (`Fixes #206`).
