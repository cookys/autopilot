#!/usr/bin/env bash
# worktree-removal-live-guard.test.sh — proving tests for:
#   1. Shared live-process cwd exclusion (/proc/<pid>/cwd readlink only) across every automatic worktree remover.
#   2. Shared JSONL audit log (${XDG_RUNTIME_DIR:-$HOME/.autopilot}/autopilot/worktree-removals.jsonl) + 2 MB .1 rotation.
#   3. Negative control: disabling readProcCwds in a scratch copy turns the first test red (worktree removed while sleep runs).
#   4. Lock gaps in dispatch-hetero.sh: lifetime flock taken BEFORE .autopilot-worktree marker publication, and preserved
#      across setsid detach so detached_main holds the lock even after parent SIGKILL until the round's last write.
. "$(dirname "$0")/lib.sh"
enable_legacy_scorecard_test_projection
scrub_session_env

ALL_SLEEPS=()
LIVE_SLEEP_PID=""

start_live_sleep() { # <dir> -> sets LIVE_SLEEP_PID
  local dir="$1" target_real
  target_real="$(realpath "$dir")"
  ( cd "$dir" && exec sleep 300 ) </dev/null >/dev/null 2>&1 &
  LIVE_SLEEP_PID=$!
  ALL_SLEEPS+=("$LIVE_SLEEP_PID")
  poll_until 5 bash -c '[ "$(realpath "/proc/'"$LIVE_SLEEP_PID"'/cwd" 2>/dev/null)" = "'"$target_real"'" ]' \
    || fail "start_live_sleep: /proc/$LIVE_SLEEP_PID/cwd never resolved to $target_real"
}

stop_live_sleep() { # <pid>
  local pid="${1:-}"
  [ -n "$pid" ] || return 0
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

init_fixture_repo() { # <repo_dir>
  local r="$1"
  mkdir -p "$r"
  git -C "$r" init -q -b develop
  git -C "$r" config user.email t@t
  git -C "$r" config user.name t
  printf 'seed\n' > "$r/seed.txt"
  git -C "$r" add seed.txt
  git -C "$r" commit -q -m "base"
  local common
  common="$(git -C "$r" rev-parse --path-format=absolute --git-common-dir)"
  mkdir -p "$common/info"
  printf '%s\n' ".autopilot-worktree" ".autopilot-worktree.lock" >> "$common/info/exclude"
}

write_schema2_marker() { # <wt> <branch> <base_sha> <root_run_id> <run_id> [expired_keep]
  local wt="$1" br="$2" base="$3" root_id="$4" run_id="$5" expired_keep="${6:-0}"
  {
    printf 'created_at=1000\n'
    printf 'branch=%s\n' "$br"
    printf 'base_sha=%s\n' "$base"
    printf 'run_id=%s\n' "$run_id"
    printf 'root_run_id=%s\n' "$root_id"
    printf 'loop_id=%s-loop\n' "$run_id"
    if [ "$expired_keep" = "1" ]; then
      printf 'retention_reason=kept\n'
      printf 'retention_expires_at=2000\n'
    fi
    printf 'schema=2\n'
  } > "$wt/.autopilot-worktree"
  : > "$wt/.autopilot-worktree.lock"
}

# assert_audit_line <xdg_dir> <expected_total_lines> <line_idx_0based> <remover> <wt_path> <branch_or_star> <outcome> <expected_pid_or_0> <msg>
assert_audit_line() {
  local xdg="$1" total="$2" idx="$3" remover="$4" wt="$5" branch="$6" outcome="$7" pid="$8" msg="$9"
  local logf="$xdg/autopilot/worktree-removals.jsonl"
  if ! node - "$logf" "$total" "$idx" "$remover" "$wt" "$branch" "$outcome" "$pid" <<'NODE'
const fs = require('fs');
const path = require('path');
const [logf, totalStr, idxStr, remover, wt, branch, outcome, pidStr] = process.argv.slice(2);
if (!fs.existsSync(logf)) { console.error(`missing log file: ${logf}`); process.exit(1); }
const lines = fs.readFileSync(logf, 'utf8').trim().split('\n').filter(Boolean);
if (lines.length !== Number(totalStr)) {
  console.error(`expected ${totalStr} line(s), got ${lines.length}: ${lines.join(' | ')}`);
  process.exit(2);
}
const row = JSON.parse(lines[Number(idxStr)]);
const reqKeys = ['ts', 'host', 'remover', 'path', 'branch', 'reason', 'lock', 'live_pids', 'outcome'].sort();
if (Object.keys(row).sort().join(',') !== reqKeys.join(',')) {
  console.error(`unexpected keys: ${Object.keys(row).join(',')}`);
  process.exit(3);
}
if (typeof row.ts !== 'string' || Number.isNaN(Date.parse(row.ts))) { console.error(`bad ts: ${row.ts}`); process.exit(4); }
if (typeof row.host !== 'string' || !row.host) { console.error('empty host'); process.exit(5); }
if (row.remover !== remover) { console.error(`expected remover=${remover}, got ${row.remover}`); process.exit(6); }
const canonParent = (p) => {
  const abs = path.resolve(p);
  try { return fs.realpathSync(abs); } catch {
    try { return path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs)); } catch { return abs; }
  }
};
if (canonParent(row.path) !== canonParent(wt)) {
  console.error(`path mismatch: ${row.path} vs ${wt}`);
  process.exit(7);
}
if (branch !== '*' && (row.branch || '') !== branch) {
  console.error(`branch mismatch: ${row.branch} vs ${branch}`);
  process.exit(8);
}
if (typeof row.reason !== 'string' || !row.reason) { console.error('empty reason'); process.exit(9); }
if (!['held_by_us', 'free', 'unavailable'].includes(row.lock)) { console.error(`bad lock: ${row.lock}`); process.exit(10); }
if (!Array.isArray(row.live_pids)) { console.error('live_pids not array'); process.exit(11); }
if (row.outcome !== outcome) { console.error(`expected outcome=${outcome}, got ${row.outcome}`); process.exit(12); }
const expectedPid = Number(pidStr);
if (expectedPid > 0) {
  if (!row.live_pids.includes(expectedPid)) {
    console.error(`expected live_pids to include ${expectedPid}, got ${JSON.stringify(row.live_pids)}`);
    process.exit(13);
  }
} else if (row.live_pids.length !== 0) {
  console.error(`expected empty live_pids, got ${JSON.stringify(row.live_pids)}`);
  process.exit(14);
}
NODE
  then
    fail "$msg"
  else
    __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
  fi
}

