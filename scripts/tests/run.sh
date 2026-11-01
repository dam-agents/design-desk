#!/usr/bin/env bash
# run.sh — offline test runner for the design-desk scripts. Discovers and
# runs every scripts/tests/test_*.sh; a test file exits non-zero on failure.
#
# Test conventions (each test_*.sh):
#   - Sandbox: create its own WORK_DIR under a temp dir — never touch a real
#     work/ or $HOME; clean up on exit.
#   - Offline: stub external CLIs by prepending scripts/tests/bin to PATH and
#     placing fake executables there (e.g. a `gh` printing canned JSON per
#     argument pattern). Tests must pass with no network and no credentials.
#   - Determinism: pre-flight logic is pure detection, so identical stub output
#     must yield an identical worklist — assert on the emitted JSON (jq).
#
# A behavior change in a script updates its test case in the same PR
# (docs/self-modification.md §9).
# The toolkit and the Desk have node tests of their own (toolkit/tests, desk/tests);
# this runner runs them too when node 20+ is on PATH.
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
pass=0; fail=0
for t in "$DIR"/test_*.sh; do
  [ -e "$t" ] || { echo "no tests found in $DIR"; exit 0; }
  name="$(basename "$t")"
  if bash "$t"; then
    echo "PASS  $name"; pass=$((pass + 1))
  else
    echo "FAIL  $name"; fail=$((fail + 1))
  fi
done
if command -v node >/dev/null 2>&1 && node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" 2>/dev/null; then
  # Files, not directories: node 21 to 25 do not expand a directory argument. find,
  # not a glob: a glob that matches nothing runs no test on node 21+ and still passes.
  # A find that fails lists only part of the tests: it fails the step with its error.
  files=(); missing=; unlisted=
  list=/tmp/design-desk-node-list.$$
  for d in toolkit desk; do
    n=${#files[@]}
    if ! find "$DIR/../../$d/tests" -type f -name '*.test.mjs' >"$list" 2>"$list.err"; then
      cat "$list.err"; unlisted="$unlisted $d/tests"; continue
    fi
    while IFS= read -r f; do files+=("$f"); done < <(sort "$list")
    [ "${#files[@]}" -gt "$n" ] || missing="$missing $d/tests"
  done
  rm -f "$list" "$list.err"
  if [ -n "$unlisted" ]; then
    echo "FAIL  node --test: cannot list the tests in$unlisted"; fail=$((fail + 1))
  elif [ -n "$missing" ]; then
    echo "FAIL  node --test: no *.test.mjs in$missing"; fail=$((fail + 1))
  elif node --test "${files[@]}" >/tmp/design-desk-node-tests.$$ 2>&1; then
    echo "PASS  node --test (toolkit, desk)"; pass=$((pass + 1))
  else
    cat /tmp/design-desk-node-tests.$$; echo "FAIL  node --test (toolkit, desk)"; fail=$((fail + 1))
  fi
  rm -f /tmp/design-desk-node-tests.$$
else
  echo "SKIP  node --test (needs node 20+)"
fi
echo "tests: $pass pass, $fail fail"
[ "$fail" -eq 0 ] || exit 1
