#!/usr/bin/env bash
# The watch pre-flight: merged PRs that touch UI files become changes_due once.
. "$(dirname "$0")/lib.sh"
cat > "$WORK_DIR/CONFIG.md" <<CFG
- repos: acme/widgets
- watch_since: 2026-10-01T00:00:00Z
- max_changes_per_run: 2
CFG
cat > "$STUB_DIR/search.json" <<'JSON'
{"incomplete_results":false,"items":[
 {"number":11,"title":"Agents list shows spend","html_url":"https://github.com/acme/widgets/pull/11","user":{"login":"alice"},"pull_request":{"merged_at":"2026-10-20T10:00:00Z"}},
 {"number":12,"title":"Bump a dependency","html_url":"https://github.com/acme/widgets/pull/12","user":{"login":"bob"},"pull_request":{"merged_at":"2026-10-21T10:00:00Z"}},
 {"number":13,"title":"Old","html_url":"https://github.com/acme/widgets/pull/13","user":{"login":"bob"},"pull_request":{"merged_at":"2026-09-01T10:00:00Z"}},
 {"number":14,"title":"Dialog copy","html_url":"https://github.com/acme/widgets/pull/14","user":{"login":"carol"},"pull_request":{"merged_at":"2026-10-22T10:00:00Z"}},
 {"number":15,"title":"Button\twith tab","html_url":"https://github.com/acme/widgets/pull/15","user":{"login":"dave"},"pull_request":{"merged_at":"2026-10-23T10:00:00Z"}}]}
JSON
printf 'src/agents/list.tsx\nsrc/agents/list.test.ts\n' > "$STUB_DIR/files-11.txt"
printf 'package.json\npnpm-lock.yaml\n' > "$STUB_DIR/files-12.txt"
printf 'src/dialogs/confirm.tsx\n' > "$STUB_DIR/files-14.txt"
printf 'src/App.css\n' > "$STUB_DIR/files-15.txt"

out="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "work is due" '.nothing_to_do == false' "$out"
assert "two changes, the cap" '.changes_due | length == 2' "$out"
assert "UI PRs only, newest search order" '[.changes_due[].pr] == [11, 14]' "$out"
assert "first-time kind" '[.changes_due[].kind] | all(. == "first")' "$out"
assert "UI files listed" '.changes_due[0].ui_files == ["src/agents/list.tsx"]' "$out"
assert "a title from ids" '.title == "Explain #11, #14"' "$out"
assert "read_set names the watch doc" '.read_set | index("docs/watch.md") != null' "$out"
assert "config resolved with defaults" '.config.handoff == "desk" and .config.max_changes_per_run == 2' "$out"
assert "prototype_requesters unset: a PM builds live prototypes too" '.config.prototype_requesters == "designer, pm, admin"' "$out"
assert "the rest wait" '.logs | map(test("wait for the next run")) | any' "$out"
assert "skipped logged" '.logs | map(test("touch no UI")) | any' "$out"

# Second pass: 11 and 14 are due (fresh), 12 skipped, so only 15 is new.
out2="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "fresh due rows are left to their session" '[.changes_due[].pr] == [15]' "$out2"
assert "the tab in a title is flattened" '.changes_due[0].title == "Button with tab"' "$out2"

# A carded PR never returns; a stale in-progress one is taken over.
bash "$ROOT/scripts/ledger.sh" done acme/widgets 11 C-1 >/dev/null
printf 'acme/widgets\t14\t2026-10-22T10:00:00Z\tin_progress\t\t2026-10-01T00:00:00Z\t0\tclaimed\n' >> "$WORK_DIR/CHANGES.tsv"
printf 'acme/widgets\t15\t2026-10-23T10:00:00Z\tcarded\tC-2\t2026-10-30T00:00:00Z\t0\t\n' >> "$WORK_DIR/CHANGES.tsv"
out3="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "only the stale one" '[.changes_due[].pr] == [14] and .changes_due[0].kind == "takeover"' "$out3"

