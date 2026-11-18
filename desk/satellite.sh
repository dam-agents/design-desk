#!/usr/bin/env bash
# The Desk's Satellite (docs/mcp.md): a Login item (kit.yaml → startupItems) that offers
# desk/mcp.mjs to the owner's other agents through `dam satellite mcp`. openrc's
# supervise-daemon runs it at every boot and restarts it when it exits.
#
# mcp_satellite in work/CONFIG.md: disabled (default) → it only waits and reads the key
# again every 5 minutes; when-awake → the worker runs while this machine is awake (the
# platform refuses calls while it sleeps); always → the worker is kept work
# (`platform-keep`), so this machine never sleeps.
set -u
HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
CONFIG="$WORK/CONFIG.md"
DESK="$(cd "$(dirname "$0")" && pwd)"
. "$DESK/../scripts/lib/config.sh"
KEY="$WORK/desk/.satellite-key"
STATE="$HOME_DIR/.local/state/design-desk"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2; }
wait_a_while() { sleep "${SATELLITE_RETRY_S:-300}"; }

mkdir -p "$STATE"
# A stop of the service stops the worker too: it drains on the first interrupt.
child=""
trap '[ -n "$child" ] && kill -INT "$child" 2>/dev/null; exit 0' TERM INT
while :; do
  mode="$(cfg mcp_satellite)"; mode="${mode:-disabled}"
  case "$mode" in when-awake|always) ;; *) wait_a_while; continue;; esac
  command -v dam >/dev/null 2>&1 || { say "no dam CLI on PATH"; wait_a_while; continue; }
  [ -s "$KEY" ] || { say "no serve key in $KEY (docs/mcp.md → Turn it on)"; wait_a_while; continue; }
  server="$(cfg mcp_server)"; server="${server:-${DAM_SERVER:-}}"
  [ -n "$server" ] || { say "no mcp_server in CONFIG.md and no DAM_SERVER"; wait_a_while; continue; }
  name="$(cfg mcp_satellite_name)"; name="${name:-design-desk}"
  DAM_TOKEN="$(tr -d '[:space:]' < "$KEY")"; export DAM_TOKEN DAM_SERVER="$server"
  set -- dam satellite mcp --name "$name" --description "Design Desk: the team's design changes, requests and decisions" -- node "$DESK/mcp.mjs"
  if [ "$mode" = when-awake ]; then
    say "serving $name at $server while this machine is awake"
    "$@" & child=$!; wait "$child"; say "worker exited ($?)"; child=""; wait_a_while; continue
  fi
  # always: the worker runs detached, so a Keep Mark counts for it, and this loop watches it.
  ( setsid "$@" >>"$STATE/satellite.log" 2>&1 < /dev/null & echo $! > "$STATE/satellite.pid" )
  pid="$(cat "$STATE/satellite.pid")"; child="$pid"
  platform-keep --pid "$pid" >/dev/null 2>&1 || say "platform-keep could not mark $pid: this machine may sleep"
  say "serving $name at $server, kept awake (pid $pid)"
  while kill -0 "$pid" 2>/dev/null; do
    sleep 60
    [ "$(cfg mcp_satellite)" = always ] || { kill -INT "$pid" 2>/dev/null; break; }
  done
  say "worker stopped"; child=""; sleep 5
done
