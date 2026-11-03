#!/usr/bin/env bash
# The ISO 8601 reader the pre-flight and the monitor share (scripts/lib/time.sh):
# one instant whatever the offset says, and null for anything it cannot read — a date
# it cannot read must never count as "long ago" (that closed a Slack vote a minute after
# it opened: 2026-11-03, C-35/P-1).
. "$(dirname "$0")/lib.sh"
. "$ROOT/scripts/lib/time.sh"

ep() { jq -nc --arg v "$1" "$EPOCH_JQ"' $v | epoch'; }

# 2026-11-04T14:00:00Z is the instant every one of these names
for v in 2026-11-04T14:00:00Z 2026-11-04T15:00:00+01:00 2026-11-04T09:00:00-05:00 \
         2026-11-04T14:00:00.123456Z 2026-11-04T15:00:00+0100 2026-11-04T09:00:00-0500; do
  assert "$v is 14:00 UTC" '. == 1793800800' "$(ep "$v")"
done
assert "no offset reads as UTC" '. == 1793800800' "$(ep 2026-11-04T14:00:00)"

for v in "" "not a date" "2026-11-04" "2026-11-04T14:00" "2026-13-40T99:99:99Z"; do
  assert "\"$v\" is unreadable, not the epoch" '. == null' "$(ep "$v")"
done
assert "null is unreadable" '. == null' "$(jq -nc "$EPOCH_JQ"' null | epoch')"
assert "a number is unreadable" '. == null' "$(jq -nc "$EPOCH_JQ"' 5 | epoch')"
assert "the older name ep agrees with epoch" '. == true' \
  "$(jq -nc "$EPOCH_JQ"' ("2026-11-04T15:00:00+01:00" | ep) == ("2026-11-04T15:00:00+01:00" | epoch)')"

finish
