# Logging

Two layers, both under `work/`, both append-only.

- **Per-run lines**: `work/WATCH.log` (`<ISO> changes_due=N skipped=N deferred=N seen=N`),
  `work/INBOX.log` (`<ISO> due=N expiring=N`), `work/ISSUES.log` (`<ISO> read=N draw=N
  move=N close=N deferred=N`), `work/AUDIT.log` (`<ISO> ok=N warn=N red=N
  sent=<chat|slack>`). The pre-flight writes the `WATCH`, `INBOX` and `ISSUES` lines; the
  audit run writes `AUDIT.log`.
- **Events**: `work/logs/events-YYYY-MM-DD.jsonl` through `scripts/log.sh`
  (`logev <level> <event> <message>`), one JSON object per line:
  `{ts, run, job, level, event, msg}`. Secrets are masked before the write (GitHub and
  Slack tokens, bearer headers, the Desk agent token, `password=` values). `debug` lines
  only under `log_level: debug`. The audit deletes files older than 14 days.

## Events

| Event | Level | Written by | When |
| --- | --- | --- | --- |
| `preflight` | info / error | `preflight.sh` | a pass's decision, or why it could not decide |
| `precheck` | info / error | `precheck.sh` | a gate's verdict |
| `change_claim`, `change_done`, `change_skip`, `change_fail` | info / warn | `ledger.sh` | a change card's ledger row |
| `issue_claim`, `issue_done`, `issue_skip`, `issue_fail` | info / warn | `ledger.sh --issues` | an issue's row for the Issues page |
| `ledger_lock` | warn | `ledger.sh` | a dead writer's lock was removed |
| `github_sync` | warn | the agent (watch run) | an issue or pull request `design desk github-sync` could not read |
| `card_written` | info | the agent | after `design desk upsert`: `R-<n> <kind> <status>` |
| `item_done` | info | the agent | after `design desk done`: `Q-<n> <outcome>` |
| `guard` | info / warn | the agent | `R-<n> ok=<bool> files=<n> refused=<n>` |
| `prototype` | info / error | the agent | `R-<n> <verb> <state>` (create, up, update, live, failed, extended, deleted) |
| `notified` | info | the agent | a Slack announcement went out |
| `handoff` | info | the agent | `R-<n> <desk\|issue\|draft-pr> <url or ->` |
| `api_failure`, `classifier_block`, `tool_failure` | error / warn | the agent (or a hook) | the model or a tool failed |

The agent writes its events with `bash -c '. "$HOME/scripts/log.sh"; logev info card_written "P-12 change new"'`
or the same three arguments from any script that sources `log.sh`. The monitor reads
`api_failure`, `classifier_block`, `precheck` and `backup` events; their `msg` grammar is the
one above, so a line written by hand matches it.

The Desk server logs to `~/.local/state/rc/design-desk-server.log` (openrc's log of the Login
item): one line per start and per server error, never a request body.
