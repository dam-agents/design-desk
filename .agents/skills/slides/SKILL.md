---
name: slides
description: >-
  Build a presentation deck as ONE self-contained HTML file in a flat, typographic, editorial
  style — 1920×1080 slides, one accent color, no decoration — in the saved brand's colors and
  fonts or IBM Carbon's, with a PDF export. Use for any slide deck, talk, pitch, review,
  readout or playback, on any subject, from notes, documents, a repo, data or a conversation.
---

# Slides

A deck is a series of fixed 1920×1080 `<section>` slides in one HTML file, inline styles only,
scaled to the viewport by a small script, navigable by keyboard, printable to PDF one slide per
page. The house style is flat and typographic: large light headlines, greys with a single
accent, real content instead of ornament.

The full design system — type scale, palette roles, geometry, the four components, the
nineteen layouts with a pick-by-content table, the writing rules — is in
[`references/design-system.md`](references/design-system.md). **Read it before the first slide.**

## 1. Start

```bash
design deck-new work/output/<slug>/deck.html            # the saved brand, else Carbon
design deck-new work/output/<slug>/deck.html --style carbon
```

This copies the template with one built example of every layout, re-colored to the style's
accent family and with its fonts inlined (nothing loads from a font CDN). Delete the layouts you
don't need, duplicate the ones you do, edit in place.

## 2. Plan before you build

Write the outline first: one line per slide — its claim (the title) and its layout. Show it to
the user for anything over ~6 slides, or when the source material leaves the argument open.
A deck is an argument: the titles alone, read in order, should tell the story.

## 3. Build

Follow `references/design-system.md` exactly. The rules that break decks most often:

- **Never put `display` on a `<section>`** — the slide then paints over every other one. Layout
  goes on an inner `<div style="height:100%;display:flex;…">`.
- **Nothing below 24px**, any text. Content that doesn't fit gets cut, never shrunk.
- **One accent, one job per slide.** At most two background colors in the deck.
- **The title states the claim, not the topic.** Every claim traceable to the source; missing
  evidence means cutting the card, never inventing a number.
- Speaker notes in `data-speaker-notes` on each section.
- Images: embed as `data:` URIs, or keep them in an `assets/` folder beside the deck **and** say
  that the folder must travel with it. An artifact is one file, so for publishing, embed.

## 4. Check, look, export

```bash
design deck-check deck.html          # display-on-section, sub-24px type, font CDNs, overflow
design deck-pdf deck.html deck.pdf
```

Screenshot a few slides (`design shot deck.html shots/ --width 1920 --height 1080` captures slide
1; add `?slide=N` to the path for others) and look at them. Then a `copy` pass over every title
and body line.

Deliver per docs/requests.md → **Chat and Slack**: the `.html` as a private artifact (it presents in the
browser: arrow keys, `?slide=4` deep-links), the PDF as a second artifact when asked or when the
user will present from elsewhere.
