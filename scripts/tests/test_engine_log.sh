#!/usr/bin/env bash
# The engine's output a prototype or a screens instance saves is backed up with work/: a
# token it prints is masked before it reaches the log file (scripts/log.sh → logmask), and
# the engine's own exit status still decides the outcome.
. "$(dirname "$0")/lib.sh"
TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789
P="$SANDBOX/profile"; mkdir -p "$P/bin"
printf '#!/usr/bin/env bash\necho "installing with %s"\nexit "${ENGINE_EXIT:-0}"\n' "$TOKEN" > "$P/bin/env"
masked() { [ -f "$1" ] && grep -q 'gh\*_MASKED' "$1" && ! grep -q "$TOKEN" "$1"; }
fail_() { echo "  ✗ $1"; FAILS=$((FAILS+1)); }

# proto.sh run: the saved log and what it prints are masked.
mkdir -p "$WORK_DIR/prototypes/c7"
jq -n --arg p "$P" --arg wt "$SANDBOX" '{profile_dir:$p, worktree:$wt, base:"abc"}' > "$WORK_DIR/prototypes/c7/meta.json"
out="$(bash "$ROOT/scripts/proto.sh" run C-7 up 2>/dev/null)"
masked "$WORK_DIR/prototypes/c7/env-up.log" || fail_ "proto: the saved engine log is masked"
case "$out" in *"$TOKEN"*) fail_ "proto: the printed engine output is masked";; esac
ENGINE_EXIT=3 bash "$ROOT/scripts/proto.sh" run C-7 update >/dev/null 2>&1 && fail_ "proto: a failed engine still fails through the mask"

# screens.sh sync: the install log is masked. A sandboxed HOME holds the clone, and a
# stand-in node answers the profile lookup with the profile above.
H="$SANDBOX/home"; mkdir -p "$H/checkouts" "$SANDBOX/fakenode"
git init -q --bare "$SANDBOX/acme.git"
git clone -q "$SANDBOX/acme.git" "$SANDBOX/seed" 2>/dev/null
echo a > "$SANDBOX/seed/a.css"
git -C "$SANDBOX/seed" add a.css && git -C "$SANDBOX/seed" -c user.name=t -c user.email=t@t -c commit.gpgsign=false commit -qm base
git -C "$SANDBOX/seed" push -q origin HEAD:refs/heads/main 2>/dev/null
git -C "$SANDBOX/acme.git" symbolic-ref HEAD refs/heads/main
git clone -q "$SANDBOX/acme.git" "$H/checkouts/acme_widgets" 2>/dev/null
printf '#!/bin/sh\necho %s\n' "'{\"dir\":\"$P\"}'" > "$SANDBOX/fakenode/node"; chmod +x "$SANDBOX/fakenode/node"
HOME="$H" PATH="$SANDBOX/fakenode:$PATH" bash "$ROOT/scripts/screens.sh" sync acme/widgets >/dev/null 2>&1
masked "$WORK_DIR/screens/main/env-up.log" || fail_ "screens: the saved install log is masked"
[ "$(jq -r .state "$WORK_DIR/screens/main/meta.json" 2>/dev/null)" = installed ] || fail_ "screens: a clean install is installed"
finish
