# hooks/tests/lib/suite-oracle-lock.sh — action-keyed mutual-exclusion lock
# for the "full parallel suite" run action of hooks/tests/run.sh.
#
# Backlog: "Depth-0's exclusive ownership of the execution oracle is prose,
# not a lock" (docs/BACKLOG.md). During v2.34.39 a returned foreman armed its
# own full-suite run while depth-0 was already running one; the two runs
# shared /tmp state and every result in that window was uninterpretable.
# Worse, the orphans' waiters were `pgrep` loops keyed on the COMMAND NAME,
# so a waiter could not tell depth-0's process from the implementer's.
#
# Fix shape (from the backlog entry): a lock keyed on the ACTION — one
# well-known lock path per ${TMPDIR}, not one per runner/PID — so any second
# concurrent "full parallel suite" invocation collides with the first one
# regardless of which process (foreman, depth-0, a stray retry) started it.
# Waiters are told the holder's RUN IDENTITY (a stamped run_id), never a
# process/command name — a pgreps' match-by-name is exactly the mechanism
# that misattributed depth-0's result to the implementer in the incident.
#
# This is a REFUSAL lock, not a queue: `suite_oracle_lock_acquire` never
# blocks. A held lock is reported and the caller must exit fast — waiting
# would only reproduce the original bug's window under a different name.
#
# Distinct from suite-residue-reap.sh's `suite_run_lock_acquire`: that lock
# is per-PID (`.autopilot-suite-run.$$.lock`) and exists purely so the
# residue reaper can enumerate "any other suite run live right now" — it was
# never a mutex and multiple suite runs are expected to hold their own copies
# of it concurrently. This lock is the opposite: exactly one holder at a
# time, system-wide per ${TMPDIR}.
#
# Lock-hardening conventions reused from scripts/lib/worktree-reap.sh's
# `_wt_open_lock_fd` (must be sourced first by the caller): reject symlinks,
# non-regular files, and foreign ownership before ever calling flock, and
# verify the fd truly points at the path we opened (open-then-flock
# publication window: a hostile or reused path swapped in between open() and
# flock() must not be trusted). See that file's header for the incident this
# defends against.
#
# Staleness: unlike the residue reaper's age-gated "is this safe to delete"
# judgement (AUTOPILOT_SUITE_REAP_MIN_AGE — that guards a DESTRUCTIVE rm -rf,
# where a false "dead" verdict is catastrophic), a flock has no equivalent
# false-positive risk here: the kernel releases it the instant the holder's
# fd closes, whether the process exited cleanly, was SIGKILLed, or crashed.
# So "the holder died without releasing" cannot happen — flock -n on a lock
# whose holder is gone succeeds immediately, no age threshold needed. What
# CAN go stale is the sidecar `.owner` file (leftover content is only ever
# read for a human-facing message, and only while the flock itself proves a
# CURRENT holder — see suite_oracle_lock_acquire's refusal branch).
#
# Contract:
#   suite_oracle_lock_acquire  — 0 acquired; 1 refused (another run holds
#                                 it — message printed to stderr naming the
#                                 holder's run id); 2 unsupported (best-effort
#                                 fail-open with a WARN, caller is not
#                                 blocked). AUTOPILOT_SUITE_ORACLE_LOCK=0
#                                 short-circuits to 0 without touching the
#                                 filesystem (opt-out).
#   suite_oracle_lock_release  — best-effort; always returns 0.

[ -n "${_AUTOPILOT_SUITE_ORACLE_LOCK_SH:-}" ] && return 0
_AUTOPILOT_SUITE_ORACLE_LOCK_SH=1

SUITE_ORACLE_LOCK_FD=""
SUITE_ORACLE_LOCK_PATH=""
SUITE_ORACLE_LOCK_OWNER_PATH=""
SUITE_ORACLE_LOCK_RUN_ID=""
# SUITE_ORACLE_LOCK_REFUSAL_MSG — set on a return-1 refusal to the exact
# message also printed to stderr, so callers/tests can assert on it without
# scraping stderr.
SUITE_ORACLE_LOCK_REFUSAL_MSG=""

# _sol_run_id — the identity this run will publish if it becomes the holder.
# AUTOPILOT_SUITE_ORACLE_RUN_ID lets a caller (or a test) pin a deterministic
# value; otherwise derive one from host+pid+start-time, which is unique
# enough for a same-host lock and never a bare command name.
_sol_run_id() {
  if [ -n "${AUTOPILOT_SUITE_ORACLE_RUN_ID:-}" ]; then
    printf '%s' "$AUTOPILOT_SUITE_ORACLE_RUN_ID"
    return 0
  fi
  local host
  host="$(hostname -s 2>/dev/null || hostname 2>/dev/null || printf 'host')"
  printf '%s-%s-%s' "$host" "$$" "$(date +%s)"
}

