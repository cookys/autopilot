# shellcheck shell=bash
# dispatch-branch-ledger.sh — sourceable; appends one branch->session row when a rail creates a dispatch branch.
#
# Row (one JSON line) in <git-common-dir>/autopilot/dispatch-branches.jsonl:
#   {schema:"autopilot.dispatch-branch/1", branch, session_id, run_id, root_run_id, created_at (epoch), base_sha}
# session_id = $CLAUDE_CODE_SESSION_ID when set, else null. AUTOPILOT_SESSION_ID is deliberately NOT read:
# dispatch envs must not carry it. Consumer: `repo-residue-sweep.js close-session` (ownership follows run ids,
# because a foreman's hands run in a child Claude session with a different session id); `reap --auto`
# compacts the file under the same lock.
#
# dispatch_branch_ledger_append <git-common-dir> <branch> <run_id> <root_run_id> <base_sha>
#   Appends under `flock -x` on <ledger>.lock. FAIL-OPEN: any failure prints one stderr line and returns 0 —
#   the ledger never fails a dispatch. Requires json_escape (lib/json-emit.sh) to be sourced first.
#
# Double-source is a no-op.

[ -n "${_AUTOPILOT_DISPATCH_BRANCH_LEDGER_SH:-}" ] && return 0
_AUTOPILOT_DISPATCH_BRANCH_LEDGER_SH=1

dispatch_branch_ledger_append() {
  local common="${1:-}" branch="${2:-}" run_id="${3:-}" root_run_id="${4:-}" base_sha="${5:-}"
  local sid="${CLAUDE_CODE_SESSION_ID:-}" sid_json row dir
  if [ -z "$common" ] || [ -z "$branch" ]; then
    printf 'dispatch-branch-ledger: skipped (no common dir or branch)\n' >&2
    return 0
  fi
  if [ -n "$sid" ]; then sid_json="\"$(json_escape "$sid")\""; else sid_json="null"; fi
  row="{\"schema\":\"autopilot.dispatch-branch/1\",\"branch\":\"$(json_escape "$branch")\",\"session_id\":${sid_json},\"run_id\":\"$(json_escape "$run_id")\",\"root_run_id\":\"$(json_escape "$root_run_id")\",\"created_at\":$(date +%s),\"base_sha\":\"$(json_escape "$base_sha")\"}"
  dir="$common/autopilot"
  # The subshell owns fd 9, so the lock is released when it exits; a failure inside never aborts the caller (set -e safe).
  if ! (
    mkdir -p -- "$dir" || exit 1
    exec 9>>"$dir/dispatch-branches.jsonl.lock" || exit 1
    flock -x -w 10 9 || exit 1
    printf '%s\n' "$row" >> "$dir/dispatch-branches.jsonl" || exit 1
  ) 2>/dev/null; then
    printf 'dispatch-branch-ledger: append failed for %s (ledger unchanged)\n' "$branch" >&2
  fi
  return 0
}
