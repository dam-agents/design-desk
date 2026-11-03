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
 {"id":"I-8","kind":"person","card":null,"thread":null,"created":"$new"}],
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
assert "a person a lead asked for sorted, with no card; one without its payload is not due" '[.people_due[] | select(.card == null) | .person.email] == ["alex@example.com"]' "$out"
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
assert "the unit holds its one item and no quick ones" '(.variants_due | length == 1) and (.questions_due == null) and (.people_due == null) and (.dispatched.id == "I-4")' "$(cat "$u")"
rest="$(bash "$ROOT/scripts/dispatch.sh" rest "$wl" I-4 I-3)"
assert "the rest keeps the first and the quick ones" '(.prototypes_due | length == 0) and (.requests_due | length == 1) and (.questions_due | length == 1)' "$(cat "$(printf '%s' "$rest" | jq -r .worklist)")"
printf -- '- dispatch: disabled\n' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"; printf '%s' "$out" > "$wl"
assert "dispatch disabled keeps all" 'length == 0' "$(bash "$ROOT/scripts/dispatch.sh" plan "$wl")"

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
printf -- '- slack_council: enabled\n- council_sync_min: 1\n' > "$WORK_DIR/CONFIG.md"
assert "a shorter interval reads the recent one too" '[.councils_due[].id] | index("S-1")' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
rm "$WORK_DIR/desk/db.json"
echo 'not json' > "$WORK_DIR/desk/inbox.json"
assert "a broken inbox file is an error" '.error | test("not an inbox")' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
finish
