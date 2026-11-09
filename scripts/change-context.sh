#!/usr/bin/env bash
# change-context.sh <[host/]owner/name> <pr> [worklist.json] — everything the watch run reads
# about one change before it judges it (docs/watch.md → Per change, steps 1–4), in one call:
# the ledger claim, the clone at the default branch, the profile, the pull request with its
# comments, every issue it closes, and the diff of its UI files. It reads GitHub and writes
# only the ledger's claim row and files under $TMPDIR/design-desk-<pr>/.
# Prints one JSON object: {outcome: "ok", dir, default_branch, head, profile, pr, issues: [],
# ui_files: [], diff, missing: []} with the paths of what it wrote; `missing` names what could
# not be read (read that part by hand). {outcome: "held", …} → carded or skipped meanwhile:
# go to the next change. Exit 1 with {"error"} when the clone failed.
set -u
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
repo="${1:-}"; pr="${2:-}"; worklist="${3:-}"
[ -n "$repo" ] && [[ "$pr" =~ ^[0-9]+$ ]] || { echo '{"error":"usage: change-context.sh <[host/]owner/name> <pr> [worklist.json]"}'; exit 1; }
case "$repo" in */*/*) slug="${repo#*/}"; export GH_HOST="${repo%%/*}";; *) slug="$repo";; esac
out="${TMPDIR:-/tmp}/design-desk-$pr"; mkdir -p "$out"
missing=()

claim="$(bash "$SCRIPT_DIR/ledger.sh" claim "$repo" "$pr")" || { jq -cn --arg e "the ledger claim failed" '{error:$e}'; exit 1; }
[ "$(jq -r '.outcome // ""' <<<"$claim")" = held ] && { printf '%s\n' "$claim"; exit 0; }

co="$(bash "$SCRIPT_DIR/checkout.sh" "$repo")" || { printf '%s\n' "$co"; exit 1; }
dir="$(jq -r .dir <<<"$co")"

"${HOME:-/home/agent}/bin/design" profile "$repo" --clone "$dir" > "$out/profile.json" 2>/dev/null || missing+=("profile")

gh pr view "$pr" -R "$slug" --json title,body,author,mergedAt,mergeCommit,closingIssuesReferences,labels,comments > "$out/pr.json" 2>/dev/null || missing+=("pr")

issues=()
for n in $(jq -r '.closingIssuesReferences[]?.number' "$out/pr.json" 2>/dev/null); do
  if gh issue view "$n" -R "$slug" --json number,title,body,author,state,labels,comments > "$out/issue-$n.json" 2>/dev/null; then issues+=("$out/issue-$n.json"); else missing+=("issue $n"); fi
done

# The UI files: the worklist's entry names them (at most 40); without it, the caller reads the diff by hand.
ui="[]"
[ -n "$worklist" ] && [ -f "$worklist" ] && ui="$(jq -c --arg id "$repo#$pr" '[.changes_due[]? | select(.id == $id) | .ui_files[]?]' "$worklist" 2>/dev/null || echo '[]')"
sha="$(jq -r '.mergeCommit.oid // empty' "$out/pr.json" 2>/dev/null)"
diff=""
if [ "$(jq length <<<"$ui")" -gt 0 ]; then
  mapfile -t files < <(jq -r '.[]' <<<"$ui")
  if [ -n "$sha" ]; then
    # Merged: the change against its first parent. A merge commit has two parents, and
    # `git show` of one prints no patch for a path.
    git -C "$dir" diff "$sha^1" "$sha" -- "${files[@]}" > "$out/ui.diff" 2>/dev/null
  else
    # An open pull request: its head, fetched by its commit, against the default branch.
    sha="$(git -C "$dir" ls-remote origin "refs/pull/$pr/head" 2>/dev/null | cut -f1)"
    [ -n "$sha" ] && git -C "$dir" fetch -q origin "$sha" 2>/dev/null \
      && git -C "$dir" diff "origin/$(jq -r .default_branch <<<"$co")...$sha" -- "${files[@]}" > "$out/ui.diff" 2>/dev/null
  fi
  # A diff with no hunk is no diff: the caller reads it by hand.
  if grep -q '^@@' "$out/ui.diff" 2>/dev/null; then diff="$out/ui.diff"; else missing+=("diff"); fi
else
  missing+=("ui_files")
fi

jq -cn --argjson co "$co" --arg profile "$out/profile.json" --arg pr "$out/pr.json" --arg diff "$diff" --argjson ui "$ui" \
  --argjson issues "$(printf '%s\n' ${issues[@]+"${issues[@]}"} | jq -R . | jq -cs '[.[] | select(length > 0)]')" \
  --argjson missing "$(printf '%s\n' ${missing[@]+"${missing[@]}"} | jq -R . | jq -cs '[.[] | select(length > 0)]')" \
  '{outcome:"ok", dir:$co.dir, default_branch:$co.default_branch, head:$co.head, profile:$profile, pr:$pr, issues:$issues, ui_files:$ui, diff:(if $diff == "" then null else $diff end), missing:$missing}'
