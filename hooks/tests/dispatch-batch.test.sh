#!/usr/bin/env bash
# dispatch-batch.sh integration test — the Tier-2 batch fan-out engine
# (Phase L). Proves the unattended safety rails against REAL throwaway git
# repos/commits (artifacts, never self-report) + an EMPIRICAL setsid/SIGTERM
# kill-trap proof (never by reasoning — see memory bash-INT-pgroup-trap).
#
# Covers the Phase-L acceptance criteria:
#   * Synthetic-split dry-run: per-unit outcome table is correct from git
#     artifacts; ALL-OR-NOTHING aborts when one unit is non-committed OR touches
#     outside its declared scope.
#   * Merge-back: an all-good batch merges all units onto base; an injected
#     conflict triggers serial_collapse naming the right ids and merges nothing.
#   * Single-base enforcement: mixed-base units → exit 1 "not a valid decomposition".
#   * Parallel-kill trap: setsid a fake long-running worker group, SIGTERM via the
#     reap subcommand, assert the processes are GONE (empirically); --unit reaps
#     one, --abort reaps all.
#   * Telemetry: events append to a per-run Amdahl store; report computes
#     serial-fraction + speedup across runs.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/dispatch-batch.sh"

# ── helpers ───────────────────────────────────────────────────────────────────
# mkrepo <dir> : init a sandbox git repo with src/ui/a.ts + src/api/b.ts on main.
mkrepo() {
  local d="$1"
  mkdir -p "$d/src/ui" "$d/src/api"
  git -C "$d" init -q -b main
  git -C "$d" config user.email t@t
  git -C "$d" config user.name t
  echo a > "$d/src/ui/a.ts"
  echo b > "$d/src/api/b.ts"
  git -C "$d" add -A
  git -C "$d" commit -q -m base
}
# mkunit <repo> <unit-id> <run-id> <relpath> <content> : create unit branch +
# a real worker commit touching <relpath> (a worktree the worker "owned").
mkunit() {
  local repo="$1" id="$2" run="$3" rel="$4" content="$5"
  local br="unit-$id-$run"
  local wt="$repo/.wt-$id"
  git -C "$repo" branch "$br" main
  git -C "$repo" worktree add -q "$wt" "$br"
  printf '%s\n' "$content" >> "$wt/$rel"
  git -C "$wt" add -A
  git -C "$wt" commit -q -m "$id work"
}

# ════════════════════════════════════════════════════════════════════════════
# 0. --help exits 0 and documents the core invariants
# ════════════════════════════════════════════════════════════════════════════
HELP_OUT="$("$SCRIPT" --help 2>&1)"; HELP_EXIT=$?
assert_eq "0" "$HELP_EXIT" "--help exit 0"
assert_contains "$HELP_OUT" "ALL-OR-NOTHING" "--help states all-or-nothing"
assert_contains "$HELP_OUT" "serial_collapse" "--help documents merge-conflict-as-missing-edge"
assert_contains "$HELP_OUT" "single-base" "--help states single-base-per-batch"

# ════════════════════════════════════════════════════════════════════════════
# 1. PLAN — happy path + collision-safe branch names + advisory propose
# ════════════════════════════════════════════════════════════════════════════
R="$TEST_TMP/r1"; mkrepo "$R"
cat > "$TEST_TMP/units1.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/api/**","base":"main"}
EOF
OUT="$("$SCRIPT" plan --repo "$R" --units "$TEST_TMP/units1.jsonl" --run-id run1)"; EXIT=$?
assert_eq "0" "$EXIT" "plan happy path exit 0"
assert_contains "$OUT" '"valid": true' "plan valid:true"
assert_contains "$OUT" '"verdict": "ready"' "plan verdict ready"
assert_contains "$OUT" '"branch": "unit-ui-run1"' "plan collision-safe branch name unit-<id>-<run-id>"
assert_contains "$OUT" '"branch": "unit-api-run1"' "plan second branch name"
assert_contains "$OUT" '"width": 2' "plan reports width"
assert_contains "$OUT" '"advisory_disjoint": "true"' "plan advisory propose = disjoint"

