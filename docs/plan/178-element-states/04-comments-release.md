# 04 — Comments on a state; release

**Depends on:** 01-switcher-all-states, 02-header-step-elements, 03-close-every-dialog
**Part of:** An element's states in its dialog — see [README](./README.md)

## Context

With a state shown in After, a comment written in the dialog is about that state: it carries the
state and says so, as notes made in the design workspace on a state already do. The way into the
workspace and back keeps the state. Then the release entry.

## Implementation plan

All in `desk/page.html` unless named.

1. **The anchor**: `partAnchor(v, e, st)` adds `state: st.id` and labels it
   `"<part> · <state>"`; the `elDraft` and `elComment` handlers pass the state shown
   (`e.states.find((x) => x.id === S.el.st)`). `draftsOnPart` matches a selector-less part by the
   label's first segment, as `notesOnPart` does.
2. **It says so**: `elementTalk(c, v, e, st)` — above the box, "Your comment is about
   **<state>**."; the placeholder and `aria-label` name it. A listed note about a state shows
   the state's name as a chip before its author; a draft's "Not sent yet" adds " · <state>".
3. **The workspace at the state**: the `elWs` handler sets `S.ws.state` to the state shown (null
   for As designed); `data-ws-states-of` opens the dialog with `state: S.ws.state`, so it opens on
   the state the workspace shows when it is one of the part's.
4. **Docs**: `docs/desk-page.md` → The element dialog: a comment written while a state is shown
   is about it; Open in design workspace opens at it.
5. **Release**: `VERSION` → next minor (1.105.0 on today's `main`); `CHANGELOG.md` entry:
   republish the page ([desk.md](docs/desk.md) → Publishing the page); what changes in the
   element dialog and the workspace's "As designed"; no data migration.
6. **Tests** (`desk/tests/page.test.mjs`, the `bridgeBefore` harness given states): with a state
   picked, **Comment** posts `anchor.state` and the `"<part> · <state>"` label, the box says
   which state, the note lists with the state's name; **Add to feedback** the same as a draft;
   **Open in design workspace** opens with the state picked (the workspace's State pick names
   it); from the workspace's Every state, the dialog opens on its state.

## Acceptance criteria

- [ ] A comment or draft written with a state shown carries `anchor.state` and that label; the
      store accepts it (it is one of the option's states).
- [ ] The box, the listed notes and the drafts name the state.
- [ ] Open in design workspace opens at the state shown; Every state in the workspace opens the
      dialog at the workspace's state.
- [ ] `VERSION` and `CHANGELOG.md` move together, one minor bump.
- [ ] The whole `verify` passes.

## Smoke test

Run the whole `verify` (README → Verification). Then on the mock Desk, steps 5–7 of the
README's whole-feature smoke test (and 7–9).

The implementing agent runs this itself, then prints a short manual smoke-test guide so the
user can confirm it by hand.
