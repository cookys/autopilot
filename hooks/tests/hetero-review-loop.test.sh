#!/usr/bin/env bash
# hetero-review-loop.test.sh — contract test for scripts/hetero-review-loop.js
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/hetero-review-loop.js"

# ─── collect ───

# Set up scratch test environment
SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "c1"
  echo "second" > file.txt
  git add file.txt
  git commit -q -m "c2"
)

PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

# Add another commit on branch 'work' for diff tests
(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "work changes" >> file.txt
  git add file.txt
  git commit -q -m "c3"
)

mkdir -p "$TEST_TMP/bin"

# Stub dispatch-review.sh
cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$LOG_DISPATCH_ARGS" ]; then
  echo "SEAT:$STUB_SEAT_ID ARGS:$*" >> "$LOG_DISPATCH_ARGS"
fi

if [ -n "$SIMULATE_HEAD_MOVE" ]; then
  # Append commit to scratch repo to move head
  echo "moved" >> "$REPO_FOR_TEST/file.txt"
  git -C "$REPO_FOR_TEST" commit -q -am "moved commit"
fi

if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi

if [ -n "$STUB_SEAT_RESPONSE" ]; then
  echo "$STUB_SEAT_RESPONSE"
  exit 0
fi

echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
cp "$REPO_ROOT/scripts/check-dispatch-suppression.sh" "$SCRATCH_REPO/scripts/check-dispatch-suppression.sh"
chmod +x "$SCRATCH_REPO/scripts/check-dispatch-suppression.sh"

# Point the driver at the stub dispatcher by default (test seam). Individual cases that need a
# different dispatcher (a non-zero-exit stub, or the isolated driver-directory test) override or
# unset this locally and restore it afterward.
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"

# Stub resolve-review-loop.sh
cat << 'RESOLVE_EOF' > "$TEST_TMP/bin/resolve-review-loop.sh"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then
  case "$2" in
    reviewer_engine) echo "x" ;;
    reviewer_runner) echo "agy" ;;
    reviewer_effort) echo "low" ;;
    reviewer_endpoint) echo "" ;;
    *) echo "" ;;
  esac
  exit 0
fi
echo '{"reviewer_engine": "x", "reviewer_runner": "agy", "reviewer_effort": "low", "reviewer_endpoint": "@none", "qc_panel_seats_complete": true, "qc_panel_seats": [{"role": "qc", "runner": "agy", "model": "x", "effort": "low", "endpoint": null, "family": "unknown"}]}'
RESOLVE_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop.sh"

LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"

# Case 1: --help exits 0 and contains Usage:
HELP_OUT=$(node "$SCRIPT" --help 2>&1); HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "case 1: --help exits 0"
assert_contains "$HELP_OUT" "Usage:" "case 1: --help outputs usage instructions"
assert_contains "$HELP_OUT" "--exclude" "case 1: --help documents --exclude flag"

# Case 2: generation 1 without --phase-base exits 2
C2_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p1 --generation 1 --branch work 2>&1); C2_RC=$?
assert_exit_code "$C2_RC" "2" "case 2: gen 1 without --phase-base exits 2"

# Case 3: generation 1 with three seats all reviewed exits 0, writes range.json, diff.txt, findings.json, chain.json
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
C3_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p1 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy,m3/high@grok" 2>&1); C3_RC=$?
assert_exit_code "$C3_RC" "0" "case 3: exits 0 on 3 reviewed seats"
assert_file_exists "$LEDGER/review-p1/g1/range.json" "case 3: range.json exists"
assert_file_exists "$LEDGER/review-p1/g1/diff.txt" "case 3: diff.txt exists"
assert_file_exists "$LEDGER/review-p1/g1/findings.json" "case 3: findings.json exists"
assert_file_exists "$LEDGER/review-p1/chain.json" "case 3: chain.json exists"
assert_contains "$(cat "$LEDGER/review-p1/chain.json")" '"status": "pending"' "case 3: chain entry status is pending"
assert_contains "$(cat "$LEDGER/review-p1/g1/findings.json")" '"findings": []' "case 3: findings array is empty"
assert_file_exists "$LEDGER/phase-p1.base" "case 3: phase base persisted at the documented ledger-root path"
assert_eq "$(cat "$LEDGER/phase-p1.base")" "$PHASE_BASE" "case 3: ledger-root phase base file content matches --phase-base"
assert_file_absent "$LEDGER/review-p1/phase-p1.base" "case 3: phase base is NOT written under review-p1/ (that was the doc-path-mismatch defect)"

# Case 3b (P7d): a completed round publishes a small summary to the live dir, keyed by the repo's project_key; ledger untouched
R_KEY=$(node -e 'const {scopeFromCwd}=require(process.argv[1]); process.stdout.write(scopeFromCwd(process.argv[2]).project_key||"")' "$REPO_ROOT/src/status/project-key.js" "$SCRATCH_REPO")
R_FILE="$AUTOPILOT_LIVE_DIR/review-rounds/$R_KEY.json"
assert_file_exists "$R_FILE" "case 3b: round summary written under <live>/review-rounds/<project_key>.json"
R_JSON=$(cat "$R_FILE" 2>/dev/null)
assert_eq "$(node -e 'const j=JSON.parse(process.argv[1]); console.log([j.schema,j.project_key===process.argv[2],j.phase,j.generation,j.base===process.argv[3],j.seats.length,j.seats[0].status,j.seats[0].verdict,j.converged,typeof j.at].join("|"))' "$R_JSON" "$R_KEY" "$PHASE_BASE")" "autopilot.review-round/1|true|p1|1|true|3|reviewed|SHIP-AS-IS|true|string" "case 3b: summary shape (phase, generation, base, seats, converged, at)"

# Case 4: a seat with findings text containing one Critical and one Major produces two entries with distinct ids
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "FIX-THEN-SHIP", "findings": "Critical: SQL injection vulnerability\nDetailed description here.\n\nMajor: Unhandled promise rejection\nMore details."}'
C4_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p4 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C4_RC=$?
assert_exit_code "$C4_RC" "0" "case 4: exits 0"
FINDINGS_C4=$(cat "$LEDGER/review-p4/g1/findings.json")
assert_contains "$FINDINGS_C4" '"severity": "Critical"' "case 4: has Critical finding"
assert_contains "$FINDINGS_C4" '"severity": "Major"' "case 4: has Major finding"
# Verify distinct IDs
ID1=$(node -e 'const f = JSON.parse(fs.readFileSync(process.argv[1])).findings; console.log(f[0].id);' "$LEDGER/review-p4/g1/findings.json")
ID2=$(node -e 'const f = JSON.parse(fs.readFileSync(process.argv[1])).findings; console.log(f[1].id);' "$LEDGER/review-p4/g1/findings.json")
[ "$ID1" != "$ID2" ]; ID_DIFF_RC=$?
assert_exit_code "$ID_DIFF_RC" "0" "case 4: finding IDs are distinct"

# Case 4b (P7d): a round with findings is not converged and replaces the latest summary of the repo
assert_eq "$(node -e 'const j=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log([j.phase,j.converged,j.seats[0].verdict].join("|"))' "$R_FILE")" "p4|false|FIX-THEN-SHIP" "case 4b: latest round wins; findings => converged false"

# Case 5: a seat returning {status: "no_verdict"} without --allow-seat-gap exits 1 and chain.json is not updated
export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
export STUB_RESPONSE_s1='{"status": "no_verdict"}'
unset STUB_SEAT_RESPONSE
C5_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p5 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: exits 1 on gap without --allow-seat-gap"
assert_file_exists "$LEDGER/review-p5/g1/range.json" "case 5: range.json written before exit"
assert_file_exists "$LEDGER/review-p5/g1/seat-s1.json" "case 5: seat-s1.json written"
assert_contains "$(cat "$LEDGER/review-p5/chain.json")" '"reason": "seat_gap"' "case 5: gap recorded as an aborted chain entry (was: no chain.json, generation stranded)"
assert_file_absent "$LEDGER/review-p5/g1/findings.json" "case 5: findings.json not written"

# Case 5i (BL-0293): an idle-killed seat (dispatch-review: no_verdict, error seat_idle_timeout) is an ordinary
# seat gap: generation aborted as seat_gap, the swap-the-seat re-collect path, and the code survives in the artifact.
export STUB_RESPONSE_s1='{"status": "no_verdict", "verdict": null, "findings": "", "error": "seat_idle_timeout: no output growth for 600s — seat killed, partial output not parsed"}'
C5I_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p5i --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" 2>&1); C5I_RC=$?
assert_exit_code "$C5I_RC" "1" "case 5i: idle-killed seat fails the generation without --allow-seat-gap"
assert_contains "$(cat "$LEDGER/review-p5i/chain.json")" '"reason": "seat_gap"' "case 5i: recorded as seat_gap"
assert_contains "$(cat "$LEDGER/review-p5i/g1/seat-s1.json")" 'seat_idle_timeout' "case 5i: idle reason kept in the seat artifact"

# Case 6: same as (5) but with --allow-seat-gap AND a receipt floor the surviving seat count
# satisfies (AUTOPILOT_MIN_REVIEWED_SEATS=1, the same knob the checker honours) exits 0 and
# chain.json has pending-with-gap; the WARN names the floor for the checker.
C6_OUT=$(AUTOPILOT_MIN_REVIEWED_SEATS=1 node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap 2>&1); C6_RC=$?
assert_exit_code "$C6_RC" "0" "case 6: exits 0 with --allow-seat-gap at/above the floor"
assert_file_exists "$LEDGER/review-p6/chain.json" "case 6: chain.json written"
assert_contains "$(cat "$LEDGER/review-p6/chain.json")" '"status": "pending-with-gap"' "case 6: status is pending-with-gap"
assert_contains "$C6_OUT" "receipt floor is 1 (AUTOPILOT_MIN_REVIEWED_SEATS)" "case 6: WARN names the floor and its source"

# Case 6b (v2.36.5, <host> plan 066): the SAME gap with the DEFAULT floor (all seats) is not
# written as a pending entry the checker would refuse forever — it is recorded aborted
# (seat_gap_below_min), exit 1, and the message names counts, floor and the remedy.
C6B_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6b --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap 2>&1); C6B_RC=$?
assert_exit_code "$C6B_RC" "1" "case 6b: gap below the default floor exits 1"
C6B_CHAIN=$(cat "$LEDGER/review-p6b/chain.json")
assert_contains "$C6B_CHAIN" '"status": "aborted"' "case 6b: generation recorded aborted, not pending-with-gap"
assert_contains "$C6B_CHAIN" '"reason": "seat_gap_below_min"' "case 6b: aborted reason names the seat gap"
assert_contains "$C6B_CHAIN" '"min_reviewed_seats": 2' "case 6b: the floor is recorded on the entry"
assert_not_contains "$C6B_CHAIN" '"head"' "case 6b: an aborted entry carries no head"
assert_contains "$C6B_OUT" "only 1 of 2 seats reviewed, below the receipt floor of 2 (default: all seats)" "case 6b: message names counts and floor"
assert_contains "$C6B_OUT" "Collect generation 2 from the same base" "case 6b: message names the remedy"
# 6b': the next generation continues from the aborted base (v2.36.3 chain semantics), and a
# full-seat result then finalizes normally — the abort never blocks the phase.
export STUB_SEAT_RESPONSE_SAVE="${STUB_SEAT_RESPONSE:-}"
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
C6B2_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6b --generation 2 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C6B2_RC=$?
assert_exit_code "$C6B2_RC" "0" "case 6b': generation 2 collects from the aborted generation's base"
assert_contains "$(cat "$LEDGER/review-p6b/chain.json")" '"generation": 2' "case 6b': generation 2 entry appended"
export STUB_SEAT_RESPONSE="$STUB_SEAT_RESPONSE_SAVE"
# 6c: a garbage floor is refused BEFORE any generation directory or seat exists (review 🟠: a
# post-dispatch refusal left g1/ populated with no chain entry — a wedged phase).
C6C_OUT=$(AUTOPILOT_MIN_REVIEWED_SEATS=zero node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6c --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap 2>&1); C6C_RC=$?
assert_exit_code "$C6C_RC" "1" "case 6c: garbage AUTOPILOT_MIN_REVIEWED_SEATS refused"
assert_contains "$C6C_OUT" "canonical positive integer" "case 6c: refusal names the grammar"
assert_file_absent "$LEDGER/review-p6c/g1" "case 6c: no generation directory was created (no seat spent, phase not wedged)"
assert_file_absent "$LEDGER/review-p6c/chain.json" "case 6c: no chain entry written"

# 6d (review 🟠): the floor applies WITHOUT a gap too — every seat reviewed but the configured
# floor exceeds the seat count ⇒ aborted, never a pending entry the checker refuses forever.
C6D_OUT=$(AUTOPILOT_MIN_REVIEWED_SEATS=3 node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6d --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C6D_RC=$?
assert_exit_code "$C6D_RC" "1" "case 6d: 1 of 1 reviewed but floor 3 ⇒ exit 1"
assert_contains "$(cat "$LEDGER/review-p6d/chain.json")" '"reason": "seat_gap_below_min"' "case 6d: recorded aborted even with no gap"
assert_contains "$C6D_OUT" "only 1 of 1 seats reviewed, below the receipt floor of 3 (AUTOPILOT_MIN_REVIEWED_SEATS)" "case 6d: message names counts and source"

# 6e (review 🟡): the checker's alias spellings are honoured on collect too
C6E_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6e --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap --min-seats 1 2>&1); C6E_RC=$?
assert_exit_code "$C6E_RC" "0" "case 6e: --min-seats 1 (checker alias) accepted on collect"
assert_contains "$(cat "$LEDGER/review-p6e/chain.json")" '"status": "pending-with-gap"' "case 6e: alias floor satisfied ⇒ pending-with-gap"
assert_contains "$C6E_OUT" "receipt floor is 1 (--min-seats)" "case 6e: WARN names the alias as the source"

# Case 7 (negative control): generation 2 attempted over a PENDING (not finalized) generation-1
# predecessor is refused, even under a phase literally named "p7" — the removed legacy carve-out
# ("prevEntry.status === 'pending' && phase === 'p7'") must never resurrect.
mkdir -p "$LEDGER/review-p7"
SEED_BASE="$PHASE_BASE"
# the finalized g1 head must differ from the branch tip: collect refuses an empty g2 range (BL-0269)
SEED_HEAD="$PHASE_BASE"
cat << SEED_EOF > "$LEDGER/review-p7/chain.json"
[
  {
    "generation": 1,
    "base": "$SEED_BASE",
    "head": "$SEED_HEAD",
    "seats": ["s0"],
    "status": "pending"
  }
]
SEED_EOF
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
unset STUB_RESPONSE_s0
unset STUB_RESPONSE_s1
C7NEG_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p7 --generation 2 --branch work --seats "m1/low@codex" 2>&1); C7NEG_RC=$?
assert_exit_code "$C7NEG_RC" "1" "case 7 negative: gen 2 refused when gen 1 is pending (not finalized), even under phase literally named p7"
assert_contains "$C7NEG_OUT" "is not finalized" "case 7 negative: refusal message names the not-finalized predecessor"
assert_file_absent "$LEDGER/review-p7/g2" "case 7 negative: no g2 directory created on refusal"

# Case 7: generation 2 with chain.json seeded with a FINALIZED g1 head X uses X as base
# (fixed: legacy p7 carve-out removed, so the predecessor must actually be finalized)
cat << SEED_EOF > "$LEDGER/review-p7/chain.json"
[
  {
    "generation": 1,
    "base": "$SEED_BASE",
    "head": "$SEED_HEAD",
    "seats": ["s0"],
    "status": "finalized"
  }
]
SEED_EOF
C7_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p7 --generation 2 --branch work --seats "m1/low@codex" 2>&1); C7_RC=$?
assert_exit_code "$C7_RC" "0" "case 7: exits 0 for gen 2"
RANGE_BASE=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).base);' "$LEDGER/review-p7/g2/range.json")
assert_eq "$RANGE_BASE" "$SEED_HEAD" "case 7: range.json base matches seeded head X"

# Case 8: generation 2 with chain.json missing generation-1 entry exits 1
mkdir -p "$LEDGER/review-p8"
echo "[]" > "$LEDGER/review-p8/chain.json"
C8_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p8 --generation 2 --branch work --seats "m1/low@codex" 2>&1); C8_RC=$?
assert_exit_code "$C8_RC" "1" "case 8: exits 1 when gen 1 entry missing"

# Case 9: simulate head moving between snapshot and seat-return
export REPO_FOR_TEST="$SCRATCH_REPO"
export SIMULATE_HEAD_MOVE=1
C9_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p9 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); C9_RC=$?
assert_exit_code "$C9_RC" "1" "case 9: exits 1 on head change"
assert_file_absent "$LEDGER/review-p9/g1/findings.json" "case 9: no findings.json written"
assert_contains "$(cat "$LEDGER/review-p9/chain.json")" '"status": "aborted"' "case 9: chain.json recorded aborted entry"
unset SIMULATE_HEAD_MOVE
unset REPO_FOR_TEST