# advisory overlap surface is LOGGED, NOT a hard fail (plan still exit 0/ready).
cat > "$TEST_TMP/units_overlap.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/ui/x.ts,src/api/**","base":"main"}
EOF
OUT="$("$SCRIPT" plan --repo "$R" --units "$TEST_TMP/units_overlap.jsonl" --run-id run1)"; EXIT=$?
assert_eq "0" "$EXIT" "plan with overlap is ADVISORY — still exit 0 (not the clamp)"
assert_contains "$OUT" '"advisory_disjoint": "false"' "plan surfaces advisory overlap"
assert_contains "$OUT" '"verdict": "ready"' "plan overlap still ready (advisory, not hard-fail)"

# ════════════════════════════════════════════════════════════════════════════
# 2. SINGLE-BASE ENFORCEMENT — mixed-base units → exit 1, "not a valid decomposition"
# ════════════════════════════════════════════════════════════════════════════
cat > "$TEST_TMP/units_mixed.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/api/**","base":"develop"}
EOF
OUT="$("$SCRIPT" plan --repo "$R" --units "$TEST_TMP/units_mixed.jsonl" --run-id run1)"; EXIT=$?
assert_eq "1" "$EXIT" "mixed-base → exit 1"
assert_contains "$OUT" '"verdict": "abort"' "mixed-base verdict abort"
assert_contains "$OUT" "not a valid decomposition" "mixed-base names the violation"

# ════════════════════════════════════════════════════════════════════════════
# 3. VERIFY — synthetic-split dry-run: per-unit outcome table correct from git
#    artifacts; ALL units committed + in-scope → all_committed (exit 0).
# ════════════════════════════════════════════════════════════════════════════
R3="$TEST_TMP/r3"; mkrepo "$R3"
mkunit "$R3" ui  run3 "src/ui/a.ts"  "ui change"
mkunit "$R3" api run3 "src/api/b.ts" "api change"
cat > "$TEST_TMP/units3.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/api/**","base":"main"}
EOF
OUT="$("$SCRIPT" verify --repo "$R3" --units "$TEST_TMP/units3.jsonl" --run-id run3)"; EXIT=$?
assert_eq "0" "$EXIT" "verify all-committed exit 0"
assert_contains "$OUT" '"verdict": "all_committed"' "verify verdict all_committed"
assert_contains "$OUT" '"id": "ui", "branch": "unit-ui-run3", "status": "committed"' "verify ui committed (from git artifact)"
assert_contains "$OUT" '"id": "api", "branch": "unit-api-run3", "status": "committed"' "verify api committed"
assert_contains "$OUT" '"disjoint": true' "verify in-scope → disjoint true"

# ════════════════════════════════════════════════════════════════════════════
# 4. VERIFY ALL-OR-NOTHING — one unit touches OUTSIDE its scope → abort (exit 1).
#    Proven from the REAL git diff, NOT self-report.
# ════════════════════════════════════════════════════════════════════════════
R4="$TEST_TMP/r4"; mkrepo "$R4"
# ui worker sneakily ALSO touches src/api → out of declared scope.
git -C "$R4" branch unit-ui-run4 main
git -C "$R4" worktree add -q "$R4/.wt-ui" unit-ui-run4
echo "ui change"  >> "$R4/.wt-ui/src/ui/a.ts"
echo "sneaky api" >> "$R4/.wt-ui/src/api/b.ts"
git -C "$R4/.wt-ui" add -A; git -C "$R4/.wt-ui" commit -q -m "ui + sneaky api"
mkunit "$R4" api run4 "src/api/b.ts" "api change"
cat > "$TEST_TMP/units4.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/api/**","base":"main"}
EOF
OUT="$("$SCRIPT" verify --repo "$R4" --units "$TEST_TMP/units4.jsonl" --run-id run4)"; EXIT=$?
assert_eq "1" "$EXIT" "ALL-OR-NOTHING: out-of-scope unit → exit 1"
assert_contains "$OUT" '"verdict": "abort"' "out-of-scope verdict abort"
assert_contains "$OUT" '"disjoint": false' "out-of-scope unit disjoint false"
assert_contains "$OUT" '"src/api/b.ts"' "out-of-scope file named in undeclared_touches"

