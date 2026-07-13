#!/usr/bin/env bash
# Tests for dispatch-status.js --reap — the manifest reaper (BACKLOG 2026-07-13 (b)):
# scan ${TMPDIR}/autopilot-dispatch-runs manifests, liveness-probe (flock/pid/scope,
# same contract as --run), and reap dead+aged manifests plus their worktrees —
# worktree removal ONLY behind the .autopilot-worktree marker + free lock, mirroring
# lib/worktree-reap.sh gc semantics. Report-only rails untouched: a LIVE run is
# never reaped regardless of age.
. "$(dirname "$0")/lib.sh"

STATUS_JS="$REPO_ROOT/scripts/dispatch-status.js"
RUNS="$TEST_TMP/runs"
mkdir -p "$RUNS"

NOW=$(date +%s)
OLD=$((NOW - 30 * 86400))

mk_manifest() { # mk_manifest <file> <json>
  printf '%s\n' "$2" > "$RUNS/$1"
}

run_reap() { # run_reap [extra args...] -> __RUN_STDOUT/__RUN_EXIT
  __RUN_STDOUT=$(node "$STATUS_JS" --reap --dir "$RUNS" --days 7 "$@" 2>"$TEST_TMP/reap.err")
  __RUN_EXIT=$?
  __RUN_STDERR=$(cat "$TEST_TMP/reap.err")
}

# --- A: ended + aged manifest → reaped ----------------------------------------
mk_manifest "runA.manifest.json" "{\"schema\":1,\"run_id\":\"runA\",\"role\":\"implementer\",\"runner\":\"codex\",\"model\":\"m\",\"worktree\":null,\"lock_path\":null,\"pid\":null,\"scope_unit\":null,\"started_epoch\":$OLD,\"ended_at\":\"x\",\"ended_epoch\":$OLD,\"final_status\":\"committed\"}"
# --- B: ended + fresh manifest → kept ------------------------------------------
mk_manifest "runB.manifest.json" "{\"schema\":1,\"run_id\":\"runB\",\"role\":\"implementer\",\"runner\":\"codex\",\"model\":\"m\",\"worktree\":null,\"lock_path\":null,\"pid\":null,\"scope_unit\":null,\"started_epoch\":$NOW,\"ended_at\":\"x\",\"ended_epoch\":$NOW,\"final_status\":\"committed\"}"

# --- C: not-ended + lock HELD → skipped_live, never reaped ---------------------
WT_LIVE="$TEST_TMP/wt-live"
mkdir -p "$WT_LIVE"
printf 'created_at=%s\nschema=1\n' "$OLD" > "$WT_LIVE/.autopilot-worktree"
: > "$WT_LIVE/.autopilot-worktree.lock"
mk_manifest "runC.manifest.json" "{\"schema\":1,\"run_id\":\"runC\",\"role\":\"implementer\",\"runner\":\"codex\",\"model\":\"m\",\"worktree\":\"$WT_LIVE\",\"lock_path\":\"$WT_LIVE/.autopilot-worktree.lock\",\"pid\":null,\"scope_unit\":null,\"started_epoch\":$OLD,\"ended_at\":null,\"ended_epoch\":null,\"final_status\":null}"

# --- D: not-ended + dead + aged + marked worktree → both reaped -----------------
WT_DEAD="$TEST_TMP/wt-dead"
mkdir -p "$WT_DEAD"
printf 'created_at=%s\nschema=1\n' "$OLD" > "$WT_DEAD/.autopilot-worktree"
: > "$WT_DEAD/.autopilot-worktree.lock"
: > "$WT_DEAD/some-artifact.txt"
mk_manifest "runD.manifest.json" "{\"schema\":1,\"run_id\":\"runD\",\"role\":\"implementer\",\"runner\":\"codex\",\"model\":\"m\",\"worktree\":\"$WT_DEAD\",\"lock_path\":\"$WT_DEAD/.autopilot-worktree.lock\",\"pid\":null,\"scope_unit\":null,\"started_epoch\":$OLD,\"ended_at\":null,\"ended_epoch\":null,\"final_status\":null}"

