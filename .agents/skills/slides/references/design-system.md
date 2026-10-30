# Deck design system

A deck is a series of fixed 1920×1080 `<section>` slides in one HTML file, styled with inline
styles only and scaled to the viewport by a small script. The house style is flat and
typographic: large light headlines, a grey palette with a single accent, real content instead
of ornament. It suits product, research, strategy and technical talks alike.

Start from `design deck-new` — it writes the template with the scaffold, the scaler,
keyboard nav, print-to-PDF rules, and one built example of every layout, already in the
style's accent and fonts. Then replace the slides.

## Non-negotiables

- **1920×1080 per slide.** Every slide is `box-sizing:border-box; height:100%; overflow:hidden`.
- **Never put `display` on a `<section>`.** The scaler hides inactive slides with
  `#stage > section { display:none }`, and an inline `display:flex` on a section beats that rule
  — the slide then paints over every other slide, and the deck looks like the same slide
  repeated. Put the flex or grid on an inner `<div style="height:100%;display:flex;…">`.
  Centring and space-between layouts always need this wrapper. Check it first when a deck
  misbehaves: `rg -n '<section' deck.html | rg 'display:'` must return nothing.
- **Nothing below 24px.** 24px is the floor for *any* text — mono labels, chips, table cells,
  captions, footnotes. If content won't fit at 24px, cut content; never shrink type.
- **Inline styles only.** No classes, no framework. The only global CSS is the font `<link>`,
  a body reset, and the scaler/print rules already in the template. This keeps every slide
  independently editable and copy-pasteable.
- **No decoration.** No gradients, no `border-radius`, no icons, no emoji, no shadows except
  on a screenshot or a floating panel, no borders except the 3px accent card rule and 1px
  hairline dividers. Nothing on a slide that isn't content.

## Type

One sans for everything, one mono for labels, identifiers, code and figures. The template
uses IBM Plex Sans / IBM Plex Mono; other good pairs in this idiom are Söhne + Söhne Mono,
Suisse Int'l + Suisse Mono, or National + Roboto Mono. Pick one pair and never mix a third.

| Role | Style |
|---|---|
| Section kicker | Mono 300, 24px, `letter-spacing:0.14em`, accent, uppercase — `03 / METHOD` |
| Slide title (h1) | Sans 300, 60px, `line-height:0.94`, `letter-spacing:-0.02em`, ink |
| Deck title | Sans 300, 96–120px, `line-height:0.92`, `letter-spacing:-0.03em` |
| Standfirst | Sans 400, 28px, `line-height:1.25`, secondary, max-width ~1200px |
| Card / point heading | Sans 400, 30–32px, ink |
| Body | Sans 400, 24px, `line-height:1.3`, secondary |
| Card label | Mono 300, 24px, `letter-spacing:0.1em`, accent |
| Big figure | Sans 300, 90–140px, `letter-spacing:-0.03em`, ink or accent |
| Mono data | Mono 400, 24px |

Set light weights (300) at display sizes and regular (400) at text sizes — never bold a
headline. Emphasise inside a sentence with color, not italics or weight:
`<em style="font-style:normal;color:#161616">`.

## Color

Five greys, one accent. Two backgrounds maximum across the whole deck (the light canvas and
the dark inverse). The template's palette is Carbon-derived; `design deck-new` swaps the accent
family (accent, accent muted, accent on dark, text on accent) for the saved brand's. The greys
stay — they carry the hierarchy. The table shows the Carbon values.

| Role | Template value | Use |
|---|---|---|
| Canvas | `#f4f4f4` | Slide background |
| Surface | `#ffffff` | Cards, panels |
| Ink | `#161616` | Primary text; the inverse background |
| Secondary | `#525252` | Body text |
| Tertiary | `#6f6f6f` | Mono meta, captions |
| Hairline | `#e0e0e0` | Chips, bar troughs, 1px dividers |
| Accent | `#0f62fe` | Kickers, card top rules, bars, primary button — nothing else |
| Accent muted | `#a6c8ff` | The idle/secondary state of an accent element |
| Accent on dark | `#78a9ff` | The accent fails contrast on ink; use this instead |
| Dark surfaces | `#262626` / `#393939` | Code block / secondary button inside a dark panel |
| Text on dark | `#c6c6c6` / `#8d8d8d` | Body / mono meta on an ink background |
| Text on accent | `#d0e2ff` | Secondary line inside a filled accent band |

The accent is for *one* thing per slide. If two elements are both accent-colored and both
compete for attention, one of them is decoration.

## Geometry

Slide padding `77px 88px 0`. Vertical rhythm: title 32px under the kicker, standfirst 26px
under the title, main content 64–96px under that. Gaps: 24px inside a card group, 30–32px
between stacked points, 64–80px between a visual and its text column. Fixed columns for a
visual (660–960px) with the text column taking `1fr`.

## The repeated components

Use these verbatim rather than inventing another container. The card and the point carry most
decks; the row and the meta strip exist so reference content doesn't get forced into cards.

**Card** — surface, 3px accent top rule, mono label, heading, body:

