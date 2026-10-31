#!/usr/bin/env bash
# verify-onboarding.sh — one-shot structure verification of an onboarded agent.
#
# Runs twice during ONBOARDING — `--config` right after `work/CONFIG.md` is
# written, then a full run at the end (after the sentinel) — and again as an
# upgrade step whenever a version changes what onboarding produces. It checks
# that onboarding produced what it promises: the definition checkout at $HOME
# and the work/ state files, with the STRUCTURE the templates define. Shape
# only — required files, required keys, enum values, table headers, row formats;
# the data inside is never judged. The goal: every deployed instance looks the
# same apart from its configuration values.
#
# Detects, never repairs (same contract as preflight.sh): no external writes, no
# local writes beyond one structured log event. Every FAIL line carries a `fix:`
# instruction for the agent to apply; re-run after fixing until it prints PASS.
#
#   ok   <check> — <detail>                      passed
#   warn <check> — <detail>                      informational, never blocks
#   FAIL <check> — <problem> — fix: <instruction>
#
# Scope is chosen by the mode, so a gate never checks state its caller has not
# created yet — a FAIL the agent cannot act on teaches it to ignore the output:
#
#   --config   the CONFIG block only. For mid-onboarding use, before the
#              schedules, work/VERSION and the sentinel exist.
#   (none)     every offline block: definition, work/, CONFIG.
#   --live     the offline blocks plus the "does it actually work" pass —
#              authentication per integration, the agent's own identity, access
#              to every configured repo/channel, and one read-only
#              `preflight.sh <mode>` per scheduled run type as end-to-end proof.
#
# Exit 0 iff nothing FAILed.

set -u
export LC_ALL=C

LIVE=0; STRUCTURE=1
case "${1:-}" in
  (--live)   LIVE=1;;
  (--config) STRUCTURE=0;;
  ('') ;;
  (*) printf 'usage: %s [--config|--live]\n' "$0" >&2; exit 2;;
esac

HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
CONFIG="$WORK/CONFIG.md"

# structured events log; no-op fallback keeps set -u safe
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if ! . "$SCRIPT_DIR/log.sh" 2>/dev/null; then logev() { :; }; fi

CHECKS=0; FAILS=0; WARNS=0
ok()   { CHECKS=$((CHECKS+1)); printf 'ok   %s — %s\n' "$1" "$2"; }
fail() { CHECKS=$((CHECKS+1)); FAILS=$((FAILS+1)); printf 'FAIL %s — %s — fix: %s\n' "$1" "$2" "$3"; }
warn() { WARNS=$((WARNS+1)); printf 'warn %s — %s\n' "$1" "$2"; }

# The same readers the runtime uses, from the same file — this script judges the
# CONFIG.md that preflight.sh will read, so a second copy of the parser here
# would be the very drift it exists to catch.
. "$SCRIPT_DIR/lib/config.sh" || { echo "cannot source lib/config.sh" >&2; exit 1; }

# Everything the mid-onboarding `--config` run must not reach — it checks state
# that later ONBOARDING steps create (schedules, work/VERSION, the sentinel).
KNOWN_KEYS="display_name repos watch_since watch_paths max_changes_per_run profile default_style prototype_requesters max_prototypes prototype_expiry_days prototype_remote handoff desk_ping desk_artifact bug_reports watch_open_prs issue_label proposals max_proposals_per_week implementer implementer_mention issue_writeback notify run_model dispatch work_repo audit_report log_level model_alert_threshold classifier_alert_threshold heartbeat_gap_min figma figma_file screens max_screen_prs slack_polls slack_poll_channel digest"

