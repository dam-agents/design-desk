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

**A question asked in Slack, role first**: the asker's role from the email Slack holds for
their user id ([docs/desk.md](../../../docs/desk.md) → Roles, In Slack). Not on the roster →
the decline line of [docs/requests.md](../../../docs/requests.md) → Who Slack serves, no
answer from the code, and stop.

The reader is a designer or a project manager. They are smart and busy, they think in
screens, people and tasks, and they do not read code. They read your text to decide something:
what to design, what to ask, what to tell a user. Write so that they can.

This file is the one home of **how to write** what Design Desk itself tells people: the texts
[docs/desk.md](../../../docs/desk.md) → Writing on the Desk lists, which also says what the
Desk never shows (ids, status names). What a text holds and how long it may be is in its own
doc. The words inside a design or a deliverable are the [`copy`](../copy/SKILL.md) skill's.

## What goes in

A text answers the one question its reader has, and stops:

| Text | The reader asks | Form |
| --- | --- | --- |
| Change card, issue card | What is different for the people using it, and is there something for me to do? | one sentence, then one-line bullets |
| Research | Is anything in the way of this request? | the verdict in one sentence, then one labelled paragraph per finding |
| Triage reason, Slack reply | What was decided, and what happens next? | one or two sentences |
| Under the hood | Would the product have to work differently? | a short text, never a list |
| Answer, private ask | Their own question | the answer in one sentence, then the layers below |
| Digest | What happened this week, and what waits for a decision? | one line per item |
| Presentation brief | What do we decide, and between what? | three to six lines, the decision asked and its options last |
| Developer spec | What do I build? | its sections ([docs/handoff.md](../../../docs/handoff.md) step 2) |

- **Every sentence earns its place**: it changes what the reader does or knows. A sentence
  that only says nothing was found, nothing changed or that all is as usual is cut; where the
  reader must know that you looked, one sentence says it for all of them.
- **A summary never repeats its title.** The title says what a person can now do or see; the
  summary what is different from before, and for whom.
- **Say what is next** when the reader has something to do or to wait for: the step, and whose
  it is.
- **Bullets for parallel points**, one line and one idea each. **Prose where one thing leads
  to the next** (a reason, how something works). Never a paragraph that hides a list, never
  bullets that cut one thought in pieces.
- **Show it** when a picture says it faster: a screen for where something is or how it looks,
  a before and after for a change, a small diagram for three steps or more or a fork
  (`![caption](asset:A-<n>)`). Never for decoration.

## The shape of an explanation

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

A change card takes only the layers the reader acts on; an answer usually needs two.

## Words

- **The product's words.** Use the names the product shows on screen and its glossary
  (`profile.docs.glossary`). Never rename something the product already names.
- **No code words.** Not: component, endpoint, API, query, state, props, mutation, backend,
  migration, flag, null, enum, PR (say "the change"). When a technical idea matters, say what it
  means for a person: not "the endpoint is paginated" but "the list loads 50 at a time; the
  rest appear as you scroll". A term the reader may not know gets a few words of explanation
  the first time.
- **No file paths** in "what" or "why". A path appears only where a developer will act on it,
  and is then labelled for them.
- **Concrete over abstract.** "Owners did not notice an agent had stopped" beats "improves
  visibility". Numbers as digits with units.
- **Short sentences.** One idea each, as you would say it to a colleague at their desk.
- **Each thing once.** Leave out what a picture already shows and what only a developer needs
  (API, internals, review history).
- Write in English, the language of the Desk and of everything around it. Keep product
  names and on-screen words exactly as the product shows them.

## Examples

| Text | Not | But |
| --- | --- | --- |
| Summary under the title "See why an agent stopped" | "Adds the stop reason to the Agents list so people can see why an agent stopped." | "A stopped agent used to look like a sleeping one; its row now says why it stopped." |
| A card's "why" bullet, its `source` "the issue #12" | "The issue that asked for this says that owners did not notice an agent had stopped." | "Owners did not notice an agent had stopped." |
| Research | "Already asked for: none found. Where it lives: the Agents list. History: … In flight: nothing. Who to ask: nobody." | "Nothing is in the way: nobody asked for this before and nobody is changing it now. **Where it lives:** each row of the Agents list. **History:** the rows were spaced out in May to fit long names (PR #40)." |
| Triage reason | "This requires changes to the spend aggregation logic in the backend." | "The product counts spend per week only. A daily bar needs it to count per day, and a developer decides that first." |
| Answer | "Great question! The list is paginated through the API, which returns 50 records per request." | "The list shows 50 agents at a time; the rest appear as you scroll." |
| A reason a designer should look | "a missing state"; "feels crowded" | "The approved design shows an empty list; the change shows nothing at all" |

## Grounding — never invent a reason

Every "why" comes from somewhere you can name. Where a field ties the text to
its source (a card section's `source`), the field names it and the text does not say it again.
Anywhere else (an answer, a triage reason, a reply, a research paragraph, whose `links` are
one list for the whole summary) you name it in the sentence:

| Source | Say |
| --- | --- |
| The issue the change closes | "The issue that asked for this says…" |
| The PR's description or decision notes | "The change's notes say it was chosen because…" |
| An architecture or design page | "The product's design notes say…" |
| The code itself | "The screen does this because it only receives…" (only when the code makes it obvious) |

When no source says why, write exactly that, in the text: "The change does not say why.
<Author> made it and would know." A guessed reason presented as fact is the one mistake this
skill exists to prevent. **Not even labelled**: a guess is not written, and neither is an opinion.

**Design Desk states what it can point to and gives no opinion.** What goes into a text is a
fact from a source: the code, the pull request, the issue, the approved design, a Figma frame,
the catalog, a decision that counts. A decision that waits for a designer's approval (Not
approved) is not a source: it is not cited as a reason, a conflict or a rule, and a text may say
only that it exists and waits. What the product *could* do better, what looks odd to you, what
you would have drawn — none of it is a finding. Where nothing differs from a source, write that
nothing differs, or write nothing.

## Constraints, kindly

A constraint is information, not a refusal. Say it as what the product does, then what it
would take to change it:

> The list shows what the server sends, and the server does not send the owner's name yet.
> Showing it needs a developer to add it there; the design can already reserve the space.

Never "it is not possible", never "the system does not allow it", never blame.

## Before you hand it over

- Is the first sentence true and enough on its own?
- Could a designer act on this without asking what a word means?
- Does every sentence change what the reader does or knows? Cut the rest.
- Does anything repeat the title, a picture or another sentence?
- Is every "why" sourced, or marked as not documented?
- Could the reader take any sentence for your taste instead of a fact from a source? Cut it.
