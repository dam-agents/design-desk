#!/usr/bin/env bash
# A search page bigger than an argument may be (128 KB per argument on Linux, about 1 MB
# for all of them on macOS) still reaches jq: through a file, never argv
# (docs/self-modification.md → A large payload never travels in argv). One page per path
# that merges pages: the issues pass and the watch pass's open pull requests.
. "$(dirname "$0")/lib.sh"
# Three items with a 450 KB body each: a 1.3 MB page, above both limits.
big_page() {  # <first number> <extra item fields as a jq object>
  jq -cn --argjson n "$1" --argjson extra "$2" \
    '{incomplete_results: false, items: [range(3) | {number: ($n + .), title: "Big \(.)", html_url: "https://github.com/acme/widgets/issues/\($n + .)",
      user: {login: "erin"}, updated_at: "2026-10-30T10:00:00Z", body: ("x" * 450000)} + $extra]}'
}

# The issues pass: three open issues in the sprint, each read or drawn.
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- issue_news: enabled\n' > "$WORK_DIR/CONFIG.md"
echo '[{"title":"Sprint 12","due_on":"2099-11-04T00:00:00Z"}]' > "$STUB_DIR/milestones.json"
big_page 50 '{"milestone": {"title": "Sprint 12"}, "assignees": [], "labels": []}' > "$STUB_DIR/open-issues.json"
out="$(bash "$ROOT/scripts/preflight.sh" issues)"
assert "issues: a 1.3 MB page is read whole" '[(.drawings_due + .issue_news_due)[] | .issue] | sort == [50, 51, 52]' "$out"

# The watch pass: three open pull requests that touch the UI, each due.
rm -f "$WORK_DIR"/*.tsv
printf -- '- repos: acme/widgets\n- watch_since: 2026-10-01T00:00:00Z\n- issue_label: none\n- max_changes_per_run: 5\n' > "$WORK_DIR/CONFIG.md"
echo '{"incomplete_results":false,"items":[]}' > "$STUB_DIR/search.json"
big_page 60 '{"pull_request": {"merged_at": null}, "draft": false}' > "$STUB_DIR/open.json"
for n in 60 61 62; do printf 'src/agents/list.tsx\n' > "$STUB_DIR/files-$n.txt"; done
out2="$(bash "$ROOT/scripts/preflight.sh" watch)"
assert "open PRs: a 1.3 MB page is read whole" '[.changes_due[] | select(.state == "open") | .pr] | sort == [60, 61, 62]' "$out2"
finish