if [ "$STRUCTURE" = 1 ]; then
  # ------------------------------------------------------------- definition
  if [ -d "$HOME_DIR/.git" ]; then ok definition "checkout at $HOME_DIR ($(head -1 "$HOME_DIR/VERSION" 2>/dev/null))"
  else fail definition "$HOME_DIR is not the definition checkout" "ONBOARDING.md → Step 1"; fi
  if [ -z "$(git -C "$HOME_DIR" status --porcelain 2>/dev/null)" ]; then ok definition_clean "nothing untracked or changed"
  else fail definition_clean "the checkout shows changes or untracked files: $(git -C "$HOME_DIR" status --porcelain | head -3 | tr '\n' ' ')" "fix .gitignore (allowlist) or revert the change; never git clean"; fi
  head -1 "$HOME_DIR/.gitignore" 2>/dev/null | grep -qx '/\*' && ok gitignore "allowlist" || fail gitignore "the .gitignore is not an allowlist" "restore it from origin/main"
  if [ -f "$HOME_DIR/.design-desk-onboarded" ]; then ok sentinel "$(cat "$HOME_DIR/.design-desk-onboarded")"
  else fail sentinel "no onboarding sentinel" "ONBOARDING.md → Step 6"; fi
  if [ ! -x "$HOME_DIR/bin/design" ]; then fail toolkit "~/bin/design is missing" "bash \"\$HOME/scripts/install-toolkit.sh\""
  elif out="$("$HOME_DIR/bin/design" doctor 2>&1)"; then ok toolkit "~/bin/design, design doctor passes"
  else fail toolkit "design doctor: $(printf '%s\n' "$out" | grep -m1 '^FAIL' || echo failed)" "bash \"\$HOME/scripts/install-toolkit.sh\", then design doctor"; fi
  missing=""
  for s in $(sed -nE 's|^!/\.agents/skills/([A-Za-z0-9_-]+)$|\1|p' "$HOME_DIR/.gitignore" 2>/dev/null); do
    [ -f "$HOME_DIR/.agents/skills/$s/SKILL.md" ] || missing="$missing $s"
  done
  [ -z "$missing" ] && ok skills "bundled skills present" || fail skills "missing bundled skills:$missing" "git -C \$HOME checkout -- .agents/skills"
  [ -x "$HOME_DIR/desk/serve.sh" ] && ok desk_launcher "desk/serve.sh" || fail desk_launcher "desk/serve.sh is missing or not executable" "git -C \$HOME checkout -- desk/serve.sh"

  # -------------------------------------------------------------- schedules
  # Schedules are read over MCP, which a script cannot; the agent compares them in
  # ONBOARDING Step 5 and the weekly audit. This line names what it must find.
  warn schedules "not checkable from a script — expect $(sed -n '/^schedules:/,$p' "$HOME_DIR/kit.yaml" 2>/dev/null | sed -nE 's/^[[:space:]]+- name:[[:space:]]*//p' | paste -sd, -) (list_schedules)"

  # ------------------------------------------------------------------ work/
  [ -d "$WORK" ] && ok work "$WORK" || fail work "no work/ directory" "ONBOARDING.md → Step 2"
  [ -d "$WORK/.git" ] && fail work_git "work/ is a git repository" "move work/.git away: work/ must be a plain directory (docs/persistence.md)" || ok work_git "plain directory"
  [ -f "$WORK/AGENTS.md" ] && ok work_agents "pointer present" || fail work_agents "work/AGENTS.md missing" "ONBOARDING.md → Step 2c"
  for d in desk output profiles brand logs prototypes; do [ -d "$WORK/$d" ] || fail "work_$d" "work/$d/ missing" "ONBOARDING.md → Step 2b"; done
  ok work_dirs "desk output profiles brand logs prototypes"
  [ "$(cat "$WORK/VERSION" 2>/dev/null)" = "$(head -1 "$HOME_DIR/VERSION" 2>/dev/null)" ] && ok version "work/VERSION matches" \
    || fail version "work/VERSION ($(cat "$WORK/VERSION" 2>/dev/null || echo none)) differs from the checkout ($(head -1 "$HOME_DIR/VERSION"))" "docs/persistence.md → Definition version & upgrade"
  if [ -f "$WORK/CHANGES.tsv" ]; then
    [ "$(head -1 "$WORK/CHANGES.tsv")" = "$(printf 'repo\tpr\tmerged_at\tstatus\tcard\tupdated\tattempts\tnote')" ] && ok changes_ledger "header intact" \
      || fail changes_ledger "work/CHANGES.tsv has a different header" "move it aside; scripts/ledger.sh writes a new one"
    bad="$(awk -F'\t' 'NR>1 && (NF!=8 || $4 !~ /^(due|in_progress|carded|skipped|failed)$/)' "$WORK/CHANGES.tsv" | head -2)"
    [ -z "$bad" ] && ok changes_rows "rows well formed" || fail changes_rows "malformed rows: $(printf '%s' "$bad" | tr '\t\n' '| ')" "rows are written only by scripts/ledger.sh and preflight.sh; remove the hand-written ones"
  fi
  if [ -f "$WORK/desk/db.json" ]; then
    jq -e '.version == 1 and (.cards|type=="object") and (.inbox|type=="object")' "$WORK/desk/db.json" >/dev/null 2>&1 && ok desk_store "db.json readable" \
      || fail desk_store "work/desk/db.json is not a Desk store" "restore it from the backup (docs/persistence.md); never edit it by hand"
  fi
