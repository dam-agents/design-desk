# Changelog

**Migration instructions, not a change log.** Per version, the idempotent **Upgrade**
steps a deployed instance applies when crossing it — what to run, update, or change
(schedules, config keys, state formats). Most versions need nothing. What changed and
why lives in the PR and commit history, not here. Consumed by the version check
([docs/persistence.md](docs/persistence.md) → **Definition version & upgrade**);
authoring rules: [docs/self-modification.md](docs/self-modification.md) §12.

## 1.51.0 — 2026-11-06

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A card in any list that goes against a
decision in force shows a red ! under its state dot that unfolds into `Goes against D-<n>`
(`GET /api/cards` adds `against`, the decisions' numbers; `GET /api/decisions` adds each
conflict's `status`). Product's Screens, Elements, Decisions and History rows look like the other
lists: a state dot and a `created:`/`decided:` `from:` `by:` line, in place of the summary and the
chips. A folded request text or From Design Desk keeps two whole lines and half of the third,
not counting a heading; the private ask's placeholder is in the smaller meta size. Nothing else to do.

## 1.50.0 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Requests has two tabs, **For
Designers** and **For Developers** (the former small change: `size.small`, unchanged in the
data); New request has a switch for it, For Designers by default (`POST /api/requests
{audience}`). A request filed by the agent takes `audience`; without it, one with a Slack
`origin` is For Developers and any other For Designers — the `intake-slack` skill now sets it.
Requests filed before this version keep their tab (no `size`: For Designers). An item's title
in a list is bold until the person first opens it (`POST /api/cards/<id>/read`, the list's
`read`, a new `reads` table the store adds by itself); every item already on the Desk starts
unread for everyone. The private ask stays over the design workspace and asks about the part
picked there; a part with states drawn offers **See every state**, to look through them. In
both modes a request's state in the list is a dot in the row's top-right corner, as large as the
dot on its page, pulsing while Design Desk works; pointing at the dot unfolds the label over the title. A row's provenance
starts with `created:` Today, Yesterday or the date; with no person behind it, `by:` names the run
(hourly check, daily issue read), and a change from today has no New today chip. PR Changes filters are
**Open** (the default) and **Handled**, with no All and no Not seen yet; a change has no Got it
button any more: opening it is what marks it read. A change's and an issue's row show their GitHub
state as the same corner dot: a PR Draft, Open or Merged, an issue Open or Designed. The watch
pre-flight now puts `draft` on each due pull request, and a change card keeps it in
`source.draft` ([docs/watch.md](docs/watch.md) step 7); cards written before stay Open until their
next update. Every row in every list is its title and one line under it, with no chips; an issue's line
ends with where it is planned (`in: This sprint`). Requests filter by **Unread**, **Open**, **Ready** and
**Closed** (Ready: options drawn, a Slack vote ended, or a live prototype up; the list adds `voting` and
`voted`), and the presentation tab is **For presentation**. Issues filter by **All** (first and the default,
designed issues included), This sprint, Next sprint, Assigned and For design; there is no Designed filter. A change's and an issue's page show a status box like a request's
(an issue's says `This sprint`); an issue keeps **Design this** there and **Draw it** under How it
could look. Unread keeps an item just opened until the filter or tab changes. A designer marks an issue
**Handled** (it leaves the other lists for its own filter, and the issues pre-flight no longer draws it). The menu's counts are only what is
still open: PR Changes the changes not handled, Issues the issues neither handled nor designed. A request with a live prototype has **Open the
prototype** as the next step in its step pill, with the demo account on the state's line. The presentation's list and page follow the other pages' style.

## 1.49.0 — 2026-11-05

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The Changes tab is named **PR
Changes**. Folds slide by a script in every browser instead of jumping. In simple mode an
option's design (the mockup) starts folded and All elements open, also after switching the mode;
every request in the list shows its state as a dot left of its title in a colour of its own;
nothing says Needs a designer or Needs a developer. A folded request keeps two whole lines. A
row's provenance reads `from: … by: … based on: …`, with an icon for Slack and the Desk. No
server or data change.

## 1.48.0 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A **Simple mode** switch in the menu
under a person's name hides Issues, Product, People, the presentation, Build a live
prototype and the Why it looks like this strip under an option (the design workspace keeps it),
starts an option's design folded and shows a request's state in the list as a dot that unfolds
its words on hover, and offers no rename of a request; links to what it hides, such as a decision named in a request, still open it. The
Desk keeps each person's choice (`POST /api/prefs {simple}`, `simple` in `GET /api/me`); with
none, a viewer starts in simple mode and every other role in full mode. `POST /api/prefs` now
changes only the keys it is sent. In every mode dialogs, menus, folds, the private ask, a newly
opened item and toasts animate, unless the system asks for less motion ([docs/desk.md](docs/desk.md) → **Motion**). No data change.

## 1.47.0 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). No option is the winner any more:
Select as the winner and `POST /api/cards/<id>/chosen` are gone, a card's old `chosen` is
ignored, and Approve, Build a live prototype and Add to presentation each ask which option,
none picked ahead ([docs/desk.md](docs/desk.md)); a build item without a note asks which option
([docs/prototype.md](docs/prototype.md) step 3). Share in Slack and Send designs to Slack are one
**Send to Slack…** whose dialog sends the designs or asks for a vote; the items are as before
(`slack-share`, `slack-send`). Close… and Decide and close… are one **Close…** whose dialog
just closes or closes with a decision. Ask the team for feedback sits in the request's step pill,
whose **Step n/m** alone opens the steps. All elements sit above the option's design, twice as
large; Open in the design workspace is the request's main button. A request's text and From
Design Desk show whole on a person's first visit, folded after (`desk-seen-requests` in the
browser). People vote 👍, 👎 or ⚠ and only at the Team feedback step; a vote's kind may now be
`dislike` (the Desk's own and a Slack 👎, [`slack-polls`](.agents/skills/slack-polls/SKILL.md)
adds 👎 to its legend and counts it). Ask the team for feedback reads **Ask for feedback**, and
Close… shows a cross. An element whose every state is drawn for the option's latest version
says so in its dialog instead of a button to draw them again. The user stories sit under the
option's design as cards side by side, in a section that folds like the others (folded at first), with no switch of their own and no second picture of it: a story pressed plays
in the design above, the pointer going through its `parts` in their order
([docs/requests.md](docs/requests.md) → User stories). Send to Slack… opens on Ask for a vote,
which closes in 1, 5 or 24 hours (24 picked). While a story plays, a bar at the bottom of the window pauses,
resumes or stops it, and only the design scrolls, never the Desk. A played story's numbered frames show only while
the design's Show hotspots switch is on. A request at `feedback` reads **Team feedback**, as its
step does, not Options ready.
The review bar's switch that outlines hotspots starts on in designs built from now on (a design
built before keeps its old bar, switch off), so a played story shows its numbered frames from the
start; the Desk's previews of a part hide the outline with the bar (from #68, closed). The switch is
renamed **Show hotspots** (was Clickable) in designs built from now on. The step pill always offers the
move to the next step after a grey "Next:" — Draw design options, Ask for feedback, Build a live
prototype, Try again; Approve, Close and ⋯ stay in the row, and any other action moves under ⋯. Votes from Slack count 👎 too, and every text that names the votes
says 👍, 👎 and ⚠. A request no longer shows its "Asked for: N options" line. On the Desk a design's review bar
leaves out its title (the option tab names it) and the product's own style line (`Style:
<repo>@<commit>`); a fallback style keeps its line. The bar stays one row, its screens centred in it and scrolling
sideways when the design is narrow. A request's text is only the asker's words: the store keeps no
`goal` or `steps` for an idea (a bug report and Design Desk's own proposal keep theirs), the page
shows an idea's problem and how they picture it only, so a goal written for an idea before is no
longer shown, and the `intake-slack` skill copies a Slack message as it is, filling nothing in. The option's three sections — All elements, its design (headed
Wireframe, Mockup, From Figma or Pictures) and User stories — share one heading with a count and a
half-line hint, and each folds with +/− (elements and the design open at first, the stories
folded); playing a story opens a folded design first. A story's card says why the option falls short of it (its
`how`): amber when it meets part of it, red when not at all, nothing when it meets it; the
verdict's words and the panel under the cards are gone, its ✓ ◐ ○ stays. From Design Desk shows without a box: a
heading per part, and what folds as a quiet line with its count in a grey pill. Your name at the
top opens a menu as wide as it, with How it works and day or night mode (the ? and ☾ buttons are
gone); each tab's help draws its own flow from How it works (Requests the request's, Changes a
shipped change's, Issues an issue's). The line under Questions and comments is gone: Ask Design Desk and
Only comment (was Comment for the team) say on hover what happens and that everyone on the Desk sees it. A request's page fills the pane: no part of
it stops at the reading width while others run on.

## 1.46.0 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A request's card names only the
skills switched on for its options, by their names. A request's text is the asker's own words
([docs/requests.md](docs/requests.md) → The three ways work arrives); Design this issue no
longer fills it in with the issue's needs. Requests filed before keep their text. Send designs
to Slack ticks the options to send; its note's `variants` is `"all"` or a list of option ids
([`slack-polls`](.agents/skills/slack-polls/SKILL.md) → Send). Every button that opens a dialog
starts its tooltip with "[Opens a dialog]". A request's first step is called Filed. A request
that asked for no options shows Design options with **+ New option** once triaged, and New
option can add a person's own pictures as an option with nothing drawn (`fidelity: picture`,
[docs/requests.md](docs/requests.md) → Variants). A comment from the design workspace names its
option; a card's "from" names the card it came from by kind and number; a link's preview shows
each issue or pull request once, a pull request's comments not at all, and an issue's only
those the watch run marks as about the design (`design desk github-mark`,
[docs/watch.md](docs/watch.md) → Comments on GitHub); comments kept before show once marked.
In Screens, each stage keeps its column: an After with no Before sits under the other Afters.
A request's author, a designer or a lead can rename it (a small ✎ right after its title, shown on
hover; the copy-link button stays as it is); a run's upsert keeps that name.

## 1.45.0 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). An option now lists its elements
(`elements`, [docs/requests.md](docs/requests.md) → The option's elements), shown under it as
All elements with their states in a dialog; options drawn before list the parts their states
draw. An approved design's elements go to Product → Elements on **Add to the design catalog**,
and the watch run compares a shipped change with the approved design it builds
([docs/watch.md](docs/watch.md) step 11). An answer to a worked-in note may carry `warns`
(`design desk answer … --warns`): what the note goes against, shown as a box under the answer.
New fields are optional; no state to migrate, no config change.

## 1.44.0 — 2026-11-05

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A folded box now stays folded when
the page draws again, for example on another design tab. Every list on the left shows the
newest item first. A request's steps name its triage verdict; a verdict other than design is
also a label beside its title, and what a design change cannot do folds under the status. The
"Design only" label, the "What can be done" section and the label on "What's already known"
are gone. No server restart, no data change.

## 1.43.3 — 2026-11-05

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). How it works draws how a request, an
issue and a shipped pull request move. No server restart, no data change.

## 1.43.2 — 2026-11-05

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The list is white and the page
lighter, as on the team's design; a list card's second line is grey. In a list, an issue's or
a pull request's preview shows on its link alone and a label's line on the label alone, not
over the whole card. A request's open steps close on a click outside them. No server restart, no data change.

## 1.43.1 — 2026-11-05

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`): it refuses a new or
redrawn state of a design option that it would store with neither a picture of the part
(`shot`) nor the part's `selector`, so the Design catalog can no longer store a state it would
show as a whole page in a small box. A state sent unchanged keeps the `shot` and `selector` it
has; states already stored without either stay as they are. Nothing else changes.

