#!/usr/bin/env bash
# ledger.sh — the one writer of work/CHANGES.tsv besides the watch pre-flight.
#
#   ledger.sh claim <repo> <pr>            the run takes the PR: in_progress
#   ledger.sh done  <repo> <pr> <card>     its card is on the Desk: carded
#   ledger.sh open  <repo> <pr> <card>     an open PR's card is on the Desk; it is due again once merged
#   ledger.sh skip  <repo> <pr> <reason>   nothing a person would notice changed: skipped
#   ledger.sh fail  <repo> <pr> <reason>   it failed; the pre-flight retries it up to 3 times
#   ledger.sh show  <repo> <pr>            its last row, as JSON
#
# The table is append-only: a pull request's state is its LAST row, so a write never
# rewrites a line another session is reading. Several sessions write it at once
# (fan-out), so each write holds a mkdir lock: a lock older than 60 s is a dead
# writer's and is removed by one waiter; a waiter writes without it only after 120 s.
# Prints one JSON object: {"outcome": "ok"|"held"|"error", ...}.
set -u
export LC_ALL=C
WORK="${WORK_DIR:-${HOME:-/home/agent}/work}"
LEDGER="$WORK/CHANGES.tsv"
HEAD=$'repo\tpr\tmerged_at\tstatus\tcard\tupdated\tattempts\tnote'
LOCK="$WORK/.CHANGES.lock"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
LOG_JOB="${LOG_JOB:-ledger}"
. "$(dirname "$0")/log.sh" 2>/dev/null || logev() { :; }

out() { jq -cn "$@"; }
die() { out --arg e "$1" '{outcome:"error", error:$e}'; exit 1; }

cmd="${1:-}"; repo="${2:-}"; pr="${3:-}"; arg="${4:-}"
[ -n "$cmd" ] && [ -n "$repo" ] && [ -n "$pr" ] || die "usage: ledger.sh claim|done|open|skip|fail|show <repo> <pr> [card|reason]"
case "$pr" in *[!0-9]*) die "pr must be a number";; esac
mkdir -p "$WORK"; [ -f "$LEDGER" ] || printf '%s\n' "$HEAD" > "$LEDGER"

last_row() { awk -F'\t' -v r="$repo" -v p="$pr" 'NR>1 && $1==r && $2==p' "$LEDGER" | tail -1; }

if [ "$cmd" = show ]; then
  row="$(last_row)"
  [ -n "$row" ] || { out '{outcome:"ok", row:null}'; exit 0; }
  f() { printf '%s' "$row" | cut -f"$1"; }
  r="$(f 1)"; p="$(f 2)"; m="$(f 3)"; s="$(f 4)"; c="$(f 5)"; u="$(f 6)"; a="$(f 7)"; n="$(f 8)"
  out --arg r "$r" --arg p "$p" --arg m "$m" --arg s "$s" --arg c "$c" --arg u "$u" --arg a "$a" --arg n "$n" \
    '{outcome:"ok", row:{repo:$r, pr:($p|tonumber), merged_at:$m, status:$s, card:$c, updated:$u, attempts:($a|tonumber? // 0), note:$n}}'
  exit 0
fi

waited=0
until mkdir "$LOCK" 2>/dev/null; do
  age=$(( $(date -u +%s) - $(stat -c %Y "$LOCK" 2>/dev/null || stat -f %m "$LOCK" 2>/dev/null || date -u +%s) ))
  if [ "$age" -gt 60 ]; then rmdir "$LOCK" 2>/dev/null && logev warn ledger_lock "removed a ${age}s old lock"; continue; fi
  [ "$waited" -ge 120 ] && { logev warn ledger_lock "wrote without the lock after 120 s"; break; }
  sleep 1; waited=$((waited + 1))
done
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

row="$(last_row)"
# cut keeps empty fields (an IFS read would merge the tabs around an empty card).
merged="$(printf '%s' "${row:-}" | cut -f3)"; status="$(printf '%s' "${row:-}" | cut -f4)"
card="$(printf '%s' "${row:-}" | cut -f5)"; attempts="$(printf '%s' "${row:-}" | cut -f7)"
attempts="${attempts:-0}"; case "$attempts" in *[!0-9]*|'') attempts=0;; esac
clean() { printf '%s' "$1" | tr '\t\n' '  ' | cut -c1-200; }

case "$cmd" in
  claim)
    case "$status" in
      carded|skipped) out --arg s "$status" --arg c "$card" '{outcome:"held", reason:("already " + $s), card:$c}'; exit 0;;
    esac
    printf '%s\t%s\t%s\tin_progress\t%s\t%s\t%s\t%s\n' "$repo" "$pr" "$merged" "$card" "$NOW" "$attempts" "claimed by ${LOG_RUN:-session}" >> "$LEDGER";;
  open)
    [ -n "$arg" ] || die "open needs the card id"
    printf '%s\t%s\t%s\topen\t%s\t%s\t%s\t\n' "$repo" "$pr" "$merged" "$(clean "$arg")" "$NOW" "$attempts" >> "$LEDGER";;
  done)
    [ -n "$arg" ] || die "done needs the card id"
    printf '%s\t%s\t%s\tcarded\t%s\t%s\t%s\t\n' "$repo" "$pr" "$merged" "$(clean "$arg")" "$NOW" "$attempts" >> "$LEDGER";;
  skip)
    printf '%s\t%s\t%s\tskipped\t\t%s\t%s\t%s\n' "$repo" "$pr" "$merged" "$NOW" "$attempts" "$(clean "${arg:-no visible change}")" >> "$LEDGER";;
  fail)
    printf '%s\t%s\t%s\tfailed\t%s\t%s\t%s\t%s\n' "$repo" "$pr" "$merged" "$card" "$NOW" "$((attempts + 1))" "$(clean "${arg:-failed}")" >> "$LEDGER"
    logev warn change_failed "$repo#$pr: $(clean "${arg:-failed}")";;
  *) die "unknown command $cmd";;
esac
logev info "change_$cmd" "$repo#$pr"
out --arg c "$cmd" --arg r "$repo" --argjson p "$pr" '{outcome:"ok", action:$c, repo:$r, pr:$p}'
