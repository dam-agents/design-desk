# Changelog

**Migration instructions, not a change log.** Per version, the idempotent **Upgrade**
steps a deployed instance applies when crossing it — what to run, update, or change
(schedules, config keys, state formats). Most versions need nothing. What changed and
why lives in the PR and commit history, not here. Consumed by the version check
([docs/persistence.md](docs/persistence.md) → **Definition version & upgrade**);
authoring rules: [docs/self-modification.md](docs/self-modification.md) §12.

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