## 1.43.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The day and night switch now keeps
each person's choice in `db.json` (`prefs`, added on first load), and a choice a browser
kept before is saved for its person on their next visit. The design workspace gains a
Comments switch (`desk-notes`, browser only). A request filed on the Desk now waits at
`variants` after its options are drawn until a person asks the team for feedback
([docs/desk.md](docs/desk.md) → **Team feedback**); requests already at `feedback` and those
from Slack or chat are unchanged. No config change.

## 1.42.1 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Opening another item, decision or
tab now starts at the top of the page instead of where the last one was scrolled to. No
server restart, no data change.

## 1.42.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The server's card list now carries
`decided`, so a request closed with a decision shows as decided in the list. Recorded cards
and config need nothing.

## 1.41.0 — 2026-11-04

**Upgrade:**
Write `agent_manifest: dam` to `work/CONFIG.md` unless the operator asked to keep the
manifest local (`off`) ([docs/config.md](docs/config.md)). Create `work/PEERS.md` with the
header in [docs/manifest.md](docs/manifest.md) → **Peers**; add or pin the peers the
operator names there. Run `bash "$HOME/scripts/install-toolkit.sh"` (it adds the
jsonschema venv the manifest gate needs). Write `work/manifest.json`, run `manifest-check.sh stamp` and
`publish`, and publish it per **Write, check, publish**. Then run
`bash "$HOME/scripts/verify-onboarding.sh"`; apply every `FAIL` line's `fix:`.

