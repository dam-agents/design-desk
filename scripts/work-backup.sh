#!/usr/bin/env bash
# work-backup.sh — durable backup / restore of work/ to the $GITHUB_REPO_WORK
# remote, performed ENTIRELY inside a private tmpfs clone: every run of the agent
# shares one machine and one $HOME, and a .git two runs mutate at once corrupts —
# so work/ is a plain data directory and git only ever runs in /dev/shm.
# Rationale: docs/persistence.md.
#
#   work-backup.sh persist   # end of run: snapshot work/ -> commit -> push, in two pushes
#   work-backup.sh restore   # empty work/: remote state -> work/ (data only)
#
# Two pushes: first the state (all of work/ but output/ and logs/), then the bulk set
# (output/ and logs/) on its own, so a bulk set that cannot be copied or pushed never
# blocks the Desk store's backup. The bulk push skips a file over the per-file cap and
# skips the whole set when it does not fit the clone's free space, with a warning that
# names the path.
#
# Durability: nothing authoritative lives on tmpfs — live state is work/
# (on the machine's disk), history is the remote, the clone is disposable scratch
# re-seeded whenever missing or broken. Concurrency: the persist step is
# serialized by a mkdir lock next to the clone (lock-or-skip + stale TTL;
# a skipped persist is safe — work/ is the source of truth and the next run
# backs it up); a rejected non-fast-forward push re-seeds from the new tip and
# retries with a fresh snapshot. work/ files are only ever READ here (tar).
#
# Never fails the run: all error paths exit 0 (a missed backup is retried next
# run). Requires: git, tar. Sources scripts/log.sh when present.
set -u

MODE="${1:-persist}"
WORK="${WORK_DIR:-${HOME:-/home/agent}/work}"
LOCAL="${WORK_BACKUP_LOCAL:-/dev/shm/design-desk-work-backup}"
BRANCH="${WORK_BACKUP_BRANCH:-main}"
RETRIES="${WORK_BACKUP_RETRIES:-3}"
LOCK="$LOCAL.lock"                                # tmpfs too; mtime = acquire time
LOCK_TTL_MIN="${WORK_BACKUP_LOCK_TTL_MIN:-10}"    # a persist takes seconds
MAX_FILE_MB="${WORK_BACKUP_MAX_FILE_MB:-50}"      # GitHub warns at 50 MB, refuses 100 MB
BULK="output logs"                                # the bulk set: pushed after the state
umask 077                                         # the clone and its lock: this user's only

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_JOB="${LOG_JOB:-session}"
if ! . "$SCRIPT_DIR/log.sh" 2>/dev/null; then logev() { :; }; fi

say() { echo "work-backup: $*"; }

# The env var wins; a scheduled run has no session exports, so work/CONFIG.md carries
# the same value as `work_repo`.
if [ -z "${GITHUB_REPO_WORK:-}" ]; then
  CONFIG="$WORK/CONFIG.md"; . "$SCRIPT_DIR/lib/config.sh" 2>/dev/null && GITHUB_REPO_WORK="$(cfg work_repo)"
fi
case "${GITHUB_REPO_WORK:-}" in (none|off|disabled) GITHUB_REPO_WORK="";; esac
if [ -z "${GITHUB_REPO_WORK:-}" ]; then
  say "GITHUB_REPO_WORK unset — local-only, nothing to $MODE."; exit 0
fi
if ! command -v git >/dev/null 2>&1 || ! command -v tar >/dev/null 2>&1; then
  say "git/tar unavailable — skipping $MODE."; logev warn work_backup "git/tar unavailable — $MODE skipped"; exit 0
fi

REMOTE_URL="${WORK_BACKUP_REMOTE:-https://github.com/$GITHUB_REPO_WORK}"

# (Re)seed a usable clone in $LOCAL. tmpfs may be empty (fresh boot), stale, or
# half-written (interrupted run) — validate and re-clone defensively. The clone holds
# the tip only (--depth 1): the backup's history keeps every old output/ and logs/ and
# only grows, so a full clone would outgrow /dev/shm.
seed_clone() {
  # The clone holds all of work/ on a shared tmpfs: this user's alone (umask 077 above), and
  # a name another user or a symlink holds is never used.
  if [ -L "$LOCAL" ] || { [ -e "$LOCAL" ] && [ ! -O "$LOCAL" ]; }; then
    say "$LOCAL is not this user's own — refusing it."; logev error work_backup "$LOCAL is not this user's own directory"; return 1
  fi
  if ! ( cd "$LOCAL" 2>/dev/null && git rev-parse --git-dir >/dev/null 2>&1 ); then
    rm -rf "$LOCAL" 2>/dev/null || true
    if ! git clone -q --depth 1 --branch "$BRANCH" "$REMOTE_URL" "$LOCAL" 2>/dev/null; then
      # empty/nonexistent remote (first-ever backup): start a fresh repo
      rm -rf "$LOCAL" 2>/dev/null || true
      mkdir -p "$LOCAL" || return 1
      ( cd "$LOCAL" && git init -q && git remote add origin "$REMOTE_URL" ) || return 1
    fi
  fi
  chmod 700 "$LOCAL" 2>/dev/null || true             # a clone made before umask 077
  ( cd "$LOCAL" || exit 1
    git config user.name  "design-desk"              2>/dev/null || true
    git config user.email "design-desk@agents.local" 2>/dev/null || true
    if git fetch -q --depth 1 origin "$BRANCH" 2>/dev/null; then
      git checkout -q -B "$BRANCH" FETCH_HEAD 2>/dev/null
    else
      git checkout -q -B "$BRANCH" 2>/dev/null || true
    fi
  ) || return 1
  return 0
}