# Case 10: seats resolved via resolver stub (no --seats flag)
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop.sh"
C10_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10 --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10_RC=$?
assert_exit_code "$C10_RC" "0" "case 10: exits 0 with resolver stub"
assert_file_exists "$LEDGER/review-p10/chain.json" "case 10: chain.json exists"
assert_contains "$(cat "$LEDGER/review-p10/chain.json")" '"seats": [' "case 10: chain.json has seats"
assert_file_exists "$LEDGER/review-p10/g1/seat-s0.json" "case 10: seat-s0.json exists"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# Case 10a: resolver stub prints JSON with qc_panel_seats holding three objects (one with endpoint null, one with endpoint glm)
cat << 'RESOLVE_10A_EOF' > "$TEST_TMP/bin/resolve-review-loop-10a.sh"
#!/usr/bin/env bash
cat << 'EOF'
{
  "qc_panel": ["model-a", "model-b", "model-c"],
  "qc_panel_seats_complete": true,
  "qc_panel_seats": [
    {"role": "r0", "runner": "runner-a", "model": "model-a", "effort": "low", "endpoint": null, "family": "fam-a"},
    {"role": "r1", "runner": "runner-b", "model": "model-b", "effort": "med", "endpoint": "glm", "family": "fam-b"},
    {"role": "r2", "runner": "runner-c", "model": "model-c", "effort": "high", "endpoint": "custom-ep", "family": "fam-c"}
  ]
}
EOF
RESOLVE_10A_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-10a.sh"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-10a.sh"
export LOG_DISPATCH_ARGS="$TEST_TMP/dispatch_10a.log"
rm -f "$LOG_DISPATCH_ARGS"
C10A_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10a --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10A_RC=$?
assert_exit_code "$C10A_RC" "0" "case 10a: exits 0 with qc_panel_seats"
assert_file_exists "$LEDGER/review-p10a/g1/seat-s0.json" "case 10a: seat-s0.json exists"
assert_file_exists "$LEDGER/review-p10a/g1/seat-s1.json" "case 10a: seat-s1.json exists"
assert_file_exists "$LEDGER/review-p10a/g1/seat-s2.json" "case 10a: seat-s2.json exists"
CHAIN_10A=$(cat "$LEDGER/review-p10a/chain.json")
assert_contains "$CHAIN_10A" '"s0"' "case 10a: chain includes s0"
assert_contains "$CHAIN_10A" '"s1"' "case 10a: chain includes s1"
assert_contains "$CHAIN_10A" '"s2"' "case 10a: chain includes s2"

# Verify seat properties passed to dispatch-review.sh:
# s0: runner runner-a, model model-a, effort low, no --endpoint
S0_LINE=$(grep "^SEAT:s0 " "$LOG_DISPATCH_ARGS")
assert_contains "$S0_LINE" "--runner runner-a --model model-a --effort low" "case 10a: s0 has correct runner, model, effort"
assert_not_contains "$S0_LINE" "--endpoint" "case 10a: s0 with null endpoint has undefined endpoint (no --endpoint flag)"

# s1: runner runner-b, model model-b, effort med, --endpoint glm
S1_LINE=$(grep "^SEAT:s1 " "$LOG_DISPATCH_ARGS")
assert_contains "$S1_LINE" "--runner runner-b --model model-b --effort med" "case 10a: s1 has correct runner, model, effort"
assert_contains "$S1_LINE" "--endpoint glm" "case 10a: s1 has endpoint glm"

# s2: runner runner-c, model model-c, effort high, --endpoint custom-ep
S2_LINE=$(grep "^SEAT:s2 " "$LOG_DISPATCH_ARGS")
assert_contains "$S2_LINE" "--runner runner-c --model model-c --effort high" "case 10a: s2 has correct runner, model, effort"
assert_contains "$S2_LINE" "--endpoint custom-ep" "case 10a: s2 has endpoint custom-ep"

unset LOG_DISPATCH_ARGS
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# Case 10b: resolver stub returning qc_panel_seats_complete false exits 2 and prints stderr
cat << 'RESOLVE_10B_EOF' > "$TEST_TMP/bin/resolve-review-loop-10b.sh"
#!/usr/bin/env bash
cat << 'EOF'
{
  "config_source": "test-stub-config",
  "qc_panel_seats_complete": false,
  "qc_panel": ["legacy-model1", "legacy-model2"],
  "qc_panel_runners": ["legacy-run1", "legacy-run2"],
  "qc_panel_efforts": ["low", "high"],
  "qc_panel_endpoints": ["@none", "legacy-ep"]
}
EOF
RESOLVE_10B_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-10b.sh"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-10b.sh"
C10B_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10b --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10B_RC=$?
assert_exit_code "$C10B_RC" "2" "case 10b: exits 2 when qc_panel_seats_complete is false"
assert_contains "$C10B_OUT" "Resolved qc panel is incomplete" "case 10b: stderr mentions resolved qc panel is incomplete"
assert_file_absent "$LEDGER/review-p10b/g1/seat-s0.json" "case 10b: no seat-s0 artifact file created"
assert_file_absent "$LEDGER/review-p10b/chain.json" "case 10b: no chain.json written"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# Case 10c: resolver stub whose seats have an empty runner makes collect exit 2 with stderr message and creates no seat artifact files
cat << 'RESOLVE_10C_EOF' > "$TEST_TMP/bin/resolve-review-loop-10c.sh"
#!/usr/bin/env bash
cat << 'EOF'
{
  "qc_panel_seats_complete": true,
  "qc_panel_seats": [
    {"role": "r0", "runner": "valid-runner", "model": "valid-model", "effort": "low", "endpoint": null, "family": "fam-a"},
    {"role": "r1", "runner": "", "model": "model-b", "effort": "med", "endpoint": null, "family": "fam-b"}
  ]
}
EOF
RESOLVE_10C_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-10c.sh"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-10c.sh"
C10C_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10c --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10C_RC=$?
assert_exit_code "$C10C_RC" "2" "case 10c: exits 2 when seat has empty runner"
assert_contains "$C10C_OUT" "Seat s1 missing runner" "case 10c: stderr names seat index and missing field"
assert_file_absent "$LEDGER/review-p10c/g1/seat-s0.json" "case 10c: no seat-s0 artifact file created"
assert_file_absent "$LEDGER/review-p10c/g1/seat-s1.json" "case 10c: no seat-s1 artifact file created"
assert_file_absent "$LEDGER/review-p10c/chain.json" "case 10c: no chain.json written"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# Case 10d: collect against the REAL resolver with a scratch target repo declaring a three-seat qc panel
SCRATCH_10D="$TEST_TMP/scratch_10d_repo"
mkdir -p "$SCRATCH_10D/.claude"
(
  cd "$SCRATCH_10D"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt
  git add file.txt
  git commit -q -m "c1"
  git checkout -q -b work
  echo "changes" >> file.txt
  git add file.txt
  git commit -q -m "c2"
)
cat << 'CFG_10D_EOF' > "$SCRATCH_10D/.claude/review-loop-config.md"
## Settings
- qc_panel: gpt-5.5, gemini-flash, MiniMax-M3
- qc_panel_runners: codex, agy, cc-shim
- qc_panel_efforts: high, low, high
- qc_panel_endpoints: @none, custom_ep, minimax
CFG_10D_EOF

BASE_10D=$(git -C "$SCRATCH_10D" rev-parse HEAD~1)
export LOG_DISPATCH_ARGS="$TEST_TMP/dispatch_10d.log"
rm -f "$LOG_DISPATCH_ARGS"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
C10D_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_10D" --ledger "$LEDGER" --phase p10d --generation 1 --branch work --phase-base "$BASE_10D" 2>&1); C10D_RC=$?
assert_exit_code "$C10D_RC" "0" "case 10d: exits 0 with real resolver"
assert_file_exists "$LEDGER/review-p10d/g1/seat-s0.json" "case 10d: seat-s0.json exists"
assert_file_exists "$LEDGER/review-p10d/g1/seat-s1.json" "case 10d: seat-s1.json exists"
assert_file_exists "$LEDGER/review-p10d/g1/seat-s2.json" "case 10d: seat-s2.json exists"

S0_DISP_10D=$(grep "^SEAT:s0 " "$LOG_DISPATCH_ARGS")
assert_contains "$S0_DISP_10D" "--runner codex" "case 10d: s0 dispatched with codex runner"
assert_not_contains "$S0_DISP_10D" "--endpoint" "case 10d: s0 has no endpoint flag"

S1_DISP_10D=$(grep "^SEAT:s1 " "$LOG_DISPATCH_ARGS")
assert_contains "$S1_DISP_10D" "--runner agy" "case 10d: s1 dispatched with agy runner"
assert_contains "$S1_DISP_10D" "--endpoint custom_ep" "case 10d: s1 dispatched with custom_ep"

S2_DISP_10D=$(grep "^SEAT:s2 " "$LOG_DISPATCH_ARGS")
assert_contains "$S2_DISP_10D" "--runner cc-shim" "case 10d: s2 dispatched with cc-shim runner"
assert_contains "$S2_DISP_10D" "--endpoint minimax" "case 10d: s2 dispatched with minimax"

unset LOG_DISPATCH_ARGS

# Case 10e: negative case where resolver override points at a stub that exits 2 with a message
cat << 'RESOLVE_10E_EOF' > "$TEST_TMP/bin/resolve-review-loop-10e.sh"
#!/usr/bin/env bash
echo "custom resolver error failure" >&2
exit 2
RESOLVE_10E_EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-10e.sh"
export AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-10e.sh"
C10E_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p10e --generation 1 --branch work --phase-base "$PHASE_BASE" 2>&1); C10E_RC=$?
assert_exit_code "$C10E_RC" "2" "case 10e: collect exits 2 when resolver exits 2"
assert_contains "$C10E_OUT" "custom resolver error failure" "case 10e: stderr prints message from resolver stub"
assert_file_absent "$LEDGER/review-p10e/chain.json" "case 10e: no chain.json written"
unset AUTOPILOT_REVIEW_LOOP_RESOLVER

# ─── finalize & opt-out ───

# Section setup: helper to write topology for hands-brief test
# The rung's runner must be a real implementer runner. finalize resolves
# hetero_review_resolved_from through resolve-review-loop.sh, and the scratch repo has no
# config, so the shipped template (`implementer_ladder: auto`) expands THIS topology; the
# resolver refuses an auto-expanded rung with an unknown runner by design (43d91832: "a
# stale topology file must not smuggle a bad runner past the resolver"). The former
# "custom-runner" made every finalize below exit 2 before writing a receipt. The engine
# name stays custom so the brief line still proves it came from the topology.
TOPOLOGY_FILE="$TEST_TMP/topology.json"
cat << 'TOPO_EOF' > "$TOPOLOGY_FILE"
{
  "implementer_ladder": [
    {
      "engine": "custom-engine",
      "runner": "opencode",
      "effort": "max"
    }
  ]
}
TOPO_EOF
export AUTOPILOT_TOPOLOGY_FILE="$TOPOLOGY_FILE"

