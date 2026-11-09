#!/usr/bin/env bash
# preflight.sh — deterministic pre-flight for design-desk.
#
# The script DETECTS, it NEVER ACTS:
#
#   - NO external writes at all (list/GET calls only),
#   - NO git commit/push (the agent persists at end of run),
#   - local writes only: documented bookkeeping status flips, per-mode log lines, caches.
#
#   preflight.sh <mode>   -> one JSON object on stdout; everything else to stderr.
#   .nothing_to_do == true  -> the agent ends the run immediately.
#   otherwise               -> the agent processes the arrays per CLAUDE.md + docs/.
#
# Modes:
#   watch  — merged pull requests in the watched repositories that touch UI files and
#            have no card yet → changes_due (docs/watch.md).
#   inbox  — what the Desk is waiting for, read from work/desk/inbox.json (a local
#            file the Desk server rewrites on every change) → questions_due,
#            requests_due, variants_due, prototypes_due, handoffs_due, teardowns_due,
#            expiring_due (docs/desk.md).
#   issues — the open issues of the watched repositories, for the Desk's Issues page
#            (docs/issues.md): new or changed ones to read, the sprint's and assigned
#            ones to draw, closed ones to archive → issue_news_due, drawings_due; and
#            the public decisions page when it changed → decisions_page_due
#            (docs/decisions-page.md).
#   digest — the week in the Desk's store, and 30 days of feedback for its themes
#            (docs/digest.md); nothing in a quiet week or once the week's digest exists.
#   audit  — deterministic health checks (docs/audit.md).
#
# Requires: bash, jq, gh, curl, sed/grep/cut/tr, GNU date (the machine).

set -u
export LC_ALL=C

MODE="${1:-inbox}"
HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
CONFIG="$WORK/CONFIG.md"
NOW_EPOCH=$(date -u +%s)
NOW_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)

LOGS=()
log() { LOGS+=("$1"); }

# The config readers (`cfg`, `cfg_table`) live in one file that every reader of
# CONFIG.md sources — never copied here, so the runtime and the verifier cannot
# drift apart. A missing lib is fatal: parsing config by hand is how they drift.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "$SCRIPT_DIR/lib/config.sh" || { echo "cannot source lib/config.sh" >&2; exit 1; }
. "$SCRIPT_DIR/lib/time.sh" || { echo "cannot source lib/time.sh" >&2; exit 1; }
. "$SCRIPT_DIR/lib/toolpath.sh" 2>/dev/null && toolpath_init jq gh >/dev/null 2>&1 || true
LOG_JOB="$MODE"
. "$SCRIPT_DIR/log.sh" 2>/dev/null || logev() { :; }

# GNU date first, BSD fallback (macOS dev machines — `-u` matters: without it the
# trailing Z is parsed in local time and lock ages skew); epoch 0 on unparsable input.
iso2epoch() { date -d "$1" +%s 2>/dev/null \
              || date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null || echo 0; }

# ---------------------------------------------------------------- config ----
DESK_DIR="${DESK_DIR:-$WORK/desk}"
LEDGER="$WORK/CHANGES.tsv"
LEDGER_HEAD=$'repo\tpr\tmerged_at\tstatus\tcard\tupdated\tattempts\tnote'