# Mirror the state into the clone's worktree (deletions included): wipe all but .git
# and the bulk set, then lay down the current state. tar keeps this a pure READ of work/.
sync_state() {
  find "$LOCAL" -mindepth 1 -maxdepth 1 ! -name .git ! -name output ! -name logs -exec rm -rf {} + 2>/dev/null || true
  # The Desk's agent token stays on this machine; a restore makes the server mint none
  # and keep the one it has.
  ( cd "$WORK" && tar -c --exclude='./.git' --exclude='./desk/.agent-token' --exclude='./.desk-down-ticks' \
      --exclude='./output' --exclude='./logs' -f - . ) \
    | ( cd "$LOCAL" && tar -xf - )
  copy_ok state "${PIPESTATUS[@]}"
}

# copy_ok <label> <tar -c status> <tar -x status>: both ends of a copy pipe. A reader that
# failed (status 2: a file it could not read) or an extractor that failed is a failed copy,
# never a good one with files missing. Status 1 (a file changed while read) copied the rest.
copy_ok() {
  local label="$1" c="${2:-1}" x="${3:-1}"
  if [ "$c" -ge 2 ] || [ "$x" -ne 0 ]; then
    say "$label: copy failed (tar $c/$x)."; logev warn work_backup "$label: copy failed (tar exit $c/$x)"; return 1
  fi
  [ "$c" -eq 1 ] && logev warn work_backup "$label: a file changed while it was copied"
  return 0
}

# Mirror the bulk set (output/, logs/) into the clone. A file over MAX_FILE_MB stays out;
# a set that needs more than the clone's free space (the copy plus its git object, so
# twice its size) stays out whole and the backup keeps its last copy. Returns 43 then.
sync_bulk() {
  local skip="$LOCAL.skip" d f need=0 free have=0 cap_k=$((MAX_FILE_MB * 1024)) dirs=""
  : > "$skip" || return 1
  for d in $BULK; do
    [ -d "$WORK/$d" ] || continue
    dirs="$dirs ./$d"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      printf '%s\n' "$f" >> "$skip"
      say "skipped $f: over ${MAX_FILE_MB} MB."
      logev warn work_backup "bulk file over ${MAX_FILE_MB} MB not backed up: work/${f#./}"
    done <<EOF
$(cd "$WORK" && find "./$d" -type f -size +"${cap_k}k" 2>/dev/null)
EOF
    need=$((need + $(cd "$WORK" && find "./$d" -type f ! -size +"${cap_k}k" -exec du -k {} + 2>/dev/null | awk '{s+=$1} END{print s+0}')))
    [ -d "$LOCAL/$d" ] && have=$((have + $(du -sk "$LOCAL/$d" 2>/dev/null | awk '{print $1+0}')))
  done
  free=$(df -Pk "$LOCAL" 2>/dev/null | awk 'NR==2{print $4+0}')
  if [ -n "$free" ] && [ $((need * 2)) -gt $((free + have)) ]; then
    say "skipped the bulk set: ${need} KB needs twice that, ${free} KB free."
    logev warn work_backup "bulk set work/output, work/logs (${need} KB) larger than the clone's free space — not backed up"
    rm -f "$skip"; return 43
  fi
  for d in $BULK; do rm -rf "${LOCAL:?}/$d" 2>/dev/null || true; done
  if [ -n "$dirs" ]; then
    # shellcheck disable=SC2086 # $dirs is a list of fixed names
    # --no-wildcards: the skip list holds exact names; a name with [ or * is no pattern.
    ( cd "$WORK" && tar -c --no-wildcards -X "$skip" -f - $dirs ) | ( cd "$LOCAL" && tar -xf - )
    copy_ok bulk "${PIPESTATUS[@]}" || { rm -f "$skip"; return 1; }
  fi
  rm -f "$skip"; return 0
}

# Serialize the persist step (lock-or-skip): concurrent sessions share $LOCAL,
# and two persists over one clone would race. mkdir is atomic; stale locks
# (crashed persist) expire by TTL.
acquire_lock() {
  mkdir "$LOCK" 2>/dev/null && return 0
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin "+$LOCK_TTL_MIN" 2>/dev/null)" ]; then
    rm -rf "$LOCK" 2>/dev/null
    if mkdir "$LOCK" 2>/dev/null; then
      say "stole a stale persist lock (>${LOCK_TTL_MIN}m — crashed persist)."
      logev warn work_backup "stale persist lock stolen"; return 0
    fi
  fi
  return 1
}
release_lock() { rm -rf "$LOCK" 2>/dev/null || true; }

