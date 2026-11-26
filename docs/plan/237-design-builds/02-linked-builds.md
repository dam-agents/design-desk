# 02 — Linked builds and the Build state

**Part of:** Follow a design into its pull requests — see [README](./README.md)

## Context

A request and the pull requests that build it stay two items, but clearly linked, both ways. Only
explicit or confirmed links count; a guessed one is a suggestion. A request enters a new **Build**
state when a linked pull request is ready for review.

## Implementation plan

1. **Store** (`desk/store.mjs`):
   - Change card fields the agent writes: `may_build: [{request, reason}]` (at most 3; each an
     approved request; refused for a request in the card's `not_builds`, or already linked).
     `design_check` stays the agent's comparison of an explicit or confirmed link: refuse it for a
     request in `not_builds`, and for a request that is only in `may_build`.
   - Person actions: `linkBuild(changeId, who, request, on)` — `on`: `build_link: {request, by, at}`,
     drops it from `may_build`, and enqueues the watch-side re-check (an inbox item the agent works
     as the comparison of step 11; reuse an existing kind if one fits, e.g. how `ci` items are
     queued with `pendingOrNew`, else add one and document it); `!on` (Not this one):
     `not_builds += {request, by, at}`, drops it from `may_build`. Who: `handle` or `handle-small`
     roles (designers, admins, UI dev owners).
   - `buildsOf(c)` returns the linked request from the explicit index, else `build_link`, else
     `design_check.request`, with `how: "explicit" | "confirmed"`.
   - `buildOf(request)` (new): every change linked to it — `{card, title, pr, url, draft, merged,
     verdict, differences: <open count>}` — and the derived `building: true` when the request is
     `handed-off`, not `built`, and one of them is open and not a draft. `getCard` and `listCards`
     send both (`builds_list`/`building`, names up to you; keep the list row small).
   - The existing "a merged change that builds it marks it built" rule stays.
2. **Server** (`desk/server.mjs`): `POST /api/cards/<id>/build-link {request, link: true|false}`
   behind the same role check as Mark handled for developers.
3. **Page** (`desk/page.html`):
   - Change card: the existing "Builds a design from Design Desk" box (around `c.builds`) reads
     **Builds R-<n>** with the link; a suggestion reads "May build R-<n>: <reason>" with **Link** and
     **Not this one** for who may.
   - Request: the spec's GitHub rows become a **Build** section — one line per linked pull request:
     its pill (Draft / Open / Merged), its title, its verdict ("Matches the design" / "N differences")
     and a link to its change card; "None yet" while none.
   - State: full mode's state word for a request in Build reads **Build** (between Sent/In dev and
     Shipped); simple mode keeps it in the In dev group with its own pill **Build**
     (`simpleState`, `SIM_PILL`, `simTip`). The Designs tab's To build row says Build too.
4. **Docs**: watch.md step 11 (explicit links listed; the element-file rule writes `may_build`
   instead of linking), desk.md (Designs / GitHub on the Desk: the Build section, Link / Not this
   one, who), desk-page.md (A request's state in the list: Build; the request page's Build section;
   the change card's Builds line).

## Acceptance criteria

- Store tests: explicit and confirmed links count, a suggestion does not; Not this one is refused
  again as a suggestion and as a `design_check`; `building` true only with a ready open linked PR.
- Server test: the route and its role check.
- Page tests: the Build section, the Builds line, Link / Not this one, the Build pill and word.
- Docs updated; `work/CONFIG.md` → `verify` passes.
