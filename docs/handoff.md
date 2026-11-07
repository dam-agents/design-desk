# Handoff — the developer spec

A `handoff` item comes from an **Approve** (with the option picked in its note): a designer's or an admin's, a PM's or a lead developer's, or a developer's on a request For Developers ([desk.md](desk.md) → For Developers or For Designers, Deciding straight away). Approved before any option, its note is what to build in the approver's words: write the spec from the request, the triage and that note, and leave out what has no design. The spec is what a
developer needs to build the approved design without asking: the design, its states and copy,
exactly what the prototype changed, and what it could not change. **Nothing leaves with an open
question.** What the Desk did not settle is asked and answered on the Desk, before the spec is
sent; the developer or coding agent gets only answers.

## Writing it

1. Claim; set `status: spec`. Read the card whole: the request, triage, the impact, the
   variants and their votes, every thread and note, the prototype and its guard report. The
   approved option is the one the item's note names (picked on Approve). While the card is at
   Building prototype or Live — try it, or its prototype is live (back at Team feedback after a
   revise), it is what the prototype shows: the card's `live_pick` — its option, `version` and
   assets (`live_pick.asset`, `states[].asset`), which `approved.variant` and `approved.version`
   repeat; write the spec from those, not from a newer version drawn since.
2. Write `/tmp/design-desk-c<n>/spec.md` in plain words ([desk.md](desk.md) → Writing on the
   Desk): a developer reads it, but so do the designers who approved it. These sections:
   - **Summary** — the problem and the approved direction, three sentences.
   - **Why** — the request in the requester's words, the decisions taken on the Desk (which
     variant, which concerns changed it), each with who decided.
   - **The design** — the prototype link and demo sign-in while it lives, the variant
     names, and the screens as pictures, before and after: upload each (`design desk asset
     <file> --kind image --card C-<n>`) and write it as `![<view>](asset:A-<n>)`, so the
     Desk shows it to the people who review the spec; the deliver skill attaches them to
     GitHub ([handoff-github](../.agents/skills/handoff-github/SKILL.md) → The pictures) and
     the bundle saves them under `pictures/`.
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
   End it with **Acceptance criteria**: one line per thing a person can check on the built
   screen, as *Given … When … Then …*, every state and every user story covered. Write the
   same list on the card as `spec.acceptance: [{given, when, then, state?, story?}]`: the
   bundle carries it to the coding agent.
3. Upload it (`design desk asset spec.md --kind spec`) and set `spec: {asset, acceptance,
   review: "draft"}`; the card shows it under **The developer spec**. With `spec_review:
   disabled` write `review: "sent"`: a spec without it waits for a person.