persist() {
  local rc
  if ! acquire_lock; then
    say "another persist is running — skipping; state stays on work/ and the next run backs it up."
    logev info work_backup "persist skipped — concurrent persist holds the lock"
    return 0
  fi
  do_persist; rc=$?
  release_lock
  return "$rc"
}

# The state first, then the bulk set: a bulk set that fails never blocks the state.
# One final outcome per persist — the line the audit and the monitor read:
#   info  "backup ok: …"      every part pushed or had nothing new
#   warn  "backup ok: …"      the bulk set was skipped (too large for the clone)
#   error "backup failed: …"  a part failed after its retries
do_persist() {
  local state bulk
  push_part state sync_state . ':(exclude)output' ':(exclude)logs'; state="$PART"
  push_part bulk sync_bulk output logs; bulk="$PART"
  local summary="state $state, bulk $bulk"
  case "$state $bulk" in
    (*failed*)  say "backup failed: $summary."; logev error work_backup "backup failed: $summary — retry next run" ;;
    (*skipped*) logev warn work_backup "backup ok: $summary (output/ and logs/ too large for the clone)" ;;
    (*)         logev info work_backup "backup ok: $summary" ;;
  esac
  return 0
}

# push_part <label> <sync function> <pathspec...>: commit and push one part of work/,
# re-seeding from the remote tip on a rejected push. Sets PART to pushed, unchanged,
# skipped or failed.
PART=""
push_part() {
  local label="$1" sync="$2" attempt=0 rc; shift 2
  while [ "$attempt" -lt "$RETRIES" ]; do
    attempt=$((attempt + 1))
    seed_clone || { logev warn work_backup "$label: seed failed (attempt $attempt)"; continue; }
    "$sync"; rc=$?
    if [ "$rc" -eq 43 ]; then PART=skipped; return 0; fi   # skipped, and said why
    [ "$rc" -eq 0 ] || { logev warn work_backup "$label: sync failed (attempt $attempt)"; continue; }
    ( cd "$LOCAL" || exit 1
      # A path neither in work/ nor in the backup is no pathspec git accepts: leave it out.
      paths=(); for p in "$@"; do
        case "$p" in (.|:*) paths+=("$p"); continue;; esac
        { [ -e "$p" ] || git ls-files --error-unmatch -- "$p" >/dev/null 2>&1; } && paths+=("$p")
      done
      [ "${#paths[@]}" -gt 0 ] || exit 42
      git reset -q 2>/dev/null || true   # an index left by an earlier failed part stays out of this one
      git add -A -- "${paths[@]}" || exit 3
      if git diff --cached --quiet; then exit 42; fi   # nothing to persist
      git commit -q -m "chore(work): persist $label $(date -u +%Y-%m-%dT%H:%M:%SZ)" || exit 3
    ); rc=$?
    if [ "$rc" -eq 42 ]; then say "$label: nothing to persist."; PART=unchanged; return 0; fi
    if [ "$rc" -ne 0 ]; then logev warn work_backup "$label: commit failed (attempt $attempt)"; continue; fi
    if ( cd "$LOCAL" && git push -q origin "HEAD:$BRANCH" 2>/dev/null ); then
      say "$label: pushed (attempt $attempt)."; logev info work_backup "$label: pushed (attempt $attempt)"; PART=pushed
      # --depth 1 limits what is fetched; gc drops the blobs this clone committed before.
      ( cd "$LOCAL" && git gc -q --prune=now 2>/dev/null ) || true
      return 0
    fi
    say "$label: push rejected (attempt $attempt) — re-seeding from remote tip."
    logev warn work_backup "$label: push rejected (attempt $attempt) — retrying"
  done
  say "$label: failed after $RETRIES attempt(s); the data is safe on work/, retry next run."
  logev warn work_backup "$label: failed after $RETRIES attempts"
  PART=failed; return 0
}

restore() {
  seed_clone || { say "restore: could not reach remote — leaving work/ as-is."; logev warn work_backup "restore: remote unreachable"; return 0; }
  # copy data into work/ — never .git. Targets a machine with no state yet;
  # existing files
  # with the same names are overwritten, nothing is deleted.
  if ( cd "$LOCAL" && git rev-parse HEAD >/dev/null 2>&1 ); then
    ( cd "$LOCAL" && tar -c --exclude='./.git' --exclude='./desk/.agent-token' -f - . ) | ( cd "$WORK" && tar -xf - )
    if copy_ok restore "${PIPESTATUS[@]}"; then say "restored work/ from remote."; logev info work_backup "restored work/ from remote"
    else say "restore copy failed."; fi
  else
    say "remote is empty — nothing to restore."
  fi
  return 0
}

mkdir -p "$WORK" 2>/dev/null || true
case "$MODE" in
  persist) persist ;;
  restore) restore ;;
  *) say "unknown mode '$MODE' (use persist|restore)"; exit 0 ;;
esac
