#!/usr/bin/env bash
# The inbox pre-flight reads the Desk's inbox file and nothing else.
. "$(dirname "$0")/lib.sh"
printf -- '- dispatch: enabled\n' > "$WORK_DIR/CONFIG.md"
mkdir -p "$WORK_DIR/desk"

assert "no inbox file is quiet" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" inbox)"

old="$(date -u -d '5 hours ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-5H +%Y-%m-%dT%H:%M:%SZ)"
new="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "$WORK_DIR/desk/inbox.json" <<JSON
{"updated":"$new","open":[
 {"id":"I-1","kind":"question","card":"C-1","thread":"T-1","created":"$new"},
 {"id":"I-2","kind":"request","card":"C-2","thread":null,"created":"$new"},
 {"id":"I-3","kind":"build","card":"C-2","thread":null,"created":"$new"},
 {"id":"I-6","kind":"map","card":"C-5","thread":null,"created":"$new"},
 {"id":"I-7","kind":"person","card":null,"thread":null,"created":"$new","person":{"email":"alex@example.com","role":"pm"}},
 {"id":"I-8","kind":"person","card":null,"thread":null,"created":"$new"},
 {"id":"I-9","kind":"decision","card":"C-1","thread":"T-1","created":"$new"},
 {"id":"I-10","kind":"decision-check","card":"C-2","thread":null,"created":"$new"},
 {"id":"I-11","kind":"ci","card":"C-6","thread":null,"created":"$new"}],
 "claimed":[
 {"id":"I-4","kind":"explore","card":"C-3","thread":null,"created":"$old","claimed_by":"s1","claimed_at":"$old"},
 {"id":"I-5","kind":"handoff","card":"C-4","thread":null,"created":"$new","claimed_by":"s2","claimed_at":"$new"}]}
JSON
cat > "$WORK_DIR/desk/db.json" <<JSON
{"cards":{"C-2":{"id":"C-2","kind":"request","status":"testing","prototype":{"state":"live","env":"r2","expires":"$new"}}}}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "work due" '.nothing_to_do == false' "$out"
assert "question sorted" '[.questions_due[].id] == ["I-1"]' "$out"
assert "slack_send reaches the worklist config, off by default" '.config.slack_send == "disabled"' "$out"
assert "request sorted" '[.requests_due[].id] == ["I-2"]' "$out"
assert "build sorted" '[.prototypes_due[].id] == ["I-3"]' "$out"
assert "a screen someone added sorted" '[.map_due[].id] == ["I-6"]' "$out"
assert "a person an admin asked for sorted, with no card; one without its payload is not due" '[.people_due[] | select(.card == null) | .person.email] == ["alex@example.com"]' "$out"
assert "a comment to record as a decision sorted" '[.decisions_due[].id] == ["I-9"]' "$out"
assert "a check against the decisions sorted" '[.checks_due[].id] == ["I-10"]' "$out"
assert "a handled mark on a held pull request sorted" '[.ci_due[].id] == ["I-11"]' "$out"
assert "stale claim taken over" '[.variants_due[] | select(.takeover) | .id] == ["I-4"]' "$out"
assert "fresh claim left alone" '[.handoffs_due[].id] == []' "$out"
assert "expiring prototype" '[.expiring_due[].card] == ["C-2"]' "$out"
assert "read_set covers the arrays" '(.read_set | index("docs/prototype.md")) and (.read_set | index("docs/requests.md")) and (.read_set | index(".agents/skills/explain/SKILL.md")) and (.read_set | index("docs/map.md"))' "$out"

