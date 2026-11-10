# Design requests — research, triage, variants

A design request is a card in the Desk's queue. It moves through research, triage, variants
and feedback before any live prototype ([prototype.md](prototype.md)) and the handoff
([handoff.md](handoff.md)).

## The three ways work arrives

| Flow | Starts as | Type | Ends as |
| --- | --- | --- | --- |
| 1. Large and new | a GitHub issue with the `issue_label` label (the watch files it, [watch.md](watch.md)) | `feature` | the approved design written back into the issue; a developer builds it |
| 2. Small, built first | a developer's pull request with a basic UI (a change card, open or merged) → **Adjust the design** | `adjustment` | the adjusted design sent to the coding agent (`implementer`) to build into the product |
| 3. Reported | a UI bug, or something that looks wrong to someone (Desk or Slack) | `bug` | as flow 2 |

Ideas filed on the Desk or asked for in Slack (`idea`) and the agent's own proposals for new features
(`proposal`, [watch.md](watch.md) step 12) end per `handoff`.

**The request is the person's words.** `problem`, `goal`, `steps` and `vision` hold what the
person who asked wrote, as they wrote it (an issue's body, a Slack message, the operator's
chat), cut at 4000 characters, never summarized, reworded or filled in; what Design Desk makes
of it goes in research, `issue_brief` and triage. An idea's text is its `problem`, their whole
message (and `vision`, how they picture it, from the Desk's dialog); `goal` (what should
happen) and `steps` are a bug report's, only when the reporter wrote them, and the store keeps
neither for an idea. A field they did not write stays empty. Only a `proposal` is Design Desk's
own words.

## Research (`requests_due`, before triage)

Before anything is designed, know what is already there: whether the request is tracked,
where the code came from, who owns it, and whether today's behaviour was someone's decision.
The person deciding sees it on the card, and every later step builds on it.

1. **Issues.** `gh issue list -R <repo> --state all --limit 30 --search "$(cat <keywords file>)"`
   with the request's words, the UI text and the component names you find; read the relevant ones
   with their comments. A closed `not planned` issue often carries the reason.
2. **The code.** The few files that implement the screen (the profile's `screens`, then a
   search for the UI text). `request.screen`, the person's answer to "Which screen?", says
   where to start; it is context for you and the Desk does not show it.
3. **History.** Per key file: `git log --follow --date=short --format='%h %ad %an %s' -- <file>`
   (the clone may be partial: read history through `gh` when it is), map key commits to
   their pull requests (`gh api repos/<o>/<r>/commits/<sha>/pulls`) and read those: body,
   decision notes, review comments. That is where the reasons live.
4. **In flight.** Open pull requests touching the same files or behaviour
   (`gh pr list -R <repo> --state open --json number,title,author,files`), and closed ones
   that tried this before.
5. **Deliberate or accidental.** A PR or review that argues for the behaviour, a test that
   asserts it, an architecture page that describes it, an issue closed as not planned →
   deliberate. No discussion anywhere, or a later change that broke an earlier intent →
   accidental.
