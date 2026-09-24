#!/usr/bin/env bash
# review-loop-resolver-b.test.sh — row-39+ contract tests for review-loop resolver-b
. "$(dirname "$0")/lib.sh"

assert_r39_hetero_review_loop_c() {
  local mod="$REPO_ROOT/scripts/lib/exclude-allowlist.js"
  assert_file_exists "$mod" "r39: exclude-allowlist.js exists"

  local names
  names=$(node -e "const m=require('$mod'); process.stdout.write(Object.keys(m).sort().join(','))")
  assert_contains "$names" "EXCLUDE_ALLOWLIST" "r39: exports EXCLUDE_ALLOWLIST"
  assert_contains "$names" "isPathspecAllowed" "r39: exports isPathspecAllowed"

  local h_req h_local p_req p_local
  h_req=$(grep -c "require('./lib/exclude-allowlist')" "$REPO_ROOT/scripts/hetero-review-loop.js")
  p_req=$(grep -c "require('./lib/exclude-allowlist')" "$REPO_ROOT/scripts/check-phase-review-receipt.js")
  h_local=$(grep -c "^const EXCLUDE_ALLOWLIST = \[" "$REPO_ROOT/scripts/hetero-review-loop.js" || true)
  p_local=$(grep -c "^const EXCLUDE_ALLOWLIST = \[" "$REPO_ROOT/scripts/check-phase-review-receipt.js" || true)

  assert_eq "$h_req" "1" "r39: hetero-review-loop.js require count is 1"
  assert_eq "$p_req" "1" "r39: check-phase-review-receipt.js require count is 1"
  assert_eq "$h_local" "0" "r39: hetero-review-loop.js has no local EXCLUDE_ALLOWLIST"
  assert_eq "$p_local" "0" "r39: check-phase-review-receipt.js has no local EXCLUDE_ALLOWLIST"
}

assert_r39_hetero_review_loop_c

# # RED: N/A — confirmation only (Mode A already applies requiredMinSeats from
# --min-reviewed-seats on a 3-seat chain: 2 reviewed vs floor 3 exits 1 and names
# the shortfall). Regression guard for row 34.
assert_r34_check_phase_review_r() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"
  local SCRATCH_REPO="$TEST_TMP/r34-repo"
  local LEDGER="$TEST_TMP/r34-ledger"
  mkdir -p "$SCRATCH_REPO/scripts" "$LEDGER"
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
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
  (
    cd "$SCRATCH_REPO"
    git checkout -q -b work
    echo "work changes" >> file.txt
    git add file.txt
    git commit -q -m "c3"
  )
  cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"
  export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  export STUB_RESPONSE_s1='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  export STUB_RESPONSE_s2='{"status": "no_verdict"}'
  unset STUB_SEAT_RESPONSE || true

  local COLLECT_OUT COLLECT_RC
  COLLECT_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r34 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@codex,m2/med@agy,m3/high@grok" \
    --allow-seat-gap --min-reviewed-seats 2 2>&1); COLLECT_RC=$?
  assert_exit_code "$COLLECT_RC" "0" "r34: 3-seat collect with 2 reviewed + gap at floor 2 exits 0"

  cat > "$TEST_TMP/r34-disp.json" <<EOF
{"schema_version":1,"phase":"p_r34","generation":1,"findings":[]}
EOF
  local FIN_OUT FIN_RC
  FIN_OUT=$(node "$HETERO" finalize \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r34 --generation 1 \
    --branch work --dispositions "$TEST_TMP/r34-disp.json" 2>&1); FIN_RC=$?
  assert_exit_code "$FIN_RC" "0" "r34: finalize of 2-of-3 reviewed generation exits 0"

  local CHECK_OUT CHECK_RC
  CHECK_OUT=$(node "$CHECKER" \
    --ledger "$LEDGER" --phase p_r34 --branch work --phase-base "$PHASE_BASE" \
    --repo-root "$SCRATCH_REPO" --min-reviewed-seats 3 2>&1); CHECK_RC=$?
  assert_exit_code "$CHECK_RC" "1" "r34: Mode A --min-reviewed-seats 3 blocks 2-of-3 reviewed receipt"
  assert_contains "$CHECK_OUT" "reviewed seats (2) below minimum required (3)" \
    "r34: refusal names the reviewed-seat shortfall"
}

