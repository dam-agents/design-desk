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

The rest of this file is the general writing method, for longer text and the final pass.


# Write like a human

The goal is not to sound casual or imperfect. The goal is to sound like someone who actually knows what they are talking about.

Good writing has something to say. It uses specific details, makes clear claims, shows appropriate uncertainty, and sounds like a person rather than a template.

Do not optimize for "human-ness" by deliberately making writing messy. Human writing can be polished. AI writing can be casual.

The goal is to remove language and structure that exist only because the writer is trying to sound impressive, complete, helpful, or engaging.

## Priority order

When rules conflict, follow this order:

1. **Truth and accuracy**
2. **The writer's meaning and voice**
3. **Specificity and substance**
4. **Clear structure and pacing**
5. **Natural language**
6. **Polish**

Never sacrifice a higher priority to satisfy a lower one.

---

## 1. Say something real

The strongest defense against generic AI writing is having something specific to say.

Prefer:

* real observations
* concrete examples
* actual decisions
* specific problems
* numbers and dates when relevant
* named projects, products, or people
* things that changed
* things that went wrong
* unexpected results
* disagreements
* unresolved questions

Avoid claims that could apply to almost anything.

Weak:

> AI is transforming how teams work and creating new opportunities for innovation.

Better:

> We gave researchers an agent that could keep working after they closed their laptop. Within a week, almost every question we got back was about what it should remember between sessions.

If something happened, say what happened.

If something changed, say what changed.

If you do not know something, say so.

Do not invent a story, conflict, reversal, anecdote, or uncertainty to make a piece more interesting.

---

## 2. Lead with the point

Start with the claim, observation, problem, result, or story.

Do not spend the opening paragraphs explaining why the topic is important in general.

Weak:

> Artificial intelligence is rapidly changing software development. As organizations continue to adopt AI...

Better:

> We thought the hard part would be getting the agent to write code. It wasn't.

A reader should know what the piece is about quickly.

---

## 3. Give the reader a reason to continue

A blog should move.

Each section should do at least one useful thing:

* introduce new information
* change the reader's understanding
* provide evidence
* answer a question
* introduce a meaningful complication
* explain a decision
* reveal what happened next
* develop the central argument

If a paragraph merely repeats the previous paragraph, cut it.

If a section could disappear without changing the reader's understanding, consider removing it.

Do not add filler simply because a blog "should" be a certain length.

---

## 4. Prefer earned insight over generic wisdom

A strong conclusion should emerge from what the piece actually established.

Do not manufacture a lesson such as:

> The future of AI isn't about better models. It's about better collaboration.

unless the article actually gives the reader a reason to believe that.

Avoid generic endings about:

* the future
* innovation
* transformation
* possibilities
* the importance of collaboration
* what this means "for all of us"

End on the strongest real point.

Sometimes that is a conclusion.

Sometimes it is an observation.

Sometimes it is an unresolved question.

---

## 5. Preserve the writer's voice

Do not replace the writer's voice with a generic "good writer" voice.

If the writer is:

* direct, stay direct
* conversational, stay conversational
* technical, preserve the technical precision
* opinionated, preserve the opinion
* cautious, preserve the caution
* understated, do not add drama

Do not inject:

* slang
* jokes
* personal anecdotes
* rhetorical questions
* fake vulnerability
* excessive enthusiasm
* fragments
* informality

just to make the writing seem human.

Make the existing voice clearer. Do not invent a new one.

---

## 6. Be specific instead of impressive

Prefer concrete language over abstract language.

Weak:

> We developed a powerful solution that enables teams to unlock new possibilities.

Better:

> The system gives each agent its own workspace, credentials, and persistent storage.

Weak:

> This created significant challenges for the team.

Better:

> The migration broke authentication for three services.

Specificity is usually more persuasive than adjectives.

---

## 7. Use confidence carefully

Distinguish between:

**Fact**

> We launched the feature in June.

**Observation**

> Usage dropped after we added the extra confirmation step.

**Interpretation**

> We think the confirmation step is the reason.

**Opinion**

> I would not ship it this way again.

**Uncertainty**

> We still do not know whether the same pattern will hold at larger scale.

Do not turn an interpretation into a fact.

Do not turn a prediction into certainty.

Do not hide uncertainty in a footnote after making a confident claim.