fi

# ------------------------------------------------------------------- CONFIG
if [ ! -f "$CONFIG" ]; then
  fail config "work/CONFIG.md missing" "ONBOARDING.md → Step 3"
else
  ok config "present"
  for k in repos watch_since run_model; do
    [ -n "$(cfg "$k")" ] && ok "config_$k" "$(cfg "$k")" || fail "config_$k" "$k is not set" "ONBOARDING.md → Step 3 writes every key of the example"
  done
  enum() { local k="$1" v; v="$(cfg "$k")"; shift; [ -z "$v" ] && return; for a in "$@"; do [ "$v" = "$a" ] && return; done; fail "config_$k" "$k is '$v'" "use one of: $*"; }
  enum handoff desk issue draft-pr
  enum desk_ping enabled disabled
  enum bug_reports enabled disabled
  enum watch_open_prs enabled disabled
  enum proposals enabled disabled
  enum issue_writeback enabled disabled
  enum implementer pr-comment issue
  enum notify disabled slack
  enum dispatch enabled disabled
  enum audit_report enabled disabled
  enum log_level info debug
  enum figma enabled disabled
  enum screens enabled disabled
  enum slack_polls enabled disabled
  enum digest desk slack disabled
  ff="$(cfg figma_file)"; [ -z "$ff" ] || printf '%s' "$ff" | grep -qE '^https://([a-z0-9-]+\.)?figma\.com/' || fail config_figma_file "figma_file is '$ff'" "a link to a Figma file, or empty"
  if grep -qx '## Skills' "$CONFIG"; then
    shdr="$(sed -n '/^## Skills$/,/^## /p' "$CONFIG" | grep '^|' | head -1 | tr -d ' ')"
    [ "$shdr" = "|action|skill|" ] && ok skills_header "| action | skill |" || fail skills_header "the Skills table header is '$shdr'" "use | action | skill | (docs/actions.md)"
  fi
  case "$(cfg default_style)" in ""|auto|brand|carbon|wireframe|repo:*) ;; *) fail config_default_style "default_style is '$(cfg default_style)'" "auto, brand, carbon, wireframe or repo:<owner/name>";; esac
  ds="$(cfg default_style)"
  case "$ds" in
    (repo:*) case ", $(cfg repos), " in (*", ${ds#repo:}, "*) ;; (*) fail config_default_style "default_style names ${ds#repo:}, which is not in repos" "add it to repos or pick another style";; esac;;
    (brand) [ -f "$WORK/brand/brand.json" ] || fail config_default_style "default_style is brand but no brand is saved" "save one with the brand skill, or use wireframe";;
  esac
  wr="$(cfg work_repo)"
  case "$wr" in
    (''|none|off|disabled) ;;
    (*) printf '%s' "$wr" | grep -qE '^([a-z0-9.-]+/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || fail config_work_repo "work_repo is '$wr'" "[host/]owner/name of a private repository, or none";;
  esac
  for k in max_changes_per_run max_prototypes prototype_expiry_days max_screen_prs; do v="$(cfg "$k")"; case "$v" in ''|*[!0-9]*) [ -z "$v" ] || fail "config_$k" "$k is not a whole number" "a number, e.g. 2";; esac; done
  w="$(cfg watch_since)"; [ -z "$w" ] || printf '%s' "$w" | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$' || fail config_watch_since "watch_since is '$w'" "an ISO UTC time like 2026-11-02T09:00:00Z"
  for r in $(cfg repos | tr ',' ' '); do
    [ "$r" = none ] && continue
    printf '%s' "$r" | grep -qE '^([a-z0-9.-]+/)?[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || fail config_repos "'$r' is not [host/]owner/name" "fix repos"
  done
  unknown="$(sed -nE 's/^- ([A-Za-z0-9_.-]+):.*/\1/p' "$CONFIG" | while read -r k; do case " $KNOWN_KEYS " in (*" $k "*) ;; (*) printf '%s ' "$k";; esac; done)"
  [ -z "$unknown" ] && ok config_keys "every bullet is a known key" || fail config_keys "unknown keys (invisible to the runtime): $unknown" "rename to the documented key (CLAUDE.md → Runtime configuration) or delete"
  if grep -qx '## Desk people' "$CONFIG"; then
    hdr="$(sed -n '/^## Desk people$/,/^## /p' "$CONFIG" | grep '^|' | head -1 | tr -d ' ')"
    [ "$hdr" = "|email|role|" ] && ok desk_people_header "| email | role |" || fail desk_people_header "the Desk people table header is '$hdr'" "use | email | role |"
    badrole="$(cfg_table 'Desk people' | awk -F'|' '{gsub(/ /,"",$3); if ($3 !~ /^(lead|designer|pm|developer|guest)$/) print $2}' | head -3 | tr '\n' ' ')"
    [ -z "$badrole" ] && ok desk_people_roles "roles valid" || fail desk_people_roles "rows with an unknown role: $badrole" "lead, designer, pm, developer or guest"
  else
    warn desk_people "no ## Desk people table — everyone but the owner is a guest"
  fi