## 1.40.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). New on a request: **+ New option**
(an `explore` item with `scope: "add"`) and, in the workspace, **Try 3 ways** on a part (a
`revise` item with `scope: "alternatives"`), and a ✕ on an option's tab that takes it off, all in [docs/requests.md](docs/requests.md) → Variants.
Recorded cards need no change.

## 1.39.3 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). In the design workspace the design's scrollbar always shows, so pointing at the whole page no longer makes it jump. No server restart, no data change.

## 1.39.2 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). On a change, "Where else this shows up",
"What a change here touches" and "Earlier decisions about it" start folded. No server restart, no data change.

## 1.39.1 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). No server restart, no data change.

## 1.39.0 — 2026-11-04

**Upgrade:**
Skills and docs are re-read per run. Slack replies about a request now carry its
card link and a PNG where one exists; with `slack_polls: enabled`, finished options start
their vote in that request's own thread, closing 48 hours later. Republish the Desk page
(`update_artifact` on `desk_artifact` with `desk/page.html`): Share in Slack names that thread.

## 1.38.1 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**).

## 1.38.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Recorded threads and cards need no
change; the store's GitHub copy starts empty and the next watch run fills it.

## 1.37.1 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Tooltips and previews now show half
a second after the pointer rests on them; an item's or a decision's number in text (`C-11`,
`D-26`) previews it. A request's own text (The request, The report) folds, kept per browser; who sized and who approved a request sit on rows with room between them; Pick as the winner reads Select as the winner; the design options are folder tabs over one panel that holds everything about the picked option; a note's ◎ label previews the element it is about; search lists every item or decision whose number starts as typed (`C-`, `D-1`); in the workspace a note's number on the design shows the note on hover and opens it on a click, the notes' filters are the Desk's segmented control and hide with no notes, and Just comment has its own icon; the note is written inside the Selected box; a change's sections show open; the workspace's options are the same folder tabs on their own row, with the version picker beside the design's tools; a note pin's tooltip shows under the pointer; the picked option tab no longer turns bold; the roles in Add a person read as a table. In a design's review bar, Clickable and Light / Dark sit on the right (designs built from now on). The design catalog folds, and a state with no picture of its part is drawn live from its page, cut to the part by the state's new optional `selector`; a change's "Where else this shows up" is three folding sections, and an earlier decision found in a pull request links to the Desk's own decision. Restart the Desk server (`rc-service --user design-desk-server restart`): it now keeps a state's `selector`.

