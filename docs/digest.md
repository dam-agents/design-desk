# The weekly digest

Once a week the team gets one page of what happened to the product's UX: what shipped,
what was asked and decided, what waits for a decision, how the votes went, and the themes
in what people said. It lands in **Product → History** on the Desk, one page a week, never in
New; and in Slack with `digest: slack`.

`design-desk-digest-weekly` runs it; its pre-flight (`preflight.sh digest`) reads the Desk's
own store and stays silent in a quiet week, or once the week's digest exists.

## The worklist

`period` (`2026-W44`), `dates` (the seven days it covers, `29 Oct – 4 Nov 2026`), and from
the last 7 days: `changes` (with a picture each, when it has one), `requests_new`,
`handed_off`, `waiting` (on the next call), `polls` (open, or closed this week with their
result) and `decisions`; from the last 30 days: `feedback`, the bugs,
automated test findings, comments, concerns and questions people left.

## Themes in the feedback

1. Group the feedback by what it is about (a screen, a concept of the product) and what
   bothers people, not by its words. A theme needs two pieces or more.
2. Per theme: a name in the product's words, how many pieces, one or two short quotes
   without names, the screens it is about, and the requests it already has.
3. A theme with three pieces or more, or with a high-severity test finding, and no request
   yet: file a proposal (`design desk request` with `type: proposal`, the theme as its
   problem, `from` the change or request it came out of when there is one, `origin: {channel:
   "agent", job: "digest", event: {label: "a theme in feedback, <dates>"}}`). It is not
   suggested for the next call.

## The card

`design desk upsert` with `kind: digest`, `period`, and:

- `title` — the worklist's `dates`, as is;
- `summary` — two sentences: the week in plain words;
- `sections`, each only with content: **Shipped** (each change's title, one line on what a
  person notices), **Decided**, **Waiting for a decision**, **Votes** (each with its result),
  **What people said** (the themes, most pieces first), **Coming up** (prototypes live,
  requests close to a decision);
- `screens` — up to four pictures of the week's changes, their "after" pictures first.

Refer to everything by its title, a card also by its number, which the Desk links
([desk.md](desk.md) → Links to an item); never another id, never a person's name from feedback.

## Slack (`digest: slack`)

One message in the bound channel (`send_channel_message`), with the week's most telling
picture attached:

"📰 *UX this week* — <summary>
• Shipped: <n> changes — <the two most visible titles>
• Decided: <n> · Waiting for a decision: <n>
• Themes in feedback: <the top one or two, with their counts>
The whole digest is on the Design Desk (C-<n>): <link>"

Then `design desk done` is not needed: the digest is not an inbox item. Back up `work/`.