# Fan-out: the first expensive item stays, the others get units.
wl="$TMPDIR/wl.json"; printf '%s' "$out" > "$wl"
plan="$(bash "$ROOT/scripts/dispatch.sh" plan "$wl")"
assert "three units (I-4 explore, I-3 build, I-6 map), I-2 stays" '[.[].id] == ["I-4", "I-3", "I-6"]' "$plan"
assert "a unit names its file, not the item text" '.[0].task | test("worklist is already computed") and test("I-4")' "$plan"
u="$(printf '%s' "$plan" | jq -r '.[0].worklist')"
assert "the unit holds its one item and no quick ones" '(.variants_due | length == 1) and (.questions_due == null) and (.people_due == null) and (.decisions_due == null) and (.checks_due == null) and (.ci_due == null) and (.dispatched.id == "I-4")' "$(cat "$u")"
rest="$(bash "$ROOT/scripts/dispatch.sh" rest "$wl" I-4 I-3)"
assert "the rest keeps the first and the quick ones" '(.prototypes_due | length == 0) and (.requests_due | length == 1) and (.questions_due | length == 1) and (.decisions_due | length == 1) and (.checks_due | length == 1) and (.ci_due | length == 1)' "$(cat "$(printf '%s' "$rest" | jq -r .worklist)")"
printf -- '- dispatch: disabled\n' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"; printf '%s' "$out" > "$wl"
assert "dispatch disabled keeps all" 'length == 0' "$(bash "$ROOT/scripts/dispatch.sh" plan "$wl")"

printf '{"updated":"%s","open":[{"id":"I-10","kind":"states","card":"C-2","thread":null,"created":"%s","variant":"v1"}],"claimed":[]}' "$new" "$new" > "$WORK_DIR/desk/inbox.json"
assert "every state of a part sorted with the variants, its option kept" '[.variants_due[] | [.id, .kind, .variant]] == [["I-10", "states", "v1"]]' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
printf '{"updated":"%s","open":[],"claimed":[]}' "$new" > "$WORK_DIR/desk/inbox.json"; rm "$WORK_DIR/desk/db.json"
assert "empty inbox is quiet" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" inbox)"

# An open Slack vote with no inbox item is due to sync every 30 minutes, and to close on
# its date or once its request moved on.
recent="$(date -u -v-5M +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"
cat > "$WORK_DIR/desk/db.json" <<JSON
{"version":1,"cards":{
 "C-5":{"id":"C-5","kind":"request","status":"feedback","polls":[{"id":"P-1","state":"open","closes":"2099-01-01T00:00:00Z","synced":"$recent"},{"id":"P-2","state":"open","closes":"2099-01-01T00:00:00Z","synced":null}]},
 "C-6":{"id":"C-6","kind":"request","status":"handed-off","polls":[{"id":"P-3","state":"open","closes":"2099-01-01T00:00:00Z","synced":"$recent"}]}}}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "polls due: never synced, and the one whose request moved on" '[.polls_due[] | [.id, .close]] == [["P-2", false], ["P-3", true]]' "$out"
assert "the slack-polls skill is read" '.read_set | index(".agents/skills/slack-polls/SKILL.md")' "$out"
assert "the explain skill is read whatever is due" '(.questions_due | length) == 0 and (.read_set | index(".agents/skills/explain/SKILL.md")) != null' "$out"

# A closing time is a time in whatever offset it is written (a vote was closed a minute
# after it opened because a "+01:00" value read as the epoch), and a closing time nobody
# can read never closes a vote at all.
cat > "$WORK_DIR/desk/db.json" <<JSON
{"version":1,"cards":{
 "C-8":{"id":"C-8","kind":"request","status":"feedback","polls":[
   {"id":"P-4","state":"open","closes":"2099-01-01T01:00:00+01:00","synced":null},
   {"id":"P-5","state":"open","closes":"not a date","synced":null},
   {"id":"P-6","state":"open","closes":"2001-01-01T01:00:00+01:00","synced":null}]}}}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "an offset closing time is read, an unreadable one never closes" \
  '[.polls_due[] | [.id, .close]] == [["P-4", false], ["P-5", false], ["P-6", true]]' "$out"