assert_r34_check_phase_review_r

# confirmation row: expected GREEN at base per BACKLOG sidecar
# Regression guard: finalize open_findings always carries non-empty Major|Minor severity.
assert_r35_hetero_review_loop_c() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local SCRATCH_REPO="$TEST_TMP/r35-repo"
  local LEDGER="$TEST_TMP/r35-ledger"
  mkdir -p "$SCRATCH_REPO/scripts" "$LEDGER"
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
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
  (
    cd "$SCRATCH_REPO"
    git checkout -q -b work
    echo "work changes" >> file.txt
    git add file.txt
    git commit -q -m "c3"
  )
  cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"

  export AUTOPILOT_TOPOLOGY_FILE="$TEST_TMP/r35-no-such-topology.json"
  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"
  export STUB_RESPONSE_s0='{"status": "reviewed", "verdict": "FIX-THEN-SHIP", "findings": "Critical: parser boundary bug\nNeeds a repair.\n\nMajor: unchecked write return\nFollow up.\n\nMinor: noisy log in helper\nCleanup."}'
  export STUB_RESPONSE_s1='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  export STUB_RESPONSE_s2='{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
  unset STUB_SEAT_RESPONSE || true

  local COLLECT_OUT COLLECT_RC
  COLLECT_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r35 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@codex,m2/med@agy,m3/high@grok" 2>&1); COLLECT_RC=$?
  assert_exit_code "$COLLECT_RC" "0" "r35: collect with Critical+Major+Minor findings exits 0"

  node -e '
    const fs = require("fs");
    const findings = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).findings;
    const body = {
      schema_version: 1,
      phase: "p_r35",
      generation: 1,
      findings: findings.map((f) => ({ id: f.id, disposition: "verified", rationale: "confirmed" })),
    };
    fs.writeFileSync(process.argv[2], JSON.stringify(body, null, 2) + "\n");
  ' "$LEDGER/review-p_r35/g1/findings.json" "$TEST_TMP/r35-disp.json"

  local FIN_OUT FIN_RC
  FIN_OUT=$(node "$HETERO" finalize \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r35 --generation 1 \
    --branch work --dispositions "$TEST_TMP/r35-disp.json" 2>&1); FIN_RC=$?
  assert_exit_code "$FIN_RC" "0" "r35: finalize of verified Critical+Major+Minor exits 0"

  local RECEIPT="$LEDGER/receipt-p_r35.json"
  assert_file_exists "$RECEIPT" "r35: receipt exists"
  assert_contains "$(cat "$RECEIPT")" '"verdict": "FIX-THEN-SHIP"' "r35: receipt verdict is FIX-THEN-SHIP"

  local SEV_CHECK="missing"
  if [ -f "$RECEIPT" ]; then
    SEV_CHECK=$(node -e '
      const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
      const open = r.open_findings;
      if (!Array.isArray(open) || open.length !== 2) {
        console.log("bad_count:" + (Array.isArray(open) ? open.length : typeof open));
        process.exit(0);
      }
      const sevs = open.map((f) => f && f.severity).sort();
      const ok = open.every((f) => typeof f.severity === "string" && f.severity.length > 0 && /^(Major|Minor)$/.test(f.severity));
      if (!ok || sevs.join(",") !== "Major,Minor") {
        console.log("bad_sev:" + JSON.stringify(open));
        process.exit(0);
      }
      console.log("ok");
    ' "$RECEIPT")
  fi
  assert_eq "$SEV_CHECK" "ok" "r35: every open_findings entry has non-empty severity Major|Minor"
  unset AUTOPILOT_TOPOLOGY_FILE AUTOPILOT_DISPATCH_REVIEW_SCRIPT STUB_RESPONSE_s0 STUB_RESPONSE_s1 STUB_RESPONSE_s2 || true
}

assert_r35_hetero_review_loop_c

