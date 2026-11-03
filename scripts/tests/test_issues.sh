#!/usr/bin/env bash
# The issues pre-flight: the open issues of the sprint, the next sprint, someone's and the
# labelled ones (a sub-issue in its epic's sprint) are read once and again when they change,
# and drawn, at most max_issue_drawings a pass; a card whose issue left the plan is archived,
# a card's closed issue only when its own lookup says closed.
. "$(dirname "$0")/lib.sh"
cat > "$WORK_DIR/CONFIG.md" <<CFG
- repos: acme/widgets
- watch_since: 2026-10-01T00:00:00Z
CFG
out0="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "off by default" '.nothing_to_do == true and (.logs | map(test("issue_news")) | any)' "$out0"

printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- issue_news: enabled\n- issue_news_label: needs design\n- max_issue_drawings: 1\n' > "$WORK_DIR/CONFIG.md"
cat > "$STUB_DIR/milestones.json" <<'JSON'
[{"title":"Sprint 11","due_on":"2026-10-20T00:00:00Z"},{"title":"Sprint 12","due_on":"2099-11-04T00:00:00Z"},{"title":"Sprint 13","due_on":"2099-11-18T00:00:00Z"}]
JSON
cat > "$STUB_DIR/open-issues.json" <<'JSON'
{"incomplete_results":false,"items":[
 {"number":40,"title":"Backlog idea","html_url":"https://github.com/acme/widgets/issues/40","user":{"login":"erin"},"updated_at":"2026-10-30T10:00:00Z","milestone":null,"assignees":[],"labels":[]},
 {"number":41,"title":"Spend\tper agent","html_url":"https://github.com/acme/widgets/issues/41","user":{"login":"alice"},"updated_at":"2026-10-29T10:00:00Z","milestone":{"title":"Sprint 12"},"assignees":[{"login":"bob"}],"labels":[{"name":"ui"}]},
 {"number":42,"title":"Bob's task","html_url":"https://github.com/acme/widgets/issues/42","user":{"login":"carol"},"updated_at":"2026-10-28T10:00:00Z","milestone":{"title":"Sprint 13"},"assignees":[{"login":"bob"}],"labels":[]},
 {"number":43,"title":"Sprint chore","html_url":"https://github.com/acme/widgets/issues/43","user":{"login":"dave"},"updated_at":"2026-10-31T10:00:00Z","milestone":{"title":"Sprint 12"},"assignees":[],"labels":[]},
 {"number":44,"title":"Asked for design","html_url":"https://github.com/acme/widgets/issues/44","user":{"login":"erin"},"updated_at":"2026-10-25T10:00:00Z","milestone":null,"assignees":[],"labels":[{"name":"needs design"}]},
 {"number":45,"title":"Part of the epic","html_url":"https://github.com/acme/widgets/issues/45","url":"https://api.github.com/repos/acme/widgets/issues/45","parent_issue_url":"https://api.github.com/repos/acme/widgets/issues/46","user":{"login":"erin"},"updated_at":"2026-10-26T10:00:00Z","milestone":null,"assignees":[],"labels":[]},
 {"number":46,"title":"Epic - Spend","html_url":"https://github.com/acme/widgets/issues/46","url":"https://api.github.com/repos/acme/widgets/issues/46","user":{"login":"erin"},"updated_at":"2026-10-27T10:00:00Z","milestone":{"title":"Sprint 12"},"assignees":[],"labels":[]}]}
