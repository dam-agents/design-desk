# Configuration keys

Every key of `work/CONFIG.md`, with its default in parentheses. The parsing contract and the
missing-file rule are in [CLAUDE.md](../CLAUDE.md) → **Runtime configuration**. Every run
loads `work/CONFIG.md` at run start; a gated run also gets the values resolved in its
worklist's `config`. A missing key takes its default.

**Writing the file.** An existing `work/CONFIG.md` is never edited in place, onboarding
included: `design config sha` gives its fingerprint, edit a copy, then
`design config write <copy> --from <sha>`. It writes under `work/.CONFIG.lock` only when the
file is unchanged; exit 3 means another writer came first (an admin's roster row through
`design desk person`): read the file again and redo the change.

- `display_name` (`Design Desk`) — the Desk's title.
- `repos` — comma-separated `[host/]owner/name` the watch reads (default `none`: no watch);
  `watch_since` — ISO time, written at onboarding: a PR merged earlier never gets a card
  (the hourly search starts later by itself, two days before the last pass that left nothing
  behind or at the oldest change still due: `work/.watch-cursor`);
  `max_changes_per_run` (`10`); `watch_paths` — UI globs for a repo without a profile;
  `watch_open_prs` (`enabled`) — open PRs get cards too; `ci_gate` (`disabled`) — `enabled`:
  Design Desk's check on GitHub passes an open PR nobody needs to look at and fails one that
  waits for a designer or a lead developer until it is marked handled. It covers new cards as they
  are written and, through the inbox run, the open cards already on the Desk when it is
  turned on; a merged or closed PR is never touched ([watch.md](watch.md) → CI gate); `issue_label` (`design`; `none` off) —
  issues with it become `feature` requests; `proposals` (`enabled`), `max_proposals_per_week`
  (`3`) — design proposals for new features.
- `profile` — `auto` (the one `.design-desk/*/profile.json` of each repo) | `<repo>:<dir>`;
  `default_style` — `auto` | `brand` | `carbon` | `wireframe` | `repo:<owner/name>`.
- `prototype_requesters` (`designer, pm, admin`; roles read as in `## Desk people`, so `lead developer`
  is `lead-developer`), `max_prototypes` (`2`; `0` = none),
  `prototype_expiry_days` (`7`), `spec_review` (`enabled`) — a person reads, edits and sends the developer spec before it leaves the Desk ([handoff.md](handoff.md) → Review before it goes; `disabled`: it goes on its own, save a request from Slack), `prototype_remote` (`none` | the repo a prototype branch
  is pushed to); `handoff` — `desk` (default) | `issue` | `draft-pr`, for ideas and
  proposals; `issue_writeback` (`enabled`) — a feature's design goes back into its issue;
  `implementer` — `pr-comment` (default) | `issue`, how an adjustment or a bug reaches the
  coding agent; `implementer_mention` — its handle, the comment's first line (empty: none).
- `desk_ping` (`enabled`) — the page wakes you at once; `desk_artifact` — the Desk page's
  id, written when it is first published; `desk_link` — its share link, written once the owner
  shared it; items' links are built from it (empty: no **Copy link**,
  [desk.md](desk.md) → Links to an item); `bug_reports` (`enabled`) — Slack messages about
  a UI bug go on the Desk's queue; `qa_bot` — the Slack user id whose messages count as
  automated test findings (empty: none; the `intake-slack` skill); `notify` — `disabled` (default) | `slack`:
  announce new cards and request steps in the bound channel.
- `run_model` (`default`), `dispatch` (`enabled`), `work_repo` (`none`; env
  `GITHUB_REPO_WORK` wins), `audit_report` (`enabled`), `agent_manifest` (`dam`: publish the
  public agent manifest in `docs/manifest.md`; `off`: keep it local), `log_level` (`info` | `debug`).
- `decisions_page` (`off`) — `dam`: every decision on the Desk, without names, on one public
  text page for coding agents, republished daily when it changed ([decisions-page.md](decisions-page.md)).