## 1.37.0 — 2026-11-04

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Tooltips show at once in the Desk's
own box; a tab's intro folds again, kept per browser; buttons carry icons; More closes on a
click outside it and holds Mark as small change; beside the list an open item has no back
button; a request's text blocks share one width; the Needs a developer label is gone. Every
GitHub issue or pull request link previews what the Desk knows of it. Product → Decisions
keeps the design side's decisions (designers, PMs, leads) apart from developers', so also
restart the Desk server (`rc-service --user design-desk-server restart`): it now tells the
page whose each decision is, and a decision's `author` may name a `role`. Recorded decisions
need no change. A tab's pages are now tabs and its filters one segmented control; the
Decisions search box is gone: the header's search finds items, decisions and GitHub issue or
pull request numbers.

## 1.36.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A request's page shows a **Design
catalog**: each drawn state of a part as a picture of the part alone, with the use case of the
brief it covers. A state takes three optional fields (`shot`, `stories`, `use`); states drawn
before have none and show without a picture until their next redraw. Draw every state is now
only in the design workspace. `design shot --element <selector>` shoots one element; nothing to
install.

## 1.35.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Approve can tick **Straight to
implementation**: the handoff puts the coding agent's label, named in its manifest, on the
spec's issue ([docs/handoff.md](docs/handoff.md) step 5).

