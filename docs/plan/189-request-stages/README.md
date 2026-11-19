# Requests: Draft and Proposal before a request goes to design

> Working plan — temporary, committed on the feature branch. Deleted before the PR is ready.

**Issue:** #189 (part of #173)

## Goal

Today a request is visible to everyone the moment it is filed, and a designer sees it as Open.
The dev team gets room before that: an author works on a design with Design Desk on their own
(**Draft**), the dev team discusses it (**Proposal**), and only then does it go to design and
read **Open** for everyone. A designer's own request opens at once. The lead developer role is
renamed **UI dev owner**: the person who sends a proposal to design. Feedback is sent the same
way in every stage, with one button, **Send feedback**.

## Approach

A request gets a **`stage`**, apart from its `status`: `"draft"`, `"proposal"`, or absent (open).
The statuses (`REQUEST_STATES` in `desk/store.mjs`: `triage` … `handed-off`, `declined`) stay
as they are: Design Desk's work on a request (triage, options, revisions) runs inside a draft
too. A request with no `stage` is open, so every existing request stays as it is; no data
migration.

**The contract between store, server and page** (slices 02–05 build against it):

- Card fields (`getCard`, and the same on each `listCards` row): `stage: "draft" | "proposal" |
  null`; `opened_at`: when it left its last stage for open (null for one filed open);
  `staged: [{from, to, by, at}]` on the card only, the record of its moves.
- `POST /api/cards/<id>/stage {to}` with `to` one of:
  - `"proposal"` — Propose: from `draft`.
  - `"design"` — Send to design: from `draft` or `proposal`; opens it For Designers.
  - `"developers"` — Keep for developers: from `proposal`, or the UI dev owner's own `draft`; opens it For Developers (`size.small`).
  - `"draft"` — Back to draft: from `proposal`.
  Returns `{card}`; refuses with 403 (who) or 400 (from which stage) in plain words.
- `GET /api/me` → `can["stage-propose"]`, `can["stage-design"]`, `can["stage-own"]` (the page shows
  only the moves the viewer may make; the store has the final word per card).
- Agent routes (`/agent/cards`, `/agent/cards/<id>`) carry `stage` too and see every request.

**Who may do what** (the store enforces it; the page only hides):

| Who files it | Starts as | May move it with |
| --- | --- | --- |
| `designer` | open (no stage) | — |
| `pm`, `admin` | draft | Send to design |
| `ui-dev-owner` | draft | Propose, Send to design, Keep for developers |
| `developer` | draft | Propose |
| the agent (Slack, GitHub, chat, a run), an MCP peer | open, as today | — |

On a proposal, the `ui-dev-owner` and `admin` (any of them, author or not): Send to design,
Keep for developers, Back to draft, Close. The author of a draft may close it whatever their
role. A guest files nothing, as today.

**Who sees a staged request** — one store helper, `visibleTo(c, who)`, true for:
the agent (`who.agent`, or no `who` on agent routes); the author (`filedBy`, any of their
addresses); `admin`; and on a `proposal` also `developer` and `ui-dev-owner`. Everyone else
gets nothing: not in a list, a 404 on the card (`no card R-n`, the same words as a card that
does not exist), not in the bell, a decision's refs, the agenda, drafts, reviews or threads.
MCP peers go through `viewerRoute` with their `mcp_role`, so they follow the same rule.

**What a staged request refuses** (until it opens): approve, decide-and-close, the team's
feedback and votes (`openFeedback`, `vote`), Slack (`slack-share`, `slack-send`, polls, councils),
the presentation (`queueForCall`), a live prototype (`build`), the spec. Design Desk's own work
(triage, options, revise, states, now/before, Figma) and comments, drafts and reviews (verdicts
Comment and Request changes) go on as for an open request.

**Docs it touches:** [desk.md](../../desk.md) (Roles, For Developers or For Designers, a new
**Draft and Proposal** section, Reviews, People), [desk-page.md](../../desk-page.md) (Simple
mode, A request's state in the list, Notifications), [requests.md](../../requests.md) (how a
request starts), [config.md](../../config.md) (roles in `## Desk people`, `prototype_requesters`,
`mcp_role`), [digest.md](../../digest.md), [ONBOARDING.md](../../../ONBOARDING.md).

## Decisions