---

# Structure

## 8. Let structure serve the idea

Do not force every piece into the same template.

A blog does not need:

1. Introduction
2. Three challenges
3. Three lessons
4. Conclusion

unless that structure actually fits the material.

Sections can be uneven.

One section might need six paragraphs.

Another might need two sentences.

That is fine.

---

## 9. Avoid mechanical patterns

Watch for:

### Uniform bullets

Do not make every bullet the same length, grammar, and rhythm.

Real lists are often uneven.

### Bold lead-ins everywhere

Use bold lead-ins when they genuinely help scanning.

Do not make every bullet:

> **Speed.** The system is faster.

> **Scale.** The system handles more users.

> **Simplicity.** The system is easier to use.

That pattern quickly feels manufactured.

### Identical paragraphs

Do not make every paragraph three sentences.

Let the idea determine the length.

### Decorative headings

Use headings when they help the reader understand the structure.

Do not add a heading for every thought.

### Repeated conclusions

Do not state the same conclusion in the introduction, at the end of every section, and again in the final paragraph.

Once is usually enough.

---

## 10. Do not force rhetorical devices

### Rule of three

Lists of three are natural when there are actually three meaningful things.

Avoid decorative phrasing such as:

> faster, smarter, and more scalable

when those words are just three ways of saying "better."

### Contrast

"It is not X. It is Y." can work when the contrast contains real information.

Bad:

> It is not just a tool. It is a powerful solution for modern teams.

Good:

> We thought we were building a coding tool. We ended up building a place where agents could keep working after the person closed their laptop.

### Rhetorical questions

Questions are useful when they introduce something the piece actually answers.

Avoid using questions just to create engagement.

Especially avoid ending with:

> So what does this mean for the future?

Answer the question instead.

---

# Language

## 11. Cut corporate filler

Remove phrases that add ceremony without information:

* it is important to note
* in today's landscape
* at the end of the day
* unlock value
* drive impact
* move the needle
* going forward
* in order to, when "to" works
* at its core, when it adds nothing
* it goes without saying

Replace them with the actual point.

---

## 12. Treat buzzwords as warning signs, not forbidden words

These words often signal vague or inflated writing:

* utilize
* facilitate
* initiate
* leverage
* streamline
* elevate
* empower
* foster
* delve into
* underscore
* testament
* seamless
* robust
* crucial
* pivotal
* holistic
* comprehensive
* landscape
* realm
* tapestry
* myriad
* plethora
* game-changing
* cutting-edge
* best-in-class
* transformative
* unparalleled

Do not mechanically replace every occurrence.

If the word is precise and natural in context, keep it.

Accuracy beats the list.

---

## 13. Avoid unnecessary transition words

Words such as these often make prose more formal than necessary:

* however
* furthermore
* moreover
* additionally

Delete them when the sentence works without them.

Keep them when they clarify an actual relationship between ideas.

---

## 14. Do not over-polish

A sentence does not need to be improved simply because it can be rewritten.

If a sentence is clear, natural, and sounds like the writer, leave it alone.

Do not turn:

> I don't think this works.

into:

> I do not believe this approach is effective.

Do not turn:

> We ran into a weird problem.

into:

> We encountered an unexpected challenge.

Sometimes the original is better.

---

# Punctuation

For this writing style:

* Do not use em dashes. Use a comma, period, colon, or parentheses.
* Avoid semicolons. Use a period when possible.
* Use colons when they naturally introduce what follows.

These are style preferences, not evidence that the punctuation itself is "AI."

---

# Blog-specific guidance

## 15. Give the piece a central idea

A good blog usually has one idea that holds the piece together.

Before drafting, identify:

> **What is the one thing I want the reader to understand after reading this?**

Everything does not need to point directly at that sentence, but the piece should have a center of gravity.

If the draft has three unrelated ideas competing for attention, split it or choose one.

---

## 16. Build around tension when it is actually there

Interesting writing often comes from a gap between:

* what you expected and what happened
* what seemed easy and what was actually hard
* what users asked for and what they actually needed
* what worked and what failed
* what you believed and what changed your mind

Find that tension when it genuinely exists.

Do not manufacture it.

---

## 17. Show the evidence

When making an important claim, give the reader something concrete to work with.

Instead of:

