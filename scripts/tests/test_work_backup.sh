#!/usr/bin/env bash
# work-backup.sh against a fixture work/ and a local bare remote: what a persist backs
# up and leaves out, what a restore brings back, and that the bulk set (output/, logs/)
# never blocks the state's push — a failing bulk push once cost the Desk store its
# backup (PR #86). Each branch of the script has a case that fails when only it is
# reverted (the unreadable-directory cases need a non-root user), and the audit and the
# monitor read the one outcome line a persist ends with.
. "$(dirname "$0")/lib.sh"

is() { if eval "$2"; then echo true; else echo false; fi; }
check() { assert "$1" '. == true' "$(is "$1" "$2")"; }

fixture() {
  rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR/desk" "$WORK_DIR/output/C-1" "$WORK_DIR/logs"
  echo '{"items":[]}' > "$WORK_DIR/desk/store.json"
  echo secret > "$WORK_DIR/desk/.agent-token"
  echo 3 > "$WORK_DIR/.desk-down-ticks"
  echo '- work_repo: test/work' > "$WORK_DIR/CONFIG.md"
  echo png > "$WORK_DIR/output/C-1/shot.png"
  echo line > "$WORK_DIR/logs/run.log"
  mkdir -p "$WORK_DIR/.git"; echo junk > "$WORK_DIR/.git/HEAD"   # would break the clone if copied
  head -c 2097152 /dev/zero > "$WORK_DIR/output/C-1/big.mp4"   # 2 MB, over the 1 MB cap
}
remote() { rm -rf "$SANDBOX/remote.git" "$SANDBOX/clone" "$SANDBOX/view"; git init -q --bare "$SANDBOX/remote.git"; }
# file://, not a path: git ignores --depth on a local path, and the clone must be shallow.
persist() {
  GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone" \
    WORK_BACKUP_MAX_FILE_MB=1 WORK_BACKUP_RETRIES=1 bash "$ROOT/scripts/work-backup.sh" persist >/dev/null 2>&1
}
# The last outcome line of a persist, as the audit and the monitor read it.
outcome() { grep -h '"event":"work_backup"' "$WORK_DIR"/logs/events-*.jsonl 2>/dev/null | grep -E '"msg":"backup (ok|failed): ' | tail -1 | jq -r '"\(.level) \(.msg)"'; }
hook() { # pre-receive that refuses a push whose newest commit subject matches $1
  printf '#!/usr/bin/env bash\nwhile read -r _ new _; do git log -1 --format=%%s "$new" | grep -q "%s" && exit 1; done\nexit 0\n' "$1" \
    > "$SANDBOX/remote.git/hooks/pre-receive"; chmod +x "$SANDBOX/remote.git/hooks/pre-receive"
}
# df that reports $DF_FREE KB free, for the free-space branch.
mkdir -p "$SANDBOX/dfbin"
printf '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "tmpfs 1000000 0 ${DF_FREE:-1} 0%% /dev/shm"\n' > "$SANDBOX/dfbin/df"
chmod +x "$SANDBOX/dfbin/df"
tight() { DF_FREE="$1" PATH="$SANDBOX/dfbin:$PATH" persist; }
view() { rm -rf "$SANDBOX/view"; git clone -q -b main "$SANDBOX/remote.git" "$SANDBOX/view" 2>/dev/null; }
V="$SANDBOX/view"

# 1. A persist backs up the state and the bulk set, and leaves the machine's own files out.
fixture; remote; persist; view
check "the Desk store arrives" '[ -f "$V/desk/store.json" ]'
check "CONFIG.md arrives" '[ -f "$V/CONFIG.md" ]'
check "output/ arrives" '[ -f "$V/output/C-1/shot.png" ]'
check "logs/ arrives" '[ -f "$V/logs/run.log" ]'
check "the agent token stays out" '[ ! -e "$V/desk/.agent-token" ]'
check ".desk-down-ticks stays out" '[ ! -e "$V/.desk-down-ticks" ]'
check "work/.git stays out (the clone's own .git still works)" '[ "$(git -C "$SANDBOX/clone" rev-parse --git-dir)" = .git ]'
check "a file over the cap stays out" '[ ! -e "$V/output/C-1/big.mp4" ]'
check "the skip names the file" 'grep -qs "output/C-1/big.mp4" "$WORK_DIR"/logs/events-*.jsonl'
check "the state is its own commit, before the bulk one" \
  '[ "$(git -C "$V" log --format=%s --reverse | sed "s/ [0-9T:Z-]*$//" | tr "\n" ,)" = "chore(work): persist state,chore(work): persist bulk," ]'
