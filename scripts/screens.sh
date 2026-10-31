#!/usr/bin/env bash
# screens.sh — the mechanics of a screens instance (docs/screens.md): the agent's own install
# of the product, for screenshots of what shipped and for people to try it.
#
#   screens.sh sync <repo> [--pr <n> | --at <sha>]
#                                       the instance `main` at the default branch's head (or at
#                                       <sha> of it: the commit before a merge, for "before"
#                                       pictures), or `pr<n>` at that pull request's head: its
#                                       worktree moved there and installed (bin/env up). A commit
#                                       already installed is never installed again, and main never
#                                       moves back. Prints its meta, with "moved": true|false.
#   screens.sh run <name> <verb>        bin/env status|credentials|tunnel|untunnel|down
#   screens.sh remove <name>            the worktree and the local state (delete the
#                                       Environment first: delete_environment <env>)
#   screens.sh show <name>              the instance's meta
#   screens.sh list                     every instance on disk
#
# Instances are named `main` (Environment `screens`) and `pr<n>` (Environment `screens-pr<n>`).
# One install at a time per instance: a lock next to its state; a second caller gets
# {"busy": true} and uses what is installed. Prints JSON; exit 1 on an error it names.
set -u
export LC_ALL=C
HOME_DIR="${HOME:-/home/agent}"
WORK="${WORK_DIR:-$HOME_DIR/work}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG_JOB="${LOG_JOB:-screens}"
. "$SCRIPT_DIR/log.sh" 2>/dev/null || logev() { :; }
err() { jq -cn --arg e "$1" '{error:$e}'; exit 1; }
ROOT="$WORK/screens"

# The Environment's name and the backchannel port; prototypes use 4500-4899.
env_of() { case "$1" in main) echo screens;; pr*) echo "screens-$1";; esac; }
port_of() { case "$1" in main) echo 4950;; pr*) n="${1#pr}"; echo $(( 4900 + n % 50 ));; esac; }
valid() { case "$1" in main) return 0;; pr[0-9]*) case "${1#pr}" in *[!0-9]*) return 1;; esac; return 0;; *) return 1;; esac; }

engine() { # name verb
  local meta="$ROOT/$1/meta.json" prof
  [ -f "$meta" ] || err "no instance $1 yet: screens.sh sync first"
  prof="$(jq -r .profile_dir "$meta")"
  [ -n "$prof" ] && [ -f "$prof/bin/env" ] || err "the product's profile has no bin/env, so it gets no screens instance (docs/profile.md)"
  export PROTO_NAME="$(env_of "$1")" PROTO_PORT="$(port_of "$1")" PROTO_WORKTREE="$(jq -r .worktree "$meta")" \
    PROTO_BASE="$(jq -r .commit "$meta")" PROTO_PROFILE_DIR="$prof" PROTO_STATE="$ROOT/$1"
  bash "$prof/bin/env" "$2"
}

