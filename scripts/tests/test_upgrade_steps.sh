#!/usr/bin/env bash
# upgrade-steps.sh: the Upgrade blocks a migration crosses, oldest first, and what to run once.
. "$(dirname "$0")/lib.sh"
D="$SANDBOX/def"; mkdir -p "$D"
cat > "$D/CHANGELOG.md" <<'MD'
# Changelog

## 1.10.0 — 2026-11-03

**Upgrade:**
1. Restart the Desk server and republish the page.

## 1.9.1 — 2026-11-02

**Upgrade:**
1. Republish the page.

## 1.9.0 — 2026-11-01

**Upgrade:**
1. Run `bash "$HOME/scripts/verify-onboarding.sh"`.

## 1.2.0 — 2026-10-01

**Upgrade:**
Nothing — docs are re-read per run.
MD
echo 1.10.0 > "$D/VERSION"; echo 1.9.0 > "$WORK_DIR/VERSION"
run() { DESIGN_DESK_HOME="$D" bash "$ROOT/scripts/upgrade-steps.sh" "$@"; }
out="$(run)"
assert "from work/VERSION to VERSION, oldest first, by version order (1.10 after 1.9)" \
  '[scan("## ([0-9.]+) ")[0]] == ["1.9.1", "1.10.0"]' "$(printf '%s' "$out" | jq -Rs .)"
assert "the restart and the republish are named once each, and no step no block has" \
  '([scan("- Restart the Desk server")] | length) == 1 and ([scan("- Republish the Desk page")] | length) == 1 and (test("verify-onboarding") | not)' "$(printf '%s' "$out" | jq -Rs .)"
assert "the same version is up to date" 'test("Up to date at 1.10.0")' "$(run 1.10.0 1.10.0 | jq -Rs .)"
assert "a lower target is a rollback" 'test("Rollback 1.10.0 → 1.9.0")' "$(run 1.10.0 1.9.0 | jq -Rs .)"
assert "a version that is not semver is refused" '. == 2' "$(run nope 1.9.0 >/dev/null 2>&1; echo $?)"
finish
