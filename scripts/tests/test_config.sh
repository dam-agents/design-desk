#!/usr/bin/env bash
# The shell reader and the toolkit's reader see the same values and tables.
. "$(dirname "$0")/lib.sh"
cat > "$WORK_DIR/CONFIG.md" <<'CFG'
- display_name: `Team Desk`   # the Desk's title
- repos: "acme/widgets, acme/site"
- notify: disabled
- Repos: ignored, wrong case

## Desk people

| email | role |
| --- | --- |
| alice@example.com | designer |
| bob@example.com | developer |

## Other

| x |
| --- |
| y |
CFG
CONFIG="$WORK_DIR/CONFIG.md"; . "$ROOT/scripts/lib/config.sh"
[ "$(cfg display_name)" = "Team Desk" ] || { echo "  ✗ cfg strips quotes and comments: '$(cfg display_name)'"; FAILS=$((FAILS+1)); }
[ "$(cfg repos)" = "acme/widgets, acme/site" ] || { echo "  ✗ cfg repos"; FAILS=$((FAILS+1)); }
[ "$(cfg_table 'Desk people' | grep -c .)" -eq 2 ] || { echo "  ✗ cfg_table stops at the next heading"; FAILS=$((FAILS+1)); }
if command -v node >/dev/null && node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)" 2>/dev/null; then
  js="$(node --input-type=module -e "import { cfg, cfgTable } from '$ROOT/toolkit/lib/core.mjs'; console.log(JSON.stringify({ display_name: cfg('display_name'), repos: cfg('repos'), people: cfgTable('Desk people') }))")"
  assert "node cfg agrees" '.display_name == "Team Desk" and .repos == "acme/widgets, acme/site"' "$js"
  assert "node cfgTable agrees" '.people | length == 2 and .[0].role == "designer"' "$js"
fi
printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' '- default_style: repo:acme/other' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)" && { echo "  ✗ verify passes a default_style outside repos"; FAILS=$((FAILS+1)); }
printf '%s' "$out" | grep -q '^FAIL config_default_style' || { echo "  ✗ verify names config_default_style: $out"; FAILS=$((FAILS+1)); }
finish