assert_r37_hetero_review_loop_c() {
  local mod="$REPO_ROOT/scripts/lib/seat-id-guard.js"
  assert_file_exists "$mod" "r37: seat-id-guard.js exists"

  local results
  results=$(node -e "
    const { isSafeSeatId } = require('$mod');
    const cases = [
      ['../evil', false],
      ['/etc/passwd', false],
      ['s0', true],
      ['qc', true],
    ];
    for (const [id, expected] of cases) {
      const got = isSafeSeatId(id);
      if (got !== expected) {
        process.stdout.write('fail:' + id + ':' + got);
        process.exit(0);
      }
    }
    process.stdout.write('ok');
  ")
  assert_eq "$results" "ok" "r37: isSafeSeatId rejects traversal and absolute paths; accepts s0 and qc"
}

assert_r37_hetero_review_loop_c

# RED at base: Mode A fails when head moved by CHANGELOG.md-only closeout.
# GREEN: same receipt accepts H2 via allowlisted-only delta; H3 source change keeps the original failure.
assert_r38_check_phase_review_r() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"
  local SCRATCH_REPO="$TEST_TMP/r38-repo"
  local LEDGER="$TEST_TMP/r38-ledger"
  mkdir -p "$SCRATCH_REPO/scripts" "$LEDGER"
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
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
  (
    cd "$SCRATCH_REPO"
    git checkout -q -b work
    echo "work changes" >> file.txt
    git add file.txt
    git commit -q -m "c3"
  )
  cat << 'STUB_EOF' > "$SCRATCH_REPO/scripts/dispatch-review.sh"
#!/usr/bin/env bash
if [ -n "$STUB_SEAT_ID" ]; then
  VAR="STUB_RESPONSE_${STUB_SEAT_ID}"
  if [ -n "${!VAR}" ]; then
    echo "${!VAR}"
    exit 0
  fi
fi
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$SCRATCH_REPO/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_REPO/scripts/check-redispatch-prompt.sh"

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_REPO/scripts/dispatch-review.sh"
  unset STUB_SEAT_RESPONSE || true

  local COLLECT_OUT COLLECT_RC
  COLLECT_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r38 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@codex" \
    --min-reviewed-seats 1 2>&1); COLLECT_RC=$?
  assert_exit_code "$COLLECT_RC" "0" "r38: collect at H1 exits 0"

  cat > "$TEST_TMP/r38-disp.json" <<EOF
{"schema_version":1,"phase":"p_r38","generation":1,"findings":[]}
EOF
  local FIN_OUT FIN_RC
  FIN_OUT=$(node "$HETERO" finalize \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r38 --generation 1 \
    --branch work --dispositions "$TEST_TMP/r38-disp.json" 2>&1); FIN_RC=$?
  assert_exit_code "$FIN_RC" "0" "r38: finalize at H1 exits 0"

  local H1
  H1=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

  local CHECK_H1_OUT CHECK_H1_RC
  CHECK_H1_OUT=$(node "$CHECKER" \
    --ledger "$LEDGER" --phase p_r38 --branch work --phase-base "$PHASE_BASE" \
    --repo-root "$SCRATCH_REPO" --min-reviewed-seats 1 2>&1); CHECK_H1_RC=$?
  assert_exit_code "$CHECK_H1_RC" "0" "r38: Mode A at reviewed head H1 exits 0"

  (
    cd "$SCRATCH_REPO"
    echo "# closeout" > CHANGELOG.md
    git add CHANGELOG.md
    git commit -q -m "closeout changelog"
  )
  local H2
  H2=$(git -C "$SCRATCH_REPO" rev-parse HEAD)

  local CHECK_H2_OUT CHECK_H2_RC
  CHECK_H2_OUT=$(node "$CHECKER" \
    --ledger "$LEDGER" --phase p_r38 --branch work --phase-base "$PHASE_BASE" \
    --repo-root "$SCRATCH_REPO" --min-reviewed-seats 1 2>&1); CHECK_H2_RC=$?
  assert_exit_code "$CHECK_H2_RC" "0" "r38: Mode A at H2 (CHANGELOG.md-only) exits 0"
  assert_contains "$CHECK_H2_OUT" "Head moved by" "r38: H2 logs allowlisted-move note"
  assert_contains "$CHECK_H2_OUT" "allowlisted-only" "r38: H2 note names allowlisted-only"
  assert_contains "$CHECK_H2_OUT" "CHANGELOG.md" "r38: H2 note includes CHANGELOG.md"

  (
    cd "$SCRATCH_REPO"
    echo "source" >> file.txt
    git add file.txt
    git commit -q -m "real source change"
  )

  local CHECK_H3_OUT CHECK_H3_RC
  CHECK_H3_OUT=$(node "$CHECKER" \
    --ledger "$LEDGER" --phase p_r38 --branch work --phase-base "$PHASE_BASE" \
    --repo-root "$SCRATCH_REPO" --min-reviewed-seats 1 2>&1); CHECK_H3_RC=$?
  assert_exit_code "$CHECK_H3_RC" "1" "r38: Mode A at H3 (source file) exits 1"
  assert_contains "$CHECK_H3_OUT" "head has moved: expected '${H1}', got" \
    "r38: H3 keeps original head-has-moved failure"

  unset AUTOPILOT_DISPATCH_REVIEW_SCRIPT || true
}