JSON
out="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "work is due" '.nothing_to_do == false and .mode == "issues"' "$out"
assert "the sprint is the open milestone due next, the next one after it" '.sprint["acme/widgets"] == "Sprint 12" and .next_sprint["acme/widgets"] == "Sprint 13"' "$out"
assert "one drawing, the cap: the sprint's most recent first" '[.drawings_due[] | [.issue, .bucket, .judge]] == [[43, "sprint", true]]' "$out"
assert "the rest are read: sprint (an epic's sub-issue too), next, labelled; the rest not" '[.issue_news_due[] | [.issue, .bucket, .need, .kind]] == [[41, "sprint", "judge", "first"], [46, "sprint", "judge", "first"], [45, "sprint", "judge", "first"], [42, "next", "judge", "first"], [44, "label", "judge", "first"]]' "$out"
assert "an entry carries its issue" '.issue_news_due[0] | .title == "Spend per agent" and .assignees == ["bob"] and .labels == ["ui"] and .milestone == "Sprint 12"' "$out"
assert "read_set names the issues doc and screens for drawings" '.read_set == ["docs/issues.md", "docs/screens.md"]' "$out"
assert "a title from ids" '.title == "Read issues #43, #41 +4 more"' "$out"

# Second pass: everything is due and fresh, left to its session.
out2="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "fresh due rows are left alone" '.nothing_to_do == true' "$out2"

# A claim row whose time nobody can read is taken over (scripts/lib/time.sh); a fresh one
# written with an offset is still held.
recent_off="$(date -u -d '55 minutes' +%Y-%m-%dT%H:%M:%S+01:00 2>/dev/null || date -u -v+55M +%Y-%m-%dT%H:%M:%S+01:00)"
printf 'acme/widgets\t42\t2026-10-28T10:00:00Z\tdue\t\tnot a date\t0\t\n' >> "$WORK_DIR/ISSUES.tsv"
printf 'acme/widgets\t44\t2026-10-25T10:00:00Z\tdue\t\t%s\t0\t\n' "$recent_off" >> "$WORK_DIR/ISSUES.tsv"
out2b="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "an undatable claim is taken over, a fresh offset one is held" \
  '[(.drawings_due + .issue_news_due)[] | [.issue, .kind]] == [[42, "takeover"]] and (.logs | map(test("#44: due since")) | any)' "$out2b"

# The agent's outcomes: 41 is UI (card C-1, no sketch yet), 42 UI and drawn (C-2), 40 is not UI.
L() { bash "$ROOT/scripts/ledger.sh" --issues "$@" >/dev/null; }
L done acme/widgets 41 C-1; L done acme/widgets 42 C-2; L skip acme/widgets 40 "back end"; L done acme/widgets 43 C-3
mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/db.json" <<'JSON'
{"cards":{
 "C-1":{"id":"C-1","kind":"issue","status":"open","bucket":"sprint","source":{"repo":"acme/widgets","issue":41},"sketches":[]},
 "C-2":{"id":"C-2","kind":"issue","status":"open","bucket":"backlog","source":{"repo":"acme/widgets","issue":42},"sketches":[{"asset":"A-1"}]},
 "C-3":{"id":"C-3","kind":"issue","status":"open","bucket":"sprint","source":{"repo":"acme/widgets","issue":43},"sketches":[{"asset":"A-2"}]},
 "C-9":{"id":"C-9","kind":"issue","status":"open","bucket":"sprint","source":{"repo":"acme/widgets","issue":39},"sketches":[]},
 "C-7":{"id":"C-7","kind":"issue","status":"open","bucket":"backlog","source":{"repo":"acme/widgets","issue":40},"sketches":[]},
 "C-8":{"id":"C-8","kind":"issue","status":"open","bucket":"backlog","source":{"repo":"acme/widgets","issue":38},"sketches":[]}},
 "inbox":{}}
JSON
echo closed > "$STUB_DIR/issue-39.state"
out3="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "a judged sprint issue without a sketch is drawn" '[.drawings_due[] | [.issue, .need, .judge, .card]] == [[41, "draw", false, "C-1"]]' "$out3"
assert "a moved card follows the plan" '[.issue_news_due[] | select(.need == "move") | [.issue, .bucket]] == [[42, "next"]]' "$out3"
assert "a card whose issue left the plan is archived" '[.issue_news_due[] | select(.need == "leave") | [.issue, .card]] == [[40, "C-7"]]' "$out3"
assert "closed by its own lookup, never by absence" '[.issue_news_due[] | select(.need == "close") | .issue] == [39]' "$out3"
assert "an unchanged non-UI issue is not read again" '[.issue_news_due[] | select(.need == "judge")] | length == 0' "$out3"

