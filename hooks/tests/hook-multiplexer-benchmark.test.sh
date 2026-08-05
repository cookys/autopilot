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
node "$DRIVER" --base "$BASE_SHA" --candidate HEAD --fixtures "$FIXTURES" \
  --warmups 0 --repetitions 1 --report "$TEST_TMP/driver.json" \
  >"$TEST_TMP/driver.out" 2>&1
DRIVER_REAL_RC=$?
assert_eq "0" "$DRIVER_REAL_RC" "driver benchmarks resolved base and candidate trees"
assert_eq "$BASE_SHA" "$(jq -r '.base_sha' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver records the resolved D6 base SHA"
assert_neq "$BASE_SHA" "$(jq -r '.candidate_sha' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver records a distinct candidate SHA"
assert_eq "4" "$(jq '.results|length' "$TEST_TMP/driver.json" 2>/dev/null)" \
  "driver emits all four fixtures"
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

finalize_test