config_json() {
  jq -n \
    --arg display_name "$(cfg display_name)" \
    --arg repos "$(cfg repos)" --arg watch_since "$(cfg watch_since)" --arg watch_paths "$(cfg watch_paths)" \
    --arg max_changes_per_run "$(cfg max_changes_per_run)" --arg profile "$(cfg profile)" \
    --arg default_style "$(cfg default_style)" --arg prototype_requesters "$(cfg prototype_requesters)" \
    --arg max_prototypes "$(cfg max_prototypes)" --arg prototype_expiry_days "$(cfg prototype_expiry_days)" \
    --arg prototype_remote "$(cfg prototype_remote)" --arg handoff "$(cfg handoff)" --arg spec_review "$(cfg spec_review)" \
    --arg desk_ping "$(cfg desk_ping)" --arg desk_artifact "$(cfg desk_artifact)" --arg desk_link "$(cfg desk_link)" --arg bug_reports "$(cfg bug_reports)" \
    --arg watch_open_prs "$(cfg watch_open_prs)" --arg issue_label "$(cfg issue_label)" --arg proposals "$(cfg proposals)" \
    --arg max_proposals_per_week "$(cfg max_proposals_per_week)" --arg implementer "$(cfg implementer)" \
    --arg implementer_mention "$(cfg implementer_mention)" --arg issue_writeback "$(cfg issue_writeback)" --arg notify "$(cfg notify)" --arg run_model "$(cfg run_model)" \
    --arg dispatch "$(cfg dispatch)" --arg work_repo "${GITHUB_REPO_WORK:-$(cfg work_repo)}" \
    --arg audit_report "$(cfg audit_report)" --arg log_level "$(cfg log_level)" \
    --arg figma "$(cfg figma)" --arg figma_file "$(cfg figma_file)" \
    --arg screens "$(cfg screens)" --arg max_screen_prs "$(cfg max_screen_prs)" \
    --arg slack_polls "$(cfg slack_polls)" --arg slack_poll_channel "$(cfg slack_poll_channel)" --arg slack_send "$(cfg slack_send)" --arg digest "$(cfg digest)" \
    --arg slack_council "$(cfg slack_council)" --arg council_sync_min "$(cfg council_sync_min)" \
    --arg issue_news "$(cfg issue_news)" --arg issue_sprint "$(cfg issue_sprint)" --arg issue_next_sprint "$(cfg issue_next_sprint)" --arg issue_news_label "$(cfg issue_news_label)" \
    --arg max_issue_drawings "$(cfg max_issue_drawings)" --arg decisions_page "$(cfg decisions_page)" --arg ci_gate "$(cfg ci_gate)" \
    '{display_name: ($display_name | if . == "" then "Design Desk" else . end),
      repos: ($repos | if . == "" then "none" else . end),
      watch_since: $watch_since,
      watch_paths: ($watch_paths | if . == "" then "**/*.tsx,**/*.jsx,**/*.vue,**/*.svelte,**/*.css,**/*.scss,**/*.html" else . end),
      max_changes_per_run: ($max_changes_per_run | tonumber? // 10),
      profile: ($profile | if . == "" then "auto" else . end),
      default_style: ($default_style | if . == "" then "auto" else . end),
      prototype_requesters: ($prototype_requesters | if . == "" then "designer, pm, admin" else . end),
      max_prototypes: ($max_prototypes | tonumber? // 2),
      prototype_expiry_days: ($prototype_expiry_days | tonumber? // 7),
      prototype_remote: ($prototype_remote | if . == "" then "none" else . end),
      handoff: ($handoff | if . == "" then "desk" else . end),
      spec_review: ($spec_review | if . == "disabled" then "disabled" else "enabled" end),
      desk_ping: ($desk_ping | if . == "" then "enabled" else . end),
      desk_artifact: $desk_artifact,
      desk_link: $desk_link,
      bug_reports: ($bug_reports | if . == "" then "enabled" else . end),
      watch_open_prs: ($watch_open_prs | if . == "" then "enabled" else . end),
      issue_label: ($issue_label | if . == "" then "design" else . end),
      proposals: ($proposals | if . == "" then "enabled" else . end),
      max_proposals_per_week: ($max_proposals_per_week | tonumber? // 3),
      implementer: ($implementer | if . == "" then "pr-comment" else . end),
      implementer_mention: $implementer_mention,
      issue_writeback: ($issue_writeback | if . == "" then "enabled" else . end),
      notify: ($notify | if . == "" then "disabled" else . end),
      run_model: ($run_model | if . == "" then "default" else . end),
      dispatch: ($dispatch | if . == "" then "enabled" else . end),
      work_repo: ($work_repo | if . == "" then "none" else . end),
      audit_report: ($audit_report | if . == "" then "enabled" else . end),
      log_level: ($log_level | if . == "" then "info" else . end),
      figma: ($figma | if . == "" then "disabled" else . end),
      figma_file: $figma_file,
      screens: ($screens | if . == "" then "disabled" else . end),
      max_screen_prs: ($max_screen_prs | tonumber? // 2),
      slack_polls: ($slack_polls | if . == "" then "disabled" else . end),
      slack_send: ($slack_send | if . == "" then "disabled" else . end),
      slack_poll_channel: $slack_poll_channel,
      digest: ($digest | if . == "" then "desk" else . end),
      slack_council: ($slack_council | if . == "" then "disabled" else . end),
      council_sync_min: ($council_sync_min | tonumber? // 30),
      issue_news: ($issue_news | if . == "" then "disabled" else . end),
      issue_sprint: ($issue_sprint | if . == "" then "milestone" else . end),
      issue_next_sprint: ($issue_next_sprint | if . == "" then "milestone" else . end),
      issue_news_label: ($issue_news_label | if . == "" then "none" else . end),
      max_issue_drawings: ($max_issue_drawings | tonumber? // 5),
      decisions_page: ($decisions_page | if . == "dam" or . == "public" then "dam" else "off" end),
      ci_gate: ($ci_gate | if . == "enabled" then "enabled" else "disabled" end)}'
}

logs_json() { printf '%s\n' "${LOGS[@]:-}" | jq -R . | jq -s '[.[] | select(length>0)]'; }

fail_out() {  # nothing-to-do JSON with an error; the agent just logs it
  logev error preflight "$MODE: $1"
  jq -n --arg mode "$MODE" --arg err "$1" --argjson logs "$(logs_json)" \
    '{mode:$mode, nothing_to_do:true, error:$err, logs:$logs}'
  exit 0
}

quiet_out() {
  logev info preflight "$MODE: nothing to do — $(printf '%s; ' "${LOGS[@]:-}" | cut -c1-300)"
  jq -n --arg mode "$MODE" --argjson logs "$(logs_json)" '{mode:$mode, nothing_to_do:true, logs:$logs}'
  exit 0
}

# Title from ids alone (`<Verb> <object>`), never from item text.
title_for() {  # $1 verb, $2 noun, ids on stdin one per line
  local ids n first
  ids="$(cat)"; n=$(printf '%s\n' "$ids" | grep -c . || true)
  first="$(printf '%s\n' "$ids" | head -2 | paste -sd, - | sed 's/,/, /g')"
  if [ "$n" -le 2 ]; then printf '%s %s %s' "$1" "$2" "$first"; else printf '%s %s %s +%s more' "$1" "$2" "$first" "$((n - 2))"; fi
}

# Globs (`**`, `*`, `?`) → one ERE, so a file list is matched in one grep.
globs_to_ere() {
  jq -rn --arg g "$1" '
    [ $g | split(",")[] | gsub("^\\s+|\\s+$"; "") | select(length > 0)
      | gsub("(?<c>[.+^$(){}|\\[\\]\\\\])"; "\\\(.c)")
      | gsub("\\*\\*/"; "\u0001") | gsub("\\*\\*"; "\u0002")
      | gsub("\\*"; "[^/]*") | gsub("\\?"; "[^/]")
      | gsub("\u0001"; "(.*/)?") | gsub("\u0002"; ".*")
      | "^" + . + "$" ] | join("|")'
}

repo_slug() { case "$1" in */*/*) printf '%s' "${1#*/}";; *) printf '%s' "$1";; esac; }

# The UI paths of a repo: its design profile in the local clone (read from the
# default branch, never a PR branch), else the configured fallback.
ui_paths_for() {
  local repo="$1" clone prof paths
  clone="$HOME_DIR/checkouts/$(printf '%s' "$repo" | tr '/' '_')"
  if [ -d "$clone/.git" ]; then
    local want; want="$(cfg profile)"
    case "$want" in "$repo":*) want=".design-desk/${want#"$repo":}"; want="${want%/}/profile.json"; want="${want/.design-desk\/.design-desk\//.design-desk/}";; *) want="";; esac
    for prof in ${want:-$(git -C "$clone" ls-tree -r --name-only origin/HEAD -- .design-desk 2>/dev/null | grep '/profile.json$' | sort | head -1)}; do
      paths="$(git -C "$clone" show "origin/HEAD:$prof" 2>/dev/null | jq -r '(.ui.paths // []) | join(",")' 2>/dev/null)"
      [ -n "$paths" ] && { printf '%s' "$paths"; return; }
    done
  fi
  printf '%s' "$WATCH_PATHS"
}

ensure_ledger() {
  [ -f "$LEDGER" ] || { mkdir -p "$WORK"; printf '%s\n' "$LEDGER_HEAD" > "$LEDGER"; }
}

# search <repo> <query> → every item, in pages of 100, up to 5 pages (500) a pass. The
# caller's `hostargs` names a GitHub Enterprise host. Runs in a command substitution: a
# failure returns, and the caller fails the pass.
search() {
  local q="$2" out='{"items":[]}' page=1 got
  while [ "$page" -le 5 ]; do
    got="$(gh api ${hostargs[@]+"${hostargs[@]}"} -X GET search/issues -f q="$q" -f sort=updated -f order=desc -f per_page=100 -f page="$page" 2>/dev/null)" || return 1
    jq -e '.items | type == "array"' >/dev/null 2>&1 <<<"$got" || return 1
    [ "$(jq -r '.incomplete_results' <<<"$got")" = "true" ] && { log "$1: the search reported incomplete results — the rest come next run"; : > "$WORK/.search-partial"; }
    out="$(jq -c --slurpfile more <(jq -c .items <<<"$got") '.items += $more[0]' <<<"$out")"  # a page is too big for an argument
    [ "$(jq '.items | length' <<<"$got")" -eq 100 ] || break
    page=$((page + 1))
  done
  [ "$page" -gt 5 ] && { log "$1: more than 500 results for \"$q\" — the oldest wait for later passes"; : > "$WORK/.search-partial"; }
  printf '%s' "$out"
}

# ============================================================ WATCH MODE ====
watch_mode() {
  local CONF REPOS SINCE MAXN repo since_day items rows ere paths
  CONF="$(config_json)"
  REPOS="$(jq -r '.repos' <<<"$CONF")"
  WATCH_PATHS="$(jq -r '.watch_paths' <<<"$CONF")"
  MAXN="$(jq -r '.max_changes_per_run' <<<"$CONF")"
  if [ "$REPOS" = "none" ]; then log "no watched repositories (repos: none) — nothing to watch"; quiet_out; fi
  SINCE="$(jq -r '.watch_since' <<<"$CONF")"
  [ -n "$SINCE" ] || fail_out "watch_since is not set in work/CONFIG.md — onboarding writes it; without it every merged PR in history would be due"
  since_day="${SINCE%%T*}"
  ensure_ledger
  # The merged search starts where the ledger may still need it, not at onboarding: two days
  # before the last pass that left nothing behind (work/.watch-cursor), or at the oldest merge
  # whose row is still due, in progress or failed under 3 tries, whichever is earlier; never
  # before watch_since. A pass that deferred a change, could not read a candidate's files or
  # got a partial search moves no cursor: nothing unread may age out of the window,
  # and a cursor written under another watch_since (its second line) is not used: the operator
  # moved the start, and the search goes back to it once.
  local CURSOR="$WORK/.watch-cursor" merged_from="$since_day" cur open_min
  rm -f "$WORK/.search-partial"
  cur="$(head -1 "$CURSOR" 2>/dev/null)"
  if [[ "$cur" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$ ]] && [ "$(sed -n 2p "$CURSOR" 2>/dev/null)" = "$SINCE" ]; then
    merged_from="$(date -u -d "@$(( $(iso2epoch "$cur") - 172800 ))" +%Y-%m-%d 2>/dev/null || echo "$since_day")"
    open_min="$(awk -F'\t' 'NR>1 { st[$1 "#" $2]=$4; m[$1 "#" $2]=$3; a[$1 "#" $2]=$7 } END { for (k in st) if (m[k] != "" && (st[k] == "due" || st[k] == "in_progress" || (st[k] == "failed" && a[k] + 0 < 3))) print m[k] }' "$LEDGER" | sort | head -1)"
    [ -n "$open_min" ] && [[ "${open_min%%T*}" < "$merged_from" ]] && merged_from="${open_min%%T*}"
    [[ "$merged_from" < "$since_day" ]] && merged_from="$since_day"
  fi
  local DUE ISSUES; DUE="$(mktemp "${TMPDIR:-/tmp}/design-desk-due.XXXXXX")"; ISSUES="$(mktemp "${TMPDIR:-/tmp}/design-desk-issues.XXXXXX")"
  local ndue=0 nissues=0 deferred=0 skipped=0 seen=0 lookups=0 unread=0
  # One files call per new candidate; a backlog is spread over passes so a pass stays
  # well inside the Precheck's budget (about 2 s a call through the gateway).
  local MAX_LOOKUPS="${WATCH_MAX_LOOKUPS:-25}"
  local stale_s=$((3 * 3600))
  local OPEN_PRS LABEL; OPEN_PRS="$(jq -r '.watch_open_prs' <<<"$CONF")"; LABEL="$(jq -r '.issue_label' <<<"$CONF")"
  # The ledger's last row for (repo, number) decides: kind of work, or a reason to skip.
  declare -A LAST_STATUS=() LAST_UPDATED=() LAST_ATTEMPTS=()
  decide() {  # <repo> <number> <state: merged|open|issue> → prints kind or nothing
    local status updated attempts
    # The ledger is read once, with no process per pull request (a fork is slow in a small sandbox):
    # the last row of a (repo, number) wins, as `tail -1` did.
    if [ -z "${LEDGER_LOADED:-}" ]; then
      local _k _s _u _a
      # awk, not `read`: a tab is whitespace to IFS, so empty columns would collapse.
      while IFS=$'\x1f' read -r _k _s _u _a; do
        LAST_STATUS["$_k"]="$_s"; LAST_UPDATED["$_k"]="$_u"; LAST_ATTEMPTS["$_k"]="$_a"
      done < <(awk -F'\t' -v OFS='\037' 'NR>1 { r[$1 "#" $2]=$4 OFS $6 OFS $7 } END { for (k in r) print k OFS r[k] }' "$LEDGER")
      LEDGER_LOADED=1
    fi
    status="${LAST_STATUS["$1#$2"]:-}"; updated="${LAST_UPDATED["$1#$2"]:-}"; attempts="${LAST_ATTEMPTS["$1#$2"]:-}"
    case "$status" in
      carded|skipped|dispatched) return 0;;
      open) [ "$3" = merged ] && echo merged; return 0;;   # carded while open; now it shipped
      due|in_progress)
        [ $((NOW_EPOCH - $(iso2epoch "$updated"))) -ge "$stale_s" ] || { log "$1#$2: $status since $updated — left to its session"; return 0; }
        echo takeover;;
      failed) [ "${attempts:-0}" -lt 3 ] || { log "$1#$2: failed ${attempts} times — left for the audit"; return 0; }; echo retry;;
      "") echo first;;
    esac
  }
  for repo in $(printf '%s' "$REPOS" | tr ',' ' '); do
    local slug; slug="$(repo_slug "$repo")"
    local hostargs=(); case "$repo" in */*/*) hostargs=(--hostname "${repo%%/*}");; esac
    local items more found
    found="$(search "$repo" "repo:$slug is:pr is:merged merged:>=$merged_from")" \
      || fail_out "could not list merged pull requests of $repo (gh api search/issues failed) — is the GitHub connection granted?"
    items="$(jq -c '.items |= map(. + {state: "merged"})' <<<"$found")"
    # Open pull requests too: a developer's UI is seen, and adjusted, before it ships.
    if [ "$OPEN_PRS" = enabled ]; then
      more="$(search "$repo" "repo:$slug is:pr is:open created:>=$since_day")" || fail_out "could not list open pull requests of $repo"
      items="$(jq -c --slurpfile more <(jq -c '.items | map(. + {state: "open"})' <<<"$more") '.items += $more[0]' <<<"$items")"  # a page is too big for an argument
    fi
    paths="$(ui_paths_for "$repo")"; ere="$(globs_to_ere "$paths")"
    local SINCE_Z; SINCE_Z="$(date -u -d "@$(iso2epoch "$SINCE")" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "$SINCE")"
    while IFS=$'\t' read -r num state merged title url author draft; do
      [ -n "$num" ] || continue
      seen=$((seen + 1))
      # Both are UTC ISO times ending in Z, so a text comparison orders them; no `date` per pull request.
      [ "$state" = open ] || ! [[ "$merged" < "$SINCE_Z" ]] || continue
      local kind; kind="$(decide "$repo" "$num" "$state")"
      [ -n "$kind" ] || continue
      if [ "$ndue" -ge "$MAXN" ] || [ "$lookups" -ge "$MAX_LOOKUPS" ]; then deferred=$((deferred + 1)); continue; fi
      lookups=$((lookups + 1))
      # Per candidate: its files, to keep only PRs that touch the UI.
      local files ui n
      files="$(gh api ${hostargs[@]+"${hostargs[@]}"} "repos/$slug/pulls/$num/files?per_page=100" --paginate --jq '.[].filename' 2>/dev/null)" \
        || { log "$repo#$num: could not read its files — retried next run"; unread=$((unread + 1)); continue; }
      ui="$(printf '%s\n' "$files" | grep -E "$ere" || true)"
      n=$(printf '%s\n' "$ui" | grep -c . || true)
      if [ "$n" -eq 0 ]; then
        [ "$state" = merged ] && printf '%s\t%s\t%s\tskipped\t\t%s\t0\tno UI files\n' "$repo" "$num" "$merged" "$NOW_ISO" >> "$LEDGER"
        skipped=$((skipped + 1)); continue
      fi
      printf '%s\t%s\t%s\tdue\t\t%s\t0\t%s, %s UI files\n' "$repo" "$num" "$merged" "$NOW_ISO" "$state" "$n" >> "$LEDGER"
      ndue=$((ndue + 1))
      jq -cn --arg id "$repo#$num" --arg repo "$repo" --argjson pr "$num" --arg state "$state" --arg title "$title" --arg url "$url" \
        --arg merged "$merged" --arg author "$author" --arg kind "$kind" --argjson n "$n" --argjson draft "${draft:-false}" \
        --argjson files "$(printf '%s\n' "$ui" | head -40 | jq -R . | jq -s '[.[] | select(length>0)]')" \
        '{id:$id, repo:$repo, pr:$pr, state:$state, title:$title, url:$url, merged_at:(if $merged == "" then null else $merged end), author:$author, draft:$draft, kind:$kind, ui_file_count:$n, ui_files:$files}' >> "$DUE"
      log "$repo#$num: $state${merged:+ $merged}, $n UI files — due ($kind)"
    done < <(jq -r '.items[] | [.number, .state, (.pull_request.merged_at // ""), (.title | gsub("[\t\n]"; " ")), .html_url, .user.login, (.draft // false | tostring)] | @tsv' <<<"$items")
    # Issues that ask for design work: a label the team puts on them.
    if [ "$LABEL" != none ]; then
      found="$(search "$repo" "repo:$slug is:issue is:open label:\"$LABEL\"")" || fail_out "could not list the issues labelled $LABEL in $repo"
      while IFS=$'\t' read -r num title url author; do
        [ -n "$num" ] || continue
        local kind; kind="$(decide "$repo" "$num" issue)"
        [ -n "$kind" ] || continue
        printf '%s\t%s\t\tdue\t\t%s\t0\tissue\n' "$repo" "$num" "$NOW_ISO" >> "$LEDGER"
        nissues=$((nissues + 1))
        jq -cn --arg id "$repo#$num" --arg repo "$repo" --argjson n "$num" --arg title "$title" --arg url "$url" --arg author "$author" --arg kind "$kind" \
          '{id:$id, repo:$repo, issue:$n, title:$title, url:$url, author:$author, kind:$kind}' >> "$ISSUES"
        log "$repo#$num: issue labelled $LABEL — due ($kind)"
      done < <(jq -r '.items[] | [.number, (.title | gsub("[\t\n]"; " ")), .html_url, .user.login] | @tsv' <<<"$found")
    fi
  done
  # The issues and pull requests the Desk's cards point at whose copy on the Desk is behind
  # GitHub: never read, or changed since (a comment changes it). One search per repository.
  # A ref never read whose last 3 reads failed (a mistyped number, a private repository) opens
  # no run, nor does a ref outside the watched repositories: github-sync never reads one
  # (docs/watch.md → Comments on GitHub).
  local gh_due='[]' REFS="$DESK_DIR/github-refs.json" REFS_W r since hits watched
  watched="$(printf '%s' "$REPOS" | jq -Rc 'split(",") | map(gsub("^\\s+|\\s+$"; "") | ascii_downcase | split("/") | .[-2:] | join("/") | select(test("/")))')"
  if [ -f "$REFS" ]; then
    REFS_W="$(jq -c --argjson w "$watched" '{refs: [.refs[] | select((.key | split("#")[0] | ascii_downcase) as $r | $w | index($r) != null)]}' "$REFS")"
    gh_due="$(jq -c '[.refs[] | select(.updated == null and (.tries // 0) < 3) | .key]' <<<"$REFS_W")"
    for r in $(jq -r '[.refs[] | select(.updated != null) | .key | split("#")[0]] | unique | .[:10][]' <<<"$REFS_W"); do
      since="$(jq -r --arg r "$r" '[.refs[] | select((.key | split("#")[0]) == $r and .updated != null) | .updated] | min' <<<"$REFS_W")"
      local hostargs=()
      hits="$(search "$r" "repo:$r updated:>=${since%%T*}")" || { log "$r: could not check its issues and pull requests for new comments — next run"; continue; }
      gh_due="$(jq -c --arg r "$r" --slurpfile refs <(printf '%s' "$REFS_W") --argjson due "$gh_due" \
        '$due + [.items[] as $i | $refs[0].refs[] | select(.key == ($r + "#" + ($i.number | tostring)) and .updated != null and $i.updated_at > .updated) | .key] | unique' <<<"$hits")"
    done
  fi
  local ngh; ngh="$(jq length <<<"$gh_due")"
  [ "$ngh" -gt 0 ] && log "$ngh issues or pull requests on the Desk changed on GitHub — github_due"
  [ "$skipped" -gt 0 ] && log "$skipped PRs touch no UI file — skipped"
  [ "$deferred" -gt 0 ] && log "$deferred more PRs wait for the next run (max_changes_per_run=$MAXN, at most $MAX_LOOKUPS file lookups a pass)"
  printf '%s changes_due=%s issues_due=%s skipped=%s deferred=%s seen=%s\n' "$NOW_ISO" "$ndue" "$nissues" "$skipped" "$deferred" "$seen" >> "$WORK/WATCH.log"
  if [ "$deferred" -eq 0 ] && [ "$unread" -eq 0 ] && [ ! -e "$WORK/.search-partial" ]; then printf '%s\n%s\n' "$NOW_ISO" "$SINCE" > "$CURSOR"; fi
  rm -f "$WORK/.search-partial"
  local arr iss; arr="$(jq -s '.' "$DUE")"; iss="$(jq -s '.' "$ISSUES")"; rm -f "$DUE" "$ISSUES"
  [ "$ndue" -gt 0 ] || [ "$nissues" -gt 0 ] || [ "$ngh" -gt 0 ] || quiet_out
  logev info preflight "watch: $ndue changes, $nissues issues, $ngh GitHub copies due"
  jq -n --argjson due "$arr" --argjson issues "$iss" --argjson gh "$gh_due" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    --arg title "$( { jq -r '.[].pr | "#\(.)"' <<<"$arr"; jq -r '.[].issue | "#\(.)"' <<<"$iss"; } | title_for Explain "")" \
    '{mode:"watch", nothing_to_do:false, title:(if ($due | length) + ($issues | length) == 0 then "Read new GitHub comments" else ($title | sub("Explain  "; "Explain ")) end), github_due:$gh,
      read_set: (["docs/watch.md", ".agents/skills/explain/SKILL.md"] + (if ($issues | length) > 0 then ["docs/requests.md"] else [] end)),
      changes_due:$due, issues_due:$issues, config:$config, logs:$logs}'
}

# ===================================================== THE DECISIONS PAGE ===
# The team's decisions as one public text page for coding agents (docs/decisions-page.md).
# Rendered here, deterministically, into work/decisions-page.md (a cache: the agent
# publishes it); due when its hash differs from the one last published
# (work/decisions-page.json). No names, logins, e-mails, links or keys: only roles and kinds.
# Every free text is redacted; the finished page is checked again with the same rules and, if
# anything of the kind is left, or the store or the names to mask cannot be read, it is not
# due (fail closed): DEC_BLOCKED names the decision and the field, and the audit warns.
# Prints the `decisions_page_due` array.
# The redaction's one set of rules, for the scrub, the gate and the names: each class has one
# pattern and one set of flags.
DEC_JQ="$(cat <<'JQ'
def dec_link: "\\b[\\p{L}\\p{M}\\p{N}\\p{Cf}._-]+@[\\p{L}\\p{M}\\p{N}\\p{Cf}.-]+:[^\\s<>](?:[^\\s<>]*[^\\s<>.,;:!?)\\]\"'])?|\\b(?:[a-z][a-z0-9+.-]*://|www\\.)(?:[^\\s<>]*[^\\s<>.,;:!?)\\]\"'])?|\\b(?:[\\p{L}\\p{M}\\p{N}\\p{Cf}-]+(?:\\.[\\p{L}\\p{M}\\p{N}\\p{Cf}-]+)*\\.(?:xn--[a-z0-9-]+|[\\p{L}\\p{M}\\p{Cf}]{2,})|localhost|[0-9]{1,3}(?:\\.[0-9]{1,3}){3})(?::[0-9]+)?/(?:[^\\s<>]*[^\\s<>.,;:!?)\\]\"'])?";
def dec_email: "[\\p{L}\\p{M}\\p{N}\\p{Cf}._%+-]+@[\\p{L}\\p{M}\\p{N}\\p{Cf}.-]+\\.(?:[Xx][Nn]--[A-Za-z0-9-]+|[\\p{L}\\p{M}\\p{Cf}]{2,})";
def dec_handle: "(?<![\\w.])@[A-Za-z0-9][A-Za-z0-9_.-]*";
def dec_slack: "<@[^>]*>|<[#!][^>]*>|<[^<>]*://[^<>]*>";
def dec_pem: "-{4,5} ?BEGIN [^-]+-{4,5}.*?(?:-{4,5} ?END [^-]+-{4,5}|$)";
def dec_keys: "(?<![A-Za-z0-9_-])(?:xox[a-z]-[A-Za-z0-9-]+|xapp-[A-Za-z0-9-]+|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-ant-[A-Za-z0-9_-]+|sk-(?:proj-)?[A-Za-z0-9_-]{20,}|[rs]k_(?:live|test)_[A-Za-z0-9]{10,}|(?:AKIA|ASIA)[A-Z0-9]{16}|AIza[0-9A-Za-z_-]{30,}|eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]*|-{4,5} ?(?:BEGIN|END) [^-]+-{4,5})";
def esc: gsub("(?<c>[\\\\^$.|?*+()\\[\\]{}/-])"; "\\\(.c)");
# Slack forms, links (with a scheme, www. or host.tld/path), e-mails in any case, a whole
# private key, keys, @handles, then every known name ($nre: one alternation, longest first).
def scrub($nre): gsub("<@[^>]*>"; "[person]") | gsub("<[#!][^>]*>"; "[mention]") | gsub("<[^<>]*://[^<>]*>"; "[link]")
  | gsub(dec_link; "[link]"; "i") | gsub(dec_email; "[e-mail]") | gsub(dec_pem; "[key]") | gsub(dec_keys; "[key]")
  | gsub(dec_handle; "[person]") | if $nre == "" then . else gsub($nre; "\(.p)[person]"; "i") end;
def leaks: test(dec_slack) or test(dec_link; "i") or test(dec_email) or test(dec_keys) or test(dec_handle);
JQ
)"
decisions_page() {
  DEC_DUE='[]' DEC_BLOCKED=''
  local CONF="$1" DB="$DESK_DIR/db.json" PAGE="$WORK/decisions-page.md" REC="$WORK/decisions-page.json" roster rnames sha old
  [ "$(jq -r .decisions_page <<<"$CONF")" = dam ] || { return; }
  [ -f "$DB" ] || { log "decisions page: no Desk store yet"; return; }
  # Every name the roster and the store hold, masked in the free text: a roster row's name and
  # addresses; in the store, a person's name, login and address, wherever a record keeps one
  # (an author, a reporter, a voter, a GitHub login), whole and in parts of 3 or more letters.
  rnames="$(cfg_table 'Desk people' | awk -F'|' '{print $2 "\t" $4}' \
    | jq -R 'split("\t") | (.[1] // ""), (.[0] | split(",")[] | split("@")[0])' | jq -sc .)" \
  && jq -c --argjson rn "${rnames:-[]}" "$DEC_JQ"'
      def pkeys: "author", "by", "reporter", "user", "actor", "voter", "voters", "requester", "assignee", "assignees", "person", "who", "login", "handle", "display_name", "created_by";
      [ .. | objects
        | (select(has("email") or has("emails") or has("login") or has("sub") or has("role")) | .name),
          (to_entries[] | select(.key | IN(pkeys)) | .value | (if type == "array" then .[] else . end) | if type == "object" then .name, .login, .handle, .display_name else . end),
          (keys[] | select(test("^[^@\\s]+@[^@\\s]+$")) | split("@")[0]),
          (to_entries[] | select(.key == "email" or .key == "emails") | .value | (strings, (arrays | .[] | strings)) | split("@")[0]) ] + $rn
      | [ .[] | strings | gsub("^\\s+|\\s+$"; "") | select(length > 0) | ., splits("[\\s._+-]+") ]
      | map(select(length >= 3)) | unique | sort_by(-length) | map(esc) | join("|")
      | if . == "" then "" else "(?<p>^|[^\\p{L}\\p{N}_])(?:" + . + ")(?![\\p{L}\\p{N}_])" end' "$DB" > "$PAGE.names" 2>/dev/null \
  || { rm -f "$PAGE.names"; DEC_BLOCKED="cannot read the names to mask from the roster or the Desk store at $DB"; log "decisions page: $DEC_BLOCKED — not published"; return; }
  # The roster's roles by e-mail, as the Desk server reads them (desk/server.mjs → sideOf); a
  # decision not approved there (withSide) is not published.
  # A row's email cell may list several addresses, each of them that person's (docs/config.md).
  roster="$(cfg_table 'Desk people' | awk -F'|' '{print $2 "\t" $3}' \
    | jq -R 'split("\t") | (.[1] // "" | gsub("^\\s+|\\s+$"; "") | ascii_downcase | gsub("\\s+"; "-")) as $r
        | .[0] | split(",")[] | gsub("^\\s+|\\s+$"; "") | ascii_downcase | select(length > 0) | {key: ., value: $r}' | jq -sc 'reverse | from_entries')"
  jq -r --arg name "$(jq -r .display_name <<<"$CONF")" --argjson roster "${roster:-{\}}" --slurpfile nre "$PAGE.names" "$DEC_JQ"'
    def line: tostring | gsub("\\s*\\n\\s*"; " ") | gsub("^\\s+|\\s+$"; "") | scrub($nre[0]);
    def num: .id | ltrimstr("D-") | tonumber? // 0;
    def day: tostring | .[0:10];
    def role: (((.origin.kind // "") as $k | if (["desk", "approval", "chat", "call"] | index($k)) != null then .author.role else null end) // $roster[(.author.email // "") | ascii_downcase] // "" | ascii_downcase | gsub("\\s+"; "-") | if . == "lead" then "admin" else . end);
    def who: {admin: "an admin", designer: "a designer", pm: "a product manager", "lead-developer": "the lead developer", developer: "a developer"}[role];
    def side: role as $r | (.origin.kind // "") as $k
      | if (["admin", "designer", "pm"] | index($r)) != null then "design"
        elif (["lead-developer", "developer"] | index($r)) != null or (["pr", "commit", "doc"] | index($k)) != null then "developer" else null end;
    def unapproved: (.origin.kind // "") as $k | side != "design" or (["pr", "issue", "commit", "doc"] | index($k)) != null;
    def from: {pr: "a pull request", issue: "an issue", commit: "a commit", doc: "a document", slack: "Slack", desk: "the Desk",
      call: "the design meeting", approval: "an approved design", chat: "a talk with Design Desk"}[.origin.kind // ""];
    [ (.decisions // {})[] | select(type == "object" and (.id | type) == "string") ] as $all
    | ($all | map(select((.status // "active") == "active" and (.approved != null or (unapproved | not)))) | sort_by(num)) as $on
    | ($all | map(select(.status == "revoked")) | sort_by(num)) as $off
    | ([ $all[] | .recorded, .at, .revoked.at?, (.history // [])[]?.at, .approved.at? ] | map(select(type == "string")) | max // "") as $last
    | "# Design decisions: \($name | line)",
      "",
      "The design decisions this product'"'"'s team has made, kept by Design Desk. Follow every decision in force when you change what a person sees in the product: a screen, a part, a state, a word. A change that must go against one says so in its pull request, names the decision (D-<n>), and waits for a designer: never work around one silently. A revoked decision binds nothing: it is listed so that an old reference to it makes sense.",
      "",
      "In force: \($on | length) · Revoked: \($off | length) · Last change: \(if $last == "" then "none" else ($last | day) end)",
      "",
      (if ($on | length) > 0 then
        "## Index by concept", "",
        ([ $on[] | . as $d | (.concepts // [])[] | {c: (. | line), id: $d.id} ] | group_by(.c)[] | "- \(.[0].c): \(map(.id) | join(", "))"),
        "", "## In force", "",
        ($on[] | . as $d
          | "### \(.id) · \((.concepts // []) | map(line) | join(", "))", "", (.text | line), "",
            (if ((.why // "") | line) != "" then "Why: \(.why | line)", "" else empty end),
            ("Decided \(.at // .recorded // "" | day)\(if who then " by \(who)" else "" end)\(if from then ", from \(from)" else "" end)."
              + (if (.replaces // []) | length > 0 then " Replaces \(.replaces | join(", "))." else "" end)),
            "")
      else "No decision is in force yet.", "" end),
      (if ($off | length) > 0 then
        "## Revoked", "",
        ($off[] | "- \(.id) (\((.concepts // []) | map(line) | join(", "))): \(.text | line) Revoked \(.revoked.at // "" | day)"
          + (if ((.revoked.reason // "") | line) != "" then ": \(.revoked.reason | line | rtrimstr("."))." else "." end)
          + (if .revoked.replaced_by and ((.revoked.reason // "") | contains("Replaced by") | not) then " Replaced by \(.revoked.replaced_by)." else "" end))
      else empty end)' "$DB" > "$PAGE.tmp" 2>/dev/null || { rm -f "$PAGE.tmp" "$PAGE.names"; DEC_BLOCKED="cannot read the Desk store at $DB"; log "decisions page: $DEC_BLOCKED"; return; }
  rm -f "$PAGE.names"
  # Fail closed: a link, a Slack form, an address or handle, or a key left anywhere on the
  # finished page (an id, a field the redaction missed) keeps it from being due. The gate
  # names the first decision that holds one, and the field.
  local hit
  if ! hit="$(jq -Rsr "$DEC_JQ"'
      def field: if test("^### ") then "id or concepts" elif test("^Why: ") then "why" elif test("^Decided ") then "record"
        elif test("^- D-") then "revoked line" elif test("^- ") then "index" else "text" end;
      reduce split("\n")[] as $l ({id: null, hit: null};
        if .hit then . else
          (if ($l | test("^## ")) then .id = null elif ($l | test("^(### |- )D-")) then .id = ($l | capture("^(### |- )(?<i>D-[A-Za-z0-9]*)").i) else . end)
          | if ($l | leaks) then .hit = (if .id then "decision \(.id) (its \($l | field))"
            elif ($l | field) == "index" then ([$l | sub("^- [^:]*: "; "") | split(", ")[] | select(leaks) | capture("^(?<i>D-[A-Za-z0-9]*)").i] | first) as $i
              | (if $i then "decision \($i) (its index entry)" else "the index by concept" end)
            else "the page header" end) else . end end)
      | .hit // empty' "$PAGE.tmp" 2>/dev/null)" || [ -n "$hit" ]; then
    rm -f "$PAGE.tmp"
    if [ -n "$hit" ]; then DEC_BLOCKED="$hit still holds a link, an address, a mention or a key"
    else DEC_BLOCKED="the check of the rendered page failed"; fi
    log "decisions page: $DEC_BLOCKED — not published (docs/decisions-page.md)"; return
  fi
  mv "$PAGE.tmp" "$PAGE"
  sha="sha256:$( (sha256sum 2>/dev/null || shasum -a 256) < "$PAGE" | cut -c1-16)"
  old="$(jq -r '.sha // ""' "$REC" 2>/dev/null)"
  if [ "$sha" = "$old" ]; then log "decisions page: unchanged since its last publish"; return; fi
  log "decisions page: changed ($sha) — publish it"
  DEC_DUE="$(jq -nc --arg file "$PAGE" --arg sha "$sha" --arg artifact "$(jq -r '.id // ""' "$REC" 2>/dev/null)" --rawfile page "$PAGE" \
    '[{id: "decisions-page", file: $file, sha: $sha, artifact: (if $artifact == "" then null else $artifact end),
       counts: ($page | split("\n") | map(select(startswith("In force: ")))[0])}]')"
}

# ============================================================ ISSUES MODE ===
# The open issues of each watched repository, for the Desk's Issues page (docs/issues.md).
# The agent judges whether an issue changes the screens; this pass only says which issues
# are new or changed since that judgement (work/ISSUES.tsv: the columns of CHANGES.tsv,
# the issue's updated_at in the third), which judged ones to draw, which moved between the
# buckets, which left them (its card is archived, its row stays carded so it comes back),
# and which closed — each closed one verified by its own lookup, never by its absence. The decisions over hundreds of issues
# are one jq program per repository: a process per issue would outrun the gate's budget.
issues_mode() {
  local CONF REPOS SPRINT_CFG NEXT_CFG LABEL MAXD DB="$DESK_DIR/db.json" ILEDGER="$WORK/ISSUES.tsv"
  CONF="$(config_json)"
  # The decisions page rides on this daily pass, whether the Issues page is on or not.
  decisions_page "$CONF"
  [ "$(jq -r .issue_news <<<"$CONF")" = enabled ] || { log "the Issues page is off (issue_news)"; page_only_out "$CONF"; }
  REPOS="$(jq -r '.repos' <<<"$CONF")"
  [ "$REPOS" = none ] && { log "no watched repositories (repos: none)"; page_only_out "$CONF"; }
  SPRINT_CFG="$(jq -r .issue_sprint <<<"$CONF")"; NEXT_CFG="$(jq -r .issue_next_sprint <<<"$CONF")"
  LABEL="$(jq -r .issue_news_label <<<"$CONF")"; [ "$LABEL" = none ] && LABEL=""; MAXD="$(jq -r .max_issue_drawings <<<"$CONF")"
  # Reading is cheap and drawing is not: a backlog is read over several passes.
  local MAXJ="${ISSUES_MAX_JUDGE:-40}" MAXC="${ISSUES_MAX_CLOSE_CHECKS:-15}"
  [ -f "$ILEDGER" ] || { mkdir -p "$WORK"; printf 'repo\tissue\tissue_updated\tstatus\tcard\tupdated\tattempts\tnote\n' > "$ILEDGER"; }
  # The issue cards on the Desk, and the ones a person asked to draw that wait for it.
  local cards='[]' drawing='[]' designed='[]'
  if [ -f "$DB" ]; then
    cards="$(jq -c '[.cards[] | select(.kind == "issue" and .status != "archived")
      | {id, repo: .source.repo, issue: (.source.issue | tostring), bucket, sketches: ((.sketches // []) | length), failures: (.draw.failures // 0), handled: (.handled != null)}]' "$DB" 2>/dev/null)" \
      || fail_out "cannot read the Desk store at $DB"
    drawing="$(jq -c '[.inbox[]? | select(.kind == "draw" and .state != "done") | .card]' "$DB" 2>/dev/null || echo '[]')"
    # The issues a request sent to developers came from or went to: done on the design side,
    # never drawn (docs/issues.md → On the Desk). "owner/name#12", whatever the link points into.
    designed="$(jq -c '(.cards | map(select(.kind == "issue")) | INDEX(.id)) as $I
      | [ .cards[] | select(.kind == "request" and .status == "handed-off")
          | ($I[.request.from // ""].source.url // empty), (.spec.issue_url // empty) ]
      | map(capture("^https?://[^/]+/(?<r>[^/]+/[^/]+)/(issues|pull)/(?<n>[0-9]+)"; "i")? | "\(.r | ascii_downcase)#\(.n)") | unique' "$DB" 2>/dev/null || echo '[]')"
  fi
  local news='[]' draw='[]' nmove=0 nleave=0 nclose=0 deferred=0 sprints='{}' nexts='{}' repo
  for repo in $(printf '%s' "$REPOS" | tr ',' ' '); do
    local slug sprint="" next="" found pass ms='[]'; slug="$(repo_slug "$repo")"
    local hostargs=(); case "$repo" in */*/*) hostargs=(--hostname "${repo%%/*}");; esac
    # The current sprint: the open milestone due next (today counts), or the one named; the
    # next sprint: the open milestone due after it, or the one named.
    if [ "$SPRINT_CFG" = milestone ] || [ "$NEXT_CFG" = milestone ]; then
      found="$(gh api ${hostargs[@]+"${hostargs[@]}"} "repos/$slug/milestones?state=open&sort=due_on&direction=asc&per_page=50" 2>/dev/null)" \
        && jq -e 'type == "array"' >/dev/null 2>&1 <<<"$found" || fail_out "could not list the milestones of $repo — is the GitHub connection granted?"
      ms="$(jq -c --arg today "${NOW_ISO%%T*}" '[.[] | select(.due_on != null and .due_on[0:10] >= $today) | .title]' <<<"$found")"
    fi
    case "$SPRINT_CFG" in none) ;; milestone) sprint="$(jq -r '.[0] // ""' <<<"$ms")";; *) sprint="$SPRINT_CFG";; esac
    case "$NEXT_CFG" in
      none) ;;
      milestone) [ -n "$sprint" ] && next="$(jq -r --arg s "$sprint" '(index($s) // -9) as $i | .[$i + 1] // ""' <<<"$ms")";;
      *) next="$NEXT_CFG";;
    esac
    sprints="$(jq -c --arg r "$repo" --arg s "$sprint" '. + {($r): (if $s == "" then null else $s end)}' <<<"$sprints")"
    nexts="$(jq -c --arg r "$repo" --arg s "$next" '. + {($r): (if $s == "" then null else $s end)}' <<<"$nexts")"
    log "$repo: current sprint ${sprint:-none}, next ${next:-none}"
    found="$(search "$repo" "repo:$slug is:issue is:open")" || fail_out "could not list the open issues of $repo"
    # An issue is on the page when it is in the sprint, the next sprint, someone's or
    # labelled; a sub-issue counts in its parent's sprint (an epic's, by parent_issue_url).
    # Per issue, the ledger's last row decides: read it (first, changed, returned, takeover,
    # retry) or not; a read one follows the plan (move, leave) and gets its pictures once
    # (draw). In bucket order, the most recently updated first in each.
    # A date nobody can read (scripts/lib/time.sh) sorts as the oldest, and a claim row whose
    # time nobody can read is taken over: it cannot show that its session is alive.
    pass="$(jq -c --arg repo "$repo" --arg slug "$slug" --arg sprint "$sprint" --arg next "$next" --arg label "$LABEL" --arg now "$NOW_ISO" --argjson nowe "$NOW_EPOCH" \
      --rawfile ledger "$ILEDGER" --argjson cards "$cards" --argjson drawing "$drawing" --argjson designed "$designed" \
      --argjson maxd "$((MAXD - $(jq length <<<"$draw")))" --argjson maxj "$((MAXJ - $(jq '[.[] | select(.need == "judge")] | length' <<<"$news")))" "$EPOCH_JQ"'
      def plan: if $sprint != "" and .milestone.title == $sprint then "sprint" elif $next != "" and .milestone.title == $next then "next" else null end;
      (.items | map(select(.url != null) | {key: .url, value: plan}) | from_entries) as $P
      | def bucket: (plan // $P[.parent_issue_url // ""]
          // if ((.assignees // []) | length) > 0 then "assigned"
             elif $label != "" and ([(.labels // [])[].name] | index($label)) != null then "label" else "out" end);
      ($ledger | split("\n") | .[1:] | map(select(length > 0) | split("\t") | select(.[0] == $repo))
        | reduce .[] as $r ({}; .[$r[1]] = {iupd: $r[2], status: $r[3], card: $r[4], ts: $r[5], attempts: (($r[6] | tonumber?) // 0)})) as $L
      | ($cards | map(select(.repo == $repo)) | INDEX(.issue)) as $C
      | [ .items[] | select(.pull_request == null) | . + {b: bucket} ]
      | sort_by([({sprint: 0, next: 1, assigned: 2, label: 3, out: 4}[.b]), ((.updated_at | epoch) as $at | if $at == null then 0 else 0 - $at end)])
      | reduce .[] as $i ({news: [], draw: [], rows: [], logs: [], seen: [], nj: 0, nd: 0, deferred: 0};
          ($i.number | tostring) as $n | ($L[$n] // {}) as $row | $C[$n] as $card
          | ($row.status // "") as $st
          | (if $st == "" then "first"
             elif ($st == "carded" or $st == "skipped") then (if $row.iupd != $i.updated_at then "changed" elif $st == "carded" and $card == null then "returned" else null end)
             elif ($st == "due" or $st == "in_progress") then (($row.ts | epoch) as $at | if $at == null or ($nowe - $at) >= 10800 then "takeover" else "held" end)
             elif $st == "failed" then (if $row.attempts < 3 then "retry" else "gave-up" end)
             else null end) as $kind
          | ((($card.sketches // 0) == 0) and (($card.failures // 0) < 2) and (($card.handled // false) | not)
             and (($designed | index("\($slug | ascii_downcase)#\($n)")) == null)
             and ($card == null or ($drawing | index($card.id)) == null)) as $wants
          | ($card.id // (if ($row.card // "") == "" then null else $row.card end)) as $cid
          | {id: "\($repo)#\($n)", repo: $repo, issue: $i.number, card: $cid, title: ($i.title | gsub("[\t\n]"; " ")), url: $i.html_url,
             author: $i.user.login, updated: $i.updated_at, bucket: $i.b, milestone: ($i.milestone.title // null),
             assignees: [($i.assignees // [])[].login], labels: [($i.labels // [])[].name]} as $e
          | .seen += [$n]
          | if $i.b == "out" then (if $card != null then .news += [$e + {need: "leave", judge: false, kind: null}] | .logs += ["\($e.id): left the plan — archive its card"] else . end)
            elif $kind == "held" then .logs += ["\($e.id): \($st) since \($row.ts) — left to its session"]
            elif $kind == "gave-up" then .logs += ["\($e.id): failed \($row.attempts) times — left for the audit"]
            elif $kind != null then
              (if $wants and .nd < $maxd then .draw += [$e + {need: "draw", judge: true, kind: $kind}] | .nd += 1 | .logs += ["\($e.id): \($i.b), \($kind) — to read and draw"]
               elif .nj < $maxj then .news += [$e + {need: "judge", judge: true, kind: $kind}] | .nj += 1 | .logs += ["\($e.id): \($i.b), \($kind) — to read"]
               else .deferred += 1 end)
              | if (.draw + .news | map(.id) | index($e.id)) != null
                then .rows += [[$repo, $n, $i.updated_at, "due", ($cid // ""), $now, ($row.attempts // 0 | tostring), $i.b] | join("\t")] else . end
            elif $st == "carded" and $card != null then
              (if $card.bucket != $i.b then .news += [$e + {need: "move", judge: false, kind: null}] | .logs += ["\($e.id): moved to \($i.b)"] else . end)
              | (if $wants then (if .nd < $maxd then .draw += [$e + {need: "draw", judge: false, kind: null}] | .nd += 1 | .logs += ["\($e.id): \($i.b) — to draw"] else .deferred += 1 end) else . end)
            else . end)' <<<"$found")" || fail_out "cannot decide the issues of $repo"
    jq -r '.rows[]' <<<"$pass" >> "$ILEDGER"
    while IFS= read -r l; do [ -n "$l" ] && log "$l"; done < <(jq -r '.logs[]' <<<"$pass")
    news="$(jq -c --argjson p "$pass" '. + $p.news' <<<"$news")"; draw="$(jq -c --argjson p "$pass" '. + $p.draw' <<<"$draw")"
    nmove=$((nmove + $(jq '[.news[] | select(.need == "move")] | length' <<<"$pass"))); nleave=$((nleave + $(jq '[.news[] | select(.need == "leave")] | length' <<<"$pass"))); deferred=$((deferred + $(jq .deferred <<<"$pass")))
    # A card whose issue the list no longer shows: closed only when its own lookup says so.
    local checks=0 cid cnum state
    while IFS=$'\t' read -r cid cnum; do
      [ -n "$cid" ] || continue
      [ "$checks" -lt "$MAXC" ] || { log "$repo: more cards to check for closed issues — next pass"; break; }
      checks=$((checks + 1))
      state="$(gh api ${hostargs[@]+"${hostargs[@]}"} "repos/$slug/issues/$cnum" --jq .state 2>/dev/null)" || { log "$repo#$cnum: could not read its state — next pass"; continue; }
      [ "$state" = closed ] || continue
      news="$(jq -c --arg id "$repo#$cnum" --arg repo "$repo" --argjson n "$cnum" --arg card "$cid" '. + [{id:$id, repo:$repo, issue:$n, need:"close", judge:false, card:$card}]' <<<"$news")"
      nclose=$((nclose + 1)); log "$repo#$cnum: closed — archive its card"
    done < <(jq -r --arg r "$repo" --argjson seen "$(jq -c .seen <<<"$pass")" '.[] | select(.repo == $r and (.issue as $i | $seen | index($i) | not)) | [.id, .issue] | @tsv' <<<"$cards")
  done
  local njudge ndraw; njudge="$(jq '[.[] | select(.need == "judge")] | length' <<<"$news")"; ndraw="$(jq length <<<"$draw")"
  [ "$deferred" -gt 0 ] && log "$deferred more issues wait for the next pass (at most $MAXJ to read and $MAXD to draw a pass)"
  printf '%s read=%s draw=%s move=%s leave=%s close=%s deferred=%s\n' "$NOW_ISO" "$njudge" "$ndraw" "$nmove" "$nleave" "$nclose" "$deferred" >> "$WORK/ISSUES.log"
  [ "$(jq length <<<"$news")" -gt 0 ] || [ "$ndraw" -gt 0 ] || page_only_out "$CONF"
  logev info preflight "issues: $njudge to read, $ndraw to draw, $nmove moved, $nleave left, $nclose closed"
  jq -n --argjson news "$news" --argjson draw "$draw" --argjson sprints "$sprints" --argjson nexts "$nexts" --argjson dec "$DEC_DUE" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    --arg title "$(jq -r '.[] | "#\(.issue)"' <<<"$(jq -c --argjson a "$draw" '$a + .' <<<"$news")" | title_for Read issues)" \
    '{mode:"issues", nothing_to_do:false, title:$title, sprint:$sprints, next_sprint:$nexts,
      read_set: (["docs/issues.md", ".agents/skills/explain/SKILL.md"] + (if ($draw | length) > 0 then ["docs/screens.md"] else [] end) + (if ($dec | length) > 0 then ["docs/decisions-page.md"] else [] end)),
      issue_news_due:$news, drawings_due:$draw, decisions_page_due:$dec, config:$config, logs:$logs}'
}

# No issue to read or draw: the run is the decisions page alone, or nothing.
page_only_out() {
  [ "$(jq length <<<"$DEC_DUE")" -gt 0 ] || quiet_out
  logev info preflight "issues: the decisions page changed"
  jq -n --argjson dec "$DEC_DUE" --argjson config "$1" --argjson logs "$(logs_json)" \
    '{mode:"issues", nothing_to_do:false, title:"Publish the design decisions", read_set:["docs/decisions-page.md"],
      issue_news_due:[], drawings_due:[], decisions_page_due:$dec, config:$config, logs:$logs}'
  exit 0
}

# ============================================================ INBOX MODE ====
inbox_mode() {
  local INBOX="$DESK_DIR/inbox.json" DB="$DESK_DIR/db.json" CONF ttl_s
  CONF="$(config_json)"
  if [ ! -f "$INBOX" ]; then log "no Desk inbox yet ($INBOX) — the Desk server has not started"; quiet_out; fi
  jq -e '.open | type == "array"' "$INBOX" >/dev/null 2>&1 || fail_out "$INBOX is not an inbox document — the Desk server writes it; see docs/desk.md → Server"
  # The server owns the claim TTL and writes it into the inbox. A hand-made inbox may
  # omit it; use the store's current lease rather than the retired two-hour lock.
  ttl_s=$(( $(jq -r '.claim_ttl_min // 15' "$INBOX") * 60 ))
  # Open items, plus claimed ones whose lease is past its TTL (the session died or stopped
  # renewing it) or whose claim time nobody can read (scripts/lib/time.sh: such a claim
  # cannot show it is alive). A live session renews its claim with --heartbeat.
  local items
  items="$(jq -c --argjson now "$NOW_EPOCH" --argjson ttl "$ttl_s" "$EPOCH_JQ"'
    [ (.open[] | . + {takeover:false}),
      (.claimed[] | select((.claimed_at | epoch) as $at | $at == null or ($now - $at) >= $ttl) | . + {takeover:true}) ]' "$INBOX")"
  # A live prototype whose expiry is within a day (and not yet decided for that date),
  # or whose request is closed and whose expiry passed, is due once. An expiry nobody can
  # read is never due: it must not extend or tear down a prototype.
  local expiring="[]"
  if [ -f "$DB" ]; then
    expiring="$(jq -c --argjson now "$NOW_EPOCH" "$EPOCH_JQ"'
      [ .cards[] | select(.kind == "request" and (.prototype.state == "live" or .prototype.state == "building") and .prototype.expires != null)
        | (.status == "declined" or .status == "handed-off") as $closed
        | (.prototype.expires | epoch) as $at | select($at != null)
        | ($at - $now) as $left
        | select(if $closed then $left <= 0 else ($left < 86400 and .prototype.expiry_checked != .prototype.expires) end)
        | {id: ("E-" + .id), card: .id, env: .prototype.env, expires: .prototype.expires, closed: $closed} ]' "$DB" 2>/dev/null || echo '[]')"
  fi
  # An open Slack vote is synced every 30 minutes, and closed on its date or once its
  # request has moved past the options (approved, handed off, closed). A closing time nobody
  # can read never closes a vote; a sync time nobody can read is due, like none (the sync
  # writes a fresh one).
  local polls="[]"
  if [ -f "$DB" ]; then
    polls="$(jq -c --argjson now "$NOW_EPOCH" "$EPOCH_JQ"'
      [ .cards[] | . as $c | (.polls // [])[] | select(.state == "open")
        | (((.closes | epoch) as $at | $at != null and $at <= $now)
           or (($c.status | IN("variants", "feedback", "prototype", "testing")) | not)) as $close
        | select($close or ((.synced | epoch) as $at | $at == null or ($now - $at) >= 1800))
        | {id: .id, card: $c.id, close: $close, closes: .closes} ]' "$DB" 2>/dev/null || echo '[]')"
  fi
  # An open council (a Slack thread whose asks change a request's options) is read every
  # council_sync_min minutes for asks nobody tagged the agent in; it is due to close once its
  # request moved past the options, or three days after the last message the agent read (the
  # agent reads the thread once more and closes it only when nothing new came). An opening
  # time nobody can read is no last message, so it never makes a council idle; a sync time
  # nobody can read is due, like none.
  local councils="[]"
  if [ -f "$DB" ] && [ "$(jq -r .slack_council <<<"$CONF")" = enabled ]; then
    councils="$(jq -c --argjson now "$NOW_EPOCH" --argjson every "$(jq '.council_sync_min * 60' <<<"$CONF")" "$EPOCH_JQ"'
      [ .cards[] | . as $c | (.councils // [])[] | select(.state == "open")
        | ([(.opened | epoch), ((.seen // "0") | tonumber? // 0 | floor)] | map(select(. != null and . > 0)) | max) as $last
        | (if ($c.status | IN("triage", "variants", "feedback", "prototype", "testing")) | not then "moved"
           elif $last != null and ($now - $last) >= 259200 then "idle" else null end) as $why
        | select($why != null or ((.synced | epoch) as $at | $at == null or ($now - $at) >= $every))
        | {id: .id, card: $c.id, close: ($why != null)} + (if $why then {why: $why} else {} end) ]' "$DB" 2>/dev/null || echo '[]')"
  fi
  # With ci_gate on, an open pull request's change card is due as `G-<card>` when it waits for a
  # designer (as the store derives it: its attention, a design check that differs, a decision in
  # force it goes against, a suggestion for the presentation) and was never judged for the gate
  # (no `ci`): the cards already on the Desk when the key was turned on, and any a run missed.
  # A card whose last status write failed (`ci.state: error`) is due again until its 3rd try
  # (docs/watch.md → CI gate). A read that fails is an error line, never an empty list.
  local gate="[]" gate_err=""
  if [ -f "$DB" ] && [ "$(jq -r .ci_gate <<<"$CONF")" = enabled ]; then
    if ! gate="$(jq -c '(.decisions // {}) as $d
        | [ (.cards // {})[] | select(.kind == "change" and (.source | type) == "object" and .source.pr != null
              and (.source.merged_at // null) == null and .status != "archived")
          | (((.attention | if type == "object" then .level else null end) == "designer") or ((.design_check | if type == "object" then .verdict else null end) == "differs")
             or ([(.conflicts // [])[] | objects | ($d[.decision | tostring] | if type == "object" then .status else null end)] | index("active")) != null
             or (.call_suggestion // null) != null) as $wait
          | (.ci | if type == "object" then . else null end) as $ci
          | select(($ci == null and .handled == null and $wait) or ($ci.state == "error" and ($ci.tries // 0) < 3))
          | {id: ("G-" + .id), card: .id, gate: true, retry: ($ci != null)} ]' "$DB" 2>&1)"; then
      log "could not read the Desk's cards for the CI gate: ${gate%%$'\n'*} — no pull request is judged this run"
      logev error preflight "inbox: CI gate read failed"
      gate="[]"; gate_err=1
    fi
  fi
  local n; n="$(jq 'length' <<<"$items")"
  if [ "$n" -eq 0 ] && [ "$(jq 'length' <<<"$expiring")" -eq 0 ] && [ "$(jq 'length' <<<"$polls")" -eq 0 ] && [ "$(jq 'length' <<<"$councils")" -eq 0 ] && [ "$(jq 'length' <<<"$gate")" -eq 0 ] && [ -z "$gate_err" ]; then
    log "Desk inbox empty"; printf '%s due=0\n' "$NOW_ISO" >> "$WORK/INBOX.log"; quiet_out
  fi
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): \(.kind)\(if .card then " on \(.card)" else "" end)\(if .takeover then " (claim past its TTL — takeover)" else "" end)"' <<<"$items")
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): prototype of \(.card) expires \(.expires) — extend or let it go"' <<<"$expiring")
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): Slack vote on \(.card) — \(if .close then "close it" else "sync it" end)"' <<<"$polls")
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): Slack thread on \(.card) — \(if .close then "close it (\(.why))" else "read it" end)"' <<<"$councils")
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): \(.card) waits for a designer — judge it for the CI gate"' <<<"$gate")
  printf '%s due=%s expiring=%s\n' "$NOW_ISO" "$n" "$(jq 'length' <<<"$expiring")" >> "$WORK/INBOX.log"
  logev info preflight "inbox: $n items due"
  jq -n --argjson items "$items" --argjson expiring "$expiring" --argjson polls "$polls" --argjson councils "$councils" --argjson gate "$gate" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    --arg title "$(jq -r '.[].id' <<<"$items" | { ids="$(cat)"; if [ -n "$ids" ]; then printf '%s\n' "$ids" | title_for Work "Desk items"; elif [ "$(jq 'length' <<<"$expiring")" -gt 0 ]; then printf 'Extend Desk prototypes'; elif [ "$(jq 'length' <<<"$polls")" -gt 0 ]; then printf 'Sync Slack votes'; elif [ "$(jq 'length' <<<"$councils")" -gt 0 ]; then printf 'Read Slack threads'; else printf 'Hold pull requests for a designer'; fi; })" '
    def pick(k): [ $items[] | select(.kind as $x | k | index($x)) ];
    { mode:"inbox", nothing_to_do:false, title:$title,
      questions_due: pick(["question"]),
      requests_due: pick(["request", "follow-up"]),
      variants_due: pick(["explore", "revise", "states"]),
      prototypes_due: pick(["build"]),
      handoffs_due: pick(["handoff"]),
      catalog_due: pick(["catalog"]),
      map_due: pick(["map"]),
      agenda_due: pick(["agenda"]),
      teardowns_due: pick(["teardown"]),
      figma_due: pick(["figma"]),
      screens_due: pick(["screens"]),
      slack_due: pick(["slack"]),
      drawings_due: pick(["draw"]),
      people_due: [ pick(["person"])[] | select(.person != null) ],
      decisions_due: pick(["decision"]),
      checks_due: pick(["decision-check"]),
      ci_due: (pick(["ci"]) + $gate),
      polls_due: $polls,
      councils_due: $councils,
      expiring_due: $expiring,
      config:$config, logs:$logs }
    # A pass with only chores (a Slack vote to sync, a GitHub check to set, a prototype about to expire)
    # follows none of the procedures in docs/desk.md: it reads its own doc or skill instead.
    # The explain skill holds the writing rules and is read whatever is due.
    | .read_set = ((if ([$items[] | select(.kind != "ci")] | length) + (.councils_due | length) > 0 then ["docs/desk.md"] else [] end)
        + [".agents/skills/explain/SKILL.md"]
        + (if (.requests_due + .variants_due | length) > 0 then ["docs/requests.md", "docs/boundary.md"] else [] end)
        + (if (.prototypes_due + .teardowns_due + .expiring_due | length) > 0 then ["docs/prototype.md", "docs/boundary.md"] else [] end)
        + (if (.handoffs_due | length) > 0 then ["docs/handoff.md"] else [] end)
        + (if (.ci_due | length) > 0 then ["docs/watch.md"] else [] end)
        + (if (.catalog_due | length) > 0 then ["docs/catalog.md"] else [] end)
        + (if (.map_due | length) > 0 then ["docs/map.md", "docs/screens.md"] else [] end)
        + (if (.figma_due | length) > 0 then [".agents/skills/figma/SKILL.md"] else [] end)
        + (if (.screens_due | length) > 0 then ["docs/screens.md"] else [] end)
        + (if (.drawings_due | length) > 0 then ["docs/issues.md", "docs/screens.md"] else [] end)
        + (if (.slack_due + .polls_due | length) > 0 then [".agents/skills/slack-polls/SKILL.md"] else [] end)
        + (if (.councils_due | length) > 0 then [".agents/skills/slack-council/SKILL.md"] else [] end)
        + (if (.variants_due | length) > 0 then ["docs/actions.md"] else [] end) | unique)'
}

# ============================================================ AUDIT MODE ====
audit_mode() {
  local -a checks=()
  check() { checks+=("$(jq -cn --arg id "$1" --arg st "$2" --arg d "$3" '{id:$id, status:$st, detail:$d}')"); }
  local CONF; CONF="$(config_json)"

  # connectivity
  if login="$(gh api user --jq .login 2>/dev/null)"; then check github ok "authenticated as $login"
  else check github fail "gh api user failed — the GitHub connection is missing or expired"; fi
  for c in jq gh git curl node; do command -v "$c" >/dev/null 2>&1 || check "cli_$c" fail "$c is not on PATH"; done
  if h="$(curl -sf --max-time 5 "http://127.0.0.1:${DESK_PORT:-5555}/health" 2>/dev/null)"; then
    check desk_server ok "$(jq -r '"cards \(.cards), inbox open \(.inbox_open), claimed \(.inbox_claimed), store \(.db_bytes) bytes"' <<<"$h")"
  else check desk_server fail "the Desk server does not answer on 127.0.0.1:${DESK_PORT:-5555} — rc-service --user design-desk-server status (docs/desk.md → Server)"; fi
  [ -n "$(cfg desk_artifact)" ] && check desk_artifact ok "$(cfg desk_artifact)" || check desk_artifact warn "desk_artifact is not set — the Desk page was never published (docs/desk.md → Publishing the page)"
  [ -n "$(cfg desk_link)" ] && check desk_link ok "$(cfg desk_link)" || check desk_link warn "desk_link is not set — items on the Desk have no Copy link (docs/desk.md → Publishing the page)"
  [ "$(cfg_table 'Desk people' | grep -c . || true)" -gt 0 ] && check desk_people ok "$(cfg_table 'Desk people' | grep -c .) people" || check desk_people warn "the Desk people table is empty — everyone but the owner is a guest"
  # The public decisions page (docs/decisions-page.md): published, and not due for long.
  local drec="$WORK/decisions-page.json" dat
  if [ "$(jq -r .decisions_page <<<"$CONF")" = dam ]; then
    decisions_page "$CONF"; dat="$(jq -r '.at // ""' "$drec" 2>/dev/null)"
    if [ -n "$DEC_BLOCKED" ]; then check decisions_page warn "the decisions page is not updated: $DEC_BLOCKED — $(if [ -f "$drec" ]; then echo "the page published before stays public at $(jq -r '.url // "?"' "$drec" 2>/dev/null) until the text is fixed on the Desk"; else echo "nothing is public yet"; fi) (docs/decisions-page.md)"
    elif [ "$(jq length <<<"$DEC_DUE")" -eq 0 ]; then check decisions_page ok "$(jq -r '.url // "no Desk store yet"' "$drec" 2>/dev/null || echo 'no Desk store yet')"
    elif [ -z "$dat" ]; then check decisions_page warn "decisions_page is dam but the page was never published — the issues run publishes it (docs/decisions-page.md)"
    elif [ $((NOW_EPOCH - $(iso2epoch "$dat"))) -gt $((48 * 3600)) ]; then check decisions_page warn "the decisions page changed and was last published at $dat — is design-desk-issues-daily running?"
    else check decisions_page ok "due today, last published $dat"; fi
  elif [ -f "$drec" ]; then check decisions_page warn "decisions_page is off but the page stays published at $(jq -r '.url // "?"' "$drec") — the operator deletes it"; fi

  # toolchain: the design command, a real build and screenshot, saved brand and repo profiles
  local DESIGN="$HOME_DIR/bin/design" t out
  if [ ! -x "$DESIGN" ]; then check toolchain fail "~/bin/design is missing — bash \"\$HOME/scripts/install-toolkit.sh\""
  elif out="$("$DESIGN" doctor 2>&1)"; then check toolchain ok "design doctor passed"
  else check toolchain fail "design doctor: $(printf '%s\n' "$out" | grep -m1 '^FAIL' || echo failed) — bash \"\$HOME/scripts/install-toolkit.sh\", then design doctor"; fi
  if [ -x "$DESIGN" ]; then
    t="$(mktemp -d "${TMPDIR:-/tmp}/design-desk-audit.XXXXXX")"
    cat > "$t/a.src.html" <<'HTML'
<!doctype html><html lang="en" data-review-title="audit"><head><meta charset="utf-8"><title>audit</title><!-- design:css --></head>
<body><!-- design:review-bar --><div data-view="1" data-view-name="Audit" class="p-6 bg-background text-foreground"><h1 class="text-xl font-semibold">Audit</h1><button class="mt-2 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground">Ok</button></div></body></html>
HTML
    if WORK_DIR="$t/work" "$DESIGN" build "$t/a.src.html" "$t/a.html" --style wireframe >/dev/null 2>"$t/err" \
       && WORK_DIR="$t/work" "$DESIGN" shot "$t/a.html" "$t/shots" --width 600 >/dev/null 2>>"$t/err" && [ -s "$t/shots/1-light.png" ]; then
      check render ok "built and screenshotted a wireframe page"
    else check render fail "a build or screenshot failed: $(grep -m1 -E 'design:|Error' "$t/err" || echo unknown) — design doctor, then re-run the audit"; fi
    rm -rf "$t"
  fi
  if [ -f "$WORK/brand/brand.json" ]; then
    jq -e '.colors.accent | test("^#[0-9a-fA-F]{6}$")' "$WORK/brand/brand.json" >/dev/null 2>&1 \
      && check brand ok "$(jq -r '.name // "saved brand"' "$WORK/brand/brand.json")" \
      || check brand fail "work/brand/brand.json does not parse or has no #rrggbb colors.accent — save the brand again (design brand save)"
  fi
  local bad="" n=0 p
  for p in "$WORK"/profiles/*.yaml; do
    [ -e "$p" ] || continue; n=$((n+1))
    grep -qE '^repo: ' "$p" && grep -qE '^(kind|styling): ' "$p" || bad="$bad $(basename "$p")"
  done
  [ -z "$bad" ] && check repo_profiles ok "$n saved" || check repo_profiles fail "malformed:$bad — design repo detect <owner/name> again"

  # backup invariants
  [ -d "$WORK/.git" ] && check work_git fail "work/.git exists — work/ must never be a git repo (concurrent runs corrupt it)" || check work_git ok "work/ is a plain directory"

  # cadence and errors
  local last; last="$(tail -1 "$WORK/WATCH.log" 2>/dev/null | cut -d' ' -f1)"
  if [ "$(jq -r .repos <<<"$CONF")" != "none" ]; then
    if [ -z "$last" ]; then check watch_cadence warn "WATCH.log has no line — the watch schedule never ran its pass"
    elif [ $((NOW_EPOCH - $(iso2epoch "$last"))) -gt $((6 * 3600)) ]; then check watch_cadence warn "the last watch pass was at $last"
    else check watch_cadence ok "last pass $last"; fi
  fi
  # The Issues page is read daily; an issue that failed three times waits for a person.
  if [ "$(jq -r .issue_news <<<"$CONF")" = enabled ]; then
    last="$(tail -1 "$WORK/ISSUES.log" 2>/dev/null | cut -d' ' -f1)"
    if [ -z "$last" ]; then check issues_cadence warn "ISSUES.log has no line — the issues schedule never ran its pass (docs/issues.md)"
    elif [ $((NOW_EPOCH - $(iso2epoch "$last"))) -gt $((30 * 3600)) ]; then check issues_cadence warn "the last issues pass was at $last"
    else check issues_cadence ok "last pass $last"; fi
    local ifailed; ifailed="$(awk -F'\t' 'NR>1 {s[$1"#"$2]=$4; a[$1"#"$2]=$7} END {for (k in s) if (s[k]=="failed" && a[k]>=3) print k}' "$WORK/ISSUES.tsv" 2>/dev/null | sort | head -5 | paste -sd' ' -)"
    [ -z "$ifailed" ] || check issues_failed warn "issues that failed three times: $ifailed"
  fi
  local errs; errs="$(find "$WORK/logs" -name 'events-*.jsonl' -mtime -7 -exec cat {} + 2>/dev/null | jq -c 'select(.level == "error")' 2>/dev/null | wc -l | tr -d ' ')"
  [ "${errs:-0}" -eq 0 ] && check errors ok "no error events in 7 days" || check errors warn "$errs error events in 7 days — see failures"
  local failures; failures="$(find "$WORK/logs" -name 'events-*.jsonl' -mtime -7 -exec cat {} + 2>/dev/null \
    | jq -sc '[ .[] | select(.level == "error") | {sig: ("\(.event): " + (.msg | gsub("[0-9]+"; "N") | .[0:120])), ts} ]
              | group_by(.sig) | map({signature: .[0].sig, count: length, first: (map(.ts) | min), last: (map(.ts) | max)}) | sort_by(-.count) | .[0:15]' 2>/dev/null || echo '[]')"
  find "$WORK/logs" -name 'events-*.jsonl' -mtime +14 -delete 2>/dev/null || true

  # ledger and Desk state
  if [ -f "$LEDGER" ]; then
    # The ledger is append-only: a pull request's state is its last row.
    local stuck; stuck="$(awk -F'\t' 'NR>1 {s[$1"#"$2]=$4} END {for (k in s) if (s[k]=="due" || s[k]=="in_progress") print k}' "$LEDGER" | sort | head -5 | paste -sd' ' -)"
    [ -z "$stuck" ] && check ledger ok "no change stuck in progress" || check ledger warn "changes still due or in progress: $stuck"
    local failed3; failed3="$(awk -F'\t' 'NR>1 {s[$1"#"$2]=$4; a[$1"#"$2]=$7} END {for (k in s) if (s[k]=="failed" && a[k]>=3) print k}' "$LEDGER" | sort | paste -sd' ' -)"
    [ -z "$failed3" ] || check ledger_failed warn "changes that failed three times: $failed3"
  fi
  if [ -f "$DESK_DIR/db.json" ]; then
    local live max; live="$(jq '[.cards[] | select(.prototype.state == "live" or .prototype.state == "building")] | length' "$DESK_DIR/db.json")"
    max="$(jq -r .max_prototypes <<<"$CONF")"
    [ "$live" -le "$max" ] && check prototypes ok "$live live of $max allowed" || check prototypes warn "$live prototypes live, more than max_prototypes=$max — compare with list_environments"
  fi

  # disk, scratch, definition
  local pct; pct="$(df -P "$HOME_DIR" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
  [ "${pct:-0}" -lt 85 ] && check disk ok "${pct:-?}% used" || check disk warn "${pct}% of the disk used — old checkouts under ~/checkouts and work/output can go (docs/audit.md)"
  # What takes the space, so a full disk names its cause.
  mb() { local v; v="$(du -sm "$1" 2>/dev/null | cut -f1)"; echo "${v:-0}"; }
  check usage ok "work/output $(mb "$WORK/output") MB, Desk $(mb "$DESK_DIR") MB, checkouts $(mb "$HOME_DIR/checkouts") MB, toolchains $(mb "$HOME_DIR/.local/share/design-desk/toolchains") MB"
  # The store refuses people's writes at 50 MB (desk/store.mjs LIMITS.dbBytes); warn well before.
  local db_mb; db_mb="$(( $(wc -c < "$DESK_DIR/db.json" 2>/dev/null || echo 0) / 1048576 ))"
  [ "$db_mb" -lt 40 ] && check desk_store ok "db.json ${db_mb} MB of 50" || check desk_store warn "db.json is ${db_mb} MB; at 50 MB the Desk refuses new comments and requests — archive old cards (docs/desk.md → Server)"
  # The last final outcome of a backup: pushed, or failed after its retries.
  local repo="${GITHUB_REPO_WORK:-$(cfg work_repo)}" lastb last_ts
  case "$repo" in
    (""|none|off|disabled) check backup ok "not configured (work/ is local only)" ;;
    (*) lastb="$(grep -h '"event":"work_backup"' "$WORK"/logs/events-*.jsonl 2>/dev/null | grep -E '"msg":"backup (ok|failed): ' | tail -1)"
        last_ts="$(jq -r '.ts // empty' <<<"$lastb" 2>/dev/null)"
        case "$lastb" in
          (*'"level":"error"'*) check backup fail "the last backup to $repo failed ($last_ts): $(jq -r .msg <<<"$lastb" 2>/dev/null) — check that the GitHub connection can write to $repo" ;;
          (*'"level":"warn"'*) check backup warn "the last backup to $repo ($last_ts) left out work/output and work/logs: $(jq -r .msg <<<"$lastb" 2>/dev/null) — they are larger than the backup clone's free space (docs/persistence.md)" ;;
          ("") check backup warn "configured ($repo), but no backup is logged in the last 14 days" ;;
          (*) if [ $((NOW_EPOCH - $(iso2epoch "$last_ts"))) -gt $((2 * 86400)) ]; then check backup warn "the last backup to $repo was at $last_ts, more than two days ago"
              else check backup ok "last backup to $repo at $last_ts"; fi ;;
        esac ;;
  esac
  local left; left="$(find /tmp -maxdepth 1 -name 'design-desk-*' -mmin +360 2>/dev/null | wc -l | tr -d ' ')"
  [ "$left" -eq 0 ] && check tmp ok "no leftover scratch" || check tmp warn "$left leftover /tmp/design-desk-* entries older than 6 h"
  [ -z "$(git -C "$HOME_DIR" status --porcelain 2>/dev/null)" ] && check definition_clean ok "checkout clean" || check definition_clean warn "the definition checkout has local changes"
  local v_here v_adopted; v_here="$(cat "$HOME_DIR/VERSION" 2>/dev/null)"; v_adopted="$(cat "$WORK/VERSION" 2>/dev/null)"
  [ "$v_here" = "$v_adopted" ] && check version ok "$v_here" || check version warn "checkout $v_here, adopted ${v_adopted:-none} — migrate in the direct session (docs/persistence.md)"

  local stats; stats="$(jq -n \
    --arg changes "$(awk -F'\t' -v since="$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)" 'NR>1 && $4=="carded" && $6>=since' "$LEDGER" 2>/dev/null | wc -l | tr -d ' ')" \
    --arg watch_runs "$(grep -c . "$WORK/WATCH.log" 2>/dev/null || echo 0)" '{changes_carded_7d: ($changes|tonumber), watch_passes_total: ($watch_runs|tonumber)}')"
  jq -n --argjson checks "$(printf '%s\n' "${checks[@]}" | jq -s .)" --argjson failures "$failures" --argjson stats "$stats" \
    --argjson config "$CONF" --argjson logs "$(logs_json)" \
    '{mode:"audit", nothing_to_do:false, title:"Audit design-desk", read_set:["docs/audit.md"], checks:$checks, failures:$failures, stats:$stats, config:$config, logs:$logs}'
}

# ============================================================ DIGEST MODE ===
# The week in the Desk's own store: what shipped, what was asked, decided and voted on, and
# 30 days of what people said, for the themes. The week is the seven whole UTC days up to
# yesterday: the page's name and its items share that span. Read-only; nothing in a quiet week.
digest_mode() {
  local DB="$DESK_DIR/db.json" CONF period
  CONF="$(config_json)"
  [ "$(jq -r .digest <<<"$CONF")" = disabled ] && { log "digest disabled"; quiet_out; }
  [ -f "$DB" ] || { log "no Desk store yet"; quiet_out; }
  period="$(date -u +%G-W%V)"
  local out
  out="$(jq -c --argjson now "$NOW_EPOCH" --arg period "$period" "$EPOCH_JQ"'
    def within($s): epoch as $at | $at != null and $at >= ($now - $s);
    (30 * 86400) as $month | ($now / 86400 | floor | . * 86400) as $end | ($end - 7 * 86400) as $start
    | def inweek: epoch as $e | $e != null and $e >= $start and $e < $end;
    def day($e): ($e | strftime("%d %b %Y") | ltrimstr("0"));
    # Named by its days: "29 Oct – 4 Nov 2026", the year once when both days share it.
    [day($start), day($end - 86400)] as [$from, $to]
    | [.cards[]] as $cards
    | {
      done: any($cards[]; .kind == "digest" and .period == $period),
      dates: ((if $from[-4:] == $to[-4:] then $from[:-5] else $from end) + " – " + $to),
      changes: [ $cards[] | select(.kind == "change" and ((.source.merged_at // .created) | inweek))
                 | {id, title, merged_at: .source.merged_at, in_progress: (.source.merged_at == null), screen: ([.screens[]? | select(.stage == "after" or .stage == null) | .asset][0])} ],
      requests_new: [ $cards[] | select(.kind == "request" and (.created | inweek)) | {id, title, type: .request.type, status} ],
      handed_off: [ $cards[] | select(.kind == "request" and .status == "handed-off" and (.updated | inweek)) | {id, title} ],
      waiting: [ $cards[] | select(.agenda.status == "queued") | {id, title, note: .agenda.note} ],
      polls: [ $cards[] | . as $c | (.polls // [])[] | select(.state == "open" or (.closed | inweek)) | {card: $c.id, title: $c.title, state, closes, result} ],
      decisions: [ (.decisions // {})[] | select(.recorded | inweek) | {id, text, concepts, author, conflicts} ],
      revoked: [ (.decisions // {})[] | select(.revoked.at | inweek) | {id, text, reason: .revoked.reason, replaced_by: .revoked.replaced_by} ],
      feedback: ([ ($cards[] | select(.kind == "request" and .request.type == "bug" and (.created | within($month)))
                   | {card: .id, kind: (if .origin.automated then "test finding" else "bug" end), text: ((.title + ": " + (.request.problem // ""))[0:240])}),
                 (.threads[]? | select((.kind == "comment" or .kind == "concern" or .kind == "question") and (.dev != true) and (.created | within($month)) and (.messages[0].by.agent != true))
                   | {card, kind, text: (.messages[0].text[0:240])}) ] | .[0:150])
    }' "$DB" 2>/dev/null)" || fail_out "cannot read the Desk store at $DB"
  if [ "$(jq -r .done <<<"$out")" = true ]; then log "the digest of $period is written"; quiet_out; fi
  if [ "$(jq '(.changes + .requests_new + .handed_off + .decisions + .revoked + .feedback) | length' <<<"$out")" -eq 0 ]; then
    log "a quiet week: nothing to digest for $period"; quiet_out
  fi
  log "digest $period ($(jq -r .dates <<<"$out")): $(jq -r '"\(.changes|length) changes, \(.requests_new|length) new requests, \(.decisions|length) decisions, \(.revoked|length) revoked, \(.feedback|length) pieces of feedback"' <<<"$out")"
  jq -n --argjson d "$out" --arg period "$period" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    '$d + {mode:"digest", nothing_to_do:false, period:$period, title:("Weekly UX digest " + $period), read_set:["docs/digest.md", ".agents/skills/explain/SKILL.md"], config:$config, logs:$logs} | del(.done)'
}

case "$MODE" in
  watch) watch_mode ;;
  inbox) inbox_mode ;;
  digest) digest_mode ;;
  issues) issues_mode ;;
  audit) audit_mode ;;
  *) fail_out "unknown mode: $MODE" ;;
esac