# ════════════════════════════════════════════════════════════════════════════
# 5. VERIFY ALL-OR-NOTHING — one unit non-committed (no_op) → abort.
# ════════════════════════════════════════════════════════════════════════════
R5="$TEST_TMP/r5"; mkrepo "$R5"
mkunit "$R5" ui run5 "src/ui/a.ts" "ui change"
git -C "$R5" branch unit-api-run5 main   # branch exists but NO commit → no_op
OUT="$("$SCRIPT" verify --repo "$R5" --units "$TEST_TMP/units3.jsonl" --run-id run5)"; EXIT=$?
assert_eq "1" "$EXIT" "ALL-OR-NOTHING: a no_op unit → exit 1"
assert_contains "$OUT" '"verdict": "abort"' "no_op verdict abort"
assert_contains "$OUT" '"status": "no_op"' "no_op unit reported"

# branch never created → failure (commit:null), still aborts.
R5b="$TEST_TMP/r5b"; mkrepo "$R5b"
mkunit "$R5b" ui run5 "src/ui/a.ts" "ui change"
cat > "$TEST_TMP/units5b.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"missing","scope":"src/x/**","base":"main"}
EOF
OUT="$("$SCRIPT" verify --repo "$R5b" --units "$TEST_TMP/units5b.jsonl" --run-id run5)"; EXIT=$?
assert_eq "1" "$EXIT" "missing branch → abort exit 1"
assert_contains "$OUT" '"status": "failure"' "missing branch → failure status"
assert_contains "$OUT" '"commit": null' "failure commit is null (non-whitespace delim preserved empty field)"

# ════════════════════════════════════════════════════════════════════════════
# 6. MERGE-BACK — an all-good batch merges all units onto base.
# ════════════════════════════════════════════════════════════════════════════
R6="$TEST_TMP/r6"; mkrepo "$R6"
mkunit "$R6" ui  run6 "src/ui/a.ts"  "ui change"
mkunit "$R6" api run6 "src/api/b.ts" "api change"
OUT="$("$SCRIPT" merge-back --repo "$R6" --units "$TEST_TMP/units3.jsonl" --run-id run6 --base main)"; EXIT=$?
assert_eq "0" "$EXIT" "merge-back all-good exit 0"
assert_contains "$OUT" '"verdict": "merged"' "merge-back verdict merged"
assert_contains "$OUT" '"merged": ["ui", "api"]' "merge-back merged both units"
# base BRANCH actually advanced AND carries both unit changes (real artifacts).
MAIN_UI="$(git -C "$R6" show main:src/ui/a.ts | tail -1)"
MAIN_API="$(git -C "$R6" show main:src/api/b.ts | tail -1)"
assert_eq "ui change"  "$MAIN_UI"  "merge-back: ui change landed on base"
assert_eq "api change" "$MAIN_API" "merge-back: api change landed on base"
# no leaked integration worktree/branch
LEAK_WT="$(git -C "$R6" worktree list | grep -c integ || true)"
assert_eq "0" "$LEAK_WT" "merge-back leaves no integration worktree"

# ════════════════════════════════════════════════════════════════════════════
# 7. MERGE-BACK — injected CONFLICT → serial_collapse, merges NOTHING.
#    Two units edit the SAME line of the SAME file: each is FILES-disjoint within
#    its own declared scope (so verify passes — files-only), but the merge
#    conflicts. This is the merge-conflict-as-missing-edge path.
# ════════════════════════════════════════════════════════════════════════════
R7="$TEST_TMP/r7"; mkrepo "$R7"
echo "line1" > "$R7/shared.txt"; git -C "$R7" add -A; git -C "$R7" commit -q -m shared
# both units declare ONLY shared.txt and both rewrite its single line.
git -C "$R7" branch unit-u1-run7 main
git -C "$R7" worktree add -q "$R7/.wt-u1" unit-u1-run7
printf 'u1edit\n' > "$R7/.wt-u1/shared.txt"; git -C "$R7/.wt-u1" add -A; git -C "$R7/.wt-u1" commit -q -m u1
git -C "$R7" branch unit-u2-run7 main
git -C "$R7" worktree add -q "$R7/.wt-u2" unit-u2-run7
printf 'u2edit\n' > "$R7/.wt-u2/shared.txt"; git -C "$R7/.wt-u2" add -A; git -C "$R7/.wt-u2" commit -q -m u2
cat > "$TEST_TMP/units7.jsonl" <<EOF
{"id":"u1","scope":"shared.txt","base":"main"}
{"id":"u2","scope":"shared.txt","base":"main"}
EOF
# verify passes (each unit's commit is files-disjoint within its own scope).
OUT="$("$SCRIPT" verify --repo "$R7" --units "$TEST_TMP/units7.jsonl" --run-id run7)"; EXIT=$?
assert_eq "0" "$EXIT" "conflict-pair passes files-only verify (the carve-out)"
MAIN_BEFORE="$(git -C "$R7" rev-parse main)"
OUT="$("$SCRIPT" merge-back --repo "$R7" --units "$TEST_TMP/units7.jsonl" --run-id run7 --base main)"; EXIT=$?
assert_eq "1" "$EXIT" "merge-back conflict → exit 1"
assert_contains "$OUT" '"verdict": "serial_collapse"' "conflict → serial_collapse"
assert_contains "$OUT" '"conflict_unit": "u2"' "serial_collapse names the conflicting unit"
assert_contains "$OUT" '"serial_collapse_ids": ["u1", "u2"]' "serial_collapse names the coupled pair"
assert_contains "$OUT" '"merged": []' "serial_collapse merged nothing"
MAIN_AFTER="$(git -C "$R7" rev-parse main)"
assert_eq "$MAIN_BEFORE" "$MAIN_AFTER" "conflict: base ref UNTOUCHED (merged nothing)"
LEAK_WT="$(git -C "$R7" worktree list | grep -c integ || true)"
assert_eq "0" "$LEAK_WT" "conflict: no leaked integration worktree"

# ════════════════════════════════════════════════════════════════════════════
# 8. MERGE-BACK re-checks (never trusts a stale verdict) — refuses an unverified
#    batch (out-of-scope unit) even when asked to merge.
# ════════════════════════════════════════════════════════════════════════════
R8="$TEST_TMP/r8"; mkrepo "$R8"
git -C "$R8" branch unit-ui-run8 main
git -C "$R8" worktree add -q "$R8/.wt-ui" unit-ui-run8
echo "ui change"  >> "$R8/.wt-ui/src/ui/a.ts"
echo "sneaky api" >> "$R8/.wt-ui/src/api/b.ts"
git -C "$R8/.wt-ui" add -A; git -C "$R8/.wt-ui" commit -q -m "ui+sneaky"
mkunit "$R8" api run8 "src/api/b.ts" "api change"
cat > "$TEST_TMP/units8.jsonl" <<EOF
{"id":"ui","scope":"src/ui/**","base":"main"}
{"id":"api","scope":"src/api/**","base":"main"}
EOF
MAIN_BEFORE="$(git -C "$R8" rev-parse main)"
OUT="$("$SCRIPT" merge-back --repo "$R8" --units "$TEST_TMP/units8.jsonl" --run-id run8 --base main)"; EXIT=$?
assert_eq "1" "$EXIT" "merge-back re-check refuses unverified batch (exit 1)"
assert_contains "$OUT" '"verdict": "abort"' "merge-back re-check verdict abort"
assert_eq "$MAIN_BEFORE" "$(git -C "$R8" rev-parse main)" "merge-back abort: base untouched"

# ════════════════════════════════════════════════════════════════════════════
# 9. TELEMETRY — events append to a per-run Amdahl store; report computes
#    serial-fraction + speedup.
# ════════════════════════════════════════════════════════════════════════════
TSTORE="$TEST_TMP/telem/runT.jsonl"
OUT="$("$SCRIPT" telemetry --run-id runT --event t_dispatch --store "$TSTORE")"; EXIT=$?
assert_eq "0" "$EXIT" "telemetry t_dispatch exit 0"
assert_contains "$OUT" '"event": "t_dispatch"' "telemetry event echoed"
"$SCRIPT" telemetry --run-id runT --event t_all_committed --store "$TSTORE" >/dev/null
"$SCRIPT" telemetry --run-id runT --event t_review_done   --store "$TSTORE" >/dev/null
assert_file_exists "$TSTORE" "telemetry store created"
STORE_LINES="$(awk 'END{print NR}' "$TSTORE")"
assert_eq "3" "$STORE_LINES" "telemetry appended 3 events"
# report over a store with KNOWN distinct epochs (the live events above can all
# land in one wall-clock second → wall_s 0; the report correctly skips a zero-wall
# run, so we assert the Amdahl math against a deterministic synthetic store).
TSTORE2="$TEST_TMP/telem/runT2.jsonl"
mkdir -p "$(dirname "$TSTORE2")"
{
  printf '{ "run_id": "runT2", "event": "t_dispatch", "epoch": 1000, "iso": "x" }\n'
  printf '{ "run_id": "runT2", "event": "t_all_committed", "epoch": 1080, "iso": "x" }\n'
  printf '{ "run_id": "runT2", "event": "t_review_done", "epoch": 1100, "iso": "x" }\n'
} > "$TSTORE2"
OUT="$("$SCRIPT" telemetry report --store "$TSTORE2")"; EXIT=$?
assert_eq "0" "$EXIT" "telemetry report exit 0"
assert_contains "$OUT" '"report": true' "telemetry report shape"
# parallel 80s, serial tail 20s, wall 100s → serial_fraction 0.200, speedup 5.00
assert_contains "$OUT" '"parallel_s": 80' "telemetry report parallel section"
assert_contains "$OUT" '"serial_s": 20' "telemetry report serial tail"
assert_contains "$OUT" '"serial_fraction": 0.200' "telemetry report computes serial_fraction"
assert_contains "$OUT" '"amdahl_speedup_bound": "5.00"' "telemetry report computes speedup bound"
# bad event → exit 2
OUT="$("$SCRIPT" telemetry --run-id runT --event bogus --store "$TSTORE" 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "telemetry bad event → exit 2"

# ════════════════════════════════════════════════════════════════════════════
# 10. PARALLEL-KILL TRAP — the CRITICAL empirical proof (setsid + SIGTERM).
#     Per the repo lesson (memory bash-INT-pgroup-trap), this is verified by
#     killing real process GROUPS and checking they are GONE — never by reasoning.
#     --unit reaps ONE stalled unit (keep the rest); --abort reaps ALL.
# ════════════════════════════════════════════════════════════════════════════
REAPDIR="$TEST_TMP/reap/runK"
mkdir -p "$REAPDIR"
# Launch two fake long-running workers, each in its OWN process group (setsid),
# and register each group's pgid — exactly what the dispatch loop does.
setsid bash -c 'sleep 300' &
W1=$!
PG1="$(ps -o pgid= -p "$W1" | tr -d ' ')"
echo "$PG1" > "$REAPDIR/u1.pgid"
setsid bash -c 'sleep 300' &
W2=$!
PG2="$(ps -o pgid= -p "$W2" | tr -d ' ')"
echo "$PG2" > "$REAPDIR/u2.pgid"

# Both alive before any reap.
kill -0 "$W1" 2>/dev/null && U1_BEFORE=alive || U1_BEFORE=gone
kill -0 "$W2" 2>/dev/null && U2_BEFORE=alive || U2_BEFORE=gone
assert_eq "alive" "$U1_BEFORE" "kill-trap: u1 worker alive before reap"
assert_eq "alive" "$U2_BEFORE" "kill-trap: u2 worker alive before reap"

# reap ONE unit — only u1's group dies, u2 keeps running ("one unit stalled").
OUT="$("$SCRIPT" reap --run-id runK --store "$REAPDIR" --unit u1)"; EXIT=$?
assert_eq "0" "$EXIT" "reap --unit exit 0"
assert_contains "$OUT" '"reaped": ["u1"]' "reap --unit reaped only u1"
# give the SIGTERM a beat to land (poll, not a fixed sleep that could flake).
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$W1" 2>/dev/null || break; sleep 0.2; done
kill -0 "$W1" 2>/dev/null && U1_AFTER=alive || U1_AFTER=gone
kill -0 "$W2" 2>/dev/null && U2_AFTER=alive || U2_AFTER=gone
assert_eq "gone"  "$U1_AFTER" "kill-trap EMPIRICAL: u1 worker GONE after reap --unit u1"
assert_eq "alive" "$U2_AFTER" "kill-trap EMPIRICAL: u2 worker still alive (one-unit reap, kept the rest)"

# reap --abort — the remaining u2 group dies too ("batch aborted").
OUT="$("$SCRIPT" reap --run-id runK --store "$REAPDIR" --abort)"; EXIT=$?
assert_eq "0" "$EXIT" "reap --abort exit 0"
assert_contains "$OUT" '"reaped": ["u2"]' "reap --abort reaped remaining u2"
for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$W2" 2>/dev/null || break; sleep 0.2; done
kill -0 "$W2" 2>/dev/null && U2_FINAL=alive || U2_FINAL=gone
assert_eq "gone" "$U2_FINAL" "kill-trap EMPIRICAL: u2 worker GONE after reap --abort"

# reap usage errors
OUT="$("$SCRIPT" reap --run-id runK --store "$REAPDIR" 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "reap without --abort/--unit → exit 2"
OUT="$("$SCRIPT" reap --run-id runK --store "$TEST_TMP/no-such-dir" --abort 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "reap missing reap dir → exit 2"

# defensive cleanup of any straggler groups (the test must not leak sleeps).
kill -TERM "-$PG1" "-$PG2" 2>/dev/null || true
wait 2>/dev/null || true

# ════════════════════════════════════════════════════════════════════════════
# 11. USAGE / PRECONDITION
# ════════════════════════════════════════════════════════════════════════════
OUT="$("$SCRIPT" bogus-mode 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "unknown mode → exit 2"
OUT="$("$SCRIPT" plan --repo "$R" --run-id x 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "plan without --units → exit 2"
OUT="$("$SCRIPT" plan --repo "$TEST_TMP/not-a-repo" --units "$TEST_TMP/units1.jsonl" --run-id x 2>/dev/null)"; EXIT=$?
assert_eq "2" "$EXIT" "plan on non-git repo → exit 2"
# TSV units file is also accepted.
printf 'uiT\tsrc/ui/**\tmain\napiT\tsrc/api/**\tmain\n' > "$TEST_TMP/units.tsv"
OUT="$("$SCRIPT" plan --repo "$R" --units "$TEST_TMP/units.tsv" --run-id runT2)"; EXIT=$?
assert_eq "0" "$EXIT" "TSV units file accepted"
assert_contains "$OUT" '"branch": "unit-uiT-runT2"' "TSV unit parsed (id from column 1)"

# clean up any sandbox worktrees so finalize's rm -rf doesn't fight git locks
for R in "$R3" "$R4" "$R5" "$R5b" "$R6" "$R7" "$R8"; do
  [ -d "$R" ] && git -C "$R" worktree prune 2>/dev/null || true
done

finalize_test