check "the outcome is one info line: backup ok" '[ "$(outcome)" = "info backup ok: state pushed, bulk pushed" ]'

# 2. A deletion in work/ reaches the backup; the next persist with no change pushes nothing.
rm "$WORK_DIR/output/C-1/shot.png"; persist; view
check "a deleted output file leaves the backup" '[ ! -e "$V/output/C-1/shot.png" ]'
states() { git -C "$V" log --format=%s main | grep -c "persist state"; }
n="$(states)"; persist; view
check "a second persist adds no state commit when the state did not change" '[ "$(states)" -eq "$n" ]'

# 3. A remote that refuses the bulk push still takes the state; the outcome is an error.
fixture; remote; hook "persist bulk"; persist; view
check "a refused bulk push leaves the Desk store backed up" '[ -f "$V/desk/store.json" ]'
check "the refused bulk set is not on the remote" '[ ! -e "$V/output" ]'
check "a refused bulk push is a failed backup" '[ "$(outcome)" = "error backup failed: state pushed, bulk failed — retry next run" ]'

# 3b. A remote that refuses the state push and takes the bulk set: a failed backup too.
fixture; remote; hook "persist state"; persist; view
check "the bulk set still arrives" '[ -f "$V/logs/run.log" ]'
check "a refused state push is a failed backup, though the bulk push came last" \
  '[ "$(outcome)" = "error backup failed: state failed, bulk pushed — retry next run" ]'

# 4. A bulk set larger than the clone's free space stays out; the state is still pushed.
fixture; remote; tight 1; view
check "a full clone still backs up the Desk store" '[ -f "$V/desk/store.json" ]'
check "a full clone skips the bulk set" '[ ! -e "$V/output" ]'
check "the skip is logged" 'grep -qs "free space" "$WORK_DIR"/logs/events-*.jsonl'
check "a skip is a warning, no error" '[ "$(outcome)" = "warn backup ok: state pushed, bulk skipped (output/ and logs/ too large for the clone)" ]'

# 4b. The set needs twice its size free: one that fits the free space only once stays out.
fixture; rm "$WORK_DIR/output/C-1/big.mp4"; head -c 409600 /dev/zero > "$WORK_DIR/output/C-1/mid.bin"; remote
need="$(cd "$WORK_DIR" && du -sk output logs | awk '{s+=$1} END{print s}')"
tight "$((need * 3 / 2))"; view
check "a set that fits only once is skipped" '[ ! -e "$V/output" ]'

# 4c. The copy the clone already holds is freed first, so it counts as free space.
fixture; rm "$WORK_DIR/output/C-1/big.mp4"; head -c 409600 /dev/zero > "$WORK_DIR/output/C-1/mid.bin"; remote; persist
echo changed > "$WORK_DIR/output/C-1/shot.png"
need="$(cd "$WORK_DIR" && du -sk output logs | awk '{s+=$1} END{print s}')"
tight "$((need * 3 / 2))"; view
check "the old copy's space counts: the change arrives" '[ "$(cat "$V/output/C-1/shot.png")" = changed ]'

# 4d. Only logs/, no output/: the missing path is left out of git add, logs/ arrives.
fixture; rm -rf "$WORK_DIR/output"; remote; persist; view
check "logs/ arrives without an output/" '[ -f "$V/logs/run.log" ]'
check "and the backup is ok" '[ "$(outcome | cut -d" " -f1-3)" = "info backup ok:" ]'

# 4e. An index an earlier part left staged never rides along in the state commit.
fixture; remote; persist
echo stray > "$SANDBOX/clone/output/stray.txt"; git -C "$SANDBOX/clone" add output/stray.txt
echo '{"items":[1]}' > "$WORK_DIR/desk/store.json"; persist; view
check "the state commit holds no staged bulk file" \
  '[ "$(git -C "$V" log --format= --name-only --grep "persist state" | grep -c stray)" -eq 0 ]'

# 4f. A name with [, * and a space is skipped by its exact name, never read as a pattern.
fixture; mkdir -p "$WORK_DIR/output/y"
head -c 2097152 /dev/zero > "$WORK_DIR/output/y/a[1]*b c.mp4"   # over the cap
echo small > "$WORK_DIR/output/y/a1Xb c.mp4"                     # what the pattern would match
remote; persist; view
check "the big file with [ * and a space stays out" '[ ! -e "$V/output/y/a[1]*b c.mp4" ]'
check "the small file its pattern would match arrives" '[ -f "$V/output/y/a1Xb c.mp4" ]'

