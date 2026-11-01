#!/usr/bin/env bash
# The runner's node step: every *.test.mjs, nested ones too, and a FAIL when a tests
# directory has none or cannot be listed — never a PASS that ran no test or only some.
. "$(dirname "$0")/lib.sh"
repo="$SANDBOX/repo"
mkdir -p "$repo/scripts/tests" "$repo/toolkit/tests" "$repo/desk/tests" "$SANDBOX/fakenode"
cp "$ROOT/scripts/tests/run.sh" "$repo/scripts/tests/"
printf 'exit 0\n' > "$repo/scripts/tests/test_ok.sh"
# a node that passes the version check and records what --test was given
cat > "$SANDBOX/fakenode/node" <<EOF
#!/usr/bin/env bash
[ "\${1:-}" = --test ] && { shift; printf '%s\n' "\$@" > "$SANDBOX/node-args"; }
exit 0
EOF
chmod +x "$SANDBOX/fakenode/node"
run() { PATH="$SANDBOX/fakenode:$PATH" bash "$repo/scripts/tests/run.sh" > "$SANDBOX/out" 2>&1; echo $?; }

[ "$(run)" = 1 ] || { echo "  ✗ no test files must fail the runner"; FAILS=$((FAILS+1)); }
grep -q 'FAIL  node --test: no \*.test.mjs in toolkit/tests desk/tests' "$SANDBOX/out" \
  || { echo "  ✗ the failure must name both empty directories"; FAILS=$((FAILS+1)); }

: > "$repo/toolkit/tests/a.test.mjs"
[ "$(run)" = 1 ] || { echo "  ✗ an empty desk/tests must fail the runner"; FAILS=$((FAILS+1)); }

mkdir -p "$repo/toolkit/tests/unit"
: > "$repo/toolkit/tests/unit/b.test.mjs"; : > "$repo/desk/tests/c.test.mjs"; : > "$repo/desk/tests/helper.mjs"
rm -f "$SANDBOX/node-args"
[ "$(run)" = 0 ] || { echo "  ✗ test files in both directories must pass"; FAILS=$((FAILS+1)); }
args="$(sed -E 's#.*/(toolkit|desk)/tests/#\1/tests/#' "$SANDBOX/node-args" 2>/dev/null | tr '\n' ' ')"
[ "$args" = "toolkit/tests/a.test.mjs toolkit/tests/unit/b.test.mjs desk/tests/c.test.mjs " ] \
  || { echo "  ✗ node --test must get every *.test.mjs, nested too, and nothing else: $args"; FAILS=$((FAILS+1)); }

# a find that lists part of toolkit/tests and fails — a stub, not chmod, which root ignores
mkdir -p "$SANDBOX/fakefind"
cat > "$SANDBOX/fakefind/find" <<EOF
#!/usr/bin/env bash
case "\$1" in */toolkit/tests) echo "\$1/a.test.mjs"; echo "find: \$1/locked: Permission denied" >&2; exit 1;; esac
exec "$(command -v find)" "\$@"
EOF
chmod +x "$SANDBOX/fakefind/find"
rc="$(PATH="$SANDBOX/fakefind:$SANDBOX/fakenode:$PATH" bash "$repo/scripts/tests/run.sh" > "$SANDBOX/out" 2>&1; echo $?)"
[ "$rc" = 1 ] || { echo "  ✗ a failed test listing must fail the runner"; FAILS=$((FAILS+1)); }
grep -q 'FAIL  node --test: cannot list the tests in toolkit/tests$' "$SANDBOX/out" \
  || { echo "  ✗ the failure must name the directory it could not list"; FAILS=$((FAILS+1)); }
grep -q 'locked: Permission denied' "$SANDBOX/out" \
  || { echo "  ✗ the failure must show find's error"; FAILS=$((FAILS+1)); }
finish
