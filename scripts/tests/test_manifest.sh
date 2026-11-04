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
finish