```html
<div style="background:#fff;border-top:3px solid #0f62fe;padding:36px 34px 40px;min-height:300px">
  <div style="font-family:'IBM Plex Mono',monospace;font-weight:300;font-size:24px;letter-spacing:0.1em;color:#0f62fe">01</div>
  <div style="font-size:32px;margin-top:14px">Heading as a claim</div>
  <div style="font-size:24px;line-height:1.3;color:#525252;margin-top:14px">One or two sentences of mechanism or evidence.</div>
</div>
```

**Point** — a 3px accent stem, then heading + body. Stack exactly three, `gap:30px`:

```html
<div style="display:flex;gap:24px;align-items:flex-start">
  <div style="flex:0 0 3px;align-self:stretch;background:#0f62fe"></div>
  <div>
    <div style="font-size:30px">Heading as a claim</div>
    <div style="font-size:24px;line-height:1.3;color:#525252;margin-top:8px">The supporting detail.</div>
  </div>
</div>
```

**Row** — a mono term and its plain-language description, hairlines above and below. Use for
reference content that would be dishonest as a card, because the items are a list and not an
argument. Four rows maximum:

```html
<div style="height:1px;background:#e0e0e0"></div>
<div style="display:grid;grid-template-columns:260px 1fr;gap:24px;padding:22px 0 24px">
  <div style="font-family:'IBM Plex Mono',monospace;font-size:24px">api-server</div>
  <div style="font-size:24px;line-height:1.3;color:#525252">What it is, in one sentence.</div>
</div>
<div style="height:1px;background:#e0e0e0"></div>
```

**Meta strip** — three label/value pairs pinned to the base of a slide, above a hairline. It
answers the questions the audience would otherwise interrupt with, so the body stays clean.
Absolute so it holds the same baseline on every slide that uses it:

```html
<div style="position:absolute;left:88px;right:88px;bottom:70px">
  <div style="height:1px;background:#e0e0e0"></div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:40px;margin-top:24px">
    <div>
      <div style="font-family:'IBM Plex Mono',monospace;font-weight:300;font-size:24px;letter-spacing:0.1em;color:#6f6f6f">CADENCE</div>
      <div style="font-size:26px;margin-top:10px">Three times a week</div>
    </div>
    <!-- two more -->
  </div>
</div>
```

## The slide layouts

Fifteen layouts. Pick by what the content *is* — the table below is the fast path — and vary
them across a run: never three card slides consecutively. The template has one built example
of each, in this order.

| The content is | Use |
|---|---|
| A linear process, 3 steps | Three cards, numbered |
| A closed set of 4 (services, interfaces, quarters) | Four cards |
| 4 facets in no order | Quadrant |
| A list of terms needing definitions | Spec rows |
| A whole taxonomy — object plus what attaches to it | Register |
| A path a request takes | Flow |
| 3 ordered buckets of intent | Horizon |
| What happens on which day | Cadence rows |
| A number, or 2–4 numbers | Figures |
| Something with state — chart, table, meter, UI | Artifact + points |
| A portrait screenshot | Visual split |
| A landscape screenshot | Wide visual |
| A verbatim command, dialog or terminal | Dark panel |
| Somebody's actual words | Quote |
| The turn in the argument | Statement |

1. **Title** — deck title at 96–120px on the canvas, kicker above, one line of context and a
   date below. Wrap the flex in an inner div (see the non-negotiables).
2. **Title dark** — the ink variant, for a deck that opens cold to an unfamiliar room. One
   accent word inside the headline is the only color on the slide; a hairline and a mono
   footer line close it. Choose one title style and don't ship both.
3. **Section divider** — the only other slide type that may use the ink background. Large
   section number in mono accent, section name at title size. Keeps a long deck legible.
4. **Statement** — one sentence at 72–90px, nothing else. Use for the turn in the argument.
   At most two or three in a deck; they lose force by repetition.
5. **Three cards** — full-width title block, then `grid-template-columns:repeat(3,1fr);gap:24px`.
   Number the cards `01 02 03` when they're a sequence. The layout for a linear process.
6. **Four cards** — `repeat(4,1fr)`, `min-height:290px`, two lines of body per card and no mono
   label. Only for a genuinely closed set — four services, four interfaces, four quarters —
   where dropping one would be a lie. A footnote line under the grid takes the caveat that
   would otherwise force a fifth card. If any card needs three lines, go back to three cards.
7. **Visual split** — a 47%-wide text column (kicker, title, standfirst, three points) with an
   image absolutely positioned right. Full-bleed portrait crop:
   `left:1064px;top:56px;width:758px;height:968px` + `object-fit:cover`. If the image's own
   aspect matters, frame it on surface and use `object-fit:contain`. Shadow
   `0 18px 96px rgba(51,51,51,0.42)`.
8. **Wide visual** — for a landscape screenshot that portrait cropping would destroy. Title
   and standfirst at the top, a mono provenance note right, then the image full width at
   `height:544px` with `object-fit:cover`. No points — the image is the argument.
9. **Artifact + points** — something rendered in HTML on the left (fixed 900–960px), three
   points right. For anything with state: a table, a meter, a chart, a UI panel, a dialog.