# An open council is read every council_sync_min minutes while slack_council is on; it
# closes once its request moved on, or three days after the thread's last message.
old_ts="$(( $(date -u +%s) - 4 * 86400 )).000100"; new_ts="$(date -u +%s).000100"
cat > "$WORK_DIR/desk/db.json" <<JSON
{"version":1,"cards":{
 "C-7":{"id":"C-7","kind":"request","status":"feedback","councils":[
  {"id":"S-1","state":"open","opened":"$old","synced":"$recent","seen":"$new_ts"},
  {"id":"S-2","state":"open","opened":"$old","synced":null,"seen":"$new_ts"},
  {"id":"S-3","state":"open","opened":"2026-01-01T00:00:00Z","synced":"$recent","seen":"$old_ts"},
  {"id":"S-4","state":"closed","opened":"$old","synced":null}]},
 "C-8":{"id":"C-8","kind":"request","status":"handed-off","councils":[{"id":"S-5","state":"open","opened":"$old","synced":"$recent","seen":"$new_ts"}]}}}
JSON
assert "councils wait while slack_council is off" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
printf -- '- slack_council: enabled\n' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "councils due: never read, idle, and moved on" '[.councils_due[] | [.id, .close, .why]] == [["S-2", false, null], ["S-3", true, "idle"], ["S-5", true, "moved"]]' "$out"
assert "the slack-council skill is read" '.read_set | index(".agents/skills/slack-council/SKILL.md")' "$out"

# A claim is a 15-minute renewable lease, not the old two-hour lock.
stale="$(date -u -d '20 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-20M +%Y-%m-%dT%H:%M:%SZ)"
live="$(date -u -d '10 minutes ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-10M +%Y-%m-%dT%H:%M:%SZ)"
cat > "$WORK_DIR/desk/inbox.json" <<JSON
{"updated":"$new","claim_ttl_min":15,"open":[],"claimed":[
 {"id":"I-12","kind":"explore","card":"C-7","thread":null,"created":"$new","claimed_by":"s3","claimed_at":"$stale"},
 {"id":"I-13","kind":"explore","card":"C-7","thread":null,"created":"$new","claimed_by":"s4","claimed_at":"$live"}]}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "a stale lease is due, a 10-minute heartbeat holds a 15-minute one" '[.variants_due[] | [.id, .takeover]] == [["I-12", true]]' "$out"
printf -- '- slack_council: enabled\n- council_sync_min: 1\n' > "$WORK_DIR/CONFIG.md"
assert "a shorter interval reads the recent one too" '[.councils_due[].id] | index("S-1")' "$(bash "$ROOT/scripts/preflight.sh" inbox)"

# A time nobody can read (scripts/lib/time.sh) never closes, expires or idles anything, and
# a claim or a sync time nobody can read is stale; a time written with an offset is read.
# One such value must not stop the whole pass (jq cannot subtract null).
recent_off="$(date -u -d '55 minutes' +%Y-%m-%dT%H:%M:%S+01:00 2>/dev/null || date -u -v+55M +%Y-%m-%dT%H:%M:%S+01:00)"
soon_off="$(date -u -d '3 hours' +%Y-%m-%dT%H:%M:%S+01:00 2>/dev/null || date -u -v+3H +%Y-%m-%dT%H:%M:%S+01:00)"
printf -- '- slack_council: enabled\n' > "$WORK_DIR/CONFIG.md"
cat > "$WORK_DIR/desk/inbox.json" <<JSON
{"updated":"$new","open":[],"claimed":[
 {"id":"I-9","kind":"explore","card":"C-10","thread":null,"created":"$new","claimed_by":"s3","claimed_at":"not a date"},
 {"id":"I-10","kind":"explore","card":"C-10","thread":null,"created":"$new","claimed_by":"s4","claimed_at":"$recent_off"},
 {"id":"I-11","kind":"explore","card":"C-10","thread":null,"created":"$new","claimed_by":"s5","claimed_at":"2001-01-01T01:00:00+01:00"}]}
JSON
cat > "$WORK_DIR/desk/db.json" <<JSON
{"version":1,"cards":{
 "C-10":{"id":"C-10","kind":"request","status":"testing","prototype":{"state":"live","env":"r10","expires":"$soon_off"},
  "polls":[
   {"id":"P-7","state":"open","closes":"2099-01-01T01:00:00+01:00","synced":"not a date"},
   {"id":"P-8","state":"open","closes":"2099-01-01T01:00:00+01:00","synced":"$recent_off"}],
  "councils":[
   {"id":"S-6","state":"open","opened":"not a date","synced":"$recent_off"},
   {"id":"S-7","state":"open","opened":"2001-01-01T01:00:00+01:00","synced":"$recent_off"},
   {"id":"S-8","state":"open","opened":"$recent_off","synced":"not a date"}]},
 "C-11":{"id":"C-11","kind":"request","status":"testing","prototype":{"state":"live","env":"r11","expires":"not a date"}},
 "C-12":{"id":"C-12","kind":"request","status":"declined","prototype":{"state":"live","env":"r12","expires":"not a date"}}}}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"