fi

# --------------------------------------------------------------------- live
if [ "$LIVE" = 1 ]; then
  if login="$(gh api user --jq .login 2>/dev/null)"; then ok github "as $login"; else fail github "gh api user failed" "the GitHub connection must be granted (kit.yaml → connections)"; fi
  for r in $(cfg repos | tr ',' ' '); do
    [ "$r" = none ] && continue
    case "$r" in */*/*) h=(--hostname "${r%%/*}"); s="${r#*/}";; *) h=(); s="$r";; esac
    gh api ${h[@]+"${h[@]}"} "repos/$s" --jq .full_name >/dev/null 2>&1 && ok "repo_$s" "readable" || fail "repo_$s" "cannot read $r" "grant the GitHub connection access to it, or fix repos"
  done
  command -v design >/dev/null 2>&1 || PATH="$HOME_DIR/bin:$PATH"
  for r in $(cfg repos | tr ',' ' '); do
    [ "$r" = none ] && continue
    if out="$(design profile "$r" --check 2>&1)"; then ok "profile_${r##*/}" "design profile passes its check"
    elif printf '%s' "$out" | grep -q 'has no .design-desk profile'; then warn "profile_${r##*/}" "$r has no design profile; variants use a saved style profile (docs/profile.md → A repository without a profile)"
    else fail "profile_${r##*/}" "$(printf '%s\n' "$out" | grep -m1 -E '^FAIL|design:' || echo 'the check failed')" "tell the product team; the profile lives in their repository (docs/profile.md)"; fi
  done
  if curl -sf --max-time 3 "http://127.0.0.1:${DESK_PORT:-5555}/health" >/dev/null; then ok desk_server "answers on 127.0.0.1:${DESK_PORT:-5555}"
  else fail desk_server "the Desk server does not answer" "bash \"\$HOME/scripts/desk-service.sh\" install (docs/desk.md → Server)"; fi
  [ -n "$(cfg desk_artifact)" ] && ok desk_artifact "$(cfg desk_artifact)" || fail desk_artifact "the Desk page was never published" "docs/desk.md → Publishing the page"
  t="$(mktemp -d "${TMPDIR:-/tmp}/design-desk-verify.XXXXXX")"
  printf '%s\n' '<!doctype html><html lang="en" data-review-title="v"><head><meta charset="utf-8"><title>v</title><!-- design:css --></head>' \
    '<body><!-- design:review-bar --><div data-view="1" data-view-name="V" class="p-6 bg-background"><button class="rounded-md bg-primary px-3 text-primary-foreground">Ok</button></div></body></html>' > "$t/v.src.html"
  if WORK_DIR="$t/work" design build "$t/v.src.html" "$t/v.html" --style wireframe >/dev/null 2>&1 \
     && WORK_DIR="$t/work" design shot "$t/v.html" "$t/shots" --width 600 >/dev/null 2>&1 && [ -s "$t/shots/1-light.png" ]; then ok render "built and screenshotted a wireframe page"
  else fail render "a build or screenshot failed" "design doctor, apply its fix: lines, then re-run"; fi
  rm -rf "$t"
  for m in watch inbox; do
    out="$(bash "$SCRIPT_DIR/preflight.sh" "$m" 2>/dev/null)"
    if printf '%s' "$out" | jq -e 'has("nothing_to_do") and (.error == null)' >/dev/null 2>&1; then ok "preflight_$m" "valid worklist"
    else fail "preflight_$m" "preflight.sh $m: $(printf '%s' "$out" | jq -r '.error // "no JSON"' 2>/dev/null | cut -c1-160)" "read the error; docs/$([ "$m" = watch ] && echo watch || echo desk).md"; fi
  done
  for m in watch inbox monitor; do
    t0=$(date +%s); bash "$SCRIPT_DIR/precheck.sh" "$m" >/dev/null 2>&1; rc=$?; dt=$(( $(date +%s) - t0 ))
    if { [ "$rc" -eq 0 ] || [ "$rc" -eq 1 ]; } && [ "$dt" -lt 90 ]; then ok "precheck_$m" "exit $rc in ${dt}s"
    else fail "precheck_$m" "exit $rc in ${dt}s — a broken Precheck fails open and every tick wakes the model" "run bash scripts/precheck.sh $m and read its output"; fi
  done
fi

# ------------------------------------------------------------------- summary
if [ "$LIVE" = 1 ]; then SCOPE="structure+live"
elif [ "$STRUCTURE" = 1 ]; then SCOPE="structure"
else SCOPE="config"; fi
if [ "$FAILS" -eq 0 ]; then
  printf 'PASS (%s) — %d checks passed, %d warning(s)\n' "$SCOPE" "$CHECKS" "$WARNS"
  logev info onboarding_verify "PASS $SCOPE ($CHECKS checks, $WARNS warnings)"
  exit 0
else
  printf 'RESULT (%s): %d of %d checks FAILED — apply each fix above, then re-run this script until it prints PASS.\n' "$SCOPE" "$FAILS" "$CHECKS"
  logev error onboarding_verify "FAILED $SCOPE ($FAILS of $CHECKS checks) — agent must repair and re-run"
  exit 1
fi