# Case 1 (finalize): three seats' combined findings all disposed refuted -> exits 0, verdict: SHIP-AS-IS, no hands-brief.md written
mkdir -p "$LEDGER/review-p_fin1/g1"
cat << 'EOF' > "$LEDGER/review-p_fin1/chain.json"
[
  {
    "generation": 1,
    "base": "base111",
    "head": "head111",
    "seats": ["s0", "s1", "s2"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin1/g1/range.json"
{
  "base": "base111",
  "head": "head111"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin1/g1/findings.json"
{
  "findings": [
    { "id": "f1", "severity": "Minor", "seat": "s0", "text": "minor issue in foo.js" },
    { "id": "f2", "severity": "Major", "seat": "s1", "text": "major issue in bar.js" },
    { "id": "f3", "severity": "Critical", "seat": "s2", "text": "critical security bug in baz.js" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin1.json"
{
  "schema_version": 1,
  "phase": "p_fin1",
  "generation": 1,
  "findings": [
    { "id": "f1", "disposition": "refuted", "rationale": "not a bug" },
    { "id": "f2", "disposition": "refuted", "rationale": "intended behavior" },
    { "id": "f3", "disposition": "refuted", "rationale": "already guarded" }
  ]
}
EOF
FIN1_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin1 --generation 1 --dispositions "$TEST_TMP/disp_fin1.json" 2>&1); FIN1_RC=$?
assert_exit_code "$FIN1_RC" "0" "case 1 (fin): exits 0 when all findings refuted"
assert_file_exists "$LEDGER/receipt-p_fin1.json" "case 1 (fin): receipt-p_fin1.json exists"
assert_contains "$(cat "$LEDGER/receipt-p_fin1.json")" '"verdict": "SHIP-AS-IS"' "case 1 (fin): receipt verdict is SHIP-AS-IS"
assert_file_absent "$LEDGER/review-p_fin1/g1/hands-brief.md" "case 1 (fin): no hands-brief.md written on SHIP-AS-IS"

# Case 2 (finalize): one finding severity Critical disposed verified -> exits 0, verdict: FIX-THEN-SHIP, hands-brief.md exists, check-redispatch-prompt.sh exits 0
mkdir -p "$LEDGER/review-p_fin2/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2/chain.json"
[
  {
    "generation": 1,
    "base": "base222",
    "head": "head222",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2/g1/range.json"
{
  "base": "base222",
  "head": "head222"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2/g1/findings.json"
{
  "findings": [
    { "id": "f_crit", "severity": "Critical", "seat": "s0", "text": "Buffer boundary vulnerability in parser.js" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2.json"
{
  "schema_version": 1,
  "phase": "p_fin2",
  "generation": 1,
  "findings": [
    { "id": "f_crit", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
FIN2_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2 --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2.json" 2>&1); FIN2_RC=$?
assert_exit_code "$FIN2_RC" "0" "case 2 (fin): exits 0 on verified Critical"
assert_file_exists "$LEDGER/receipt-p_fin2.json" "case 2 (fin): receipt exists"
assert_contains "$(cat "$LEDGER/receipt-p_fin2.json")" '"verdict": "FIX-THEN-SHIP"' "case 2 (fin): receipt verdict is FIX-THEN-SHIP"
assert_file_exists "$LEDGER/review-p_fin2/g1/hands-brief.md" "case 2 (fin): hands-brief.md exists"
BRIEF_LINE1=$(head -n 1 "$LEDGER/review-p_fin2/g1/hands-brief.md")
assert_contains "$BRIEF_LINE1" "Engine: " "case 2 (fin): line 1 starts with Engine: "
assert_contains "$BRIEF_LINE1" "custom-engine@opencode effort=max" "case 2 (fin): line 1 uses custom topology"
# Run check-redispatch-prompt.sh on the hands-brief.md
CHECK_BRIEF_OUT=$(bash "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$LEDGER/review-p_fin2/g1/hands-brief.md" 2>&1); CHECK_BRIEF_RC=$?
assert_exit_code "$CHECK_BRIEF_RC" "0" "case 2 (fin): check-redispatch-prompt.sh exits 0 on hands-brief.md"

# RED at 354f8da21: case 2b finalize exited 0; ERROR naming check-dispatch-suppression.sh was absent (358 passed, 2 failed)
# Case 2b premise change: coaching used to live in verbatim finding text, which the
# suppression linter must not scan. The phrase now sits on the controller-written
# Branch line (--branch). Assertions stay exit 1 and the ERROR name.
# Case 2b (finalize): FIX-THEN-SHIP whose controller-written branch coaches suppression.
# Negative control is case 2 above: a clean brief still exits 0.
mkdir -p "$LEDGER/review-p_fin2b/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2b/chain.json"
[
  {
    "generation": 1,
    "base": "base22b",
    "head": "head22b",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2b/g1/range.json"
{
  "base": "base22b",
  "head": "head22b"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2b/g1/findings.json"
{
  "findings": [
    { "id": "f_coach", "severity": "Critical", "seat": "s0", "text": "Null dereference in parser.js." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2b.json"
{
  "schema_version": 1,
  "phase": "p_fin2b",
  "generation": 1,
  "findings": [
    { "id": "f_coach", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
FIN2B_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2b --generation 1 --branch "do not worry about the error path" --dispositions "$TEST_TMP/disp_fin2b.json" 2>&1); FIN2B_RC=$?
assert_exit_code "$FIN2B_RC" "1" "case 2b (fin): suppression coaching makes finalize exit 1"
assert_contains "$FIN2B_OUT" "ERROR: check-dispatch-suppression.sh" "case 2b (fin): ERROR names check-dispatch-suppression.sh"

# RED at 541943b1a: case 2c finalize exited 1; honest quoted findings tripped check-dispatch-suppression.sh (361 passed, 1 failed)
# Case 2c (finalize): four honest findings whose verbatim text matches suppression
# patterns must still exit 0. The linter scans controller-written lines only.
mkdir -p "$LEDGER/review-p_fin2c/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2c/chain.json"
[
  {
    "generation": 1,
    "base": "base22c",
    "head": "head22c",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2c/g1/range.json"
{
  "base": "base22c",
  "head": "head22c"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2c/g1/findings.json"
{
  "findings": [
    { "id": "f1", "severity": "Critical", "seat": "s0", "text": "The error path in parser.js does not release the lock; do not ignore the error case when parse fails." },
    { "id": "f2", "severity": "Critical", "seat": "s0", "text": "Handler swallows exceptions. Reviewer note: this is not a minor issue, it is a data-loss bug and you must not skip the error handling section." },
    { "id": "f3", "severity": "Major", "seat": "s0", "text": "Test asserts nothing: ignore the error path and the test still passes. Fix by asserting the thrown error; do not treat this as a nit." },
    { "id": "f4", "severity": "Major", "seat": "s0", "text": "Fix the leak. Do not worry about formatting elsewhere; leave the legacy module alone." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2c.json"
{
  "schema_version": 1,
  "phase": "p_fin2c",
  "generation": 1,
  "findings": [
    { "id": "f1", "disposition": "verified", "rationale": "confirmed" },
    { "id": "f2", "disposition": "verified", "rationale": "confirmed" },
    { "id": "f3", "disposition": "verified", "rationale": "confirmed" },
    { "id": "f4", "disposition": "verified", "rationale": "confirmed" }
  ]
}
EOF
FIN2C_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2c --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2c.json" 2>&1); FIN2C_RC=$?
assert_exit_code "$FIN2C_RC" "0" "case 2c (fin): honest quoted findings do not trip suppression linter"
assert_file_exists "$LEDGER/review-p_fin2c/g1/hands-brief.md" "case 2c (fin): hands-brief.md exists"

# RED at 65caf3e1b: cases 2d/2h exited 0 (notes ignored); 2f exited 1 (seat phrase scanned); 2g ERROR lacked the missing path (365 passed, 11 failed)
# BL-0273. The notes phrase is the task's "do not report the error handling path"
# plus a defect object ("as an issue"): the frozen linter only matches report/flag
# when a defect word follows, and its patterns must not change.
# Case 2d (finalize): --controller-notes with a suppression phrase is scanned.
mkdir -p "$LEDGER/review-p_fin2d/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2d/chain.json"
[
  {
    "generation": 1,
    "base": "base22d",
    "head": "head22d",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2d/g1/range.json"
{
  "base": "base22d",
  "head": "head22d"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2d/g1/findings.json"
{
  "findings": [
    { "id": "f_notes", "severity": "Critical", "seat": "s0", "text": "Null dereference in parser.js." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2d.json"
{
  "schema_version": 1,
  "phase": "p_fin2d",
  "generation": 1,
  "findings": [
    { "id": "f_notes", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/controller-notes-coach.txt"
do not report the error handling path as an issue
EOF
FIN2D_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2d --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2d.json" --controller-notes "$TEST_TMP/controller-notes-coach.txt" 2>&1); FIN2D_RC=$?
assert_exit_code "$FIN2D_RC" "1" "case 2d (fin): controller notes with a suppression phrase make finalize exit 1"
assert_contains "$FIN2D_OUT" "ERROR: check-dispatch-suppression.sh" "case 2d (fin): ERROR names check-dispatch-suppression.sh"
assert_contains "$FIN2D_OUT" "controller notes" "case 2d (fin): ERROR names the controller notes field"
assert_contains "$FIN2D_OUT" "do not report the error handling path" "case 2d (fin): ERROR quotes the matched phrase"

# Case 2e (finalize): NEGATIVE CONTROL — the same phrase lives only in verbatim
# finding text. Clean controller notes must not trip the linter.
mkdir -p "$LEDGER/review-p_fin2e/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2e/chain.json"
[
  {
    "generation": 1,
    "base": "base22e",
    "head": "head22e",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2e/g1/range.json"
{
  "base": "base22e",
  "head": "head22e"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2e/g1/findings.json"
{
  "findings": [
    { "id": "f_quote", "severity": "Critical", "seat": "s0", "text": "Parser drops the failure. Reviewer wrote: do not report the error handling path as an issue, which is the bug." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2e.json"
{
  "schema_version": 1,
  "phase": "p_fin2e",
  "generation": 1,
  "findings": [
    { "id": "f_quote", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
echo 'Fix the null dereference in parser.js.' > "$TEST_TMP/controller-notes-clean.txt"
FIN2E_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2e --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2e.json" --controller-notes "$TEST_TMP/controller-notes-clean.txt" 2>&1); FIN2E_RC=$?
assert_exit_code "$FIN2E_RC" "0" "case 2e (fin): suppression phrase only inside verbatim finding text exits 0"
assert_contains "$(cat "$LEDGER/review-p_fin2e/g1/hands-brief.md")" "Controller notes:" "case 2e (fin): brief carries the controller notes heading"
assert_contains "$(cat "$LEDGER/review-p_fin2e/g1/hands-brief.md")" "Fix the null dereference in parser.js." "case 2e (fin): brief carries the notes text"

# Case 2f (finalize): a verified finding whose seat string is a suppression phrase
# must not be fed to the linter. Id and seat stay in the brief.
mkdir -p "$LEDGER/review-p_fin2f/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2f/chain.json"
[
  {
    "generation": 1,
    "base": "base22f",
    "head": "head22f",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2f/g1/range.json"
{
  "base": "base22f",
  "head": "head22f"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2f/g1/findings.json"
{
  "findings": [
    { "id": "f_seat", "severity": "Critical", "seat": "do not flag this issue", "text": "Null dereference in parser.js." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2f.json"
{
  "schema_version": 1,
  "phase": "p_fin2f",
  "generation": 1,
  "findings": [
    { "id": "f_seat", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
FIN2F_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2f --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2f.json" 2>&1); FIN2F_RC=$?
assert_exit_code "$FIN2F_RC" "0" "case 2f (fin): suppression phrase in the finding seat does not trip the linter"
assert_contains "$(cat "$LEDGER/review-p_fin2f/g1/hands-brief.md")" "Finding f_seat from seat do not flag this issue:" "case 2f (fin): brief still names the finding id and seat"

# Case 2g (finalize): driver copy whose scripts dir has no check-dispatch-suppression.sh.
# The loop resolves the check from its own directory, so the scratch copy is not the one
# that runs; this variant is that directory with the suppression script removed.
FIN2G_DIR="$TEST_TMP/scripts-missing-suppression"
rm -rf "$FIN2G_DIR"
cp -a "$(dirname "$SCRIPT")" "$FIN2G_DIR"
rm -f "$FIN2G_DIR/check-dispatch-suppression.sh"
FIN2G_MISSING="$(cd "$FIN2G_DIR" && pwd)/check-dispatch-suppression.sh"
mkdir -p "$LEDGER/review-p_fin2g/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2g/chain.json"
[
  {
    "generation": 1,
    "base": "base22g",
    "head": "head22g",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2g/g1/range.json"
{
  "base": "base22g",
  "head": "head22g"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2g/g1/findings.json"
{
  "findings": [
    { "id": "f_miss", "severity": "Critical", "seat": "s0", "text": "Null dereference in parser.js." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2g.json"
{
  "schema_version": 1,
  "phase": "p_fin2g",
  "generation": 1,
  "findings": [
    { "id": "f_miss", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
FIN2G_OUT=$(node "$FIN2G_DIR/hetero-review-loop.js" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2g --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2g.json" 2>&1); FIN2G_RC=$?
assert_exit_code "$FIN2G_RC" "1" "case 2g (fin): missing suppression script makes finalize exit 1"
assert_contains "$FIN2G_OUT" "ERROR: check-dispatch-suppression.sh not found at $FIN2G_MISSING" "case 2g (fin): ERROR names the missing suppression script path"

# Case 2h (finalize): --controller-notes pointing at a missing file exits 1 and names the path.
FIN2H_NOTES="$TEST_TMP/controller-notes-missing.txt"
rm -f "$FIN2H_NOTES"
mkdir -p "$LEDGER/review-p_fin2h/g1"
cat << 'EOF' > "$LEDGER/review-p_fin2h/chain.json"
[
  {
    "generation": 1,
    "base": "base22h",
    "head": "head22h",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2h/g1/range.json"
{
  "base": "base22h",
  "head": "head22h"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin2h/g1/findings.json"
{
  "findings": [
    { "id": "f_badnotes", "severity": "Critical", "seat": "s0", "text": "Null dereference in parser.js." }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin2h.json"
{
  "schema_version": 1,
  "phase": "p_fin2h",
  "generation": 1,
  "findings": [
    { "id": "f_badnotes", "disposition": "verified", "rationale": "confirmed issue" }
  ]
}
EOF
FIN2H_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin2h --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin2h.json" --controller-notes "$FIN2H_NOTES" 2>&1); FIN2H_RC=$?
assert_exit_code "$FIN2H_RC" "1" "case 2h (fin): missing controller-notes file makes finalize exit 1"
assert_contains "$FIN2H_OUT" "$FIN2H_NOTES" "case 2h (fin): ERROR names the missing controller-notes path"
assert_contains "$FIN2H_OUT" "ERROR:" "case 2h (fin): missing controller-notes prints ERROR"

# Case 3 (finalize): same Critical finding disposed refuted instead -> verdict: SHIP-AS-IS
# (own fresh pending chain entry — reusing p_fin2's chain.json would copy its post-finalize
# 'finalized' status, which the pending-chain-entry requirement now correctly rejects)
mkdir -p "$LEDGER/review-p_fin3/g1"
cat << 'EOF' > "$LEDGER/review-p_fin3/chain.json"
[
  {
    "generation": 1,
    "base": "base222",
    "head": "head222",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cp "$LEDGER/review-p_fin2/g1/range.json" "$LEDGER/review-p_fin3/g1/range.json"
cp "$LEDGER/review-p_fin2/g1/findings.json" "$LEDGER/review-p_fin3/g1/findings.json"
cat << 'EOF' > "$TEST_TMP/disp_fin3.json"
{
  "schema_version": 1,
  "phase": "p_fin3",
  "generation": 1,
  "findings": [
    { "id": "f_crit", "disposition": "refuted", "rationale": "false positive" }
  ]
}
EOF
FIN3_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin3 --generation 1 --dispositions "$TEST_TMP/disp_fin3.json" 2>&1); FIN3_RC=$?
assert_exit_code "$FIN3_RC" "0" "case 3 (fin): exits 0 on refuted Critical"
assert_contains "$(cat "$LEDGER/receipt-p_fin3.json")" '"verdict": "SHIP-AS-IS"' "case 3 (fin): verdict is SHIP-AS-IS"

# Case 4 (finalize): a Major-severity finding disposed verified alone -> SHIP-AS-IS with exactly one entry in open_findings
mkdir -p "$LEDGER/review-p_fin4/g1"
cat << 'EOF' > "$LEDGER/review-p_fin4/chain.json"
[
  {
    "generation": 1,
    "base": "base444",
    "head": "head444",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin4/g1/range.json"
{
  "base": "base444",
  "head": "head444"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin4/g1/findings.json"
{
  "findings": [
    { "id": "f_major", "severity": "Major", "seat": "s0", "text": "Unchecked return value in write.js" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin4.json"
{
  "schema_version": 1,
  "phase": "p_fin4",
  "generation": 1,
  "findings": [
    { "id": "f_major", "disposition": "verified", "rationale": "needs follow up" }
  ]
}
EOF
FIN4_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin4 --generation 1 --dispositions "$TEST_TMP/disp_fin4.json" 2>&1); FIN4_RC=$?
assert_exit_code "$FIN4_RC" "0" "case 4 (fin): exits 0 on verified Major"
assert_contains "$(cat "$LEDGER/receipt-p_fin4.json")" '"verdict": "SHIP-AS-IS"' "case 4 (fin): verdict is SHIP-AS-IS"
OPEN_COUNT=$(node -e 'const r = JSON.parse(fs.readFileSync(process.argv[1])); console.log(r.open_findings.length);' "$LEDGER/receipt-p_fin4.json")
assert_eq "$OPEN_COUNT" "1" "case 4 (fin): open_findings has exactly 1 entry"

# Case 5 (finalize): dispositions file missing one of the finding ids -> exit 1, no receipt written
mkdir -p "$LEDGER/review-p_fin5/g1"
cat << 'EOF' > "$LEDGER/review-p_fin5/chain.json"
[
  {
    "generation": 1,
    "base": "base555",
    "head": "head555",
    "seats": ["s0", "s1"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin5/g1/range.json"
{
  "base": "base555",
  "head": "head555"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin5/g1/findings.json"
{
  "findings": [
    { "id": "f_one", "severity": "Minor", "seat": "s0", "text": "one" },
    { "id": "f_two", "severity": "Minor", "seat": "s1", "text": "two" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin5.json"
{
  "schema_version": 1,
  "phase": "p_fin5",
  "generation": 1,
  "findings": [
    { "id": "f_one", "disposition": "verified", "rationale": "ok" }
  ]
}
EOF
FIN5_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin5 --generation 1 --dispositions "$TEST_TMP/disp_fin5.json" 2>&1); FIN5_RC=$?
assert_exit_code "$FIN5_RC" "1" "case 5 (fin): exit 1 when finding id missing in dispositions"
assert_file_absent "$LEDGER/receipt-p_fin5.json" "case 5 (fin): receipt not written"

# Case 6 (finalize): defensive check for undispositioned Critical finding -> exit 1, no receipt written
mkdir -p "$LEDGER/review-p_fin6/g1"
cat << 'EOF' > "$LEDGER/review-p_fin6/chain.json"
[
  {
    "generation": 1,
    "base": "base666",
    "head": "head666",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin6/g1/range.json"
{
  "base": "base666",
  "head": "head666"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin6/g1/findings.json"
{
  "findings": [
    { "id": "f_crit_undisp", "severity": "Critical", "seat": "s0", "text": "Critical flaw" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin6.json"
{
  "schema_version": 1,
  "phase": "p_fin6",
  "generation": 1,
  "findings": []
}
EOF
FIN6_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin6 --generation 1 --dispositions "$TEST_TMP/disp_fin6.json" 2>&1); FIN6_RC=$?
assert_exit_code "$FIN6_RC" "1" "case 6 (fin): exit 1 when Critical finding is undispositioned"
assert_file_absent "$LEDGER/receipt-p_fin6.json" "case 6 (fin): receipt not written"

# Case 7 (finalize): two-generation flow: gen 1 collect -> finalize with verified Critical, gen 2 collect -> finalize gen 2 refuted -> SHIP-AS-IS, closed_findings recorded
mkdir -p "$LEDGER/review-p_fin7/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base1",
    "head": "sha_head1",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7/g1/range.json"
{
  "base": "sha_base1",
  "head": "sha_head1"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7/g1/findings.json"
{
  "findings": [
    { "id": "finding_g1_crit", "severity": "Critical", "seat": "s0", "text": "Memory corruption in parser" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7_g1.json"
{
  "schema_version": 1,
  "phase": "p_fin7",
  "generation": 1,
  "findings": [
    { "id": "finding_g1_crit", "disposition": "verified", "rationale": "reproduced memory corruption" }
  ]
}
EOF
FIN7_G1_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7 --generation 1 --dispositions "$TEST_TMP/disp_fin7_g1.json" 2>&1); FIN7_G1_RC=$?
assert_exit_code "$FIN7_G1_RC" "0" "case 7 (fin): gen 1 finalize exits 0"
assert_contains "$(cat "$LEDGER/receipt-p_fin7.json")" '"verdict": "FIX-THEN-SHIP"' "case 7 (fin): gen 1 verdict is FIX-THEN-SHIP"

# Now generation 2
mkdir -p "$LEDGER/review-p_fin7/g2"
cat << 'EOF' > "$LEDGER/review-p_fin7/g2/range.json"
{
  "base": "sha_head1",
  "head": "sha_head2"
}
EOF
# In generation 2, finding_g1_crit is no longer reported! Only a minor finding is reported.
cat << 'EOF' > "$LEDGER/review-p_fin7/g2/findings.json"
{
  "findings": [
    { "id": "finding_g2_minor", "severity": "Minor", "seat": "s0", "text": "Typo in comment" }
  ]
}
EOF
# Append gen 2 pending entry to chain
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const chain = JSON.parse(fs.readFileSync(p, "utf8"));
  chain.push({ generation: 2, base: "sha_head1", head: "sha_head2", seats: ["s0"], status: "pending" });
  fs.writeFileSync(p, JSON.stringify(chain, null, 2) + "\n");
' "$LEDGER/review-p_fin7/chain.json"

cat << 'EOF' > "$TEST_TMP/disp_fin7_g2.json"
{
  "schema_version": 1,
  "phase": "p_fin7",
  "generation": 2,
  "findings": [
    { "id": "finding_g2_minor", "disposition": "refuted", "rationale": "not a problem" }
  ],
  "resolutions": [
    { "id": "finding_g1_crit", "rationale": "re-read the fixed parser: bounds check present" }
  ]
}
EOF
FIN7_G2_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7 --generation 2 --dispositions "$TEST_TMP/disp_fin7_g2.json" 2>&1); FIN7_G2_RC=$?
assert_exit_code "$FIN7_G2_RC" "0" "case 7 (fin): gen 2 finalize exits 0"
assert_contains "$(cat "$LEDGER/receipt-p_fin7.json")" '"verdict": "SHIP-AS-IS"' "case 7 (fin): gen 2 verdict is SHIP-AS-IS"

CHAIN_P7=$(cat "$LEDGER/review-p_fin7/chain.json")
assert_contains "$CHAIN_P7" '"closed_by_generation": 2' "case 7 (fin): gen 1 entry recorded closed_by_generation: 2"
assert_contains "$CHAIN_P7" '"finding_g1_crit"' "case 7 (fin): closed finding id matches finding_g1_crit"

# Case 7x (BL-0032): same flow, but gen 2 does NOT resolve finding_g1_crit explicitly -> absence closes nothing
mkdir -p "$LEDGER/review-p_fin7x"
cp -r "$LEDGER/review-p_fin7/g1" "$LEDGER/review-p_fin7x/g1"
printf '[\n  { "generation": 1, "base": "sha_base1", "head": "sha_head1", "seats": ["s0"], "status": "pending" }\n]\n' > "$LEDGER/review-p_fin7x/chain.json"
rm -f "$LEDGER/review-p_fin7x/g1/dispositions.json" "$LEDGER/review-p_fin7x/g1/hands-brief.md"
node -e '
  const fs = require("fs"); const [src, dst, phase, gen, withRes] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(src, "utf8")); d.phase = phase; d.generation = Number(gen);
  if (withRes === "ghost") d.resolutions = [{ id: "ghost_finding", rationale: "never existed" }]; else delete d.resolutions;
  fs.writeFileSync(dst, JSON.stringify(d, null, 2));
' "$TEST_TMP/disp_fin7_g1.json" "$TEST_TMP/disp_fin7x_g1.json" p_fin7x 1 none
node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7x --generation 1 --dispositions "$TEST_TMP/disp_fin7x_g1.json" >/dev/null 2>&1
mkdir -p "$LEDGER/review-p_fin7x/g2"
cp "$LEDGER/review-p_fin7/g2/range.json" "$LEDGER/review-p_fin7x/g2/range.json"
cp "$LEDGER/review-p_fin7/g2/findings.json" "$LEDGER/review-p_fin7x/g2/findings.json"
node -e '
  const fs = require("fs"); const p = process.argv[1];
  const chain = JSON.parse(fs.readFileSync(p, "utf8"));
  chain.push({ generation: 2, base: "sha_head1", head: "sha_head2", seats: ["s0"], status: "pending" });
  fs.writeFileSync(p, JSON.stringify(chain, null, 2) + "\n");
' "$LEDGER/review-p_fin7x/chain.json"
node -e '
  const fs = require("fs"); const [src, dst, phase, gen, withRes] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(src, "utf8")); d.phase = phase; d.generation = Number(gen);
  if (withRes === "ghost") d.resolutions = [{ id: "ghost_finding", rationale: "never existed" }]; else delete d.resolutions;
  fs.writeFileSync(dst, JSON.stringify(d, null, 2));
' "$TEST_TMP/disp_fin7_g2.json" "$TEST_TMP/disp_fin7x_g2.json" p_fin7x 2 none
node -e '
  const fs = require("fs"); const [src, dst, phase, gen, withRes] = process.argv.slice(1);
  const d = JSON.parse(fs.readFileSync(src, "utf8")); d.phase = phase; d.generation = Number(gen);
  if (withRes === "ghost") d.resolutions = [{ id: "ghost_finding", rationale: "never existed" }]; else delete d.resolutions;
  fs.writeFileSync(dst, JSON.stringify(d, null, 2));
' "$TEST_TMP/disp_fin7_g2.json" "$TEST_TMP/disp_fin7y_g2.json" p_fin7x 2 ghost
# Case 7y first (refused, nothing written), then 7x proper on the same pending gen 2
FIN7Y_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7x --generation 2 --dispositions "$TEST_TMP/disp_fin7y_g2.json" 2>&1); FIN7Y_RC=$?
assert_exit_code "$FIN7Y_RC" "1" "case 7y (fin): resolution naming no open verified finding exits 1"
assert_contains "$FIN7Y_OUT" "names no open verified finding" "case 7y (fin): refusal names the rule"
FIN7X_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7x --generation 2 --dispositions "$TEST_TMP/disp_fin7x_g2.json" 2>&1); FIN7X_RC=$?
assert_exit_code "$FIN7X_RC" "0" "case 7x (fin): gen 2 finalize without resolutions exits 0"
assert_contains "$(cat "$LEDGER/receipt-p_fin7x.json")" '"verdict": "FIX-THEN-SHIP"' "case 7x (fin): absence did not close the verified Critical (BL-0032)"
assert_not_contains "$(cat "$LEDGER/review-p_fin7x/chain.json")" 'closed_by_generation' "case 7x (fin): no closure stamped"

# Case 7r (BL-0092): refinalize repairs a stale stamp on a finalized chain; refuses when evidence changed
node -e '
  const fs = require("fs"); const cp = process.argv[1], rp = process.argv[2];
  const chain = JSON.parse(fs.readFileSync(cp, "utf8")); chain[0].closed_findings = [{ id: "stale", closed_by_generation: 9 }];
  fs.writeFileSync(cp, JSON.stringify(chain, null, 2) + "\n");
  const r = JSON.parse(fs.readFileSync(rp, "utf8")); r.chain = chain; r.closed_findings = [{ id: "stale", closed_by_generation: 9 }]; fs.writeFileSync(rp, JSON.stringify(r, null, 2) + "\n");
' "$LEDGER/review-p_fin7/chain.json" "$LEDGER/receipt-p_fin7.json"
cp "$LEDGER/review-p_fin7/g1/findings.json" "$TEST_TMP/fin7_g1_findings.bak"
echo ' ' >> "$LEDGER/review-p_fin7/g1/findings.json"
FIN7R_BAD_OUT=$(node "$SCRIPT" refinalize --ledger "$LEDGER" --phase p_fin7 --generation 2 2>&1); FIN7R_BAD_RC=$?
assert_exit_code "$FIN7R_BAD_RC" "1" "case 7r (refin): changed findings.json -> refused"
assert_contains "$FIN7R_BAD_OUT" "no longer matches" "case 7r (refin): refusal names the sha mismatch"
assert_contains "$(cat "$LEDGER/review-p_fin7/chain.json")" '"stale"' "case 7r (refin): refused run left chain.json untouched"
cp "$TEST_TMP/fin7_g1_findings.bak" "$LEDGER/review-p_fin7/g1/findings.json"
FIN7R_OUT=$(node "$SCRIPT" refinalize --ledger "$LEDGER" --phase p_fin7 --generation 2 2>&1); FIN7R_RC=$?
assert_exit_code "$FIN7R_RC" "0" "case 7r (refin): refinalize on intact evidence exits 0"
assert_not_contains "$(cat "$LEDGER/review-p_fin7/chain.json")" '"stale"' "case 7r (refin): stale stamp discarded from chain.json"
assert_not_contains "$(cat "$LEDGER/receipt-p_fin7.json")" '"stale"' "case 7r (refin): stale stamp discarded from receipt chain"
assert_contains "$(cat "$LEDGER/receipt-p_fin7.json")" '"id": "finding_g1_crit"' "case 7r (refin): top-level receipt closed_findings re-derived (stale value replaced)"
assert_contains "$(cat "$LEDGER/review-p_fin7/chain.json")" '"closed_by_generation": 2' "case 7r (refin): true closure re-stamped from evidence"

# Case 7a (finalize): a misspelled disposition value makes finalize exit 1
mkdir -p "$LEDGER/review-p_fin7a/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7a/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base7a",
    "head": "sha_head7a",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7a/g1/range.json"
{
  "base": "sha_base7a",
  "head": "sha_head7a"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7a/g1/findings.json"
{
  "findings": [
    { "id": "f_misspell", "severity": "Minor", "seat": "s0", "text": "Minor issue" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7a.json"
{
  "schema_version": 1,
  "phase": "p_fin7a",
  "generation": 1,
  "findings": [
    { "id": "f_misspell", "disposition": "verifieeed", "rationale": "typo in disposition value" }
  ]
}
EOF
FIN7A_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7a --generation 1 --dispositions "$TEST_TMP/disp_fin7a.json" 2>&1); FIN7A_RC=$?
assert_exit_code "$FIN7A_RC" "1" "case 7a (fin): misspelled disposition value exits 1"
assert_file_absent "$LEDGER/receipt-p_fin7a.json" "case 7a (fin): no receipt written on misspelled disposition"

# Case 7b (finalize): a dispositions file with a duplicate finding id makes finalize exit 1
mkdir -p "$LEDGER/review-p_fin7b/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7b/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base7b",
    "head": "sha_head7b",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7b/g1/range.json"
{
  "base": "sha_base7b",
  "head": "sha_head7b"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7b/g1/findings.json"
{
  "findings": [
    { "id": "f_dup", "severity": "Minor", "seat": "s0", "text": "Minor issue" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7b.json"
{
  "schema_version": 1,
  "phase": "p_fin7b",
  "generation": 1,
  "findings": [
    { "id": "f_dup", "disposition": "verified", "rationale": "first entry" },
    { "id": "f_dup", "disposition": "refuted", "rationale": "second entry duplicate id" }
  ]
}
EOF
FIN7B_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7b --generation 1 --dispositions "$TEST_TMP/disp_fin7b.json" 2>&1); FIN7B_RC=$?
assert_exit_code "$FIN7B_RC" "1" "case 7b (fin): duplicate finding id in dispositions exits 1"
assert_file_absent "$LEDGER/receipt-p_fin7b.json" "case 7b (fin): no receipt written on duplicate finding id"

# Case 7c (finalize): calling finalize for a generation with no pending chain entry makes it exit 1
mkdir -p "$LEDGER/review-p_fin7c/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7c/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base7c",
    "head": "sha_head7c",
    "seats": ["s0"],
    "status": "finalized"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7c/g1/range.json"
{
  "base": "sha_base7c",
  "head": "sha_head7c"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7c/g1/findings.json"
{
  "findings": [
    { "id": "f_nopen", "severity": "Minor", "seat": "s0", "text": "Minor issue" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7c.json"
{
  "schema_version": 1,
  "phase": "p_fin7c",
  "generation": 1,
  "findings": [
    { "id": "f_nopen", "disposition": "verified", "rationale": "already finalized chain entry" }
  ]
}
EOF
FIN7C_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7c --generation 1 --dispositions "$TEST_TMP/disp_fin7c.json" 2>&1); FIN7C_RC=$?
assert_exit_code "$FIN7C_RC" "1" "case 7c (fin): generation with no pending chain entry exits 1"
assert_file_absent "$LEDGER/receipt-p_fin7c.json" "case 7c (fin): no receipt written on non-pending chain entry"

# Case 7d (finalize): a successful finalize leaves a dispositions.json snapshot file in the generation directory whose sha256 matches the digest recorded in the chain entry for that generation
mkdir -p "$LEDGER/review-p_fin7d/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7d/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base7d",
    "head": "sha_head7d",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7d/g1/range.json"
{
  "base": "sha_base7d",
  "head": "sha_head7d"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7d/g1/findings.json"
{
  "findings": [
    { "id": "f_snap", "severity": "Minor", "seat": "s0", "text": "Snapshot test finding" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7d.json"
{
  "schema_version": 1,
  "phase": "p_fin7d",
  "generation": 1,
  "findings": [
    { "id": "f_snap", "disposition": "verified", "rationale": "confirmed for snapshot test" }
  ]
}
EOF
FIN7D_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7d --generation 1 --dispositions "$TEST_TMP/disp_fin7d.json" 2>&1); FIN7D_RC=$?
assert_exit_code "$FIN7D_RC" "0" "case 7d (fin): successful finalize exits 0"
SNAPSHOT_FILE="$LEDGER/review-p_fin7d/g1/dispositions.json"
assert_file_exists "$SNAPSHOT_FILE" "case 7d (fin): dispositions.json snapshot exists in generation directory"
SNAPSHOT_SHA=$(node -e 'const c = fs.readFileSync(process.argv[1]); console.log(crypto.createHash("sha256").update(c).digest("hex"));' "$SNAPSHOT_FILE")
CHAIN_SHA=$(node -e 'const chain = JSON.parse(fs.readFileSync(process.argv[1])); console.log(chain[0].dispositions_sha256);' "$LEDGER/review-p_fin7d/chain.json")
assert_eq "$SNAPSHOT_SHA" "$CHAIN_SHA" "case 7d (fin): snapshot sha256 matches digest recorded in chain entry"
CHAIN_DISP_PATH=$(node -e 'const chain = JSON.parse(fs.readFileSync(process.argv[1])); console.log(chain[0].dispositions_path);' "$LEDGER/review-p_fin7d/chain.json")
assert_eq "$CHAIN_DISP_PATH" "review-p_fin7d/g1/dispositions.json" "case 7d (fin): chain entry references ledger-relative dispositions path"

# Case 7e (finalize): a resolver failure for hetero_review_resolved_from must not strand the phase.
# finalize exits non-zero with the chain entry still pending and nothing written for the
# generation; re-running with a working resolver then succeeds and writes the receipt.
mkdir -p "$LEDGER/review-p_fin7e/g1"
cat << 'EOF' > "$LEDGER/review-p_fin7e/chain.json"
[
  {
    "generation": 1,
    "base": "sha_base7e",
    "head": "sha_head7e",
    "seats": ["s0"],
    "status": "pending"
  }
]
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7e/g1/range.json"
{
  "base": "sha_base7e",
  "head": "sha_head7e"
}
EOF
cat << 'EOF' > "$LEDGER/review-p_fin7e/g1/findings.json"
{
  "findings": [
    { "id": "f_rf", "severity": "Critical", "seat": "s0", "text": "Resolver-failure ordering finding" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/disp_fin7e.json"
{
  "schema_version": 1,
  "phase": "p_fin7e",
  "generation": 1,
  "findings": [
    { "id": "f_rf", "disposition": "verified", "rationale": "forces FIX-THEN-SHIP so hands-brief.md would be written" }
  ]
}
EOF
cat << 'EOF' > "$TEST_TMP/bin/resolve-review-loop-fail.sh"
#!/usr/bin/env bash
if [ "$1" = "--field" ] && [ "$2" = "hetero_review_resolved_from" ]; then
  echo "stub resolver failure" >&2
  exit 3
fi
echo ""
exit 0
EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-fail.sh"
FIN7E_CHAIN_BEFORE=$(cat "$LEDGER/review-p_fin7e/chain.json")
FIN7E_FAIL_OUT=$(AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-fail.sh" node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7e --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin7e.json" 2>&1); FIN7E_FAIL_RC=$?
assert_exit_code "$FIN7E_FAIL_RC" "2" "case 7e (fin): resolver failure makes finalize exit 2"
assert_contains "$FIN7E_FAIL_OUT" "Review-loop resolver failed" "case 7e (fin): stderr names the resolver failure"
assert_contains "$(cat "$LEDGER/review-p_fin7e/chain.json")" '"status": "pending"' "case 7e (fin): chain entry still pending after resolver failure"
assert_eq "$(cat "$LEDGER/review-p_fin7e/chain.json")" "$FIN7E_CHAIN_BEFORE" "case 7e (fin): chain.json untouched after resolver failure"
assert_file_absent "$LEDGER/receipt-p_fin7e.json" "case 7e (fin): no receipt after resolver failure"
assert_file_absent "$LEDGER/review-p_fin7e/g1/dispositions.json" "case 7e (fin): no dispositions.json snapshot after resolver failure"
assert_file_absent "$LEDGER/review-p_fin7e/g1/hands-brief.md" "case 7e (fin): no hands-brief.md after resolver failure"
# Recovery: same finalize with a working resolver now succeeds
cat << 'EOF' > "$TEST_TMP/bin/resolve-review-loop-ok.sh"
#!/usr/bin/env bash
if [ "$1" = "--field" ]; then echo "test-stub-source"; exit 0; fi
echo "{}"
EOF
chmod +x "$TEST_TMP/bin/resolve-review-loop-ok.sh"
FIN7E_OK_OUT=$(AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/bin/resolve-review-loop-ok.sh" node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7e --generation 1 --branch work --dispositions "$TEST_TMP/disp_fin7e.json" 2>&1); FIN7E_OK_RC=$?
assert_exit_code "$FIN7E_OK_RC" "0" "case 7e (fin): re-run with working resolver exits 0"
assert_file_exists "$LEDGER/receipt-p_fin7e.json" "case 7e (fin): receipt written on recovery"
assert_contains "$(cat "$LEDGER/receipt-p_fin7e.json")" '"resolved_from": "test-stub-source"' "case 7e (fin): receipt carries resolved_from"
assert_contains "$(cat "$LEDGER/review-p_fin7e/chain.json")" '"status": "finalized"' "case 7e (fin): chain entry finalized after recovery"

# Case 8 (opt-out): config file containing line configuring knob to off -> receipt kind: opt-out, configured_value: off
mkdir -p "$SCRATCH_REPO/.claude"
echo "- hetero_review: off" > "$SCRATCH_REPO/.claude/review-loop-config.md"
OPT8_OUT=$(node "$SCRIPT" opt-out --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_opt8 --knob hetero_review 2>&1); OPT8_RC=$?
assert_exit_code "$OPT8_RC" "0" "case 8 (opt): exits 0"
assert_file_exists "$LEDGER/receipt-p_opt8.json" "case 8 (opt): receipt-p_opt8.json exists"
OPT8_RECEIPT=$(cat "$LEDGER/receipt-p_opt8.json")
assert_contains "$OPT8_RECEIPT" '"kind": "opt-out"' "case 8 (opt): kind is opt-out"
assert_contains "$OPT8_RECEIPT" '"configured_value": "off"' "case 8 (opt): configured_value is off"

# Case 9 (opt-out): an opt-out run against a config source path that does not exist on disk exits 1
rm -f "$SCRATCH_REPO/.claude/review-loop-config.md"
OPT9_OUT=$(node "$SCRIPT" opt-out --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_opt9 --knob plan_review 2>&1); OPT9_RC=$?
assert_exit_code "$OPT9_RC" "1" "case 9 (opt): opt-out against non-existent config file exits 1"
assert_file_absent "$LEDGER/receipt-p_opt9.json" "case 9 (opt): receipt not written when config source missing"

# Case 10: run --help and assert it mentions finalize and opt-out
HELP2_OUT=$(node "$SCRIPT" --help 2>&1); HELP2_RC=$?
assert_exit_code "$HELP2_RC" "0" "case 10 (help): --help exits 0"
assert_contains "$HELP2_OUT" "finalize" "case 10 (help): mentions finalize"
assert_contains "$HELP2_OUT" "opt-out" "case 10 (help): mentions opt-out"
assert_contains "$HELP2_OUT" "--dispositions" "case 10 (help): mentions --dispositions"
assert_contains "$HELP2_OUT" "--knob" "case 10 (help): mentions --knob"
assert_contains "$HELP2_OUT" "AUTOPILOT_DISPATCH_REVIEW_SCRIPT" "case 10 (help): mentions AUTOPILOT_DISPATCH_REVIEW_SCRIPT"

# ─── New verification tests ───

# Test 1: all four line shapes for all four severity words
# Shapes:
# 1) Severity glyph alone at the start of the line
# 2) Severity glyph followed by the plain severity word
# 3) Plain severity word alone with no glyph
# 4) Severity glyph immediately followed by a bracketed id (glyph then whitespace then open bracket)
T1_FINDINGS_TEXT=$(cat << 'EOF'
🔴
SQL injection reported via glyph alone
🟠 Major
Unhandled promise reported via glyph plus word
Minor
Unused import reported via plain word alone
🔵 [sugg-101]
Naming nit reported via glyph followed by bracket
EOF
)
export STUB_SEAT_RESPONSE="$(node -e 'console.log(JSON.stringify({status: "reviewed", verdict: "FIX-THEN-SHIP", findings: process.argv[1]}));' "$T1_FINDINGS_TEXT")"
T1_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test1 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T1_RC=$?
assert_exit_code "$T1_RC" "0" "test 1: exits 0 when parsing all four line shapes"
T1_FINDINGS_FILE="$LEDGER/review-p_test1/g1/findings.json"
assert_file_exists "$T1_FINDINGS_FILE" "test 1: findings.json exists"
T1_SEVS=$(node -e '
  const f = JSON.parse(fs.readFileSync(process.argv[1])).findings;
  console.log(f.map(x => x.severity).join(","));
' "$T1_FINDINGS_FILE")
assert_eq "$T1_SEVS" "Critical,Major,Minor,Suggestion" "test 1: extracted severities match Critical,Major,Minor,Suggestion"

# Test 2: non-empty unparseable findings text must fail closed (status 1, aborted with parse_failed, no findings.json)
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "FIX-THEN-SHIP", "findings": "Some unparseable free text that does not match any severity pattern at all."}'
T2_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T2_RC=$?
assert_exit_code "$T2_RC" "1" "test 2: exits 1 when findings text is unparseable"
assert_file_absent "$LEDGER/review-p_test2/g1/findings.json" "test 2: findings.json must not be written"
assert_file_exists "$LEDGER/review-p_test2/chain.json" "test 2: chain.json exists"
T2_CHAIN=$(cat "$LEDGER/review-p_test2/chain.json")
assert_contains "$T2_CHAIN" '"status": "aborted"' "test 2: chain entry status is aborted"
assert_contains "$T2_CHAIN" '"reason": "parse_failed"' "test 2: chain entry reason is parse_failed"

# Test 2d (negative control): the aborted generation left real evidence on disk (range.json, diff.txt);
# collecting the SAME generation number again must be refused (generation numbers are never
# reused, including aborted ones) and must NOT delete/recreate that directory.
assert_file_exists "$LEDGER/review-p_test2/g1/range.json" "test 2d: aborted generation's range.json exists before re-collect"
T2D_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T2D_RC=$?
assert_exit_code "$T2D_RC" "1" "test 2d: re-collecting the same generation after an abort is refused"
assert_file_exists "$LEDGER/review-p_test2/g1/range.json" "test 2d: aborted generation's range.json still present after refused re-collect (not deleted)"

# Test 2e (negative control, continued): collecting the NEXT generation number after an abort is
# accepted, continues from the aborted generation's base, and leaves the aborted generation's
# evidence directory (g1) completely untouched — never renamed, moved, or deleted — while the
# aborted chain.json entry itself stays in place, referenced alongside the new generation's entry.
T2E_G1_RANGE_BEFORE=$(cat "$LEDGER/review-p_test2/g1/range.json")
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T2E_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2 --generation 2 --branch work --seats "m1/low@codex" 2>&1); T2E_RC=$?
assert_exit_code "$T2E_RC" "0" "test 2e: collecting the next generation number after an abort is accepted"
assert_file_exists "$LEDGER/review-p_test2/g2/findings.json" "test 2e: fresh g2 directory has findings.json"
T2E_G1_RANGE_AFTER=$(cat "$LEDGER/review-p_test2/g1/range.json")
assert_eq "$T2E_G1_RANGE_BEFORE" "$T2E_G1_RANGE_AFTER" "test 2e: aborted g1 evidence directory is byte-for-byte untouched by the g2 collect"
T2E_CHAIN_LEN=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).length);' "$LEDGER/review-p_test2/chain.json")
assert_eq "$T2E_CHAIN_LEN" "2" "test 2e: chain.json has both the aborted g1 entry and the new g2 entry"
T2E_G1_STATUS=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).find((c) => c.generation === 1).status);' "$LEDGER/review-p_test2/chain.json")
assert_eq "$T2E_G1_STATUS" "aborted" "test 2e: g1 entry in chain.json is still status aborted, unmodified (referenced, not overwritten)"

# Test 2f: base inheritance is explicit, not implied — g2 starts from the aborted g1's base.
T2F_G1_BASE=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).find((c) => c.generation === 1).base);' "$LEDGER/review-p_test2/chain.json")
T2F_G2_BASE=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).find((c) => c.generation === 2).base);' "$LEDGER/review-p_test2/chain.json")
assert_eq "$T2F_G2_BASE" "$T2F_G1_BASE" "test 2f: g2.base equals the aborted g1's base (nothing advanced)"
assert_eq "$T2F_G2_BASE" "$PHASE_BASE" "test 2f: and that base is the phase base"

# Test 2g (reader side): a chain that PASSES THROUGH an aborted generation is a valid receipt.
# Found live on fleet-comms Phase 6 (2026-09-11): g1 aborted because the branch moved during
# collection, g2 finalized SHIP-AS-IS, and the checker refused the receipt with
# "Chain entry generation 1 status is 'aborted' (expected 'finalized')" — contradicting the
# writer's own documented semantics (tests 2d/2e/4 above). The aborted entry must be
# contiguity-neutral: it sits where a base was expected, contributes nothing, and the next
# finalized entry inherits its base.
cat << 'EOF' > "$TEST_TMP/disp_test2_g2.json"
{ "schema_version": 1, "phase": "p_test2", "generation": 2, "findings": [] }
EOF
T2G_FIN_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2 --generation 2 --branch work --dispositions "$TEST_TMP/disp_test2_g2.json" 2>&1); T2G_FIN_RC=$?
assert_exit_code "$T2G_FIN_RC" "0" "test 2g: finalizing g2 after an aborted g1 exits 0"
assert_file_exists "$LEDGER/receipt-p_test2.json" "test 2g: receipt written"
T2G_CHK_OUT=$(node "$REPO_ROOT/scripts/check-phase-review-receipt.js" --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2 --branch work --phase-base "$PHASE_BASE" 2>&1); T2G_CHK_RC=$?
assert_exit_code "$T2G_CHK_RC" "0" "test 2g: receipt checker accepts a chain that passes through an aborted generation (was: exit 1, 'expected finalized')"

# Test 2h (negative control): a chain that ENDS on an aborted generation is not a receipt.
# The g1 directory is NOT dead scaffold: the checker requires each chain entry's
# evidence directory to exist before it classifies the entry, so without it the
# refusal is "missing directory", not the "aborted last entry" this test is for.
mkdir -p "$LEDGER/review-p_test2h/g1"
cat << 'EOF' > "$LEDGER/review-p_test2h/chain.json"
[ { "generation": 1, "base": "PHASE_BASE_PLACEHOLDER", "status": "aborted", "reason": "parse_failed" } ]
EOF
sed -i "s/PHASE_BASE_PLACEHOLDER/$PHASE_BASE/" "$LEDGER/review-p_test2h/chain.json"
cp "$LEDGER/receipt-p_test2.json" "$LEDGER/receipt-p_test2h.json"
node -e '
const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1])); r.phase="p_test2h";
r.chain=JSON.parse(fs.readFileSync(process.argv[2])); fs.writeFileSync(process.argv[1], JSON.stringify(r,null,2));
' "$LEDGER/receipt-p_test2h.json" "$LEDGER/review-p_test2h/chain.json"
T2H_OUT=$(node "$REPO_ROOT/scripts/check-phase-review-receipt.js" --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2h --branch work --phase-base "$PHASE_BASE" 2>&1); T2H_RC=$?
assert_exit_code "$T2H_RC" "1" "test 2h: a chain ending on an aborted generation is refused"
assert_contains "$T2H_OUT" "aborted" "test 2h: the refusal names the aborted generation"

# Test 2b: SHIP-AS-IS with findings "none" and non-empty no_finding_proof succeeds with 0 findings and pending status
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T2B_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2b --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T2B_RC=$?
assert_exit_code "$T2B_RC" "0" "test 2b: exits 0 for SHIP-AS-IS with proof"
assert_file_exists "$LEDGER/review-p_test2b/g1/findings.json" "test 2b: findings.json written"
assert_contains "$(cat "$LEDGER/review-p_test2b/g1/findings.json")" '"findings": []' "test 2b: findings array is empty"
assert_contains "$(cat "$LEDGER/review-p_test2b/chain.json")" '"status": "pending"' "test 2b: chain entry status is pending"
assert_contains "$T2B_OUT" '"proof_present": true' "test 2b: summary records proof_present true"

# Test 2c: SHIP-AS-IS with findings "none" and empty no_finding_proof treated as no_verdict (gap)
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": ""}'
T2C_OUT_NOGAP=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2c_nogap --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T2C_RC_NOGAP=$?
assert_exit_code "$T2C_RC_NOGAP" "1" "test 2c: exits 1 when SHIP-AS-IS lacks proof and gap not allowed"
assert_contains "$T2C_OUT_NOGAP" "Review seat gap detected on seat(s): s0" "test 2c: gap detected on unproven seat"
# Backlog: a seat gap without --allow-seat-gap must record the generation aborted, not strand it
# (g1/ on disk, no chain entry => g1 cannot be re-run and g2 fails "Contiguous chain broken").
assert_file_exists "$LEDGER/review-p_test2c_nogap/chain.json" "test 2c: gap without --allow-seat-gap still writes a chain entry"
assert_contains "$(cat "$LEDGER/review-p_test2c_nogap/chain.json")" '"reason": "seat_gap"' "test 2c: chain entry recorded aborted (seat_gap)"
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T2C_G2_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2c_nogap --generation 2 --branch work --seats "m1/low@codex" 2>&1); T2C_G2_RC=$?
assert_exit_code "$T2C_G2_RC" "0" "test 2c: generation 2 collects after the gap-aborted generation 1 (was: Contiguous chain broken)"
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": ""}'

T2C_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2c --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" --allow-seat-gap 2>&1); T2C_RC=$?
# v2.36.5: 0 of 1 seats reviewed is below any floor — the generation is recorded aborted
# (seat_gap_below_min), never a pending entry the checker would refuse forever.
assert_exit_code "$T2C_RC" "1" "test 2c: 0 of 1 reviewed with --allow-seat-gap is below the floor ⇒ exit 1"
assert_contains "$(cat "$LEDGER/review-p_test2c/chain.json")" '"reason": "seat_gap_below_min"' "test 2c: chain entry recorded aborted (seat_gap_below_min)"
assert_file_exists "$LEDGER/review-p_test2c/g1/seat-s0.json" "test 2c: the unproven seat artifact is still on disk (evidence kept, raw dispatch output)"

# Test 3: chain immutability: run collect once (pending), run again for same generation -> exits 1 without modifying entry
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T3_OUT1=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test3 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T3_RC1=$?
assert_exit_code "$T3_RC1" "0" "test 3: first collect exits 0"
T3_CHAIN_BEFORE=$(cat "$LEDGER/review-p_test3/chain.json")
T3_OUT2=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test3 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T3_RC2=$?
assert_exit_code "$T3_RC2" "1" "test 3: second collect for same generation exits 1"
T3_CHAIN_AFTER=$(cat "$LEDGER/review-p_test3/chain.json")
assert_eq "$T3_CHAIN_BEFORE" "$T3_CHAIN_AFTER" "test 3: chain.json unchanged on refused rerun"

# Test 4: an existing chain entry for a generation — of ANY status, including 'aborted' — is
# never reused/replaced by a fresh collect on that same generation number. Only the next
# generation number can proceed.
mkdir -p "$LEDGER/review-p_test4"
cat << 'EOF' > "$LEDGER/review-p_test4/chain.json"
[
  {
    "generation": 1,
    "base": "dummy_base",
    "status": "aborted",
    "reason": "parse_failed"
  }
]
EOF
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T4_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test4 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T4_RC=$?
assert_exit_code "$T4_RC" "1" "test 4: collect refuses to reuse generation 1 while an aborted entry for it exists"
T4_CHAIN_LEN=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).length);' "$LEDGER/review-p_test4/chain.json")
assert_eq "$T4_CHAIN_LEN" "1" "test 4: chain still has exactly 1 entry (untouched, not replaced)"
T4_STATUS=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1]))[0].status);' "$LEDGER/review-p_test4/chain.json")
assert_eq "$T4_STATUS" "aborted" "test 4: existing entry status is unchanged (still aborted)"

# Test 5: malformed chain.json (not valid JSON or wrong top-level shape) exits 1 and file left unchanged
mkdir -p "$LEDGER/review-p_test5a"
echo "this is not json {[" > "$LEDGER/review-p_test5a/chain.json"
T5A_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test5a --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T5A_RC=$?
assert_exit_code "$T5A_RC" "1" "test 5a: exits 1 on invalid JSON chain.json"
assert_eq "$(cat "$LEDGER/review-p_test5a/chain.json")" "this is not json {[" "test 5a: malformed file left unchanged"

mkdir -p "$LEDGER/review-p_test5b"
echo '{"not": "an array"}' > "$LEDGER/review-p_test5b/chain.json"
T5B_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test5b --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T5B_RC=$?
assert_exit_code "$T5B_RC" "1" "test 5b: exits 1 on non-array chain.json"
assert_eq "$(cat "$LEDGER/review-p_test5b/chain.json")" '{"not": "an array"}' "test 5b: non-array file left unchanged"

# Test 6: rogue scripts/dispatch-review.sh in repo under test is ignored; driver script dir's dispatcher used
cp "$SCRATCH_REPO/scripts/dispatch-review.sh" "$TEST_TMP/saved-dispatch-review.sh"
# Put rogue script in SCRATCH_REPO/scripts/dispatch-review.sh that outputs rogue_marker
cat << 'EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "rogue_marker": true, "findings": ""}'
exit 0
EOF
chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
unset AUTOPILOT_DISPATCH_REVIEW_SCRIPT
# We create an isolated driver script in a temp directory alongside a mock dispatch-review.sh
TEST6_DRIVER_DIR="$TEST_TMP/driver-dir-test"
mkdir -p "$TEST6_DRIVER_DIR"
cp "$SCRIPT" "$TEST6_DRIVER_DIR/hetero-review-loop.js"
if [[ -d "$(dirname "$SCRIPT")/lib" ]]; then
  cp -r "$(dirname "$SCRIPT")/lib" "$TEST6_DRIVER_DIR/lib"
fi
cat << 'EOF' > "$TEST6_DRIVER_DIR/dispatch-review.sh"
#!/usr/bin/env bash
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "driver_dir_dispatcher": true, "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
exit 0
EOF
chmod +x "$TEST6_DRIVER_DIR/dispatch-review.sh"
T6_OUT=$(node "$TEST6_DRIVER_DIR/hetero-review-loop.js" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test6 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T6_RC=$?
assert_exit_code "$T6_RC" "0" "test 6: collect exits 0 using driver-directory dispatcher"
T6_SEAT_OUTPUT=$(cat "$LEDGER/review-p_test6/g1/seat-s0.json")
assert_contains "$T6_SEAT_OUTPUT" '"driver_dir_dispatcher": true' "test 6: executed dispatcher from driver script directory"
assert_not_contains "$T6_SEAT_OUTPUT" "rogue_marker" "test 6: rogue dispatcher in target repository was NOT executed"
cp "$TEST_TMP/saved-dispatch-review.sh" "$SCRATCH_REPO/scripts/dispatch-review.sh"

# Test 7: stub dispatcher exits non-zero while printing valid JSON on stdout -> recorded with verdict no_verdict
TEST7_STUB="$TEST_TMP/nonzero-exit-dispatcher.sh"
cat << 'EOF' > "$TEST7_STUB"
#!/usr/bin/env bash
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": ""}'
exit 1
EOF
chmod +x "$TEST7_STUB"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$TEST7_STUB"
# Run with --allow-seat-gap so collect doesn't abort early due to gap, allowing us to inspect seat JSON
T7_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test7 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" --allow-seat-gap 2>&1); T7_RC=$?
# v2.36.5: 0 of 1 reviewed ⇒ aborted (seat_gap_below_min), exit 1; the seat artifact is still written first.
assert_exit_code "$T7_RC" "1" "test 7: 0 of 1 reviewed is below the floor ⇒ aborted, exit 1"
assert_contains "$(cat "$LEDGER/review-p_test7/chain.json")" '"reason": "seat_gap_below_min"' "test 7: aborted entry recorded"
T7_SEAT_OUTPUT=$(cat "$LEDGER/review-p_test7/g1/seat-s0.json")
assert_contains "$T7_SEAT_OUTPUT" '"verdict": "no_verdict"' "test 7: recorded verdict is no_verdict on non-zero exit"
assert_contains "$T7_SEAT_OUTPUT" '"status": "no_verdict"' "test 7: recorded status is no_verdict on non-zero exit"
assert_not_contains "$T7_SEAT_OUTPUT" '"verdict": "SHIP-AS-IS"' "test 7: printed verdict SHIP-AS-IS is ignored"
export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"

# Test 8: --exclude removes matched pathspec from diff.txt and records in range.json
EXCL_REPO="$TEST_TMP/excl_repo"
mkdir -p "$EXCL_REPO/generated"
(
  cd "$EXCL_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "base normal" > normal.txt
  echo "base gen" > generated/gen.txt
  git add normal.txt generated/gen.txt
  git commit -q -m "initial"
  git checkout -q -b work
  echo "work normal" >> normal.txt
  echo "work gen" >> generated/gen.txt
  git add normal.txt generated/gen.txt
  git commit -q -m "changes"
)
EXCL_BASE=$(git -C "$EXCL_REPO" rev-parse HEAD~1)
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'

# Collect with --exclude generated/**
T8_OUT=$(node "$SCRIPT" collect --repo-root "$EXCL_REPO" --ledger "$LEDGER" --phase p_test8_excl --generation 1 --branch work --phase-base "$EXCL_BASE" --seats "m1/low@codex" --exclude "generated/**" 2>&1); T8_RC=$?
assert_exit_code "$T8_RC" "0" "test 8: collect with --exclude exits 0"
T8_DIFF=$(cat "$LEDGER/review-p_test8_excl/g1/diff.txt")
assert_contains "$T8_DIFF" "normal.txt" "test 8: normal.txt present in diff.txt"
assert_not_contains "$T8_DIFF" "generated/gen.txt" "test 8: generated/gen.txt omitted from diff.txt"
T8_RANGE=$(cat "$LEDGER/review-p_test8_excl/g1/range.json")
assert_contains "$T8_RANGE" '"excluded": [' "test 8: range.json has excluded array"
assert_contains "$T8_RANGE" '"generated/**"' "test 8: range.json lists excluded pathspec"
assert_contains "$T8_RANGE" '"diff_bytes":' "test 8: range.json has diff_bytes"

# Test 9: collect without --exclude includes both paths, and range.json excluded is []
T9_OUT=$(node "$SCRIPT" collect --repo-root "$EXCL_REPO" --ledger "$LEDGER" --phase p_test9_noexcl --generation 1 --branch work --phase-base "$EXCL_BASE" --seats "m1/low@codex" 2>&1); T9_RC=$?
assert_exit_code "$T9_RC" "0" "test 9: collect without --exclude exits 0"
T9_DIFF=$(cat "$LEDGER/review-p_test9_noexcl/g1/diff.txt")
assert_contains "$T9_DIFF" "normal.txt" "test 9: normal.txt present in diff.txt"
assert_contains "$T9_DIFF" "generated/gen.txt" "test 9: generated/gen.txt present in diff.txt"
T9_RANGE=$(cat "$LEDGER/review-p_test9_noexcl/g1/range.json")
assert_contains "$T9_RANGE" '"excluded": []' "test 9: range.json excluded is empty list"
assert_contains "$T9_RANGE" '"diff_bytes":' "test 9: range.json has diff_bytes"

# Test 10: diff exceeding 400000 bytes triggers warning naming size and suggesting --exclude, does not block
LARGE_REPO="$TEST_TMP/large_repo"
mkdir -p "$LARGE_REPO"
(
  cd "$LARGE_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "base" > base.txt
  git add base.txt
  git commit -q -m "initial"
  git checkout -q -b work
  # Generate 450,000 bytes file
  python3 -c "print('A' * 450000)" > large.txt
  git add large.txt
  git commit -q -m "large file"
)
LARGE_BASE=$(git -C "$LARGE_REPO" rev-parse HEAD~1)
export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "none", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T10_OUT=$(node "$SCRIPT" collect --repo-root "$LARGE_REPO" --ledger "$LEDGER" --phase p_test10_warn --generation 1 --branch work --phase-base "$LARGE_BASE" --seats "m1/low@codex" 2>&1); T10_RC=$?
assert_exit_code "$T10_RC" "0" "test 10: large diff collect exits 0 (does not block)"
assert_contains "$T10_OUT" "WARNING: Diff size" "test 10: diff size warning printed"
assert_contains "$T10_OUT" "exceeds 400000 bytes" "test 10: diff size warning names threshold"
assert_contains "$T10_OUT" "--exclude" "test 10: diff size warning suggests --exclude"

# Test 11: chain.json read-modify-write is serialised by a lock (backlog: collect appended without a lock)
# 11a: a fresh lock held by someone else makes collect wait, then fail loudly -- never write around it
mkdir -p "$LEDGER/review-p_lock"
mkdir "$LEDGER/review-p_lock/chain.json.lock"
T11A_OUT=$(AUTOPILOT_CHAIN_LOCK_TIMEOUT_MS=400 node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_lock --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T11A_RC=$?
assert_exit_code "$T11A_RC" "1" "test 11a: collect exits 1 while another holder owns the chain lock"
assert_contains "$T11A_OUT" "another collect/finalize holds it" "test 11a: timeout message names the lock"
assert_file_absent "$LEDGER/review-p_lock/chain.json" "test 11a: nothing written around the held lock"
# 11b: a stale lock (crashed holder) is broken and the collect proceeds
mkdir -p "$LEDGER/review-p_stale"; mkdir "$LEDGER/review-p_stale/chain.json.lock"; sleep 0.05
T11B_OUT=$(AUTOPILOT_CHAIN_LOCK_STALE_MS=1 node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_stale --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T11B_RC=$?
assert_exit_code "$T11B_RC" "0" "test 11b: stale lock is broken, collect succeeds"
assert_file_absent "$LEDGER/review-p_stale/chain.json.lock" "test 11b: lock released after the write"
# 11c: concurrent collects of the same phase/generation never leave a corrupt chain or a stuck lock
for i in 1 2 3 4; do
  node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_race --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" >/dev/null 2>&1 &
done
wait
assert_eq "$(node -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")); console.log(Array.isArray(c)&&c.length===1&&c[0].generation===1)' "$LEDGER/review-p_race/chain.json")" "true" "test 11c: concurrent collects leave one valid generation-1 entry"
assert_file_absent "$LEDGER/review-p_race/chain.json.lock" "test 11c: no lock left behind"

# 11d: finalize takes the same lock around its chain.json read-modify-write
echo '[]' > "$TEST_TMP/disp-empty.json"
mkdir -p "$LEDGER/review-p_lock/chain.json.lock"
T11D_OUT=$(AUTOPILOT_CHAIN_LOCK_TIMEOUT_MS=400 node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_lock --generation 1 --dispositions "$TEST_TMP/disp-empty.json" --branch work 2>&1); T11D_RC=$?
assert_exit_code "$T11D_RC" "1" "test 11d: finalize exits 1 while another holder owns the chain lock"
assert_contains "$T11D_OUT" "waiting for the chain.json lock" "test 11d: finalize waits on the chain lock"
rmdir "$LEDGER/review-p_lock/chain.json.lock"
T11E_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_lock --generation 1 --dispositions "$TEST_TMP/disp-empty.json" --branch work 2>&1) || true
assert_file_absent "$LEDGER/review-p_lock/chain.json.lock" "test 11e: finalize releases the lock on every exit path"

# 11f-11h: lock internals, exercised on the REAL functions extracted from the driver
LOCKH="$TEST_TMP/lock-harness.js"
node -e '
  const fs = require("fs");
  const src = fs.readFileSync(process.argv[1], "utf8");
  const a = src.indexOf("function acquireChainLock"), b = src.indexOf("// Trusted floor for reviewed seats");
  fs.writeFileSync(process.argv[2], "const fs=require(\"fs\"),path=require(\"path\"),crypto=require(\"crypto\");\n" + src.slice(a, b) +
   "\nmodule.exports={acquireChainLock,withChainLock};\n");
' "$SCRIPT" "$LOCKH"
# 11f: two waiters racing for one STALE lock never overlap inside the locked region
LOCKDIR="$TEST_TMP/lockrace"; mkdir -p "$LOCKDIR/chain.json.lock"; sleep 0.5
for w in a b c; do
  AUTOPILOT_CHAIN_LOCK_STALE_MS=300 node -e '
    const fs = require("fs"); const { withChainLock } = require(process.argv[1]);
    withChainLock(process.argv[2] + "/chain.json", () => {
      fs.appendFileSync(process.argv[2] + "/trace", "start\n");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80);
      fs.appendFileSync(process.argv[2] + "/trace", "end\n");
    });' "$LOCKH" "$LOCKDIR" &
done
wait
assert_eq "$(tr '\n' ',' < "$LOCKDIR/trace")" "start,end,start,end,start,end," "test 11f: three waiters on a stale lock enter the locked region one at a time"
assert_file_absent "$LOCKDIR/chain.json.lock" "test 11f: no lock left after the race"
# 11g: a process.exit inside the locked fn still releases the lock
EXITDIR="$TEST_TMP/lockexit"; mkdir -p "$EXITDIR"
node -e 'const { withChainLock } = require(process.argv[1]); withChainLock(process.argv[2] + "/chain.json", () => { process.exit(3); });' "$LOCKH" "$EXITDIR"; T11G_RC=$?
assert_exit_code "$T11G_RC" "3" "test 11g: process.exit inside the lock keeps its exit code"
assert_file_absent "$EXITDIR/chain.json.lock" "test 11g: exit inside the locked fn releases the lock"
# 11h: a holder whose lock was broken must not delete its successor's lock (token check)
TOKDIR="$TEST_TMP/locktok"; mkdir -p "$TOKDIR"
node -e '
  const fs = require("fs"); const { acquireChainLock } = require(process.argv[1]);
  const c = process.argv[2] + "/chain.json";
  const releaseOld = acquireChainLock(c);
  fs.rmSync(c + ".lock", { recursive: true });           // lock broken as stale by someone else
  const releaseNew = acquireChainLock(c);                // successor holds it now
  releaseOld();                                          // the old holder wakes up
  if (!fs.existsSync(c + ".lock")) { console.log("DELETED-SUCCESSOR"); process.exit(1); }
  releaseNew();
  if (fs.existsSync(c + ".lock")) { console.log("LEAK"); process.exit(1); }
  console.log("OK");' "$LOCKH" "$TOKDIR" > "$TEST_TMP/t11h.out" 2>&1
assert_eq "$(cat "$TEST_TMP/t11h.out")" "OK" "test 11h: release is token-checked (old holder cannot remove successor's lock)"

# ─── packet mode (plan docs/plans/_archive/2026/10/2026-10-11-review-packet-mode.md) ───
# A range too big for one packet is split BY PATH: packets.json -> one phase per packet -> a set check
# (check-phase-review-receipt.js --packets). Every negative case is proved twice: the writer (collect)
# refuses it AND the checker refuses a hand-built ledger that bypassed the writer; then the guarded
# line is removed from a COPY of the scripts and the same case must stop failing (the case really
# depends on the check, not on something incidental).
CHK="$REPO_ROOT/scripts/check-phase-review-receipt.js"
PK_REPO="$TEST_TMP/pk_repo"
mkdir -p "$PK_REPO/d" "$PK_REPO/generated"
(
  cd "$PK_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  for f in a.txt d/b.txt c.txt d/e.txt generated/g.txt; do echo "base $f" > "$f"; done
  git add -A; git commit -q -m "base"
  git checkout -q -b work
  for f in a.txt d/b.txt c.txt d/e.txt generated/g.txt; do echo "work $f" >> "$f"; done
  git add -A; git commit -q -m "work"
)
PK_BASE=$(git -C "$PK_REPO" rev-parse HEAD~1)
PK_LEDGER="$TEST_TMP/pk_ledger"
mkdir -p "$PK_LEDGER"
cat << 'EOF' > "$TEST_TMP/pk_packets.json"
{ "schema": "autopilot.review-packets/1", "set": "ps",
  "packets": { "P1": ["a.txt"], "P2": ["d/b.txt", "generated/g.txt"], "P3": ["c.txt", "d/e.txt"] } }
EOF
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'

pk_collect() { # <ledger> <packets-file> <packet> [extra flags...]
  local led="$1" pf="$2" id="$3"; shift 3
  node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$led" --packets "$pf" --packet "$id" --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" "$@" 2>&1
}
pk_finalize() { # <ledger> <packets-file> <packet> [generation]
  echo "{ \"schema_version\": 1, \"phase\": \"ps-$3\", \"generation\": ${4:-1}, \"findings\": [] }" > "$TEST_TMP/pk_disp.json"
  node "$SCRIPT" finalize --repo-root "$PK_REPO" --ledger "$1" --packets "$2" --packet "$3" --generation "${4:-1}" --branch work --dispositions "$TEST_TMP/pk_disp.json" 2>&1
}
pk_check() { # <script> <ledger> <packets-file>
  node "$1" --repo-root "$PK_REPO" --ledger "$2" --packets "$3" --branch work --phase-base "$PK_BASE" 2>&1
}
# A copy of the scripts with ONE guard line removed: pk_mutant <name> <file> <exact old text> <new text>
pk_mutant() {
  local m="$TEST_TMP/mut-$1"
  if [ ! -d "$m" ]; then mkdir -p "$m"; cp -r "$REPO_ROOT/scripts" "$m/scripts"; ln -s "$REPO_ROOT/src" "$m/src"; fi
  node -e '
    const fs = require("fs"); const f = process.argv[1], o = process.argv[2], n = process.argv[3];
    const s = fs.readFileSync(f, "utf8"); if (s.split(o).length !== 2) { console.error("MUTATION TARGET NOT UNIQUE: " + o); process.exit(3); }
    fs.writeFileSync(f, s.replace(o, () => n));' "$m/scripts/$2" "$3" "$4" || return 1
  echo "$m"
}

# P1: normal split — three packets, each its own phase, all pinned to the same full range
for id in P1 P2 P3; do
  PK_OUT=$(pk_collect "$PK_LEDGER" "$TEST_TMP/pk_packets.json" "$id"); PK_RC=$?
  assert_exit_code "$PK_RC" "0" "packet P1: collect packet $id exits 0"
  PK_OUT=$(pk_finalize "$PK_LEDGER" "$TEST_TMP/pk_packets.json" "$id"); PK_RC=$?
  assert_exit_code "$PK_RC" "0" "packet P1: finalize packet $id exits 0"
done
assert_file_exists "$PK_LEDGER/review-ps-P2/chain.json" "packet P1: packet phase is <set>-<id>"
assert_file_exists "$PK_LEDGER/packets-ps.json" "packet P1: the packets file is pinned in the ledger"
assert_contains "$(cat "$PK_LEDGER/review-ps-P2/g1/diff.txt")" "d/b.txt" "packet P1: P2's diff holds its own file"
assert_not_contains "$(cat "$PK_LEDGER/review-ps-P2/g1/diff.txt")" "a.txt" "packet P1: P2's diff holds nothing of P1"
# Backlog: seats saw only their packet's diff and flagged sibling-packet files as missing. The
# collect now hands every seat a scope note naming the sibling packets' paths (out of scope).
PK_SCOPE=$(cat "$PK_LEDGER/review-ps-P2/g1/packet-scope.md" 2>/dev/null)
assert_contains "$PK_SCOPE" "Sibling packet 'P1'" "packet P1: P2's scope note names sibling packet P1"
assert_contains "$PK_SCOPE" "- c.txt" "packet P1: P2's scope note lists a sibling packet's path"
assert_not_contains "$PK_SCOPE" "d/b.txt" "packet P1: P2's scope note does not list its own paths as siblings"
bash "$REPO_ROOT/scripts/check-blind-evidence.sh" --payload "$PK_LEDGER/review-ps-P2/g1/packet-scope.md" >/dev/null 2>&1; PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P1: the scope note passes the blind-evidence gate dispatch-review applies to the spec"
bash "$REPO_ROOT/scripts/check-dispatch-suppression.sh" "$PK_LEDGER/review-ps-P2/g1/packet-scope.md" >/dev/null 2>&1; PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P1: the scope note is a statement, not coaching (check-dispatch-suppression rc 0)"
# An unreadable --spec-file must fail before g1/ exists, or the generation is stranded.
PK_SPEC_LEDGER="$TEST_TMP/pk_spec_ledger"
PK_OUT=$(pk_collect "$PK_SPEC_LEDGER" "$TEST_TMP/pk_packets.json" P1 --spec-file "$TEST_TMP/no-such-spec.md"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P1: a missing --spec-file exits 1"
assert_file_absent "$PK_SPEC_LEDGER/review-ps-P1/g1" "packet P1: a missing --spec-file leaves no g1 directory behind"
PK_OUT=$(pk_collect "$PK_SPEC_LEDGER" "$TEST_TMP/pk_packets.json" P1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P1: the same generation collects after the missing-spec failure (was: directory already exists)"
PK_FULL=$(git -C "$PK_REPO" diff "$PK_BASE..work" | sha256sum | cut -d' ' -f1)
assert_eq "$(node -e 'const r=require(process.argv[1]); console.log([r.full_range_sha256, r.excluded.length, r.packet.id].join("|"))' "$PK_LEDGER/review-ps-P2/g1/range.json")" "$PK_FULL|0|P2" "packet P1: range.json pins the full-range hash, no exclusions, names the packet"
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P1: the set check passes when every packet is SHIP-AS-IS and the cover is exact"
assert_contains "$PK_OUT" "ok: 3 packet(s), 5 path(s)" "packet P1: the set check reports the cover"

# P2: a lone packet receipt must not pass as a whole-range receipt
PK_OUT=$(node "$CHK" --repo-root "$PK_REPO" --ledger "$PK_LEDGER" --phase ps-P1 --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P2: Mode A on a packet receipt alone is refused"
assert_contains "$PK_OUT" "review-packet receipt" "packet P2: the refusal says why"
PK_M=$(pk_mutant lone check-phase-review-receipt.js "if (!packetSet && (receipt.packet !== undefined || packetEntries.length > 0)) {" "if (false) {") || fail "mutation setup failed (P2)"
PK_OUT=$(node "$PK_M/scripts/check-phase-review-receipt.js" --repo-root "$PK_REPO" --ledger "$PK_LEDGER" --phase ps-P1 --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_not_contains "$PK_OUT" "review-packet receipt" "packet P2 (mutation): without the guard the refusal reason is gone (the case depends on the guard)"

# P3: the packets omit a changed file (the "slice it away" attempt) — collect refuses, naming the path
cat << 'EOF' > "$TEST_TMP/pk_missing.json"
{ "schema": "autopilot.review-packets/1", "set": "pm",
  "packets": { "P1": ["a.txt"], "P2": ["d/b.txt", "generated/g.txt"], "P3": ["c.txt"] } }
EOF
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_m" "$TEST_TMP/pk_missing.json" P1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P3: collect refuses a cover that misses a changed file"
assert_contains "$PK_OUT" "missing: 'd/e.txt'" "packet P3: the refusal names the uncovered file"
assert_file_absent "$TEST_TMP/pk_ledger_m/review-pm-P1/g1" "packet P3: nothing was collected"
PK_M=$(pk_mutant cover hetero-review-loop.js "if (coverProblems.length > 0) {" "if (false) {") || fail "mutation setup failed (P3)"
rm -rf "$TEST_TMP/pk_ledger_m2"
PK_OUT=$(AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh" node "$PK_M/scripts/hetero-review-loop.js" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger_m2" --packets "$TEST_TMP/pk_missing.json" --packet P1 --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P3 (mutation): without the cover check collect accepts the gap"

# P3b: the same gap in a HAND-BUILT ledger (the writer bypassed): P1+P2 copied from the good run, packet sha
# records rewritten to the gap file, receipts rewritten to match — the set check must still refuse, naming the file.
cat << 'EOF' > "$TEST_TMP/pk_gap.json"
{ "schema": "autopilot.review-packets/1", "set": "ps",
  "packets": { "P1": ["a.txt"], "P2": ["d/b.txt", "generated/g.txt"] } }
EOF
pk_forge() { # <outdir> <packets-file>: copy the good ps ledger, re-pin every packet record to <packets-file>, re-write receipts to match
  rm -rf "$1"; mkdir -p "$1"
  node -e '
    const fs = require("fs"), crypto = require("crypto");
    const [src, dir, file] = process.argv.slice(1);
    const text = fs.readFileSync(file, "utf8"); const sha = crypto.createHash("sha256").update(text, "utf8").digest("hex");
    const set = JSON.parse(text);
    for (const id of Object.keys(set.packets)) {
      const ph = "ps-" + id;
      fs.cpSync(src + "/review-" + ph, dir + "/review-" + ph, { recursive: true });
      fs.copyFileSync(src + "/receipt-" + ph + ".json", dir + "/receipt-" + ph + ".json");
      const chainP = dir + "/review-" + ph + "/chain.json"; const chain = JSON.parse(fs.readFileSync(chainP, "utf8"));
      for (const e of chain) { e.packet.packets_sha256 = sha; e.packet.paths = set.packets[id]; }
      fs.writeFileSync(chainP, JSON.stringify(chain, null, 2) + "\n");
      for (const e of chain) {
        const rp = dir + "/review-" + ph + "/g" + e.generation + "/range.json"; const r = JSON.parse(fs.readFileSync(rp, "utf8"));
        r.packet = e.packet; fs.writeFileSync(rp, JSON.stringify(r, null, 2) + "\n");
      }
      const recP = dir + "/receipt-" + ph + ".json"; const rec = JSON.parse(fs.readFileSync(recP, "utf8"));
      rec.chain = chain; fs.writeFileSync(recP, JSON.stringify(rec, null, 2) + "\n");
    }' "$PK_LEDGER" "$1" "$2"
}
PK_FORGE="$TEST_TMP/pk_forge"
pk_forge "$PK_FORGE" "$TEST_TMP/pk_gap.json"
# the forged packet diffs are the original ones (paths unchanged for P1; P2 unchanged), so Mode A accepts them; only the cover is wrong
PK_OUT=$(pk_check "$CHK" "$PK_FORGE" "$TEST_TMP/pk_gap.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P3b: the set check refuses a hand-built ledger whose packets leave a changed file out"
assert_contains "$PK_OUT" "missing: 'c.txt'" "packet P3b: names the first uncovered file"
assert_contains "$PK_OUT" "missing: 'd/e.txt'" "packet P3b: names every uncovered file"
# a gap is reported by two rules (exact cover at the first reviewed head, subset cover at the tip); remove both
PK_M=$(pk_mutant setcover check-phase-review-receipt.js "problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, h1), packets, true));" "") || fail "mutation setup failed (P3b)"
PK_M=$(pk_mutant setcover check-phase-review-receipt.js "problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, tip), packets, false));" "") || fail "mutation setup failed (P3b)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PK_FORGE" "$TEST_TMP/pk_gap.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P3b (mutation): without the cover rules the gapped hand-built set passes"

# P3c: a hand-built ledger whose packet lists a file that is not in the range (extra) - only the exact-cover rule sees it
cat << 'EOF' > "$TEST_TMP/pk_extra2.json"
{ "schema": "autopilot.review-packets/1", "set": "ps",
  "packets": { "P1": ["a.txt", "nothing.txt"], "P2": ["d/b.txt", "generated/g.txt"], "P3": ["c.txt", "d/e.txt"] } }
EOF
pk_forge "$TEST_TMP/pk_forge2" "$TEST_TMP/pk_extra2.json"
PK_OUT=$(pk_check "$CHK" "$TEST_TMP/pk_forge2" "$TEST_TMP/pk_extra2.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P3c: the set check refuses a hand-built packet that lists a file outside the range"
assert_contains "$PK_OUT" "extra: 'nothing.txt'" "packet P3c: names the extra path"
PK_M=$(pk_mutant extra check-phase-review-receipt.js "problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, h1), packets, true));" "") || fail "mutation setup failed (P3c)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$TEST_TMP/pk_forge2" "$TEST_TMP/pk_extra2.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P3c (mutation): without the exact-cover rule an extra path passes"

# P4: two packets share a path
cat << 'EOF' > "$TEST_TMP/pk_overlap.json"
{ "schema": "autopilot.review-packets/1", "set": "po",
  "packets": { "P1": ["a.txt", "c.txt"], "P2": ["d/b.txt", "generated/g.txt", "c.txt"], "P3": ["d/e.txt"] } }
EOF
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_o" "$TEST_TMP/pk_overlap.json" P1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P4: collect refuses overlapping packets"
assert_contains "$PK_OUT" "overlap: 'c.txt' is in both packet 'P1' and packet 'P2'" "packet P4: the refusal names the shared path and both packets"
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER" "$TEST_TMP/pk_overlap.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P4: the set check refuses an overlapping packets file"
PK_M=$(pk_mutant overlap lib/review-packets.js "if (owner.has(p)) errors.push(" "if (false) errors.push(") || fail "mutation setup failed (P4)"
PK_OUT=$(AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh" node "$PK_M/scripts/hetero-review-loop.js" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger_o2" --packets "$TEST_TMP/pk_overlap.json" --packet P1 --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P4 (mutation): without the overlap check collect accepts the overlap"

# P4b: a packet lists a file that is not in the range
cat << 'EOF' > "$TEST_TMP/pk_extra.json"
{ "schema": "autopilot.review-packets/1", "set": "pe",
  "packets": { "P1": ["a.txt", "nothing.txt"], "P2": ["d/b.txt", "generated/g.txt", "c.txt", "d/e.txt"] } }
EOF
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_e" "$TEST_TMP/pk_extra.json" P1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P4b: collect refuses a packet path that did not change"
assert_contains "$PK_OUT" "extra: 'nothing.txt'" "packet P4b: names the extra path"

# P5: one packet did not pass — the whole set does not pass
PK_LEDGER5="$TEST_TMP/pk_ledger5"; mkdir -p "$PK_LEDGER5"
for id in P1 P2 P3; do pk_collect "$PK_LEDGER5" "$TEST_TMP/pk_packets.json" "$id" > /dev/null; done
for id in P1 P2; do pk_finalize "$PK_LEDGER5" "$TEST_TMP/pk_packets.json" "$id" > /dev/null; done
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER5" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P5: a packet without a receipt fails the set"
assert_contains "$PK_OUT" "packet 'P3'" "packet P5: names the packet that did not pass"
# P3 collected with a verified Critical finding -> FIX-THEN-SHIP, not SHIP-AS-IS
rm -rf "$PK_LEDGER5/review-ps-P3"
# (a per-seat STUB_RESPONSE_<seat> set by an earlier case outranks STUB_SEAT_RESPONSE in the stub, so set the seat's own)
PK_S0_OLD="${STUB_RESPONSE_s0-__unset__}"
export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "FIX-THEN-SHIP", "findings": "Critical: broken thing\nDetail."}'
pk_collect "$PK_LEDGER5" "$TEST_TMP/pk_packets.json" P3 > /dev/null
if [ "$PK_S0_OLD" = "__unset__" ]; then unset STUB_RESPONSE_s0; else export STUB_RESPONSE_s0="$PK_S0_OLD"; fi
node -e 'const f=JSON.parse(require("fs").readFileSync(process.argv[1])).findings[0].id; require("fs").writeFileSync(process.argv[2], JSON.stringify({schema_version:1,phase:"ps-P3",generation:1,findings:[{id:f,disposition:"verified",rationale:"real"}]}))' "$PK_LEDGER5/review-ps-P3/g1/findings.json" "$TEST_TMP/pk_disp_bad.json"
node "$SCRIPT" finalize --repo-root "$PK_REPO" --ledger "$PK_LEDGER5" --packets "$TEST_TMP/pk_packets.json" --packet P3 --generation 1 --branch work --dispositions "$TEST_TMP/pk_disp_bad.json" > /dev/null 2>&1
assert_contains "$(cat "$PK_LEDGER5/receipt-ps-P3.json")" '"verdict": "FIX-THEN-SHIP"' "packet P5: setup — P3 finalized FIX-THEN-SHIP"
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER5" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P5: one FIX-THEN-SHIP packet fails the set though the others are SHIP-AS-IS"
assert_contains "$PK_OUT" "packet 'P3'" "packet P5: names the failing packet"
PK_M=$(pk_mutant failed check-phase-review-receipt.js "if (r.code !== 0) {" "if (false) {") || fail "mutation setup failed (P5)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PK_LEDGER5" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P5 (mutation): without the per-packet pass requirement the set passes with a failed packet"

# P6: trying to exclude files through packet mode: --exclude with --packets is refused...
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_x" "$TEST_TMP/pk_packets.json" P1 --exclude "generated/**"); PK_RC=$?
assert_exit_code "$PK_RC" "2" "packet P6: --exclude together with --packets is refused"
assert_contains "$PK_OUT" "never leaves one out" "packet P6: the refusal says packets never leave a path out"
assert_file_absent "$TEST_TMP/pk_ledger_x/review-ps-P1" "packet P6: nothing was collected"
PK_M=$(pk_mutant excl hetero-review-loop.js "if (flags.exclude !== undefined) {" "if (false) {") || fail "mutation setup failed (P6)"
PK_OUT=$(AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh" node "$PK_M/scripts/hetero-review-loop.js" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger_x2" --packets "$TEST_TMP/pk_packets.json" --packet P1 --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" --exclude "generated/**" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P6 (mutation): without the guard the exclusion rides along with a packet"
# ...a source path is still not excludable even without packets (allowlist untouched)
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger_y" --phase py --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" --exclude "d/b.txt" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P6: the exclude allowlist still refuses a non-allowlisted path"
# ...and a packet generation that carries exclusions in a hand-built ledger is refused by the checker
PK_EXCL="$TEST_TMP/pk_excl"; rm -rf "$PK_EXCL"; cp -r "$PK_LEDGER" "$PK_EXCL"
node -e '
  const fs = require("fs"); const rp = process.argv[1] + "/review-ps-P2/g1/range.json"; const r = JSON.parse(fs.readFileSync(rp, "utf8"));
  r.excluded = ["generated/**"]; fs.writeFileSync(rp, JSON.stringify(r, null, 2) + "\n");' "$PK_EXCL"
PK_OUT=$(pk_check "$CHK" "$PK_EXCL" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P6: the checker refuses a packet generation that carries exclusions"
assert_contains "$PK_OUT" "may not exclude paths" "packet P6: the checker names the rule"
PK_M=$(pk_mutant exclchk check-phase-review-receipt.js 'console.error(`Generation ${entry.generation} of packet ${packetSet.id} carries exclusions; a packet may not exclude paths`);
          process.exit(1);' "") || fail "mutation setup failed (P6b)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PK_EXCL" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P6b (mutation): without the rule a packet generation with exclusions passes the set"

# P9: without --packets nothing changes: no packet record anywhere, whole-range receipt still passes Mode A
UN_LEDGER="$TEST_TMP/pk_unchanged"; mkdir -p "$UN_LEDGER"
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$UN_LEDGER" --phase whole --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P9: collect without packet flags exits 0"
echo '{ "schema_version": 1, "phase": "whole", "generation": 1, "findings": [] }' > "$TEST_TMP/pk_disp_whole.json"
node "$SCRIPT" finalize --repo-root "$PK_REPO" --ledger "$UN_LEDGER" --phase whole --generation 1 --branch work --dispositions "$TEST_TMP/pk_disp_whole.json" > /dev/null 2>&1
assert_not_contains "$(cat "$UN_LEDGER/review-whole/g1/range.json")" "packet" "packet P9: range.json has no packet key"
assert_not_contains "$(cat "$UN_LEDGER/review-whole/chain.json")" "packet" "packet P9: chain.json has no packet key"
assert_not_contains "$(cat "$UN_LEDGER/receipt-whole.json")" "packet" "packet P9: the receipt has no packet key"
assert_file_absent "$UN_LEDGER/packets-ps.json" "packet P9: no packets file pinned"
PK_OUT=$(node "$CHK" --repo-root "$PK_REPO" --ledger "$UN_LEDGER" --phase whole --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P9: Mode A passes the whole-range receipt unchanged"
PK_M=$(pk_mutant plain hetero-review-loop.js "if (packetRecord) rangeJson.packet = packetRecord;" "rangeJson.packet = packetRecord;") || fail "mutation setup failed (P9)"
rm -rf "$TEST_TMP/pk_unchanged2"; mkdir -p "$TEST_TMP/pk_unchanged2"
AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh" node "$PK_M/scripts/hetero-review-loop.js" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_unchanged2" --phase whole --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" > /dev/null 2>&1
assert_contains "$(cat "$TEST_TMP/pk_unchanged2/review-whole/g1/range.json")" '"packet"' "packet P9 (mutation): a collect that always writes a packet key is caught by the no-packet-key assertion"

# P10: flag misuse
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger_z" --packets "$TEST_TMP/pk_packets.json" --generation 1 --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "2" "packet P10: --packets without --packet exits 2"
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_z" "$TEST_TMP/pk_packets.json" NOPE); PK_RC=$?
assert_exit_code "$PK_RC" "2" "packet P10: unknown packet id exits 2"
PK_OUT=$(pk_collect "$TEST_TMP/pk_ledger_z" "$TEST_TMP/pk_packets.json" P1 --phase other); PK_RC=$?
assert_exit_code "$PK_RC" "2" "packet P10: a --phase that differs from the derived packet phase exits 2"

# P7: a later fix touching a packet's file after that packet's last reviewed head — the set is stale
(cd "$PK_REPO" && echo "late" >> c.txt && git add c.txt && git commit -q -m "late fix")
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P7: a packet file changed after its last reviewed head fails the set"
assert_contains "$PK_OUT" "'c.txt' changed after its last reviewed head" "packet P7: names the file and the rule"
PK_M=$(pk_mutant stale check-phase-review-receipt.js "if (own.has(n)) problems.push(" "if (false) problems.push(") || fail "mutation setup failed (P7)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PK_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P7 (mutation): without the staleness rule the set passes over an unreviewed change"
# P7b: re-reviewing only the touched packet (generation 2) brings the set back; an untouched packet cannot be re-collected
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$PK_LEDGER" --packets "$TEST_TMP/pk_packets.json" --packet P1 --generation 2 --branch work --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P7b: collecting a later generation for a packet nothing changed in is refused"
assert_contains "$PK_OUT" "nothing in packet 'P1' changed" "packet P7b: says why"
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$PK_LEDGER" --packets "$TEST_TMP/pk_packets.json" --packet P3 --generation 2 --branch work --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P7b: generation 2 of the touched packet collects"
PK_OUT=$(pk_finalize "$PK_LEDGER" "$TEST_TMP/pk_packets.json" P3 2); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P7b: generation 2 finalizes"
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet P7b: after the touched packet is re-reviewed the set passes at the new tip (the other packets did not re-run)"

# P8: a changed packets file is refused once the set is pinned
cat << 'EOF' > "$TEST_TMP/pk_packets_alt.json"
{ "schema": "autopilot.review-packets/1", "set": "ps",
  "packets": { "P1": ["a.txt"], "P2": ["d/b.txt"], "P3": ["c.txt", "d/e.txt", "generated/g.txt"] } }
EOF
rm -rf "$PK_LEDGER5/review-ps-P1"
PK_OUT=$(node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$PK_LEDGER5" --packets "$TEST_TMP/pk_packets_alt.json" --packet P1 --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet P8: a second collect with different packets bytes for the same set is refused"
assert_contains "$PK_OUT" "frozen once its first packet is collected" "packet P8: says why"


# ─── packet mode, review follow-ups: set-rule mutations, exit-code proof of the lone-receipt guard,
#     the pinned packets file, and exits swallowed by a catch in the in-process member check ───
px_repo() { # <dir>: fresh repo like pk_repo (base + one work commit touching all five files); sets PK_REPO / PK_BASE
  rm -rf "$1"; mkdir -p "$1/d" "$1/generated"
  (
    cd "$1"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    for f in a.txt d/b.txt c.txt d/e.txt generated/g.txt; do echo "base $f" > "$f"; done
    git add -A; git commit -q -m "base"
    git checkout -q -b work
    for f in a.txt d/b.txt c.txt d/e.txt generated/g.txt; do echo "work $f" >> "$f"; done
    git add -A; git commit -q -m "work"
  )
  PK_REPO="$1"; PK_BASE=$(git -C "$1" rev-parse HEAD~1)
}
px_fin() { # <ledger> <packet> -> collect then finalize that packet of the ps set at the current tip
  pk_collect "$1" "$TEST_TMP/pk_packets.json" "$2" > /dev/null
  pk_finalize "$1" "$TEST_TMP/pk_packets.json" "$2" > /dev/null
}
PK_REPO_MAIN="$PK_REPO"; PK_BASE_MAIN="$PK_BASE"

# Q1: a packet first reviewed at a LATER head h2 is refused when that packet's OWN files changed between h1 and h2.
# P1 is first reviewed at h1; d/e.txt (a P3 file) then changes; P2 and P3 are first collected at h2. P2's own files
# (d/b.txt) did not change h1..h2 so P2 alone would be accepted, but P3's did -> the set is refused, naming P3 only.
px_repo "$TEST_TMP/px1"
PX1_LEDGER="$TEST_TMP/px1_ledger"; mkdir -p "$PX1_LEDGER"
px_fin "$PX1_LEDGER" P1
(cd "$PK_REPO" && echo "between" >> d/e.txt && git add d/e.txt && git commit -q -m "between")
px_fin "$PX1_LEDGER" P2; px_fin "$PX1_LEDGER" P3
PK_OUT=$(pk_check "$CHK" "$PX1_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q1: a packet first reviewed at a later head over its own changed file fails the set"
assert_contains "$PK_OUT" "packet 'P3' was first reviewed at a different head" "packet Q1: the refusal names the packet whose own file changed"
assert_not_contains "$PK_OUT" "packet 'P2' was first reviewed" "packet Q1: the packet whose own files did not change is not refused"

# Q1b (BL-0118): a packet first reviewed at a later head h2 is ACCEPTED when none of its own paths changed h1..h2.
# P1 and P3 are first reviewed at h1; d/e.txt (P3) changes; P2 is first collected at h2 (d/b.txt untouched) and P3 is
# re-reviewed at h2 as generation 2. Exact cover is still checked at h1.
px_repo "$TEST_TMP/px1b"
PX1B_LEDGER="$TEST_TMP/px1b_ledger"; mkdir -p "$PX1B_LEDGER"
px_fin "$PX1B_LEDGER" P1; px_fin "$PX1B_LEDGER" P3
(cd "$PK_REPO" && echo "between" >> d/e.txt && git add d/e.txt && git commit -q -m "between")
px_fin "$PX1B_LEDGER" P2
node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$PX1B_LEDGER" --packets "$TEST_TMP/pk_packets.json" --packet P3 --generation 2 --branch work --seats "m1/low@codex" > /dev/null 2>&1
pk_finalize "$PX1B_LEDGER" "$TEST_TMP/pk_packets.json" P3 2 > /dev/null
PK_OUT=$(pk_check "$CHK" "$PX1B_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q1b: a packet first reviewed at a later head over untouched own paths passes the set"

# Q1c: negative control for Q1b - the same shape, but the later-collected packet's OWN file changed h1..h2 -> refused.
# P1 and P3 at h1; d/b.txt (a P2 file) changes; P2 first collected at h2.
px_repo "$TEST_TMP/px1c"
PX1C_LEDGER="$TEST_TMP/px1c_ledger"; mkdir -p "$PX1C_LEDGER"
px_fin "$PX1C_LEDGER" P1; px_fin "$PX1C_LEDGER" P3
(cd "$PK_REPO" && echo "between" >> d/b.txt && git add d/b.txt && git commit -q -m "between")
px_fin "$PX1C_LEDGER" P2
PK_OUT=$(pk_check "$CHK" "$PX1C_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q1c: a later-collected packet whose own file changed h1..h2 fails the set"
assert_contains "$PK_OUT" "first reviewed at a different head" "packet Q1c: the refusal says the heads differ"
PK_M=$(pk_mutant heads check-phase-review-receipt.js "const ownChanged = " "const ownChanged = [] || ") || fail "mutation setup failed (Q1c)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PX1C_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q1c (mutation): without the own-paths-unchanged check a set pinned to two different ranges passes"

# Q1d: negative control for the ancestry branch - the packets' first heads sit on DIVERGED lines (the branch was reset
# and amended into a sibling commit with the same tree after P1 was reviewed), so no head is an ancestor of the others.
px_repo "$TEST_TMP/px1d"
PX1D_LEDGER="$TEST_TMP/px1d_ledger"; mkdir -p "$PX1D_LEDGER"
px_fin "$PX1D_LEDGER" P1
(cd "$PK_REPO" && git commit -q --amend -m "work (sibling commit, same tree)")
px_fin "$PX1D_LEDGER" P2; px_fin "$PX1D_LEDGER" P3
PK_OUT=$(pk_check "$CHK" "$PX1D_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q1d: packets first reviewed on diverged lines fail the set"
assert_contains "$PK_OUT" "is not a descendant of" "packet Q1d: the refusal names the ancestry rule"

# Q1e: reverse order. P2 and P3 are first reviewed at the EARLIER head, P1 (sorted first) only at the LATER head, with
# P1's own file untouched h1..h2 and P3 re-reviewed at h2. h1 is the earliest head regardless of packet-id order, so the
# set passes (a rule that took the first id's head as h1 would pin h1 to the later head and refuse the earlier packets).
px_repo "$TEST_TMP/px1e"
PX1E_LEDGER="$TEST_TMP/px1e_ledger"; mkdir -p "$PX1E_LEDGER"
px_fin "$PX1E_LEDGER" P2; px_fin "$PX1E_LEDGER" P3
(cd "$PK_REPO" && echo "between" >> d/e.txt && git add d/e.txt && git commit -q -m "between")
px_fin "$PX1E_LEDGER" P1
node "$SCRIPT" collect --repo-root "$PK_REPO" --ledger "$PX1E_LEDGER" --packets "$TEST_TMP/pk_packets.json" --packet P3 --generation 2 --branch work --seats "m1/low@codex" > /dev/null 2>&1
pk_finalize "$PX1E_LEDGER" "$TEST_TMP/pk_packets.json" P3 2 > /dev/null
PK_OUT=$(pk_check "$CHK" "$PX1E_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q1e: the earliest first head is h1 whatever the packet-id order, so a later-reviewed first packet passes"
PK_M=$(pk_mutant anc2 check-phase-review-receipt.js "const isAncestor = (a, b) => spawnSync(" "const isAncestor = (a, b) => true || spawnSync(") || fail "mutation setup failed (Q1d/Q1e)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PX1D_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_not_contains "$PK_OUT" "is not a descendant of" "packet Q1d (mutation): with ancestry always true the Rule 3 ancestry refusal is gone (only the later staleness rule still blocks the set)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PX1E_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q1e (mutation): with ancestry always true h1 is mis-picked and the valid reverse-order set is refused"

# Q2: a file outside every packet enters the range after the packets were reviewed (tip subset cover)
px_repo "$TEST_TMP/px2"
PX2_LEDGER="$TEST_TMP/px2_ledger"; mkdir -p "$PX2_LEDGER"
for id in P1 P2 P3; do px_fin "$PX2_LEDGER" "$id"; done
(cd "$PK_REPO" && echo "new" > new.txt && git add new.txt && git commit -q -m "uncovered file")
PK_OUT=$(pk_check "$CHK" "$PX2_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q2: a file added after review that no packet covers fails the set"
assert_contains "$PK_OUT" "missing: 'new.txt'" "packet Q2: names the uncovered file"
PK_M=$(pk_mutant tipcover check-phase-review-receipt.js "problems.push(...reviewPackets.coverErrors(reviewPackets.rangeNames(repoRoot, base, tip), packets, false));" "") || fail "mutation setup failed (Q2)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PX2_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q2 (mutation): without the tip subset-cover rule an uncovered later file passes"

# Q3: the branch is rewritten so a packet's last reviewed head is no longer an ancestor of the tip (same content, new commit ids)
px_repo "$TEST_TMP/px3"
PX3_LEDGER="$TEST_TMP/px3_ledger"; mkdir -p "$PX3_LEDGER"
for id in P1 P2 P3; do px_fin "$PX3_LEDGER" "$id"; done
(cd "$PK_REPO" && git commit -q --amend -m "work (rewritten)")
PK_OUT=$(pk_check "$CHK" "$PX3_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q3: a rewritten branch (reviewed head not an ancestor of the tip) fails the set"
assert_contains "$PK_OUT" "is not an ancestor" "packet Q3: names the ancestor rule"
PK_M=$(pk_mutant anc check-phase-review-receipt.js "if (anc.status !== 0) {" "if (false) {") || fail "mutation setup failed (Q3)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PX3_LEDGER" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q3 (mutation): without the ancestor rule a rewritten branch passes"

# Q4: a lone packet receipt, exit-code proof. A set whose only packet holds every path has a packet diff equal to the
# whole-range diff, so the ONLY thing refusing its lone receipt is the packet guard.
px_repo "$TEST_TMP/px4"
cat << 'EOF' > "$TEST_TMP/pk_one.json"
{ "schema": "autopilot.review-packets/1", "set": "pone",
  "packets": { "ALL": ["a.txt", "d/b.txt", "c.txt", "d/e.txt", "generated/g.txt"] } }
EOF
PX4_LEDGER="$TEST_TMP/px4_ledger"; mkdir -p "$PX4_LEDGER"
pk_collect "$PX4_LEDGER" "$TEST_TMP/pk_one.json" ALL > /dev/null
echo '{ "schema_version": 1, "phase": "pone-ALL", "generation": 1, "findings": [] }' > "$TEST_TMP/pk_disp_one.json"
node "$SCRIPT" finalize --repo-root "$PK_REPO" --ledger "$PX4_LEDGER" --packets "$TEST_TMP/pk_one.json" --packet ALL --generation 1 --branch work --dispositions "$TEST_TMP/pk_disp_one.json" > /dev/null 2>&1
PK_OUT=$(node "$CHK" --repo-root "$PK_REPO" --ledger "$PX4_LEDGER" --phase pone-ALL --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q4: a lone packet receipt is refused even when its diff equals the whole range"
PK_M=$(pk_mutant lone2 check-phase-review-receipt.js "if (!packetSet && (receipt.packet !== undefined || packetEntries.length > 0)) {" "if (false) {") || fail "mutation setup failed (Q4)"
PK_OUT=$(node "$PK_M/scripts/check-phase-review-receipt.js" --repo-root "$PK_REPO" --ledger "$PX4_LEDGER" --phase pone-ALL --branch work --phase-base "$PK_BASE" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q4 (mutation): without the guard the lone receipt passes Mode A (exit 0), so the guard is what refuses it"

# Q5: the packets file is frozen once pinned — mutation proof (the refusal itself is case P8)
PK_REPO="$PK_REPO_MAIN"; PK_BASE="$PK_BASE_MAIN"
rm -rf "$TEST_TMP/pk_ledger5m"; cp -r "$PK_LEDGER5" "$TEST_TMP/pk_ledger5m"; rm -rf "$TEST_TMP/pk_ledger5m/review-ps-P1"
PK_M=$(pk_mutant pin hetero-review-loop.js "if (pinned !== packetCtx.sha256) {" "if (false) {") || fail "mutation setup failed (Q5)"
PK_OUT=$(AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh" node "$PK_M/scripts/hetero-review-loop.js" collect --repo-root "$PK_REPO" --ledger "$TEST_TMP/pk_ledger5m" --packets "$TEST_TMP/pk_packets_alt.json" --packet P1 --generation 1 --branch work --phase-base "$PK_BASE" --seats "m1/low@codex" 2>&1); PK_RC=$?
assert_exit_code "$PK_RC" "0" "packet Q5 (mutation): without the pin check a changed packets file is accepted into the same set"

# Q6: an exit inside a try/catch of the member check must reach the set check unchanged (no swallowed or doubled error)
PK_LEDGER6="$TEST_TMP/pk_ledger6"; mkdir -p "$PK_LEDGER6"; px_fin "$PK_LEDGER6" P1
PK_OUT=$(pk_check "$CHK" "$PK_LEDGER6" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_exit_code "$PK_RC" "1" "packet Q6: set with a packet missing its receipt exits 1"
assert_contains "$PK_OUT" "Receipt file not found" "packet Q6: the member's own error text is reported"
assert_not_contains "$PK_OUT" "Failed to read or parse receipt file" "packet Q6: no second, misleading error from a catch that wrapped the exit"
PK_M=$(pk_mutant swallow check-phase-review-receipt.js 'if (err instanceof ExitSignal) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
    console.error(`Failed to read or parse receipt file' 'if (false) throw err; // in-process set check: an exit inside a try must reach runModeAInProcess
    console.error(`Failed to read or parse receipt file') || fail "mutation setup failed (Q6)"
PK_OUT=$(pk_check "$PK_M/scripts/check-phase-review-receipt.js" "$PK_LEDGER6" "$TEST_TMP/pk_packets.json"); PK_RC=$?
assert_contains "$PK_OUT" "Failed to read or parse receipt file" "packet Q6 (mutation): without the re-throw the catch reports a misleading second error"

# BL-0111: review_fresh_context — off is legal but stamped on the review receipt; on leaves it unchanged
fc_resolver() { # $1 = value printed for review_fresh_context
  local f="$TEST_TMP/bin/resolve-fc-$1.sh"
  cat > "$f" <<FCEOF
#!/usr/bin/env bash
case "\$2" in
  review_fresh_context) echo "$1" ;;
  hetero_review_resolved_from) echo explicit ;;
  *) echo "" ;;
esac
FCEOF
  chmod +x "$f"; echo "$f"
}
fc_finalize() { # $1 = phase, $2 = resolver, $3 = script
  mkdir -p "$LEDGER/review-$1/g1"
  printf '[{"generation":1,"base":"b1","head":"h1","seats":["s0"],"status":"pending"}]\n' > "$LEDGER/review-$1/chain.json"
  printf '{"base":"b1","head":"h1"}\n' > "$LEDGER/review-$1/g1/range.json"
  printf '{"findings":[{"id":"f1","severity":"Minor","seat":"s0","text":"x"}]}\n' > "$LEDGER/review-$1/g1/findings.json"
  printf '{"schema_version":1,"phase":"%s","generation":1,"findings":[{"id":"f1","disposition":"refuted","rationale":"not a bug"}]}\n' "$1" > "$TEST_TMP/disp_$1.json"
  AUTOPILOT_REVIEW_LOOP_RESOLVER="$2" node "$3" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase "$1" --generation 1 --dispositions "$TEST_TMP/disp_$1.json" 2>&1
}
FC_OUT=$(fc_finalize p_fc_off "$(fc_resolver off)" "$SCRIPT"); FC_RC=$?
assert_exit_code "$FC_RC" "0" "fresh-context: finalize with review_fresh_context=off exits 0 (off is legal)"
assert_contains "$(cat "$LEDGER/receipt-p_fc_off.json")" '"review_fresh_context": "off"' "fresh-context: off is stamped on the review receipt"
FC_OUT=$(fc_finalize p_fc_on "$(fc_resolver on)" "$SCRIPT"); FC_RC=$?
assert_exit_code "$FC_RC" "0" "fresh-context: finalize with review_fresh_context=on exits 0"
assert_not_contains "$(cat "$LEDGER/receipt-p_fc_on.json")" 'review_fresh_context' "fresh-context: on leaves the receipt unchanged"
FC_M=$(pk_mutant fcstamp hetero-review-loop.js "...(freshContext === 'off' ? { review_fresh_context: 'off' } : {})," "...({}),") || fail "mutation setup failed (fresh-context)"
FC_OUT=$(fc_finalize p_fc_mut "$(fc_resolver off)" "$FC_M/scripts/hetero-review-loop.js"); FC_RC=$?
assert_not_contains "$(cat "$LEDGER/receipt-p_fc_mut.json")" 'review_fresh_context' "fresh-context (mutation): without the stamp an off receipt shows nothing"

# RED at b7cd9d2bc: 7 failed (base == head exit 0; no 'empty review range' text; g1 dir and chain.json recorded; excluded-everything exit 0 with g1 left)
# BL-0269: collect refuses an empty review range (base == head, or every changed path excluded) instead of
# recording a zero-byte diff as a normal review. The generation directory is not left behind, so the same
# generation number can be collected once the range has content.
unset STUB_RESPONSE_s0 STUB_RESPONSE_s1
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
ER_HEAD=$(git -C "$SCRATCH_REPO" rev-parse work)
ER_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_er --generation 1 --branch work --phase-base "$ER_HEAD" --seats "m1/low@codex" 2>&1); ER_RC=$?
assert_exit_code "$ER_RC" "1" "empty-range: base == head is refused"
assert_contains "$ER_OUT" "empty review range" "empty-range: the refusal names the empty range"
assert_file_absent "$LEDGER/review-p_er/g1" "empty-range: no generation directory is left behind"
assert_file_absent "$LEDGER/review-p_er/chain.json" "empty-range: no chain entry is recorded"
ER_X="$TEST_TMP/er_excl_repo"; mkdir -p "$ER_X/generated"
( cd "$ER_X" && git init -q && git config user.email "test@example.com" && git config user.name "Test User" && echo a > generated/g.txt && git add . && git commit -q -m b \
  && git checkout -q -b work && echo b >> generated/g.txt && git commit -q -am w )
ER_XB=$(git -C "$ER_X" rev-parse HEAD~1)
ER2_OUT=$(node "$SCRIPT" collect --repo-root "$ER_X" --ledger "$LEDGER" --phase p_er2 --generation 1 --branch work --phase-base "$ER_XB" --exclude "generated/**" --seats "m1/low@codex" 2>&1); ER2_RC=$?
assert_exit_code "$ER2_RC" "1" "empty-range: a range whose every changed path is excluded is refused"
assert_contains "$ER2_OUT" "empty review range" "empty-range: excluded-everything names the empty range"
assert_file_absent "$LEDGER/review-p_er2/g1" "empty-range: excluded-everything leaves no generation directory"
ER3_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_er3 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); ER3_RC=$?
assert_exit_code "$ER3_RC" "0" "empty-range: a non-empty range is still collected"
ER_M=$(pk_mutant erange hetero-review-loop.js "if (diffBytes === 0) {" "if (false) {") || fail "mutation setup failed (empty-range)"
ER4_OUT=$(node "$ER_M/scripts/hetero-review-loop.js" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_er4 --generation 1 --branch work --phase-base "$ER_HEAD" --seats "m1/low@codex" 2>&1); ER4_RC=$?
assert_exit_code "$ER4_RC" "0" "empty-range (mutation): without the guard an empty range is collected again"

finalize_test
