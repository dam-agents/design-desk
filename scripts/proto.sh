#!/usr/bin/env bash
# proto.sh — the mechanics of a live prototype (docs/prototype.md).
#
#   proto.sh worktree R-<n> <repo> [slug] [--ref <ref>]
#                                           a worktree of the repo's default branch (or of <ref>:
#                                           pull/<n>/head of an open pull request that is not
#                                           from a fork, or a branch of the repo) on the
#                                           branch design-desk/<l><n>-<slug> (r12, c12); reused when it exists
#   proto.sh run R-<n> <verb>               the profile's bin/env <verb> (up|update|status|
#                                           credentials|tunnel|untunnel|down) with the engine variables
#   proto.sh remove R-<n>                   the worktree and its local branch (never a pushed one)
#   proto.sh show R-<n>                     what this card's prototype has on disk
#
# State per card in work/prototypes/<l><n>/: meta.json (repo, worktree, branch, base,
# profile dir) and the engine's logs. Prints JSON; exit 1 on an error it names.
set -u
export LC_ALL=C
HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_JOB="${LOG_JOB:-prototype}"
. "$SCRIPT_DIR/log.sh" 2>/dev/null || { logev() { :; }; logmask() { cat; }; }
. "$SCRIPT_DIR/lib/pr.sh"
err() { jq -cn --arg e "$1" '{error:$e}'; exit 1; }

cmd="${1:-}"; card="${2:-}"
# A card's number is its letter and its number (R-12; C-12 from before 1.78.0): the state, branch
# and Environment take it in lower case without the dash (r12, c12), so two kinds never share one.
case "$card" in [A-Z]-[0-9]*) n="${card#?-}"; l="$(printf '%s' "${card%%-*}" | tr 'A-Z' 'a-z')";; *) err "a card id like R-12 is required";; esac
case "$n" in *[!0-9]*) err "a card id like R-12 is required";; esac
n="$l$n"
STATE="$WORK/prototypes/$n"; META="$STATE/meta.json"
mkdir -p "$STATE"

case "$cmd" in
  worktree)
    repo="${3:-}"; [ -n "$repo" ] || err "usage: proto.sh worktree R-<n> <repo> [slug] [--ref <ref>]"
    ref=""; slugarg="${4:-}"; [ "$slugarg" = "--ref" ] && { ref="${5:-}"; slugarg=""; }; [ "${5:-}" = "--ref" ] && ref="${6:-}"
    if [ -f "$META" ] && [ -d "$(jq -r .worktree "$META")" ]; then cat "$META"; exit 0; fi
    case "$ref" in
      "") ;;
      pull/[0-9]*/head)
        pr="${ref#pull/}"; pr="${pr%/head}"
        case "$pr" in *[!0-9]*) err "--ref must be pull/<n>/head or a branch name";; esac
        pr_same_repo "$repo" "$pr" || err "pull request #$pr comes from a fork (or GitHub could not say where it comes from): its code gets no live prototype — adjust its design on sample data, or prototype from the default branch";;
      -*|*pull/*|*..*|*@\{*) err "--ref must be pull/<n>/head or a branch name";;
      *) printf '%s' "$ref" | grep -Eq '^[A-Za-z0-9_][A-Za-z0-9._/-]*$' && ! printf '%s' "$ref" | grep -Eq '^[0-9a-f]{40}$' \
           || err "--ref must be pull/<n>/head or a branch name";;
    esac
    co="$(bash "$SCRIPT_DIR/checkout.sh" "$repo")" || { printf '%s\n' "$co"; exit 1; }
    clone="$(jq -r .dir <<<"$co")"; def="$(jq -r .default_branch <<<"$co")"; base="$(jq -r .head <<<"$co")"
    slug="$(printf '%s' "${slugarg:-change}" | tr 'A-Z' 'a-z' | tr -c 'a-z0-9' '-' | sed 's/-\{2,\}/-/g; s/^-//; s/-$//' | cut -c1-32)"
    branch="design-desk/$n-${slug:-change}"
    wt="$HOME_DIR/checkouts/proto-$n"
    start="origin/$def"
    if [ -n "$ref" ]; then
      git -C "$clone" fetch -q -- origin "$ref" 2>/dev/null || err "cannot fetch $ref"
      start="$(git -C "$clone" rev-parse FETCH_HEAD)"; base="$start"
    fi
    git -C "$clone" worktree add -q -B "$branch" "$wt" "$start" 2>/dev/null || err "git worktree add failed for $branch"
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
    export PROTO_NAME="$n" PROTO_WORKTREE="$(jq -r .worktree "$META")" PROTO_BASE="$(jq -r .base "$META")" PROTO_PROFILE_DIR="$prof" PROTO_STATE="$STATE"
    case "$verb" in
      status|credentials|tunnel|untunnel) bash "$prof/bin/env" "$verb";;
      *) logev info prototype "$card $verb start"
         # The saved log is backed up with work/: masked like every log (scripts/log.sh).
         bash "$prof/bin/env" "$verb" 2>&1 | logmask | tee -a "$STATE/env-$verb.log"
         if [ "${PIPESTATUS[0]}" -eq 0 ]; then logev info prototype "$card $verb done"
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
  *) err "usage: proto.sh worktree|run|remove|show R-<n> …";;
esac
