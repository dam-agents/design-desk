#!/usr/bin/env bash
# The pre-push hook: off without prototype_remote; with it, only design-desk/ branches of
# that repository on its host, and never a commit that changes .github/.
. "$(dirname "$0")/lib.sh"
hook="$ROOT/scripts/git-hooks/pre-push"
g() { git -C "$wc" -c user.name=t -c user.email=t@t -c commit.gpgsign=false "$@"; }
wc="$SANDBOX/wc"; git init -q --bare "$SANDBOX/origin.git"; git clone -q "$SANDBOX/origin.git" "$wc" 2>/dev/null
echo a > "$wc/a.css"; g add a.css; g commit -qm base; g push -q origin HEAD:refs/heads/main 2>/dev/null; g fetch -q origin
g checkout -qb design-desk/c1-x; echo b > "$wc/a.css"; g commit -qam look; look="$(g rev-parse HEAD)"
mkdir -p "$wc/.github/workflows"; echo x > "$wc/.github/workflows/x.yml"; g add .github; g commit -qm wf; wf="$(g rev-parse HEAD)"
# Paths git would quote without -z: a non-ASCII workflow name, and a look file with a tab.
g checkout -q "$look"; mkdir -p "$wc/.github/workflows"; echo x > "$wc/.github/workflows/é.yml"; g add .github; g commit -qm wf2; wfq="$(g rev-parse HEAD)"
g checkout -q "$look"; printf 'q' > "$wc/tab	x.css"; g add .; g commit -qm tab; tab="$(g rev-parse HEAD)"
z=0000000000000000000000000000000000000000
run() { (cd "$wc" && printf '%s\n' "$1" | bash "$hook" origin "${2:-https://github.com/acme/widgets.git}" >/dev/null 2>&1); echo $?; }
expect() { [ "$(run "$2" "${3:-}")" = "$1" ] || { echo "  ✗ $4"; FAILS=$((FAILS+1)); }; }
printf -- '- prototype_remote: none\n' > "$WORK_DIR/CONFIG.md"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" "" "pushing must be off with prototype_remote: none"
printf -- '- prototype_remote: "acme/widgets"  # quoted, like every config value may be\n' > "$WORK_DIR/CONFIG.md"
expect 0 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" "" "a design-desk/ branch may be pushed (quoted value read)"
expect 0 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" git@github.com:acme/widgets.git "the ssh form of the repository is accepted"
expect 0 "(delete) $z refs/heads/design-desk/c1-x $look" "" "a design-desk/ branch may be deleted"
expect 1 "refs/heads/main $look refs/heads/main $z" "" "main must be refused"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/feature/x $z" "" "another remote name must be refused"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" https://github.com/evil/fork.git "another repository must be refused"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" https://evil.example/acme/widgets.git "the same name on another host must be refused"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" https://github.com/x/acme/widgets.git "a path that only ends in the name must be refused"
# The host comes from the authority: user info and a port are stripped from it, and an
# authority that could read as two hosts is refused.
for ok in https://bot:tok@GitHub.com:443/acme/widgets ssh://git@github.com/acme/widgets.git github.com:acme/widgets; do
  expect 0 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" "$ok" "$ok is the repository"
done
for bad in https://evil.example/x@github.com/acme/widgets evil.example:y@github.com:acme/widgets \
  'https://evil.example?@github.com/acme/widgets' 'https://evil.example#@github.com/acme/widgets' \
  'https://evil.example\@github.com/acme/widgets' https://a@b@github.com/acme/widgets \
  file://github.com/acme/widgets http://github.com/acme/widgets; do
  expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" "$bad" "$bad must be refused"
done
expect 1 "refs/heads/design-desk/c1-x $wf refs/heads/design-desk/c1-x $z" "" "a commit that changes .github/ must be refused"
expect 1 "refs/heads/design-desk/c1-x $wf refs/heads/design-desk/c1-x $look" "" "a .github/ change on top of a pushed branch must be refused"
expect 1 "refs/heads/design-desk/c1-x $wfq refs/heads/design-desk/c1-x $z" "" "a .github/ path git would quote (non-ASCII) must be refused"
expect 0 "refs/heads/design-desk/c1-x $tab refs/heads/design-desk/c1-x $z" "" "a look file git would quote (a tab) is still pushed"
expect 1 "refs/heads/design-desk/c1-x abc refs/heads/design-desk/c1-x $z" "" "an unknown commit must be refused"
printf -- '- prototype_remote: ghe.example.com/acme/widgets\n' > "$WORK_DIR/CONFIG.md"
expect 0 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" https://ghe.example.com/acme/widgets "an enterprise host is matched"
expect 1 "refs/heads/design-desk/c1-x $look refs/heads/design-desk/c1-x $z" "" "github.com is not the enterprise host"
finish