# =========================================================================================
# 1. repo-residue-sweep.js reap on a fixture worktree whose cwd is held by background sleep:
#    skipped with live_pids set; after killing sleep by PID, re-run removes it and logs.
# =========================================================================================
R1="$TEST_TMP/r1-repo"
WT1="$TEST_TMP/r1-wt"
XDG1="$TEST_TMP/xdg1"
init_fixture_repo "$R1"
git -C "$R1" worktree add -q -b feat/live-cwd "$WT1" develop

start_live_sleep "$WT1"
SLP1="$LIVE_SLEEP_PID"

OUT1="$(XDG_RUNTIME_DIR="$XDG1" node "$REPO_ROOT/scripts/repo-residue-sweep.js" reap --repo "$R1" --yes --json < /dev/null)"
RC1=$?
assert_eq "0" "$RC1" "case1: repo-residue-sweep reap exits 0 when skipping live worktree"
assert_file_exists "$WT1/.git" "case1: worktree held by live sleep cwd survives reap"
if ! printf '%s' "$OUT1" | node -e '
const fs = require("fs");
const pid = Number(process.argv[1]);
const j = JSON.parse(fs.readFileSync(0, "utf8"));
const kept = (j.actions && j.actions.worktrees_kept) || [];
if (!kept.some((k) => Array.isArray(k.live_pids) && k.live_pids.includes(pid))) process.exit(1);
' "$SLP1"; then
  fail "case1: reap JSON output must report live_pids containing sleep PID $SLP1"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
assert_audit_line "$XDG1" 1 0 "repo-residue-sweep.js" "$WT1" "feat/live-cwd" "skipped" "$SLP1" \
  "case1: repo-residue-sweep logs skipped decision with live_pids"

stop_live_sleep "$SLP1"

XDG_RUNTIME_DIR="$XDG1" node "$REPO_ROOT/scripts/repo-residue-sweep.js" reap --repo "$R1" --yes --json < /dev/null > /dev/null
assert_file_absent "$WT1" "case1: after killing sleep by PID, worktree is removed"
assert_audit_line "$XDG1" 2 1 "repo-residue-sweep.js" "$WT1" "feat/live-cwd" "removed" 0 \
  "case1: repo-residue-sweep logs removed decision after sleep exits"

# =========================================================================================
# 2. Negative control: disable live-pid cwd discovery in a scratch copy -> first test goes RED
#    (the worktree is removed even while background sleep holds cwd inside it).
# =========================================================================================
MUT_ROOT="$TEST_TMP/mut-root"
mkdir -p "$MUT_ROOT/scripts/lib"
cp "$REPO_ROOT/scripts/repo-residue-sweep.js" "$MUT_ROOT/scripts/repo-residue-sweep.js"
cp -R "$REPO_ROOT/scripts/lib/." "$MUT_ROOT/scripts/lib/"
ln -s "$REPO_ROOT/src" "$MUT_ROOT/src"
sed_mutant "$REPO_ROOT/scripts/lib/worktree-removal-log.js" \
  "$MUT_ROOT/scripts/lib/worktree-removal-log.js" \
  's/const map = new Map();/return new Map();/'

