#!/usr/bin/env bash
# pr.sh — what the scripts check about a product's pull request before they run its code.
# Sourced by proto.sh and screens.sh.
#
# pr_same_repo <[host/]owner/name> <n>: exit 0 only when the pull request's head branch
# lives in the repository itself. A fork's head (or one whose repository is gone, or a
# read that failed) exits 1: its code never gets a prototype branch, which is pushed
# upstream where `on: push` workflows run it with the repository's secrets, and never a
# screens instance (docs/requests.md → Adjusting a developer's UI).
pr_same_repo() {
  local repo="$1" n="$2" slug got head base
  local hostargs=()
  case "$repo" in */*/*) slug="${repo#*/}"; hostargs=(--hostname "${repo%%/*}");; *) slug="$repo";; esac
  case "$n" in ''|*[!0-9]*) return 1;; esac
  got="$(gh api ${hostargs[@]+"${hostargs[@]}"} "repos/$slug/pulls/$n" \
    --jq '[.head.repo.full_name // "", .base.repo.full_name // ""] | @tsv' 2>/dev/null)" || return 1
  head="$(printf '%s' "${got%%$'\t'*}" | tr 'A-Z' 'a-z')"; base="$(printf '%s' "${got#*$'\t'}" | tr 'A-Z' 'a-z')"
  [ -n "$head" ] && [ "$head" = "$base" ]
}
