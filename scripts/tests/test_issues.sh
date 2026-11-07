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
# The decisions page (docs/decisions-page.md): off by default; dam renders every decision
# without names or links, is due until its hash is recorded, and runs with the Issues page off.
printf -- '- display_name: Acme Desk\n- decisions_page: dam\n\n## Desk people\n\n| email | role | name |\n|---|---|---|\n| dana@acme.test | Designer | Dana Kowalski |\n| ola@acme.test | Admin | |\n' > "$WORK_DIR/CONFIG.md"
mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/db.json" <<'JSON'
{"cards":{"c1":{"origin":{"channel":"github","reporter":"Quartz Zoe"},"by":"R2(D2)","comments":[{"author":{"login":"zed-qux"}}],"assignees":[{"login":"novak"}],"votes":{"a":{"guest.maya@acme.test":"yes"}}}},"inbox":{},"decisions":{
 "D-1":{"id":"D-1","concepts":["send button"],"text":"The send button is blue.","author":{"name":"Xavier"},"origin":{"kind":"slack","url":"https://acme.slack.com/p1"},"at":"2026-10-01T10:00:00Z","recorded":"2026-10-01T10:00:00Z","status":"revoked","revoked":{"at":"2026-10-05T10:00:00Z","reason":"Replaced by D-2","replaced_by":"D-2"}},
 "D-2":{"id":"D-2","concepts":["send button","colors"],"text":"The send button uses the primary color.","why":"Ask alice@acme.test or <@U0123ABCD>. Dana said so; <https://acme.slack.com/p2|thread> with @bob and Xavier, AKIAABCDEFGHIJKLMNOP.","author":{"email":"dana@acme.test"},"origin":{"kind":"desk"},"at":"2026-10-05T10:00:00Z","recorded":"2026-10-05T10:00:00Z","status":"active","replaces":["D-1"]},
 "D-10":{"id":"D-10","concepts":["tables"],"text":"Tables\nnever scroll sideways.","why":"Asked by Quartz Zoe, zed-qux and R2(D2), see github.com/acme/internal/pull/9; pin react@18 at 1.5/2. -----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\nabcd==\n-----END RSA PRIVATE KEY----- done","author":{"login":"bob"},"origin":{"kind":"pr","url":"https://github.com/acme/widgets/pull/9"},"at":"2026-10-07T10:00:00Z","recorded":"2026-10-07T10:00:00Z","status":"active"},
 "D-11":{"id":"D-11","concepts":["lists"],"text":"An empty list says what to do next.","why":"Seen at 192.168.1.1/admin, localhost:3000/foo and git@github.com:acme/internal-repo.git; keys -----BEGIN PGP PRIVATE KEY BLOCK-----\nlQOYBF\n-----END PGP PRIVATE KEY BLOCK----- and ---- BEGIN SSH2 ENCRYPTED PRIVATE KEY ----\nAAAAB3\n---- END SSH2 ENCRYPTED PRIVATE KEY ----; asked by Novak and Maya.","author":{"email":"ola@acme.test"},"origin":{"kind":"desk"},"at":"2026-10-08T10:00:00Z","recorded":"2026-10-08T10:00:00Z","status":"active"},
 "D-3":{"id":"D-3","concepts":["Kowalski's menu","<@U0999ZZZZ|carol.jones>"],"text":"Mail Bob@ACME.COM, see HTTPS://acme.test/x or www.acme.test, key github_pat_11ABCDEFGHIJKLMNOPQRSTUV and sk-ant-api03-abcdef and AKIAABCDEFGHIJKLMNOP.","author":{"name":"Carol Jones","email":"carol@acme.test"},"origin":{"kind":"desk"},"at":"2026-10-06T10:00:00Z","recorded":"2026-10-06T10:00:00Z","status":"revoked","revoked":{"at":"2026-10-06T11:00:00Z","reason":"Carol asked at xoxb-1-2-abc and <#C0123|design>; ask Dana Kowalski or bob@acme.test"}},
 "D-12":{"id":"D-12","concepts":["lists"],"text":"Lists show at most 50 rows.","author":{"name":"Xavier","role":"lead"},"origin":{"kind":"desk"},"at":"2026-10-09T10:00:00Z","recorded":"2026-10-09T10:00:00Z","status":"active"}}}
