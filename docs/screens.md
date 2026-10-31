# Screens: the agent's own copy of the product

A change card shows what shipped, so it needs real screens of it.
When the pull request carries no pictures, Design Desk takes them on its **screens
instance**: its own install of the product in an Environment, with demo accounts and
made-up data, like the instance a developer agent runs for an issue.
People open the same instance from the card, try the change themselves, and add their own
screenshots.

Only with `screens: enabled`, a product profile with an engine (`bin/env`), and the
Environments feature on.

## The instances

| Instance | Environment | Shows | Lives |
| --- | --- | --- | --- |
| `main` | `screens` | the default branch, moved on to every merged UI change | always; it sleeps when idle and wakes on use |
| `pr<n>` | `screens-pr<n>` | an open pull request's head | until its screens are taken, or the pull request merges or closes |

At most `max_screen_prs` (`2`) `pr<n>` instances at a time; past that, an open pull
request's card gets its pictures when it merges.
`bash "$HOME/scripts/screens.sh"` does the mechanics; the platform tools make and delete the
Environments.

## Bring an instance up to date

1. **Environment.** `list_environments`; missing → `create_environment` with `name` from the
   table, the profile's `engine.endpoints`, `storage`, and `expires` at the platform's
   default. On every later use, `update_environment` moves `expires` on, so `main` never lapses.
2. **Install** as a background task: `bash "$HOME/scripts/screens.sh" sync <repo>` for
   `main`, `… sync <repo> --pr <n>` for an open pull request. It moves the instance's
   worktree to the head and runs the profile's `bin/env up`, which takes the images the
   product's registry already has and builds only what is missing: a merged commit of the
   default branch usually installs without a build. It never installs a commit twice, never
   moves `main` back, and answers `{"busy": true}` when another run is installing; then use
   what is there, or come back next run.
3. **Wait** for `screens.sh run <name> status` to say `running`. `unknown` is a check that
   failed: ask again later. `failed`: say so in the card's comment, log it, and fall back to
   the next source of screens.

## Take the screens

1. **The shot list.** From the pull request, its issue and the code, write what a person
   must see to understand the change: each screen and the state it needs, in the product's
   words, with the path it opens at (`profile.capture.routes` names the main ones).
   Example: "Agents list, one agent near its limit — create two agents; give one a weekly
   limit of $5 and spend $4.60; /agents". It goes on the card as `shotlist`, so a person can
   take the same pictures.
2. **The recipe.** Turn the list into a capture recipe ([`design capture`](../toolkit/bin/capture.mjs)):
   `setup` signs in and makes the data every shot shares; each shot's `steps` reach its
   state; `themes: ["light", "dark"]` when the change is about colour. Create what you need
   through the product's own screens, as a person would; the demo data is the instance's own,
   so anything goes, but never a real person's name or data.
3. **Capture.** `screens.sh run <name> tunnel` prints a local address (the public one needs
   a person's sign-in); `screens.sh run <name> credentials` the demo account. Then
   `DESK_DEMO_USER=… DESK_DEMO_PASSWORD=… design capture <url> <dir> --recipe <recipe.json>
   --login <profile.json>`, and `screens.sh run <name> untunnel`.
   A shot that reports `error` left a `-stuck.jpg`: look at it, fix the recipe, run that shot
   again; twice stuck, leave it out and say so in the shot list.
4. **Look** at every picture (Read it): a sign-in page, an error or an empty frame is not a
   screen of the change.
5. **Publish** each as a screen with `source: "instance"` and a one-line caption, and set the
   card's `instance`: `{url, login: {user, password, hint}, name, ref, commit, updated}`, the
   address of `engine.open_endpoint` from `list_environments` and the demo account. Keep the
   recipe under `work/output/screens/C-<n>/` for the next run.

## Screenshots people add (`screens_due`)

People add screenshots on a card with **Add screenshots**. For each new screen with
`source: "person"` and no caption:

- It shows the change → write its caption, keep `source` and `by`.
- It does not (another screen, an old version, a sign-in page) → take it off the card and
  answer in one comment who added what and why it was left out, in plain words.
- Then `design desk done I-<n> --session <id> --outcome checked`.

## Clean up

- A pull request merged or closed → `delete_environment screens-pr<n>`, then
  `screens.sh remove pr<n>`. The watch run does it when the ledger moves the pull request on.
- `screens: disabled` → delete both kinds and remove them.
- The weekly audit names an `screens-pr<n>` Environment whose pull request is no longer open.
