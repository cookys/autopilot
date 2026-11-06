#!/usr/bin/env bash
# major-disposition-gate.test.sh — gate rule A as a machine check (G14): a Critical/Major finding is
# verified (and resolved later), refuted as false (refutation_kind + evidence) or downgraded
# (to + evidence_kind + evidence). finalize refuses the rest; the receipt fails the rest for chains
# finalized after the cutover. FAKE ledgers only.
. "$(dirname "$0")/lib.sh"

LOOP="$REPO_ROOT/scripts/hetero-review-loop.js"
CHECK="$REPO_ROOT/scripts/check-phase-review-receipt.js"

SCRATCH_REPO="$TEST_TMP/repo"
mkdir -p "$SCRATCH_REPO/scripts"
(
  cd "$SCRATCH_REPO"
  git init -q
  git config user.email "test@example.com"
  git config user.name "Test User"
  echo "initial" > file.txt; git add file.txt; git commit -q -m "c1"
  echo "base content" > file.txt; git add file.txt; git commit -q -m "c2"
)
PHASE_BASE=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(
  cd "$SCRATCH_REPO"
  git checkout -q -b work
  echo "work changes" >> file.txt; git add file.txt; git commit -q -m "c3"
)
GEN1_HEAD=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
(
  cd "$SCRATCH_REPO"
  echo "fix" >> file.txt; git add file.txt; git commit -q -m "c4 fix"
)
GEN2_HEAD=$(git -C "$SCRATCH_REPO" rev-parse HEAD)
git -C "$SCRATCH_REPO" reset -q --hard "$GEN1_HEAD"
LEDGER="$TEST_TMP/ledger"
mkdir -p "$LEDGER"
sha_of() { node -e "const c=require('crypto'),f=require('fs');process.stdout.write(c.createHash('sha256').update(f.readFileSync(process.argv[1])).digest('hex'))" "$1"; }

# ─── finalize (hetero-review-loop.js) ───
fin_case() { # <phase> <severity> <disposition-entry-json-fields> -> runs finalize, sets FIN_OUT FIN_RC
  local p="$1" sev="$2" fields="$3"
  mkdir -p "$LEDGER/review-$p/g1"
  cat > "$LEDGER/review-$p/chain.json" <<EOF
[ { "generation": 1, "base": "base_$p", "head": "head_$p", "seats": ["s0"], "status": "pending" } ]
EOF
  echo "{ \"base\": \"base_$p\", \"head\": \"head_$p\" }" > "$LEDGER/review-$p/g1/range.json"
  echo "{ \"findings\": [ { \"id\": \"fm\", \"severity\": \"$sev\", \"seat\": \"s0\", \"text\": \"Unchecked return in write.js\" } ] }" > "$LEDGER/review-$p/g1/findings.json"
  cat > "$TEST_TMP/disp_$p.json" <<EOF
{ "schema_version": 1, "phase": "$p", "generation": 1,
  "findings": [ { "id": "fm", $fields } ] }
EOF
  FIN_OUT=$(node "$LOOP" finalize --repo-root "$SCRATCH_REPO" --ledger "$LEDGER" --phase "$p" --generation 1 --dispositions "$TEST_TMP/disp_$p.json" 2>&1); FIN_RC=$?
}

# F1 (negative control): a Major refuted with only "not blocking" and no refutation_kind is refused, names the id
fin_case f1 Major '"disposition": "refuted", "rationale": "true but not blocking"'
assert_exit_code "$FIN_RC" "1" "F1: Major refuted without refutation_kind is refused"
assert_contains "$FIN_OUT" "finding fm is refuted without refutation_kind" "F1: message names the finding id and the missing kind"
assert_file_absent "$LEDGER/receipt-f1.json" "F1: refusal writes no receipt"

# F2: refuted false_claim without evidence is refused
fin_case f2 Major '"disposition": "refuted", "rationale": "wrong", "refutation_kind": "false_claim"'
assert_exit_code "$FIN_RC" "1" "F2: refuted without evidence is refused"
assert_contains "$FIN_OUT" "without non-empty evidence" "F2: message asks for evidence"

# F3: "low_impact" is not a kind
fin_case f3 Major '"disposition": "refuted", "rationale": "x", "refutation_kind": "low_impact", "evidence": "n/a"'
assert_exit_code "$FIN_RC" "1" "F3: refutation_kind low_impact is refused"

# F4: refuted unreachable with evidence is accepted, SHIP-AS-IS
fin_case f4 Major '"disposition": "refuted", "rationale": "x", "refutation_kind": "unreachable", "evidence": "scripts/x.js:10 guards the only caller; test t.sh case 2 shows it"'
assert_exit_code "$FIN_RC" "0" "F4: refuted unreachable + evidence is accepted"
assert_contains "$(cat "$LEDGER/receipt-f4.json")" '"verdict": "SHIP-AS-IS"' "F4: verdict SHIP-AS-IS"

