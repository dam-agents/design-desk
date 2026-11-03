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
(`proposal`, [watch.md](watch.md) step 11) end per `handoff`.

## Research (`requests_due`, before triage)

Before anything is designed, know what is already there: whether the request is tracked,
where the code came from, who owns it, and whether today's behaviour was someone's decision.
The person deciding sees it on the card, and every later step builds on it.

1. **Issues.** `gh issue list -R <repo> --state all --limit 30 --search "<keywords>"` with the
   request's words, the UI text and the component names you find; read the relevant ones
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
6. **Record it on the card** with the `explain` skill, in plain words: `research: {verdict,
   summary, links}`. `verdict`: `clear`, `duplicate`, `deliberate`, `collision` (someone is
   changing it now) or `unclear`. The Desk shows it open near the top, so the summary is this
   short report, one line each, every source linked in `links`:
   - **Already asked for**: duplicates and close issues with their state, or "none found";
   - **Where it lives**: the screen, in plain words; the code files go in `links` only;
   - **History**: who added it and why, the last change and what it did;
   - **In flight**: open pull requests and issues on the same area, or "nothing";
   - **Deliberate or a slip**: the verdict and its evidence, one quote or link;
   - **Who to ask**: the people who own the decision, only when the request reverses it.

   Keep the full notes as an asset (`--kind report`) and set `research.asset`.
7. A `deliberate`, `duplicate` or `collision` verdict is suggested for the presentation with the
   question it raises (`design desk agenda` → [desk.md](desk.md) → The presentation), and the
   triage says what that means for the request.
8. **Impact.** Run the `impact` action's skill (`design skill impact --repo <repo>`): where
   else the same thing shows up, what a change touches, and the earlier decisions about it,
   written as `impact` on the card. A deliberate behaviour you found becomes a decision,
   and a request or option that goes against one in force gets `conflicts`
   ([desk.md](desk.md) → Decisions). A request
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
   - `design` — every part changes only the look;
   - `needs-developer` — the look can change, but a part needs new data, a new rule or a
     new action;
   - `product` — the request changes what the product does or who it is for; it needs a
     decision before design work makes sense.
4. Write `triage` on the card: `verdict`, `reasons` (one plain sentence, only when the verdict
   needs it) and `cannot`: only what the person asked for — in the issue, the request or
   their answers — that a design change cannot do, each with its reason in their terms; never
   a part nobody asked for. The Desk folds it. Keep `status: triage`. Put the request's own words in `summary` only if its title is unclear.
5. A request someone asked for in Slack (`idea` with a Slack `origin`) whose verdict is not
   `product`: they asked for options, so `design desk enqueue explore C-<n>`, unless
   `design desk inbox` already holds an open `explore` item of the card. So does a request
   with `request.auto` (filed by someone who may start options, with `request.options` above
   0) whose verdict is not `product`.
6. `design desk done I-<n> --outcome triaged`.

A request too vague to triage gets **one question from you** instead, with your best guess
as the suggested answer: `design desk ask C-<n> <file> --step request`. The Desk shows it at
the top of the request; the person's answer puts the request back on the queue. Close your
item with `--outcome asked`.

## Variants (`variants_due`: `explore` and `revise`; `states` is [below](#every-state-of-a-part-variants_due-states))