cmd="${1:-}"
case "$cmd" in
  sync)
    repo="${2:-}"; [ -n "$repo" ] || err "usage: screens.sh sync <repo> [--pr <n>]"
    name=main; ref=""; at=""
    [ "${3:-}" = "--pr" ] && { case "${4:-}" in ''|*[!0-9]*) err "--pr needs a number";; esac; name="pr$4"; ref="pull/$4/head"; }
    [ "${3:-}" = "--at" ] && { case "${4:-}" in ''|*[!0-9a-f]*) err "--at needs a commit sha";; esac; at="$4"; }
    state="$ROOT/$name"; meta="$state/meta.json"; mkdir -p "$state"
    if ! mkdir "$state/.lock" 2>/dev/null; then
      if [ -n "$(find "$state/.lock" -maxdepth 0 -mmin +90 2>/dev/null)" ]; then rm -rf "$state/.lock"; mkdir "$state/.lock" 2>/dev/null || err "cannot take the lock of $name"
      else jq -cn --arg n "$name" '{busy: true, name: $n}'; [ -f "$meta" ] && cat "$meta"; exit 0; fi
    fi
    trap 'rm -rf "$state/.lock"' EXIT
    co="$(bash "$SCRIPT_DIR/checkout.sh" "$repo")" || { printf '%s\n' "$co"; exit 1; }
    clone="$(jq -r .dir <<<"$co")"; def="$(jq -r .default_branch <<<"$co")"
    if [ -n "$ref" ]; then git -C "$clone" fetch -q origin "$ref" 2>/dev/null || err "cannot fetch $ref"; target="$(git -C "$clone" rev-parse FETCH_HEAD)"
    else git -C "$clone" fetch -q origin "$def" 2>/dev/null || err "cannot fetch $def"; target="$(git -C "$clone" rev-parse "origin/$def")"; fi
    if [ -n "$at" ]; then
      target="$(git -C "$clone" rev-parse --verify -q "$at^{commit}")" || err "no commit $at"
      git -C "$clone" merge-base --is-ancestor "$target" "origin/$def" 2>/dev/null || err "$at is not on $def"
    fi
    wt="$HOME_DIR/checkouts/screens-$name"
    if [ ! -d "$wt" ]; then git -C "$clone" worktree add -q --detach "$wt" "$target" 2>/dev/null || err "git worktree add failed for $name"; fi
    # Never install the same commit twice, and never move main backwards.
    installed="$(jq -r '.commit // empty' "$meta" 2>/dev/null)"
    if [ "$installed" = "$target" ]; then jq '. + {moved: false}' "$meta"; exit 0; fi
    if [ "$name" = main ] && [ -n "$installed" ] && git -C "$clone" merge-base --is-ancestor "$target" "$installed" 2>/dev/null; then jq '. + {moved: false, ahead: true}' "$meta"; exit 0; fi
    git -C "$wt" checkout -q --detach "$target" 2>/dev/null || err "cannot move the worktree of $name to $target"
    prof="$(cd "$HOME_DIR" && node "$HOME_DIR/toolkit/bin/design.mjs" profile "$repo" --clone "$clone" 2>/dev/null | jq -r '.dir // empty')"
    jq -n --arg repo "$repo" --arg name "$name" --arg env "$(env_of "$name")" --arg wt "$wt" --arg clone "$clone" --arg prof "$prof" \
      --arg commit "$target" --arg ref "${ref:-$def}" --arg was "${installed:-}" \
      '{repo:$repo, name:$name, env:$env, worktree:$wt, clone:$clone, profile_dir:$prof, commit:$commit, ref:$ref, previous:$was, state:"installing"}' > "$meta.tmp" && mv "$meta.tmp" "$meta"
    logev info screens "$name install of ${target:0:7} start"
    if engine "$name" up >> "$state/env-up.log" 2>&1; then
      jq --arg at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" '.state = "installed" | .installed_at = $at' "$meta" > "$meta.tmp" && mv "$meta.tmp" "$meta"
      logev info screens "$name installed ${target:0:7}"
    else
      jq '.state = "failed"' "$meta" > "$meta.tmp" && mv "$meta.tmp" "$meta"
      logev error screens "$name install of ${target:0:7} failed — $state/env-up.log"
      cat "$meta"; exit 1
    fi
    jq '. + {moved: true}' "$meta";;
  run)
    name="${2:-}"; verb="${3:-}"; valid "$name" || err "an instance is main or pr<n>"
    case "$verb" in status|credentials|tunnel|untunnel|down) engine "$name" "$verb";; *) err "verb must be status, credentials, tunnel, untunnel or down";; esac;;
  remove)
    name="${2:-}"; valid "$name" || err "an instance is main or pr<n>"
    meta="$ROOT/$name/meta.json"
    [ -f "$meta" ] || { echo '{"removed":false,"reason":"nothing on disk"}'; exit 0; }
    engine "$name" down >/dev/null 2>&1 || true
    git -C "$(jq -r .clone "$meta")" worktree remove --force "$(jq -r .worktree "$meta")" 2>/dev/null || true
    rm -rf "$ROOT/$name"
    logev info screens "$name removed"
    jq -cn --arg n "$name" '{removed:true, name:$n}';;
  show) name="${2:-}"; valid "$name" || err "an instance is main or pr<n>"; [ -f "$ROOT/$name/meta.json" ] && cat "$ROOT/$name/meta.json" || echo '{}';;
  list) for m in "$ROOT"/*/meta.json; do [ -f "$m" ] && jq -c '{name, env, commit, state, installed_at}' "$m"; done | jq -s .;;
  *) err "usage: screens.sh sync|run|remove|show|list …";;
esac
