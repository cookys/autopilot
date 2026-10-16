#!/usr/bin/env bash
# scripts/lib/worktree-intent.sh -- the one writer of worktree-creation intent records (BL-0082).
# Sourced by dispatch-hetero.sh and dispatch-foreman.sh. A rail publishes
#   <git-common-dir>/autopilot-worktree-creation/<run>.XXXXXX.json
# BEFORE `git worktree add`, so a worktree built but never registered (crash between the add and the
# marker/controller write) is discoverable: the shell reconciliation in dispatch-hetero.sh and the JS
# inventory (src/engine/controller-execution.js readWorktreeCreationIntents) both read this exact shape.
#
#   worktree_intent_write <common-dir> <root_run_id> <run_id> <loop_id> <branch> <base_sha> <planned_path>
#       sets WORKTREE_INTENT_RECORD to the published path; returns 1 (nothing published) on invalid ids or
#       any filesystem failure. Fail-closed: the caller must not create the worktree on a non-zero return.
#   worktree_intent_clear   removes WORKTREE_INTENT_RECORD (idempotent).
# Requires json_escape (lib/json-emit.sh) to be sourced first.

WORKTREE_INTENT_RECORD=""

worktree_intent_write() {
  local common="$1" root="$2" run="$3" loop="$4" branch="$5" base="$6" planned="$7"
  local dir="$common/autopilot-worktree-creation" tmp=""
  WORKTREE_INTENT_RECORD=""
  [[ "$root" =~ ^[A-Za-z0-9._-]+$ && "$run" =~ ^[A-Za-z0-9._-]+$ && "$loop" =~ ^[A-Za-z0-9._-]+$ ]] || return 1
  [[ "$base" =~ ^[0-9a-f]{40,64}$ && "$planned" == /* ]] || return 1
  git check-ref-format --branch "$branch" >/dev/null 2>&1 || return 1
  if [ -e "$dir" ] || [ -L "$dir" ]; then
    [ -d "$dir" ] && [ ! -L "$dir" ] && [ -O "$dir" ] || return 1
  else
    (umask 077; mkdir "$dir") || return 1
  fi
  tmp="$(mktemp "$dir/${run}.XXXXXX.tmp")" || return 1
  (umask 077; printf '{"schema":1,"root_run_id":"%s","run_id":"%s","loop_id":"%s","branch":"%s","base_sha":"%s","planned_path":"%s"}\n' \
    "$(json_escape "$root")" "$(json_escape "$run")" "$(json_escape "$loop")" \
    "$(json_escape "$branch")" "$base" "$(json_escape "$planned")" > "$tmp") \
    && mv -f -- "$tmp" "${tmp%.tmp}.json" || { rm -f -- "$tmp"; return 1; }
  WORKTREE_INTENT_RECORD="${tmp%.tmp}.json"
  return 0
}

worktree_intent_clear() {
  [ -n "${WORKTREE_INTENT_RECORD:-}" ] && rm -f -- "$WORKTREE_INTENT_RECORD"
  WORKTREE_INTENT_RECORD=""
  return 0
}
