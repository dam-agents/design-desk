# The design profile

Everything this agent knows about one product lives in that product's repository, in a
**design profile**: `.design-desk/<name>/`. The product team keeps it current in the same pull
request that changes what it describes, so the agent never carries a stale copy. The agent
reads it from the **default branch** of a fresh fetch, never from a pull request branch,
because its `bin/` scripts run on the agent's machine.

`design profile <repo> [--clone <dir>]` prints the profile as JSON, with `dir` (where it was
read from) and `source` (`repo`, `saved` or `default`).

## Layout

```
.design-desk/<name>/
  profile.json   the data below
  PROFILE.md     what a designer and this agent should know about the product
  bin/env        optional: how to run a live prototype (the engine contract below)
  seed/          optional: demo data the engine loads
```

## `profile.json`

```json
{
  "schema": "design-desk-profile/v1",
  "product": "Acme Widgets",
  "ui": { "paths": ["web/src/**/*.tsx", "web/src/**/*.css"] },
  "style": { "ui_dir": "web", "styling": "tailwind", "css_entry": "web/src/app.css", "icons": "@carbon/icons-react" },
  "boundary": {
    "allow": ["web/src/**/components/**", "web/src/**/views/**", "web/src/**/*.css", "web/public/**"],
    "deny": ["web/src/**/api/**", "web/src/**/hooks/**", "web/src/**/store/**"],
    "global_styles": ["web/src/app.css"],
    "presentational_imports": ["^@carbon/icons-react$", "^@/components/ui/"],
    "aliases": { "@/": "web/src/" },
    "code": { "class_helpers": ["cn"], "copy_helpers": ["t"] }
  },
  "docs": {
    "glossary": "docs/glossary.md",
    "architecture": ["docs/architecture/"],
    "decisions": ["the hidden author-decisions block of a PR body"]
  },
  "screens": { "Agents list": "web/src/modules/agents/views/agents-view.tsx" },
  "capture": { "base_url": "", "routes": { "Agents list": "/agents" },
               "login": { "path": "/", "user_field": "#username", "password_field": "#password", "submit": "button[type=submit]" } },
  "engine": { "endpoints": [{ "name": "app", "port": 4444 }], "open_endpoint": "app", "storage": "40Gi" },
  "handoff": { "labels": ["design"] },
  "tests": ["web/src/**/__tests__/**", "e2e/**"],
  "contacts": "the PR author; the #design channel"
}
```

- `ui.paths` — what counts as a UI change for the watch.
- `style` — the designer's repo profile (`design repo detect` proposes one), so variants
  compile the product's real styles: `ui_dir`, `styling`, `css_entry`, `icon_package` (the
  package `<ui-icon>` draws from), `class_merge`, `shell` and `components` (where the variants
  skill reads the frame and the parts). For the catalog, `mock_modules` (path patterns whose
  exports are stubbed when a component renders outside the app: data hooks, stores, API
  clients) and `render_wrappers` (`{src, export}` providers every tile renders inside).
- `boundary` — the guard's input ([boundary.md](boundary.md)). Without `allow`, nothing can
  be a design change and the guard refuses to run. `ignored_ok` lists the ignored build
  outputs the product's own install leaves in a worktree (dependency folders and `dist/`
  are always fine).
- `docs` — where the "why" lives, read when explaining.
- `screens`, `capture` — where each screen is in code and at which address it renders.
  `capture.login` signs in with the demo account `bin/env credentials` prints.
- `engine` — the Environment a live prototype needs: endpoints, the one people open, disk,
  and `egress`: `{host, why}` per host the install must reach beyond the platform's trusted
  preset.
- `catalog.elements` — the elements worth having in the catalog: `{name, group, file,
  export}` ([catalog.md](catalog.md)).
- `plugins` — the product's own plug-ins, paths relative to the profile ([plugins.md](plugins.md)).

`design profile <owner/name> --check` (or `--check-dir .design-desk/<profile>` in the product's
checkout) checks this shape and that every path it names exists; the onboarding's live check
runs it for every repository with a profile.

## `PROFILE.md`

Written for people as much as for the agent: the product in two paragraphs, its users, its
words (or a link to the glossary), its main screens, the design system's rules that the code
does not state, and what a live prototype can and cannot show (no real models, no outside
services…). Keep it under 200 lines; link instead of copying.

## The engine contract (`bin/env`)

`bash "$HOME/scripts/proto.sh" run C-<n> <verb>` runs `<profile>/bin/env <verb>` with:

| Variable | Value |
| --- | --- |
| `PROTO_NAME` | the Environment's name (`c<n>`); `ssh env-$PROTO_NAME` reaches it |
| `PROTO_WORKTREE` | the prototype's checkout |
| `PROTO_BASE` | the commit the prototype branched from |
| `PROTO_PROFILE_DIR` | this profile's directory, read from the default branch |
| `PROTO_STATE` | a directory for the engine's own state and logs |

| Verb | Does | Prints |
| --- | --- | --- |
| `up` | installs the product from the worktree into the Environment and seeds demo data; idempotent | progress lines; exit 0 when the app answers |
| `update` | applies the worktree's current change to an installed Environment, fast | progress lines |
| `status` | — | `{"state": "running" \| "installing" \| "failed" \| "absent", "detail": "…"}` |
| `credentials` | — | `{"user": "…", "password": "…", "hint": "…"}` — a demo account only |
| `tunnel` | optional: opens a local address to the running prototype for this agent's own browser (the public addresses need a person's sign-in) | `{"url": "http://localhost:…"}` |
| `untunnel` | closes it | — |
| `down` | optional cleanup before the Environment is deleted | — |

A profile without `bin/env` gets variants and specs, no live prototype; the card says so.

## A repository without a profile

1. `design repo detect <repo>` proposes the style part; show the operator a few lines and
   save what they confirm (`design repo save`).
2. Without `boundary`, no live prototype: triage still runs, variants still work, and the
   spec carries the whole change. Say this once on the Desk's first request card.
3. Offer the operator to draft `.design-desk/<name>/` for the product team as a pull request
   on their repository — only when they ask, and only as a draft they review.
