#!/usr/bin/env bash
# Deterministic D6 benchmark/validator regression: Git-bound base/candidate,
# payload identity, and ratio gates.
. "$(dirname "$0")/lib.sh"

DRIVER="$REPO_ROOT/scripts/benchmark-hook-multiplexer.js"
VALIDATOR="$REPO_ROOT/scripts/validate-hook-multiplexer-benchmark.js"
FIXTURES="$REPO_ROOT/hooks/tests/fixtures/hook-multiplexer-benchmark.json"
BASE_SHA="f6805529bdca4cca76f334d8c82c8f2bf141aaf8"
CANDIDATE_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"

set +e
node "$DRIVER" --base deadbeef --candidate HEAD --fixtures "$FIXTURES" \
  --warmups 0 --repetitions 1 --report "$TEST_TMP/dead.json" \
  >"$TEST_TMP/dead.out" 2>&1
DRIVER_DEAD_RC=$?
set +e
assert_neq "0" "$DRIVER_DEAD_RC" "driver rejects an unresolved base ref"
assert_contains "$(cat "$TEST_TMP/dead.out")" "base ref does not resolve" \
  "driver names the unresolved base ref"
assert_file_absent "$TEST_TMP/dead.json" "unresolved refs do not write evidence"

node "$DRIVER" --base HEAD --candidate HEAD --fixtures "$FIXTURES" \
  --warmups 0 --repetitions 1 --report "$TEST_TMP/same.json" \
  >"$TEST_TMP/same.out" 2>&1
DRIVER_SAME_RC=$?
assert_neq "0" "$DRIVER_SAME_RC" "driver rejects identical base/candidate refs"
assert_contains "$(cat "$TEST_TMP/same.out")" "distinct commits" \
  "driver names the same-SHA boundary"

# A low-cost real run proves the driver uses detached base/candidate trees and
# records process-count and payload identity for every fixture.
AUTOPILOT_HOOK_BRANCH_PROTECTION=1 AUTOPILOT_HOOK_CONTEXT_BUDGET=1 \
AUTOPILOT_HOOK_ACCUMULATOR=1 \
node "$DRIVER" --base "$BASE_SHA" --candidate HEAD --fixtures "$FIXTURES" \
  --warmups 0 --repetitions 2 --report "$TEST_TMP/driver.json" \
  >"$TEST_TMP/driver.out" 2>&1
DRIVER_REAL_RC=$?
assert_eq "0" "$DRIVER_REAL_RC" "driver benchmarks resolved base and candidate trees"
assert_eq "$BASE_SHA" "$(jq -r '.base_sha' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver records the resolved D6 base SHA"
assert_neq "$BASE_SHA" "$(jq -r '.candidate_sha' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver records a distinct candidate SHA"
assert_eq "4" "$(jq '.results|length' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver emits all four fixtures"
assert_eq "alternating-paired" "$(jq -r '.results[0].sampling.strategy' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver records paired alternating sampling"
assert_eq "[\"baseline\",\"candidate\"]" \
  "$(jq -c '.results[0].sampling.repetitions[0]' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "first pair runs baseline then candidate"
assert_eq "[\"candidate\",\"baseline\"]" \
  "$(jq -c '.results[0].sampling.repetitions[1]' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "second pair runs candidate then baseline"
assert_eq "0" "$(jq -r '.results[0].candidate.observed_child_count' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "hostile inherited opt-ins cannot enable a disabled cold fixture"
assert_eq "0" "$(jq -r '.results[2].candidate.observed_child_count' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "hostile inherited opt-ins cannot enable a disabled heavy fixture"
assert_neq "0" "$(jq -r '.results[0].baseline.processes_started' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "baseline runs registered opt-in commands"
assert_eq "1" "$(jq -r '.results[0].candidate.processes_started' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "candidate runs one multiplexer registration"

