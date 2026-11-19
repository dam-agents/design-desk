# 01 — UI dev owner

**Part of:** Draft and Proposal — see [README](./README.md)

## Context

The lead developer is renamed **UI dev owner** (`ui-dev-owner`): the role that will send a
proposal to design (slice 02). This slice is the rename alone — no new rights — so the later
slices build on the new name. A roster, `prototype_requesters` or `mcp_role` that still says
`lead-developer` (or `Lead developer`) keeps working as the same role.

## Implementation plan

1. `desk/store.mjs`:
   - `ROLES`, `DEVELOPERS`, `LOOK_ROLES`, `ADDABLE_ROLES`, and every `role === "lead-developer"`
     in `can()` → `"ui-dev-owner"`. Comments that say "lead developer" say "UI dev owner".
   - `readRole`: map `lead-developer` to `ui-dev-owner`, beside the existing `lead` → `admin`,
     with a comment naming the version that renamed it.
   - Data already stored with `role: "lead-developer"` (votes' `role`, decisions' `author.role`, …)
     is read under the new name when the store loads, as `lead` → `admin` already is (the JSON
     reviver in `load()`). `askForPerson` writes the new name.
   - Refusal texts ("A lead developer marks …") say "the UI dev owner".
2. `desk/server.mjs`: the role words in `need()`'s refusals and the kit's 403
   ("lead developers" → "UI dev owners").
3. `desk/page.html`: every role check and every word ("Lead developer" in People, role chips,
   hints, Guide, How it works) → UI dev owner; a stored `lead-developer` shows as UI dev owner.
   Role labels likely live in one map — find it (`rg -n "lead-developer|Lead developer" desk/page.html`).
4. `desk/dev/mock.mjs` (`ROLES`, the `?role=` comment), `desk/dev/mock-data.mjs` if it has one.
5. Scripts: `scripts/verify-onboarding.sh` (the role regex and its message: accept both,
   name `ui-dev-owner`), `scripts/preflight.sh` (lines ~430 and ~469: treat both; the word
   "the UI dev owner").
6. Docs: `docs/desk.md` (Roles table, For Developers or For Designers, People), `docs/desk-page.md`,
   `docs/config.md` (`## Desk people`, `prototype_requesters`, `mcp_role`: say the old name still
   reads), `docs/watch.md`, `docs/issues.md`, `docs/requests.md`, `docs/handoff.md`,
   `ONBOARDING.md`. `CHANGELOG.md`'s past entries stay as written.
7. Skills under `.agents/skills/` that name the role: `rg -n -i "lead.developer" .agents`.

Skills: none of the repository's own; plain search-and-replace with care for words vs keys.

## Docs and tests

- Docs: as step 6; one sentence in `docs/desk.md` → Roles that `lead-developer` reads as
  `ui-dev-owner` (the one home of that rule; config.md links it).
- Tests: `desk/tests/store.test.mjs` (`readRole("Lead developer") === "ui-dev-owner"`,
  `rosterOf` keeps such a row's role, `can("ui-dev-owner", "size")`), `server.test.mjs`
  (a roster row `Lead developer` gets `/api/me` role `ui-dev-owner` and its abilities),
  `page.test.mjs` (the existing lead-developer cases renamed), `scripts/tests/test_config.sh`
  (both spellings valid in verify-onboarding).

## Acceptance criteria

- [ ] `rg -n "lead-developer" desk scripts docs ONBOARDING.md .agents` finds only the legacy
      mapping, its test, its doc sentence and CHANGELOG history.
- [ ] A roster row `| x@example.com | Lead developer |` gets every right a lead developer had,
      under the role `ui-dev-owner`.
- [ ] The page never shows "Lead developer".
- [ ] `verify` passes.

## Smoke test

`node --test desk/tests/store.test.mjs desk/tests/server.test.mjs desk/tests/page.test.mjs` and
`bash scripts/tests/run.sh` pass. Then `node desk/dev/mock.mjs`, open
`http://localhost:5610/?role=ui-dev-owner` → People shows the role as UI dev owner, More →
For Developers is offered on an open request; `?role=lead-developer` behaves the same.