# A person asked to draw C-1: the pass leaves it to that item. A changed issue is read again,
# and one whose card was archived when it left the plan comes back with it.
jq '.inbox = {"I-1": {"id":"I-1","kind":"draw","card":"C-1","state":"open"}} | .cards["C-3"].status = "archived"' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
jq '.items[0].updated_at = "2026-11-01T09:00:00Z" | .items[0].assignees = [{"login":"erin"}]' "$STUB_DIR/open-issues.json" > "$STUB_DIR/o" && mv "$STUB_DIR/o" "$STUB_DIR/open-issues.json"
out4="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "a person's Draw it wins" '[.drawings_due[] | .issue] | index(41) == null' "$out4"
assert "the changed issue, now someone's, is read again" '[.issue_news_due[] | select(.need == "judge") | [.issue, .bucket, .kind]] == [[40, "assigned", "changed"]]' "$out4"
assert "a carded issue whose card is gone comes back" '[.drawings_due[] | [.issue, .kind]] == [[43, "returned"]]' "$out4"

# The audit names the cadence, and the dispatch fans out drawings after the first.
assert "the audit checks the cadence" '[.checks[] | select(.id == "issues_cadence") | .status] == ["ok"]' "$(bash "$ROOT/scripts/preflight.sh" audit 2>/dev/null)"
printf '{"mode":"issues","config":{},"issue_news_due":[{"id":"acme/widgets#40","issue":40}],"drawings_due":[{"id":"acme/widgets#41","issue":41},{"id":"acme/widgets#43","issue":43}]}' > "$TMPDIR/wl.json"
plan="$(bash "$ROOT/scripts/dispatch.sh" plan "$TMPDIR/wl.json")"
assert "one unit per drawing after the first" '[.[] | .sessionTitle] == ["Draw issue #43"]' "$plan"
assert "a unit carries only its drawing" '.[0].worklist' "$plan"
unit="$(jq -r '.[0].worklist' <<<"$plan")"
assert "the unit has no quick work" '(.issue_news_due == null) and ([.drawings_due[].issue] == [43])' "$(cat "$unit")"
rest="$(bash "$ROOT/scripts/dispatch.sh" rest "$TMPDIR/wl.json" acme/widgets#43)"
assert "the run keeps the rest" '.title == "Read issues #41, #40"' "$rest"

# An issue whose updated_at nobody can read (scripts/lib/time.sh) sorts last in its bucket
# and does not stop the pass; one written with an offset sorts by its instant.
rm -f "$WORK_DIR/ISSUES.tsv" "$DESK_DIR/db.json"
cat > "$STUB_DIR/open-issues.json" <<'JSON'
{"incomplete_results":false,"items":[
 {"number":50,"title":"Undated","html_url":"https://github.com/acme/widgets/issues/50","user":{"login":"erin"},"updated_at":"not a date","milestone":null,"assignees":[{"login":"erin"}],"labels":[]},
 {"number":51,"title":"Offset","html_url":"https://github.com/acme/widgets/issues/51","user":{"login":"erin"},"updated_at":"2026-10-02T11:00:00+02:00","milestone":null,"assignees":[{"login":"erin"}],"labels":[]},
 {"number":52,"title":"Later","html_url":"https://github.com/acme/widgets/issues/52","user":{"login":"erin"},"updated_at":"2026-10-02T10:00:00Z","milestone":null,"assignees":[{"login":"erin"}],"labels":[]}]}
JSON
out5="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "an undatable issue is read last, an offset one by its instant" \
  '.nothing_to_do == false and [(.drawings_due + .issue_news_due)[] | .issue] == [52, 51, 50]' "$out5"

# A failing GitHub is an error, never a quiet pass.
assert "a failed list is an error" '.error != null' "$(STUB_GH_FAIL=1 bash "$ROOT/scripts/preflight.sh" issues)"
finish
