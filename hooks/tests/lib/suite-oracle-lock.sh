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
#   suite_oracle_lock_acquire  — 0 acquired; 1 REFUSED-CONTENTION (another
#                                 run holds it — message printed to stderr
#                                 naming the holder's run id, bounded-retried
#                                 if not yet published); 2 REFUSED-INFRA (an
#                                 open/mkdir/identity/publish step failed —
#                                 fail CLOSED, same as contention: the caller
#                                 must not proceed). Every non-zero return
#                                 sets SUITE_ORACLE_LOCK_REFUSAL_MSG and
#                                 prints it to stderr, naming
#                                 AUTOPILOT_SUITE_ORACLE_LOCK=0 as the one
#                                 explicit fail-OPEN bypass — there is no
#                                 other unguarded path (depth-0 ruling
#                                 2026-08-28, hetero review "sol": a
#                                 fail-open default on infra errors defeats
#                                 the lock's entire purpose whenever the
#                                 filesystem is even slightly hostile).
#                                 AUTOPILOT_SUITE_ORACLE_LOCK=0 short-circuits
#                                 to 0 before touching the filesystem at all.
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

# _sol_fd_identity_matches <fd> <path> — 0 if the still-open fd currently
# points at the same inode as <path> right now (via /proc or /dev fd
# aliasing, mirroring `_wt_open_lock_fd`'s own `-ef` idiom). Used AFTER
# flock succeeds (finding #4): `_wt_open_lock_fd` already proves this
# BEFORE the flock call, but flock -n itself has no atomicity guarantee
# with the open — a hostile or reused path swapped in during that narrow
# window must not be trusted just because flock() returned success on
# whatever fd number we happened to hold.
_sol_fd_identity_matches() {
  local fd="$1" path="$2" fd_path
  fd_path="/proc/$$/fd/$fd"
  [ -e "$fd_path" ] || fd_path="/dev/fd/$fd"
  [ -e "$fd_path" ] && [ -e "$path" ] && [ "$fd_path" -ef "$path" ]
}

# _sol_refuse_infra <fd|""> <message> — close fd (if given, releasing any
# flock it holds), set the refusal message (stderr + the var callers can
# assert on), and return 2 (REFUSED-INFRA — see contract). Every
# infrastructure-error exit funnels through here so the "name the bypass"
# requirement (depth-0 ruling, finding #3) can't drift between call sites.
_sol_refuse_infra() {
  local fd="$1" detail="$2"
  if [ -n "$fd" ]; then
    { exec {fd}>&-; } 2>/dev/null || true
  fi
  SUITE_ORACLE_LOCK_REFUSAL_MSG="oracle-lock: REFUSED full-suite run — ${detail}. Refusing to run un-mutex'd rather than fail open (docs/BACKLOG.md: depth-0 execution-oracle exclusivity). Set AUTOPILOT_SUITE_ORACLE_LOCK=0 to bypass (unsafe — only for cases where you have independently verified no other full-suite run is live)."
  echo "$SUITE_ORACLE_LOCK_REFUSAL_MSG" >&2
  return 2
}

# _sol_publish_owner <owner-path> <run_id> — securely, atomically publish
# holder identity. mktemp in the SAME directory (same filesystem — rename is
# atomic only then); refuses to rename over an existing symlink or
# foreign-owned target (finding #5) rather than following/clobbering it;
# echoes nothing — success is exit 0, failure is non-zero and the temp file
# is always cleaned up either way. Caller (suite_oracle_lock_acquire) treats
# ANY failure here as an acquisition failure, not just a publication
# blemish — an unpublished holder is indistinguishable from a malicious one
# to every future waiter's refusal message.
_sol_publish_owner() {
  local owner="$1" run_id="$2" dir owner_tmp
  dir="$(dirname -- "$owner")"
  if [ -e "$owner" ] && { [ -L "$owner" ] || [ ! -O "$owner" ]; }; then
    return 1
  fi
  owner_tmp="$(mktemp "$dir/.autopilot-suite-oracle.owner.XXXXXX" 2>/dev/null)" || return 1
  if ! {
    printf 'run_id=%s\n' "$run_id"
    printf 'pid=%s\n' "$$"
    printf 'acquired_at=%s\n' "$(date +%s)"
  } > "$owner_tmp" 2>/dev/null; then
    rm -f -- "$owner_tmp" 2>/dev/null || true
    return 1
  fi
  if ! mv -f -- "$owner_tmp" "$owner" 2>/dev/null; then
    rm -f -- "$owner_tmp" 2>/dev/null || true
    return 1
  fi
  return 0
}

