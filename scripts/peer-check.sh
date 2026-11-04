#!/usr/bin/env bash
# peer-check.sh — compare pinned peer manifests with their published versions.
# Read-only: fetch to a temporary file; never pin or change CONFIG.md.
#
#   bash scripts/peer-check.sh [work/PEERS.md]
#
# Prints one JSON object: {ok, info, warn, fail, total, peers:[...]}; total counts
# every peer row, info is a new published version whose used ids did not change. Exit 0 unless a peer's
# published manifest is invalid. A changed used id is a failure for the audit to
# report; adopting it stays the operator's call (docs/manifest.md → Pin a peer).

set -u
export LC_ALL=C

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="${AGENT_HOME:-$HOME}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
TABLE="${1:-$WORK/PEERS.md}"
CHECK="$SCRIPT_DIR/manifest-check.sh"
SCHEMA="$HOME_DIR/docs/manifest.schema.json"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/design-desk-peers.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

ok=0; info=0; warn=0; fail=0; peers='[]'
emit_peer() {
  peers="$(jq -c --argjson p "$1" '. + [$p]' <<<"$peers")"
}

if [ ! -f "$TABLE" ]; then
  warn=$((warn + 1))
  jq -n --arg detail "PEERS.md missing at $TABLE" \
    '{ok:0, info:0, warn:1, fail:0, total:0, peers:[], errors:[{status:"warn", peer:null, detail:$detail}]}'
  exit 0
fi

while IFS= read -r row; do
  name="$(cut -d'|' -f2 <<<"$row" | xargs)"
  role="$(cut -d'|' -f3 <<<"$row" | xargs)"
  url="$(cut -d'|' -f4 <<<"$row" | xargs)"
  pinned="$(cut -d'|' -f5 <<<"$row" | xargs)"
  uses="$(cut -d'|' -f6 <<<"$row" | xargs)"
  case "$name" in ''|name|---*) continue;; esac
  file="$TMP_DIR/$name.json"
  status=ok; detail="pinned $pinned"
  if ! curl -fsSL --max-time 30 --max-filesize 1048576 "$url" -o "$file" 2>"$TMP_DIR/err"; then
    status=warn; detail="manifest unreachable: $(tr '\n' ' ' < "$TMP_DIR/err" | cut -c1-200)"
  elif ! env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY -u no_proxy -u NO_PROXY \
      MANIFEST_SCHEMA="$SCHEMA" bash "$CHECK" peer "$file" >"$TMP_DIR/check" 2>&1; then
    status=warn; detail="manifest-check.sh peer failed: $(grep -m1 '^FAIL' "$TMP_DIR/check" || tail -1 "$TMP_DIR/check")"
  else
    live_version="$(jq -r '.source.version // ""' "$file")"
    local_pinned="$WORK/peers/$name.json"
    if [ ! -f "$local_pinned" ]; then
      status=fail; detail="pinned copy missing: work/peers/$name.json"
    elif [ "$live_version" != "$pinned" ]; then
      status=info; detail="published $live_version; pinned $pinned"
      changed=""
      IFS=',' read -ra ids <<<"$uses"
      for id in "${ids[@]}"; do
        id="$(xargs <<<"$id")"; [ -n "$id" ] || continue
        old="$(jq -c --arg id "$id" '[.triggers[$id]?, .contracts[$id]?] | map(select(. != null)) | if length == 0 then null else .[0] end' "$local_pinned" 2>/dev/null)"
        new="$(jq -c --arg id "$id" '[.triggers[$id]?, .contracts[$id]?] | map(select(. != null)) | if length == 0 then null else .[0] end' "$file" 2>/dev/null)"
        [ "$old" = "$new" ] || changed="$changed $id"
      done
      if [ -n "$changed" ]; then status=fail; detail="$detail; used ids changed:${changed} (pin again: docs/manifest.md → Pin a peer)"; fi
    fi
  fi
  case "$status" in ok) ok=$((ok + 1));; info) info=$((info + 1));; warn) warn=$((warn + 1));; fail) fail=$((fail + 1));; esac
  emit_peer "$(jq -nc --arg name "$name" --arg role "$role" --arg status "$status" --arg detail "$detail" '{name:$name, role:$role, status:$status, detail:$detail}')"
done < <(grep -E '^\|' "$TABLE" || true)

jq -n --argjson ok "$ok" --argjson info "$info" --argjson warn "$warn" --argjson fail "$fail" --argjson peers "$peers" \
  '{ok:$ok, info:$info, warn:$warn, fail:$fail, total:($peers | length), peers:$peers}'
[ "$fail" -eq 0 ]