# 4g. The clone holds the tip only, so the backup's history never has to fit in /dev/shm.
rm -rf "$SANDBOX/clone"; echo again > "$WORK_DIR/output/C-1/shot.png"; persist
check "a fresh clone is shallow" '[ "$(git -C "$SANDBOX/clone" rev-parse --is-shallow-repository)" = true ]'
# The clone: --depth 1 fetches no older commit, --branch fetches no other branch (the
# remote's HEAD names "other" here).
fixture; remote; persist
other="$(git -C "$SANDBOX/clone" commit-tree "$(git -C "$SANDBOX/clone" mktree </dev/null)" -m other)"
git -C "$SANDBOX/clone" push -q origin "$other:refs/heads/other" 2>/dev/null
git -C "$SANDBOX/remote.git" symbolic-ref HEAD refs/heads/other
echo more > "$WORK_DIR/desk/store.json"; persist
old="$(git -C "$SANDBOX/remote.git" rev-parse main~1)"
# A restore seeds a fresh clone and runs no gc, so what the clone fetched stays visible.
GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone-r" \
  WORK_DIR="$SANDBOX/work-r" bash "$ROOT/scripts/work-backup.sh" restore >/dev/null 2>&1
check "a fresh clone holds no older commit (clone --depth 1)" '! git -C "$SANDBOX/clone-r" cat-file -e "$old^{commit}" 2>/dev/null'
check "a fresh clone holds no other branch (clone --branch)" '! git -C "$SANDBOX/clone-r" cat-file -e "$other^{commit}" 2>/dev/null'
# The fetch: another machine pushes twice; this clone fetches the tip, not the commit between.
GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone-b" \
  WORK_DIR="$SANDBOX/work-b" bash -c 'mkdir -p "$WORK_DIR/desk"; for i in 1 2; do echo "$i" > "$WORK_DIR/desk/store.json"; bash "$0" persist; done' \
  "$ROOT/scripts/work-backup.sh" >/dev/null 2>&1
mid="$(git -C "$SANDBOX/remote.git" rev-parse main~1)"
echo after > "$WORK_DIR/desk/store.json"; persist
check "a fetch holds no commit between the clone's tip and the remote's (fetch --depth 1)" \
  '! git -C "$SANDBOX/clone" cat-file -e "$mid^{commit}" 2>/dev/null'
check "a pushed clone keeps no loose blob (gc)" '[ "$(git -C "$SANDBOX/clone" count-objects | cut -d" " -f1)" -eq 0 ]'

# 4i. tar through a stub: TAR_C_EXIT sets the exit status of tar -c after a full copy.
mkdir -p "$SANDBOX/tarbin"; REALTAR="$(command -v tar)"
printf '#!/bin/sh\ncase " $* " in (*" -c "*) "%s" "$@"; s=$?; [ "$s" -eq 0 ] && s="${TAR_C_EXIT:-0}"; exit "$s";; esac\nexec "%s" "$@"\n' \
  "$REALTAR" "$REALTAR" > "$SANDBOX/tarbin/tar"; chmod +x "$SANDBOX/tarbin/tar"
# Exit 1 (a file changed while read, as a growing log does) copied the rest: ok, with a warning.
fixture; remote; TAR_C_EXIT=1 PATH="$SANDBOX/tarbin:$PATH" persist; view
check "tar exit 1 is no failed backup" '[ "$(outcome | cut -d" " -f1-3)" = "info backup ok:" ]'
check "tar exit 1 logs a warning" 'grep -qs "a file changed while it was copied" "$WORK_DIR"/logs/events-*.jsonl'
check "tar exit 1 still pushes the copy" '[ -f "$V/desk/store.json" ] && [ -f "$V/output/C-1/shot.png" ]'
# A restore whose tar -c fails says so and never reports a restore.
rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR"
TAR_C_EXIT=2 PATH="$SANDBOX/tarbin:$PATH" GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" \
  WORK_BACKUP_LOCAL="$SANDBOX/clone3" bash "$ROOT/scripts/work-backup.sh" restore >/dev/null 2>&1
check "a failed restore copy is logged" 'grep -qs "restore: copy failed" "$WORK_DIR"/logs/events-*.jsonl'
check "a failed restore copy is no restore" '! grep -qs "restored work/ from remote" "$WORK_DIR"/logs/events-*.jsonl'