# Build a deterministic valid schema fixture for validator controls.
node - "$TEST_TMP/valid.json" "$BASE_SHA" "$CANDIDATE_SHA" "$FIXTURES" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const [target, baseSha, candidateSha, fixturePath] = process.argv.slice(2);
const fixturesText = fs.readFileSync(fixturePath, 'utf8');
const fixtures = JSON.parse(fixturesText);
const rows = fixtures.fixtures.map((fixture) => {
  const baselineMs = fixture.mode === 'cold' ? 100 : 200;
  const candidateMs = fixture.enabled ? baselineMs : baselineMs / 2;
  const summary = (ms, processes) => ({
    samples: 50,
    median_ms: ms,
    p95_ms: ms,
    mad_ms: 1,
    mad_median_ratio: 0.01,
    observed_child_count: fixture.expected_child_count,
    expected_child_count: fixture.expected_child_count,
    payload_sha256: fixture.payload_sha256,
    processes_started: processes,
    process_count_consistent: true,
    nonzero_statuses: 0,
  });
  return {
    id: fixture.id,
    event: fixture.event,
    mode: fixture.mode,
    enabled: fixture.enabled === true,
    expected_child_count: fixture.expected_child_count,
    baseline: summary(baselineMs, fixture.enabled ? 2 : 2),
    candidate: summary(candidateMs, 1),
    sampling: {
      strategy: 'alternating-paired',
      warmups: Array.from({ length: 10 }, (_, i) => (
        i % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
      )),
      repetitions: Array.from({ length: 50 }, (_, i) => (
        i % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline']
      )),
    },
    ratios: { median: candidateMs / baselineMs, p95: candidateMs / baselineMs },
  };
});
fs.writeFileSync(target, `${JSON.stringify({
  schema_version: 1,
  runtime: process.version,
  base_ref: baseSha,
  candidate_ref: candidateSha,
  base_sha: baseSha,
  candidate_sha: candidateSha,
  fixtures_path: 'hooks/tests/fixtures/hook-multiplexer-benchmark.json',
  fixtures_sha256: crypto.createHash('sha256').update(fixturesText).digest('hex'),
  warmups: 10,
  repetitions: 50,
  results: rows,
  generated_at: new Date().toISOString(),
}, null, 2)}\n`);
NODE

VALID_OUT="$(node "$VALIDATOR" "$TEST_TMP/valid.json" 2>&1)"
VALID_RC=$?
assert_eq "0" "$VALID_RC" "validator accepts a Git-bound report within thresholds"
assert_contains "$VALID_OUT" "validate-hook-multiplexer-benchmark: ok" \
  "validator emits the successful verdict"

node - "$TEST_TMP/valid.json" <<'NODE'
const fs = require('fs');
const [target] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.base_ref = report.candidate_ref;
report.base_sha = report.candidate_sha;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
SAME_OUT="$(node "$VALIDATOR" "$TEST_TMP/valid.json" 2>&1)"
SAME_RC=$?
assert_neq "0" "$SAME_RC" "validator rejects a same-SHA evidence report"
assert_contains "$SAME_OUT" "must be distinct" "validator names same-SHA evidence"

# Restore valid evidence, then violate the disabled ratio gate.
node - "$TEST_TMP/valid.json" "$BASE_SHA" "$CANDIDATE_SHA" <<'NODE'
const fs = require('fs');
const [target, baseSha, candidateSha] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.base_ref = baseSha;
report.base_sha = baseSha;
report.candidate_ref = candidateSha;
report.candidate_sha = candidateSha;
report.results[0].candidate.median_ms = 200;
report.results[0].candidate.p95_ms = 200;
report.results[0].ratios.median = 2;
report.results[0].ratios.p95 = 2;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
RATIO_OUT="$(node "$VALIDATOR" "$TEST_TMP/valid.json" 2>&1)"
RATIO_RC=$?
assert_neq "0" "$RATIO_RC" "validator rejects a disabled-handler ratio above 75%"
assert_contains "$RATIO_OUT" "exceeds 0.75" "validator names the disabled ratio threshold"

# Restore the ratio fixture and violate the exact 10% MAD/median requirement.
node - "$TEST_TMP/valid.json" "$BASE_SHA" "$CANDIDATE_SHA" <<'NODE'
const fs = require('fs');
const [target, baseSha, candidateSha] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.base_ref = baseSha;
report.base_sha = baseSha;
report.candidate_ref = candidateSha;
report.candidate_sha = candidateSha;
const cold = report.results[0];
cold.candidate.median_ms = 50;
cold.candidate.p95_ms = 50;
cold.ratios.median = 0.5;
cold.ratios.p95 = 0.5;
report.results[1].baseline.mad_median_ratio = 0.11;
report.results[1].candidate.mad_median_ratio = 0.11;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
MAD_OUT="$(node "$VALIDATOR" "$TEST_TMP/valid.json" 2>&1)"
MAD_RC=$?
assert_neq "0" "$MAD_RC" "validator rejects MAD/median above the exact 10% limit"
assert_contains "$MAD_OUT" "exceeds 0.1" "validator names the exact MAD threshold"

node - "$TEST_TMP/valid.json" <<'NODE'
const fs = require('fs');
const [target] = process.argv.slice(2);
const report = JSON.parse(fs.readFileSync(target, 'utf8'));
report.results[0].candidate.observed_child_count = 99;
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`);
NODE
set +e
COUNT_OUT="$(node "$VALIDATOR" "$TEST_TMP/valid.json" 2>&1)"
COUNT_RC=$?
assert_neq "0" "$COUNT_RC" "validator rejects a fabricated observed child count"
assert_contains "$COUNT_OUT" "observed child count" "validator names the observed-count mismatch"

finalize_test
