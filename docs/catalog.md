# The UI catalog

The catalog shows the product's real UI elements, each drawn in every state it can be in,
side by side: an agent row running, asleep, over budget, with a long name… A designer opens
the **Catalog** tab on the Desk, picks an element, and sees all of it at once.

Every tile is the **real component from the product's code**, rendered with the data of
one state. Data the component would fetch comes from mocks, so no app, server or account is
needed, and the tiles change when the code changes.

## What a catalog element is

A card of kind `element` on the Desk:

- `title` — the element's name in the product's words ("Agent row");
- `group` — its family on the Catalog tab ("Lists and rows", "Status", "Dialogs");
- `summary` — one sentence: what it is and where people see it;
- `source` — `{repo, file, export, commit}`: the component, at the commit drawn;
- `states` — one entry per tile: `name` and `how` it happens, in plain words;
- `sheet` — the asset id of the state sheet (one HTML file with every tile);
- `screens` — one thumbnail (the sheet's first screen), for the list;
- `status` — `building`, `current`, or `stale` (its code changed since it was drawn).

The profile lists the elements worth having under `catalog.elements`
([profile.md](profile.md)); a person can also ask for one in chat, Slack or on the Desk.

## Drawing an element (`catalog_due`, or a request in chat)

1. **Claim** the item (an element card created for the request, kind `catalog`).
2. **The code.** `bash "$HOME/scripts/checkout.sh" <repo>`; the element's file and export
   come from the card's `source` or the profile's `catalog.elements`.
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
- A designer can press **Redraw from the current code** on an element.
- "Build the catalog" in chat: create one element card per entry of `catalog.elements`
  (`status: building`) and enqueue a `catalog` item for each; the inbox runs fan them out.