# A PR that keeps failing stops after three attempts (the ledger keeps empty fields).
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- max_changes_per_run: 2\n' > "$WORK_DIR/CONFIG.md"
for i in 1 2 3; do
  bash "$ROOT/scripts/ledger.sh" claim acme/widgets 14 >/dev/null
  bash "$ROOT/scripts/ledger.sh" fail acme/widgets 14 "render failed" >/dev/null
done
assert "three failures are counted" '.row.attempts == 3 and .row.card == ""' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 14)"
assert "and the PR is not retried again" '[.changes_due[]?.pr] | index(14) == null' "$(bash "$ROOT/scripts/preflight.sh" watch)"

# Open PRs get a card before they ship; labelled issues become requests.
cat > "$STUB_DIR/open.json" <<'JSON'
{"incomplete_results":false,"items":[{"number":21,"title":"New schedule picker","html_url":"https://github.com/acme/widgets/pull/21","user":{"login":"erin"},"pull_request":{"merged_at":null}}]}
JSON
cat > "$STUB_DIR/issues.json" <<'JSON'
{"incomplete_results":false,"items":[{"number":30,"title":"Redesign the empty Home","html_url":"https://github.com/acme/widgets/issues/30","user":{"login":"frank"}}]}
JSON
printf 'src/schedules/picker.tsx
' > "$STUB_DIR/files-21.txt"
printf -- '- repos: acme/widgets
- watch_since: 2026-10-01T00:00:00Z
- max_changes_per_run: 5
' > "$WORK_DIR/CONFIG.md"
out5="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "the open PR is due as open" '[.changes_due[] | select(.pr == 21) | .state] == ["open"]' "$out5"
assert "the labelled issue is due" '[.issues_due[].issue] == [30]' "$out5"
assert "issues bring the requests doc" '.read_set | index("docs/requests.md") != null' "$out5"
bash "$ROOT/scripts/ledger.sh" open acme/widgets 21 C-7 >/dev/null
printf '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/open.json"
jq '.items += [{"number":21,"title":"New schedule picker","html_url":"https://github.com/acme/widgets/pull/21","user":{"login":"erin"},"pull_request":{"merged_at":"2026-10-25T10:00:00Z"}}]' "$STUB_DIR/search.json" > "$STUB_DIR/s2" && mv "$STUB_DIR/s2" "$STUB_DIR/search.json"
out6="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "once merged, the open card is due again" '[.changes_due[] | select(.pr == 21) | .kind] == ["merged"]' "$out6"
printf -- '- repos: acme/widgets
- watch_since: 2026-10-01T00:00:00Z
- issue_label: none
- watch_open_prs: disabled
' > "$WORK_DIR/CONFIG.md"
assert "issue_label none and watch_open_prs disabled turn both off" '(.issues_due | length) == 0 and ([.changes_due[]? | select(.state == "open")] | length) == 0' "$(bash "$ROOT/scripts/preflight.sh" watch)"

