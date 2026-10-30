#!/usr/bin/env bash
# checkout.sh <[host/]owner/name> — the agent's clone of a product repository, fetched fresh.
# One clone per repository under ~/checkouts (outside work/: it is rebuilt when missing,
# never backed up). Blobs load on demand, so a big monorepo costs little until read.
# Prints {"dir", "default_branch", "head", "repo"} on stdout; exit 1 with {"error"} when
# the clone or the fetch failed (a private repository needs the GitHub connection).
set -u
repo="${1:-}"
[ -n "$repo" ] || { echo '{"error":"usage: checkout.sh <[host/]owner/name>"}'; exit 1; }
case "$repo" in */*/*) host="${repo%%/*}"; slug="${repo#*/}";; *) host=github.com; slug="$repo";; esac
dir="${HOME:-/home/agent}/checkouts/$(printf '%s' "$repo" | tr '/' '_')"
gh auth setup-git >/dev/null 2>&1 || true
err() { jq -cn --arg e "$1" --arg r "$repo" '{error:$e, repo:$r}'; exit 1; }
if [ ! -d "$dir/.git" ]; then
  mkdir -p "$(dirname "$dir")"
  git clone -q --filter=blob:none "https://$host/$slug.git" "$dir" 2>/tmp/design-desk-clone.$$ \
    || { e="$(tail -1 /tmp/design-desk-clone.$$)"; rm -f /tmp/design-desk-clone.$$; err "clone failed: $e"; }
  rm -f /tmp/design-desk-clone.$$
fi
# Pushes from this clone and its prototype worktrees go through the agent's own hook.
git -C "$dir" config core.hooksPath "${HOME:-/home/agent}/scripts/git-hooks"
git -C "$dir" remote set-head origin --auto >/dev/null 2>&1 || true
git -C "$dir" fetch -q --prune origin 2>/dev/null || err "fetch failed"
def="$(git -C "$dir" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
def="${def:-main}"
# The checkout itself follows the default branch; prototype work happens in worktrees.
git -C "$dir" checkout -q --detach "origin/$def" 2>/dev/null || err "checkout of origin/$def failed"
jq -cn --arg d "$dir" --arg b "$def" --arg h "$(git -C "$dir" rev-parse HEAD)" --arg r "$repo" '{dir:$d, default_branch:$b, head:$h, repo:$r}'
