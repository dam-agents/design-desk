# 02 — The item header and its actions

**Depends on:** 01-states-and-list
**Part of:** Simple mode list and detail page — see [README](./README.md)

## Context

An opened request or change starts with one header that says what it is, where it stands and the
one or two things the viewer may do about it; everything else waits in a ⋯ menu. The page under
the header is slice 03's; this slice only replaces the top of `renderRequest` and `renderChange`
in simple mode.

## Implementation plan

Apply `/frontend-design` and `/copy`.

1. **`simpleHead(c)`** in `desk/page.html`, used at the top of `renderRequest(c)` and
   `renderChange(c)` under `simple()` instead of the title, the chips line and the status box:
   - the kind's icon and the title, its number grey after it and the link icon that copies the
     item's link (`num(c)`, `titleLink(c)`), as in full mode;
   - the state pill from `simpleState(c)` (always shown here), with `.dd-spin` and Design Desk's
     work in words while `atWork(c)`;
   - a change: its pull request number as a link to GitHub (`source.url`), the word only when it is
     Draft (`source.draft`) or Merged (`source.merged_at`);
   - who and when: a request's author (`created_by` / `origin`) and filing date, a change's author
     and its shipped date, with the name rule (`personName`: roster name, else the part before the
     `@`, never the whole address);
   - on the right at most two buttons, then ⋯.
   It stays in view while the page scrolls (`position: sticky` inside `#detail`, with the existing
   crumb above it).
2. **A request's actions**, each only when `can(...)` allows it and the state is Open:
   - **Approve** — the existing approve dialog (`act` approve, `docs/desk.md` → Deciding straight
     away) with the option to approve when there are several, but in simple mode it always sends
     `auto_send: true` and shows no send checkbox and no Straight to implementation;
   - **Request changes** — a dialog with one note, posting the existing `revise` with it
     (`ASK_ABILITY.revise`); the request then shows the spinner until the new version is drawn;
   - a spec draft waiting for a person (README table): one button, **Send to developers**, the
     existing send (`handoff` `deliver`) on the default route.
3. **A change's actions**: **Approve** = the existing mark handled (`handle`, or `handle-small` For
   Developers), only while Open and when `can` allows it. No Request changes (#175).
4. **The ⋯ menu** (one popover, like More today): a request — **Close…** (the existing close
   dialog: Just close it / Close it and record a decision) while not closed, **Reopen** when
   closed; a change — **Turn into a design request** (the existing Adjust the design); both —
   **Open on GitHub** when there is a URL (Copy link is the title's link icon, not repeated here). Nothing else: no vote buttons (a vote's
   result still shows in slice 03), no rename, no presentation, no For Developers move.
5. **Docs**: `docs/desk-page.md` → The page → Simple mode: the header, its actions and the ⋯ menu;
   that Approve sends as soon as the spec is written and when it cannot. `docs/handoff.md` → Review
   before it goes: one sentence that simple mode's Approve asks for the send (link, no restating).

## Docs and tests

- `docs/desk-page.md`, `docs/handoff.md` as step 5.
- `desk/tests/page.test.mjs` (`DESK(...)`, `simple: true`):
  - a request's header: title with its number and link icon, pill, author's short name, Approve and Request changes for a
    designer; none for a guest;
  - Approve posts `auto_send: true` and shows no send checkbox; Request changes posts `revise` with
    the note;
  - a spec draft from a Slack origin shows Send to developers and the Open pill;
  - a change's header: PR number link, Draft / Merged word, Approve posts handle; ⋯ offers Turn into
    a design request, Copy link, Open on GitHub;
  - a closed request offers Reopen; the header stays in view after scrolling;
  - a name with no roster entry shows the part before the `@`.

## Acceptance criteria

- [ ] In simple mode every request and change page opens with the sticky header: icon, title,
      pill, PR link for a change, who and when, at most two buttons and ⋯; the title carries the
      item's number and the link icon that copies its link.
- [ ] Approve on a request sends the spec as soon as it is written; where it cannot, the request is
      Open with Send to developers.
- [ ] Request changes on a request starts a revise with the note; the request shows the spinner.
- [ ] Approve on a change marks it handled; there is no Request changes on a change.
- [ ] The ⋯ menu holds only what decision 7 lists; full mode's pages are unchanged; the suite passes.

## Smoke test

`node --test --test-name-pattern "simple" desk/tests/page.test.mjs`, then the made-up Desk
(`node desk/dev/mock.mjs 5610`, `?role=designer`, Simple mode on): open a request with drawn
options — Approve shows no send checkbox and the request moves to In dev; Request changes with a
note — the spinner shows, then a new version; open a change — the PR number links to GitHub,
Approve moves it out of Open; ⋯ on each shows only its items. Scroll a long page: the header stays.

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
operator can confirm it by hand.
