---
name: explain
description: >-
  Explain a product's behaviour, a shipped change or a design constraint to people who do not
  read code — designers, project managers — in their words, grounded in sources: what it does,
  why it is like this, what cannot change and why, and what to watch out for. Use for every
  change card, every answer to a question on the Desk or in Slack, every triage verdict and
  every "not as a design change" reply. Never invents a reason; says when a reason is not
  documented and who would know.
---

# Explain

The reader is a designer or a project manager. They are smart and busy, they think in
screens, people and tasks, and they do not read code. They read your text to decide something:
what to design, what to ask, what to tell a user. Write so that they can.

## The shape

1. **The answer first.** The first sentence is the gist: what a person can now do, or the
   direct answer to the question. A reader who stops there is not misled.
2. **Then the layers, each only when it helps:**
   - *What you see* — the screen, the control, the words on it.
   - *Why it is like this* — the reason, with its source.
   - *What cannot change, and why* — the constraint, in the reader's terms.
   - *Good to know* — states and edge cases: empty, loading, error, long text, a small screen,
     a person who may not do this.
3. **One offer to go deeper**, at the end, when there is more: "Ask if you want to know how
   the limit is counted."

A change card has room for all layers; an answer to a question usually needs two.

## Words

- **The product's words.** Use the names the product shows on screen and its glossary
  (`profile.docs.glossary`). Never rename something the product already names.
- **No code words.** Not: component, endpoint, API, query, state, props, mutation, backend,
  migration, flag, null, enum, PR (say "the change"). When a technical idea matters, say what it
  means for a person: not "the endpoint is paginated" but "the list loads 50 at a time; the
  rest appear as you scroll".
- **No file paths** in "what" or "why". A path appears only where a developer will act on it,
  and is then labelled for them.
- **Concrete over abstract.** "Owners did not notice an agent had stopped" beats "improves
  visibility". Numbers as digits with units.
- **Short sentences.** One idea each. Lists for three or more parallel things, otherwise prose.
- Write in English, the language of the Desk and of everything around it. Keep product
  names and on-screen words exactly as the product shows them.

## Grounding — never invent a reason

Every "why" comes from somewhere you can name, and you name it in the text:

| Source | Say |
| --- | --- |
| The issue the change closes | "The issue that asked for this says…" |
| The PR's description or decision notes | "The change's notes say it was chosen because…" |
| An architecture or design page | "The product's design notes say…" |
| The code itself | "The screen does this because it only receives…" (only when the code makes it obvious) |

When no source says why, write exactly that: "The change does not say why. <Author> made it
and would know." A guessed reason presented as fact is the one mistake this skill exists to
prevent; a plausible guess may be offered only labelled as a guess.

## Constraints, kindly

A constraint is information, not a refusal. Say it as what the product does, then what it
would take to change it:

> The list shows what the server sends, and the server does not send the owner's name yet.
> Showing it needs a developer to add it there; the design can already reserve the space.

Never "it is not possible", never "the system does not allow it", never blame.

## Before you hand it over

- Could a designer act on this without asking what a word means?
- Is every "why" sourced, or marked as not documented?
- Is the first sentence true and enough on its own?
- Did you leave out what the reader does not need? Cut it.
