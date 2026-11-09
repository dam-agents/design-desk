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
# desk_link is the Desk's share link: anything but a web link fails, a link passes.
for link in 'javascript:alert(1)' 'share.example.com/a/xY12' 'https://share.example.com/a/xY12'; do
  printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' "- desk_link: $link" > "$WORK_DIR/CONFIG.md"
  out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)"
  if [ "$link" = 'https://share.example.com/a/xY12' ]; then
    printf '%s' "$out" | grep -q '^FAIL config_desk_link' && { echo "  ✗ verify refuses a share link: $out"; FAILS=$((FAILS+1)); }
  else
    printf '%s' "$out" | grep -q '^FAIL config_desk_link' || { echo "  ✗ verify names config_desk_link for '$link': $out"; FAILS=$((FAILS+1)); }
  fi
done
# A roster role reads as the server reads it: a spaced or tabbed role passes, an unknown one fails.
# An admin passes, and so does a row still written lead, the admin's name before 1.59.0.
for row in '| lou@example.com | Lead developer |' $'| lou@example.com | lead\tdeveloper |' '| ola@example.com | Admin |' '| ola@example.com | lead |' '| ops@example.com | ops |'; do
  printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' '' '## Desk people' '' '| email | role |' '| --- | --- |' "$row" > "$WORK_DIR/CONFIG.md"
  out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)"
  case "$row" in
    *ops*) printf '%s' "$out" | grep -q '^FAIL desk_people_roles' || { echo "  ✗ verify names an unknown role: $out"; FAILS=$((FAILS+1)); } ;;
    *) printf '%s' "$out" | grep -q '^ok  *desk_people_roles' || { echo "  ✗ verify passes '$row': $out"; FAILS=$((FAILS+1)); } ;;
  esac
done
# decisions_page takes dam, and public as the 1.58.0 spelling of dam; anything else fails.
for v in dam public on; do
  printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' "- decisions_page: $v" > "$WORK_DIR/CONFIG.md"
  out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)"
  if [ "$v" = on ]; then
    printf '%s' "$out" | grep -q '^FAIL config_decisions_page' || { echo "  ✗ verify names an unknown decisions_page: $out"; FAILS=$((FAILS+1)); }
  else
    printf '%s' "$out" | grep -q '^FAIL config_decisions_page' && { echo "  ✗ verify passes decisions_page '$v': $out"; FAILS=$((FAILS+1)); }
  fi
done
# qa_bot is a known key: a config with it passes the key check.
printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' '- qa_bot: U0QA12345' > "$WORK_DIR/CONFIG.md"
out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)"
printf '%s' "$out" | grep -q '^ok  *config_keys' || { echo "  ✗ verify takes qa_bot as a known key: $out"; FAILS=$((FAILS+1)); }
# The Skills table takes | action | skill | and | action | skill | source |; any other header fails.
for hdr in '| action | skill |' '| action | skill | source |' '| action | skill | pin |'; do
  printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' '' '## Skills' '' "$hdr" '| --- | --- | --- |' '| options | acme-prototyper | acme/proto@0123abcd |' > "$WORK_DIR/CONFIG.md"
  out="$(bash "$ROOT/scripts/verify-onboarding.sh" --config 2>&1)"
  case "$hdr" in
    *pin*) printf '%s' "$out" | grep -q '^FAIL skills_header' || { echo "  ✗ verify names a wrong Skills header: $out"; FAILS=$((FAILS+1)); } ;;
    *) printf '%s' "$out" | grep -q '^ok  *skills_header' || { echo "  ✗ verify passes the Skills header '$hdr': $out"; FAILS=$((FAILS+1)); } ;;
  esac
done
# --live: the backup repository must be private; a public one, or one that cannot be read, fails.
# HOME and the Desk port point nowhere, so the other live checks fail fast and are not judged here.
mkdir -p "$SANDBOX/home"
printf '%s\n' '- repos: acme/widgets' '- watch_since: 2026-10-01T00:00:00Z' '- run_model: default' '- work_repo: acme/desk-state' > "$WORK_DIR/CONFIG.md"
for private in true false missing; do
  rm -f "$STUB_DIR/private.txt"; [ "$private" = missing ] || echo "$private" > "$STUB_DIR/private.txt"
  out="$(HOME="$SANDBOX/home" DESK_PORT=9 GITHUB_REPO_WORK= bash "$ROOT/scripts/verify-onboarding.sh" --live 2>&1)"
  case "$private" in
    true) printf '%s' "$out" | grep -q '^ok  *work_repo_private' || { echo "  ✗ verify passes a private backup repository: $(printf '%s' "$out" | grep work_repo)"; FAILS=$((FAILS+1)); } ;;
    *) printf '%s' "$out" | grep -q '^FAIL work_repo_private' || { echo "  ✗ verify names a backup repository that is $private: $(printf '%s' "$out" | grep work_repo)"; FAILS=$((FAILS+1)); } ;;
  esac
done
grep -q 'repos/acme/desk-state --jq .private' "$STUB_DIR/gh.calls" || { echo "  ✗ verify reads the backup repository's .private"; FAILS=$((FAILS+1)); }
finish
