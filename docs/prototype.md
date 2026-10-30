# Live prototypes

A live prototype is the real product with only its look changed: a branch of the product
with the approved design, guarded ([boundary.md](boundary.md)), installed on its own
**Environment** with demo data, which everyone on the owner's list opens and clicks through.

An Environment is a sandbox this agent creates and owns: its own machine, its own addresses,
an access list, an expiry, and no credentials of the agent. The platform tools are
`create_environment`, `list_environments`, `update_environment`, `wake_environment` and
`delete_environment`; they exist only while the owner has the Environments feature on.

## Build (`prototypes_due`, a `build` item)

1. **Check.** Claim the item. The card's `triage.verdict` is `design` (the server refuses a
   build otherwise; re-check anyway). Count cards with `prototype.state` `live` or
   `building`: at `max_prototypes`, answer on the card with a comment naming the
   prototypes that hold the places and stop (`done --outcome "no free place"`).
   `create_environment` missing from your tools → comment that the owner must turn on
   Environments, tell the operator, stop.
2. **Worktree.** `bash "$HOME/scripts/proto.sh" worktree C-<n> <repo>` → a checkout of the
   default branch on `design-desk/c<n>-<slug>`, printed as JSON with its path and base.
   An existing worktree of the card is reused (an update).
3. **Change the code.** Implement the chosen direction — the variant with the most
   `prefer` votes from designers, or the one the request's comments settled; ask in a
   comment when it is a tie — in the product's own components, styles and copy, following
   the profile's `PROFILE.md`. Touch only the paths `boundary.allow` admits.
   Commit on the branch (`git -C <worktree> commit -am "design: <title>"`, identity
   `Design Desk <design-desk@users.noreply.github.com>`).
4. **Guard.** `design guard <worktree> --base <base> --profile <profile.json> --patch
   /tmp/design-desk-c<n>/prototype.patch > /tmp/design-desk-c<n>/guard.json`. Not `ok` →
   [boundary.md](boundary.md) → When the guard refuses. Upload the report and the patch
   (`--kind report`, `--kind patch`) and set `prototype: {state: "building", guard: {ok,
   summary, asset}, branch, base}` and `status: prototype`.
5. **Environment.** `create_environment` with `name` = `c<n>`, the profile's
   `engine.endpoints`, `storage`, `start` when it names one, and `expires` =
   `<prototype_expiry_days>d`. An Environment of that name already there is reused.
6. **Install.** `bash "$HOME/scripts/proto.sh" run C-<n> up` **as a background task**
   (an install takes many minutes), then poll `proto.sh run C-<n> status` until it says
   `running` or `failed`. The profile's `bin/env up` installs the worktree into the
   Environment over the Environment Link (`ssh env-c<n>`) and seeds the demo data.
7. **Publish.** `list_environments` gives the endpoint address of `engine.open_endpoint`;
   `proto.sh run C-<n> credentials` gives the demo sign-in. Set `prototype: {state: "live",
   url, login: {user, password, hint}, env: "c<n>", expires, …}` and `status: testing`.
   Capture two or three screens of the changed screen through the Link
   (`design capture`, [watch.md](watch.md) step 6) and add them to the card's `screens`.
8. `done --outcome live`.

A failure at any step: `prototype.state: failed`, one comment on the card saying what did
not work in plain words, the technical detail in the events log, and the Environment kept
for the operator only when the operator is debugging it; otherwise delete it.

## Update

A `build` item on a card whose prototype is `live` is an update: the same worktree, the new
change, the guard again, then `proto.sh run C-<n> update` (the profile rebuilds only what
changed — for a UI change, the UI) instead of `up`.

## Expiry (`expiring_due`)

An entry names a live prototype expiring within a day. While its request is `testing` and a
person commented or voted in the last three days, extend it: `update_environment` with
`expires: <prototype_expiry_days>d`, then set `prototype.expires`. Otherwise let it expire
and set `prototype.state: expired` after the date; the patch and the guard report stay on
the card.

## Teardown (`teardowns_due`)

A closed request, or a handed-off one past its expiry: `proto.sh run C-<n> down` (when the
profile has it), `delete_environment`, `proto.sh remove C-<n>` (the worktree and its branch,
never the patch), `prototype.state: torn-down`. A pushed branch stays; it is the
developer's.

## Push (`prototype_remote` only)

With `prototype_remote` set, push the guarded branch there after step 4:
`git -C <worktree> push <remote-url> design-desk/c<n>-<slug>`, never another branch name,
never `--force` onto a branch a person changed. Without it, the patch on the card is the
prototype's record.