R_MUT="$TEST_TMP/rmut-repo"
WT_MUT="$TEST_TMP/rmut-wt"
XDG_MUT="$TEST_TMP/xdg-mut"
init_fixture_repo "$R_MUT"
git -C "$R_MUT" worktree add -q -b feat/mut-live "$WT_MUT" develop

start_live_sleep "$WT_MUT"
SLP_MUT="$LIVE_SLEEP_PID"

XDG_RUNTIME_DIR="$XDG_MUT" node "$MUT_ROOT/scripts/repo-residue-sweep.js" reap --repo "$R_MUT" --yes --json < /dev/null > /dev/null
if [ -d "$WT_MUT" ]; then
  stop_live_sleep "$SLP_MUT"
  fail "negative control: disabling readProcCwds did NOT allow removal (first test would not go red)"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi
stop_live_sleep "$SLP_MUT"

# =========================================================================================
# 3. Every automatic remover skips on live cwd + writes one JSONL line per decision.
# =========================================================================================

# --- 3a. repo-residue-sweep.js reap --auto --yes ---
R_AUTO="$TEST_TMP/rauto-repo"
WT_AUTO="$TEST_TMP/rauto-wt"
init_fixture_repo "$R_AUTO"
BASE_AUTO="$(git -C "$R_AUTO" rev-parse HEAD)"
git -C "$R_AUTO" worktree add -q -b hetero/auto-live "$WT_AUTO" develop
write_schema2_marker "$WT_AUTO" "hetero/auto-live" "$BASE_AUTO" "auto-root" "auto-run" 1

start_live_sleep "$WT_AUTO"
SLP_AUTO="$LIVE_SLEEP_PID"
XDG_AUTO_SKIP="$TEST_TMP/xdg-auto-skip"
XDG_RUNTIME_DIR="$XDG_AUTO_SKIP" node "$REPO_ROOT/scripts/repo-residue-sweep.js" reap --repo "$R_AUTO" --auto --yes < /dev/null > /dev/null
assert_file_exists "$WT_AUTO/.git" "3a: reap --auto skips worktree with live sleep cwd"
assert_audit_line "$XDG_AUTO_SKIP" 1 0 "repo-residue-sweep.js" "$WT_AUTO" "hetero/auto-live" "skipped" "$SLP_AUTO" \
  "3a: reap --auto writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_AUTO"

XDG_AUTO_RM="$TEST_TMP/xdg-auto-rm"
XDG_RUNTIME_DIR="$XDG_AUTO_RM" node "$REPO_ROOT/scripts/repo-residue-sweep.js" reap --repo "$R_AUTO" --auto --yes < /dev/null > /dev/null
assert_file_absent "$WT_AUTO" "3a: reap --auto removes dead expired-lease worktree"
assert_audit_line "$XDG_AUTO_RM" 1 0 "repo-residue-sweep.js" "$WT_AUTO" "hetero/auto-live" "removed" 0 \
  "3a: reap --auto writes 1 removed JSONL line"

# --- 3b. scripts/reap-dispatch-worktrees.sh reap --yes ---
R_RDW="$TEST_TMP/rrdw-repo"
WT_RDW="$TEST_TMP/rrdw-wt"
init_fixture_repo "$R_RDW"
BASE_RDW="$(git -C "$R_RDW" rev-parse HEAD)"
git -C "$R_RDW" worktree add -q -b hetero/rdw-live "$WT_RDW" develop
write_schema2_marker "$WT_RDW" "hetero/rdw-live" "$BASE_RDW" "rdw-root" "rdw-run" 0

start_live_sleep "$WT_RDW"
SLP_RDW="$LIVE_SLEEP_PID"
XDG_RDW_SKIP="$TEST_TMP/xdg-rdw-skip"
XDG_RUNTIME_DIR="$XDG_RDW_SKIP" bash "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$R_RDW" --root-run-id "rdw-root" --yes < /dev/null > /dev/null
assert_file_exists "$WT_RDW/.git" "3b: reap-dispatch-worktrees.sh skips worktree with live sleep cwd"
assert_audit_line "$XDG_RDW_SKIP" 1 0 "reap-dispatch-worktrees.sh" "$WT_RDW" "hetero/rdw-live" "skipped" "$SLP_RDW" \
  "3b: reap-dispatch-worktrees.sh writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_RDW"