# Drafts stay off the Desk until they are ready; a carded open PR is due again only on a push
# that touches UI files, compared with the head it was carded on.
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- issue_label: none\n- max_changes_per_run: 5\n' > "$WORK_DIR/CONFIG.md"
rm -f "$WORK_DIR/CHANGES.tsv" "$WORK_DIR/.watch-cursor" "$STUB_DIR/gh.calls"
printf '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/search.json"
openpr() { printf '{"number":%s,"title":"PR %s","html_url":"https://github.com/acme/widgets/pull/%s","user":{"login":"erin"},"draft":%s%s,"pull_request":{"merged_at":null}}' "$1" "$1" "$1" "$2" "${3:+,\"updated_at\":\"$3\"}"; }
printf '{"incomplete_results":false,"items":[%s,%s]}' "$(openpr 40 true)" "$(openpr 41 false)" > "$STUB_DIR/open.json"
printf 'src/a.tsx\n' > "$STUB_DIR/files-40.txt"; printf 'src/b.tsx\n' > "$STUB_DIR/files-41.txt"
outd="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a draft is left out, a ready PR is listed" '[.changes_due[].pr] == [41]' "$outd"
assert "an open PR's fields line up (it has no merge time)" '.changes_due[0] | .title == "PR 41" and .author == "erin" and .merged_at == null and .draft == false' "$outd"
assert "the open search asks for ready PRs only" '. == true' "$(grep 'is:open' "$STUB_DIR/gh.calls" | grep -q 'draft:false' && echo true || echo false)"
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 40 false)" > "$STUB_DIR/open.json"
assert "the draft, now ready, is listed" '[.changes_due[] | select(.pr == 40) | .kind] == ["first"]' "$(bash "$ROOT/scripts/preflight.sh" watch)"
bash "$ROOT/scripts/ledger.sh" open acme/widgets 40 C-40 aaaaaaa1 >/dev/null
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 ccccccc1 >/dev/null
bash "$ROOT/scripts/ledger.sh" open acme/widgets 42 C-42 >/dev/null
assert "ledger.sh open records the head in the note" '.row.status == "open" and .row.note == "head aaaaaaa1"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 40)"
assert "a head that is no sha is refused" '.outcome == "error"' "$(bash "$ROOT/scripts/ledger.sh" open acme/widgets 40 C-40 'x y' 2>/dev/null)"
printf '{"incomplete_results":false,"items":[%s,%s,%s,%s]}' "$(openpr 40 false)" "$(openpr 41 false)" "$(openpr 42 false)" "$(openpr 43 false)" > "$STUB_DIR/open.json"
printf 'bbbbbbb2\n' > "$STUB_DIR/pull-40.tsv"; printf 'src/a.tsx\nREADME.md\n' > "$STUB_DIR/compare-aaaaaaa1...bbbbbbb2.txt"
printf 'ddddddd2\n' > "$STUB_DIR/pull-41.tsv"; printf 'README.md\n' > "$STUB_DIR/compare-ccccccc1...ddddddd2.txt"
printf 'eeeeeee2\n' > "$STUB_DIR/pull-42.tsv"
bash "$ROOT/scripts/ledger.sh" open acme/widgets 43 C-43 fffffff1 >/dev/null   # its head cannot be read: no pull-43
outp="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a push with UI files is due as a push" '[.changes_due[] | select(.pr == 40) | {kind, state, head, before, ui_files}] == [{kind: "push", state: "open", head: "bbbbbbb2", before: "aaaaaaa1", ui_files: ["src/a.tsx"]}]' "$outp"
assert "a push without UI files is not due" '[.changes_due[].pr] == [40]' "$outp"
assert "its recorded head moves on" '.row.status == "open" and .row.card == "C-41" and .row.note == "head ddddddd2"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 41)"
assert "no recorded head records the current one, with no run" '.row.status == "open" and .row.card == "C-42" and .row.note == "head eeeeeee2"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 42)"
assert "the push's row is due and keeps its card" '.row.status == "due" and .row.card == "C-40"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 40)"
assert "a head that cannot be read is logged, the row left as it was" '(.logs | map(test("43: could not read its head")) | any)' "$outp"
assert "and retried next pass" '.row.note == "head fffffff1"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 43)"
outq="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "an unchanged head is due for nothing" '[.changes_due[]?.pr] == []' "$outq"
assert "the unread head is read again" '(.logs | map(test("43: could not read its head")) | any)' "$outq"
# A force-push: the old head cannot be compared any more, so the PR's own files decide, once.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 ddddddd2 >/dev/null
printf 'abcdef44\n' > "$STUB_DIR/pull-41.tsv"; printf 'src/b.tsx\n' > "$STUB_DIR/files-41.txt"
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 41 false)" > "$STUB_DIR/open.json"
outf="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a head no longer comparable falls back to the PR's files" '[.changes_due[] | select(.pr == 41) | {kind, head, ui_files}] == [{kind: "push", head: "abcdef44", ui_files: ["src/b.tsx"]}]' "$outf"
# A compare lists what a merge of the default branch brought in too: only the PR's own UI files make a push due.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 abcdef44 >/dev/null
bash "$ROOT/scripts/ledger.sh" open acme/widgets 44 C-44 4444aaa1 >/dev/null
printf 'abcdef55\n' > "$STUB_DIR/pull-41.tsv"; printf 'src/b.tsx\nsrc/main.tsx\n' > "$STUB_DIR/compare-abcdef44...abcdef55.txt"
printf '4444bbb2\n' > "$STUB_DIR/pull-44.tsv"; printf 'src/main.tsx\n' > "$STUB_DIR/compare-4444aaa1...4444bbb2.txt"; printf 'README.md\n' > "$STUB_DIR/files-44.txt"
printf '{"incomplete_results":false,"items":[%s,%s]}' "$(openpr 41 false)" "$(openpr 44 false)" > "$STUB_DIR/open.json"
outm="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "only the PR's own UI files make a push due" '[.changes_due[] | {pr, ui_files}] == [{pr: 41, ui_files: ["src/b.tsx"]}]' "$outm"
assert "one whose UI files all came from a merge only moves its head" '.row.status == "open" and .row.note == "head 4444bbb2"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 44)"
# Any other compare failure (GitHub down) is retried next pass: nothing written, no fallback.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 abcdef55 >/dev/null
printf 'abcdef66\n' > "$STUB_DIR/pull-41.tsv"; printf 'gh: Server Error (HTTP 502)\n' > "$STUB_DIR/compare-abcdef55...abcdef66.fail"
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 41 false)" > "$STUB_DIR/open.json"; : > "$STUB_DIR/gh.calls"
outt="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a compare GitHub fails is due for nothing, and logged" '[.changes_due[]?.pr] == [] and (.logs | map(test("41: could not compare abcdef5 with abcdef6 — retried next run")) | any)' "$outt"
assert "its row is left as it was" '.row.status == "open" and .row.note == "head abcdef55"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 41)"
assert "and the PR's files are not read instead" '. == false' "$(grep -q 'pulls/41/files' "$STUB_DIR/gh.calls" && echo true || echo false)"
rm -f "$STUB_DIR/compare-abcdef55...abcdef66.fail"; printf 'src/b.tsx\n' > "$STUB_DIR/compare-abcdef55...abcdef66.txt"
# Head checks have a budget of their own: one out of it waits, and holds up neither a new candidate nor the cursor.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 abcdef55 >/dev/null
printf 'src/c.tsx\n' > "$STUB_DIR/files-46.txt"; rm -f "$WORK_DIR/.watch-cursor"
printf '{"incomplete_results":false,"items":[%s,%s]}' "$(openpr 41 false)" "$(openpr 46 false)" > "$STUB_DIR/open.json"
outb="$(WATCH_MAX_LOOKUPS=1 WATCH_MAX_HEAD_LOOKUPS=1 bash "$ROOT/scripts/preflight.sh" watch)"
assert "a new candidate is due while a head check waits" '[.changes_due[].pr] == [46] and (.logs | map(test("1 carded open PRs wait")) | any) and (.logs | map(test("more PRs wait")) | any | not)' "$outb"
assert "the cursor moves" '. == true' "$([ -f "$WORK_DIR/.watch-cursor" ] && echo true || echo false)"
# Not updated on GitHub since its row was written, less 3 hours: no push since, its head is not read.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 41 C-41 abcdef55 >/dev/null
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 41 false 2026-01-01T00:00:00Z)" > "$STUB_DIR/open.json"; : > "$STUB_DIR/gh.calls"
assert "a PR not updated since its row is due for nothing" '[.changes_due[]?.pr] == []' "$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "and its head is not read" '. == false' "$(grep -q 'pulls/41' "$STUB_DIR/gh.calls" && echo true || echo false)"
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 41 false "$(date -u -d '-2 hours' +%Y-%m-%dT%H:%M:%SZ)")" > "$STUB_DIR/open.json"
assert "one updated within the margin is read" '[.changes_due[] | {pr, kind, head}] == [{pr: 41, kind: "push", head: "abcdef66"}]' "$(bash "$ROOT/scripts/preflight.sh" watch)"
# Back to draft: it keeps its card, and nothing is due for it, not even a head lookup.
bash "$ROOT/scripts/ledger.sh" open acme/widgets 40 C-40 bbbbbbb2 >/dev/null
printf 'ggggggg3\n' > "$STUB_DIR/pull-40.tsv"; printf 'src/a.tsx\n' > "$STUB_DIR/compare-bbbbbbb2...ggggggg3.txt"
printf '{"incomplete_results":false,"items":[%s]}' "$(openpr 40 true)" > "$STUB_DIR/open.json"; : > "$STUB_DIR/gh.calls"
assert "a carded PR back to draft is due for nothing" '[.changes_due[]?.pr] == []' "$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "and its head is not read" '. == false' "$(grep -q 'pulls/40' "$STUB_DIR/gh.calls" && echo true || echo false)"
assert "its card stays recorded" '.row.status == "open" and .row.card == "C-40"' "$(bash "$ROOT/scripts/ledger.sh" show acme/widgets 40)"
printf '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/open.json"

