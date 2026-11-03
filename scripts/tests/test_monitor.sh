#!/usr/bin/env bash
# The monitor's detector reads local files only. A time nobody can read
# (scripts/lib/time.sh) never hides a condition: an inbox item it cannot date is
# reported as stuck, a claim it cannot date is no claim, and a ledger row it cannot date
# is old and leaves. A time written with an offset is read.
. "$(dirname "$0")/lib.sh"
mkdir -p "$DESK_DIR"
recent_off="$(date -u -d '55 minutes' +%Y-%m-%dT%H:%M:%S+01:00 2>/dev/null || date -u -v+55M +%Y-%m-%dT%H:%M:%S+01:00)"
cat > "$DESK_DIR/inbox.json" <<JSON
{"open":[
 {"id":"I-1","kind":"question","created":"$recent_off"},
 {"id":"I-2","kind":"question","created":"not a date"},
 {"id":"I-3","kind":"question","created":"2001-01-01T01:00:00+01:00"}],"claimed":[]}
JSON
cat > "$WORK_DIR/MONITOR.json" <<JSON
{"alerts":{
 "inbox:I-2":{"kind":"inbox_stuck","first":"$recent_off","claimed":"not a date"},
 "model:1":{"kind":"model_unavailable","first":"not a date"},
 "model:2":{"kind":"model_unavailable","first":"$recent_off","sent":"$recent_off"}}}
JSON
out="$(bash "$ROOT/scripts/monitor.sh")"
assert "an item it cannot date is stuck, a fresh offset one is not" \
  '[.alerts_due[] | select(.kind == "inbox_stuck") | .items] == [["I-2", "I-3"]]' "$out"
assert "a claim it cannot date is no claim: the alert is due again" '[.alerts_due[].id] | index("inbox:I-2") != null' "$out"
state="$(cat "$WORK_DIR/MONITOR.json")"
assert "a row it cannot date is old and leaves, a fresh offset one stays" \
  '(.alerts | has("model:1") | not) and (.alerts | has("model:2"))' "$state"
assert "the claim is written afresh" '.alerts["inbox:I-2"].claimed | test("Z$")' "$state"
finish