assert "a claim nobody can date is taken over, a fresh offset one is not" '[.variants_due[] | [.id, .takeover]] == [["I-9", true], ["I-11", true]]' "$out"
assert "an expiry nobody can read is never due, open or closed" '[.expiring_due[].card] == ["C-10"]' "$out"
assert "a sync time nobody can read is due, a fresh offset one is not" '[.polls_due[] | [.id, .close]] == [["P-7", false]]' "$out"
assert "an opening time nobody can read never idles a council" '[.councils_due[] | [.id, .close, .why]] == [["S-7", true, "idle"], ["S-8", false, null]]' "$out"
# ci_gate: an open PR's judged card whose check was never set is due once as G-<card>.
printf '{"updated":"%s","open":[],"claimed":[]}' "$new" > "$WORK_DIR/desk/inbox.json"
cat > "$WORK_DIR/desk/db.json" <<'JSON'
{"cards":{
 "C-1":{"id":"C-1","kind":"change","status":"new","source":{"repo":"a/b","pr":1},"attention":{"level":"designer","reasons":["r"]}},
 "C-2":{"id":"C-2","kind":"change","status":"new","source":{"repo":"a/b","pr":2},"attention":{"level":"designer","reasons":["r"]},"ci":{"state":"failing"}},
 "C-3":{"id":"C-3","kind":"change","status":"new","source":{"repo":"a/b","pr":3,"merged_at":"2026-11-01T00:00:00Z"},"attention":{"level":"designer","reasons":["r"]}},
 "C-4":{"id":"C-4","kind":"change","status":"new","source":{"repo":"a/b","pr":4},"attention":{"level":"fyi","reasons":["r"]}},
 "C-5":{"id":"C-5","kind":"change","status":"new","source":{"repo":"a/b","pr":5},"attention":{"level":"fyi","reasons":["r"]},"design_check":{"verdict":"differs"}},
 "C-6":{"id":"C-6","kind":"change","status":"new","source":{"repo":"a/b","pr":6},"conflicts":[{"decision":"D-1"}]},
 "C-7":{"id":"C-7","kind":"change","status":"new","source":{"repo":"a/b","pr":7},"ci":{"state":"error","tries":2}},
 "C-8":{"id":"C-8","kind":"change","status":"new","source":{"repo":"a/b","pr":8},"attention":{"level":"designer","reasons":["r"]},"ci":{"state":"skipped","tries":3}},
 "C-9":{"id":"C-9","kind":"change","status":"new","source":{"repo":"a/b","pr":9},"attention":{"level":"designer","reasons":["r"]},"ci":{"state":"skipped"}}},
 "decisions":{"D-1":{"id":"D-1","status":"active"}}}
JSON
assert "ci_gate off: no card is due for the gate" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
printf -- '- ci_gate: enabled\n' > "$WORK_DIR/CONFIG.md"
assert "ci_gate on: open judged cards with no check yet, and a failed write under its cap" '[.ci_due[] | [.id, .retry]] == [["G-C-1", false], ["G-C-4", false], ["G-C-5", false], ["G-C-6", false], ["G-C-7", true], ["G-C-9", false]]' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
echo '{"cards":' > "$WORK_DIR/desk/db.json"
assert "a Desk store the gate cannot read is an error line, and the run stays open" '(.nothing_to_do == false) and (.logs | any(test("could not read the Desk.s cards for the CI gate")))' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
rm "$WORK_DIR/desk/db.json"
echo 'not json' > "$WORK_DIR/desk/inbox.json"
assert "a broken inbox file is an error" '.error | test("not an inbox")' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
finish