# F5: downgrade missing evidence is refused
fin_case f5 Major '"disposition": "downgraded", "rationale": "x", "to": "Minor", "evidence_kind": "impact_bounded"'
assert_exit_code "$FIN_RC" "1" "F5: downgrade without evidence is refused"
assert_contains "$FIN_OUT" "downgraded without non-empty evidence" "F5: message names the missing evidence"

# F6: downgrade to Major / missing evidence_kind refused
fin_case f6 Major '"disposition": "downgraded", "rationale": "x", "to": "Major", "evidence_kind": "impact_bounded", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F6: downgrade to Major is refused"
fin_case f6b Major '"disposition": "downgraded", "rationale": "x", "to": "Minor", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F6b: downgrade without evidence_kind is refused"

# F7: complete downgrade is accepted
fin_case f7 Critical '"disposition": "downgraded", "rationale": "x", "to": "Suggestion", "evidence_kind": "unreachable", "evidence": "no caller passes the empty list: grep -n callers scripts/ shows 1 hit at a.js:4"'
assert_exit_code "$FIN_RC" "0" "F7: complete downgrade is accepted"
assert_contains "$(cat "$LEDGER/receipt-f7.json")" '"verdict": "SHIP-AS-IS"' "F7: verdict SHIP-AS-IS"

# F8: verified Major still gives FIX-THEN-SHIP (the gate demand for verified is unchanged)
fin_case f8 Major '"disposition": "verified", "rationale": "confirmed"'
assert_exit_code "$FIN_RC" "0" "F8: verified Major finalizes"
assert_contains "$(cat "$LEDGER/receipt-f8.json")" '"verdict": "FIX-THEN-SHIP"' "F8: verified Major is FIX-THEN-SHIP"

# F9: Minor keeps the old rule (plain refuted accepted)
fin_case f9 Minor '"disposition": "refuted", "rationale": "not a bug"'
assert_exit_code "$FIN_RC" "0" "F9: Minor refuted without kind keeps the old rule"

# F10: downgraded on a Minor finding is misuse
fin_case f10 Minor '"disposition": "downgraded", "rationale": "x", "to": "Suggestion", "evidence_kind": "unreachable", "evidence": "e"'
assert_exit_code "$FIN_RC" "1" "F10: downgraded on a non-Major finding is refused"

# ─── receipt (check-phase-review-receipt.js) ───
OLD_AT="2026-11-01T00:00:00.000Z"
NEW_AT="2026-11-07T00:00:00.000Z"
DIFF1=$(git -C "$SCRATCH_REPO" diff "$PHASE_BASE" "$GEN1_HEAD" | sha256sum | awk '{print $1}')
DIFF2=$(git -C "$SCRATCH_REPO" diff "$GEN1_HEAD" "$GEN2_HEAD" | sha256sum | awk '{print $1}')

rc_gen() { # <phase> <gen> <base> <head> <diffsha> <findings-json-array> <disp-json-array> <resolutions-json-array> -> echoes chain entry json
  local p="$1" g="$2" b="$3" h="$4" ds="$5" fj="$6" dj="$7" rj="$8" at="$9"
  mkdir -p "$LEDGER/review-$p/g$g"
  echo "{ \"base\": \"$b\", \"head\": \"$h\", \"diff_sha256\": \"$ds\" }" > "$LEDGER/review-$p/g$g/range.json"
  echo "{ \"findings\": $fj }" > "$LEDGER/review-$p/g$g/findings.json"
  echo "{ \"findings\": $dj, \"resolutions\": $rj }" > "$LEDGER/review-$p/g$g/dispositions.json"
  echo '{ "status": "reviewed", "verdict": "SHIP-AS-IS", "findings": "", "no_finding_proof": "checked=all; evidence=clean diff; conclusion=safe" }' > "$LEDGER/review-$p/g$g/seat-s0.json"
  local dsha fsha ssha
  ssha=$(sha_of "$LEDGER/review-$p/g$g/seat-s0.json")
  dsha=$(sha_of "$LEDGER/review-$p/g$g/dispositions.json"); fsha=$(sha_of "$LEDGER/review-$p/g$g/findings.json")
  echo "{ \"generation\": $g, \"base\": \"$b\", \"head\": \"$h\", \"status\": \"finalized\", \"seats\": [{ \"id\": \"s0\", \"status\": \"reviewed\" }], \"seat_artifact_sha256\": { \"s0\": \"$ssha\" }, \"finalized_at\": \"$at\", \"dispositions_sha256\": \"$dsha\", \"findings_sha256\": \"$fsha\" }"
}
rc_write() { # <phase> <verdict> <open-json> <chain-entries comma-joined>
  local p="$1" v="$2" o="$3" ch="$4"
  echo "[ $ch ]" > "$LEDGER/review-$p/chain.json"
  echo "{ \"kind\": \"review\", \"phase\": \"$p\", \"branch\": \"work\", \"phase_base_sha\": \"$PHASE_BASE\", \"chain\": [ $ch ], \"verdict\": \"$v\", \"open_findings\": $o, \"resolved_from\": \"test\", \"written_at\": \"2026-11-07T00:00:00Z\" }" > "$LEDGER/receipt-$p.json"
}
rc_run() { # <phase> -> RC_OUT RC_RC
  RC_OUT=$(node "$CHECK" --ledger "$LEDGER" --phase "$1" --branch work --phase-base "$PHASE_BASE" --repo-root "$SCRATCH_REPO" 2>&1); RC_RC=$?
}
FJ='[ { "id": "fm", "severity": "Major", "seat": "s0", "text": "bug" } ]'
mkdir -p "$LEDGER/review-r1" "$LEDGER/review-r2" "$LEDGER/review-r3" "$LEDGER/review-r4" "$LEDGER/review-r5" "$LEDGER/review-r6" "$LEDGER/review-r7"