JSON
dp="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "the page alone is due with the Issues page off" '.nothing_to_do == false and .config.decisions_page == "dam" and .title == "Publish the design decisions" and .read_set == ["docs/decisions-page.md"] and (.decisions_page_due[0] | .artifact == null and (.sha | startswith("sha256:")))' "$dp"
# The 1.58.0 value public still reads as dam: the same page is due.
cp "$WORK_DIR/CONFIG.md" "$STUB_DIR/config.dam"
sed 's/^- decisions_page: dam$/- decisions_page: public/' "$STUB_DIR/config.dam" > "$WORK_DIR/CONFIG.md"
dpub="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "public (1.58.0) reads as dam, the same page due" ".config.decisions_page == \"dam\" and [.decisions_page_due[] | .sha] == $(jq -c '[.decisions_page_due[] | .sha]' <<<"$dp")" "$dpub"
cp "$STUB_DIR/config.dam" "$WORK_DIR/CONFIG.md"
page="$(cat "$WORK_DIR/decisions-page.md")"
assert "in force by number, a role and a kind, a developer's not approved yet, revoked in one line" \
  '(index("### D-2") < index("### D-10")) and test("Decided 2026-10-05 by a designer, from the Desk. Replaces D-1.") and test("from a pull request. Not approved yet.") and test("Tables never scroll sideways.") and test("- D-1 \\(send button\\): The send button is blue. Revoked 2026-10-05: Replaced by D-2.\n")' "$(jq -Rs . <<<"$page")"
assert "an admin decides on the design side, by the roster or by the role a decision kept as lead before 1.59.0" \
  'test("### D-11[^#]*Decided 2026-10-08 by an admin, from the Desk\\.") and test("### D-12[^#]*Decided 2026-10-09 by an admin, from the Desk\\.") and (test("### D-1[12][^#]*Not approved yet") | not)' "$(jq -Rs . <<<"$page")"
assert "no name, login, e-mail, Slack id or link" '(test("Xavier|bob|dana|alice@|U0123ABCD|https?://") | not) and test("\\[e-mail\\]")' "$(jq -Rs . <<<"$page")"
# Every shape that leaked before 1.61.2, through text, why, concepts and revoked.reason (issue #83).
assert "links, Slack forms, e-mails in any case, keys and the roster's and store's names are masked" \
  '(test("(?i)https?:|www\\.|acme\\.(com|test)|<[@#]|U0999|carol|jones|kowalski|dana|xavier|bob|github_pat|sk-ant|AKIA|xoxb") | not)
   and test("Why: Ask \\[e-mail\\] or \\[person\\]\\. \\[person\\] said so; \\[link\\] with \\[person\\] and \\[person\\], \\[key\\]\\.\n")
   and test("Why: Asked by \\[person\\], \\[person\\] and \\[person\\], see \\[link\\]; pin react@18 at 1\\.5/2\\. \\[key\\] done\n")
   and (test("(?i)quartz|zoe|zed|qux|R2\\(|MIIBOg|PRIVATE|github\\.com") | not)
   and test("Why: Seen at \\[link\\], \\[link\\] and \\[link\\]; keys \\[key\\] and \\[key\\]; asked by \\[person\\] and \\[person\\]\\.\n")
   and (test("(?i)192\\.168|localhost|internal-repo|lQOYBF|AAAAB3|novak|maya") | not)
   and test("- D-3 \\(\\[person\\]'"'"'s menu, \\[person\\]\\): Mail \\[e-mail\\], see \\[link\\] or \\[link\\], key \\[key\\] and \\[key\\] and \\[key\\]\\. Revoked 2026-10-06: \\[person\\] asked at \\[key\\] and \\[mention\\]; ask \\[person\\] or \\[e-mail\\]\\.")' "$(jq -Rs . <<<"$page")"
