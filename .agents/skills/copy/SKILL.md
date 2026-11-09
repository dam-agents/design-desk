---
name: copy
description: "Write and edit the words people read: UI copy (buttons, labels, empty states, errors, onboarding), announcements, slide text, video captions, docs, emails and posts. Use whenever a design needs words, when someone asks to rewrite, tighten or de-AI text, and as the last pass on every deliverable this kit makes. Prioritizes truth, specificity, plain words and the writer's own voice over polish."
---

# Copy

Every deliverable this kit makes ends with a copy pass. Prototypes take their existing words
from the product's source code (`variants` skill); only the new words are yours, and they
follow this file.

## UI copy, before anything else

- **Use the product's own nouns.** Read the repo's existing labels and docs first and reuse
  their words. Never rename a thing the product already names.
- **Buttons say what happens:** a verb and its object ("Create agent", "Delete 3 files"), never
  "OK", "Submit" or "Yes". A destructive button repeats the verb of the dialog's title.
- **Sentence case** for every label, title and button. No trailing period on a label or a
  button; a full sentence of helper text gets one.
- **An empty state says what will be here and the one action that fills it.** "No reports yet.
  Create one to share it with your team." — not "Nothing to see here!".
- **An error says what happened and what to do next**, in the user's terms, never a code alone.
- **Short beats complete.** If a label needs a tooltip to be understood, rewrite the label.
- **Numbers as digits, with units.** "3 files", "12 min", not "three files".

## Longer text

An announcement, a doc, an email, a post, slide text, or a request to rewrite, tighten or
de-AI a text: read [references/writing.md](references/writing.md) first — the general writing
method and its final check. The short texts of the Desk (cards, answers, replies) follow the
[`explain`](../explain/SKILL.md) skill instead.