# suite_oracle_lock_acquire — see contract above.
suite_oracle_lock_acquire() {
  SUITE_ORACLE_LOCK_REFUSAL_MSG=""
  if [ "${AUTOPILOT_SUITE_ORACLE_LOCK:-1}" = "0" ]; then
    return 0
  fi
  if ! command -v _wt_open_lock_fd >/dev/null 2>&1; then
    _sol_refuse_infra "" "_wt_open_lock_fd unavailable (worktree-reap.sh not sourced)"
    return $?
  fi
  local tmp
  tmp="$(realpath -e "${TMPDIR:-/tmp}" 2>/dev/null)" || tmp="${TMPDIR:-/tmp}"
  if [ ! -d "$tmp" ]; then
    _sol_refuse_infra "" "${TMPDIR:-/tmp} is not a directory"
    return $?
  fi
  local lock="$tmp/.autopilot-suite-oracle.lock"
  local owner="$tmp/.autopilot-suite-oracle.owner"

  # outcome: "acquired" | "contention" | "mismatch" — tracked explicitly so
  # the identity-mismatch retry (finding #4) can never be mistaken for plain
  # contention once the loop ends; each has a different, honest refusal.
  local attempt fd outcome=""
  for attempt in 1 2; do
    fd=""
    _wt_open_lock_fd "$lock" || {
      _sol_refuse_infra "" "could not open lock file $lock"
      return $?
    }
    fd="$_WT_SAFE_LOCK_FD"
    if ! flock -n "$fd" 2>/dev/null; then
      outcome="contention"
      break
    fi
    # Finding #4: re-verify identity AFTER flock, not just before it. A
    # mismatch here means the path was swapped between open() and the
    # (non-blocking, so near-instant) flock() call; retry the whole
    # open+flock once on a fresh fd before giving up.
    if _sol_fd_identity_matches "$fd" "$lock"; then
      outcome="acquired"
      break
    fi
    { exec {fd}>&-; } 2>/dev/null || true
    fd=""
    outcome="mismatch"
  done

  if [ "$outcome" = "mismatch" ]; then
    _sol_refuse_infra "" "lock identity unstable across retries (possible path swap on $lock)"
    return $?
  fi

  if [ "$outcome" = "acquired" ]; then
    local run_id
    run_id="$(_sol_run_id)"
    # Finding #5 / #3: publication failure IS acquisition failure — do not
    # report acquired (return 0) for a holder no refusal message can ever
    # correctly name. Release the flock (closing fd) before refusing.
    if ! _sol_publish_owner "$owner" "$run_id"; then
      _sol_refuse_infra "$fd" "could not publish holder identity to $owner"
      return $?
    fi
    SUITE_ORACLE_LOCK_FD="$fd"
    SUITE_ORACLE_LOCK_PATH="$lock"
    SUITE_ORACLE_LOCK_OWNER_PATH="$owner"
    SUITE_ORACLE_LOCK_RUN_ID="$run_id"
    return 0
  fi

  # Refused (contention): another run holds the action-level lock right
  # now. Report the holder's RUN IDENTITY, not a command/process name — the
  # whole point of this fix is that a pgrep-by-command-name waiter cannot
  # tell two `hooks/tests/run.sh --parallel` invocations apart, and
  # misattributed one run's result to the other in the incident this closes.
  [ -n "$fd" ] && { exec {fd}>&-; } 2>/dev/null || true
  # Finding #1 (publication race): the holder can win flock an instant
  # before it writes+renames $owner — a single synchronous read here would
  # either see nothing (first-ever acquisition) or, worse, STALE content
  # from a PRIOR holder (this lock leaves $owner behind on release, same as
  # the lock file itself). Bounded retry gives a normally-timed holder a
  # window to publish; if it still hasn't after 300ms, say so honestly
  # instead of guessing from a message that (by construction) never blocks
  # the caller for longer than this fixed, small budget.
  local holder_run_id="" holder_pid="" holder_since="" try
  for try in 1 2 3; do
    if [ -f "$owner" ] && [ ! -L "$owner" ]; then
      holder_run_id="$(sed -n 's/^run_id=//p' "$owner" 2>/dev/null | head -1)"
      holder_pid="$(sed -n 's/^pid=//p' "$owner" 2>/dev/null | head -1)"
      holder_since="$(sed -n 's/^acquired_at=//p' "$owner" 2>/dev/null | head -1)"
      [ -n "$holder_run_id" ] && break
    fi
    [ "$try" -lt 3 ] && sleep 0.1
  done
  [ -n "$holder_run_id" ] || holder_run_id="(not yet published — holder is mid-acquire; retry the suite run shortly)"
  [ -n "$holder_pid" ] || holder_pid="unknown"
  [ -n "$holder_since" ] || holder_since="unknown"
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