Taken with the operator before planning (and written on #189):

- Two stages, **Draft** and **Proposal**, before Open; tracked as they are, apart from the old
  statuses, which stay for now.
- **Draft** is seen by its author (and admin, and Design Desk); **Proposal** by developers, the
  UI dev owner and admin — not PMs, designers or guests.
- **Lead developer is renamed UI dev owner** (`ui-dev-owner`); `lead-developer` in a roster keeps
  working as the same role.
- **Draft is the default** for everyone but a designer, whose request opens at once.
  Send to design is for anyone but developers, who go through a proposal and the UI dev
  owner. The UI dev owner may also propose their own draft.
- On a proposal the UI dev owner may **Keep for developers** (it opens For Developers).
- Once open, a request never goes back to Draft or Proposal. The agent's requests open as today.
- **Pills show the stages' own labels** in both modes: Draft · Proposal · Open · In dev · Closed,
  never the statuses under them. Sent to design, it reads Open for everyone, its author too.
- **One button, Send feedback**, in every stage. Request changes on a request always means
  Design Desk draws the next version; Approve only once open. Moving between stages is never a
  verdict: it is a button in the header.
- When a request opens, its earlier conversations come with it, folded under **Before design**.

Taken while planning, from the code (flag in review if wrong): the author always sees their
request; an MCP peer reads as its `mcp_role`, but files open, as an agent; the UI dev owner may keep their
own draft for developers (it replaces New request's side switch for them); the author of a draft may close it whatever
their role; "before design" is a conversation started before `opened_at`.

## Slices

| #  | Title | Scope | Depends on | Done |
|----|-------|-------|------------|------|
| 01 | UI dev owner | Rename `lead-developer` → `ui-dev-owner` everywhere; the old name reads as the new | — | [x] |
| 02 | Stages in the store | `stage` on a request, how it starts, the moves and their API, what a staged request refuses | 01 | [x] |
| 03 | Hidden from who may not see it | `visibleTo` on every person's read; the bell on opening; the agent's own runs skip staged requests | 02 | [x] |
| 04 | Simple mode | Draft and Proposal pills, the filter and its boxes by role, the stage moves in the head, New request | 02, 03 | [ ] |
| 05 | Full mode, Send feedback, release | Full mode's dot and filters, Send feedback in both modes, Before design; VERSION, CHANGELOG | 04 | [ ] |

## Conventions & glossary

- **Stage**: `draft` or `proposal`; a request with none is **open**. **Staged**: has a stage.
  **Status**: the old pipeline field, unchanged. **Opened**: left its last stage (`opened_at`).
- Every slice ships its docs and tests (`docs/self-modification.md` §9, §11): one home per rule,
  links elsewhere. Tests: `desk/tests/store.test.mjs`, `server.test.mjs`, `page.test.mjs`,
  `mcp.test.mjs`, `scripts/tests/*.sh` as each slice names.
- `VERSION` (minor, one above main's at merge: 1.102.0 → 1.103.0) and its `CHANGELOG.md`
  **Upgrade** entry belong to slice 05 alone.
- Writing for people: plain English, the Desk's words ([desk.md](../../desk.md) → Writing on the Desk).
  Refusals say who may and what to do.
- UI work: `/frontend-design`; the Desk's own guidelines page and scale tests
  ([desk-page.md](../../desk-page.md) → The look) win.

## Verification

- `verify` from `work/CONFIG.md`: shell syntax, toolkit `npm ci`, `node --check`, the
  definition validator and `bash scripts/tests/run.sh`.
- Scoped: `node --test desk/tests/store.test.mjs desk/tests/server.test.mjs desk/tests/mcp.test.mjs`,
  `node --test desk/tests/page.test.mjs`.
- Manual: the dev server with mock data — `node desk/dev/mock.mjs`, then
  `http://localhost:5610/?role=<role>` (`desk/dev/mock-data.mjs` gets a draft and a proposal
  in slice 04).

## Whole-feature smoke test

On the mock Desk: as a developer, file a request → it reads Draft, only for them; Propose → a
UI dev owner sees it as Proposal, a designer and a PM do not (list, `#R-n` link: not found, bell).
The developer sends feedback with Request changes → Design Desk's revise is queued, it stays a
Proposal. The UI dev owner Sends to design → a designer sees it Open, with the earlier
conversation folded under Before design, and a new-request notice in the bell. As a PM, file a
request → Draft → Send to design → Open. As a designer, file one → Open at once. A roster row
`Lead developer` behaves as UI dev owner. Repeat the reading part in full mode.

## Delivery

Each slice is one atomic commit. The issue lands as a single PR.