# The Desk's GitHub copies: one never read, and one GitHub changed since, open a run alone;
# one never read whose last 3 reads failed does not, nor does one outside the watched
# repositories, read or not: github-sync never reads it.
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- issue_label: none\n- watch_open_prs: disabled\n' > "$WORK_DIR/CONFIG.md"
mkdir -p "$DESK_DIR"
cat > "$DESK_DIR/github-refs.json" <<'JSON'
{"refs":[{"key":"acme/widgets#21","updated":"2026-11-01T10:00:00Z"},{"key":"acme/widgets#22","updated":"2026-11-03T10:00:00Z"},{"key":"acme/widgets#30","updated":null,"tries":2},{"key":"acme/widgets#50000","updated":null,"tries":3},{"key":"acme/private#5","updated":null},{"key":"other/repo#21","updated":"2026-11-01T10:00:00Z"}]}
JSON
cat > "$STUB_DIR/search.json" <<'JSON'
{"incomplete_results":false,"items":[
 {"number":21,"title":"Old PR","html_url":"https://github.com/acme/widgets/pull/21","user":{"login":"a"},"updated_at":"2026-11-02T10:00:00Z","pull_request":{"merged_at":"2026-09-01T10:00:00Z"}},
 {"number":22,"title":"Quiet PR","html_url":"https://github.com/acme/widgets/pull/22","user":{"login":"a"},"updated_at":"2026-11-03T10:00:00Z","pull_request":{"merged_at":"2026-09-01T10:00:00Z"}}]}
