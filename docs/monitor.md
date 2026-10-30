# Monitor — the agent's health alerts

Read on every **monitor run** (the `design-desk-monitor-15m` schedule). The work
heartbeat decides work only; every health alert is the monitor's.
`scripts/precheck.sh monitor` runs `scripts/monitor.sh` once per fire: local files only —
the events log, ledgers, the Desk's inbox file — and one loopback call to the Desk server;
no external call, no write beyond its own ledger and log. An idle fire starts no session.

## The alerts

| Kind | Condition | Clears when |
| --- | --- | --- |
| `model_unavailable` | `model_alert_threshold` (missing = `2`; `0`/`off` disables) runs ended on an availability-class `api_failure` in one outage — failures under 60 min apart | — (one alert per outage) |
| `model_recovered` | the outage is over and its `model_unavailable` went out while it was open | — (once per outage) |
| `classifier_spike` | `classifier_alert_threshold` (missing = `20`; `0`/`off` disables) `classifier_block` events in 24 h | — (once per UTC day) |
| `heartbeat_gap` | no gate tick of the inbox schedule for `heartbeat_gap_min` (missing = `60`) | the gate ticks again |
| `backup_failing` | a backup error no later push cleared for 6 h (only with a state remote) | the next push |

Domain conditions:

| Alert | Condition | Clears when |
| --- | --- | --- |
| `desk_down` | the Desk server did not answer `127.0.0.1:5555/health` on two ticks in a row | it answers again |
| `inbox_stuck` | an inbox item has waited open for more than 2 h (the inbox schedule or the pings are not working) | no open item is older than 2 h |

**The ledger** — `work/MONITOR.json`: an `alerts_due` entry is claimed when emitted and
due again 30 min later until `monitor.sh ack <id>…` records it as sent, so a session that
died before its ack loses nothing. A sent alert is never emitted again (`suppressed`); a
condition that clears leaves the ledger, so its return alerts again.

## Monitor run

1. Read the worklist. Each `alerts_due` entry carries its `id`, its `kind` and the facts
   of its row above.
2. Send **one message** for the whole run, in the chat UI: one line per alert — what
   happened, when (UTC), the numbers, the likely cause and the one operator action, if
   any:
   - `model_unavailable` / `model_recovered` — first and last failure, runs lost, the
     classes (`server_error`, `overloaded` → the provider or the gateway;
     `authentication_failed` → credentials, operator-only; `rate_limit`, `billing_error`
     → quota or budget). Missed work recovers on the next heartbeat by itself.
   - `classifier_spike` — the top patterns; a documented step of the agent that is
     refused is a definition problem for the operator, anything else is a refusal that
     stands.
   - `heartbeat_gap` — the inbox schedule is disabled, deleted or its gate cannot start
     (`mcp__platform-outbound__list_schedules`).
   - `backup_failing` — the sample error; [persistence.md](persistence.md).
   - `desk_down` — the Desk page cannot load or save anything; the server's log is
     `~/.local/state/rc/design-desk-server.log`; [desk.md](desk.md) → Server.
   - `inbox_stuck` — the items and how long they wait; check the inbox schedule.
3. **After the send**, `bash "$HOME/scripts/monitor.sh" ack <every id of alerts_due>`.
   A failed send is logged and not acknowledged: the next tick after the claim retries.
4. Back up `work/` (`scripts/work-backup.sh persist`).

The monitor is a signal, not a repair: never clear a lock, re-run work, change a
threshold, edit settings or retry a refused action in response.

## Self-check

- Every `alerts_due` entry is in the one message, and acknowledged after the send —
  never before, never on a failed send.
- Nothing repaired, re-run or reconfigured in response.
