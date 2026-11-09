#!/usr/bin/env bash
# A fork's pull request gets no prototype branch and no screens instance; a --ref that is
# not pull/<n>/head or a branch name is refused. Each refusal comes before any clone.
. "$(dirname "$0")/lib.sh"
. "$ROOT/scripts/lib/pr.sh"
printf 'acme/widgets\tacme/widgets\n' > "$STUB_DIR/pull-1.tsv"
printf 'mallory/widgets\tacme/widgets\n' > "$STUB_DIR/pull-2.tsv"
printf '\tacme/widgets\n' > "$STUB_DIR/pull-3.tsv"   # the fork was deleted
printf 'Acme/Widgets\tacme/widgets\n' > "$STUB_DIR/pull-4.tsv"
ok() { if pr_same_repo "$@"; then echo yes; else echo no; fi; }
[ "$(ok acme/widgets 1)" = yes ] || { echo "  ✗ a pull request of the repository itself is allowed"; FAILS=$((FAILS+1)); }
[ "$(ok acme/widgets 4)" = yes ] || { echo "  ✗ names compare without case"; FAILS=$((FAILS+1)); }
[ "$(ok acme/widgets 2)" = no ] || { echo "  ✗ a fork must be refused"; FAILS=$((FAILS+1)); }
[ "$(ok acme/widgets 3)" = no ] || { echo "  ✗ a deleted head repository must be refused"; FAILS=$((FAILS+1)); }
[ "$(ok acme/widgets 9)" = no ] || { echo "  ✗ a failed read must be refused"; FAILS=$((FAILS+1)); }
[ "$(ok ghe.example.com/acme/widgets 1)" = yes ] && grep -q -- '--hostname ghe.example.com' "$STUB_DIR/gh.calls" \
  || { echo "  ✗ an enterprise host is asked with --hostname"; FAILS=$((FAILS+1)); }

proto() { bash "$ROOT/scripts/proto.sh" worktree C-5 acme/widgets x --ref "$1" 2>/dev/null; }
assert "proto: a fork's head is refused" '.error | test("fork")' "$(proto pull/2/head)"
assert "proto: an unknown pull request is refused" '.error | test("fork")' "$(proto pull/9/head)"
for bad in -uorigin 'a..b' 'refs/pull/2/head' 0123456789abcdef0123456789abcdef01234567 'x@{1}'; do
  assert "proto: --ref $bad is refused" '.error | test("pull/<n>/head or a branch")' "$(proto "$bad")"
done
[ ! -d "$HOME/checkouts/proto-c5" ] || { echo "  ✗ a refused ref must not reach the clone"; FAILS=$((FAILS+1)); }
assert "screens: a fork's head is refused" '.error | test("fork")' "$(bash "$ROOT/scripts/screens.sh" sync acme/widgets --pr 2 2>/dev/null)"
[ ! -d "$WORK_DIR/screens/pr2" ] || { echo "  ✗ a refused fork leaves no instance state"; FAILS=$((FAILS+1)); }
finish
