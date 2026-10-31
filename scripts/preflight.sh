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
    --arg prototype_remote "$(cfg prototype_remote)" --arg handoff "$(cfg handoff)" \
    --arg desk_ping "$(cfg desk_ping)" --arg bug_reports "$(cfg bug_reports)" \
    --arg watch_open_prs "$(cfg watch_open_prs)" --arg issue_label "$(cfg issue_label)" --arg proposals "$(cfg proposals)" \
    --arg max_proposals_per_week "$(cfg max_proposals_per_week)" --arg implementer "$(cfg implementer)" \
    --arg implementer_mention "$(cfg implementer_mention)" --arg issue_writeback "$(cfg issue_writeback)" --arg notify "$(cfg notify)" --arg run_model "$(cfg run_model)" \
    --arg dispatch "$(cfg dispatch)" --arg work_repo "${GITHUB_REPO_WORK:-$(cfg work_repo)}" \
    --arg audit_report "$(cfg audit_report)" --arg log_level "$(cfg log_level)" \
    '{display_name: ($display_name | if . == "" then "Design Desk" else . end),
      repos: ($repos | if . == "" then "none" else . end),
      watch_since: $watch_since,
      watch_paths: ($watch_paths | if . == "" then "**/*.tsx,**/*.jsx,**/*.vue,**/*.svelte,**/*.css,**/*.scss,**/*.html" else . end),
      max_changes_per_run: ($max_changes_per_run | tonumber? // 10),
      profile: ($profile | if . == "" then "auto" else . end),
      default_style: ($default_style | if . == "" then "auto" else . end),
      prototype_requesters: ($prototype_requesters | if . == "" then "designer, lead" else . end),
      max_prototypes: ($max_prototypes | tonumber? // 2),
      prototype_expiry_days: ($prototype_expiry_days | tonumber? // 7),
      prototype_remote: ($prototype_remote | if . == "" then "none" else . end),
      handoff: ($handoff | if . == "" then "desk" else . end),
      desk_ping: ($desk_ping | if . == "" then "enabled" else . end),
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
      log_level: ($log_level | if . == "" then "info" else . end)}'
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
  local DUE ISSUES; DUE="$(mktemp "${TMPDIR:-/tmp}/design-desk-due.XXXXXX")"; ISSUES="$(mktemp "${TMPDIR:-/tmp}/design-desk-issues.XXXXXX")"
  local ndue=0 nissues=0 deferred=0 skipped=0 seen=0 lookups=0
  # One files call per new candidate; a backlog is spread over passes so a pass stays
  # well inside the Precheck's budget (about 2 s a call through the gateway).
  local MAX_LOOKUPS="${WATCH_MAX_LOOKUPS:-25}"
  local stale_s=$((3 * 3600))
  local OPEN_PRS LABEL; OPEN_PRS="$(jq -r '.watch_open_prs' <<<"$CONF")"; LABEL="$(jq -r '.issue_label' <<<"$CONF")"
  # search <repo> <query> → every item, in pages of 100, up to 5 pages (500) a pass.
  search() {
    local q="$2" out='{"items":[]}' page=1 got
    while [ "$page" -le 5 ]; do
      # Runs in a command substitution: a failure returns, and the caller fails the pass.
      got="$(gh api ${hostargs[@]+"${hostargs[@]}"} -X GET search/issues -f q="$q" -f sort=updated -f order=desc -f per_page=100 -f page="$page" 2>/dev/null)" || return 1
      jq -e '.items | type == "array"' >/dev/null 2>&1 <<<"$got" || return 1
      [ "$(jq -r '.incomplete_results' <<<"$got")" = "true" ] && log "$1: the search reported incomplete results — the rest come next run"
      out="$(jq -c --argjson more "$(jq -c .items <<<"$got")" '.items += $more' <<<"$out")"
      [ "$(jq '.items | length' <<<"$got")" -eq 100 ] || break
      page=$((page + 1))
    done
    [ "$page" -gt 5 ] && log "$1: more than 500 results for \"$q\" — the oldest wait for later passes"
    printf '%s' "$out"
  }
  # The ledger's last row for (repo, number) decides: kind of work, or a reason to skip.
  decide() {  # <repo> <number> <state: merged|open|issue> → prints kind or nothing
    local row status updated attempts
    row="$(awk -F'\t' -v r="$1" -v p="$2" 'NR>1 && $1==r && $2==p' "$LEDGER" | tail -1)"
    status="$(cut -f4 <<<"$row")"; updated="$(cut -f6 <<<"$row")"; attempts="$(cut -f7 <<<"$row")"
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
    found="$(search "$repo" "repo:$slug is:pr is:merged merged:>=$since_day")" \
      || fail_out "could not list merged pull requests of $repo (gh api search/issues failed) — is the GitHub connection granted?"
    items="$(jq -c '.items |= map(. + {state: "merged"})' <<<"$found")"
    # Open pull requests too: a developer's UI is seen, and adjusted, before it ships.
    if [ "$OPEN_PRS" = enabled ]; then
      more="$(search "$repo" "repo:$slug is:pr is:open created:>=$since_day")" || fail_out "could not list open pull requests of $repo"
      items="$(jq -c --argjson more "$(jq -c '.items | map(. + {state: "open"})' <<<"$more")" '.items += $more' <<<"$items")"
    fi
    paths="$(ui_paths_for "$repo")"; ere="$(globs_to_ere "$paths")"
    while IFS=$'\t' read -r num state merged title url author; do
      [ -n "$num" ] || continue
      seen=$((seen + 1))
      [ "$state" = open ] || [ "$(iso2epoch "$merged")" -ge "$(iso2epoch "$SINCE")" ] || continue
      local kind; kind="$(decide "$repo" "$num" "$state")"
      [ -n "$kind" ] || continue
      if [ "$ndue" -ge "$MAXN" ] || [ "$lookups" -ge "$MAX_LOOKUPS" ]; then deferred=$((deferred + 1)); continue; fi
      lookups=$((lookups + 1))
      # Per candidate: its files, to keep only PRs that touch the UI.
      local files ui n
      files="$(gh api ${hostargs[@]+"${hostargs[@]}"} "repos/$slug/pulls/$num/files?per_page=100" --paginate --jq '.[].filename' 2>/dev/null)" \
        || { log "$repo#$num: could not read its files — retried next run"; continue; }
      ui="$(printf '%s\n' "$files" | grep -E "$ere" || true)"
      n=$(printf '%s\n' "$ui" | grep -c . || true)
      if [ "$n" -eq 0 ]; then
        [ "$state" = merged ] && printf '%s\t%s\t%s\tskipped\t\t%s\t0\tno UI files\n' "$repo" "$num" "$merged" "$NOW_ISO" >> "$LEDGER"
        skipped=$((skipped + 1)); continue
      fi
      printf '%s\t%s\t%s\tdue\t\t%s\t0\t%s, %s UI files\n' "$repo" "$num" "$merged" "$NOW_ISO" "$state" "$n" >> "$LEDGER"
      ndue=$((ndue + 1))
      jq -cn --arg id "$repo#$num" --arg repo "$repo" --argjson pr "$num" --arg state "$state" --arg title "$title" --arg url "$url" \
        --arg merged "$merged" --arg author "$author" --arg kind "$kind" --argjson n "$n" \
        --argjson files "$(printf '%s\n' "$ui" | head -40 | jq -R . | jq -s '[.[] | select(length>0)]')" \
        '{id:$id, repo:$repo, pr:$pr, state:$state, title:$title, url:$url, merged_at:(if $merged == "" then null else $merged end), author:$author, kind:$kind, ui_file_count:$n, ui_files:$files}' >> "$DUE"
      log "$repo#$num: $state${merged:+ $merged}, $n UI files — due ($kind)"
    done < <(jq -r '.items[] | [.number, .state, (.pull_request.merged_at // ""), (.title | gsub("[\t\n]"; " ")), .html_url, .user.login] | @tsv' <<<"$items")
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
  [ "$skipped" -gt 0 ] && log "$skipped PRs touch no UI file — skipped"
  [ "$deferred" -gt 0 ] && log "$deferred more PRs wait for the next run (max_changes_per_run=$MAXN, at most $MAX_LOOKUPS file lookups a pass)"
  printf '%s changes_due=%s issues_due=%s skipped=%s deferred=%s seen=%s\n' "$NOW_ISO" "$ndue" "$nissues" "$skipped" "$deferred" "$seen" >> "$WORK/WATCH.log"
  local arr iss; arr="$(jq -s '.' "$DUE")"; iss="$(jq -s '.' "$ISSUES")"; rm -f "$DUE" "$ISSUES"
  [ "$ndue" -gt 0 ] || [ "$nissues" -gt 0 ] || quiet_out
  logev info preflight "watch: $ndue changes, $nissues issues due"
  jq -n --argjson due "$arr" --argjson issues "$iss" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    --arg title "$( { jq -r '.[].pr | "#\(.)"' <<<"$arr"; jq -r '.[].issue | "#\(.)"' <<<"$iss"; } | title_for Explain "")" \
    '{mode:"watch", nothing_to_do:false, title:($title | sub("Explain  "; "Explain ")),
      read_set: (["docs/watch.md", ".agents/skills/explain/SKILL.md"] + (if ($issues | length) > 0 then ["docs/requests.md"] else [] end)),
      changes_due:$due, issues_due:$issues, config:$config, logs:$logs}'
}

# ============================================================ INBOX MODE ====
inbox_mode() {
  local INBOX="$DESK_DIR/inbox.json" DB="$DESK_DIR/db.json" CONF ttl_s
  CONF="$(config_json)"
  if [ ! -f "$INBOX" ]; then log "no Desk inbox yet ($INBOX) — the Desk server has not started"; quiet_out; fi
  jq -e '.open | type == "array"' "$INBOX" >/dev/null 2>&1 || fail_out "$INBOX is not an inbox document — the Desk server writes it; see docs/desk.md → Server"
  ttl_s=$((120 * 60))
  # Open items, plus claimed ones whose claim is past its TTL (the session died).
  local items
  items="$(jq -c --argjson now "$NOW_EPOCH" --argjson ttl "$ttl_s" '
    def epoch: (sub("Z$"; "") + "Z") | fromdateiso8601? // 0;
    [ (.open[] | . + {takeover:false}),
      (.claimed[] | select(($now - (.claimed_at | epoch)) >= $ttl) | . + {takeover:true}) ]' "$INBOX")"
  # A live prototype whose expiry is within a day (and not yet decided for that date),
  # or whose request is closed and whose expiry passed, is due once.
  local expiring="[]"
  if [ -f "$DB" ]; then
    expiring="$(jq -c --argjson now "$NOW_EPOCH" '
      def epoch: (sub("\\.[0-9]+"; "") | sub("(\\+00:00|\\+0000)$"; "Z") | fromdateiso8601?) // 0;
      [ .cards[] | select(.kind == "request" and (.prototype.state == "live" or .prototype.state == "building") and .prototype.expires != null)
        | (.status == "declined" or .status == "handed-off") as $closed
        | ((.prototype.expires | epoch) - $now) as $left
        | select(if $closed then $left <= 0 else ($left < 86400 and .prototype.expiry_checked != .prototype.expires) end)
        | {id: ("E-" + .id), card: .id, env: .prototype.env, expires: .prototype.expires, closed: $closed} ]' "$DB" 2>/dev/null || echo '[]')"
  fi
  local n; n="$(jq 'length' <<<"$items")"
  if [ "$n" -eq 0 ] && [ "$(jq 'length' <<<"$expiring")" -eq 0 ]; then
    log "Desk inbox empty"; printf '%s due=0\n' "$NOW_ISO" >> "$WORK/INBOX.log"; quiet_out
  fi
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): \(.kind) on \(.card)\(if .takeover then " (claim past its TTL — takeover)" else "" end)"' <<<"$items")
  while IFS= read -r l; do log "$l"; done < <(jq -r '.[] | "\(.id): prototype of \(.card) expires \(.expires) — extend or let it go"' <<<"$expiring")
  printf '%s due=%s expiring=%s\n' "$NOW_ISO" "$n" "$(jq 'length' <<<"$expiring")" >> "$WORK/INBOX.log"
  logev info preflight "inbox: $n items due"
  jq -n --argjson items "$items" --argjson expiring "$expiring" --argjson config "$CONF" --argjson logs "$(logs_json)" \
    --arg title "$(jq -r '.[].id' <<<"$items" | { ids="$(cat)"; [ -n "$ids" ] && printf '%s\n' "$ids" | title_for Work "Desk items" || printf 'Extend Desk prototypes'; })" '
    def pick(k): [ $items[] | select(.kind as $x | k | index($x)) ];
    { mode:"inbox", nothing_to_do:false, title:$title,
      questions_due: pick(["question"]),
      requests_due: pick(["request", "follow-up"]),
      variants_due: pick(["explore", "revise"]),
      prototypes_due: pick(["build"]),
      handoffs_due: pick(["handoff"]),
      catalog_due: pick(["catalog"]),
      agenda_due: pick(["agenda"]),
      teardowns_due: pick(["teardown"]),
      expiring_due: $expiring,
      config:$config, logs:$logs }
    | .read_set = (["docs/desk.md"]
        + (if (.questions_due | length) > 0 then [".agents/skills/explain/SKILL.md"] else [] end)
        + (if (.requests_due + .variants_due | length) > 0 then ["docs/requests.md", "docs/boundary.md"] else [] end)
        + (if (.prototypes_due + .teardowns_due + .expiring_due | length) > 0 then ["docs/prototype.md", "docs/boundary.md"] else [] end)
        + (if (.handoffs_due | length) > 0 then ["docs/handoff.md"] else [] end)
        + (if (.catalog_due | length) > 0 then ["docs/catalog.md"] else [] end) | unique)'
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
  [ "$(cfg_table 'Desk people' | grep -c . || true)" -gt 0 ] && check desk_people ok "$(cfg_table 'Desk people' | grep -c .) people" || check desk_people warn "the Desk people table is empty — everyone but the owner is a guest"

  # backup invariants
  [ -d "$WORK/.git" ] && check work_git fail "work/.git exists — work/ must never be a git repo (concurrent runs corrupt it)" || check work_git ok "work/ is a plain directory"

  # cadence and errors
  local last; last="$(tail -1 "$WORK/WATCH.log" 2>/dev/null | cut -d' ' -f1)"
  if [ "$(jq -r .repos <<<"$CONF")" != "none" ]; then
    if [ -z "$last" ]; then check watch_cadence warn "WATCH.log has no line — the watch schedule never ran its pass"
    elif [ $((NOW_EPOCH - $(iso2epoch "$last"))) -gt $((6 * 3600)) ]; then check watch_cadence warn "the last watch pass was at $last"
    else check watch_cadence ok "last pass $last"; fi
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

case "$MODE" in
  watch) watch_mode ;;
  inbox) inbox_mode ;;
  audit) audit_mode ;;
  *) fail_out "unknown mode: $MODE" ;;
esac
