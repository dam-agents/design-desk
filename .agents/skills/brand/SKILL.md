---
name: brand
description: >-
  Capture a brand from whatever the user has — a logo, a screenshot of their product or site,
  an old deck (.pptx), a PDF, a stylesheet, font files, or just a color and a name — and save it
  as the style every variant, walkthrough, deck and video uses when there's no repo to read.
  Use when someone uploads brand material, says "use our colors / our logo / our font", asks to
  change or reset the brand, or when another skill finds no brand and the user wants one.
---

# Brand

A brand here is small on purpose: an accent color, an ink color, optionally a primary-button
color, a sans and a mono font, a corner radius, a logo, and a line of notes. That is enough to
make every deliverable look like the user's own; anything more is guessing.

## 1. Gather

Ask for whatever they have; any one is enough to start:

- **A deck** (`.pptx`/`.potx`) — the richest source: its theme and the colors and typefaces its
  slides actually use. Keynote, Google Slides, Figma, Sketch: ask for a `.pptx` or `.pdf` export,
  or screenshots.
- **A logo** (`.svg` best, else `.png`).
- **A screenshot** of their product or site.
- **A stylesheet** (`.css`) or design-token file.
- **Font files** (`.woff2`/`.ttf`/`.otf`) when the font isn't a free web font.
- **Or just words:** "our blue is #0b5fff and we use Inter".

Files uploaded in the chat land under `~/.uploads/<session>/`; images sent in Slack reach you
directly, but documents sent in Slack do not — ask for those through the chat upload.

## 2. Extract

```bash
design brand extract <file>... --name "<Brand>" > /tmp/brand.json
```

It reads, without guessing: the deck's theme (and, when the theme is the stock Office one, the
colors and fonts the slides actually use), the most-used non-neutral colors of an image, the
accent and font of a stylesheet, the fonts embedded in a PDF, the logo from a deck's slide
master. Each value comes with a `sources` line saying where it came from, and `checks` says
whether the accent is dark enough for text and buttons on white.

## 3. Confirm — never save a brand nobody looked at

Show the user, in a few lines: the accent (and where it came from), the ink, the fonts, the logo
file, the radius, and anything `sources` flagged. Then a quick visual: build a one-screen sample
in the draft brand (save the draft to a temp work dir first, or describe it) — a header with the
logo, a card, a primary and a secondary button, a link — and send the screenshot. Common fixes:

- **The accent is too light for text** (`usable_for_text: false`): keep it as the brand color for
  fills and pick a darker shade for buttons and links (`colors.primary`).
- **They want black buttons** (many brands do): `colors.primary` = the ink.
- **A font that isn't on Fontsource and no file was uploaded:** ask for the file, or pick the
  closest free font and say so.
- **Rounded or square:** `radius` — `"0.25rem"` is Carbon-square, `"0.5rem"` soft, `"0.75rem"` round.

## 4. Save

```bash
design brand save /tmp/brand.json
```

The shape (all but `colors.accent` optional):

```json
{
  "name": "Acme",
  "colors": { "accent": "#0b5fff", "ink": "#121619", "primary": "#121619",
              "background": "#ffffff", "canvas": "#f4f4f4" },
  "fonts": { "sans": "Inter", "mono": "JetBrains Mono",
             "files": [{ "family": "Acme Sans", "path": "/path/to/AcmeSans-Regular.woff2", "weight": 400 }] },
  "radius": "0.5rem",
  "logo": "/path/to/logo.svg",
  "notes": "Never put the logo on the accent color."
}
```

`save` copies the logo and font files into `work/brand/`, so the uploads can be deleted. One
brand at a time: saving again replaces it (say so before you do). From now on every build that
isn't in repo mode uses it; `default_style: carbon` in `work/CONFIG.md` switches back without
deleting it.

## Rules

- A brand is the user's; never infer one from a third party's site or product unless they ask
  for exactly that ("make it look like our partner's portal").
- Colors are `#rrggbb`. Never invent a palette the material doesn't show.
- The logo is used as given — never redrawn, recolored or cropped.
