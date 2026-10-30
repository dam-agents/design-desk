# Design requests — triage, then variants

A design request is a card a person files on the Desk (**New design request**, or **Start a
design follow-up** from a change card). It moves through triage, variants and feedback before
any live prototype ([prototype.md](prototype.md)) and the spec ([handoff.md](handoff.md)).

## Triage (`requests_due`)

Triage answers one question before any work: **what of this can be done as a design change?**
The person deciding should know it before a single variant exists.

1. Claim the item; read the card (`design desk item I-<n>`). A follow-up (`request.from`)
   also reads the change card it came from.
2. Find the screen in the product: the profile's screen map, then the code at the default
   branch (`scripts/checkout.sh <repo>`). Read the components the request touches and what
   they are wired to: data, handlers, conditions, permissions.
3. Judge each part of the request against [boundary.md](boundary.md), then pick the verdict:
   - `design` — every part changes only the look;
   - `needs-developer` — the look can change, but a part needs new data, a new rule or a
     new action;
   - `product` — the request changes what the product does or who it is for; it needs a
     decision before design work makes sense.
4. Write `triage` on the card: `verdict`, `reasons` (one or two plain sentences), `can` and
   `cannot` (each a short list, each `cannot` with its reason in the person's terms). Keep
   `status: triage`. Put the request's own words in `summary` only if its title is unclear.
5. `design desk done I-<n> --outcome triaged`.

A request too vague to triage gets a **question thread from you** instead (`design desk
comment C-<n> <file>`): one question, with your best guess as the suggested answer.

## Variants (`variants_due`: `explore` and `revise`)

Variants are quick, static and on **sample data**: the place to compare directions before
anyone builds. Make them with the `variants` skill.

- **explore** — set `status: variants`, make two or three genuinely distinct approaches
  (the skill says what distinct means), each one self-contained HTML file built into the
  real screen in the product's own styles; `fidelity: wireframe` (`--style wireframe`,
  grayscale boxes) when the question is structure or flow, `mockup` (the product's styles)
  when it is the look. A `needs-developer` request still gets variants; the parts a
  developer must add are drawn and labelled "needs a developer" in the variant.
- **revise** — read every thread on the card, the anchored ones first (an anchor names a
  variant and an element), and every vote with its note. Change what the comments ask,
  keep what people preferred, drop a direction nobody preferred when there is a clear
  winner. Then add one comment as the agent: what changed, per comment, in a list.
- Upload each variant: `design desk asset <file.html> --kind variant --name <name>`; set
  `variants: [{id, name, rationale, fidelity, asset}]` (rationale: one line on when this
  one wins) and `status: feedback` in one `design desk upsert`.
- Look at every variant's screenshots before upload (`design shot`); a variant over 700 KB
  is split or its images shrunk.
- A variant shows no real person, no real customer data, and no invented number presented
  as fact.

## Chat and Slack

The operator in chat and people in the bound Slack channel ask for the same things the
Designer kit made. Pick the skill, build, look, deliver:

| Asked for | Skill |
| --- | --- |
| Clickable mockup, wireframe, design options | `variants` |
| Step-by-step tour, "what's new", onboarding guide | `walkthrough` |
| Slide deck, talk, readout (+ PDF) | `slides` |
| Demo or launch video (MP4) | `demo-video` |
| "Use our colors / logo / font" | `brand` |
| Words; the last pass on every deliverable | `copy` |
| A chart, dashboard or stat tiles | the harness's `dataviz` skill, in the style's colors |
| "Why does X work like this?" | the `explain` skill, sources as in [desk.md](desk.md) → Questions |

- Deliver as a **private artifact** (`create_artifact`; an update keeps the link) and reply
  with the link, the style used (repo@commit, brand, Carbon or wireframe), the sources and
  every assumption. In Slack, also attach HTML or a PNG still.
- A request that should become Desk work ("let's prototype this") — offer to put it on the
  Desk as a request; in Slack create it only when the person asks, with their words as the
  problem.
- Keep sources and builds under `work/output/<YYYY-MM-DD>-<slug>/`.