10. **Figures** — two to four big numbers in a row, each with a mono label above and one line
    of source below. Never more than four; never a number without its unit and source.
11. **Spec rows** — two columns: an argument in prose left, four **rows** right under a mono
    column label. The one layout where the text column may run to two paragraphs. Use it when
    the audience needs the vocabulary before the next slide makes sense.
12. **Register** — the taxonomy slide. A 212px left rail of mono band labels, and one band per
    row: a full-width accent band for the primary object (with muted-accent chips for its
    variants), then bands of five, three and one cell. It is the densest layout in the set and
    earns that once per deck — it replaces the four card slides that would otherwise say the
    same thing. Keep every cell to a heading and one line.
13. **Flow** — three stages in a surface panel, `1fr 80px 1fr 80px 1fr`, accent `→` between
    them, a hairline, then one line naming what *enforces* the path. For a path a request
    takes through a system. Not for a process a person follows — that is numbered cards.
14. **Quadrant** — four points in a 2×2 with a hairline over each and `gap:70px 68px`. The grid
    says "facets"; numbered cards say "stages". Keep the four headings parallel in grammar.
15. **Horizon** — three columns for now / next / later, three items each at 28px, no dates. The
    accent fades across the columns — `#0f62fe`, `#a6c8ff`, `#e0e0e0` top rules — so commitment
    is visible in the color. This is the one licensed use of a second accent tint as meaning.
16. **Cadence rows** — labelled beats left (`MON` / `THU` / `FRI` as mono rows), three stems
    right for what it leans on, and a **meta strip** at the base. Use for anything that repeats
    on a rhythm.
17. **Dark panel** — a dialog, terminal, or code sample rendered on ink, three points right.
18. **Quote** — a 96px accent rule, the verbatim sentence at 60px, attribution in mono below.
    Never paraphrase on a slide set as a quote, and always name the source and date.
19. **Closing** — mirrors the title slide's rhythm: kicker top, a 4px accent rule, the ask at
    84px, then four link columns under hairlines, and a mono footer. The ask is a sentence, not
    "Thank you".

Build charts and diagrams as real HTML: bars are a hairline trough with an absolutely
positioned accent fill; tables are flex rows with `border-bottom:1px solid` hairline; a code
or data sample is mono on a dark surface. Avoid SVG illustration and never screenshot a chart.

### Density, and when a layout is the wrong one

The dense layouts — register, spec rows, cadence — exist because forcing reference content into
three cards makes you drop items or pad them. Two tests before you use one:

- **Could a card slide carry this honestly?** If yes, use cards. Density is a last resort.
- **Would the audience photograph this slide?** If yes, it is a reference slide and belongs in
  a dense layout. Reference slides do not need to be sayable — say the rail labels only.

At most two dense layouts per deck, and never two adjacent. A dense slide following a statement
slide reads as evidence; two dense slides in a row read as a document.

## Writing the slides

The words carry the deck; the layout only arranges them.

- **The title is the claim, not the topic.** "Retention breaks in week two, not month six."
  — not "Retention". If a reader learns nothing from the title alone, rewrite it. Titles are
  sentences, sentence case, with a period.
- **The standfirst says what it is and why it matters**, in one sentence, in the audience's
  own words.
- **Three points, never five.** Each heading is itself a claim; each body is one or two
  sentences of mechanism or evidence. Reach for the specific: a named number, a real
  constraint, the thing that would surprise the audience. Four is allowed only in the layouts
  built for it — four cards, quadrant, spec rows — and only when the set is genuinely closed.
- **Every claim traceable.** Work from the source material — the doc, the repo, the dataset,
  the transcript — and lift the detail from it. When you can't verify something, leave it off
  rather than filling the card. Never invent a metric to make a slide look complete.
- **Cut the register.** No "seamlessly", "powerful", "leverage", "unlock", "game-changing".
  Em dash for the turn in a sentence. Numbers as digits, with units.
- **Speaker notes carry the rest.** Put the spoken version in `data-speaker-notes` on the
  section — 2–3 sentences of what you'd say that isn't on the slide. It's where detail that
  didn't earn a place on the slide belongs.

## Before you finish

`design deck-check deck.html` runs the mechanical ones — display on a section, type under 24px,
a font CDN, content past the slide edge — and must report no problems. Then the judgment ones:

- **No `display` on any `<section>`** — the whole deck renders as one repeated slide otherwise.
- No `font-size` under 24px anywhere in the file.
- Every slide's content clears its 1080px box — nothing clipped, no scrollbar at any zoom.
- The deck opens on slide 1. Strip any `#8` left in the URL before judging a render, and don't
  write the hash on navigation — a stale hash makes a working deck look broken.
- Every title states a claim. Three points or three cards, unless the layout is one of the four
  that takes four and the set is closed.
- One accent color, used for one thing per slide; at most two background colors in the deck.
- Layouts vary from slide to slide; at most two dense layouts, never adjacent; section dividers
  break up anything over ~12 slides.
- Image paths resolve and every `alt` describes what the image shows.