# --- F: dead + aged but worktree has NO marker → manifest reaped, wt kept ------
WT_NOMARK="$TEST_TMP/wt-nomark"
mkdir -p "$WT_NOMARK"
: > "$WT_NOMARK/precious.txt"
mk_manifest "runF.manifest.json" "{\"schema\":1,\"run_id\":\"runF\",\"role\":\"implementer\",\"runner\":\"codex\",\"model\":\"m\",\"worktree\":\"$WT_NOMARK\",\"lock_path\":null,\"pid\":null,\"scope_unit\":null,\"started_epoch\":$OLD,\"ended_at\":null,\"ended_epoch\":null,\"final_status\":null}"

# ================= dry-run first: nothing may be deleted =======================
(
  exec 9>"$WT_LIVE/.autopilot-worktree.lock"
  flock -n 9 || exit 97
  run_reap --dry-run
  assert_exit_code "$__RUN_EXIT" 0 "dry-run exit 0"
  assert_contains "$__RUN_STDOUT" '"dry_run": true' "dry-run flagged in JSON"
  assert_file_exists "$RUNS/runA.manifest.json" "dry-run keeps manifest A"
  assert_file_exists "$WT_DEAD/some-artifact.txt" "dry-run keeps dead worktree"

  # ================= real reap ==================================================
  run_reap
  assert_exit_code "$__RUN_EXIT" 0 "reap exit 0"

  assert_file_absent "$RUNS/runA.manifest.json" "A: ended+aged manifest reaped"
  assert_file_exists "$RUNS/runB.manifest.json" "B: ended+fresh manifest kept"
  assert_contains "$__RUN_STDOUT" '"skipped_fresh"' "skipped_fresh reported"

  assert_file_exists "$RUNS/runC.manifest.json" "C: live run manifest kept"
  assert_file_exists "$WT_LIVE/.autopilot-worktree" "C: live worktree kept"
  assert_contains "$__RUN_STDOUT" '"skipped_live"' "skipped_live reported"

  assert_file_absent "$RUNS/runD.manifest.json" "D: dead+aged manifest reaped"
  assert_file_absent "$WT_DEAD" "D: dead marked worktree removed"

  assert_file_absent "$RUNS/runF.manifest.json" "F: dead+aged manifest reaped (no marker)"
  assert_file_exists "$WT_NOMARK/precious.txt" "F: unmarked worktree NEVER removed"

  # counters/lists in JSON
  assert_contains "$__RUN_STDOUT" '"reaped_manifests"' "reaped_manifests key"
  assert_contains "$__RUN_STDOUT" '"reaped_worktrees"' "reaped_worktrees key"

  # write per-subshell results out for finalize (subshell loses counters)
  echo "$__TEST_PASS_COUNT" > "$TEST_TMP/subshell-pass"
  printf '%s\n' "${__TEST_FAIL_MSGS[@]:-}" > "$TEST_TMP/subshell-fail"
)
rc=$?
if [ "$rc" -eq 97 ]; then
  fail "could not hold flock for live-run simulation"
else
  # merge subshell assertion bookkeeping back into this shell
  __TEST_PASS_COUNT=$((__TEST_PASS_COUNT + $(cat "$TEST_TMP/subshell-pass" 2>/dev/null || echo 0)))
  while IFS= read -r line; do
    [ -n "$line" ] && __TEST_FAIL_MSGS+=("$line")
  done < "$TEST_TMP/subshell-fail"
fi

# --- unparseable manifest is skipped with an error entry, not deleted ----------
printf 'not json' > "$RUNS/junk.manifest.json"
touch -d "30 days ago" "$RUNS/junk.manifest.json"
run_reap
assert_exit_code "$__RUN_EXIT" 0 "reap with junk exit 0"
assert_file_exists "$RUNS/junk.manifest.json" "unparseable manifest not deleted"
assert_contains "$__RUN_STDOUT" '"errors"' "errors key present"

# --- absent dir → clean empty result -------------------------------------------
__RUN_STDOUT=$(node "$STATUS_JS" --reap --dir "$TEST_TMP/absent-runs" --days 7 2>&1)
assert_exit_code $? 0 "absent dir exit 0"
assert_contains "$__RUN_STDOUT" '"scanned": 0' "absent dir scanned 0"

finalize_test
