# Configuration keys

Every key of `work/CONFIG.md`, with its default in parentheses. The parsing contract and the
missing-file rule are in [CLAUDE.md](../CLAUDE.md) → **Runtime configuration**. Every run
loads `work/CONFIG.md` at run start; a gated run also gets the values resolved in its
worklist's `config`. A missing key takes its default.

**Writing the file.** An existing `work/CONFIG.md` is never edited in place, onboarding
included: `design config sha` gives its fingerprint, edit a copy, then
`design config write <copy> --from <sha>`. It writes under `work/.CONFIG.lock` only when the
file is unchanged; exit 3 means another writer came first (a lead's roster row through
`design desk person`): read the file again and redo the change.

- `display_name` (`Design Desk`) — the Desk's title.
- `repos` — comma-separated `[host/]owner/name` the watch reads (default `none`: no watch);
  `watch_since` — ISO time, written at onboarding: a PR merged earlier never gets a card;
  `max_changes_per_run` (`10`); `watch_paths` — UI globs for a repo without a profile;
  `watch_open_prs` (`enabled`) — open PRs get cards too; `issue_label` (`design`; `none` off) —
  issues with it become `feature` requests; `proposals` (`enabled`), `max_proposals_per_week`
  (`3`) — design proposals for new features.
- `profile` — `auto` (the one `.design-desk/*/profile.json` of each repo) | `<repo>:<dir>`;
  `default_style` — `auto` | `brand` | `carbon` | `wireframe` | `repo:<owner/name>`.
- `prototype_requesters` (`designer, lead`), `max_prototypes` (`2`; `0` = none),
  `prototype_expiry_days` (`7`), `prototype_remote` (`none` | the repo a prototype branch
  is pushed to); `handoff` — `desk` (default) | `issue` | `draft-pr`, for ideas and
  proposals; `issue_writeback` (`enabled`) — a feature's design goes back into its issue;
  `implementer` — `pr-comment` (default) | `issue`, how an adjustment or a bug reaches the
  coding agent; `implementer_mention` — its handle, the comment's first line (empty: none).
- `desk_ping` (`enabled`) — the page wakes you at once; `desk_artifact` — the Desk page's
  id, written when it is first published; `desk_link` — its share link, written once the owner
  shared it; items' links are built from it (empty: no **Copy link**,
  [desk.md](desk.md) → Links to an item); `bug_reports` (`enabled`) — Slack messages about
  a UI bug go on the Desk's queue; `notify` — `disabled` (default) | `slack`:
  announce new cards and request steps in the bound channel.
- `run_model` (`default`), `dispatch` (`enabled`), `work_repo` (`none`; env
  `GITHUB_REPO_WORK` wins), `audit_report` (`enabled`), `log_level` (`info` | `debug`).
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
- `slack_polls` (`disabled`) — `enabled`: designers and developers share options in Slack for 👍 / ⚠️ votes
  and replies (the `slack-polls` skill); `slack_poll_channel` — where (empty: the bound channel).
- `slack_send` (`disabled`) — `enabled`: **Send designs to Slack** posts pictures of a request's
  options to `slack_poll_channel` (the `slack-polls` skill → Send); a request from Slack has the
  button whatever this says, and its pictures go to its own thread.
- `slack_council` (`disabled`) — `enabled`: anyone in a request's Slack thread asks for changes
  and gets new options or versions back there (the `slack-council` skill); `council_sync_min`
  (`30`) — how often an open thread is read for asks that do not mention the agent.
- `figma` (`disabled`) — `enabled` once Figma is connected (the `figma` skill); `figma_file` —
  a Figma file link that exports go to (empty: a new file per request).
- `## Skills` table, `| action | skill |`: another installed skill for an action
  ([actions.md](actions.md)); it wins over the product profile's choice.
- `request_skills` (`copy, impact, brand, walkthrough, figma`), never asked — the installed
  skills a person switches on or off for one request in New request; one not installed is
  not offered, `figma` only with `figma` enabled ([requests.md](requests.md) → Variants).
- `change_due_days` (`21`), never asked — days a change card may wait for a designer to
  mark it handled before the Desk shows it red as overdue; `0`/`off` disables.
- Monitor thresholds, never asked: `model_alert_threshold` (2), `classifier_alert_threshold`
  (20), `heartbeat_gap_min` (60) — `0`/`off` disables.
- `## Desk people` table, `| email | role |`: `lead`, `designer`, `pm` or `developer`;
  anyone else on the share list is a `guest`; the owner is always `lead`. A lead may ask
  on the Desk for a new row ([desk.md](desk.md) → People).
