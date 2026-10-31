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
assert "a title from ids" '.title == "Explain PR #11, #14"' "$out"
assert "read_set names the watch doc" '.read_set | index("docs/watch.md") != null' "$out"
assert "config resolved with defaults" '.config.handoff == "desk" and .config.max_changes_per_run == 2' "$out"
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

# A failed listing is never an answer.
out4="$(STUB_GH_FAIL=1 bash "$ROOT/scripts/preflight.sh" watch)"
assert "outage → error, not quiet" '.nothing_to_do == true and (.error | test("could not list"))' "$out4"

# No repos → quiet; no watch_since → error.
printf -- '- repos: none\n' > "$WORK_DIR/CONFIG.md"
assert "repos none is quiet" '.nothing_to_do == true and (.error == null)' "$(bash "$ROOT/scripts/preflight.sh" watch)"
printf -- '- repos: acme/widgets\n' > "$WORK_DIR/CONFIG.md"
assert "missing watch_since is an error" '.error | test("watch_since")' "$(bash "$ROOT/scripts/preflight.sh" watch)"
finish