Variants are quick, static and on **sample data**: the place to compare directions before
anyone builds. Make them with the skill `design skill options --repo <repo>` names (the
bundled `variants`, or the product's own), and revise them with the `revise` action's.

- **What the person chose** in New request: `request.vision` is how they picture it, so one
  option follows it as closely as the boundary allows and the others are real alternatives;
  `request.skills` (`{name: on}`) — a skill switched on is used for this request's options
  (read its `SKILL.md`), one switched off is not, even where it would run by default; a
  skill not listed follows the usual rules. Say on the card when a choice could not be kept.
- **explore** — read the product's `PROFILE.md` and the card's research first; set
  `status: variants`, make `request.options` genuinely distinct approaches (one to five; three
  when it is missing; 0 means the person asked for none, so only a designer's or developer's Draw starts them)
  (the skill says what distinct means), each one self-contained HTML file built into the
  real screen in the product's own styles; `fidelity: wireframe` (`--style wireframe`,
  grayscale boxes) when the question is structure or flow, `mockup` (the product's styles)
  when it is the look. An option that spans several screens is one view per screen, each
  control that leads on wired to its view (the `variants` skill → Flow). A `needs-developer` request still gets variants; the parts a
  developer must add are drawn and labelled "needs a developer" in the variant.
- **revise** — two kinds of work arrive as `revise`:
  - **Notes on elements** from the design workspace: threads of kind `change`, each anchored
    to one option (`anchor.variant`) and, usually, one element (`anchor.selector`, its text and
    a plain `label`; `anchor.view`/`view_name` the view it is on; `anchor.edit` is a text the
    person typed in place: `{from, to}`). A comment a designer or developer pressed **Work it in** on is one
    too (`was` keeps its first kind, `work_in` who asked); read its replies, the last word wins. Apply
    every open `change` thread of the card to the option's own source (kept under
    `work/output/`), rebuild, look, and upload the result as the **same option id** with its
    new asset: the Desk numbers the version and keeps the earlier one. An option with `states` gets
    every state redrawn in the same upsert (Every state of a part, step 5). Then answer each note
    (`design desk answer T-<n> <file> --resolve`) in one line: what changed, or why it
    could not ("that would change what the product does; the spec lists it").
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
  - **Redraw with all comments**: read every thread and vote, change what they ask, keep
    what people preferred, and add one comment listing what changed per comment, with each
    option's whole view before and after (`design compare` without a selector, `design desk
    comment … --shots`). Never drop
    or merge an option on votes: only a designer's pick (the card's `chosen`, **Pick as the
    winner**) says which option wins, and only a designer removes one.

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
  CSS path in the option's file, a plain label, the `data-view` it is on). The page outlines
  them when a person picks the story. An entry without `stories` keeps the option's coverage
  from before; a revised option whose parts moved sends its new `stories`.
- Upload each variant: `design desk asset <file.html> --kind variant --name <name>`; set
  `variants: [{id, version, name, rationale, fidelity, asset, stories, states}]` (rationale: one
  line on when this one wins) and `status: feedback` in one `design desk upsert`. The list is
  every option on the card: one already there goes with the `version` (and each of its states
  with its `version`) the card gave you, a new one without; one to take off goes as `{id,
  drop: true}`, only when a designer asked. The store refuses (409) a list that leaves an
  option or a state out, or sends one without its version or at an older one.
- Look at every variant's screenshots before upload (`design shot`); a variant over 700 KB
  is split or its images shrunk.
- A variant shows no real person, no real customer data, and no invented number presented
  as fact.

## Every state of a part (`variants_due`: `states`)

A designer or developer selects a part of an option in the workspace (a button, a list, a form) and presses
**Draw every state**, or names the part. The item names the option (`variant`), the part they
selected (`part`: `{selector, text, label, view, view_name}`; none when they only named it) and
their words (`note`). Make it with the `states` action's skill (`design skill states --repo <repo>`).

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
   compares states one by one. A state that needs a developer (new data, a new rule) is drawn
   and labelled "needs a developer", as in the options.
4. Look at every state's shot (`design shot`), upload each (`--kind variant`), then one `design
   desk upsert` with every option (each with its `version`, Variants above) and, on this one,
   `states: [{id, version, name, how, part, asset}]` (`version` only for a state already there):
   `id` short and stable (`hover`, `error`), `name` the state in plain words, `how` when it
   happens in one sentence, `part` the part in the product's words (states of several parts
   are grouped by it). Keep the option's earlier states of other parts in the list; leaving
   `states` out keeps them all, `[]` removes them. A state redrawn under its id gets its next
   version; the Desk keeps the earlier one.
5. A state is a copy of the whole option, so a later `revise` of the option redraws every one
   of its states in the same run (the same ids), whatever part the notes touched. The store
   records the option version each state was drawn for (`of`); a build refuses an option whose
   states are older than it, and the final check says which.
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
`origin.thread_ts`, never a new post, whatever `notify` says. One text reply per step, in
the words the Desk shows:

- after triage: "<the verdict's title, as on the Desk>: <one sentence>. Next: <the next step>.";
- options on the card (`feedback`): "Options ready to vote on: <link>", one line per option
  (its name and when it wins); then one reply per option with its PNG still (`design shot`),
  one attachment per reply;
- live (`testing`): "Live prototype ready to try: <link>"; handed off: "Sent to developers:
  <link>"; closed: one sentence why.

The link is the card's, with its number ([desk.md](desk.md) → Links to an item) and the access
note of [`intake-slack`](../.agents/skills/intake-slack/SKILL.md) (*In that Slack turn*, step 5). A reply the messenger
refuses is logged, and the card is the record.

## Issues (`issues_due`, flow 1)

A watch worklist's `issues_due` lists open issues labelled `issue_label`. Per issue:
`ledger.sh claim <repo> <number>`, read it with its comments, then file a request of type
`feature`: write the JSON with the issue's title and problem in plain words and
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
(`proto.sh worktree C-<n> <repo> --ref pull/<n>/head`), else from the default branch.

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

- **Ask only what blocks the work**, once, with a suggested answer (which repo, which
  screen, who the deck is for); otherwise take the smallest reasonable reading and say what
  you assumed.
- Deliver one self-contained file as a **private artifact** (`create_artifact`; `public` only
  when the operator asks for a share link in this conversation). An MP4 or a PDF goes up
  through `create_artifact_upload_url`, `curl -X PUT --data-binary @<file>`, then
  `upload_ref`. A revision is `update_artifact` on the **same** artifact, never a new one.
- Reply with the link, what you made (one line per option or step), the style used
  (repo@commit, brand, Carbon or wireframe), the sources and every assumption. Numbers you
  made up are labelled illustrative. In Slack, also attach HTML or a PNG still.
- A brand is saved only after the operator confirmed it; a logo is used as given, never
  redrawn or recolored.
- In chat, a request that should become Desk work ("let's prototype this") — offer to put
  it on the Desk as a request: `design desk request` with `origin: {channel: "chat",
  reporter: <the operator's name>}` ([desk.md](desk.md) → Where a card came from).
- Keep sources and builds under `work/output/<YYYY-MM-DD>-<slug>/`.
