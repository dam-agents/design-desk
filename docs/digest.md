# The weekly digest

Once a week the team gets one page of what happened to the product's UX: what shipped,
what was asked and decided, what waits for a decision, how the votes went, and the themes
in what people said. It lands in **Product → History** on the Desk, one page a week, never in
Changes; and in Slack with `digest: slack`.

`design-desk-digest-weekly` runs it; its pre-flight (`preflight.sh digest`) reads the Desk's
own store and stays silent in a quiet week, or once the week's digest exists.

## The worklist

`period` (`2026-W44`), `dates` (`29 Oct – 4 Nov 2026`: the seven whole UTC days up to
yesterday), and from those days: `changes` (each with its "after" picture, when it has one; its "before"
picture is on its card), `requests_new`,
`handed_off`, `waiting` (on the presentation), `polls` (open, or closed this week with their
result), `decisions` (with author and conflicts) and `revoked`; from the last 30 days: `feedback`, the bugs,
automated test findings, comments, concerns and questions people left.

## Themes in the feedback

1. Group the feedback by what it is about (a screen, a concept of the product) and what
   bothers people, not by its words. A theme needs two pieces or more.
2. Per theme: a name in the product's words, how many pieces, one or two short quotes
   without names, the screens it is about, and the requests it already has.
3. A theme with three pieces or more, or with a high-severity test finding, and no request
   yet: file a proposal (`design desk request` with `type: proposal`, the theme as its
   problem, `from` the change or request it came out of when there is one, `origin: {channel:
   "agent", job: "digest", event: {label: "a theme in feedback, <dates>"}}`).

## The card

`design desk upsert` with `kind: digest`, `period`, and:

- `title` — the worklist's `dates`, as is;
- `summary` — two sentences: the week in plain words ([desk.md](desk.md) → Writing on the Desk);
- `sections`, each only with content: **Shipped** (each change's title, one line on what a
  person notices), **Decided** (each decision by its number and who decided it; the ones
  revoked this week too, with why), **Waiting for a decision**, **Votes** (each with its result),
  **What people said** (the themes, most pieces first), **Coming up** (prototypes live,
  requests close to a decision);
- `screens` — up to two before/after pairs, of the week's most visible changes. A pair is two
  pictures with `stage: "before"` and `stage: "after"` and one `pair` name, in the product's words
  for the screen; the Desk draws them side by side under that name. Each pair on the card has its
  own name: the page draws one pair per name, so when two changes show the same screen, add the
  change's title to each (`<screen> — <change's title>`). Take both from the change's
  card (`screens`), never one without the other. The two show the same screen at a similar size:
  a strip next to a whole screen misleads, so a change whose pictures do not match gets none.
  A caption starts in lower case, because the page puts Before and After in front of it, and says
  what is different, not what the screen is.

Refer to everything by its title, a card or a decision also by its number, which the Desk links
([desk.md](desk.md) → Links to an item); never another id, never a person's name from feedback.

## Slack (`digest: slack`)

One message in the bound channel (`post`), with the week's most telling
picture attached, its titles and themes escaped ([desk.md](desk.md) → Links to an item, Text to Slack):

"📰 *UX this week* — <summary>
• Shipped: <n> changes — <the two most visible titles>
• Decided: <n> · Waiting for a decision: <n>
• Themes in feedback: <the top one or two, with their counts>
The whole digest is on the Design Desk (W-<n>): <link>"

Then `design desk done` is not needed: the digest is not an inbox item. Back up `work/`.