## 1.34.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A design option may now carry
`reasons: [{decision, how, parts}]`: the decisions it follows and the parts each shaped
([docs/requests.md](docs/requests.md) → Variants). The request shows them under its options,
the design workspace tags them on the design (**◆ Why it looks like this**), and a decision's
page lists the options that follow it. Options drawn before have none and need no migration.

## 1.33.0 — 2026-11-04

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). An option's tab in the design
workspace now shows only its version; the style and state-count labels are gone. Every button
and label says on hover what it does; a tab's intro moved from under the menu into the empty
pane beside the list and no longer folds, so the server stops keeping that choice: the
`prefs` an older `db.json` holds is ignored and can stay. What Design Desk only suggests for
the presentation is greyed.

## 1.32.1 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`). An inbox claim is
now a 15-minute renewable lease instead of a two-hour lock: a session renews it with
`design desk claim I-<n> --session <id> --heartbeat`, and a worklist entry past its lease is
taken over by the next inbox pass ([docs/desk.md](docs/desk.md) → **Claims**). Existing
claims need no migration; an old `claimed_at` becomes stale at the new lease length.

## 1.32.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A link to a change or its pull
request now shows a preview on hover, like an issue's; the design workspace fills the whole
page again; a change's labels have their own colours (in progress violet, against a decision
red, a presentation suggestion grey); a sent request's status is the one green box with its More menu; the pictures a person
gave with a request are marked `source: "person"` and show in its brief; a relayed Slack
reply takes `mentions` and shows names instead of `<@U…>` ([docs/desk.md](docs/desk.md) →
**Text from Slack**). Nothing to
migrate.

## 1.31.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A spec now leaves without open
questions: what it does not settle is asked on the Desk as a form (`--step handoff`) and
answered there before it is sent ([docs/handoff.md](docs/handoff.md) step 4). A spec already
sent keeps its text; nothing to migrate. Every issue, comment or pull request the spec goes
to carries the design's pictures, before and after, attached with `gh … --attach`.
A request sent to developers shows a card linking its issue; that issue, and the one it came
from, leave the Issues page's open lists for **✓ Designed** and are never drawn
([docs/issues.md](docs/issues.md) → On the Desk). Derived from the cards; nothing to migrate.

## 1.30.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A note Design Desk applies to an
option, and a live prototype's update, now answer with the place before and after
(`design compare --anchor`, `design desk answer|comment --shots`; [docs/requests.md](docs/requests.md)
→ Variants). Older answers have no pictures; nothing to migrate.

## 1.29.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A designer or developer can now have
one part of an option drawn in every state (**Draw every state**, inbox kind `states`, action
`states`, [docs/requests.md](docs/requests.md) → **Every state of a part**); Build a live
prototype opens a final check and records what goes live on the card (`live_pick`,
[docs/prototype.md](docs/prototype.md) → Build). `live_pick` replaces 1.28.0's `built`: Approve in
a prototype step takes `live_pick`'s option and version (`approved.variant`, `approved.version`),
and the spec is written from them. A card built under 1.28.0 has `built` and no `live_pick`;
its Approve falls back to the option picker. Older cards need nothing. The inbox pre-flight lists
`states` items under `variants_due`, and an upsert of options sends each option and state with
its `version` ([docs/requests.md](docs/requests.md) → Variants).

## 1.28.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A designer, the lead or a
`lead-developer` now approves a checked request without options, a vote or a live prototype, or
decides and closes it; a decision item without a thread is recorded from its note
([docs/desk.md](docs/desk.md) → **Deciding straight away**). While a prototype is live the
options fold under it and Approve takes the option it was built from (`built`); a prototype
built before this has no `built` and keeps the option picker. The Desk now always opens on Requests;
How it works stays under the question mark.

## 1.27.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A request's page shows what was
asked, with its pasted screenshots, apart from what Design Desk made; rows on Changes,
Requests and Issues drop their description; a link to an issue shows its preview on hover;
a decision without concepts no longer stops the Decisions list. Pictures pasted into an
older request show under Design Desk's part; nothing to migrate.

## 1.26.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A `developer` now starts and changes
design options and Product as a designer does; approving, closing, the presentation, marking
handled, the winner and decisions stay a designer's, and live prototypes still follow
`prototype_requesters` ([docs/desk.md](docs/desk.md) → **Roles**). A new roster role,
`lead-developer`, marks a request a small change, which any developer but its author approves
([docs/desk.md](docs/desk.md) → **Small changes**); offer the operator to give it to someone in
`## Desk people`, or a lead asks for it on the Desk's People tab. Request cards gain `size` and `approved`; older cards
need no change.

