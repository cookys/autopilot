#!/usr/bin/env bash
# Focused fixtures for the review-path remediation delta and its non-authoritative
# named-finding checker. These tests intentionally run the helper from outside the
# repository so --repo remains an explicit containment boundary.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/diff-since-last-round.sh"
GIT="git -c user.email=review-path@test -c user.name=review-path -c init.defaultBranch=main -c commit.gpgsign=false"
REPO="$TEST_TMP/repo"
mkdir -p "$REPO/src"
$GIT init "$REPO" >/dev/null 2>&1
printf '%s\n' 'export const value = 1;' > "$REPO/src/value.js"
$GIT -C "$REPO" add src/value.js >/dev/null 2>&1
$GIT -C "$REPO" commit -m base >/dev/null 2>&1
BASE="$($GIT -C "$REPO" rev-parse HEAD)"
printf '%s\n' 'export const value = 2;' > "$REPO/src/value.js"
$GIT -C "$REPO" add src/value.js >/dev/null 2>&1
$GIT -C "$REPO" commit -m candidate >/dev/null 2>&1
HEAD="$($GIT -C "$REPO" rev-parse HEAD)"

FINDINGS="$TEST_TMP/findings.json"
printf '%s\n' '[{"finding_id":"F1","claim":"src/value.js:1 changed value is wrong","severity":"🟠","source":"panel review"}]' > "$FINDINGS"
DELTA="$TEST_TMP/delta.json"
OUT="$(cd /tmp && "$SCRIPT" remediation --previous "$BASE" --current "$HEAD" \
  --findings-file "$FINDINGS" --repo "$REPO" --out "$DELTA" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "bound remediation delta exits 0"
assert_file_exists "$DELTA" "bound remediation delta is written"
assert_contains "$OUT" '"status": "ready"' "bound remediation delta is ready"
assert_contains "$(cat "$DELTA")" '"authority": "non_authoritative"' "delta has no authority"
assert_contains "$(cat "$DELTA")" '"prior_findings_included": false' "delta excludes prior findings"
assert_contains "$(cat "$DELTA")" '"binding": "bound"' "delta binds the changed path"

RESULT="$TEST_TMP/result.json"
node - "$DELTA" "$RESULT" <<'NODE'
const fs = require('fs');
const [deltaPath, resultPath] = process.argv.slice(2);
const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
fs.writeFileSync(resultPath, JSON.stringify({
  schema_version: 1,
  artifact_type: 'review_remediation_result',
  authority: 'non_authoritative',
  whole_candidate_pass: false,
  gate_clear: false,
  previous_commit: delta.previous_commit,
  current_commit: delta.current_commit,
  delta_digest: delta.delta_digest,
  finding_contract_digest: delta.finding_contract_digest,
  findings: [{ finding_id: 'F1', status: 'resolved', evidence: 'assertion now covers the changed value' }],
}, null, 2));
NODE
CHECK="$TEST_TMP/check.json"
OUT="$(cd /tmp && "$SCRIPT" check-remediation --delta-file "$DELTA" --result-file "$RESULT" \
  --repo "$REPO" --out "$CHECK" 2>&1)"; EXIT=$?
assert_eq "0" "$EXIT" "resolved remediation check exits 0"
assert_file_exists "$CHECK" "remediation check receipt is written"
assert_contains "$OUT" '"artifact_type": "review_remediation_check"' "check emits a check artifact"
assert_contains "$OUT" '"status": "resolved"' "check preserves named finding status"
assert_contains "$OUT" '"gate_clear": false' "check cannot clear the review gate"