> Users struggled with the workflow.

Say:

> Eight of the first ten users stopped at the permissions screen and asked us what to do next.

If you have evidence, use it.

If you do not, phrase the claim accordingly.

---

## 18. Name what changed

If the piece is about a project or experience, explain the progression.

What did you believe at the beginning?

What did you learn?

What changed?

What did you remove?

What would you do differently now?

The answer does not need to be dramatic.

A small change in understanding can be more interesting than a manufactured breakthrough.

---

## 19. Leave some things unresolved

A blog does not need to answer every question.

If something remains unknown, say so.

> We still do not know whether this works outside Research.

That can be a stronger ending than:

> This experience taught us that innovation requires continuous learning.

Do not force closure.

---

# Rewrite mode

When someone asks you to rewrite, tighten, polish, or de-AI existing text:

1. Preserve the facts.
2. Do not add facts.
3. Do not remove meaningful information.
4. Do not change numbers, names, dates, versions, or technical details.
5. Do not change quoted text.
6. Preserve the writer's intended meaning.
7. Preserve their voice and level of formality.
8. Keep their structure unless the structure itself is the problem.
9. Do not make writing longer simply because you can.
10. Do not add a conclusion that was not there.
11. Do not inject personality that was not present.
12. If something is unclear, fix the wording without inventing an interpretation.
13. If two interpretations are possible, preserve the ambiguity or ask for clarification.
14. If a cut would remove real information, keep it.
15. If the original is already good, make only the changes that improve it.

When rewriting, the goal is not to produce a different piece.

The goal is to make the same piece clearer, tighter, and more natural.

---

# Before and after

### Generic opening

Before:

> In today's rapidly evolving technological landscape, artificial intelligence is transforming the way we work.

After:

> Last quarter four teams asked us for the same thing: an agent that keeps working after they log off.

### Corporate language

Before:

> Our innovative platform enables teams to leverage AI to unlock new levels of productivity.

After:

> The platform gives each agent a persistent workspace where it can keep working after the user leaves.

### Fake insight

Before:

> This isn't just about technology. It's about fundamentally rethinking how we work.

After:

> Choosing the model took an afternoon. Deciding which work the agent owned took the rest of the quarter.

### Forced three

Before:

> The new workflow is faster, easier, and more intuitive.

After:

> The new workflow removes two approval steps.

### Over-explaining

Before:

> The free tier now stops at five projects. This means users who relied on more will hit a wall, which could cause frustration if not communicated carefully.

After:

> The free tier now stops at five projects. People will notice.

### Manufactured certainty

Before:

> The migration will finish Friday with no downtime.

After:

> The migration starts Friday. We have never tested a rollback at this size, so plan for an hour of downtime.

### Generic conclusion

Before:

> Ultimately, this experience highlights the importance of continuous innovation and adaptability in today's rapidly changing world.

After:

> We still do not know whether the same approach will work outside Research. That is the next thing we need to find out.

---

# Final editorial check

Before handing over a piece, check it in this order.

### 1. Substance

Does the piece actually have something to say?

Could the central idea be made more specific?

### 2. Accuracy

Are claims supported by what the writer actually knows?

Has uncertainty been represented honestly?

### 3. Voice

Does this sound like the person who wrote it?

Did editing accidentally make it more generic, formal, enthusiastic, or casual?

### 4. Specificity

Could any sentence appear unchanged in ten unrelated blog posts?

If yes, make it more specific or cut it.

### 5. Progression

Does each section move the idea forward?

Cut repetition.

### 6. Naturalness

Read each sentence as if saying it to another person.

Rewrite sentences that sound written rather than spoken.

### 7. AI-pattern check

Look for:

* generic openings
* generic conclusions
* uniform bullets
* excessive bold lead-ins
* identical paragraph lengths
* unnecessary headings
* decorative lists of three
* repeated contrast formulas
* excessive transition words
* corporate filler
* inflated adjectives
* rhetorical questions used for engagement
* summaries that repeat the article

Fix these when they make the writing mechanical, not simply because they appear on the list.

### 8. Restraint

Ask:

> Did I improve this because it needed improvement, or because I felt compelled to rewrite it?

Leave good sentences alone.

The final piece should feel **specific, intentional, and lived-in**, not artificially imperfect.
