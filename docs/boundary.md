# The design-only boundary

Designers and project managers file requests without knowing how the product is built. They
rely on one promise: **a prototype changes how the product looks, never what it does.** This
file is how that promise is kept and how it is explained.

## What a design change is

| Is a design change | Is not (a developer or a decision) |
| --- | --- |
| Layout, spacing, sizes, alignment, order and grouping of what is already there | Saving, loading or sending anything new; a new field in a form or a list |
| Colors, typography, icons, images, the product's design tokens | A rule: validation, limits, who may see or do what |
| Copy: labels, titles, help text, empty states, error wording | A new action, or removing one people use today |
| Which part opens, collapses, sits in a tab or a dialog | A different page address, a new step in a flow that the server checks |
| Moving an existing action to another place on the same screen | Changing a default value that is stored, or a setting |
| A new presentational component built from existing ones | New packages, a new library, anything behind the screens |

Edge cases, decided once:

- **Showing information the screen already shows** somewhere else on it is design. Showing a
  field it does not show today is `needs-developer`, even when the screen receives it: the
  field may be private, or not loaded for every user, and a developer decides that.
- Copy lives in the markup. A string in the code around it (a constant, a toast) is code,
  because a string there can just as well be an address or a status.
- **Hiding** something behind a disclosure is design; **removing** it is not.
- **A condition inside a style** (which color a status shows) is design; a condition on
  whether something is offered is not.
- Copy that changes meaning ("Delete" → "Archive") is not design when the action stays the
  same: it would mislead. Wording that keeps the meaning is design.

## Explaining a "not as a design change"

People asked in good faith. The answer is concrete and kind:

1. Say which part can be done, and do it.
2. Name the part that cannot, in their words, with the reason in one sentence ("the list
   shows what the server sends, and the server does not send the owner's name yet").
3. Say what it would take ("a developer adds the owner to what the server sends") and that
   the spec will carry it.
Never "the system does not allow it", never a file path, never a lecture.

## The guard

`design guard <worktree> --base origin/<default> --profile <profile.json> --patch <file>`
checks the exact diff of a prototype and prints one JSON object:

- `ok: true` — every changed file changes only the look. Exit 0.
- per file, a `verdict`: `ok`, `style`, `global` (a style that changes the whole product —
  say so on the card), `asset`, `ui-state` (view-only state such as open/closed), or a
  refusal: `denied` (the file is outside the profile's allowed paths), `logic` (behaviour
  changed: new data, handlers, conditions, imports), `removed` (something people can use
  today is gone). Each refusal lists `issues` for you and a `plain` sentence for people.
- exit 1 — at least one refusal; exit 2 — the check could not run (no profile boundary, a
  git error). **Exit 2 is never a pass.**

How it decides: the profile's `boundary.allow` and `boundary.deny` path lists first (a rename
by both paths); then, for code, a fingerprint of each changed file — the modules it uses,
every statement outside the markup in its order, and what the markup wires to behaviour
(handlers, links, values, conditions, lists, data passed to components, and any attribute
whose expression calls or assigns). Markup structure, classes, styles, copy and
presentational components are not in it, so moving, restyling and rewording leave it
unchanged. New markup may only read what the old markup read, call formatting and the new
view state's setters, and add no condition on existing data. Files git ignores in the
worktree (other than dependency and build folders) fail the check: they would ship with the
install unseen.

When the guard refuses:

1. Read the issues. A refusal you caused by accident (you passed a handler differently, you
   reformatted a condition) → write it the way the original did and run the guard again.
2. A refusal that is the request itself → that part is `needs-developer`: take it out of the
   prototype, keep it in the variants, and record it for the spec.
3. Never change the profile's boundary, the guard, or a file's imports to get a pass, and
   never install, push or hand off a diff the guard has not passed.

The guard report and the patch go on the card as assets (`--kind report`, `--kind patch`),
so a developer sees exactly what the prototype changed and that it stayed in bounds.