# 4j. The retry loop: a remote that refuses the first push of each part takes the second.
fixture; remote; persist; echo retried > "$WORK_DIR/desk/store.json"; echo retried > "$WORK_DIR/output/C-1/shot.png"
printf '#!/usr/bin/env bash\nf="$GIT_DIR/refused"; [ -e "$f" ] && { rm "$f"; exit 0; }; touch "$f"; exit 1\n' \
  > "$SANDBOX/remote.git/hooks/pre-receive"; chmod +x "$SANDBOX/remote.git/hooks/pre-receive"
GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone" \
  WORK_BACKUP_MAX_FILE_MB=1 WORK_BACKUP_RETRIES=2 bash "$ROOT/scripts/work-backup.sh" persist >/dev/null 2>&1; view
check "a rejected push is retried and lands" '[ "$(cat "$V/desk/store.json")" = retried ] && [ "$(cat "$V/output/C-1/shot.png")" = retried ]'
check "the retried backup is ok" '[ "$(outcome)" = "info backup ok: state pushed, bulk pushed" ]'

# 4h. A copy tar cannot read fails: nothing is pushed as deleted, and the backup is an error.
if [ "$(id -u)" -ne 0 ]; then
  fixture; remote; persist
  chmod 000 "$WORK_DIR/output/C-1"; echo new > "$WORK_DIR/logs/run.log"; persist; chmod 755 "$WORK_DIR/output/C-1"; view
  check "an unreadable output dir is not pushed as a deletion" '[ -f "$V/output/C-1/shot.png" ]'
  check "an unreadable bulk copy is a failed backup" '[ "$(outcome | cut -d" " -f1-3)" = "error backup failed:" ]'
  chmod 000 "$WORK_DIR/desk"; persist; chmod 755 "$WORK_DIR/desk"; view
  check "an unreadable desk/ is not pushed as a deletion" '[ -f "$V/desk/store.json" ]'
  check "an unreadable state copy is a failed backup" 'outcome | grep -q "^error backup failed: state failed"'
fi

# 5. A restore brings back the state and the bulk set, never the token.
fixture; remote; persist
rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR"
GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="file://$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone2" \
  bash "$ROOT/scripts/work-backup.sh" restore >/dev/null 2>&1
check "a restore brings back the Desk store" '[ -f "$WORK_DIR/desk/store.json" ]'
check "a restore brings back output/" '[ -f "$WORK_DIR/output/C-1/shot.png" ]'
check "a restore brings back logs/" '[ -f "$WORK_DIR/logs/run.log" ]'
check "a restore brings back CONFIG.md" '[ -f "$WORK_DIR/CONFIG.md" ]'
check "a restore brings back no token" '[ ! -e "$WORK_DIR/desk/.agent-token" ]'

# 6. The readers: a per-part "pushed" line after a failed persist clears nothing; the
# audit fails on a failed persist, warns on a skipped bulk set; the monitor alerts after 6 h.
ago() { date -u -d "$1 hours ago" +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-"$1"H +%Y-%m-%dT%H:%M:%SZ; }
ev() { jq -nc --arg ts "$(ago "$1")" --arg l "$2" --arg m "$3" '{ts:$ts,run:"t",job:"session",level:$l,event:"work_backup",msg:$m}'; }
rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR/logs"; echo '- work_repo: test/work' > "$WORK_DIR/CONFIG.md"
EVF="$WORK_DIR/logs/events-$(date -u +%Y-%m-%d).jsonl"
{ ev 10 info "backup ok: state pushed, bulk pushed"
  ev 7 info "bulk: pushed (attempt 1)"
  ev 7 error "backup failed: state failed, bulk pushed — retry next run"; } > "$EVF"
audit_backup() { bash "$ROOT/scripts/preflight.sh" audit 2>/dev/null | jq -c '[.checks[] | select(.id == "backup") | .status]'; }
assert "the audit fails on a failed persist" '. == ["fail"]' "$(audit_backup)"
assert "the monitor alerts a failed persist after 6 h, a per-part push clears nothing" \
  '[.alerts_due[].kind] | index("backup_failing") != null' "$(bash "$ROOT/scripts/monitor.sh" 2>/dev/null)"
ev 1 warn "backup ok: state pushed, bulk skipped (output/ and logs/ too large for the clone)" >> "$EVF"
assert "the audit warns on a skipped bulk set" '. == ["warn"]' "$(audit_backup)"
rm -f "$WORK_DIR/MONITOR.json"
assert "a backup ok clears the monitor's alert" \
  '[.alerts_due[].kind] | index("backup_failing") == null' "$(bash "$ROOT/scripts/monitor.sh" 2>/dev/null)"

finish