XDG_RDW_RM="$TEST_TMP/xdg-rdw-rm"
XDG_RUNTIME_DIR="$XDG_RDW_RM" bash "$REPO_ROOT/scripts/reap-dispatch-worktrees.sh" reap \
  --repo "$R_RDW" --root-run-id "rdw-root" --yes < /dev/null > /dev/null
assert_file_absent "$WT_RDW" "3b: reap-dispatch-worktrees.sh removes dead clean worktree"
assert_audit_line "$XDG_RDW_RM" 1 0 "reap-dispatch-worktrees.sh" "$WT_RDW" "hetero/rdw-live" "removed" 0 \
  "3b: reap-dispatch-worktrees.sh writes 1 removed JSONL line"

# --- 3c. scripts/dispatch-hetero.sh startup sweep (_wt_budget_reconcile_and_count) ---
AGY_NOOP_STUB="$TEST_TMP/agy-noop"
cat > "$AGY_NOOP_STUB" <<'EOF'
#!/usr/bin/env bash
printf '{"conversation_id":"fx","duration_seconds":1,"num_turns":1,"response":"ok","status":"SUCCESS","usage":{"cache_read_tokens":0,"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"total_tokens":2}}\n'
EOF
chmod +x "$AGY_NOOP_STUB"
make_agy_stub_versioned "$AGY_NOOP_STUB"
PROMPT_HET="$TEST_TMP/het-prompt.txt"
printf 'noop\n' > "$PROMPT_HET"

R_HET="$TEST_TMP/rhet-repo"
WT_HET="$TEST_TMP/rhet-wt"
init_fixture_repo "$R_HET"
BASE_HET="$(git -C "$R_HET" rev-parse HEAD)"
COMMON_HET="$(git -C "$R_HET" rev-parse --path-format=absolute --git-common-dir)"
git -C "$R_HET" worktree add -q -b hetero/het-sweep "$WT_HET" develop
write_schema2_marker "$WT_HET" "hetero/het-sweep" "$BASE_HET" "het-sweep-root" "het-sweep-run" 0

start_live_sleep "$WT_HET"
SLP_HET="$LIVE_SLEEP_PID"
XDG_HET_SKIP="$TEST_TMP/xdg-het-skip"
(
  cd "$R_HET"
  XDG_RUNTIME_DIR="$XDG_HET_SKIP" \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID="het-sweep-root" \
  AUTOPILOT_TEST_WORKTREE_CRASH_AT="after-pending" \
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" \
      --no-verify-tip --branch feat/probe-1 --prompt-file "$PROMPT_HET" --agy-bin "$AGY_NOOP_STUB" \
      < /dev/null > /dev/null 2>&1
) || true
rm -rf "$COMMON_HET/autopilot-worktree-creation"
assert_file_exists "$WT_HET/.git" "3c: dispatch-hetero startup sweep skips worktree with live sleep cwd"
assert_audit_line "$XDG_HET_SKIP" 1 0 "dispatch-hetero.sh" "$WT_HET" "hetero/het-sweep" "skipped" "$SLP_HET" \
  "3c: dispatch-hetero startup sweep writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_HET"

XDG_HET_RM="$TEST_TMP/xdg-het-rm"
(
  cd "$R_HET"
  XDG_RUNTIME_DIR="$XDG_HET_RM" \
  AUTOPILOT_WORKTREE_ROOT_RUN_ID="het-sweep-root" \
  AUTOPILOT_TEST_WORKTREE_CRASH_AT="after-pending" \
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" \
      --no-verify-tip --branch feat/probe-2 --prompt-file "$PROMPT_HET" --agy-bin "$AGY_NOOP_STUB" \
      < /dev/null > /dev/null 2>&1
) || true
rm -rf "$COMMON_HET/autopilot-worktree-creation"
assert_file_absent "$WT_HET" "3c: dispatch-hetero startup sweep removes dead clean worktree"
assert_audit_line "$XDG_HET_RM" 1 0 "dispatch-hetero.sh" "$WT_HET" "hetero/het-sweep" "removed" 0 \
  "3c: dispatch-hetero startup sweep writes 1 removed JSONL line"

# --- 3d. scripts/lib/worktree-reap.sh (reap_worktree and reap_worktree_minimal) ---
R_WR="$TEST_TMP/rwr-repo"
WT_WR1="$TEST_TMP/rwr-wt1"
WT_WR2="$TEST_TMP/rwr-wt2"
init_fixture_repo "$R_WR"
git -C "$R_WR" worktree add -q -b feat/wr-full "$WT_WR1" develop
git -C "$R_WR" worktree add -q -b feat/wr-min "$WT_WR2" develop

