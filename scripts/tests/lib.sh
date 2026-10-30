# Shared helpers for the offline tests: a sandboxed WORK_DIR and HOME, the stub CLIs
# first on PATH, and assert <description> <jq filter> <json>.
set -u
TESTS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$TESTS/../.." && pwd)"
SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/design-desk-test.XXXXXX")"
trap 'rm -rf "$SANDBOX"' EXIT
# The tools by their real paths: a mise shim stops resolving once HOME moves.
REALBIN="$SANDBOX/realbin"; mkdir -p "$REALBIN"
for t in jq node git curl; do
  p="$(command -v "$t" 2>/dev/null)" || continue
  case "$p" in */shims/*) r="$(mise which "$t" 2>/dev/null)" && p="$r";; esac
  ln -sf "$p" "$REALBIN/$t"
done
# HOME stays: tool wrappers (mise) read their config from it. Everything the scripts
# write goes under WORK_DIR and TMPDIR, both in the sandbox.
export WORK_DIR="$SANDBOX/work" STUB_DIR="$SANDBOX/stub" TMPDIR="$SANDBOX/tmp" DESK_DIR="$SANDBOX/work/desk"
mkdir -p "$WORK_DIR" "$STUB_DIR" "$TMPDIR"
export PATH="$TESTS/bin:$REALBIN:$PATH"
FAILS=0
assert() {
  if printf '%s' "$3" | jq -e "$2" >/dev/null 2>&1; then :; else
    echo "  ✗ $1"; echo "    filter: $2"; echo "    json: $(printf '%s' "$3" | head -c 600)"; FAILS=$((FAILS + 1)); fi
}
finish() { [ "$FAILS" -eq 0 ]; }
