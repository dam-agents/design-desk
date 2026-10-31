# The product map

**Product → Screens** on the Desk is a map of the product: every main screen with its
pictures, what it is for, how to get there, the parts it is made of, and why it is like it
is. A new designer or project manager learns the product from it in an hour; everyone sees
how a screen got its shape.

It lives on the screens instance ([screens.md](screens.md)), so it needs `screens: enabled`.

## A screen card

A card of kind `screen`, found again by its `path`:

- `title` — the screen's name in the product's words ("Agents list");
- `group` — the area it belongs to ("Agents", "Settings");
- `path` — its address in the product (`/agents`);
- `summary` — one or two sentences: what a person does here;
- `how` — how a person gets there, in their clicks: "Sidebar → Agents";
- `screens` — the current pictures, light and dark, `source: "instance"`;
- `elements` — the catalog elements on it (element card ids);
- `concepts` — the product's ideas it shows ("an agent's weekly spend"), in the glossary's
  words: the timeline "Why it is like this" lists the decisions about them;
- `changes` — the change cards that touched it, oldest first;
- `instance` — as on a change card, so people open the screen in the copy.

## Build it

Once, when the `main` instance first runs (onboarding, or the first watch after `screens`
is turned on), and again on request ("rebuild the product map"):

1. The screens: the profile's `screens` and `capture.routes`, then what the product's
   navigation shows (its sidebar and settings sections); at most 40, the most used first.
2. Per screen, a recipe that reaches it with the demo data a person would have after a
   week of use (two or three agents, one artifact, one schedule): `design capture … --recipe`,
   light and dark.
3. `how`, `summary`, `concepts` from the screen's code and the glossary; `elements` from the
   catalog cards whose component the screen renders.
4. `design desk upsert` with `kind: screen`; the store updates the card of the same `path`.

## Keep it current

After the watch installs a merged change on `main`, every screen card the change touched
gets its new "after" pictures and the change in `changes`; a screen the change added gets a
card; one it removed is marked `stale` with a section saying where it went.
