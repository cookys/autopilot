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

# Case 5: a seat returning {status: "no_verdict"} without --allow-seat-gap exits 1 and chain.json is not updated
export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
export STUB_RESPONSE_s1='{"status": "no_verdict"}'
unset STUB_SEAT_RESPONSE
C5_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p5 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" 2>&1); C5_RC=$?
assert_exit_code "$C5_RC" "1" "case 5: exits 1 on gap without --allow-seat-gap"
assert_file_exists "$LEDGER/review-p5/g1/range.json" "case 5: range.json written before exit"
assert_file_exists "$LEDGER/review-p5/g1/seat-s1.json" "case 5: seat-s1.json written"
assert_file_absent "$LEDGER/review-p5/chain.json" "case 5: chain.json not written"
assert_file_absent "$LEDGER/review-p5/g1/findings.json" "case 5: findings.json not written"

# Case 6: same as (5) but with --allow-seat-gap exits 0 and chain.json has pending-with-gap
C6_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p6 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex,m2/med@agy" --allow-seat-gap 2>&1); C6_RC=$?
assert_exit_code "$C6_RC" "0" "case 6: exits 0 with --allow-seat-gap"
assert_file_exists "$LEDGER/review-p6/chain.json" "case 6: chain.json written"
assert_contains "$(cat "$LEDGER/review-p6/chain.json")" '"status": "pending-with-gap"' "case 6: status is pending-with-gap"

# Case 7: generation 2 with chain.json seeded with g1 head X uses X as base
mkdir -p "$LEDGER/review-p7"
SEED_BASE="$PHASE_BASE"
SEED_HEAD=$(git -C "$SCRATCH_REPO" rev-parse work~0)
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
TOPOLOGY_FILE="$TEST_TMP/topology.json"
cat << 'TOPO_EOF' > "$TOPOLOGY_FILE"
{
  "implementer_ladder": [
    {
      "engine": "custom-engine",
      "runner": "custom-runner",
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
assert_contains "$BRIEF_LINE1" "custom-engine@custom-runner effort=max" "case 2 (fin): line 1 uses custom topology"
# Run check-redispatch-prompt.sh on the hands-brief.md
CHECK_BRIEF_OUT=$(bash "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$LEDGER/review-p_fin2/g1/hands-brief.md" 2>&1); CHECK_BRIEF_RC=$?
assert_exit_code "$CHECK_BRIEF_RC" "0" "case 2 (fin): check-redispatch-prompt.sh exits 0 on hands-brief.md"

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
  ]
}
EOF
FIN7_G2_OUT=$(node "$SCRIPT" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_fin7 --generation 2 --dispositions "$TEST_TMP/disp_fin7_g2.json" 2>&1); FIN7_G2_RC=$?
assert_exit_code "$FIN7_G2_RC" "0" "case 7 (fin): gen 2 finalize exits 0"
assert_contains "$(cat "$LEDGER/receipt-p_fin7.json")" '"verdict": "SHIP-AS-IS"' "case 7 (fin): gen 2 verdict is SHIP-AS-IS"

CHAIN_P7=$(cat "$LEDGER/review-p_fin7/chain.json")
assert_contains "$CHAIN_P7" '"closed_by_generation": 2' "case 7 (fin): gen 1 entry recorded closed_by_generation: 2"
assert_contains "$CHAIN_P7" '"finding_g1_crit"' "case 7 (fin): closed finding id matches finding_g1_crit"

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

T2C_OUT=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test2c --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" --allow-seat-gap 2>&1); T2C_RC=$?
assert_exit_code "$T2C_RC" "0" "test 2c: exits 0 with --allow-seat-gap"
assert_contains "$(cat "$LEDGER/review-p_test2c/chain.json")" '"status": "pending-with-gap"' "test 2c: chain entry status is pending-with-gap"
assert_contains "$T2C_OUT" '"proof_present": false' "test 2c: summary records proof_present false"

# Test 3: chain immutability: run collect once (pending), run again for same generation -> exits 1 without modifying entry
export STUB_SEAT_RESPONSE='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
T3_OUT1=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test3 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T3_RC1=$?
assert_exit_code "$T3_RC1" "0" "test 3: first collect exits 0"
T3_CHAIN_BEFORE=$(cat "$LEDGER/review-p_test3/chain.json")
T3_OUT2=$(node "$SCRIPT" collect --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_test3 --generation 1 --branch work --phase-base "$PHASE_BASE" --seats "m1/low@codex" 2>&1); T3_RC2=$?
assert_exit_code "$T3_RC2" "1" "test 3: second collect for same generation exits 1"
T3_CHAIN_AFTER=$(cat "$LEDGER/review-p_test3/chain.json")
assert_eq "$T3_CHAIN_BEFORE" "$T3_CHAIN_AFTER" "test 3: chain.json unchanged on refused rerun"

# Test 4: aborted entry replacement: chain entry with status aborted replaced in place (exactly 1 entry, not 2)
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
assert_exit_code "$T4_RC" "0" "test 4: collect succeeds on replacing aborted entry"
T4_CHAIN_LEN=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1])).length);' "$LEDGER/review-p_test4/chain.json")
assert_eq "$T4_CHAIN_LEN" "1" "test 4: chain has exactly 1 entry (replaced in place)"
T4_STATUS=$(node -e 'console.log(JSON.parse(fs.readFileSync(process.argv[1]))[0].status);' "$LEDGER/review-p_test4/chain.json")
assert_eq "$T4_STATUS" "pending" "test 4: replaced entry status reflects new run"

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
assert_exit_code "$T7_RC" "0" "test 7: collect exits 0 with --allow-seat-gap"
T7_SEAT_OUTPUT=$(cat "$LEDGER/review-p_test7/g1/seat-s0.json")
assert_contains "$T7_SEAT_OUTPUT" '"verdict": "no_verdict"' "test 7: recorded verdict is no_verdict on non-zero exit"
assert_contains "$T7_SEAT_OUTPUT" '"status": "no_verdict"' "test 7: recorded status is no_verdict on non-zero exit"
assert_not_contains "$T7_SEAT_OUTPUT" '"verdict": "SHIP-AS-IS"' "test 7: printed verdict SHIP-AS-IS is ignored"
unset AUTOPILOT_DISPATCH_REVIEW_SCRIPT

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
T10_OUT=$(node "$SCRIPT" collect --repo-root "$LARGE_REPO" --ledger "$LEDGER" --phase p_test10_warn --generation 1 --branch work --phase-base "$LARGE_BASE" --seats "m1/low@codex" 2>&1); T10_RC=$?
assert_exit_code "$T10_RC" "0" "test 10: large diff collect exits 0 (does not block)"
assert_contains "$T10_OUT" "WARNING: Diff size" "test 10: diff size warning printed"
assert_contains "$T10_OUT" "exceeds 400000 bytes" "test 10: diff size warning names threshold"
assert_contains "$T10_OUT" "--exclude" "test 10: diff size warning suggests --exclude"

finalize_test

