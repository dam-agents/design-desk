#!/usr/bin/env bash
# checkout.sh <[host/]owner/name> — the agent's clone of a product repository, fetched fresh.
# One clone per repository under ~/checkouts (outside work/: it is rebuilt when missing,
# never backed up). Blobs load on demand, so a big monorepo costs little until read.
# Concurrent calls take turns (a lock beside the clone) and share a fetch younger than 2 minutes.
# Prints {"dir", "default_branch", "head", "repo"} on stdout; exit 1 with {"error"} when
# the clone or the fetch failed (a private repository needs the GitHub connection).
set -u
repo="${1:-}"
[ -n "$repo" ] || { echo '{"error":"usage: checkout.sh <[host/]owner/name>"}'; exit 1; }
case "$repo" in */*/*) host="${repo%%/*}"; slug="${repo#*/}";; *) host=github.com; slug="$repo";; esac
dir="${HOME:-/home/agent}/checkouts/$(printf '%s' "$repo" | tr '/' '_')"
gh auth setup-git >/dev/null 2>&1 || true
err() { jq -cn --arg e "$1" --arg r "$repo" '{error:$e, repo:$r}'; exit 1; }
# Units of one worklist run at once and share this clone: one of them clones, fetches and
# moves HEAD at a time. A lock older than 5 minutes is a dead run's and is taken; after 60 s
# of waiting the run goes on without it, as before the lock was there.
lock="$dir.lock"; mkdir -p "$(dirname "$dir")"; waited=0; held=0
while [ "$waited" -lt 60 ]; do
  if mkdir "$lock" 2>/dev/null; then held=1; break; fi
  age=$(( $(date +%s) - $(stat -c %Y "$lock" 2>/dev/null || stat -f %m "$lock" 2>/dev/null || date +%s) ))  # GNU, then BSD
  [ "$age" -gt 300 ] && { rmdir "$lock" 2>/dev/null; continue; }
  sleep 2; waited=$((waited + 2))
done
[ "$held" = 1 ] && trap 'rmdir "$lock" 2>/dev/null' EXIT
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$(dirname "$dir")"
  errf="$(mktemp "${TMPDIR:-/tmp}/design-desk-clone.XXXXXX")" || err "cannot make a temporary file"
  git clone -q --filter=blob:none "https://$host/$slug.git" "$dir" 2>"$errf" \
    || { e="$(tail -1 "$errf")"; rm -f "$errf"; err "clone failed: $e"; }
  rm -f "$errf"
fi
# Pushes from this clone and its prototype worktrees go through the agent's own hook.
git -C "$dir" config core.hooksPath "${HOME:-/home/agent}/scripts/git-hooks"
git -C "$dir" remote set-head origin --auto >/dev/null 2>&1 || true
# A fetch another unit finished in the last 2 minutes is fresh enough: one fetch serves them all.
# The marker is this script's own, written only after this fetch of origin: any other fetch in
# the clone (a pull request's head) leaves it alone and cannot make an old default branch look fresh.
mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
marker="$dir/.git/design-desk-fetched"
if [ $(( $(date +%s) - $(mtime "$marker") )) -ge 120 ]; then
  git -C "$dir" fetch -q --prune origin 2>/dev/null || err "fetch failed"
  : > "$marker"
fi
def="$(git -C "$dir" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
def="${def:-main}"
# The checkout itself follows the default branch; prototype work happens in worktrees.
git -C "$dir" checkout -q --detach "origin/$def" 2>/dev/null || err "checkout of origin/$def failed"
jq -cn --arg d "$dir" --arg b "$def" --arg h "$(git -C "$dir" rev-parse HEAD)" --arg r "$repo" '{dir:$d, default_branch:$b, head:$h, repo:$r}'
