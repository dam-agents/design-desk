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
  field it does not show today is design too, with the field in `build` for the developer
  (the live prototype shows it with a sample value); it is `needs-developer` only when the
  field is private or decides who sees what, because that is a rule.
- Copy lives in the markup. A string in the code around it (a constant, a toast) is code,
  because a string there can just as well be an address or a status.
- **Hiding** something behind a disclosure is design; **removing** it is not.
- **A condition inside a style** (which color a status shows) is design; a condition on
  whether something is offered is not.
- Copy that changes meaning ("Delete" → "Archive") is not design when the action stays the
  same: it would mislead. Wording that keeps the meaning is design.

## What needs a developer

The table says what a **live prototype** can change; it is not the triage verdict. Almost every
design ends with a developer building it, and that alone never makes a request
`needs-developer`. The verdict is for a part where the product would have to **work differently**:
its logic or rules, how a feature works, how its parts fit together (its architecture), who may
see or do what (security), or a feature that would have to be rebuilt. It is the same line the
`impact` skill draws for **Under the hood**, so the triage and that text never disagree. The
small plumbing a developer adds on the way — a new field, a parameter, an endpoint, an API, a
control wired to an action the product already has, a picked value saved where the product
already saves — is ordinary building: it goes in triage's `build` and the spec, the verdict
stays `design`, and the live prototype shows the look with sample values. When in doubt, `design`.

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
(handlers, links, values, conditions, lists, data passed to components, every attribute
outside the presentational list — literal or not —, the components it renders, elements
that load or submit such as `script`, `iframe`, `form`, and what a class or a style reads).
Markup structure, classes, styles, copy and presentational components are not in it, so
moving, restyling and rewording leave it unchanged. New markup may only read what the old
markup read, call formatting and the view state its own function adds, add no condition on
existing data, and render only presentational components (new in the diff or named in
`presentational_imports`). An action keeps its place: moved under another condition, onto
another element, or offered twice, it is behaviour. A style sheet, an inline style or an SVG
that loads from anywhere but a plain local path or an image data URL, runs script, or disables
or hides a control fails; it is read as the browser reads it (escapes, entities, comments, any
prefix or letter case), and an inline style the guard cannot read counts as one that does. A
symbolic link fails too.
Files git ignores in the worktree fail the check — they would ship with the install unseen —
except dependency and build folders and logs at the root, in `style.ui_dir` or outside the UI
paths, and the profile's `ignored_ok`; never one the diff imports.

When the guard refuses:

1. Read the issues. A refusal you caused by accident (you passed a handler differently, you
   reformatted a condition) → write it the way the original did and run the guard again.
2. A refusal that is the request itself → that part is `needs-developer`: take it out of the
   prototype, keep it in the variants, and record it for the spec.
3. Never change the profile's boundary, the guard, or a file's imports to get a pass, and
   never install, push or hand off a diff the guard has not passed.

The guard report and the patch go on the card as assets (`--kind report`, `--kind patch`),
so a developer sees exactly what the prototype changed and that it stayed in bounds.