assert_r38_check_phase_review_r

# RED at base: scripts/lib/review-chain-derive.js advertised "No side effects"
# while deriveReceiptState mutates input chain entries' closed_findings in place.
# Pin the mutation as intentional; callers write those stamps back to chain.json.
assert_r40_review_chain_derive() {
  local SRC="$REPO_ROOT/scripts/lib/review-chain-derive.js"
  local GREP_RC=0
  grep -q "No side effects" "$SRC" || GREP_RC=$?
  assert_neq "$GREP_RC" "0" "r40: ! grep -q 'No side effects' scripts/lib/review-chain-derive.js"
  local body
  body=$(cat "$SRC")
  assert_not_contains "$body" "No side effects" "r40: file content has no 'No side effects'"

  local MUTATION
  MUTATION=$(node -e '
    const derive = require(process.argv[1]);
    const g1 = { generation: 1, status: "finalized" };
    const g2 = { generation: 2, status: "finalized" };
    const chain = [g1, g2];
    const findings = new Map([
      [1, [{ id: "F1", severity: "Major", seat: "s0", text: "unchecked null" }]],
      [2, []],
    ]);
    const dispositions = new Map([
      [1, [{ id: "F1", disposition: "verified" }]],
      [2, []],
    ]);
    derive.deriveReceiptState(chain, findings, dispositions);
    const stamps = g1.closed_findings;
    if (!Array.isArray(stamps) || stamps.length < 1) {
      process.stdout.write("missing");
      process.exit(0);
    }
    const hit = stamps.some((cf) => cf && cf.id === "F1" && cf.closed_by_generation === 2);
    process.stdout.write(hit ? "ok" : "mismatch:" + JSON.stringify(stamps));
  ' "$SRC")
  assert_eq "$MUTATION" "ok" "r40: passed-in g1 object has closed_findings populated after deriveReceiptState"
}

assert_r40_review_chain_derive

# RED at base (verbatim stdout from opt-out on fixture line `9plan_review: off`):
# {
#   "phase": "p_r46",
#   "knob": "plan_review",
#   "configured_value": "off"
# }
# Digit 9 sat inside the accidental `*->` range in `[\\s#*->]`. After the
# class is `[-\s#*>]`, that line must stay `absent`; markdown prefixes still match.
assert_r46_hetero_review_loop_j() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local SCRATCH="$TEST_TMP/r46-repo"
  local LEDGER="$TEST_TMP/r46-ledger"
  mkdir -p "$SCRATCH/.claude" "$LEDGER"

  printf '#!/bin/sh\necho unknown\n' > "$TEST_TMP/r46-resolver.sh"
  chmod +x "$TEST_TMP/r46-resolver.sh"

  run_opt_out_cv() {
    local line="$1"
    local phase="$2"
    printf '%s\n' "$line" > "$SCRATCH/.claude/review-loop-config.md"
    local out
    out=$(
      AUTOPILOT_REVIEW_LOOP_RESOLVER="$TEST_TMP/r46-resolver.sh" \
      node "$HETERO" opt-out \
        --repo-root "$SCRATCH" --ledger "$LEDGER" --phase "$phase" --knob plan_review 2>&1
    )
    node -e 'const s=process.argv[1]; const j=JSON.parse(s.match(/\{[\s\S]*\}/)[0]); process.stdout.write(j.configured_value);' "$out"
  }

  local cv_digit cv_dash cv_hash cv_star
  cv_digit=$(run_opt_out_cv '9plan_review: off' p_r46_digit)
  assert_eq "$cv_digit" "absent" "r46: 9plan_review: off has no valid prefix → configured_value absent"

  cv_dash=$(run_opt_out_cv '- plan_review: off' p_r46_dash)
  assert_eq "$cv_dash" "off" "r46: list dash prefix still resolves off"

  cv_hash=$(run_opt_out_cv '# plan_review: off' p_r46_hash)
  assert_eq "$cv_hash" "off" "r46: heading hash prefix still resolves off"

  cv_star=$(run_opt_out_cv '* plan_review: off' p_r46_star)
  assert_eq "$cv_star" "off" "r46: list star prefix still resolves off"
}