6. **Record it on the card** with the `explain` skill, in plain words ([desk.md](desk.md) →
   Writing on the Desk): `research: {verdict,
   summary, links}`. `verdict`: `clear`, `duplicate`, `deliberate`, `collision` (someone is
   changing it now) or `unclear`. The Desk shows only the summary, with no label for the
   verdict, open near the top. Its first sentence says the verdict in words and the one thing
   the reader must know ("Someone is already changing this: PR #40 moves the same button"); a
   `clear` verdict says there what you looked for and did not find ("Nothing is in the way:
   nobody asked for this before and nobody is changing it now"). Then one short paragraph per finding, each starting
   with its label, **only the ones that found something**, every source linked in `links`:
   - **Already asked for**: duplicates and close issues with their state;
   - **Where it lives**: the screen, in plain words, never a code file's name;
   - **History**: who added it and why, the last change and what it did; only what bears on
     the request;
   - **In flight**: open pull requests and issues on the same area;
   - **Deliberate or a slip**: the evidence, one quote or link;
   - **Who to ask**: the people who own the decision, only when the request reverses it.

   **Sources** (`links`, at most 20) are only what a designer opens and reads, and the page
   starts each with what it is (Issue, PR, Request, Decision, Doc, ADR). They start folded
   under the report, in one quiet line that counts them by kind, and open on a click:
   - a GitHub issue or pull request: `{label, url}`;
   - an item or a decision on the Desk, a request, a discussion's card, a decision, by its
     number: `{ref: "C-12" | "C-12.3" | "D-4", label?}`;
   - a Markdown page (a doc, an ADR, a design note) on GitHub: `{label, url, section,
     excerpt}`, the url to the section's heading (`…/docs/x.md#heading`), `section` its
     heading, `excerpt` the words in it that say it (at most 600 characters), shown in the
     link's preview.

   Never a code file, a commit or a test, in `links` or in the summary: the Desk refuses
   them (a link in the summary, written as a link or bare, is only a GitHub issue or pull
   request; a name with a code file's extension — `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`,
   `.cjs`, `.css`, `.scss`, `.sass`, `.less`, `.html`, `.py`, `.go`, `.rb`, `.java`, `.kt`,
   `.kts`, `.scala`, `.swift`, `.rs`, `.vue`, `.svelte`, `.php`, `.c`, `.cc`, `.cpp`, `.h`,
   `.hpp`, `.cs`, `.dart`, `.lua`, `.sql`, `.yml`, `.yaml`, `.toml`, `.json`, `.sh`, in any
   case — is refused, with or without a folder; only a bare `.js` name with no folder is not,
   since that is how a library is named: Node.js, Moment.js, highlight.js).
   What the code shows is said in words and its pull request, issue or doc is the source. On
   a card saved before this rule, the page leaves out a link to code and shows any other link
   as a plain Link.

   Then `design desk github-sync --card <C-n>`: the Desk reads every issue and pull request
   the research cites in a watched repository (`repos`; any other is `skipped`), so each link's preview shows its state, labels and latest comments
   about the design ([desk.md](desk.md) → GitHub on the Desk).

   Keep the full notes as an asset (`--kind report`) and set `research.asset`.
7. A `deliberate`, `duplicate` or `collision` verdict is suggested for the presentation with the
   question it raises (`design desk agenda` → [desk.md](desk.md) → The presentation), and the
   triage says what that means for the request.
8. **Impact.** Run the `impact` action's skill (`design skill impact --repo <repo>`): where
   else the same thing shows up, under the hood whether the product would have to work
   differently (its logic, architecture, security; a short plain text, not a list), and the
   earlier decisions about it, written as `impact` on the card. A deliberate behaviour you found becomes a decision,
   and the request is checked against the decisions in force ([desk.md](desk.md) → Decisions → The check). A request
   that switched `impact` off (`request.skills`, Variants below) skips this step.
9. **The issue.** A request from an issue (`request.from` an issue card, or an `origin` of
   kind `issue`) gets `issue_brief: {text, url, stories}` in one `design desk upsert`: `text`
   is only what the issue says about what people see (screens, parts, states, words, flows),
   in plain words, never its back end; `stories` its user stories (`{id, text}`, at most 12),
   each as the issue writes it, or written from its text with `derived: true` when it has
   none. The page shows both on the request, and how each option meets each story (Variants).

Variants, the prototype and the spec all take the research into account: they respect a
deliberate decision unless the team chose to reverse it, avoid a pull request in flight or
build on it, and link the issues they relate to.

## Questions first (`request.grill`, after research)

A request whose New request switched **Ask me questions first** on is questioned before
triage, with the `grill` action's skill (`design skill grill --repo <repo>`; bundled:
`grill-me`).

1. Each run asks **one** question: `design desk ask C-<n> <file> --step request` with one
   question in `questions` (its options and `suggested`), then `design desk upsert`
   `{id, grill: {state: "asking", asked: <n>}}` and close your item `--outcome asked`. The
   person's answer puts the request back on the queue.
2. The next run reads every `asks` thread of the card with its answer and asks the next
   question, or stops.
