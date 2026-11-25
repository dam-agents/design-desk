# 03 — The banner carries the whole flow, with the question stepper

**Depends on:** 02-where-it-stands
**Part of:** The spec flow — see [README](./README.md)

## Context

The spec banner (#213) becomes the one place the spec flow happens, from Approve to **Send to
developers**, in both modes:

- It shows from the moment a request is approved, also before any spec exists.
- While questions wait, it is a stepper that asks them one at a time.
- Its green *Spec ready* state stays exactly as designed.

The beige `asksBox` no longer shows handoff forms.

## Implementation plan

1. **When the banner shows** (`specBanners` / `specBanner`, `desk/page.html` about line 6236):
   - Show it for every `specPhase(c)` but `sent`, not only with a `spec.asset`.
   - Keep `ready` and `rewriting` as they are; only the `asks` state changes.
   - The banner's `data-s` takes the phase. Add `writing` (blue, the spinner, as `rewriting`)
     and `asks` (magenta, the person's move) to its CSS, from the tones the banner and the list
     dot already use.
   - In full mode, check that the banner and `specPanel` (the fold, about line 6226) don't both
     show the spec: `specPanel` opens on `asks` today; it shouldn't any more.
2. **`writing`**:
   - Title: before answers, *Design Desk is reading the design and may have a few questions
     before it writes the spec.* After answers (02's `answered`), *Design Desk is writing the
     spec with your answers.*
   - Sub: the ETA the status line computes (`renderStatus`'s `eta`: *started 2 min ago, usually
     about 6 min*, or *in the queue, starts within 10 minutes*). Move it into a small shared
     function rather than computing it twice.
   - No buttons. With an earlier version (a `rewriting` after a send-back), keep today's
     **Read the last version**.
3. **`asks`: the stepper**, a new `askStepper(th)` beside `askForm` (about line 5101), used by
   the banner for the open handoff form:
   - **Head:** *Before Design Desk writes the spec · Question k of N*, a thin progress bar. The
     form's `text` (`th.messages[0].text`) under it on question 1 only.
   - **Body, one question at a time:** its text; its options as full-width clickable rows
     (radio inputs, the whole row the label); **recommended** on the `suggested` one, as
     `askForm` marks it; the optional note *Anything to add? (optional)*.
   - **Moves:**
     - **Back** (not on 1) and **Next**; Next is enabled without a pick, since a question left
       open goes to Design Desk.
     - **Leave the rest to Design Desk**, always there, as a ghost button: it sends what is
       picked so far, the rest `null`. Today's **Leave it to Design Desk** sends all `null`; the
       button's name says it now keeps the picks made.
     - The keyboard: arrow keys move between options (native radios), Enter is Next.
   - **The summary, after the last question:** each question with its pick, or *Left to Design
     Desk (recommended: …)*, and its note, each a link back to that step. Then one line, *Design
     Desk writes the spec from these; you read it before it goes.*, and **Send answers**
     (primary). Send posts `POST /api/threads/<id>/answers` with `{answers}` in the order of
     `th.questions`, as the `data-send-form` handler does (about line 9283). Reuse that handler
     with the answers read from the draft rather than from the fieldsets.
   - **The draft:** `S.askDraft[threadId] = {step, answers: [{choice, note}]}`, written through
     `store.set("desk-asks-<thread id>", JSON)` on every pick, note (debounced, as `specTimer`)
     and step. Read it back on render, so a reload lands on the same step with the same picks.
     Delete it on send, and when the thread is no longer open.
   - **Not yours** (`!mayIn(th, "reply")`): the stepper shows the questions read-only with
     `notYours`, no moves.
   - **Re-renders:** the page redraws on every poll. Keep the step and the focus across a
     redraw: the draft holds the step, and the focused option or note is restored after
     drawing, as the spec editor keeps its text (`S.specDraft`).
4. **Answered by someone else:**
   - A thread this browser holds a draft for that is no longer open, and wasn't sent from here:
     the banner shows *Answered by <name> · <when>* for that thread. The name and time are its
     answering message's author and time (`th.messages` after the first, as the thread view
     reads them).
   - The phase is `writing` with `answered`, so the line sits under the `writing` title.
   - Drop the draft.
5. **`asksBox`** (about line 6346): leave out an open `asks` thread on step `handoff` while the
   banner shows it. Every other step's form stays in `asksBox` as today. Check the thread's step
   field as the store writes it on `design desk ask --step` (`toolkit/`, `desk/store.mjs`
   `ask`); if the page has no step on the thread, add it to what the server sends with the
   thread.
6. **The toast on arrival:**
   - When a poll brings a newly opened handoff form on the request the person has open, one
     toast: *Design Desk has N questions before the spec.* Its **Answer** scrolls to the banner
     and focuses the first option.
   - Once per thread per browser: `store` key `desk-asks-seen-<thread id>`.
   - Never opens anything by itself. Use `toast` per `desk/guidelines.html` → The toast.
7. **The Approve dialog** (about line 8749): one line, *Design Desk may ask a few questions,
   then writes the spec for you to read and send.*, in place of the sentence 01 left there for
   the spec that waits. A full-mode approval with *Send it as soon as the spec is written* ticked
   keeps its own words.
8. **Docs**:
   - `docs/desk-page.md` → The spec banner: the five phases, the stepper, the draft, answered by
     someone else, the toast.
   - `docs/desk.md` → The questions form: a handoff form shows as the stepper in the banner, one
     question at a time; other steps' forms show as today.
   - Keep the four parts and the `text` rules as they are.
9. **Version**: as 01 (republish the page). Since the feature lands as one PR, fold 01–03 into
   one version entry if they haven't shipped apart.

## Acceptance criteria

- [ ] From Approve to Send the banner is there in both modes, with the phase's words: writing
      (before and after answers), asks, ready, rewriting. Sent → the closed fold, as today.
- [ ] The stepper shows one question at a time, with progress, **Back** / **Next**, the
      recommended mark, the note, and a summary with links back and **Send answers**.
      **Leave the rest to Design Desk** sends picks so far and the rest `null`.
- [ ] A reload keeps the step, the picks and the notes. A redraw from a poll keeps the focus.
- [ ] Another person's answer turns this browser's banner into *Answered by … · when* and drops
      its draft.
- [ ] `asksBox` shows no handoff form; other steps' forms are unchanged.
- [ ] The toast comes once per thread, only on the request that's open, and opens nothing.
- [ ] Page tests (`desk/tests/page.test.mjs`): the banner per phase; the stepper's steps, Back
      and Next, the summary, the posted `answers` (picks, `null`s, notes, in order); Leave the
      rest; the draft surviving a re-render; answered by someone else; `asksBox` without the
      handoff form; the toast once. Update the #213 banner test for the `asks` state.
- [ ] `verify` passes.

## Smoke test

- `node --test desk/tests/page.test.mjs` passes.
- Run the README's whole-feature smoke test on the mock.
