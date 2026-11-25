# 02 — Where the spec flow stands, everywhere it is shown

**Depends on:** 01-questions-first
**Part of:** The spec flow — see [README](./README.md)

## Context

One function says which phase of the spec flow an approved request is in (README →
*The phases of the spec flow*). The simple-mode state, its pill, full mode's step strip and
**Next:** line, and the bell all read that function. A request no longer shows **In dev**
before its spec is sent, and someone who left the page sees that questions wait for them. The
banner itself is 03.

## Implementation plan

1. **`specPhase(c)`** (`desk/page.html`, next to `specWaits` / `specInReview` at about line 3616):
   - Returns `null` before approval and for a closed request. Otherwise one of `writing`,
     `asks`, `ready`, `rewriting`, `sent`, by the README's table.
   - Read the card through `asShown(c)` (about line 2182), so an approved request whose handoff
     pass has not set `status: spec` yet is `writing`.
   - Return `answered` (writing, after answers) as a flag next to the phase, e.g.
     `{ phase, answered }`. 03's banner needs it to pick its words: the card has an `asks`
     thread on step `handoff` that is no longer open.
   - Replace `specWaits` / `specInReview` with it where they decide state, and keep their
     callers' meaning for full mode's `spec_review`.
2. **Simple-mode state** (`simpleState`, about line 3625):
   - A request with `specPhase` other than `sent` returns `reviewOf(c)`, its review by side,
     with the pill by phase: `writing` → **Writing spec**, `asks` → **Answers needed**,
     `ready` → **Spec ready**, `rewriting` → **Writing spec**.
   - Add those pill keys to `SIM_PILL` and their tips to `SIM_TIP`:
     - Writing spec: *Design Desk is writing the developer spec; nothing has gone to developers yet*
     - Answers needed: *Design Desk has questions before it writes the spec*
     - Spec ready: *The spec is written; someone who may approve it reads it and sends it*
   - `reviewOf`'s `proposed` pill for a request not yet approved stays.
   - Only `handed-off` reads **In dev**, so the `c.status === "spec" && !specInReview(c)` branch
     goes.
   - Pill colours: Answers needed in the person's-move colour (magenta, as the list dot),
     Writing spec in Design Desk's (blue), Spec ready in the review's own. Use the existing
     tones in the page's CSS and `desk/guidelines.css`; add none unless no tone fits.
3. **Full mode's strip and Next** (`stageSub` about line 2184, `nextFor` about line 6086,
   `renderStatus` about line 6300):
   - While `asks`, the Approved step's sub reads **Questions for you** (it reads *Design Desk
     asks you* today).
   - **Next:** reads *Answer N questions* (*Answer the question* for one), from the form's
     `questions.length`, in place of *Answer the questions below*.
   - `nextFor`'s text for the open-question case: *Before Design Desk writes the spec, it needs
     your answers.* (It says *before it goes to developers* today.)
   - The other `asks` steps keep today's words.
4. **The bell** (`desk/store.mjs` `notifications`, about line 1405, and the page's labels at
   about line 10162):
   - An `agent-asks` event on a request's handoff form carries its count.
   - The row reads *Design Desk has N questions before the spec*.
   - It is **For you** for the approver (`c.approved.by`), as well as whoever is For you today.
   - Check what "For you" means in `notifications` and add the approver the way the others are
     added.
5. **Your turn** (`myTurn`): check that a request whose phase is `asks` is the viewer's turn for
   anyone who may answer (`mayIn(th, "reply")`'s rule, the server's `may`), in both modes, and
   that `ready` is the turn of whoever may send. Fix it only if it isn't.
6. **Docs**:
   - `docs/desk-page.md` → *A request's state in the list*: in simple mode an approved request
     stays in its review until the spec is sent, with the three pills. **In dev** is a request
     sent to developers and not yet built. The *writing its first spec* wording goes.
   - → Notifications: the bell row.
   - `docs/desk.md` where it names the simple states.
7. **Version**: as 01 (republish the page; the store's bell change needs a server restart).

## Acceptance criteria

- [ ] In simple mode, an approved request reads Design review or Dev review, by side, with
      **Writing spec**, **Answers needed** or **Spec ready** as its pill, until the spec is sent.
      Only a sent one is In dev.
- [ ] A request at any of those phases is counted and filtered with its review, not with In dev.
- [ ] Full mode: the Approved step reads *Questions for you*, and **Next:** reads *Answer N questions*.
- [ ] The bell row for a handoff form says how many questions, and is For you for the approver.
- [ ] Page tests (`desk/tests/page.test.mjs`): `simpleState` for each phase (writing before
      `status: spec`, writing with `status: spec`, asks, ready, rewriting, sent), and the
      updated #213 test (*only a sent one is In dev*).
- [ ] Store test: the approver gets the bell row For you.
- [ ] `verify` passes.

## Smoke test

- `node --test desk/tests/page.test.mjs desk/tests/store.test.mjs` passes.
- `node desk/dev/mock.mjs 5610`, `?role=designer`:
  - the 01 request shows **Answers needed** in Design review;
  - R-10 shows **Spec ready**;
  - answering the 01 request shows **Writing spec**, then **Spec ready**.
- `&simple=0`: the strip and **Next:** say *Questions for you* / *Answer N questions*.
- The bell, as the approver, has the row For you.
