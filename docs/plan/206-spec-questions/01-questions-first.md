# 01 — Questions before the spec, never sent unread

**Part of:** The spec flow — see [README](./README.md)

## Context

This slice changes the rules the rest of the feature stands on, with nothing new on the page
yet:

- The store refuses to mark a spec sent, or a request handed off, while Design Desk's question
  is open, whoever writes it.
- Simple mode's Approve no longer asks for `auto_send`, so every spec waits for a person's
  **Send to developers**.
- The handoff procedure asks its questions **before** it writes the spec.
- The mock Desk gets a request in that new shape, so slices 02 and 03 have something to show.

## Implementation plan

1. **The store guard** (`desk/store.mjs`, `upsertCard`, beside the Slack / open-PR guard at
   about line 2834):
   - Work out whether the card has an open question:
     `(c?.threads || []).some((t) => this.db.threads[t]?.kind === "asks" && this.db.threads[t]?.state === "open")`.
     This is the same test `specAction` uses at about line 2319; lift it into one small method,
     e.g. `openAsks(c)`, and use it in both places.
   - With an open question, refuse:
     - a write that makes `next.spec` sent (`review === "sent"` or `sent`) when `c.spec` was not;
     - `next.status === "handed-off"` when `c.status` was not.
   - Message: `Design Desk's questions on this request are still open: wait for the answers, then write the spec (docs/handoff.md step 2).`
   - It holds whatever `spec_review` says, and for the agent as for anyone.
2. **No auto-send from simple mode** (`desk/page.html`, the Approve dialog near line 8735):
   - Drop `auto = simple() && unread` and its `auto_send: true`: simple mode now behaves like
     full mode without the box ticked.
   - Full mode's `check2` (*Send it to … as soon as the spec is written…*) stays, so its
     `auto_send` path stays.
   - Keep the store's `autoSend` handling (`store.mjs` about line 2274) as it is.
   - Fix the dialog text that branches on `auto` (`waits` and the body) so simple mode reads as
     a spec that waits: *…It waits here for you to read and edit; nothing goes to … until you
     press **Send to developers**.*
   - The ETA text at `page.html` about line 6161 (`k === "handoff" && c.approved?.auto_send`)
     keeps working for full mode's opt-in.
3. **The procedure** (`docs/handoff.md`):
   - Move step 4 (*Questions on the Desk, never in the spec*) before step 2. The pass works out
     what the card, its threads and earlier answers do not settle **before writing anything**.
     - Some questions → one form (`--step handoff --form`), `status: spec`,
       `done --outcome asked`, **no spec written or uploaded**.
     - None → write the spec in the same pass.
     - The pass after the answers reads them and writes the spec once, with
       **Settled at handoff**.
   - Renumber the steps and fix every cross-reference: `docs/handoff.md` itself, `docs/desk.md`,
     `docs/desk-page.md`, `docs/prototype.md` (it points at step 4), and anything
     `rg -n "handoff.md.*step" docs .agents toolkit scripts` finds.
   - **Review before it goes**: remove *Simple mode's Approve asks for the send as soon as the
     spec is written* and say simple mode's Approve always waits for Send.
   - Say in one sentence that the store refuses a sent spec or `handed-off` while a question is
     open.
4. **The toolkit**, if it prints guidance: check `toolkit/` and `scripts/` for text that
   describes the old order or simple-mode auto-send
   (`rg -n "auto_send|as soon as the spec" toolkit scripts .agents`) and update it.
5. **The mock** (`desk/dev/mock-data.mjs`, next to R-10 at about line 266):
   - Add a request approved a few minutes ago, `status: spec`, **no `spec`**, with an open
     `asks` thread from Design Desk on step `handoff`: a short `text` and 3–4 questions of 2–3
     options each, one `suggested` per question, in plain words.
   - In `desk/dev/mock.mjs`, answering it (`POST /api/threads/<id>/answers`) closes the thread,
     then after the mock's usual delay (as R-10's Ask for changes, 25 s) writes
     `spec: {asset, review: "draft"}` with a short spec asset.
6. **Version**: bump `VERSION` (minor), add the version to `CHANGELOG.md` with its **Upgrade**:
   restart the Desk server (the store guard) and republish the page. Follow
   `docs/self-modification.md` §12.

## Acceptance criteria

- [ ] `upsertCard` refuses `spec.review: "sent"`, `spec.sent` and `status: "handed-off"` on a card
      with an open `asks` thread, with the message above, and accepts them once the thread is
      answered.
- [ ] `specAction` and the guard share one check for an open question.
- [ ] In simple mode, Approve posts no `auto_send`. In full mode, ticking the box still does.
- [ ] `docs/handoff.md` reads: ask first, write once. A pass that asks writes no spec. Every
      step number pointing into it is right.
- [ ] The mock lists the new request, and answering it brings a spec draft back after the delay.
- [ ] Store tests (`desk/tests/store.test.mjs`, next to *a spec for a request from Slack is sent
      only by a person*): the three refused writes while a question is open, and the same writes
      accepted after `answerForm`.
- [ ] Page test (`desk/tests/page.test.mjs`): simple-mode Approve posts no `auto_send`.
- [ ] `verify` from `work/CONFIG.md` passes.

## Smoke test

- `node --test desk/tests/store.test.mjs desk/tests/page.test.mjs` passes.
- Run `node desk/dev/mock.mjs 5610` and open the new request as `?role=designer`. Answer its
  form (the beige block still, until 03), wait 25 s: a spec draft appears in the green banner,
  and nothing was sent.
- Approve another request in simple mode: the dialog says the spec waits for **Send to
  developers**.
