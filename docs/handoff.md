# Handoff — the developer spec

A `handoff` item comes from a designer's **Approve and hand off**. The spec is what a
developer needs to build the approved design without asking: the design, its states and copy,
exactly what the prototype changed, and what it could not change.

## Writing it

1. Claim; set `status: spec`. Read the card whole: the request, triage, the variants and
   their votes, every thread, the prototype and its guard report.
2. Write `/tmp/design-desk-c<n>/spec.md`, with these sections:
   - **Summary** — the problem and the approved direction, three sentences.
   - **Why** — the request in the requester's words, the decisions taken on the Desk (which
     variant, which concerns changed it), each with who decided.
   - **The design** — the prototype link and demo sign-in while it lives, the variant
     names, and the screens (asset ids on the card).
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
   - **Open questions** — anything the Desk did not settle.
3. Upload it (`design desk asset spec.md --kind spec`) and set `spec: {asset}`.
4. Deliver it with the handoff plug-in ([plugins.md](plugins.md); the bundled one is
   [`handoff-github`](../plugins/handoff-github/SKILL.md)), by the request's type:
   - `feature` (flow 1) — back to the issue it came from (`issue_writeback`), where a developer
     builds from it;
   - `adjustment` and `bug` (flows 2 and 3) — to the coding agent (`implementer`,
     `implementer_mention`), which builds it into the product;
   - `idea` and `proposal` — per `handoff`: `desk` (nothing more), `issue` or `draft-pr`.

   The plug-in sets `spec.issue_url` or `spec.pr_url`.
5. `status: handed-off`; `done --outcome handed-off`. The prototype stays until its expiry
   so the developer can open it; it no longer holds a place, and the expiry pass tears it
   down once the date passes ([prototype.md](prototype.md) → Expiry).

Record ordering: the issue, comment or pull request is created first and its URL written to
the card right after; the plug-in's hidden card marker prevents a duplicate and finds a lost
URL.
