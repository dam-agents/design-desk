#!/usr/bin/env bash
# proto.sh — the mechanics of a live prototype (docs/prototype.md).
#
#   proto.sh worktree C-<n> <repo> [slug]   a worktree of the repo's default branch on the
#                                           branch design-desk/c<n>-<slug>; reused when it exists
#   proto.sh run C-<n> <verb>               the profile's bin/env <verb> (up|update|status|
#                                           credentials|tunnel|untunnel|down) with the engine variables
#   proto.sh remove C-<n>                   the worktree and its local branch (never a pushed one)
#   proto.sh show C-<n>                     what this card's prototype has on disk
#
# State per card in work/prototypes/c<n>/: meta.json (repo, worktree, branch, base,
# profile dir) and the engine's logs. Prints JSON; exit 1 on an error it names.
set -u
export LC_ALL=C
HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_JOB="${LOG_JOB:-prototype}"
. "$SCRIPT_DIR/log.sh" 2>/dev/null || logev() { :; }
err() { jq -cn --arg e "$1" '{error:$e}'; exit 1; }

cmd="${1:-}"; card="${2:-}"
case "$card" in C-[0-9]*) n="${card#C-}";; *) err "a card id like C-12 is required";; esac
case "$n" in *[!0-9]*) err "a card id like C-12 is required";; esac
STATE="$WORK/prototypes/c$n"; META="$STATE/meta.json"
mkdir -p "$STATE"

case "$cmd" in
  worktree)
    repo="${3:-}"; [ -n "$repo" ] || err "usage: proto.sh worktree C-<n> <repo> [slug]"
    if [ -f "$META" ] && [ -d "$(jq -r .worktree "$META")" ]; then cat "$META"; exit 0; fi
    co="$(bash "$SCRIPT_DIR/checkout.sh" "$repo")" || { printf '%s\n' "$co"; exit 1; }
    clone="$(jq -r .dir <<<"$co")"; def="$(jq -r .default_branch <<<"$co")"; base="$(jq -r .head <<<"$co")"
    slug="$(printf '%s' "${4:-change}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' | cut -c1-32)"
    branch="design-desk/c$n-${slug:-change}"
    wt="$HOME_DIR/checkouts/proto-c$n"
    git -C "$clone" worktree add -q -B "$branch" "$wt" "origin/$def" 2>/dev/null || err "git worktree add failed for $branch"
    prof="$(cd "$HOME_DIR" && node "$HOME_DIR/toolkit/bin/design.mjs" profile "$repo" --clone "$clone" 2>/dev/null | jq -r '.dir // empty')"
    jq -n --arg repo "$repo" --arg wt "$wt" --arg branch "$branch" --arg base "$base" --arg def "$def" --arg clone "$clone" --arg prof "$prof" \
      '{repo:$repo, worktree:$wt, branch:$branch, base:$base, default_branch:$def, clone:$clone, profile_dir:$prof}' > "$META"
    logev info prototype "$card worktree $branch"
    cat "$META";;
  run)
    verb="${3:-}"; case "$verb" in up|update|status|credentials|tunnel|untunnel|down) ;; *) err "verb must be up, update, status, credentials, tunnel, untunnel or down";; esac
    [ -f "$META" ] || err "no worktree for $card yet — proto.sh worktree first"
    prof="$(jq -r .profile_dir "$META")"
    [ -n "$prof" ] && [ -f "$prof/bin/env" ] || err "the product's profile has no bin/env, so it gets no live prototype (docs/profile.md)"
    # The profile's engine is read from the default branch (the clone), never the worktree.
    export PROTO_NAME="c$n" PROTO_WORKTREE="$(jq -r .worktree "$META")" PROTO_BASE="$(jq -r .base "$META")" PROTO_PROFILE_DIR="$prof" PROTO_STATE="$STATE"
    case "$verb" in
      status|credentials|tunnel|untunnel) bash "$prof/bin/env" "$verb";;
      *) logev info prototype "$card $verb start"
         if bash "$prof/bin/env" "$verb" 2>&1 | tee -a "$STATE/env-$verb.log"; then logev info prototype "$card $verb done"
         else logev error prototype "$card $verb failed — $STATE/env-$verb.log"; exit 1; fi;;
    esac;;
  remove)
    [ -f "$META" ] || { echo '{"removed":false,"reason":"nothing on disk"}'; exit 0; }
    clone="$(jq -r .clone "$META")"; wt="$(jq -r .worktree "$META")"; branch="$(jq -r .branch "$META")"
    git -C "$clone" worktree remove --force "$wt" 2>/dev/null || true
    git -C "$clone" branch -D "$branch" >/dev/null 2>&1 || true
    mv "$META" "$STATE/meta.removed.json"
    logev info prototype "$card removed $branch"
    jq -cn --arg b "$branch" '{removed:true, branch:$b}';;
  show) [ -f "$META" ] && cat "$META" || echo '{}';;
  *) err "usage: proto.sh worktree|run|remove|show C-<n> …";;
esac