# suite_oracle_lock_acquire — see contract above.
suite_oracle_lock_acquire() {
  SUITE_ORACLE_LOCK_REFUSAL_MSG=""
  if [ "${AUTOPILOT_SUITE_ORACLE_LOCK:-1}" = "0" ]; then
    return 0
  fi
  if ! command -v _wt_open_lock_fd >/dev/null 2>&1; then
    echo "oracle-lock: WARN _wt_open_lock_fd unavailable (worktree-reap.sh not sourced) — running unguarded" >&2
    return 2
  fi
  local tmp
  tmp="$(realpath -e "${TMPDIR:-/tmp}" 2>/dev/null)" || tmp="${TMPDIR:-/tmp}"
  if [ ! -d "$tmp" ]; then
    echo "oracle-lock: WARN ${TMPDIR:-/tmp} not a directory — running unguarded" >&2
    return 2
  fi
  local lock="$tmp/.autopilot-suite-oracle.lock"
  local owner="$tmp/.autopilot-suite-oracle.owner"

  _wt_open_lock_fd "$lock" || {
    echo "oracle-lock: WARN could not open lock file $lock — running unguarded" >&2
    return 2
  }
  local fd="$_WT_SAFE_LOCK_FD"
  if flock -n "$fd" 2>/dev/null; then
    local run_id
    run_id="$(_sol_run_id)"
    # Publish holder identity ATOMICALLY (write-then-rename into the same
    # dir) so a concurrent reader of $owner (below, in the refusal branch)
    # never observes a partial write — the same publication-window lesson
    # `_wt_open_lock_fd`'s header documents for the lock file itself.
    local owner_tmp="$owner.$$.tmp"
    {
      printf 'run_id=%s\n' "$run_id"
      printf 'pid=%s\n' "$$"
      printf 'acquired_at=%s\n' "$(date +%s)"
    } > "$owner_tmp" 2>/dev/null && mv -f "$owner_tmp" "$owner" 2>/dev/null
    rm -f -- "$owner_tmp" 2>/dev/null || true
    SUITE_ORACLE_LOCK_FD="$fd"
    SUITE_ORACLE_LOCK_PATH="$lock"
    SUITE_ORACLE_LOCK_OWNER_PATH="$owner"
    SUITE_ORACLE_LOCK_RUN_ID="$run_id"
    return 0
  fi

  # Refused: another run holds the action-level lock right now. Report the
  # holder's RUN IDENTITY, not a command/process name — the whole point of
  # this fix is that a pgrep-by-command-name waiter cannot tell two
  # `hooks/tests/run.sh --parallel` invocations apart, and misattributed one
  # run's result to the other in the incident this closes.
  { exec {fd}>&-; } 2>/dev/null || true
  local holder_run_id="unknown" holder_pid="unknown" holder_since="unknown"
  if [ -f "$owner" ] && [ ! -L "$owner" ]; then
    holder_run_id="$(sed -n 's/^run_id=//p' "$owner" 2>/dev/null | head -1)"
    holder_pid="$(sed -n 's/^pid=//p' "$owner" 2>/dev/null | head -1)"
    holder_since="$(sed -n 's/^acquired_at=//p' "$owner" 2>/dev/null | head -1)"
    [ -n "$holder_run_id" ] || holder_run_id="unknown"
    [ -n "$holder_pid" ] || holder_pid="unknown"
    [ -n "$holder_since" ] || holder_since="unknown"
  fi
  SUITE_ORACLE_LOCK_REFUSAL_MSG="oracle-lock: REFUSED full-suite run — action lock held by run_id=${holder_run_id} pid=${holder_pid} since=${holder_since}. A second concurrent full-suite run would share /tmp state with the holder and corrupt both results (docs/BACKLOG.md: depth-0 execution-oracle exclusivity). Set AUTOPILOT_SUITE_ORACLE_LOCK=0 to bypass (unsafe — only for cases where you have independently verified no other full-suite run is live)."
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" >&2
  return 1
}

# suite_oracle_lock_release — best-effort; always returns 0. Leaves the lock
# and owner files behind (same convention as the residue-reap lock and the
# worktree lock: only the flock itself is released) so a fresh acquirer can
# reuse the same inode without a file-creation race.
suite_oracle_lock_release() {
  if [ -n "$SUITE_ORACLE_LOCK_FD" ]; then
    { exec {SUITE_ORACLE_LOCK_FD}>&-; } 2>/dev/null || true
  fi
  SUITE_ORACLE_LOCK_FD=""
  SUITE_ORACLE_LOCK_PATH=""
  SUITE_ORACLE_LOCK_OWNER_PATH=""
  SUITE_ORACLE_LOCK_RUN_ID=""
  return 0
}
