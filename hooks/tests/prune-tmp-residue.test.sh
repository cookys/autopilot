#!/usr/bin/env bash
# Tests for scripts/lib/prune-tmp-residue.sh — startup retention prune of the
# dispatch scripts' own ${TMPDIR} log/scratch residue (BACKLOG 2026-07-13 (a):
# 1910 dispatch-review-log-* / 616 hetero fixture logs / 126 pi-rpc-session-*
# accumulated with no retention and exhausted the /tmp usrquota).
. "$(dirname "$0")/lib.sh"

LIB="$REPO_ROOT/scripts/lib/prune-tmp-residue.sh"

assert_file_exists "$LIB" "prune-tmp-residue.sh exists"
# shellcheck disable=SC1090
. "$LIB" 2>/dev/null || fail "prune-tmp-residue.sh not sourceable"

# Sandbox TMPDIR for the unit tests (lib.sh already exports a sandboxed TMPDIR;
# use a dedicated subdir so assertions can't collide with other scratch).
PRUNE_TMP="$TEST_TMP/prune-tmp"
mkdir -p "$PRUNE_TMP"

mk_aged() { # mk_aged <path> [days]
  local p="$1" d="${2:-10}"
  if [[ "$p" == */ ]]; then mkdir -p "${p%/}"; p="${p%/}"; else : > "$p"; fi
  touch -d "$d days ago" "$p"
}

# --- t1: aged file matching pattern deleted; fresh sibling kept ---------------
test_aged_deleted_fresh_kept() {
  mk_aged "$PRUNE_TMP/dispatch-review-log-old"
  : > "$PRUNE_TMP/dispatch-review-log-new"
  TMPDIR="$PRUNE_TMP" prune_tmp_residue 3 'dispatch-review-log-*'
  assert_exit_code $? 0 "prune returns 0"
  assert_file_absent "$PRUNE_TMP/dispatch-review-log-old" "aged residue pruned"
  assert_file_exists "$PRUNE_TMP/dispatch-review-log-new" "fresh residue kept"
}
test_aged_deleted_fresh_kept

# --- t2: aged directory (pi-rpc-session-*) removed recursively ----------------
test_aged_dir_removed() {
  mk_aged "$PRUNE_TMP/pi-rpc-session-old/"
  : > "$PRUNE_TMP/pi-rpc-session-old/events.jsonl"
  touch -d "10 days ago" "$PRUNE_TMP/pi-rpc-session-old"
  TMPDIR="$PRUNE_TMP" prune_tmp_residue 3 'pi-rpc-session-*'
  assert_file_absent "$PRUNE_TMP/pi-rpc-session-old" "aged session dir pruned"
}
test_aged_dir_removed

# --- t3: days=0 disables (no-op) ----------------------------------------------
test_zero_days_noop() {
  mk_aged "$PRUNE_TMP/dispatch-author-log-old"
  TMPDIR="$PRUNE_TMP" prune_tmp_residue 0 'dispatch-author-log-*'
  assert_exit_code $? 0 "days=0 returns 0"
  assert_file_exists "$PRUNE_TMP/dispatch-author-log-old" "days=0 deletes nothing"
}
test_zero_days_noop

# --- t4: garbage days disables (no-op, still exit 0) --------------------------
test_garbage_days_noop() {
  TMPDIR="$PRUNE_TMP" prune_tmp_residue banana 'dispatch-author-log-*'
  assert_exit_code $? 0 "garbage days returns 0"
  assert_file_exists "$PRUNE_TMP/dispatch-author-log-old" "garbage days deletes nothing"
}
test_garbage_days_noop

# --- t5: pattern containing a slash is refused (path-traversal guard) ---------
test_slash_pattern_refused() {
  mkdir -p "$PRUNE_TMP/sub"
  mk_aged "$PRUNE_TMP/sub/victim"
  TMPDIR="$PRUNE_TMP" prune_tmp_residue 3 'sub/vic*'
  assert_exit_code $? 0 "slash pattern returns 0"
  assert_file_exists "$PRUNE_TMP/sub/victim" "slash pattern deletes nothing"
}
test_slash_pattern_refused

# --- t6: absent TMPDIR is a silent no-op --------------------------------------
test_absent_tmpdir_noop() {
  TMPDIR="$PRUNE_TMP/does-not-exist" prune_tmp_residue 3 'dispatch-review-log-*'
  assert_exit_code $? 0 "absent TMPDIR returns 0"
}
test_absent_tmpdir_noop

# --- t7: wiring — dispatch-review.sh prunes its own aged residue at startup ---
# Even a usage-error invocation (no args, exit 2) must have pruned first: the
# prune call sits before arg parsing, best-effort.
test_review_wiring() {
  local wire_tmp="$TEST_TMP/wire-review"
  mkdir -p "$wire_tmp"
  mk_aged "$wire_tmp/dispatch-review-log-aged"
  : > "$wire_tmp/dispatch-review-log-fresh"
  TMPDIR="$wire_tmp" bash "$REPO_ROOT/scripts/dispatch-review.sh" >/dev/null 2>&1
  assert_file_absent "$wire_tmp/dispatch-review-log-aged" "review startup pruned aged log"
  assert_file_exists "$wire_tmp/dispatch-review-log-fresh" "review startup kept fresh log"
}
test_review_wiring

# --- t8: wiring — dispatch-hetero.sh prunes hetero logs + pi-rpc sessions -----
test_hetero_wiring() {
  local wire_tmp="$TEST_TMP/wire-hetero"
  mkdir -p "$wire_tmp"
  mk_aged "$wire_tmp/hetero-feat-x-log-aged"
  mk_aged "$wire_tmp/pi-rpc-session-aged/"
  : > "$wire_tmp/hetero-feat-x-log-fresh"
  TMPDIR="$wire_tmp" bash "$REPO_ROOT/scripts/dispatch-hetero.sh" >/dev/null 2>&1
  assert_file_absent "$wire_tmp/hetero-feat-x-log-aged" "hetero startup pruned aged log"
  assert_file_absent "$wire_tmp/pi-rpc-session-aged" "hetero startup pruned aged pi session"
  assert_file_exists "$wire_tmp/hetero-feat-x-log-fresh" "hetero startup kept fresh log"
}
test_hetero_wiring

# --- t9: wiring env kill-switch — AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 ----------
test_wiring_env_disable() {
  local wire_tmp="$TEST_TMP/wire-disable"
  mkdir -p "$wire_tmp"
  mk_aged "$wire_tmp/dispatch-author-log-aged"
  TMPDIR="$wire_tmp" AUTOPILOT_TMP_LOG_RETENTION_DAYS=0 \
    bash "$REPO_ROOT/scripts/dispatch-author.sh" >/dev/null 2>&1
  assert_file_exists "$wire_tmp/dispatch-author-log-aged" "retention=0 disables startup prune"
}
test_wiring_env_disable

# --- t10: wiring — dispatch-explore.sh prunes its own aged residue ------------
test_explore_wiring() {
  local wire_tmp="$TEST_TMP/wire-explore"
  mkdir -p "$wire_tmp"
  mk_aged "$wire_tmp/dispatch-explore-log-aged"
  TMPDIR="$wire_tmp" bash "$REPO_ROOT/scripts/dispatch-explore.sh" >/dev/null 2>&1
  assert_file_absent "$wire_tmp/dispatch-explore-log-aged" "explore startup pruned aged log"
}
test_explore_wiring

finalize_test
