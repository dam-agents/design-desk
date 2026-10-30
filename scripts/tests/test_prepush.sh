#!/usr/bin/env bash
# The pre-push hook: off without prototype_remote; only design-desk/ branches with it.
. "$(dirname "$0")/lib.sh"
hook="$ROOT/scripts/git-hooks/pre-push"
run() { printf '%s\n' "$1" | bash "$hook" origin https://example.invalid/x.git >/dev/null 2>&1; echo $?; }
printf -- '- prototype_remote: none\n' > "$WORK_DIR/CONFIG.md"
[ "$(run 'refs/heads/design-desk/c1-x abc refs/heads/design-desk/c1-x 000')" = 1 ] || { echo "  ✗ pushing must be off with prototype_remote: none"; FAILS=$((FAILS+1)); }
printf -- '- prototype_remote: acme/widgets\n' > "$WORK_DIR/CONFIG.md"
[ "$(run 'refs/heads/design-desk/c1-x abc refs/heads/design-desk/c1-x 000')" = 0 ] || { echo "  ✗ a design-desk/ branch may be pushed"; FAILS=$((FAILS+1)); }
[ "$(run 'refs/heads/main abc refs/heads/main 000')" = 1 ] || { echo "  ✗ main must be refused"; FAILS=$((FAILS+1)); }
[ "$(run 'refs/heads/design-desk/c1-x abc refs/heads/feature/x 000')" = 1 ] || { echo "  ✗ another remote name must be refused"; FAILS=$((FAILS+1)); }
finish
