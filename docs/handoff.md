# Handoff — the developer spec

A `handoff` item comes from an **Approve** (with the option picked in its note): a designer's, a lead developer's, or a developer's on a small change ([desk.md](desk.md) → Small changes, Deciding straight away). Approved before any option, its note is what to build in the approver's words: write the spec from the request, the triage and that note, and leave out what has no design. The spec is what a
developer needs to build the approved design without asking: the design, its states and copy,
exactly what the prototype changed, and what it could not change. **Nothing leaves with an open
question.** What the Desk did not settle is asked and answered on the Desk, before the spec is
sent; the developer or coding agent gets only answers.

## Writing it

1. Claim; set `status: spec`. Read the card whole: the request, triage, the impact, the
   variants and their votes, every thread and note, the prototype and its guard report. The
   approved option is the one the item's note names (picked on Approve). While the card is at
   Building prototype or Live — try it, or its prototype is live (back at Options ready after a
   revise), it is what the prototype shows: the card's `live_pick` — its option, `version` and
   assets (`live_pick.asset`, `states[].asset`), which `approved.variant` and `approved.version`
   repeat; write the spec from those, not from a newer version drawn since.
2. Write `/tmp/design-desk-c<n>/spec.md`, with these sections:
   - **Summary** — the problem and the approved direction, three sentences.
   - **Why** — the request in the requester's words, the decisions taken on the Desk (which
     variant, which concerns changed it), each with who decided.
   - **The design** — the prototype link and demo sign-in while it lives, the variant
     names, and the screens as pictures, before and after (`![<view>](<file>)`; the deliver
     skill attaches them, [handoff-github](../.agents/skills/handoff-github/SKILL.md) → The
     pictures).
   - **Changes by screen** — per screen: layout, components, styles and tokens, icons.
   - **States** — empty, loading, error, long content, small screens, permissions: what each
     looks like, and which the prototype shows.
   - **Copy** — a table: where, old text, new text.
   - **Accessibility** — focus order, labels, contrast notes for anything new.
   - **What the prototype already does** — the guard summary, the files and their verdicts,
     the branch (when pushed) and the patch asset. Say plainly that it is a starting point
     and was not reviewed as production code.
   - **What a developer must add** — the `needs-developer` parts from triage and from any
     guard refusal, each with the reason.
   - **Tests to update** — tests in the repository that assert copy or structure the design
     changes (`git grep` the old strings under the profile's `tests` paths).
   - **Settled at handoff** — each question the Desk answered before sending, with its
     answer and who gave it (or "left to Design Desk": your suggested answer). Never a
     section of open questions.
3. Upload it (`design desk asset spec.md --kind spec`) and set `spec: {asset}`; the card
   shows it under **The developer spec**.
4. **Questions on the Desk, never in the spec.** List what the spec leaves to the developer's
   judgement that changes what gets built (a state, a copy, a breakpoint, an edge case the
   options never showed, which of two readings of a note) and that the card, its threads and
   the answers of an earlier pass do not settle. None → go on. Some → one form,
   `design desk ask C-<n> <file> --step handoff --form` with `{text, questions: [{text, why,
   options, suggested}]}`: at most 6 questions, 2–4 concrete options each, `suggested` your
   pick; the text says the spec waits for these answers and is on the card to read. Keep
   `status: spec`, `done --outcome asked` and stop. The answer re-queues the handoff with the
   same option; the next pass reads the form's answers, takes `suggested` for a question left
   to Design Desk, rewrites **Settled at handoff**, re-uploads the spec and goes on. Ask once
   per pass; a question already answered is never asked again.
5. Deliver it with the `deliver` action's skill (`design skill deliver --repo <repo>`,
   [actions.md](actions.md); the bundled one is
   [`handoff-github`](../.agents/skills/handoff-github/SKILL.md)), with the approved option's
   pictures attached, by the request's type:
   - `feature` (flow 1) — back to the issue it came from (`issue_writeback`), where a developer
     builds from it;
   - `adjustment` and `bug` (flows 2 and 3) — to the coding agent (`implementer`,
     `implementer_mention`), which builds it into the product;
   - `idea` and `proposal` — per `handoff`: `desk` (nothing more), `issue` or `draft-pr`.

   The skill sets `spec.issue_url` or `spec.pr_url`; the request then shows a card linking
   it, and the issue's own card on the Issues page once the issues run read it, filed under
   **✓ Designed** ([issues.md](issues.md) → On the Desk). What it sends asks nothing of its reader:
   it is the spec as the Desk settled it, and it names the Desk card as the place for a
   question that still comes up.
6. Record the approval as a decision ([desk.md](desk.md) → Decisions): the impact's concept,
   what was approved in one sentence, `origin.kind: approval`, the approver as `author`; the
   decisions it was approved against (`overruled`) as its `conflicts`.
7. `status: handed-off`; `done --outcome handed-off`. The prototype stays until its expiry
   so the developer can open it; it no longer holds a place, and the expiry pass tears it
   down once the date passes ([prototype.md](prototype.md) → Expiry).

Record ordering: the issue, comment or pull request is created first and its URL written to
the card right after; the skill's hidden card marker prevents a duplicate and finds a lost
URL.
