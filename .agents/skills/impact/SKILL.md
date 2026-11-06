---
name: impact
description: >-
  For a UI change, shipped or proposed, find everywhere the same thing shows up — not only
  the same component, but every place people meet the same data or idea: other screens, the
  command line, Slack or email messages, documents — and what a change to it touches,
  grounded in earlier decisions. Writes the "Where else this shows up, and what it touches"
  section of a Desk card, or answers in chat. Use for every change card, for every request
  ahead of its options unless the request switched impact off, and when someone asks "where else is this?" or "what would this
  affect?".
---

# Impact

The `impact` action ([docs/actions.md](../../../docs/actions.md)).
It answers two questions a designer asks before changing anything: where else does the same
thing appear, and what would a change here touch?

## 1. Name the thing, not the component

Write in one phrase what the element shows, in the product's words: "an agent's weekly
spend", "whether an agent is asleep", "who can open an artifact". That phrase is the
`concept`. The same concept can look different in each place: a chip in a list, a number on
a page, a sentence in a Slack alert, a column in the command line.

## 2. Find the places

In the product's clone (`bash "$HOME/scripts/checkout.sh" <repo>`):

```bash
design where <element file> --export <Component> --root <clone> --words "<the words people read>, <their synonyms>"
```

It lists every file that uses the same data (the element's prop types, hooks and fields) or
the same words, with what kind of place it is (screen, component, message, command line,
document) and the screen it belongs to. Add `--field <name>` when the change is about one
data point of a larger object.

Then read, do not count:

- Keep a place when a person meets the same concept there. Drop a file that only passes the
  data through.
- Name each place as a person finds it ("Home → the week's total"), never as a file path.
- Look beyond the code `design where` reads: the product's glossary (the profile's
  `docs.glossary`), its documentation, the catalog's elements (`design desk cards --kind
  element`), and the messages other systems send (an alert, an email).

## 3. Find what it touches, from earlier decisions

- `design desk decisions --concept "<concept>"` — what the team decided before, with who and
  where; a revoked one no longer binds.
- The pull requests that last changed each place, their `author-decisions` blocks, the issues
  they close, and the architecture pages the profile's `docs.architecture` names.
- For each place, say what a change would do to it: words that would stop matching, a colour
  whose meaning would change, a rule that would be broken. A test that checks the old text is
  noted for the spec, not shown here.

A decision without a source is not a decision here: write what you found and where, or leave
it out.

## 4. Write it

**For a designer, not a developer.** Every `how`, `what` and `why` is read by someone who does
not read code. Write each one like a short note to a colleague:

- **Plain and informal.** Say what a person sees and what would go wrong for them: "If you
  rename it here, the alert still says the old word." Not: "the alert's copy is hard-coded".
- **Explain, do not list.** One short sentence that says why it matters, at most about 20
  words. Lead with the effect on the people using the product.
- **No code words.** No files, components, props, fields, hooks or tests. A test that checks
  the old text is a developer's to-do: it goes in the spec, not here.
- **Only what a designer can act on.** Leave out an effect that only a developer would notice.

On a card, one `design desk upsert` with:

```json
{"id": "C-12", "impact": {
  "concept": "an agent's weekly spend",
  "places": [{"where": "Agents list", "how": "the amount on each row, amber near the limit", "kind": "screen"},
             {"where": "Slack spend alert", "how": "“Agent X reached its spend limit”", "kind": "message"}],
  "affects": [{"what": "The spend alert in Slack", "why": "it says “near its limit”; use other words in the list and the two stop agreeing",
               "source": {"label": "pull request #5810", "url": "https://github.com/…"}}],
  "decisions": [{"id": "D-7", "when": "2026-09-14"},
                {"text": "Spend limits reset every Monday (UTC) for everyone.", "when": "2026-09-14",
                 "source": {"label": "pull request #5810", "url": "https://github.com/…"}}]}}
```

`kind` is one of `screen`, `component`, `message`, `email`, `document`, `other`. A place that
is a screen or a part in Product (`design desk cards --kind screen`, `--kind element`) carries
its `card` id, and the page opens it from there. A screen with no card yet: leave `card` out;
the store links the screen of that name, or adds a card the next run draws
([map.md](../../../docs/map.md) → A screen someone added). A decision on the Desk is cited by its `id`;
one found elsewhere by its words and source. At most 30
places, 20 effects, 20 decisions; the most important first.

In chat, the same three lists in plain words.

## 5. Keep the decisions

A decision you found that the Desk does not know yet, with who made it and where, is recorded
once, and the card is checked against the decisions in force (`conflicts`, `decision_check`):
docs/desk.md → Decisions → The check.
