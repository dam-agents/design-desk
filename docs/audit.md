# Audit run

Weekly, ungated: `bash "$HOME/scripts/preflight.sh" audit` prints the deterministic checks;
this run adds the judgment checks and sends one report. It is **read-only toward everything
outside `work/`** and repairs nothing: a finding is reported, the fix is the operator's or the
next run's.

## Judgment checks

1. **Schedules** — `mcp__platform-outbound__list_schedules`: the four `design-desk-*`
   schedules exist, are enabled (or knowingly off), fire (`status.lastRun` within 1.5× the
   cron's interval) and match `kit.yaml`: task text, `precheck` on watch, inbox and monitor,
   none on the audit, `model` = `run_model` (none under `default`). Report drift; changing a
   schedule is the operator's call.
2. **The Desk** — the page artifact `desk_artifact` still exists (`list_artifacts` or a
   `get`); the server answered (`checks.desk_server`); requests older than 14 days without a
   step (status unchanged, no thread activity) are listed by id and title.
3. **Environments** — `list_environments` against the cards: an Environment no live card
   names is an orphan (report it; the operator decides), a live card whose Environment is
   gone is stale (report it).
4. **Sample three cards** written this week: a source for every "why", screens that show the
   change, no file paths in `what` and `why`, the `language` configured.
5. **Failures** — every `failures[]` signature from the pass: cause and fix, classified
   environment / agent mistake / definition bug. A verified environment cause becomes a line
   in `work/LESSONS.md`; a definition bug is reported in full in the report (this agent files
   no issue on its own definition repository).
6. **Spend** — `mcp__platform-outbound__get_metrics` (`days: 7`, `granularity: summary`):
   the week's attributed spend and its busiest model against `run_model`.

## Report

One message to the chat UI (and to the bound Slack channel only when `notify` is `slack`
and `audit_report` is `enabled`):

```
🩺 *Design Desk weekly audit* — <date> · 🟢 N ok · 🟡 N warn · 🔴 N fail

*Week in numbers*
• Changes carded <n> · questions answered <n> · requests <open>/<handed off> · live prototypes <n>
• Spend: $<actual> · model <busiest>

*Checks*
🔴 <id> — <detail>
🟡 <id> — <detail>
🟢 all other checks passed (<count>)

*Action needed*: <one line per item, or "none">
```

Always sent, green or not. Then append `<ISO> ok=<n> warn=<n> red=<n> sent=<chat|slack>` to
`work/AUDIT.log` and back up `work/`.