## 1.25.1 — 2026-11-03

**Upgrade:**
Nothing to do. Only a page test changes: the Desk's poll no longer takes the failure
that the test means for a dialog's send. The Desk itself does not change.

## 1.25.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). New request now asks how many
options to draw and whether to ask questions first (the bundled `grill-me` skill, action
`grill`); a request from an issue shows its user stories ([docs/requests.md](docs/requests.md)).
Older requests have neither and need nothing.

## 1.24.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The menu leads with Requests, New is
now **Changes**, and Next call is the **Presentation** filter on Requests, where each item is
marked presented ([docs/desk.md](docs/desk.md) → **The presentation**). Older `#call/C-12`
links still open there. No state changes.

## 1.23.0 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Recorded decisions upgrade
themselves (in force, their source as `origin`, author not recorded); new ones name who
decided and where ([docs/desk.md](docs/desk.md) → **Decisions**).

## 1.22.1 — 2026-11-03

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`): it stops counting a
bot's reaction as a vote. Scripts and skills are read per run; nothing else changes.

## 1.22.0 — 2026-11-03

**Upgrade:**
1. Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
   the Desk page ([docs/desk.md](docs/desk.md) → **Publishing the page**). The Issues page
   lists the current sprint (with its epics' issues), the next sprint, assigned and labelled
   issues; the backlog is gone, and the next issues run archives the cards of issues in no
   bucket ([docs/issues.md](docs/issues.md)).
2. New keys `issue_next_sprint` (`milestone`) and `issue_news_label` (`none`: off — offer it
   to the operator) ([docs/config.md](docs/config.md)). Re-run
   `bash "$HOME/scripts/verify-onboarding.sh" --config`.

## 1.21.0 — 2026-11-03

**Upgrade:**
1. Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**). The weekly digests move from New
   to **Product → History**, named by the days they cover; earlier ones keep their titles.

## 1.20.0 — 2026-11-03

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A request's card is simpler; research
and triage are written per [docs/requests.md](docs/requests.md) from the next request on.

## 1.19.1 — 2026-11-03

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The workspace keeps the screen
shown when the person switches options. Designs built from now on get the review bar's
Clickable switch, which outlines only what the design wires; built designs keep theirs.

## 1.19.0 — 2026-11-03

**Upgrade:**
1. Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
   the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**). Every item shows its number.
2. New key `desk_link` ([docs/config.md](docs/config.md)): unless it is set, write the Desk's
   share link ([docs/desk.md](docs/desk.md) → **Publishing the page**); it stays empty until
   the owner shared the Desk. Messages now carry an item's number and link
   ([docs/desk.md](docs/desk.md) → **Links to an item**).
3. Re-run `bash "$HOME/scripts/verify-onboarding.sh" --config`.

## 1.18.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The store adds `prefs` by itself.

## 1.17.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Change `work/CONFIG.md` only with
`design config write` from now on ([docs/config.md](docs/config.md) → **Writing the file**).

## 1.16.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
   the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**). The page gains the **Issues** tab.
2. Create the schedule `design-desk-issues-daily` over MCP exactly as
   [ONBOARDING.md](ONBOARDING.md) Step 5b defines it, unless `list_schedules` has it.
3. New keys `issue_news` (`disabled`), `issue_sprint` (`milestone`), `max_issue_drawings`
   (`5`), [docs/config.md](docs/config.md): offer the operator the Issues page — the planned
   issues that change the screens, each with what the UI will need, a picture of now and a
   sketch ([docs/issues.md](docs/issues.md)); `issue_news: enabled` turns it on.
4. Re-run `bash "$HOME/scripts/verify-onboarding.sh" --config`.

## 1.15.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). New request now asks how the person
pictures it and offers switches for installed skills; new key `request_skills`
([docs/config.md](docs/config.md)), never asked: nothing to add.

## 1.14.1 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, the page keeps its
narrow text and list columns on a wide window.

## 1.14.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
   the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).
2. Add `- slack_send: disabled` to `work/CONFIG.md` when missing, then re-run
   `bash "$HOME/scripts/verify-onboarding.sh"`. Off by default: `enabled` lets designers post
   pictures of a request's options to the Slack channel (**Send designs to Slack**); offer it
   to the operator when a channel is bound, never enable it yourself.

## 1.13.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A picture now keeps `marks` (from
`design diff`'s new `marks`, [docs/screens.md](docs/screens.md)) and an impact place its
`card`; older cards stay as they are and show no outline.

## 1.12.0 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). The server is unchanged.

## 1.11.1 — 2026-11-02

**Upgrade:**
Nothing — `~/bin/design` runs the toolkit from the checkout, so the new build check applies
once the change is pulled. A page it now refuses is a source missing one of its two
placeholders (`<!-- design:css -->`, `<!-- design:review-bar -->`), so fix the source, not
the build.

## 1.11.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). A change card's text is now capped and
every section needs `source.label` ([docs/watch.md](docs/watch.md) step 7); older cards stay
as they are. New key `change_due_days` (`21`, [docs/config.md](docs/config.md)): nothing to add.

## 1.10.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server first: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Every row in New and Requests shows where it came from and who started it. Requests filed
before keep what their `origin` already says.

## 1.9.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server first: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Elements and screens start keeping their earlier looks from their next redraw; older ones
come only from *Draw how it looked before* ([docs/catalog.md](docs/catalog.md) → History). No scheduled work is added.

## 1.8.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

New and Requests get a **Needs a designer** filter, and New opens on **All**. Change cards
written before this version have no `attention`, so they stay out of that filter.

## 1.7.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`) and republish the
Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Add `- slack_council: disabled` and
`- council_sync_min: 30` to `work/CONFIG.md` when missing, then re-run
`bash "$HOME/scripts/verify-onboarding.sh" --config`. Offer the operator `slack_council:
enabled` (needs a bound Slack channel): anyone in a request's Slack thread asks for design
changes and gets each new option or version back there as a before/after picture
([`slack-council`](.agents/skills/slack-council/SKILL.md)). While a thread is open, one inbox
run every `council_sync_min` minutes reads it.

