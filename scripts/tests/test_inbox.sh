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
 {"id":"I-3","kind":"build","card":"C-2","thread":null,"created":"$new"}],
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
assert "request sorted" '[.requests_due[].id] == ["I-2"]' "$out"
assert "build sorted" '[.prototypes_due[].id] == ["I-3"]' "$out"
assert "stale claim taken over" '[.variants_due[] | select(.takeover) | .id] == ["I-4"]' "$out"
assert "fresh claim left alone" '[.handoffs_due[].id] == []' "$out"
assert "expiring prototype" '[.expiring_due[].card] == ["C-2"]' "$out"
assert "read_set covers the arrays" '(.read_set | index("docs/prototype.md")) and (.read_set | index("docs/requests.md")) and (.read_set | index(".agents/skills/explain/SKILL.md"))' "$out"

# Fan-out: the first expensive item stays, the others get units.
wl="$TMPDIR/wl.json"; printf '%s' "$out" > "$wl"
plan="$(bash "$ROOT/scripts/dispatch.sh" plan "$wl")"
assert "two units (I-4 explore, I-3 build), I-2 stays" '[.[].id] == ["I-4", "I-3"]' "$plan"
assert "a unit names its file, not the item text" '.[0].task | test("worklist is already computed") and test("I-4")' "$plan"
u="$(printf '%s' "$plan" | jq -r '.[0].worklist')"
assert "the unit holds its one item and no quick ones" '(.variants_due | length == 1) and (.questions_due == null) and (.dispatched.id == "I-4")' "$(cat "$u")"
rest="$(bash "$ROOT/scripts/dispatch.sh" rest "$wl" I-4 I-3)"
assert "the rest keeps the first and the quick ones" '(.prototypes_due | length == 0) and (.requests_due | length == 1) and (.questions_due | length == 1)' "$(cat "$(printf '%s' "$rest" | jq -r .worklist)")"
printf -- '- dispatch: disabled\n' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/preflight.sh" inbox)"; printf '%s' "$out" > "$wl"
assert "dispatch disabled keeps all" 'length == 0' "$(bash "$ROOT/scripts/dispatch.sh" plan "$wl")"

printf '{"updated":"%s","open":[],"claimed":[]}' "$new" > "$WORK_DIR/desk/inbox.json"; rm "$WORK_DIR/desk/db.json"
assert "empty inbox is quiet" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
echo 'not json' > "$WORK_DIR/desk/inbox.json"
assert "a broken inbox file is an error" '.error | test("not an inbox")' "$(bash "$ROOT/scripts/preflight.sh" inbox)"
finish
