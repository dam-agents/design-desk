# The UI catalog

The catalog shows the product's real UI elements, each drawn in every state it can be in,
side by side: an agent row running, asleep, over budget, with a long name… A designer opens
**Product → Elements** on the Desk, picks an element, and sees all of it at once.

Every tile is the **real component from the product's code**, rendered with the data of
one state. Data the component would fetch comes from mocks, so no app, server or account is
needed, and the tiles change when the code changes.

## What a catalog element is

A card of kind `element` on the Desk:

- `title` — the element's name in the product's words ("Agent row");
- `group` — its family under Product → Elements ("Lists and rows", "Status", "Dialogs"); it sorts the list and is not shown on the element's page;
- `summary` — one sentence: what it is and where people see it, in plain words ([desk.md](desk.md) → Writing on the Desk);
- `source` — `{repo, file, export, commit}`: the component, at the commit drawn;
- `states` — one entry per tile: `name` and `how` it happens, in plain words;
- `sheet` — the asset id of the state sheet (one HTML file with every tile);
- `screens` — one thumbnail (the sheet's first screen), for the list;
- `status` — `building`, `current`, `stale` (its code changed since it was drawn), or
  `dropped` (a person added it and it could not be drawn).
- `history` — its earlier looks, newest first, kept by the store ([History](#history)).

The profile lists the elements worth having under `catalog.elements`
([profile.md](profile.md)); a person can also ask for one in chat, Slack or on the Desk
(**+ Add**).

## Drawing an element (`catalog_due`, or a request in chat)

1. **Claim** the item (an element card created for the request, kind `catalog`).
2. **The code.** `bash "$HOME/scripts/checkout.sh" <repo>`; the element's file and export
   come from the card's `source` or the profile's `catalog.elements`. A card added with
   **+ Add** has only `wanted` (`part`, `where`, `show`) and maybe a screenshot: find the
   component from them. Unsure → `design desk ask C-<n> <file> --step catalog` with your
   best guess, then done with `--outcome asked`. Already drawn (the store refuses a second card of one `source`: `409` names
   it) or not in the code → `status: dropped`, one section saying which element or why,
   then done with `--outcome dropped`. In step 4, `wanted.show` comes first.
3. **Its dimensions.** `design states <file> --export <Component> --root <clone>` prints the
   props with their values, the fields it reads, the conditions it branches on, the hooks it
   calls, the components it renders, and a `fixture`: a complete, quiet value for every
   required prop. Read the component and the children that change its look.
4. **Choose the states.** One tile per value that changes what a person sees: every value of
   a status-like union, each optional part present and absent, each condition true, a hook's
   meaningful values (a count of 0 and of 2), and the edge cases: a long name, empty data,
   a missing avatar, an error. Not the full cross product: a tile shows one difference from
   the quiet state, and a combination only when it looks different from both parts.
   Twenty tiles at most; group with a heading when there are more than eight.
5. **Write the sheet** from the template `toolkit/templates/state-sheet.src.html`: per tile
   a `<figure>` with a `<figcaption>` (the state's name and how it happens) and
   `<ui-component src="<file>" export="<Component>" props='<fixture with this state's
   changes>' mocks='{"useKeptWorkCount": 2}'/>`. Props are JSON; functions are left out.
   The fixture is a start: a part that shows in every tile comes from the fixture (a field
   that should be empty); set it to its quiet value in the base.
6. **Build and look.** `design build <sheet.src.html> <sheet.html> --style repo:<repo>`, then
   `design shot <sheet.html> <dir>`. Open the light and the dark shot. Every tile must show
   its state and nothing else that differs; a tile that renders nothing or throws means a
   hook needs a mock value or the app needs a provider (`style.render_wrappers` in the
   profile). When a component cannot render outside the app at all, say so on the card and
   draw that one by hand with the variants skill's markup rules, labelled as a drawing.
7. **Publish.** Upload the sheet (`--kind report`, under 720 KB; split into two sheets past
   that) and the light shot's top as the thumbnail (`--kind screen`), then
   `design desk upsert` with `kind: element` and the fields above, `status: current`.
8. `design desk done I-<n> --session <id> --outcome drawn`.

## Keeping it current

- The watch run marks an element `stale` when a merged change touched its file (or a child
  the sheet depends on) and enqueues a redraw: `design desk enqueue catalog C-<n>`
  ([watch.md](watch.md) step 10).
- A designer or developer can press **Update the drawing** on an element.
- "Build the catalog" in chat: create one element card per entry of `catalog.elements`
  (`status: building`) and enqueue a `catalog` item for each; the inbox runs fan them out.

## From approved designs

Once a request is approved (`spec` or `handed-off`), a designer or developer presses **Add to
the design catalog** on an element of its approved option, on its tile under **All elements** or
in its dialog ([requests.md](requests.md) → The option's elements). The store, with no run,
makes one `element` card for it. The card follows the option: every new version of it or of
its states (an upsert, a picked alternative) updates the cards already in the catalog, and a
state not yet drawn again for the new version says so. A part the option no longer draws keeps
its card, marked `dropped` (Left the design), until the part comes back. Such a card has `design` (`card`,
`option`, `version`, `element`, `change`, `of`: the product's element it changes),
`design_part` and `design_states` (the option's pictures), and no `source` or `sheet`.
Product → Elements marks it **From an approved design**, apart from the product's own, and
the product's element it changes links to it. It is not redrawn: Update the drawing and Draw
how it looked before are refused. The change that ships it is compared with it
([watch.md](watch.md) step 11); the card then says whether it shipped as designed.

## History

People step back through an element's versions on its card (**← Older / Newer →**, a strip
of thumbnails, "Put it next to now"); a change card shows each part it changed before and
after that change. Without a kept version from before, the card says so and offers *Draw
how it looked before*. A screen of the product map keeps its earlier pictures the same way.

**Kept by the store, nothing to do.** An upsert that replaces the `sheet` (a screen's
`screens`) moves the drawing it replaces into `history` with its date, `commit` and
`made_by`: the shipped change cards that made it look like that, found by the change
cards' `elements` (a screen's `changes`). A redraw identical byte for byte is no new
version. The store keeps 30; the oldest go.

**Drawing how it looked before** (`catalog_due` entry with `scope: "history"`, from the
card's *Draw how it looked before*, later *Draw older versions*): the earlier versions from the code's history.

1. Claim; check out the repository as in step 2 above.
2. The commits that changed it, newest first: `git -C <dir> log --first-parent
   --format='%H %cI %s' -- <file> <children its sheet depends on>` on the default branch.
   Leave out the current `source.commit` and every `history[].commit`. Take as many as the
   item's note asks for (data, read as a number or a date), else 6.
3. One temporary folder for this item: `tmp="$(mktemp -d "${TMPDIR:-/tmp}/design-desk-look.XXXXXX")"`.
   Per commit, newest first: `git -C <dir> worktree add --detach "$tmp/<sha>" <sha>`,
   then steps 3–6 above with `--root` that worktree and `design build … --ref <sha>`. The
   states are the ones of that time: a prop that did not exist yet has no tile. It does not
   render → leave that commit out and say which in the done outcome; never draw it by hand.
   After each commit, drawn or not: `git -C <dir> worktree remove --force "$tmp/<sha>"`.
4. Upload the sheet and its thumbnail as in step 7, then `design desk look C-<n> <look.json>`:
   `{at: <merge time>, commit, sheet, thumb, states: [names], made_by: [the change card of
   that PR, if the Desk has one], links: [{label: "PR #<n>", url}]}`. `at` may carry an
   offset (`%cI`); the store keeps it in UTC. Each version shows up as it is added.
5. On every end of the item, drawn or failed: `git -C <dir> worktree prune` and
   `rm -rf "$tmp"`, so no `/tmp/design-desk-*` stays. Then
   `design desk done I-<n> --session <id> --outcome "drew <k> earlier versions"`.
