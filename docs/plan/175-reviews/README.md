# Reviews: draft comments sent as one review, with a verdict

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #175 (part of #173)

## Goal

A person collects comments on a design request or a pull request's change privately, as drafts,
and sends them together as one review with a verdict — Request changes, Approve or Comment
only — from any device, in simple and in full mode. A review on a pull request also lands on
the pull request on GitHub. Until the next version arrives, the item says who is making it.

## Approach

The Desk server (`desk/server.mjs`, `desk/store.mjs`) keeps drafts and reviews; the page
(`desk/page.html`) collects and sends them; the agent posts a pull request's review to GitHub
from its inbox run, as it already writes the CI comment ([docs/watch.md](../../watch.md) → CI
gate). The server never calls GitHub.

- **Drafts** live in the store, per person and card, seen only by their author — the same
  privacy rule as a private ask (`sees`, `viewerKey` in `desk/store.mjs`).
- **A review** is a record `db.reviews[<id>]`: `{id, card, by, at, verdict, note, threads,
  sha?, posted?}`. Sending turns each draft into its own conversation (`openThread`), tagged
  `review: <id>`, so each keeps its own replies; the page groups them under the review.
- **Verdicts** reuse what exists: Request changes on a request → change notes (`kind:
  "change"`) and one `revise` item (`pendingOrNew`), as #184's Request changes does today;
  Approve on a change → `handle(card, who, true)`; Approve on a request → today's approve
  action (`act(…, "approve")`), run by the page first; Comment only → plain comments.
- **Who makes the next version** (`responsible` on a card read): after the newest review that
  requested changes, `design-desk` on a request until an option is redrawn after it, `developer`
  on a change until the pull request's head commit differs from the one the review saw.
- **On GitHub**: a `review` inbox item; the agent posts one review of type `COMMENT` from its
  own account (never `REQUEST_CHANGES` or `APPROVE`), whose body names the reviewer, the
  verdict, the note and each comment under the part or change it is about. The CI check is
  never touched by a review.

Docs it touches: [desk-page.md](../../desk-page.md) (The page, A request's state in the list,
Notifications), [desk.md](../../desk.md) (Questions, GitHub on the Desk), [requests.md](../../requests.md)
(Variants → revise from a review), [watch.md](../../watch.md) (a new **Reviews on GitHub**
section; Comments on GitHub ignores the agent's own review).

## Decisions

Taken with the operator before planning:

- **States** stay #184's three in simple mode. A change whose review requested changes is
  **In dev**, with a line "Changes requested · developer", until new commits arrive; then
  Open again. A request whose review requested changes stays **Open**, Design Desk's spinner
  saying it draws the next version. The store tracks who is responsible either way.
- **GitHub**: one `COMMENT` review from the agent's account; the verdict is in its body.
- **No CI hold in the tryout**: a review never sets or holds the `design-desk` check.
  Approve on a change marks it handled, which re-sets the check as today.
- **Comment only** stays a verdict: the one for people who may not approve, and a way to send
  drafts without changing the item's state.
- **Comment boxes**: a box under an option, a part or a change offers **Add to review**
  (primary) and **Comment now**; the box at the end of the page posts at once (**Comment**).
  A comment posted at once stays on the Desk; only a sent review goes to GitHub.
- **Full mode** gets drafts and the review dialog too, in this issue (no other issue tracks it).
- **Drafts on the server** (the issue's "from any device").
- **Who is told**: the bell (review sent, changes requested, a new version) and, on a pull
  request, GitHub's own notification of the posted review. No Slack message.
- **Not in scope**: #176's per-change tabs and "Looks good" marks, #177/#178's element dialog —
  slice 04 gives them one helper to add a draft from their boxes.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | Drafts on the server | Store + API: add, list, remove a person's drafts on a card | — | [ ] |
| 02 | Sending a review | Store + API: verdicts, threads tagged with the review, `responsible` | 01 | [ ] |
| 03 | The review on GitHub | `review` inbox item and due key, PR head commit in the GitHub copy, the agent posts it | 02 | [ ] |
| 04 | Simple mode: drafts and the review dialog | Comment boxes, Your review, header button, the dialog | 02 | [ ] |
| 05 | The review in the conversation, the state, the bell | Review block (both modes), In dev line, bell events | 02, 04 | [ ] |
| 06 | Full mode: drafts and the dialog; release | Full mode's boxes and dialog; VERSION, CHANGELOG, doc read-through | 04, 05 | [ ] |

## Conventions & glossary

- **Draft**: a comment not sent yet, its author's alone. **Review**: drafts sent together with a
  verdict and an optional note. **Responsible**: who makes the next version after Request changes.
- Every slice ships its docs and tests (`docs/self-modification.md` §9, §11): one home per rule,
  links elsewhere. Tests: `desk/tests/store.test.mjs`, `server.test.mjs`, `page.test.mjs`,
  `scripts/tests/test_inbox.sh` as each slice names.
- `VERSION` (minor: 1.100.0 → 1.101.0, or one above main's at merge) and its `CHANGELOG.md`
  **Upgrade** entry belong to slice 06 alone.
- Writing for people: plain English, the Desk's words ([desk.md](../../desk.md) → Writing on the Desk).
- UI work: `/frontend-design`; follow the page's scale tests (`desk-page.md` → The look).

## Verification

- `verify` from `work/CONFIG.md`: shell syntax, toolkit `npm ci`, `node --check`, the
  definition validator and `bash scripts/tests/run.sh` (needs Python `jsonschema`).
- Scoped: `node --test desk/tests/store.test.mjs desk/tests/server.test.mjs`,
  `node --test desk/tests/page.test.mjs`, `bash scripts/tests/run.sh` for shell tests.
- Manual: the dev server with mock data (`desk/dev/mock.mjs`, `desk/dev/mock-data.mjs`).

## Whole-feature smoke test

On the mock Desk in simple mode: open a request with options, add two drafts (one on an
option), see them under Your review and the count on Request changes, send them with Request
changes → a review block with both comments; the request stays Open with the spinner and a
`revise` item is queued. On a pull request change: add a draft, send with Request changes →
In dev, "Changes requested · developer"; a `review` item is queued; a GitHub copy with a new
head commit puts it back to Open. Repeat the request part in full mode. The bell shows the review.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
