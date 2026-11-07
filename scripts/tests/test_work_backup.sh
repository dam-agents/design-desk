#!/usr/bin/env bash
# work-backup.sh against a fixture work/ and a local bare remote: what a persist backs
# up and leaves out, what a restore brings back, and that the bulk set (output/, logs/)
# never blocks the state's push — a failing bulk push once cost the Desk store its
# backup (PR #86).
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
persist() {
  GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone" \
    WORK_BACKUP_MAX_FILE_MB=1 WORK_BACKUP_RETRIES=1 bash "$ROOT/scripts/work-backup.sh" persist >/dev/null 2>&1
}
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

# 2. A deletion in work/ reaches the backup; the next persist with no change pushes nothing.
rm "$WORK_DIR/output/C-1/shot.png"; persist; view
check "a deleted output file leaves the backup" '[ ! -e "$V/output/C-1/shot.png" ]'
states() { git -C "$V" log --format=%s main | grep -c "persist state"; }
n="$(states)"; persist; view
check "a second persist adds no state commit when the state did not change" '[ "$(states)" -eq "$n" ]'

# 3. A remote that refuses the bulk push still takes the state.
fixture; remote
cat > "$SANDBOX/remote.git/hooks/pre-receive" <<'EOF'
#!/usr/bin/env bash
while read -r _ new _; do git ls-tree -r --name-only "$new" | grep -q '^output/' && exit 1; done
exit 0
EOF
chmod +x "$SANDBOX/remote.git/hooks/pre-receive"
persist; view
check "a refused bulk push leaves the Desk store backed up" '[ -f "$V/desk/store.json" ]'
check "the refused bulk set is not on the remote" '[ ! -e "$V/output" ]'

# 4. A bulk set larger than the clone's free space stays out; the state is still pushed.
fixture; remote
mkdir -p "$SANDBOX/dfbin"
printf '#!/bin/sh\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "tmpfs 10 10 1 100%% /dev/shm"\n' > "$SANDBOX/dfbin/df"
chmod +x "$SANDBOX/dfbin/df"
PATH="$SANDBOX/dfbin:$PATH" persist; view
check "a full clone still backs up the Desk store" '[ -f "$V/desk/store.json" ]'
check "a full clone skips the bulk set" '[ ! -e "$V/output" ]'
check "the skip is logged" 'grep -qs "free space" "$WORK_DIR"/logs/events-*.jsonl'

# 5. A restore brings back the state and the bulk set, never the token.
fixture; remote; persist
rm -rf "$WORK_DIR"; mkdir -p "$WORK_DIR"
GITHUB_REPO_WORK=test/work WORK_BACKUP_REMOTE="$SANDBOX/remote.git" WORK_BACKUP_LOCAL="$SANDBOX/clone2" \
  bash "$ROOT/scripts/work-backup.sh" restore >/dev/null 2>&1
check "a restore brings back the Desk store" '[ -f "$WORK_DIR/desk/store.json" ]'
check "a restore brings back output/" '[ -f "$WORK_DIR/output/C-1/shot.png" ]'
check "a restore brings back logs/" '[ -f "$WORK_DIR/logs/run.log" ]'
check "a restore brings back CONFIG.md" '[ -f "$WORK_DIR/CONFIG.md" ]'
check "a restore brings back no token" '[ ! -e "$WORK_DIR/desk/.agent-token" ]'

finish