start_live_sleep "$WT_WR1"
SLP_WR1="$LIVE_SLEEP_PID"
XDG_WR1_SKIP="$TEST_TMP/xdg-wr1-skip"
(
  cd "$R_WR"
  export XDG_RUNTIME_DIR="$XDG_WR1_SKIP"
  TEARDOWN_CONFIG_LOADED=1 TEARDOWN_HOOK=""
  . "$REPO_ROOT/scripts/lib/worktree-reap.sh"
  reap_worktree "$WT_WR1" 2>/dev/null
) < /dev/null
assert_file_exists "$WT_WR1/.git" "3d: reap_worktree skips worktree with live sleep cwd"
assert_audit_line "$XDG_WR1_SKIP" 1 0 "worktree-reap.sh" "$WT_WR1" "feat/wr-full" "skipped" "$SLP_WR1" \
  "3d: reap_worktree writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_WR1"

XDG_WR1_RM="$TEST_TMP/xdg-wr1-rm"
(
  cd "$R_WR"
  export XDG_RUNTIME_DIR="$XDG_WR1_RM"
  TEARDOWN_CONFIG_LOADED=1 TEARDOWN_HOOK=""
  . "$REPO_ROOT/scripts/lib/worktree-reap.sh"
  reap_worktree "$WT_WR1" 2>/dev/null
) < /dev/null
assert_file_absent "$WT_WR1" "3d: reap_worktree removes dead worktree"
assert_audit_line "$XDG_WR1_RM" 1 0 "worktree-reap.sh" "$WT_WR1" "feat/wr-full" "removed" 0 \
  "3d: reap_worktree writes 1 removed JSONL line"

start_live_sleep "$WT_WR2"
SLP_WR2="$LIVE_SLEEP_PID"
XDG_WR2_SKIP="$TEST_TMP/xdg-wr2-skip"
(
  cd "$R_WR"
  export XDG_RUNTIME_DIR="$XDG_WR2_SKIP"
  ORPHAN_LOG="$TEST_TMP/wr2-orphans.log"
  . "$REPO_ROOT/scripts/lib/worktree-reap.sh"
  reap_worktree_minimal "$WT_WR2" 2>/dev/null
) < /dev/null
assert_file_exists "$WT_WR2/.git" "3d: reap_worktree_minimal skips worktree with live sleep cwd"
assert_audit_line "$XDG_WR2_SKIP" 1 0 "worktree-reap.sh" "$WT_WR2" "feat/wr-min" "skipped" "$SLP_WR2" \
  "3d: reap_worktree_minimal writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_WR2"

XDG_WR2_RM="$TEST_TMP/xdg-wr2-rm"
(
  cd "$R_WR"
  export XDG_RUNTIME_DIR="$XDG_WR2_RM"
  ORPHAN_LOG="$TEST_TMP/wr2-orphans.log"
  . "$REPO_ROOT/scripts/lib/worktree-reap.sh"
  reap_worktree_minimal "$WT_WR2" 2>/dev/null
) < /dev/null
assert_file_absent "$WT_WR2" "3d: reap_worktree_minimal removes dead worktree"
assert_audit_line "$XDG_WR2_RM" 1 0 "worktree-reap.sh" "$WT_WR2" "feat/wr-min" "removed" 0 \
  "3d: reap_worktree_minimal writes 1 removed JSONL line"

# --- 3e. scripts/reap-scratch-checkouts.js --apply ---
R_SCR="$TEST_TMP/rscr-main"
SCR_ROOT="$TEST_TMP/rscr-scratch"
mkdir -p "$SCR_ROOT"
init_fixture_repo "$R_SCR"
WT_SCR="$SCR_ROOT/merged-lane"
git -C "$R_SCR" worktree add -q -b feat/scr-live "$WT_SCR" develop

start_live_sleep "$WT_SCR"
SLP_SCR="$LIVE_SLEEP_PID"
XDG_SCR_SKIP="$TEST_TMP/xdg-scr-skip"
XDG_RUNTIME_DIR="$XDG_SCR_SKIP" node "$REPO_ROOT/scripts/reap-scratch-checkouts.js" \
  --root "$SCR_ROOT" --repo "$R_SCR" --apply < /dev/null > /dev/null
assert_file_exists "$WT_SCR/.git" "3e: reap-scratch-checkouts.js --apply skips worktree with live sleep cwd"
assert_audit_line "$XDG_SCR_SKIP" 1 0 "reap-scratch-checkouts.js" "$WT_SCR" "feat/scr-live" "skipped" "$SLP_SCR" \
  "3e: reap-scratch-checkouts.js writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_SCR"

