---
name: impact
description: >-
  For a UI change, shipped or proposed, find everywhere the same thing shows up — not only
  the same component, but every place people meet the same data or idea: other screens, the
  command line, Slack or email messages, documents — and what a change to it touches,
  grounded in earlier decisions. Writes the "Where else this shows up, and what it touches"
  section of a Desk card, or answers in chat. Use for every change card and every request
  before its options, and when someone asks "where else is this?" or "what would this
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

- `design desk decisions --concept "<concept>"` — what the team decided before, with sources.
- The pull requests that last changed each place, their `author-decisions` blocks, the issues
  they close, and the architecture pages the profile's `docs.architecture` names.
- For each place, say what a change would do to it: words that would stop matching, a colour
  whose meaning would change, a rule that would be broken, a test that asserts the old text.

A decision without a source is not a decision here: write what you found and where, or leave
it out.

## 4. Write it

On a card, one `design desk upsert` with:

```json
{"id": "C-12", "impact": {
  "concept": "an agent's weekly spend",
  "places": [{"where": "Agents list", "how": "the amount on each row, amber near the limit", "kind": "screen"},
             {"where": "Slack spend alert", "how": "“Agent X reached its spend limit”", "kind": "message"}],
  "affects": [{"what": "The spend alert", "why": "it says “near its limit”; a different word in the list would make them disagree",
               "source": {"label": "pull request #5810", "url": "https://github.com/…"}}],
  "decisions": [{"text": "Spend limits reset every Monday (UTC) for everyone.", "when": "2026-09-14",
                 "source": {"label": "pull request #5810", "url": "https://github.com/…"}}]}}
```

`kind` is one of `screen`, `component`, `message`, `email`, `document`, `other`. At most 30
places, 20 effects, 20 decisions; the most important first.

In chat, the same three lists in plain words.

## 5. Keep the decisions

A decision you found that the Desk does not know yet, with its source, is recorded once:
`design desk decision <file>` with `{concepts, text, why, source, at}`. Approved designs and
the outcomes of the next call are recorded the same way (docs/handoff.md, docs/desk.md), so
the next analysis starts from them.