4. **Questions on the Desk, never in the spec.** List what the spec leaves to the developer's
   judgement that changes what gets built (a state, a copy, a breakpoint, an edge case the
   options never showed, which of two readings of a note) and that the card, its threads and
   the answers of an earlier pass do not settle. None → go on. Some → one form,
   `design desk ask C-<n> <file> --step handoff --form` with `{text, questions: [{text,
   options, suggested}]}`: at most 6 questions, 2–4 concrete options each, `suggested` your
   pick ([The questions form](desk.md#the-questions-form)). Keep
   `status: spec`, `done --outcome asked` and stop. The answer re-queues the handoff with the
   same option; the next pass reads the form's answers, takes `suggested` for a question left
   to Design Desk, rewrites **Settled at handoff**, re-uploads the spec and goes on. Ask once
   per pass; a question already answered is never asked again.

## Review before it goes

Writing the spec and sending it are two steps, and the Desk says so everywhere: the request's
steps (**Approved** → **Spec written** → **Sent to developers**, Send a person's step like
Approve), its state word (*Spec draft — read it, then send*), and Approve's words (the spec waits on the
Desk; nothing goes to developers until **Send to developers**).
Nothing leaves the Desk until a person sends it (`spec_review`, default `enabled`; `disabled`
→ go straight on to step 5). After step 4 with no open question: keep `status: spec`,
`done --outcome review` and stop. On the
card the people who may approve it read the spec, and:
- **Edit the spec** — their text becomes the newest version (`spec.history` keeps the others);
- **Ask for changes…** — a `handoff` item with `scope: "spec-revise"` and their note: rewrite
  the spec from its newest version (theirs, if they edited it) as the note says, upload it,
  `spec: {asset, acceptance, review: "draft"}`, `done --outcome review`;
- **Send to developers** — a `handoff` item with `scope: "deliver"`: go on at step 5 with the
  spec's newest version exactly as it is, never rewritten. Here the person picks the route,
  where it goes to GitHub: **As an issue for developers**, or **Straight to the coding agent**
  (the item's `implement`, the issue labelled for it; step 6). Approve then asks no such
  thing; with `spec_review: disabled` Approve still does.
## Sending it

5. **The bundle.** `design desk bundle C-<n> /tmp/design-desk-c<n>/handoff`: `spec.md` (the
   text for people), `design.json` (the same design for a coding agent: the approved option,
   the boundary and what needs a developer, every element and state with its selector in the
   mockup, the user stories, the acceptance criteria, the decisions it follows, the
   prototype's branch and patch), `mockup.html` (the approved option, the exact reference),
   `states/` and `shots/` (each state alone), `pictures/` (the spec's pictures, its lines pointing at them). Look at `design.json`: every element has its
   states, every acceptance line names something on the screens. With `prototype_remote` set,
   commit the folder as `handoff/C-<n>/` on the request's `design-desk/` branch (the
   prototype's, else `design-desk/c<n>-handoff` from the default branch), run `design guard`
   on that exact diff ([boundary.md](boundary.md)), and push only when it passes; a refusal
   pushes nothing, and the delivery carries `design.json` in the issue alone.
6. Deliver it with the `deliver` action's skill (`design skill deliver --repo <repo>`,
   [actions.md](actions.md); the bundled one is
   [`handoff-github`](../.agents/skills/handoff-github/SKILL.md)), with the approved option's
   pictures attached, by the request's type:
   - `feature` (flow 1) — back to the issue it came from (`issue_writeback`), where a developer
     builds from it;
   - `adjustment` and `bug` (flows 2 and 3) — to the coding agent (`implementer`,
     `implementer_mention`), which builds it into the product;
   - `idea` and `proposal` — per `handoff`: `desk` (nothing more), `issue` or `draft-pr`.

   **Straight to implementation** — the item has `implement` (the approver ticked it on
   Approve; the Desk refuses it where the spec stays on the Desk, and a route that is `desk`
   at delivery ignores it): the spec also reaches the
   coding agent as an issue with the label its manifest names for work to implement — the
   origin issue for a `feature`, the issue `implementer: issue` or `handoff: issue` files, else
   a new issue with the spec. No manifest or no label → deliver without it and say so on the
   card and to the operator.

   The skill sets `spec.issue_url` or `spec.pr_url`; the request then shows a card linking
   it, and the issue's own card on the Issues page once the issues run read it, filed under
   **✓ Designed** ([issues.md](issues.md) → On the Desk). What it sends asks nothing of its reader:
   it is the spec as the Desk settled it, and it names the Desk card as the place for a
   question that still comes up. It carries the bundle: `design.json` in a folded block
   ("For a coding agent"), the link to the pushed `handoff/C-<n>/` folder when there is one,
   and one line for the coding agent: build from `design.json` and `mockup.html`, check each
   state against `shots/`, and tick every acceptance line in the pull request.
7. Record the approval as a decision ([desk.md](desk.md) → Decisions): the impact's concept,
   what was approved in one sentence, `origin.kind: approval`, the approver as `author`; the
   decisions it was approved against (`overruled`) as its `conflicts`.
8. `status: handed-off`; `done --outcome handed-off`. The prototype stays until its expiry
   so the developer can open it; it no longer holds a place, and the expiry pass tears it
   down once the date passes ([prototype.md](prototype.md) → Expiry).

Record ordering: the issue, comment or pull request is created first and its URL written to
the card right after; the skill's hidden card marker prevents a duplicate and finds a lost
URL.