XDG_SCR_RM="$TEST_TMP/xdg-scr-rm"
XDG_RUNTIME_DIR="$XDG_SCR_RM" node "$REPO_ROOT/scripts/reap-scratch-checkouts.js" \
  --root "$SCR_ROOT" --repo "$R_SCR" --apply < /dev/null > /dev/null
assert_file_absent "$WT_SCR" "3e: reap-scratch-checkouts.js --apply removes dead clean worktree"
assert_audit_line "$XDG_SCR_RM" 1 0 "reap-scratch-checkouts.js" "$WT_SCR" "feat/scr-live" "removed" 0 \
  "3e: reap-scratch-checkouts.js writes 1 removed JSONL line"

# --- 3f. scripts/dispatch-status.js --reap ---
R_DS="$TEST_TMP/rds-repo"
WT_DS="$TEST_TMP/rds-wt"
DS_DIR="$TEST_TMP/rds-manifests"
mkdir -p "$DS_DIR"
init_fixture_repo "$R_DS"
BASE_DS="$(git -C "$R_DS" rev-parse HEAD)"
git -C "$R_DS" worktree add -q -b feat/ds-live "$WT_DS" develop
write_schema2_marker "$WT_DS" "feat/ds-live" "$BASE_DS" "ds-root" "ds-run" 0
node -e '
const fs = require("fs");
fs.writeFileSync(process.argv[1], JSON.stringify({
  run_id: "ds-run",
  final_status: "failure",
  ended_epoch: 1000,
  branch: "feat/ds-live",
  worktree: process.argv[2],
}) + "\n");
' "$DS_DIR/ds-run.manifest.json" "$WT_DS" < /dev/null

start_live_sleep "$WT_DS"
SLP_DS="$LIVE_SLEEP_PID"
XDG_DS_SKIP="$TEST_TMP/xdg-ds-skip"
XDG_RUNTIME_DIR="$XDG_DS_SKIP" node "$REPO_ROOT/scripts/dispatch-status.js" --reap --days 1 --dir "$DS_DIR" < /dev/null > /dev/null
assert_file_exists "$WT_DS/.git" "3f: dispatch-status.js --reap skips worktree with live sleep cwd"
assert_file_exists "$DS_DIR/ds-run.manifest.json" "3f: dispatch-status.js --reap retains manifest when worktree is skipped"
assert_audit_line "$XDG_DS_SKIP" 1 0 "dispatch-status.js" "$WT_DS" "feat/ds-live" "skipped" "$SLP_DS" \
  "3f: dispatch-status.js --reap writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_DS"

XDG_DS_RM="$TEST_TMP/xdg-ds-rm"
XDG_RUNTIME_DIR="$XDG_DS_RM" node "$REPO_ROOT/scripts/dispatch-status.js" --reap --days 1 --dir "$DS_DIR" < /dev/null > /dev/null
assert_file_absent "$WT_DS" "3f: dispatch-status.js --reap removes dead aged worktree"
assert_audit_line "$XDG_DS_RM" 1 0 "dispatch-status.js" "$WT_DS" "feat/ds-live" "removed" 0 \
  "3f: dispatch-status.js --reap writes 1 removed JSONL line"

# --- 3g. src/engine/repair-lineage-cleanup.js ---
R_RLC="$TEST_TMP/rrlc-repo"
WT_RLC="$TEST_TMP/rrlc-wt"
init_fixture_repo "$R_RLC"
BASE_RLC="$(git -C "$R_RLC" rev-parse HEAD)"
git -C "$R_RLC" worktree add -q -b feat/rlc-live "$WT_RLC" develop
RLC_REASON_SHA="$(printf '%s' "rlc-reason" | sha256sum | awk '{print $1}')"
{
  printf 'created_at=1000\n'
  printf 'branch=feat/rlc-live\n'
  printf 'base_sha=%s\n' "$BASE_RLC"
  printf 'run_id=rlc-run\n'
  printf 'root_run_id=rlc-root\n'
  printf 'loop_id=rlc-loop\n'
  printf 'retention=lease\n'
  printf 'retention_owner=rlc-owner\n'
  printf 'retention_reason_sha256=%s\n' "$RLC_REASON_SHA"
  printf 'retention_expires_at=9999999999\n'
  printf 'schema=2\n'
} > "$WT_RLC/.autopilot-worktree"
: > "$WT_RLC/.autopilot-worktree.lock"
RLC_PAYLOAD="$(node -e '
const { worktreeInstanceId } = require(process.argv[1]);
const wt = process.argv[3];
process.stdout.write(JSON.stringify({
  cwd: process.argv[2],
  worktree: wt,
  expectedBranch: "feat/rlc-live",
  expectedTip: process.argv[4],
  expectedRootRunId: "rlc-root",
  expectedRetentionOwner: "rlc-owner",
  expectedRetentionReason: "rlc-reason",
  expectedRetentionExpiresAt: 9999999999,
  expectedWorktreeInstanceId: worktreeInstanceId(wt),
}));
' "$REPO_ROOT/src/engine/repair-lineage-cleanup.js" "$R_RLC" "$WT_RLC" "$BASE_RLC" < /dev/null)"