## 1.6.0 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

## 1.5.0 — 2026-11-02

**Upgrade:**
Nothing — docs and the bundled skills are read from the checkout. A design asked for in Slack
now becomes a request on the Desk, and its options go back to the thread (the
`request-intake` action).

## 1.4.0 — 2026-11-02

**Upgrade:**
Restart the Desk server (`rc-service --user design-desk-server restart`), then republish
the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Designers now add a screen or a
part with **+ Add** in Product; a screen needs `screens: enabled`.

## 1.3.2 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, the Requests tab counts only the requests that wait for an answer.

## 1.3.1 — 2026-11-02

**Upgrade:**
1. Restart the Desk server: `rc-service --user design-desk-server restart`.
2. Then republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
   ([docs/desk.md](docs/desk.md) → **Publishing the page**).

Both steps are safe to repeat. They cover the Desk server restart and the page republish
of every crossed block ([docs/persistence.md](docs/persistence.md) → **Migration**, step 1).

## 1.3.0 — 2026-11-02

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**), then restart the Desk server
(`rc-service --user design-desk-server restart`). From now on `design desk agenda` only
suggests a card; a designer puts it on the next call. Cards already on it stay.

## 1.2.1 — 2026-11-01

**Upgrade:**
Republish the Desk page: `update_artifact` on `desk_artifact` with `desk/page.html`
([docs/desk.md](docs/desk.md) → **Publishing the page**). Until then, its dialogs send nothing.

## 1.2.0 — 2026-11-01

**Upgrade:**
Nothing — docs are re-read per run. The configuration keys moved from `CLAUDE.md` to
[docs/config.md](docs/config.md); `work/CONFIG.md` does not change.

## 1.1.1 — 2026-11-01

**Upgrade:**
Nothing — the test runner and docs are read from the checkout.

## 1.1.0 — 2026-11-01

**Upgrade:**
Republish the Desk page ([docs/desk.md](docs/desk.md) → **Publishing the page**): its header gains a day / night switch.

## 1.0.1 — 2026-10-31

**Upgrade:**
Nothing — the test runner and docs are read from the checkout.

## 1.0.0 — 2026-10-31

**Upgrade:**
Nothing — initial version; onboarding records it (`work/VERSION`).