# R1 (negative control): verified Major left open -> the receipt does not pass (FIX-THEN-SHIP is refused; a forged SHIP-AS-IS mismatches the re-derived state)
E=$(rc_gen r1 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' "$NEW_AT")
rc_write r1 "SHIP-AS-IS" '[]' "$E"; rc_run r1
assert_exit_code "$RC_RC" "1" "R1: unhandled verified Major (forged SHIP-AS-IS) fails the receipt"
E=$(rc_gen r1 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' "$NEW_AT")
rc_write r1 "FIX-THEN-SHIP" '[ { "id": "fm", "severity": "Major", "disposition": "verified" } ]' "$E"; rc_run r1
assert_exit_code "$RC_RC" "1" "R1b: honest FIX-THEN-SHIP receipt fails the merge gate"

# R2: refuted Major without refutation_kind in a chain finalized after the cutover fails, naming the rule
E=$(rc_gen r2 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "not blocking" } ]' '[]' "$NEW_AT")
rc_write r2 "SHIP-AS-IS" '[]' "$E"; rc_run r2
assert_exit_code "$RC_RC" "1" "R2: post-cutover refuted Major without refutation_kind fails"
assert_contains "$RC_OUT" "refuted without refutation_kind" "R2: message names the missing kind"

# R3: the SAME ledger finalized before the cutover is not re-failed
E=$(rc_gen r3 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "not blocking" } ]' '[]' "$OLD_AT")
rc_write r3 "SHIP-AS-IS" '[]' "$E"; rc_run r3
assert_exit_code "$RC_RC" "0" "R3: pre-cutover chain with old-style refuted Major is not re-failed"

# R4: refuted with kind + evidence passes
E=$(rc_gen r4 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "refuted", "rationale": "r", "refutation_kind": "false_claim", "evidence": "file.txt:1 does not do that" } ]' '[]' "$NEW_AT")
rc_write r4 "SHIP-AS-IS" '[]' "$E"; rc_run r4
assert_exit_code "$RC_RC" "0" "R4: refuted with kind + evidence passes"

# R5: downgraded with fields passes
E=$(rc_gen r5 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "downgraded", "rationale": "r", "to": "Minor", "evidence_kind": "impact_bounded", "evidence": "only the debug path reads it: a.js:9" } ]' '[]' "$NEW_AT")
rc_write r5 "SHIP-AS-IS" '[]' "$E"; rc_run r5
assert_exit_code "$RC_RC" "0" "R5: downgraded with fields passes"

# R6: downgraded missing evidence fails
E=$(rc_gen r6 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "downgraded", "rationale": "r", "to": "Minor", "evidence_kind": "impact_bounded" } ]' '[]' "$NEW_AT")
rc_write r6 "SHIP-AS-IS" '[]' "$E"; rc_run r6
assert_exit_code "$RC_RC" "1" "R6: downgraded without evidence fails the receipt"

# R7: verified in gen 1, resolved by gen 2's resolution entry -> passes
E1=$(rc_gen r7 1 "$PHASE_BASE" "$GEN1_HEAD" "$DIFF1" "$FJ" '[ { "id": "fm", "disposition": "verified", "rationale": "ok" } ]' '[]' "$NEW_AT")
E2=$(rc_gen r7 2 "$GEN1_HEAD" "$GEN2_HEAD" "$DIFF2" '[]' '[]' '[ { "id": "fm", "rationale": "fixed in c4, re-checked" } ]' "$NEW_AT")
rc_write r7 "SHIP-AS-IS" '[]' "$E1, $E2"
git -C "$SCRATCH_REPO" reset -q --hard "$GEN2_HEAD"; rc_run r7
assert_exit_code "$RC_RC" "0" "R7: verified Major resolved by a later generation passes (output: $RC_OUT)"