start_live_sleep "$WT_RLC"
SLP_RLC="$LIVE_SLEEP_PID"
XDG_RLC_SKIP="$TEST_TMP/xdg-rlc-skip"
XDG_RUNTIME_DIR="$XDG_RLC_SKIP" node "$REPO_ROOT/src/engine/repair-lineage-cleanup.js" "$RLC_PAYLOAD" < /dev/null > /dev/null 2>&1
assert_neq "0" "$?" "3g: repair-lineage-cleanup.js refuses removal when live sleep cwd is inside"
assert_file_exists "$WT_RLC/.git" "3g: repair-lineage-cleanup.js keeps worktree with live sleep cwd"
assert_audit_line "$XDG_RLC_SKIP" 1 0 "repair-lineage-cleanup.js" "$WT_RLC" "feat/rlc-live" "skipped" "$SLP_RLC" \
  "3g: repair-lineage-cleanup.js writes 1 skipped JSONL line with live_pids"
stop_live_sleep "$SLP_RLC"

XDG_RLC_RM="$TEST_TMP/xdg-rlc-rm"
XDG_RUNTIME_DIR="$XDG_RLC_RM" node "$REPO_ROOT/src/engine/repair-lineage-cleanup.js" "$RLC_PAYLOAD" < /dev/null > /dev/null 2>&1
assert_eq "0" "$?" "3g: repair-lineage-cleanup.js removes dead clean retained worktree"
assert_file_absent "$WT_RLC" "3g: repair-lineage-cleanup.js removed dead worktree"
assert_audit_line "$XDG_RLC_RM" 1 0 "repair-lineage-cleanup.js" "$WT_RLC" "feat/rlc-live" "removed" 0 \
  "3g: repair-lineage-cleanup.js writes 1 removed JSONL line"

# =========================================================================================
# 4. Log rotation keeps worktree-removals.jsonl under 2 MB (rotates to .1).
# =========================================================================================
XDG_ROT="$TEST_TMP/xdg-rot"
mkdir -p "$XDG_ROT/autopilot"
node -e '
const fs = require("fs");
const { MAX_LOG_BYTES } = require(process.argv[1]);
const p = process.argv[2];
const targetBytes = MAX_LOG_BYTES - 10;
const emptyBytes = Buffer.byteLength(JSON.stringify({ pad: "" }) + "\n");
const chunk = JSON.stringify({ pad: "x".repeat(1000) }) + "\n";
const chunkBytes = Buffer.byteLength(chunk);
const count = Math.floor((targetBytes - emptyBytes) / chunkBytes);
const rem = targetBytes - count * chunkBytes;
const tail = JSON.stringify({ pad: "x".repeat(rem - emptyBytes) }) + "\n";
fs.writeFileSync(p, chunk.repeat(count) + tail);
' "$REPO_ROOT/scripts/lib/worktree-removal-log.js" "$XDG_ROT/autopilot/worktree-removals.jsonl" < /dev/null

XDG_RUNTIME_DIR="$XDG_ROT" node "$REPO_ROOT/scripts/lib/worktree-removal-log.js" log \
  --remover "rotation-check.js" --path "$TEST_TMP/rot-wt" --branch "feat/rot" \
  --reason "rotation_probe" --lock "free" --outcome "removed" < /dev/null

assert_file_exists "$XDG_ROT/autopilot/worktree-removals.jsonl.1" "4: oversized log rotated to .1"
assert_audit_line "$XDG_ROT" 1 0 "rotation-check.js" "$TEST_TMP/rot-wt" "feat/rot" "removed" 0 \
  "4: fresh log after rotation contains 1 valid JSONL line under 2 MB"

# =========================================================================================
# 5. Lock-gap guards in dispatch-hetero.sh:
#    (a) .autopilot-worktree.lock is opened before .autopilot-worktree is published (after-add checkpoint).
#    (b) Detached setsid child keeps holding .autopilot-worktree.lock even after parent SIGKILL.
# =========================================================================================
R_LG="$TEST_TMP/rlg-repo"
WT_PARENT_LG="$TEST_TMP/rlg-wts"
mkdir -p "$WT_PARENT_LG"
init_fixture_repo "$R_LG"

