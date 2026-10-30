#!/usr/bin/env bash
# The precheck adapter: quiet → exit 1 silent; work → exit 0 with a worklist file;
# a broken pass → exit 2 (fail open).
. "$(dirname "$0")/lib.sh"
mkdir -p "$SANDBOX/scripts/lib"
cp "$ROOT/scripts/precheck.sh" "$ROOT/scripts/log.sh" "$SANDBOX/scripts/"; cp "$ROOT/scripts/lib/config.sh" "$SANDBOX/scripts/lib/"
stub() { printf '#!/usr/bin/env bash\n%s\n' "$1" > "$SANDBOX/scripts/preflight.sh"; }

stub "echo '{\"nothing_to_do\":true,\"logs\":[\"quiet\"]}'"
o="$(bash "$SANDBOX/scripts/precheck.sh" inbox)"; rc=$?
[ "$rc" -eq 1 ] && [ -z "$o" ] || { echo "  ✗ quiet should exit 1 silently (rc=$rc)"; FAILS=$((FAILS+1)); }

stub "echo '{\"nothing_to_do\":false,\"questions_due\":[{\"id\":\"I-1\"}],\"logs\":[\"I-1: question\"]}'"
o="$(bash "$SANDBOX/scripts/precheck.sh" inbox)"; rc=$?
f="$(printf '%s\n' "$o" | sed -n 's/^worklist: //p')"
[ "$rc" -eq 0 ] && [ -s "$f" ] && printf '%s' "$o" | grep -q 'questions_due=1 (I-1)' || { echo "  ✗ work should exit 0 with a worklist (rc=$rc): $o"; FAILS=$((FAILS+1)); }

stub "echo not json"
bash "$SANDBOX/scripts/precheck.sh" inbox >/dev/null; rc=$?
[ "$rc" -eq 2 ] || { echo "  ✗ non-JSON should fail open (rc=$rc)"; FAILS=$((FAILS+1)); }

stub "echo '{\"nothing_to_do\":true,\"error\":\"could not list\"}'"
bash "$SANDBOX/scripts/precheck.sh" watch >/dev/null; rc=$?
[ "$rc" -eq 2 ] || { echo "  ✗ an error should fail open (rc=$rc)"; FAILS=$((FAILS+1)); }
finish
