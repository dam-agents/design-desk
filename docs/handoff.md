# Handoff — the developer spec

A `handoff` item comes from a designer's **Approve and hand off**. The spec is what a
developer needs to build the approved design without asking: the design, its states and copy,
exactly what the prototype changed, and what it could not change.

## Writing it

1. Claim; set `status: spec`. Read the card whole: the request, triage, the variants and
   their votes, every thread, the prototype and its guard report.
2. Write `/tmp/design-desk-c<n>/spec.md` in `language`, with these sections:
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
4. Deliver per `handoff`:
   - `desk` — nothing more; the spec is on the card.
   - `issue` — `gh issue create -R <repo> --title "<card title>" --body-file spec.md` with the
     profile's `handoff.labels`; one issue per card: before creating, look for an open issue
     whose body has `<!-- design-desk card=C-<n> -->` and update it instead. The body ends
     with that marker. Set `spec.issue_url`.
   - `draft-pr` — needs `prototype_remote` = the repository itself; push the branch
     ([prototype.md](prototype.md) → Push) and `gh pr create --draft -R <repo> --head
     <branch> --title "design: <card title>" --body-file spec.md`, the same marker in the
     body, once per card. Set `spec.pr_url`. Never mark it ready, never merge.
5. `status: handed-off`; `done --outcome handed-off`. The prototype stays until its expiry
   so the developer can open it; it no longer holds a place, and the expiry pass tears it
   down once the date passes ([prototype.md](prototype.md) → Expiry).

Record ordering: the issue or pull request is created first and its URL written to the card
right after (a duplicate is prevented by the marker search, a lost URL is found by it).