JSON
outg="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "a copy behind GitHub opens a run" '.nothing_to_do == false and .github_due == ["acme/widgets#21", "acme/widgets#30"] and (.changes_due | length) == 0' "$outg"
assert "its title says what it does" '.title == "Read new GitHub comments"' "$outg"
# repos as people write it: a host, mixed case, spaces around the comma, two repositories.
# toolkit/tests/github.test.mjs feeds github-sync the same value: both read one watched set.
printf -- '- repos: GitHub.com/Acme/Widgets , other/thing\n- watch_since: 2026-10-01T00:00:00Z\n- issue_label: none\n- watch_open_prs: disabled\n' > "$WORK_DIR/CONFIG.md"
assert "repos with a host, mixed case and spaces watches the same refs" '.github_due == ["acme/widgets#21", "acme/widgets#30"]' "$(bash "$ROOT/scripts/preflight.sh" watch)"
rm -f "$DESK_DIR/github-refs.json"

# A failed listing is never an answer.
out4="$(STUB_GH_FAIL=1 bash "$ROOT/scripts/preflight.sh" watch)"
assert "outage → error, not quiet" '.nothing_to_do == true and (.error | test("could not list"))' "$out4"

# No repos → quiet; no watch_since → error.
printf -- '- repos: none\n' > "$WORK_DIR/CONFIG.md"
assert "repos none is quiet" '.nothing_to_do == true and (.error == null)' "$(bash "$ROOT/scripts/preflight.sh" watch)"
printf -- '- repos: acme/widgets\n' > "$WORK_DIR/CONFIG.md"
assert "missing watch_since is an error" '.error | test("watch_since")' "$(bash "$ROOT/scripts/preflight.sh" watch)"
# The merged search narrows. After a pass that left nothing behind, the next one starts at the
# oldest merge still due; with nothing due, two days before that pass; a moved watch_since
# starts it over.
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- max_changes_per_run: 50\n' > "$WORK_DIR/CONFIG.md"
rm -f "$WORK_DIR/CHANGES.tsv" "$WORK_DIR/.watch-cursor" "$DESK_DIR/github-refs.json"
printf '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/open.json"; rm -f "$STUB_DIR/issues.json"
cat > "$STUB_DIR/search.json" <<'JSON'
{"incomplete_results":false,"items":[
 {"number":11,"title":"Agents list shows spend","html_url":"https://github.com/acme/widgets/pull/11","user":{"login":"alice"},"pull_request":{"merged_at":"2026-10-20T10:00:00Z"}}]}
