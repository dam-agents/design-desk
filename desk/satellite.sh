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
# Running, and not a child that exited and waits to be reaped (kill -0 succeeds on that one).
alive() { ps -o stat= -p "$1" 2>/dev/null | grep -qv Z; }

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
    "$@" & pid=$!
    say "serving $name at $server while this machine is awake (pid $pid)"
  else
    # always: the worker runs detached, so a Keep Mark counts for it.
    ( setsid "$@" >>"$STATE/satellite.log" 2>&1 < /dev/null & echo $! > "$STATE/satellite.pid" )
    pid="$(cat "$STATE/satellite.pid")"
    platform-keep --pid "$pid" >/dev/null 2>&1 || say "platform-keep could not mark $pid: this machine may sleep"
    say "serving $name at $server, kept awake (pid $pid)"
  fi
  child="$pid"
  # Either mode: a changed mcp_satellite stops the worker within a minute; the loop starts the
  # one the new mode asks for, or waits.
  changed=0
  while alive "$pid"; do
    sleep 60
    [ "$(cfg mcp_satellite)" = "$mode" ] || { changed=1; kill -INT "$pid" 2>/dev/null; break; }
  done
  [ "$mode" = when-awake ] && wait "$pid" 2>/dev/null
  child=""
  # A worker that exited on its own (dam itself retries a lost platform) waits before the next start.
  if [ "$changed" = 1 ]; then say "mcp_satellite changed: worker stopped"; sleep 5; else say "worker exited"; wait_a_while; fi
done
