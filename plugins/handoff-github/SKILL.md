---
name: handoff-github
kind: handoff
config: [handoff, issue_writeback, implementer, implementer_mention, prototype_remote]
description: >-
  Deliver an approved spec on GitHub: a comment on the issue a feature came from, the spec
  for a coding agent on the pull request or a new issue, or an issue or draft pull request
  for an idea, each found again by a hidden card marker.
---

# GitHub handoff

The spec is written and uploaded ([docs/handoff.md](../../docs/handoff.md) steps 1 to 3).
Every issue, comment or pull request this plug-in writes carries the hidden marker
`<!-- design-desk card=C-<n> -->`; before writing, search for it (`gh search issues` or the
thread's comments) and edit what it finds instead of writing a second one.
Every call names the repository with `-R <[host/]owner/name>`.

## By the request's type

- **`feature`** (from an issue), with `issue_writeback: enabled`: one comment on the origin
  issue with the chosen design in a sentence, the screens (upload them to the comment as
  images, or link the Desk), the states and copy table, the open questions, the Desk link and
  the marker; a later revision edits that comment.
  A developer builds from it.
  Set `spec.issue_url` to the comment's URL.
- **`adjustment` and `bug`**: to the coding agent, per `implementer`:
  - `pr-comment`: one comment on the pull request (for a bug with no pull request, on a new
    issue) with the spec, the patch, and `implementer_mention` as its first line when set (for
    example a coding agent's handle), so the agent that watches it implements the change;
  - `issue`: a new issue with the spec, the patch attached, and the profile's
    `handoff.labels`, for a coding agent that takes labelled issues.

  The coding agent's own pull request is then reviewed like any other.
- **`idea` and `proposal`**, per `handoff`:
  - `desk`: nothing more; the spec is on the card;
  - `issue`: `gh issue create -R <repo> --title "<card title>" --body-file spec.md` with the
    profile's `handoff.labels`, the body ending with the marker.
    Set `spec.issue_url`;
  - `draft-pr`: needs `prototype_remote` to be the repository itself; push the branch
    ([docs/prototype.md](../../docs/prototype.md) → Push) and open a **draft** pull request
    from it with the title `design: <card title>`, `spec.md` as its body and the marker.
    Set `spec.pr_url`.
    Never mark it ready, never merge.

Record ordering: create the issue, comment or pull request first and write its URL to the
card right after; the marker search prevents a duplicate and finds a lost URL.
