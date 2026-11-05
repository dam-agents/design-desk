---
name: handoff-github
description: >-
  Deliver an approved spec on GitHub: a comment on the issue a feature came from, the spec
  for a coding agent on the pull request or a new issue, or an issue or draft pull request
  for an idea, each found again by a hidden card marker.
---

# GitHub handoff

The `deliver` action ([docs/actions.md](../../../docs/actions.md)). Reads `handoff`,
`issue_writeback`, `implementer`, `implementer_mention`, `prototype_remote` and `desk_link` from
`work/CONFIG.md`. The spec is written and uploaded ([docs/handoff.md](../../../docs/handoff.md)
steps 1 to 3); the **Approve** on the Desk (a designer's, or a developer's on a request For Developers,
[docs/desk.md](../../../docs/desk.md) → For Developers or For Designers), with their name on the item, is the
approval to send it.

## The pictures

A developer reads the design from pictures, so every issue, comment or pull request this
skill writes carries them in its own body, scaled for reading in GitHub; a link to the Desk
never stands in for them (a developer may not see the Desk):

1. Build the approved option (its latest version) and shoot it at a reading width:
   `design shot <option.html> <dir> --width 1280`, plus `--width 390` when the request is about
   a small screen. Light first; dark when the change is about colour. Add the screen as it is
   today from the card's screens (`design desk fetch <A-n> <file>`), so the developer sees before and after.
2. Keep the views the spec names, at most six pictures, each under 5 MB.
3. Attach them with `--attach <file>#<alt>`, repeated per picture (`gh issue create`,
   `gh issue comment`, `gh issue edit`, `gh pr create`, `gh pr comment`, `gh pr edit`), and
   refer to each in the body as `![<view name>](<file>)` so it lands in place. A comment
   edited through `gh api` takes no attachment, so a revision whose pictures changed posts a
   new comment with them and edits the old one to a link to it. Never push a branch to host
   a picture.
4. Check what was written: every picture's reference in the posted body is an uploaded
   attachment URL, not the local file name (`gh issue view` / `gh api` the comment). A picture
   that did not upload is attached again; a delivery without its pictures is not done, so it
   fails with the reason (`ledger.sh fail`) instead of closing as handed off.

## Another skill writes the issue

When `design skill deliver --repo <repo>` names another skill (a product's `file-issue`, say),
follow that skill for the issue's shape and words, and keep this skill's rules: the pictures
above, the marker below, the record ordering, and the routing by type. Run it from the
product's clone (`bash "$HOME/scripts/checkout.sh" <repo>`), so links it makes to the
repository's own guidelines resolve. Its "get the user's approval" step is the Approve above.
Every issue, comment or pull request this skill writes carries the hidden marker
`<!-- design-desk card=C-<n> -->`; before writing, search for it (`gh search issues` or the
thread's comments) and edit what it finds instead of writing a second one.
Every call names the repository with `-R <[host/]owner/name>`.

## Nothing to ask

What this skill sends is built from without asking: never an open question, a "please
confirm" or a choice left to the reader. Every question went to the Desk first
([docs/handoff.md](../../../docs/handoff.md) step 4); a spec that still holds one goes back
there instead of out. The body's last line before the marker names the Desk card
(`<desk_link>#C-<n>`) as the place for a question that still comes up.

## By the request's type

- **`feature`** (from an issue), with `issue_writeback: enabled`: one comment on the origin
  issue with the chosen design in a sentence, the pictures above, the states and copy table,
  what was settled at handoff, the card's number and link (`<desk_link>#C-<n>`,
  [docs/desk.md](../../../docs/desk.md) → Links to an item) and the marker; a later revision
  edits that comment (new pictures: The pictures, step 3).
  A developer builds from it.
  Set `spec.issue_url` to the comment's URL.
- **`adjustment` and `bug`**: to the coding agent, per `implementer`:
  - `pr-comment`: one comment on the pull request (for a bug with no pull request, on a new
    issue) with the spec, the pictures, the patch, and `implementer_mention` as its first line when set (for
    example a coding agent's handle), so the agent that watches it implements the change;
  - `issue`: a new issue with the spec, the pictures and the patch attached, and the profile's
    `handoff.labels`, for a coding agent that takes labelled issues.

  The coding agent's own pull request is then reviewed like any other.
- **`idea` and `proposal`**, per `handoff`:
  - `desk`: nothing more; the spec is on the card;
  - `issue`: `gh issue create -R <repo> --title "<card title>" --body-file spec.md` with the
    pictures attached and the profile's `handoff.labels`, the body ending with the marker.
    Set `spec.issue_url`;
  - `draft-pr`: needs `prototype_remote` to be the repository itself; push the branch
    ([docs/prototype.md](../../../docs/prototype.md) → Push) and open a **draft** pull request
    from it with the title `design: <card title>`, `spec.md` as its body, the pictures
    attached and the marker.
    Set `spec.pr_url`.
    Never mark it ready, never merge.

**Straight to implementation** (the handoff item's `implement`, [docs/handoff.md](../../../docs/handoff.md)
step 5): add the label the coding agent's manifest names (`gh issue edit --add-label`) to the
origin issue (`feature`) or to the issue filed above; with no issue filed (`pr-comment`,
`draft-pr`), file one with the spec, the pictures and that label. Set `spec.issue_url` to it.

Record ordering: create the issue, comment or pull request first and write its URL to the
card right after; the marker search prevents a duplicate and finds a lost URL.