JSON
merged_q() { grep 'is:merged' "$STUB_DIR/gh.calls" | tail -1 | grep -oE 'merged:>=[0-9-]+'; }
# A candidate whose files could not be read (no stub for #16) has no ledger row yet: the
# pass moves no cursor, so the change cannot age out of the search window unread.
cp "$STUB_DIR/search.json" "$STUB_DIR/search.keep"
jq '.items += [{"number":16,"title":"Unread","html_url":"https://github.com/acme/widgets/pull/16","user":{"login":"erin"},"pull_request":{"merged_at":"2026-10-21T10:00:00Z"}}]' "$STUB_DIR/search.keep" > "$STUB_DIR/search.json"
bash "$ROOT/scripts/preflight.sh" watch >/dev/null
assert "a pass that could not read a candidate's files writes no cursor" '. == "none"' "$([ -e "$WORK_DIR/.watch-cursor" ] && echo '"written"' || echo '"none"')"
mv "$STUB_DIR/search.keep" "$STUB_DIR/search.json"
bash "$ROOT/scripts/preflight.sh" watch >/dev/null
assert "without a cursor the search starts at watch_since" '. == "merged:>=2026-10-01"' "$(merged_q | jq -R .)"
assert "a pass that deferred nothing writes the cursor" '. == "2026-10-01T00:00:00Z"' "$(sed -n 2p "$WORK_DIR/.watch-cursor" | jq -R .)"
bash "$ROOT/scripts/preflight.sh" watch >/dev/null
assert "a change still due holds the search at its merge day" '. == "merged:>=2026-10-20"' "$(merged_q | jq -R .)"
for n in 11; do bash "$ROOT/scripts/ledger.sh" skip acme/widgets "$n" "test" >/dev/null 2>&1; done
bash "$ROOT/scripts/preflight.sh" watch >/dev/null
assert "with nothing due the search starts two days before the last clean pass" '. == ("merged:>=" + (now - 172800 | strftime("%Y-%m-%d")))' "$(merged_q | jq -R .)"
printf -- '- repos: acme/widgets\n- watch_since: 2026-09-01T00:00:00Z\n- max_changes_per_run: 50\n' > "$WORK_DIR/CONFIG.md"
bash "$ROOT/scripts/preflight.sh" watch >/dev/null
assert "a moved watch_since starts the search over" '. == "merged:>=2026-09-01"' "$(merged_q | jq -R .)"
finish
