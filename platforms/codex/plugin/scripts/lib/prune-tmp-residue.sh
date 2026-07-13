# prune-tmp-residue.sh — sourceable startup retention prune for the dispatch
# scripts' own ${TMPDIR} residue (logs, prompt temps, scratch cwds, pi sessions).
#
# Why: dispatch-review/author/explore/hetero mktemp their raw logs and scratch
# into ${TMPDIR} with NO retention; on a long-lived machine that accumulated
# 1910 dispatch-review-log-* + 616 hetero fixture logs + 126 pi-rpc-session-*
# and exhausted the /tmp per-user quota (usrquota), which silently broke every
# harness Bash call on the host (2026-07-13 incident). Each dispatch script now
# best-effort prunes ITS OWN aged residue at startup.
#
# Contract:
#   prune_tmp_residue <days> <pattern>...
#     - deletes items directly under ${TMPDIR:-/tmp} (-maxdepth 1) owned by the
#       CURRENT user, matching <pattern>, with mtime older than <days> days
#     - <days> 0 / non-numeric => disabled no-op (callers pass
#       ${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}; 0 is the operator kill-switch)
#     - patterns are fixed caller-side prefixes; a pattern containing '/' or
#       starting with '.' is refused (path-traversal / dotfile guard)
#     - ALWAYS returns 0 and stays silent: a prune failure must never break or
#       noise up a dispatch (this runs before arg parsing on every invocation)
#
# Scope guard: this prunes LOGS AND SCRATCH ONLY — never pass a worktree
# pattern (e.g. hetero-<branch>-XXXXXX). Worktrees have a lock/marker-aware
# reaper (lib/worktree-reap.sh gc_stale_worktrees, dispatch-status.js --reap);
# blind mtime pruning them would race a live run.

prune_tmp_residue() {
  local days="${1:-}"
  shift 2>/dev/null || return 0
  case "$days" in ''|*[!0-9]*) return 0 ;; esac
  [ "$days" -gt 0 ] 2>/dev/null || return 0
  local tmp="${TMPDIR:-/tmp}"
  [ -d "$tmp" ] || return 0
  local me pat
  me="$(id -un 2>/dev/null)" || return 0
  for pat in "$@"; do
    case "$pat" in
      ''|*/*|.*) continue ;;
    esac
    # Marker guard (gpt-5.5 R3 Major): a worktree dir ALWAYS carries the
    # .autopilot-worktree marker, and a branch name containing "log" makes the
    # worktree name (hetero-<branch>-XXXXXX) collide with the hetero log
    # pattern (hetero-*-log-*). A marked dir is NEVER blind-mtime-pruned here,
    # no matter what pattern matched — worktree reaping stays lock/marker-gated
    # in worktree-reap.sh / dispatch-status.js --reap.
    find "$tmp" -maxdepth 1 -user "$me" -name "$pat" -mtime "+$days" \
      \( -type f -o -type d \) -print0 2>/dev/null |
      while IFS= read -r -d '' _pr_item; do
        [ -e "$_pr_item/.autopilot-worktree" ] && continue
        rm -rf -- "$_pr_item" 2>/dev/null
      done
  done
  return 0
}