3. Done → `grill: {state: "done", asked, summary}` (the skill's bullets), then triage in the
   same run. Triage, the options and the spec follow the summary.

## Triage (`requests_due`, after research)

Triage answers one question before any work: **what of this can be done as a design change?**
The person deciding should know it before a single variant exists.

1. Claim the item; read the card (`design desk item I-<n>`). A follow-up (`request.from`)
   also reads the change card it came from.
2. Find the screen in the product: the profile's screen map, then the code at the default
   branch (`scripts/checkout.sh <repo>`). Read the components the request touches and what
   they are wired to: data, handlers, conditions, permissions.
3. Judge each part of the request against [boundary.md](boundary.md), then pick the verdict:
   - `design` — every part changes how the product looks, even when a developer then adds
     the small plumbing to build it (a new field, a parameter, an endpoint, an API, a control
     wired to an action the product already has). That plumbing is ordinary building from the
     spec, not a reason for another verdict: it goes in `build`;
   - `needs-developer` — only when, for a part, the product would have to **work
     differently**: its logic or rules, how a feature works, its architecture, its security,
     or a feature to rebuild — the line Under the hood draws ([boundary.md](boundary.md) →
     What needs a developer);
   - `product` — the request changes what the product does or who it is for; it needs a
     decision before design work makes sense.
4. Write `triage` on the card, in plain words ([desk.md](desk.md) → Writing on the Desk), with its check against the decisions ([desk.md](desk.md) → Decisions → The check): `verdict`, `reasons` (one plain sentence, only when the verdict
   needs it) and `cannot`: only what the person asked for — in the issue, the request or
   their answers — that changes how the product works, each with its reason in their terms; never
   a part nobody asked for, and never implementation work (that is `build`: what a developer
   wires when building the design, one plain line each, which the spec carries under **What a
   developer must add** and which never stops the request or its live prototype). The Desk names every verdict in the request's stage line (Checking's tooltip; no label
   beside the title), says in the state's help what it means for the next step, and folds
   `cannot` under the status. While the request is open, **Contact a developer** is one of the ways
   on in its state row: it opens `cannot`, where **Copy a
   question for a developer** copies a link to the request, its state and these parts. Once a
   person opened it, it leaves their row: the spec carries `cannot` to developers. Keep `status: triage`. Put the request's own words in `summary` only if its title is unclear.
5. A request someone asked for in Slack (`idea` with a Slack `origin`) whose verdict is not
   `product`: they asked for options, so `design desk enqueue explore C-<n>`, unless
   `design desk inbox` already holds an open `explore` item of the card. So does a request
   with `request.auto` (filed by someone who may start options, with `request.options` above
   0, or options carried over: `request.carry`) whose verdict is not `product`.
6. `design desk done I-<n> --outcome triaged`.

A request too vague to triage gets **one question from you** instead, with your best guess
as the suggested answer: `design desk ask C-<n> <file> --step request`. The Desk shows it at
the top of the request; the person's answer puts the request back on the queue. Close your
item with `--outcome asked`.

## Variants (`variants_due`: `explore` and `revise`; `states` is [below](#every-state-of-a-part-variants_due-states))

Variants are quick, static and on **sample data**: the place to compare directions before
anyone builds. Every upsert that adds or changes an option, a version, an alternative or a state
carries its check against the decisions ([desk.md](desk.md) → Decisions → The check). Make them with the skill `design skill options --repo <repo>` names (the
bundled `variants`, or the product's own), and revise them with the `revise` action's.
With `figma: enabled` and a Figma link on the request (`request.figma`), compare the option
the link's frame stands for with that frame once it is drawn or revised (the `figma` skill →
Compare with the product); a note from **Work into the design** is a `revise` like any other.

- **What the person chose** in New request: `request.vision` is how they picture it, so one
  option follows it as closely as the boundary allows and the others are real alternatives;
  `request.skills` (`{name: on}`, switches folded under **What Design Desk uses for the options**,
  closed each time the dialog opens) — a skill switched on is used for this request's options
  (read its `SKILL.md`), one switched off is not, even where it would run by default; a
  skill not listed follows the usual rules. Say on the card when a choice could not be kept.
