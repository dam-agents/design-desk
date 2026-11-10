#!/usr/bin/env bash
# upgrade-steps.sh [from] [to] — what a migration must read, and nothing else: the Upgrade
# blocks of every CHANGELOG.md version in (from, to], oldest first, then one summary of the
# steps the blocks repeat, each to run once (docs/persistence.md → Definition version &
# upgrade). `from` defaults to work/VERSION (1.0.0 when missing), `to` to VERSION.
# It reads two files and prints text; it runs no step and changes nothing.
set -u
export LC_ALL=C
HOME_DIR="${DESIGN_DESK_HOME:-$(cd "$(dirname "$0")/.." && pwd)}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
LOG="$HOME_DIR/CHANGELOG.md"
ver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; }
from="${1:-$(head -1 "$WORK/VERSION" 2>/dev/null)}"; from="${from:-1.0.0}"
to="${2:-$(head -1 "$HOME_DIR/VERSION" 2>/dev/null)}"
ver "$from" && ver "$to" || { echo "upgrade-steps: versions must be semver (from '$from', to '$to')" >&2; exit 2; }
[ -f "$LOG" ] || { echo "upgrade-steps: no CHANGELOG.md at $LOG" >&2; exit 2; }
# a <= b, by version order
le() { [ "$(printf '%s\n%s\n' "$1" "$2" | sort -t. -k1,1n -k2,2n -k3,3n | head -1)" = "$1" ]; }
if [ "$from" = "$to" ]; then echo "Up to date at $to: nothing to apply."; exit 0; fi
if le "$to" "$from"; then echo "Rollback $from → $to: apply nothing, offer nothing; write $to to work/VERSION."; exit 0; fi

versions="$(sed -nE 's/^## ([0-9]+\.[0-9]+\.[0-9]+) .*/\1/p' "$LOG" | sort -t. -k1,1n -k2,2n -k3,3n)"
crossed=()
for v in $versions; do
  if ! le "$v" "$from" && le "$v" "$to"; then crossed+=("$v"); fi
done
[ "${#crossed[@]}" -gt 0 ] || { echo "No CHANGELOG.md entry between $from and $to."; exit 0; }

echo "# Upgrade $from → $to: ${#crossed[@]} version(s), oldest first"
echo
all=""
for v in "${crossed[@]}"; do
  block="$(awk -v v="$v" '$0 ~ "^## " v " " { on = 1; print; next } on && /^## [0-9]/ { exit } on { print }' "$LOG")"
  printf '%s\n\n' "$block" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'
  echo
  all="$all
$block"
done

has() { printf '%s' "$all" | grep -qiE "$1"; }
echo "# Once for the whole upgrade"
echo
has 'restart the desk server' && echo "- Restart the Desk server, before any republish."
has 'republish the page' && echo "- Republish the Desk page, once, after the restart."
has 'install-toolkit\.sh' && echo "- Run scripts/install-toolkit.sh."
has 'verify-onboarding\.sh' && echo "- Run scripts/verify-onboarding.sh and apply each FAIL line's fix."
has 'manifest' && echo "- A block names the agent manifest: rewrite and republish it if it says so."
has 'operator-only' && echo "- A block has an operator-only step: surface it, never guess at it."
has 'schedule' && echo "- A block names a schedule: read it for what changes on the live agent."
echo "- Everything else in the blocks above runs as written, oldest first; a newer block can replace an older block's steps."