- `screens` (`disabled`) — `enabled`: the agent keeps its own install of the product for
  screenshots and for people to try ([screens.md](screens.md)); `max_screen_prs` (`2`) — open pull
  requests with an install of their own.
- `issue_news` (`disabled`) — `enabled`: the Desk's Issues page, the open issues that change
  the screens, read once a day ([issues.md](issues.md)); `issue_sprint` (`milestone`: the open
  milestone due next | a milestone's title | `none`) — the current sprint; `issue_next_sprint`
  (`milestone`: the open milestone due after it | a title | `none`) — the next sprint;
  `issue_news_label` (`none`) — a label whose open issues are listed too;
  `max_issue_drawings` (`5`) — issues drawn a day.
- `digest` (`desk`) — where the weekly UX digest goes: `desk` | `slack` (the Desk and the
  bound channel) | `disabled`.
- `slack_polls` (`disabled`) — `enabled`: designers, PMs and developers share options in Slack for 👍 / 👎 votes
  and replies (the `slack-polls` skill); `slack_poll_channel` — where (empty: the bound channel); a request from Slack votes in its own thread.
- `slack_send` (`disabled`) — `enabled`: **Send to Slack… → Send the designs** posts pictures of a request's
  options to `slack_poll_channel` (the `slack-polls` skill → Send); a request from Slack has the
  button whatever this says, and its pictures go to its own thread.
- `slack_council` (`disabled`) — `enabled`: anyone on the roster in a request's Slack thread asks for changes
  and gets new options or versions back there (the `slack-council` skill); `council_sync_min`
  (`30`) — how often an open thread is read for asks that do not mention the agent.
- `slack_stale_days` (`0`, off) — a whole number: a request asked for in Slack whose card has not changed
  for that many days gets one reminder in its thread, its author tagged ([requests.md](requests.md) → A request that stands still).
- `figma` (`disabled`) — `enabled` once Figma is connected (the `figma` skill): imports, exports
  and the comparisons with Figma on the Desk (Product → Differences, the box on items;
  [desk.md](desk.md) → Differences from Figma), each person able to hide them with the Figma
  switch in their menu. `figma_file` — a Figma file link that exports go to (empty: a new
  file per request).
- `## Skills` table, `| action | skill |`: another installed skill for an action
  ([actions.md](actions.md)); it wins over the product profile's choice. A third column
  `| source |` holds the `<repo>@<sha>` the operator confirmed for a profile's skill; a
  profile's skill does an action only with a row whose pin matches its `source`.
- `request_skills` (`copy, impact, brand, walkthrough, figma`), never asked — the installed
  skills a person switches on or off for one request in New request; one not installed is
  not offered, `figma` only with `figma` enabled ([requests.md](requests.md) → Variants).
- `change_due_days` (`21`), never asked — days a change card may wait for a designer to
  mark it handled before the Desk shows it red as overdue; `0`/`off` disables.
- `change_auto_handled_days` (`14`), never asked — days after its PR merged that a change
  nobody marked handled moves from Open and Needs a designer to **Auto handled**; `0`/`off` disables
  that move only: a change judged `fyi` is auto handled at once whatever the value.
- `pr_environment_days` (`7`), never asked — days a pull request's own environment (a change
  card's `environment`, [watch.md](watch.md) step 7) runs after it was deployed, when the platform
  gives no expiry for it; past it the card shows the link greyed out as gone. `0`/`off`: never
  shown as gone without that expiry.
- Monitor thresholds, never asked: `model_alert_threshold` (2), `classifier_alert_threshold`
  (20), `heartbeat_gap_min` (60) — `0`/`off` disables.
- `## Desk people` table, `| email | role |`: `admin`, `designer`, `lead-developer`, `developer` or `pm`;
  one person's `email` cell may list several addresses, separated by commas — the one they sign in
  to the Desk with and the one Slack or GitHub knows them by — and every one counts as them;
  an optional third column `| name |` gives the name the Desk shows instead of the address;
  anyone else on the share list is a `guest`; the owner is always `admin` (a row still written `lead`, its name before 1.59.0, reads as `admin`). An admin may ask
  on the Desk for a new row ([desk.md](desk.md) → People).