- **Carried options** — a request made from an approved one (`request.from` a request) may
  start with some of its options (`request.carry`; each option's `carried: {card, variant,
  version}`): change each as the new request says — a revise of it, its next version — and draw
  `request.options` new ones besides (0: none). Never redraw a carried option from scratch.
- **explore** — read the product's `PROFILE.md` and the card's research first; set
  `status: variants`, make `request.options` genuinely distinct approaches (one to five; three
  when it is missing; 0 means the person asked for none, so only a designer's, a PM's or a developer's Draw starts them)
  (the skill says what distinct means), each one self-contained HTML file built into the
  real screen in the product's own styles; `fidelity: wireframe` (`--style wireframe`,
  grayscale boxes) when the question is structure or flow, `mockup` (the product's styles)
  when it is the look. An option that spans several screens is one view per screen, each
  control that leads on wired to its view (the `variants` skill → Flow). A `needs-developer` request still gets variants; a part that makes the
  product work differently is drawn and labelled "needs a developer" in the variant, and plumbing
  (triage `build`) is drawn with a sample value, unlabelled ([boundary.md](boundary.md) → What
  needs a developer).
- **One more option** (`explore` with `scope: "add"`): a designer, PM or developer pressed the
  **+ New option** tab and wrote what it should look like and have (`note`). `variant`, when
  set, is the option it starts from ("like this one, changed as I describe"); none means a new
  direction. Pick the product's parts it uses yourself, from the catalog
  ([catalog.md](catalog.md)) where it has them. Draw **one**
  new option for the same brief, research and boundary as the others; leave every option
  already there as it is (each sent with its `version`, the new one without) and name it after
  what makes it different. A wish the boundary does not allow is drawn as far as it goes and
  said in its `rationale`. At most 6 options: the store refuses more. A request that asked for
  no options (`request.options` 0) shows **+ New option** alone once it is triaged.
- **A person's own option** (`fidelity: picture`): **+ New option** → *Use my own pictures*
  puts their pictures on the card as an option as they are, with `by`; no item is queued and
  nothing is drawn. Keep it as it is (send it back with its `version`); change it only when a
  comment asks, and never present it as the product's look.
- **revise** — three kinds of work arrive as `revise`:
  - **Notes on elements** from the design workspace: threads of kind `change`, each anchored
    to one option (`anchor.variant`) and, usually, one element (`anchor.selector`, its text and
    a plain `label`; `anchor.view`/`view_name` the view it is on; `anchor.edit` is a text the
    person typed in place: `{from, to}`). A comment a designer, PM or developer pressed **Work it in** on is one
    too (`was` keeps its first kind, `work_in` who asked); read its replies, the last word wins. Apply
    every open `change` thread of the card to the option's own source (kept under
    `work/output/`), rebuild, look, and upload the result as the **same option id** with its
    new asset: the Desk numbers the version and keeps the earlier one. An option with `states` gets
    every state redrawn in the same upsert (Every state of a part, step 5). Then answer each note
    (`design desk answer T-<n> <file> --resolve`) in one line: what changed, or why it
    could not ("that would change what the product does; the spec lists it").
    **A note that goes against something is applied and said so**: before applying it, check
    it against the decisions in force ([desk.md](desk.md) → Decisions → The check), the card's `issue_brief` (its text
    and stories) and how the change or PR it builds on works (`request.from`, the PR and its
    linked issue). For each it breaks, answer with `--warns <file>`: `[{what, why, source}]`,
    at most 5 — `what` what it breaks in a few words, `why` one sentence, `source` `{kind:
    "decision", ref: "D-<n>"}` or `{kind: "issue"|"pr", url, label}`. The page shows each as a
    warning box under the answer, linked to its source.
    **An applied note always shows what it did**: `design desk fetch` the option's previous
    asset, then `design desk card C-<n> | jq '.card.threads[] | select(.id == "T-<n>") | .anchor'
    | design compare <previous.html> <new.html> <dir> --anchor - > <dir>/T-<n>.json`. A note
    about the dark theme takes a second run with `--dark` into `<dir>/T-<n>-dark.json`, and
    `jq -s '[.[].shots[]]' <dir>/T-<n>.json <dir>/T-<n>-dark.json > <dir>/T-<n>-all.json` joins
    both. The pictures are named after the note's place and theme, and the JSON after the note,
    so notes worked in one rebuild keep their own files. The anchor is a person's text: it goes to
    `design compare` as JSON, never typed into the command line. Look
    at both pictures, and answer with `--shots` and the note's JSON: the note shows the same place
    before and after, the change outlined. Notes done in one rebuild share the previous asset.
    A note with `anchor.state` compares that state's previous and new file (`states[].asset` of
    that state), not the option's file.
  - **Alternatives of a part** (`scope: "alternatives"`): a designer, PM or developer selected a
    part in the design workspace, pressed **Try 3 ways** and wrote how they picture it
    (`note`); `part` is the part (`{selector, text, label, view, view_name}`), `variant` and
    `version` the option as they saw it. Draw **three** genuinely different ways the part could
    look that follow the note, each a self-contained copy of the whole option with only that
    part changed (built like the option, in its style). Look at each (`design shot`), upload
    each (`--kind variant`), and send the option unchanged (its `version`, same asset) with
    `alternatives: [{id, name, how, part, asset, shot, selector, ask}]`: `id` short (`a`, `b`,
    `c`), `name` what makes it different in a few words, `how` one sentence, `part` the part in
    the product's words, `ask` the person's note. The workspace shows them above the design;
    the person picks one with **Use this one**, and the store makes it the option's next
    version itself (no run; the earlier version stays in its history, the other alternatives
    go). Its states are then out of date: the store queues a `states` item with `scope:
    "redraw"` — draw every state of the option again for its new version, as step 5 of Every
    state of a part says. A later redraw of the option drops alternatives
    drawn for an older version; `alternatives: []` removes them.
  - **Redraw with all comments**: read every thread and vote, change what they ask, keep
    what people preferred, and add one comment listing what changed per comment, with each
    option's whole view before and after (`design compare` without a selector, `design desk
    comment … --shots`). Never drop
    or merge an option on votes: no option is the winner (Approve, Build and the presentation
    each ask the person which option), and only a designer removes one: the ✕ on its tab takes it
    off the card (no run; the card's `dropped_options` says who and when). The last option, the
    one a live prototype is built from, the approved one and one on the presentation (queued or presented) stay. The
    store refuses (409) an upsert that sends a removed option's id again: leave it out, or
    draw a new option under a new id.

  People wait for notes with the page open, so a note's run is short: change only what the
  notes ask, rebuild only that option, and before closing the item look at the inbox once
  more (`design desk inbox`): a `revise` for the same card that arrived meanwhile is claimed
  and done in the same run.
- **Notes on a state** carry `anchor.state` too (Every state of a part, below): apply them to
  that state's own file and upload it under the same state id; the option's other states and
  its own file stay as they are.
- **User stories**: with an `issue_brief`, each option says how it meets every story:
  `stories: [{story, met, how, parts}]` — `met` is `yes`, `partly` or `no`; `how` one or two
  plain sentences; `parts` the elements that do it (`{selector, label, view}`, at most 6: a
  CSS path in the option's file, a plain label, the `data-view` it is on), in the order the
  story goes through them. The stories sit under the option's design; a person who presses one
  plays it there: a pointer goes to each part in that order, outlines it and clicks it when it
  is a button, a link to its own page or a box to tick. A bar at the bottom of the window, there from the press, pauses, resumes or
  stops it; when none of the parts is in the option's design, the bar says it can't play it. An entry without `stories` keeps the option's coverage
  from before; a revised option whose parts moved sends its new `stories`.
- **Why it looks like this**: each option names the decisions on the Desk it follows and the
  parts each one shaped: `reasons: [{decision, how, parts}]` — `decision` a `D-<n>` in force
  that the design actually rests on (read them with `design desk decisions --concept <c>
  --state active` for the request's concepts; one the research found and recorded counts too);
  `how` one or two plain sentences on how this option follows it; `parts` the elements it
  shaped (`{selector, label, view}`, at most 6, as for stories). At most 12 per option, each
  decision once. The page tags those parts in the design workspace, says on a selected part
  which decisions it rests on, and lists the option on the decision's page. Name only what
  truly shaped a part, never a decision to decorate one; a part with no decision behind it gets
  none. An entry without `reasons` keeps the option's from before; a revised option whose parts
  moved or whose basis changed sends its new `reasons`. What goes against a decision is a
  conflict (desk.md → Decisions → The check), never a reason.
- **The option's elements**: each option lists the parts it changes or adds, as a person would
  name them (a card, a banner, a button; never every box): `elements: [{id, name, change, how,
  selector, shot, view, view_name, element}]`, at most 24 — `id` short and stable; `name` the
  part in the product's words; `change` `new` or `changed`; `how` one sentence on what is new or
  different; `selector` its CSS path in the option's page, or `shot` a picture of it alone
  (`design shot --element`, `--kind image`); `element` the product's element card it changes
  (`C-<n>`, [catalog.md](catalog.md)), when the catalog has one. The page shows them above the
  option's design as **All elements**; one opens in a dialog with its states. A part picked in the design workspace
  that is (or sits inside) an element with states drawn offers **See every state**: the same
  dialog, only to look through them, with no button that draws or adds. A state belongs to the
  element its `element` names, else to the one named as its `part`. An entry without `elements`
  keeps the option's; a revise that adds, removes or moves a part sends them anew. The tiles
  are cut from the option's latest version, so they follow every change of it.
- Upload each variant: `design desk asset <file.html> --kind variant --name <name>`; set
  `variants: [{id, version, name, rationale, fidelity, asset, stories, reasons, elements, states}]` (rationale: one
  line on when this one wins) and `status: feedback` in one `design desk upsert` (a Desk-filed request may stay at `variants`: [desk.md](desk.md) → Team feedback). The list is
  every option on the card: one already there goes with the `version` (and each of its states
  with its `version`) the card gave you, a new one without; one to take off goes as `{id,
  drop: true}`, only when a designer asked. The store refuses (409) a list that leaves an
  option or a state out, or sends one without its version or at an older one.
- Look at every variant's screenshots before upload (`design shot`); a variant over 700 KB
  is split or its images shrunk.
- A variant shows no real person, no real customer data, and no invented number presented
  as fact.

## Every state of a part (`variants_due`: `states`)

A designer, PM or developer opens an element of an option under **All elements** and presses
**Draw every state**; the design workspace has no such button. Once every state is drawn for
the option's latest version, the dialog says so instead of the button: nothing is left to draw
until the option changes. A chat request names the part
instead. The item names the option (`variant`), the element (`element`: its id, or `part-…`
for a part only its states named), the part (`part`: `{selector, text, label, view,
view_name}`; none when they only named it) and their words (`note`). It works on a request
sent to developers too: the states document the approved design and change nothing of it. Make it with the `states` action's skill (`design skill states --repo <repo>`).

1. Claim; read the option's latest file (`design desk fetch`) and its source under
   `work/output/`. Find the part in it; a part you cannot find → `design desk ask C-<n> <file>
   --step states` with your best guess, done `--outcome asked`.
2. **Which states.** Read the product's component the part is drawn from (`design states <file>
   --export <Component> --root <clone>`, [catalog.md](catalog.md) → Its dimensions) and choose
   as the catalog does: one state per value that changes what a person sees — hovered,
   focused, pressed, disabled, loading, empty, an error, a long text, a missing picture, a
   count of 0 and of many — and what the note asks first. Not the cross product; 24 at most.
   A state the product cannot be in today is drawn only when the request adds it, labelled
   "new".
3. **Draw** each state as its own self-contained HTML file: the option's whole page with only
   the part in that state, built like the option (`design build`, the same style), so a person
   compares states one by one. A state that needs a developer (a new rule or action: [boundary.md](boundary.md) → What needs a developer) is drawn
   and labelled "needs a developer", as in the options.
4. Look at every state's shot (`design shot`), upload each (`--kind variant`). **The design
   catalog:** shoot the part alone in each state (`design shot <state.html> <dir> --element
   <selector>`, the part's CSS path in that page; the light picture, `<state>-element-light.png`,
   named after the state's page so the states share one directory — the picture is shot at three
   screen pixels per CSS pixel, so a tile 380–420 px wide shows it sharp, or at two or one where a
   sharper one would pass 700 KiB, under the Desk's 720 KiB) and upload it (`--kind
   image`). **A refused shot** (exit 1, "more than 700 KiB … shoot a smaller part") writes no
   picture: shoot a smaller part (a narrower selector), or send the state with its `selector`
   and no `shot`; never upload a file from a refused run. Then say which use case of the brief
   the state serves: the ids of the card's `issue_brief.stories` it covers, or, where the brief
   has no stories or none fits, the use case in one plain sentence from the request's own
   words. A state no use case of the brief asks for says so with neither. Then one
   `design desk upsert` with every option (each with
   its `version`, Variants above) and, on this one, `states: [{id, version, name, how, part,
   asset, shot, selector, stories, use, element}]` (`version` only for a state already there): `id` short and
   stable (`hover`, `error`), `name` the state in plain words, `how` when it happens in one
   sentence, `part` the part in the product's words (states of several parts are grouped by
   it), `shot` the picture of the part alone, `selector` the part's CSS path in the state's page
   (the inbox item's `part.selector`; the page cuts the part from the state while `shot` is
   missing), `stories` the story ids, `use` the sentence, `element` the item's `element` when
   it is an id of the option's `elements`. **A state needs one of the two:** the
   Desk refuses a new or redrawn state that it would store with neither a `shot` nor a
   `selector`, because the catalog would show its whole page in a small box instead of the
   part. A state sent unchanged (the same `asset`) keeps the `shot` and `selector` the card has.
   The page shows them in their element's dialog. Keep the option's earlier states of other parts in the list; leaving
   `states` out keeps them all, `[]` removes them. A state redrawn under its id gets its next
   version; the Desk keeps the earlier one.
5. A state is a copy of the whole option, so a later `revise` of the option redraws every one
   of its states in the same run (the same ids), whatever part the notes touched, and shoots
   each part alone again (`design shot --element`, step 4) for its new `shot`: a redrawn
   state sent with its old `shot` loses it: the catalog then cuts the part from the new page
   by its `selector`, and the Desk refuses one with no `selector` — shoot it again and send
   the new `shot`. The store records the option version each state was drawn for (`of`); a
   build refuses an option whose states are older than it, and the final check says which.
   **Two runs on one card** (a `states` and a `revise` dispatched to two sessions): just before
   its upsert, each run reads the card again (`design desk card C-<n>`) and sends every option
   and state as it read it, `version` included, changing only its own. The store refuses (409)
   an option or a state sent at a version older than the card's: read the card again, apply
   your change to what is there now, and send it again.
6. `design desk done I-<n> --session <id> --outcome "drew <k> states of <part>"`.

## UI bugs

A UI bug is a request of type `bug`: something on a screen looks or behaves wrong. People
file one on the Desk (**New request → Report something broken**) or tell you in Slack; either way it
waits in the same queue and gets the same triage.

### From a channel

A report that arrives on a channel is put on the queue by the `bug-intake` action
([actions.md](actions.md)); the bundled skill is
[`intake-slack`](../.agents/skills/intake-slack/SKILL.md) (`bug_reports: enabled`).
It reads the report whole, asks once only what is missing, merges a report of a bug already
queued into its card, files the rest with `design desk report`, and answers in the thread.

### Triage of a bug

Triage as above, with the bug's own verdicts:

- `design` — a visual fault presentation fixes: overflow, alignment, spacing, a wrong token
  or color, contrast, truncated or wrong copy, a dark-mode or small-screen problem. It can
  get variants and a live prototype of the fix.
- `needs-developer` — the screen does the wrong thing: wrong data, an error, a control that
  does not work. The spec ([handoff.md](handoff.md)) carries the steps and the screenshots.
- `product` — it works as designed. Explain why, with the source, in `reasons`.

Find the screen in the code (and on a running instance when the profile has one) and say
in `reasons` whether you could see the fault there.

## Answering in the thread

A request with a Slack `origin` (a bug, a design someone asked for) is answered in the
thread they started: `reply` with `chatId` = `origin.chat` and `threadTs` =
`origin.thread_ts`, never a new post, whatever `notify` says. Which replies the thread hears
is the one list per audience in [Who Slack serves](#who-slack-serves); nothing else is sent.
Every reply names the card (`C-<n>`) and links it, in the words the Desk shows and in plain
words ([desk.md](desk.md) → Writing on the Desk), people's text in it escaped
([desk.md](desk.md) → Links to an item, Text to Slack).

The link is the card's, with its number ([desk.md](desk.md) → Links to an item) and the access
note of [`intake-slack`](../.agents/skills/intake-slack/SKILL.md) (*In that Slack turn*, step 5). A reply the messenger
refuses is logged, and the card is the record.

## Issues (`issues_due`, flow 1)

A watch worklist's `issues_due` lists open issues labelled `issue_label`. Per issue:
`ledger.sh claim <repo> <number>`, read it with its comments, then file a request of type
`feature`: write the JSON with the issue's title, its body as `problem` (above: the person's words) and
`origin: {channel: "github", kind: "issue", repo, number, url, reporter: <author login>,
job: "watch", event: {label: "labelled <issue_label>"}}`, and run
`design desk request <file>`; then `ledger.sh done <repo> <number> <card>`. Its
research and triage follow in the inbox run. Never comment on the issue at intake; the
write-back comes with the approved design ([handoff.md](handoff.md)).

## Adjusting a developer's UI (flow 2)

A change card (an open or merged pull request) has **Adjust the design**: it files a request
of type `adjustment` with `request.from` = the change card. Research reads the pull request
first. Variants start from the UI the developer built (its screens on the change card are
the "before"); a live prototype branches from the pull request's head when it is still open
(`proto.sh worktree C-<n> <repo> --ref pull/<n>/head`), else from the default branch. A pull
request from a fork gets no prototype from its head (`proto.sh` refuses it: the pushed branch
would run the fork's code in the repository's workflows); say so on the card and keep to variants.

## Chat and Slack

The operator in chat and people in the bound Slack channel ask for the same things the
Designer kit made. Pick the skill, build, look, deliver:

| Asked for | Skill |
| --- | --- |
| In Slack, a design of the product's UI | a request: [`intake-slack`](../.agents/skills/intake-slack/SKILL.md) → Design requests |
| Clickable mockup, wireframe, design options | `variants` |
| Step-by-step tour, "what's new", onboarding guide | `walkthrough` |
| Slide deck, talk, readout (+ PDF) | `slides` |
| Demo or launch video (MP4) | `demo-video` |
| "Use our colors / logo / font" | `brand` |
| Words; the last pass on every deliverable | `copy` |
| A chart, dashboard or stat tiles | the harness's `dataviz` skill, in the style's colors |
| "Why does X work like this?" | the `explain` skill, sources as in [desk.md](desk.md) → Questions |
| "This is broken / looks wrong" | [UI bugs](#ui-bugs) → From a channel |
| "Make it…", "how would it look if…" in a request's thread (`slack_council: enabled`) | `slack-council` |

- **Slack serves the roster only**: [Who Slack serves](#who-slack-serves). A Figma link in a
  Slack message is never opened (`figma` → Who may name a frame).
- **Ask only what blocks the work**, once, with a suggested answer (which repo, which
  screen, who the deck is for); otherwise take the smallest reasonable reading and say what
  you assumed.
- Deliver one self-contained file as a **private artifact** (`create_artifact`; `public` only
  when the operator asks for a share link in the direct session, never in Slack; the agent manifest is the one
  public artifact by default, [docs/manifest.md](docs/manifest.md)). An MP4 or a PDF goes up
  through `create_artifact_upload_url`, `curl -X PUT --data-binary @<file>`, then
  `upload_ref`. A revision is `update_artifact` on the **same** artifact, never a new one.
- Reply with the link, what you made (one line per option or step), the style used
  (repo@commit, brand, Carbon or wireframe), the sources, every assumption and each decision in
  force it goes against ([desk.md](desk.md) → Decisions → The check). Numbers you
  made up are labelled illustrative. In Slack, also attach HTML or a PNG still.
- A brand is saved only after the operator confirmed it; a logo is used as given, never
  redrawn or recolored.
- In chat, a request that should become Desk work ("let's prototype this") — offer to put
  it on the Desk as a request: `design desk request` with the operator's words as `problem`
  and `origin: {channel: "chat", reporter: <the operator's name>}` ([desk.md](desk.md) → Where a card came from).
- Keep sources and builds under `work/output/<YYYY-MM-DD>-<slug>/`.

### Who Slack serves

**The role check comes first.** Every skill that starts from a Slack message
(`intake-slack`, `slack-council`, `slack-polls` → In a Slack turn and Sync, `show-me`,
`explain`, and every deliverable skill asked for in Slack) first takes the sender's role from
the email Slack holds for their user id ([desk.md](desk.md) → Roles, In Slack); a later reply
in a request's thread checks the card's `origin.email` the same way, at the time of the reply.
Every `<title>`, name or quote in a reply is escaped ([desk.md](desk.md) → Links to an item, Text to Slack), and every
`<link>` is the card's with the access note of `intake-slack` step 5.

**A sender on the roster** gets the work they ask for (the table above), each skill answering
as it says (a council, a vote, a picture). A request they started in Slack hears its steps in
its thread ([Answering in the thread](#answering-in-the-thread)) with exactly these replies,
one per step, with a PNG of the design or screen whenever the step has one:

1. the one question of `intake-slack` step 2, only when the message does not say which
   screen or what is wrong;
2. on intake: `intake-slack` step 5 (a bug) or Design requests step 3 (a design);
3. after triage: "<the verdict's title, as on the Desk>: <one sentence>. Next: <the next step>.",
   with each decision in force it goes against by its `D-<n>`;
4. options on the card (`feedback`): run `share-options` with the request's thread as its
   destination when `slack_polls: enabled`; it opens the vote, closing 48 hours later
   (`slack-polls` → Share), and posts each option with its PNG still (`design shot`). With
   polls off, send "Options ready to vote on: <link>", one line per option (its name and when
   it wins), then one reply per option with its PNG still;
5. live (`testing`): "Live prototype ready to try: <link>";
6. handed off: "Sent to developers: <link>"; closed: one sentence why.

**A sender not on the roster** (no email, or no row with it) hears exactly these replies and
nothing else:

- **A UI bug report**, with `bug_reports: enabled`, is queued like anyone's, and its thread
  hears only: the one question of `intake-slack` step 2 (only when the report does not say
  which screen or what is wrong); the reply of `intake-slack` step 5; and, when the request
  is handed off or closed, one last reply: "“<title>” (C-<n>) is now with the developers:
  <link>" or "“<title>” (C-<n>) is closed: <link>". No verdict, no reasons, no picture.
  A finding of the `qa_bot` (`intake-slack` → Automated test findings) hears its step 4
  reply and that last reply.
- **Anything else** — a question, a design, a picture, a deliverable, a council ask, a reply
  under a vote, a bug report with `bug_reports` off — gets one reply, "Thanks — the Design
  Desk works for its team only, so I can't take this on here.", and nothing else: no answer
  from the code, no picture, no relay to the Desk, nothing queued.
- **A vote reaction** on a shared option is counted by the Desk server under "in Slack"
  (`slack-polls` → Sync): it is a reaction, not a message, and the vote only advises.
