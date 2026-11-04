#!/usr/bin/env bash
# The manifest card and its checker stay in the definition's tested shape.
. "$(dirname "$0")/lib.sh"
mkdir -p "$WORK_DIR"
cat > "$WORK_DIR/CONFIG.md" <<'CFG'
- display_name: Design Desk
- repos: acme/widgets
- issue_label: design
- handoff: desk
- implementer: pr-comment
- prototype_requesters: designer, lead
- digest: desk
- watch_paths: *
- work_repo: "acme/internal-config"
CFG
card="$SANDBOX/manifest.json"
cp "$ROOT/scripts/tests/fixtures/manifest.json" "$card"
out="$(WORK_DIR="$WORK_DIR" MANIFEST_SCHEMA="$ROOT/docs/manifest.schema.json" bash "$ROOT/scripts/manifest-check.sh" stamp "$card" 2>&1)"
[ "$?" -eq 0 ] || { echo "  x stamp failed: $out"; FAILS=$((FAILS+1)); }
out="$(WORK_DIR="$WORK_DIR" MANIFEST_SCHEMA="$ROOT/docs/manifest.schema.json" bash "$ROOT/scripts/manifest-check.sh" publish "$card" 2>&1)" || { echo "  x publish failed: $out"; FAILS=$((FAILS+1)); }
printf '%s' "$out" | grep -q '^PASS$' || { echo "  x checker did not print PASS: $out"; FAILS=$((FAILS+1)); }
printf '%s' "$out" | grep -q '^FAIL' && { echo "  x checker printed FAIL: $out"; FAILS=$((FAILS+1)); }
jq '.surfaces.github.account = "alice@example.com"' "$card" > "$SANDBOX/bad.json"
out="$(WORK_DIR="$WORK_DIR" MANIFEST_SCHEMA="$ROOT/docs/manifest.schema.json" bash "$ROOT/scripts/manifest-check.sh" publish "$SANDBOX/bad.json" 2>&1)" && { echo "  x a private e-mail passed the card checker"; FAILS=$((FAILS+1)); }
printf '%s' "$out" | grep -q '^FAIL privacy-shapes' || { echo "  x the checker did not name privacy-shapes: $out"; FAILS=$((FAILS+1)); }

# Every check id that can fail gets a deliberately broken card: the gate must name it.
mc() { WORK_DIR="$WORK_DIR" MANIFEST_SCHEMA="${SCHEMA_OVERRIDE:-$ROOT/docs/manifest.schema.json}" bash "$ROOT/scripts/manifest-check.sh" "$@" 2>&1; }
broken() { # <check id> <mode> <jq edit>; the card is restamped so only <check id> breaks
  local id="$1" mode="$2" f="$SANDBOX/broken-$1.json"
  jq "$3" "$card" > "$f"
  [ "$id" = version ] || mc stamp "$f" >/dev/null
  local o; o="$(mc "$mode" "$f")" && { echo "  x $id: a broken card passed $mode"; FAILS=$((FAILS+1)); }
  printf '%s\n' "$o" | grep -q "^FAIL $id " || { echo "  x $id: $mode did not print FAIL $id: $o"; FAILS=$((FAILS+1)); }
}
broken spec publish '.manifest = "other/1"'
broken key-trust publish 'del(.trust)'
broken keys publish '.extra = 1'
broken readme publish '.readme = "short"'
broken agent publish '.agent.roles = []'
broken ids publish '.contracts["Desk_Card"] = .contracts["desk-card"] | .skills["desk-request"].writes += ["Desk_Card"]'
broken trigger-description publish '.triggers["chat-request"].description = ""'
broken skill-start publish '.skills["desk-request"].triggers = [] | .triggers = {}'
broken timer-trigger publish '.triggers["chat-request"].value = "7 * * * *"'
broken schedule-words publish '.skills["desk-request"].schedule = "0 7 * * 5"'
broken nested-keys publish '.triggers["chat-request"].cost = 1'
broken runtime publish '.runtime = {harness: "pi", spend: 3}'
broken references publish '.triggers["chat-request"].starts = "nowhere"'
broken schema publish '.agent.autonomy = "always"'
broken version publish '.source.version = "sha256:000000000000"'
broken size peer '.readme += ("x" * 40000)'
broken privacy-config publish '.readme += " See acme/internal-config."'
broken privacy-shapes publish '.surfaces.github.address = "Slack U01ABCDEF23"'
broken placeholders publish '.agent.description = "TODO(manifest)"'
# A glob in a config value is a literal string, never file names.
o="$(mc publish "$card")"; printf '%s' "$o" | grep -q '^PASS$' || { echo "  x watch_paths: * blocked a correct card: $o"; FAILS=$((FAILS+1)); }
# Without the validator the gate fails and check only warns.
o="$(MANIFEST_PYTHON=/nonexistent/python3 SCHEMA_OVERRIDE="$SANDBOX/none.json" mc publish "$card")" && { echo "  x publish passed without the schema"; FAILS=$((FAILS+1)); }
printf '%s\n' "$o" | grep -q '^FAIL schema ' || { echo "  x publish did not fail schema: $o"; FAILS=$((FAILS+1)); }
o="$(SCHEMA_OVERRIDE="$SANDBOX/none.json" mc check "$card")"
printf '%s\n' "$o" | grep -q '^warn schema ' || { echo "  x check did not warn schema: $o"; FAILS=$((FAILS+1)); }
# Unreadable and invalid cards.
o="$(mc publish "$SANDBOX/missing.json")"; printf '%s' "$o" | grep -q '^FAIL card ' || { echo "  x missing card: $o"; FAILS=$((FAILS+1)); }
echo '{' > "$SANDBOX/notjson.json"; o="$(mc publish "$SANDBOX/notjson.json")"; printf '%s' "$o" | grep -q '^FAIL json ' || { echo "  x invalid JSON: $o"; FAILS=$((FAILS+1)); }
# Publish without CONFIG.md is refused.
o="$(WORK_DIR="$SANDBOX/nowork" MANIFEST_SCHEMA="$ROOT/docs/manifest.schema.json" bash "$ROOT/scripts/manifest-check.sh" publish "$card" 2>&1)"
printf '%s\n' "$o" | grep -q '^FAIL privacy-config ' || { echo "  x publish without CONFIG.md: $o"; FAILS=$((FAILS+1)); }
finish