BAD_RESULT="$TEST_TMP/bad-result.json"
node - "$DELTA" "$BAD_RESULT" <<'NODE'
const fs = require('fs');
const [deltaPath, resultPath] = process.argv.slice(2);
const delta = JSON.parse(fs.readFileSync(deltaPath, 'utf8'));
fs.writeFileSync(resultPath, JSON.stringify({
  schema_version: 1,
  artifact_type: 'review_remediation_result',
  authority: 'non_authoritative',
  whole_candidate_pass: false,
  gate_clear: false,
  previous_commit: delta.previous_commit,
  current_commit: delta.current_commit,
  delta_digest: delta.delta_digest,
  finding_contract_digest: delta.finding_contract_digest,
  findings: [{ finding_id: 'F1', status: 'resolved', evidence: 'SHIP-AS-IS' }],
}, null, 2));
NODE
"$SCRIPT" check-remediation --delta-file "$DELTA" --result-file "$BAD_RESULT" --repo "$REPO" >/dev/null 2>&1
assert_eq "$?" "1" "whole-candidate authority vocabulary is rejected"

UNBOUND="$TEST_TMP/unbound.json"
printf '%s\n' '[{"finding_id":"F2","claim":"missing.js:1 issue","severity":"Major","source":"panel"}]' > "$UNBOUND"
UNBOUND_DELTA="$TEST_TMP/unbound-delta.json"
"$SCRIPT" remediation --previous "$BASE" --current "$HEAD" --findings-file "$UNBOUND" \
  --repo "$REPO" --out "$UNBOUND_DELTA" >/dev/null 2>&1
assert_eq "$?" "1" "unbound finding falls back to full review"
"$SCRIPT" check-remediation --delta-file "$UNBOUND_DELTA" --result-file "$RESULT" \
  --repo "$REPO" >/dev/null 2>&1
assert_eq "$?" "1" "needs_full_review delta cannot be accepted by checker"

"$SCRIPT" remediation --previous "$HEAD" --current "$BASE" --findings-file "$FINDINGS" --repo "$REPO" >/dev/null 2>&1
assert_eq "$?" "1" "reversed ancestry fails closed"

OUT="$(node - "$REPO_ROOT" "$REPO" "$BASE" "$HEAD" <<'NODE'
const { _defaultRemediationChecker: defaultChecker, _runRemediationCheckerBoundary: check } = require(`${process.argv[2]}/src/engine/autopilot-engine`);
const finding = { finding_id: 'F1', claim: 'src/value.js:1 changed value is wrong', severity: '🟠', source: 'panel review' };
for (const currentFindings of [[{ ...finding, finding_id: 'F2' }], [{ ...finding, claim: 'reused id, different contract' }]]) { let calls = 0; const result = check((input) => { calls += 1; return defaultChecker(input); }, { repo: process.argv[3], previousCommit: process.argv[4], currentCommit: process.argv[5], previousFindings: [finding], currentFindings }); console.log(`${result.status}:${calls}`); }
NODE
)"
assert_eq "$OUT" $'needs_full_review:0\nneeds_full_review:0' "current finding identity mismatch falls back before invoking checker extension"

OUT="$(node - "$REPO_ROOT" "$REPO" "$BASE" "$HEAD" <<'NODE'
const fs = require('fs');
const { _runRemediationCheckerBoundary: check } = require(`${process.argv[2]}/src/engine/autopilot-engine`);
const finding = { finding_id: 'F1', claim: 'src/value.js:1 changed value is wrong', severity: '🟠', source: 'panel review' };
let observed; let artifactsExcludeCurrent = false;
const result = check((input) => { observed = input; const artifacts = fs.readFileSync(input.deltaFile, 'utf8') + fs.readFileSync(input.findingContractsFile, 'utf8'); artifactsExcludeCurrent = !artifacts.includes('current_finding_contract') && !artifacts.includes('"current"'); return {}; }, { repo: process.argv[3], previousCommit: process.argv[4], currentCommit: process.argv[5], previousFindings: [finding], currentFindings: [finding] });
console.log(Boolean(observed && observed.cwd && observed.deltaFile && observed.findingContractsFile && observed.resultFile && !observed.repo && !observed.previousFindings && !observed.currentFindings));
console.log(artifactsExcludeCurrent);
console.log(result.status);
NODE
)"
assert_eq "$OUT" $'true\ntrue\nneeds_full_review' "checker receives only prior contracts/safe delta and malformed output is validated fail-closed"

finalize_test
