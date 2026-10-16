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
#     - deletes items directly under ${TMPDIR:-/tmp} owned by the CURRENT user whose
#       name matches a registry entry of kind scratch|evidence
#       (scripts/lib/tmp-residue-registry.json), with mtime older than max(<days>, the
#       entry's own retention); symlinks, dirs holding .autopilot-live.lock or an
#       .autopilot-worktree marker, and dirs whose .autopilot-owner pid is alive are kept
#     - <days> 0 / non-numeric => disabled no-op (callers pass
#       ${AUTOPILOT_TMP_LOG_RETENTION_DAYS:-3}; 0 is the operator kill-switch)
#     - the registry is the only source of patterns: every call prunes all of its
#       scratch/evidence entries. A caller-passed pattern is honoured only if it
#       equals one of them (so it adds nothing); any other is dropped, as is one
#       containing '/' or starting with '.'. Live, lock, worktree and test-lockgated
#       kinds are never age-deleted.
#     - the work is done by scripts/lib/tmp-residue.js prune (Node); no node => no-op
#     - ALWAYS returns 0 and stays silent: a prune failure must never break or
#       noise up a dispatch (this runs before arg parsing on every invocation)
#
# Scope guard: this prunes LOGS AND SCRATCH ONLY — never pass a worktree
# pattern (e.g. hetero-<branch>-XXXXXX). Worktrees have a lock/marker-aware
# reaper (repo-residue-sweep.js reap --auto, dispatch-status.js --reap);
# blind mtime pruning them would race a live run.
#

prune_tmp_residue() {
  local days="${1:-}"
  shift 2>/dev/null || return 0
  case "$days" in ''|*[!0-9]*) return 0 ;; esac
  [ "$days" -gt 0 ] 2>/dev/null || return 0
  [ -d "${TMPDIR:-/tmp}" ] || return 0
  local here cli
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || return 0
  cli="$here/tmp-residue.js"
  [ -f "$cli" ] || return 0
  command -v node >/dev/null 2>&1 || return 0
  # Caller patterns equal to a registry pattern are already pruned; the rest are dropped here.
  node "$cli" prune --days "$days" >/dev/null 2>&1 || true
  return 0
}