jq -n --arg sha "$(jq -r '.decisions_page_due[0].sha' <<<"$dp")" '{id: "a1", url: "https://share.test/a/x/raw", sha: $sha, at: "2026-11-01T00:00:00Z"}' > "$WORK_DIR/decisions-page.json"
assert "an unchanged page is not due" '.nothing_to_do == true' "$(bash "$ROOT/scripts/preflight.sh" issues)"
jq '.decisions["D-10"].approved = {"at": "2026-11-02T00:00:00Z"}' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
assert "a change makes it due on its artifact" '.decisions_page_due[0].artifact == "a1"' "$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "the audit warns when it waits past two days" '[.checks[] | select(.id == "decisions_page") | [.status, (.detail | test("last published at 2026-11-01"))]] == [["warn", true]]' "$(bash "$ROOT/scripts/preflight.sh" audit 2>/dev/null)"
# Fail closed: a link left where no redaction reaches (an id) keeps the page from being due.
jq '.decisions["D-13"] = {"id": "D-13 https://leak.test", "concepts": ["x"], "text": "x", "status": "active"}' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
assert "a page that still holds a link is not due, and the log names the decision" '.nothing_to_do == true and (.logs | tostring | test("decision D-13 \\(its [a-z ]+\\) still holds a link"))' "$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "the audit warns that the page published before stays public" '[.checks[] | select(.id == "decisions_page") | [.status, (.detail | test("not updated: decision D-13.*stays public at https://share.test/a/x/raw"))]] == [["warn", true]]' "$(bash "$ROOT/scripts/preflight.sh" audit 2>/dev/null)"
# A key left only in an id: the gate checks keys too.
jq '.decisions["D-13"].id = "D-13 AKIAABCDEFGHIJKLMNOP"' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
assert "a key left in an id keeps the page from being due" '.nothing_to_do == true and (.logs | tostring | test("decision D-13 .*still holds"))' "$(bash "$ROOT/scripts/preflight.sh" issues)"
# The gate checks every class: a Slack form, an e-mail and a handle left in an id each block the page.
for leak in '<#C0123|design>' 'x@acme.test' '@zed'; do
  jq --arg id "D-13 $leak" '.decisions["D-13"].id = $id' "$DESK_DIR/db.json" > "$STUB_DIR/db" && mv "$STUB_DIR/db" "$DESK_DIR/db.json"
  assert "the gate blocks $leak left in an id" '.nothing_to_do == true and (.logs | tostring | test("decision D-13 .*still holds"))' "$(bash "$ROOT/scripts/preflight.sh" issues)"
done
# A failed read is a warning, never a quiet pass: each branch says its own reason.
cp "$DESK_DIR/db.json" "$STUB_DIR/db.good"; printf '{"decisions":' > "$DESK_DIR/db.json"
assert "a store that does not parse stops at the names" '.nothing_to_do == true and (.logs | tostring | test("cannot read the names to mask"))' "$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "the audit warns on an unreadable store" '[.checks[] | select(.id == "decisions_page") | [.status, (.detail | test("not updated: cannot read the names"))]] == [["warn", true]]' "$(bash "$ROOT/scripts/preflight.sh" audit 2>/dev/null)"
printf '{"decisions":"none"}' > "$DESK_DIR/db.json"
assert "a store that parses but does not render is not due" '.nothing_to_do == true and (.logs | tostring | test("cannot read the Desk store at"))' "$(bash "$ROOT/scripts/preflight.sh" issues)"
cp "$STUB_DIR/db.good" "$DESK_DIR/db.json"
mkdir -p "$STUB_DIR/jqfail"
printf '#!/usr/bin/env bash\n[ "$1" = -Rsr ] && exit 5\nexec %q "$@"\n' "$(command -v jq)" > "$STUB_DIR/jqfail/jq" && chmod +x "$STUB_DIR/jqfail/jq"
assert "a failed check of the rendered page is not due" '.nothing_to_do == true and (.logs | tostring | test("the check of the rendered page failed"))' "$(PATH="$STUB_DIR/jqfail:$PATH" bash "$ROOT/scripts/preflight.sh" issues)"
mv "$STUB_DIR/db.good" "$DESK_DIR/db.json"
printf -- '- display_name: Acme Desk\n' > "$WORK_DIR/CONFIG.md"
assert "off by default" '.nothing_to_do == true and .decisions_page_due == null' "$(bash "$ROOT/scripts/preflight.sh" issues)"
finish