(
  cd "$R_LG"
  AUTOPILOT_TEST_WORKTREE_CRASH_AT="after-add" \
    bash "$REPO_ROOT/scripts/dispatch-hetero.sh" \
      --no-verify-tip --worktree-parent "$WT_PARENT_LG" --branch feat/lock-order \
      --prompt-file "$PROMPT_HET" --agy-bin "$AGY_NOOP_STUB" < /dev/null > /dev/null 2>&1
) || true
CREATED_LG_WT="$(find "$WT_PARENT_LG" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
assert_neq "" "$CREATED_LG_WT" "5a: worktree created before after-add crash checkpoint"
assert_file_exists "$CREATED_LG_WT/.autopilot-worktree.lock" \
  "5a: lifetime lock file already opened BEFORE .autopilot-worktree marker publication"
assert_file_absent "$CREATED_LG_WT/.autopilot-worktree" \
  "5a: .autopilot-worktree marker not yet published at after-add checkpoint"
git -C "$R_LG" worktree remove --force "$CREATED_LG_WT" >/dev/null 2>&1 || true

# 5b: Detached setsid child holds .autopilot-worktree.lock after parent SIGKILL until round finishes.
AGY_DETACH_SLOW="$TEST_TMP/agy-detach-slow"
cat > "$AGY_DETACH_SLOW" <<'EOF'
#!/usr/bin/env bash
sleep 4
echo ok > ok.txt
git add ok.txt
git -c user.email=t@t -c user.name=t commit -q -m "test: lock held across detach"
printf '{"conversation_id":"fx","duration_seconds":1,"num_turns":1,"response":"done","status":"SUCCESS","usage":{"cache_read_tokens":0,"input_tokens":1,"output_tokens":1,"thinking_tokens":0,"total_tokens":2}}\n'
EOF
chmod +x "$AGY_DETACH_SLOW"
make_agy_stub_versioned "$AGY_DETACH_SLOW"

LEDGER_LG="$TEST_TMP/lg-detach/ledger.jsonl"
mkdir -p "$TEST_TMP/lg-detach" "$TEST_TMP/lg-detach-wts"
bash "$REPO_ROOT/scripts/run-ledger.sh" init --ledger "$LEDGER_LG" < /dev/null > /dev/null

_prev_pwd="$PWD"
cd "$R_LG"
DISPATCH_HEARTBEAT_SECS=1 bash "$REPO_ROOT/scripts/dispatch-hetero.sh" \
  --no-verify-tip --worktree-parent "$TEST_TMP/lg-detach-wts" --branch feat/detach-lock \
  --prompt-file "$PROMPT_HET" --agy-bin "$AGY_DETACH_SLOW" --runner agy --pin-reason "test fixture" \
  --ledger "$LEDGER_LG" --run-id rlock --stage implement \
  < /dev/null > "$TEST_TMP/lg-detach.out" 2> "$TEST_TMP/lg-detach.err" &
DETACH_WRAPPER_PID=$!
cd "$_prev_pwd"

poll_until 20 grep -q '"kind":"heartbeat"' "$LEDGER_LG" \
  || fail "5b: detached worker never emitted first heartbeat"

DETACH_WT="$(find "$TEST_TMP/lg-detach-wts" -maxdepth 1 -mindepth 1 -type d | head -n 1)"
assert_neq "" "$DETACH_WT" "5b: detached worktree exists"

kill -9 "$DETACH_WRAPPER_PID" 2>/dev/null || true
wait "$DETACH_WRAPPER_PID" 2>/dev/null || true

# Parent is now dead (SIGKILLed), while detached_main + agy stub are still running.
# Probing flock -n on .autopilot-worktree.lock MUST fail (exit != 0) because detached_main holds it!
if flock -n "$DETACH_WT/.autopilot-worktree.lock" true 2>/dev/null; then
  fail "5b: .autopilot-worktree.lock became FREE after parent SIGKILL while detached worker was still running"
else
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
fi

RESULT_LG="${LEDGER_LG}.results/rlock.implement.result.json"
poll_until 20 test -f "$RESULT_LG" \
  || fail "5b: detached worker did not write result file"
assert_contains "$(cat "$RESULT_LG")" '"status": "committed"' \
  "5b: detached worker completed cleanly without worktree_gitfile_tampered"

# Once detached_main exits, .autopilot-worktree.lock must be free again (no leaked fd in subprocesses).
poll_until 5 flock -n "$DETACH_WT/.autopilot-worktree.lock" true \
  || fail "5b: .autopilot-worktree.lock remained held after detached_main exited"
__TEST_PASS_COUNT=$((__TEST_PASS_COUNT + 1))
git -C "$R_LG" worktree remove --force "$DETACH_WT" >/dev/null 2>&1 || true

for _p in "${ALL_SLEEPS[@]+"${ALL_SLEEPS[@]}"}"; do
  stop_live_sleep "$_p"
done

finalize_test