assert_r46_hetero_review_loop_j

# RED at base: runSeatDispatch always injects STUB_SEAT_ID into the child env,
# including when AUTOPILOT_DISPATCH_REVIEW_SCRIPT is unset and the real
# path.join(__dirname, 'dispatch-review.sh') is spawned.
assert_r47_hetero_review_loop_j() {
  local SRC="$REPO_ROOT/scripts/hetero-review-loop.js"
  local DRIVER_DIR="$TEST_TMP/r47-driver"
  local SCRATCH_REPO="$TEST_TMP/r47-repo"
  local LEDGER="$TEST_TMP/r47-ledger"
  local ENV_CAPTURE="$TEST_TMP/r47-dispatch.env"
  mkdir -p "$DRIVER_DIR/lib" "$SCRATCH_REPO" "$LEDGER"

  cp "$SRC" "$DRIVER_DIR/hetero-review-loop.js"
  cp "$REPO_ROOT/scripts/lib/review-chain-derive.js" "$DRIVER_DIR/lib/"
  cp "$REPO_ROOT/scripts/lib/seat-id-guard.js" "$DRIVER_DIR/lib/"
  cp "$REPO_ROOT/scripts/lib/exclude-allowlist.js" "$DRIVER_DIR/lib/"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$DRIVER_DIR/check-redispatch-prompt.sh"
  chmod +x "$DRIVER_DIR/check-redispatch-prompt.sh"

  cat << STUB_EOF > "$DRIVER_DIR/dispatch-review.sh"
#!/usr/bin/env bash
env > "$ENV_CAPTURE"
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$DRIVER_DIR/dispatch-review.sh"

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
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
  (
    cd "$SCRATCH_REPO"
    git checkout -q -b work
    echo "work changes" >> file.txt
    git add file.txt
    git commit -q -m "c3"
  )

  unset AUTOPILOT_DISPATCH_REVIEW_SCRIPT STUB_SEAT_ID || true

  local COLLECT_OUT COLLECT_RC
  COLLECT_OUT=$(node "$DRIVER_DIR/hetero-review-loop.js" collect \
    --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase p_r47 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@codex" \
    --min-reviewed-seats 1 2>&1); COLLECT_RC=$?
  assert_exit_code "$COLLECT_RC" "0" "r47: collect via default __dirname dispatcher exits 0"
  assert_file_exists "$ENV_CAPTURE" "r47: stub captured child env"
  assert_not_contains "$(cat "$ENV_CAPTURE")" "STUB_SEAT_ID" \
    "r47: default dispatch-review.sh child env does not contain STUB_SEAT_ID"
}

assert_r47_hetero_review_loop_j

assert_r131_plan_loop_freeze_dis() {
  local CHECKER="$REPO_ROOT/scripts/check-phase-review-receipt.js"
  local PLAN="$TEST_TMP/r131-plan.md"
  local RUBRIC="$TEST_TMP/r131-rubric.md"
  : > "$PLAN"
  : > "$RUBRIC"
  local PLAN_SHA RUBRIC_SHA FP
  PLAN_SHA=$(node -e "const crypto=require('crypto'), fs=require('fs'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$PLAN")
  RUBRIC_SHA=$(node -e "const crypto=require('crypto'), fs=require('fs'); process.stdout.write(crypto.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$RUBRIC")
  FP="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"

  local ART="$TEST_TMP/r131-artifact.json"
  local DISP="$TEST_TMP/r131-disp.json"
  cat << EOF > "$ART"
{
  "artifact_type": "plan_review_artifact",
  "logical_plan_id": "r131-plan",
  "generation": 1,
  "plan_sha256": "$PLAN_SHA",
  "rubric_sha256": "$RUBRIC_SHA",
  "findings": [
    { "fingerprint": "$FP", "candidate_blocker": true, "disposition": null }
  ]
}
EOF
  cat << EOF > "$DISP"
{
  "logical_plan_id": "r131-plan",
  "generation": 1,
  "findings": [
    { "fingerprint": "$FP", "disposition": "accepted_blocker", "rationale": "driver-native disposition has no candidate_blocker" }
  ]
}
EOF

  local OUT RC
  OUT=$(node "$CHECKER" --plan-artifact "$ART" --dispositions "$DISP" --plan-file "$PLAN" --rubric-file "$RUBRIC" 2>&1); RC=$?
  assert_exit_code "$RC" "0" "r131: driver-native dispositions without candidate_blocker exit 0"
  assert_not_contains "$OUT" "candidate_blocker is mandatory" "r131: green path does not mention mandatory candidate_blocker"

  local ART_BAD="$TEST_TMP/r131-artifact-no-cb.json"
  cat << EOF > "$ART_BAD"
{
  "artifact_type": "plan_review_artifact",
  "logical_plan_id": "r131-plan",
  "generation": 1,
  "plan_sha256": "$PLAN_SHA",
  "rubric_sha256": "$RUBRIC_SHA",
  "findings": [
    { "fingerprint": "$FP", "disposition": null }
  ]
}
EOF
  OUT=$(node "$CHECKER" --plan-artifact "$ART_BAD" --dispositions "$DISP" --plan-file "$PLAN" --rubric-file "$RUBRIC" 2>&1); RC=$?
  assert_exit_code "$RC" "1" "r131: plan artifact omitting candidate_blocker exits 1"
  assert_contains "$OUT" "candidate_blocker is mandatory" "r131: artifact-side omission still names mandatory candidate_blocker"
}

assert_r131_plan_loop_freeze_dis

assert_r136_hetero_review_loop_e() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local SCRATCH_OK="$TEST_TMP/r136-ok"
  local SCRATCH_BAD="$TEST_TMP/r136-bad"
  local LEDGER_OK="$TEST_TMP/r136-ok-ledger"
  local LEDGER_BAD="$TEST_TMP/r136-bad-ledger"
  mkdir -p "$SCRATCH_OK/scripts" "$SCRATCH_OK/.claude" "$SCRATCH_OK/benchmarks/matrix" "$LEDGER_OK"
  mkdir -p "$SCRATCH_BAD/scripts" "$SCRATCH_BAD/.claude" "$SCRATCH_BAD/src" "$LEDGER_BAD"

  printf -- '- exclude_allowlist: benchmarks/matrix/**\n' > "$SCRATCH_OK/.claude/review-loop-config.md"
  printf -- '- exclude_allowlist: src/**\n' > "$SCRATCH_BAD/.claude/review-loop-config.md"

  cat << 'STUB_EOF' > "$SCRATCH_OK/scripts/dispatch-review.sh"
#!/usr/bin/env bash
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  cp "$SCRATCH_OK/scripts/dispatch-review.sh" "$SCRATCH_BAD/scripts/dispatch-review.sh"
  chmod +x "$SCRATCH_OK/scripts/dispatch-review.sh" "$SCRATCH_BAD/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_OK/scripts/check-redispatch-prompt.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH_BAD/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH_OK/scripts/check-redispatch-prompt.sh" "$SCRATCH_BAD/scripts/check-redispatch-prompt.sh"

  (
    cd "$SCRATCH_OK"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "base" > keep.txt
    echo "shard" > benchmarks/matrix/a.json
    git add keep.txt benchmarks/matrix/a.json
    git commit -q -m "c1"
    git checkout -q -b work
    echo "work" >> keep.txt
    echo "shard2" >> benchmarks/matrix/a.json
    git add keep.txt benchmarks/matrix/a.json
    git commit -q -m "c2"
  )
  local PHASE_BASE_OK
  PHASE_BASE_OK=$(git -C "$SCRATCH_OK" rev-parse HEAD~1)

  (
    cd "$SCRATCH_BAD"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "base" > keep.txt
    echo "code" > src/app.js
    git add keep.txt src/app.js
    git commit -q -m "c1"
    git checkout -q -b work
    echo "work" >> keep.txt
    echo "code2" >> src/app.js
    git add keep.txt src/app.js
    git commit -q -m "c2"
  )
  local PHASE_BASE_BAD
  PHASE_BASE_BAD=$(git -C "$SCRATCH_BAD" rev-parse HEAD~1)

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_OK/scripts/dispatch-review.sh"
  unset STUB_SEAT_RESPONSE || true

  local OK_OUT OK_RC
  OK_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_OK" --ledger "$LEDGER_OK" --phase p_r136_ok --generation 1 \
    --branch work --phase-base "$PHASE_BASE_OK" \
    --seats "m1/low@codex" --min-reviewed-seats 1 \
    --exclude "benchmarks/matrix/**" 2>&1); OK_RC=$?
  assert_exit_code "$OK_RC" "0" "r136: collect --exclude benchmarks/matrix/** accepted"
  assert_contains "$(cat "$LEDGER_OK/review-p_r136_ok/g1/range.json")" '"benchmarks/matrix/**"' \
    "r136: accepted exclude recorded in range.json.excluded"

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH_BAD/scripts/dispatch-review.sh"
  local BAD_OUT BAD_RC
  BAD_OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH_BAD" --ledger "$LEDGER_BAD" --phase p_r136_bad --generation 1 \
    --branch work --phase-base "$PHASE_BASE_BAD" \
    --seats "m1/low@codex" --min-reviewed-seats 1 \
    --exclude "src/**" 2>&1); BAD_RC=$?
  assert_exit_code "$BAD_RC" "1" "r136: collect --exclude src/** refused"
  assert_contains "$BAD_OUT" "ERROR: Exclude pathspec 'src/**' is not permitted by allowlist" \
    "r136: refuse message shape unchanged"
}

assert_r136_hetero_review_loop_e

assert_r137_agy_seat_payload_ove() {
  local HETERO="$REPO_ROOT/scripts/hetero-review-loop.js"
  local SCRATCH="$TEST_TMP/r137-repo"
  local LEDGER="$TEST_TMP/r137-ledger"
  local CODEX_LOG="$TEST_TMP/r137-codex-dispatch.log"
  mkdir -p "$SCRATCH/scripts" "$LEDGER"
  rm -f "$CODEX_LOG"

  cat << 'STUB_EOF' > "$SCRATCH/scripts/dispatch-review.sh"
#!/usr/bin/env bash
runner=""
while [ $# -gt 0 ]; do
  case "$1" in
    --runner) runner="$2"; shift 2 ;;
    *) shift ;;
  esac
done
if [ "$runner" = "codex" ]; then
  echo dispatched >> "${R137_CODEX_LOG:?}"
fi
echo '{"status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe"}'
STUB_EOF
  chmod +x "$SCRATCH/scripts/dispatch-review.sh"
  cp "$REPO_ROOT/scripts/check-redispatch-prompt.sh" "$SCRATCH/scripts/check-redispatch-prompt.sh"
  chmod +x "$SCRATCH/scripts/check-redispatch-prompt.sh"

  (
    cd "$SCRATCH"
    git init -q
    git config user.email "test@example.com"
    git config user.name "Test User"
    echo "base" > keep.txt
    git add keep.txt
    git commit -q -m "c1"
    git checkout -q -b work
    python3 -c "open('big.txt','w').write('x'*130000)"
    git add keep.txt big.txt
    git commit -q -m "c2-oversized-diff"
  )
  local PHASE_BASE
  PHASE_BASE=$(git -C "$SCRATCH" rev-parse HEAD~1)

  export AUTOPILOT_DISPATCH_REVIEW_SCRIPT="$SCRATCH/scripts/dispatch-review.sh"
  export R137_CODEX_LOG="$CODEX_LOG"
  unset STUB_SEAT_RESPONSE || true

  local OUT RC
  OUT=$(node "$HETERO" collect \
    --repo-root "$SCRATCH" --ledger "$LEDGER" --phase p_r137 --generation 1 \
    --branch work --phase-base "$PHASE_BASE" \
    --seats "m1/low@agy,m2/low@codex" --min-reviewed-seats 1 2>&1); RC=$?
  assert_exit_code "$RC" "1" "r137: oversized agy estimate refuses collect before any seat dispatch"
  assert_contains "$OUT" "single-argv ceiling" "r137: refusal names single-argv ceiling"
  assert_contains "$OUT" "--exclude" "r137: refusal hints --exclude"
  assert_file_absent "$CODEX_LOG" "r137: codex stub dispatch log does not exist (no seat dispatched)"
}

assert_r137_agy_seat_payload_ove

finalize_test
