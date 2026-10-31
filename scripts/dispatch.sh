#!/usr/bin/env bash
# dispatch.sh — fan-out for a run whose worklist holds several independent items.
#
#   dispatch.sh plan <worklist>          one unit worklist per item after the first, and
#                                        the exact schedule_once call for each, as JSON
#   dispatch.sh rest <worklist> <id>...  the run's own worklist without the accepted ids;
#                                        prints {worklist, title}
#
# Which items fan out: every change of a watch worklist after the first; in an inbox
# worklist every expensive item (a request to triage, variants, a prototype, a
# handoff, a catalog drawing, Figma work) after the first expensive one. Questions, teardowns and expiring
# prototypes are quick and stay in the run.
# A unit's task text carries the item id and the unit's path and nothing from the
# item: it becomes the new session's prompt. Titles come from ids alone.
# `dispatch: disabled` in the worklist's config keeps everything in the run.
set -u
export LC_ALL=C
TMP="${TMPDIR:-/tmp}"
cmd="${1:-}"; wl="${2:-}"
[ -f "$wl" ] || { echo '{"outcome":"error","error":"no worklist file"}'; exit 1; }
mode="$(jq -r .mode "$wl")"

case "$mode" in
  watch) ARRAYS='["changes_due","issues_due"]'; SECTION='Watch run'; VERB='Explain'; NOUN='PR';;
  inbox) ARRAYS='["requests_due","variants_due","prototypes_due","handoffs_due","catalog_due","figma_due"]'; SECTION='Inbox run'; VERB='Work'; NOUN='Desk item';;
  *) echo '{"outcome":"error","error":"this mode does not fan out"}'; exit 1;;
esac

if [ "$cmd" = plan ]; then
  if [ "$(jq -r '.config.dispatch // "enabled"' "$wl")" = disabled ]; then echo '[]'; exit 0; fi
  model="$(jq -r '.config.run_model // "default"' "$wl")"
  # Items in order across the fan-out arrays; the first stays with this run.
  jq -c --argjson arrays "$ARRAYS" '[ $arrays[] as $a | (.[$a] // [])[] | {array: $a, item: .} ] | .[1:][]' "$wl" | while IFS= read -r e; do
    arr="$(jq -r .array <<<"$e")"; id="$(jq -r .item.id <<<"$e")"
    safe="$(printf '%s' "$id" | tr -c 'A-Za-z0-9-' '-' | sed 's/-\{2,\}/-/g; s/-$//' | cut -c1-48)"
    unit="$TMP/design-desk-worklist-$mode-unit-$safe-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
    if [ "$mode" = watch ]; then label="$(jq -r '"#\(.item.pr // .item.issue)"' <<<"$e")"; else label="$id"; fi
    ( umask 077
      jq --arg a "$arr" --argjson item "$(jq -c .item <<<"$e")" --arg by "${LOG_RUN:-session}" --arg title "$VERB $NOUN $label" --argjson arrays "$ARRAYS" '
        . as $w | reduce ($arrays[]) as $k ($w; .[$k] = [])
        | .[$a] = [$item] | .dispatched = {id: $item.id, by: $by} | .title = $title
        | del(.questions_due, .teardowns_due, .expiring_due, .screens_due)' "$wl" > "$unit" )
    jq -cn --arg id "$id" --arg name "design-desk-unit-$mode-$safe" --arg unit "$unit" --arg section "$SECTION" \
      --arg title "$VERB $NOUN $label" --arg model "$model" '
      {id: $id, name: $name, worklist: $unit, sessionTitle: $title,
       model: (if $model == "default" then null else $model end),
       task: ("Design Desk dispatched unit for " + $id + ". The worklist is already computed: read the JSON at " + $unit + ", claim its one item first, and follow CLAUDE.md → \"" + $section + "\" for it. Never run preflight.sh this run.")}'
  done | jq -s .
  exit 0
fi

if [ "$cmd" = rest ]; then
  shift 2
  ids="$(printf '%s\n' "$@" | jq -R . | jq -s .)"
  out="$TMP/design-desk-worklist-$mode-rest-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
  ( umask 077; jq --argjson ids "$ids" --argjson arrays "$ARRAYS" '
      reduce ($arrays[]) as $k (.; .[$k] = [ (.[$k] // [])[] | select(.id as $i | $ids | index($i) | not) ])' "$wl" > "$out" )
  if [ "$mode" = watch ]; then
    title="$(jq -r '(.changes_due + (.issues_due // []))[] | "#\(.pr // .issue)"' "$out" | head -3 | paste -sd, - | sed 's/,/, /g')"; title="Explain $title"
  else
    title="$(jq -r '[.requests_due, .variants_due, .prototypes_due, .handoffs_due, .catalog_due, .figma_due, .questions_due, .screens_due, .teardowns_due] | map(. // []) | add | .[].id' "$out" | head -3 | paste -sd, - | sed 's/,/, /g')"; title="Work Desk items ${title:-(quick ones)}"
  fi
  jq -n --arg w "$out" --arg t "$title" '{worklist: $w, title: $t}'
  exit 0
fi
echo '{"outcome":"error","error":"usage: dispatch.sh plan|rest <worklist> [ids]"}'; exit 1
