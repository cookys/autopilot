#!/usr/bin/env bash
# Mission P0 integration oracle. This test is intentionally RED until P1/P2
# provide the pure reducer and the ICC binding selected by the enforcement probe.
. "$(dirname "$0")/lib.sh"

FIXTURES="$REPO_ROOT/hooks/tests/fixtures/mission-convergence-incidents.json"
assert_file_exists "$FIXTURES" "Mission incident fixture corpus exists"

OUT="$(node - "$REPO_ROOT" "$FIXTURES" <<'NODE'
'use strict';
const fs = require('fs');
const path = require('path');

const [root, fixturePath] = process.argv.slice(2);
const corpus = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const frozen = {
  'successor-model-branch-reset': ['BLOCKED', 'resource_ceiling:tool_calls'],
  'direct-no-agent-stagnation': ['BLOCKED', 'stagnation'],
  'ignored-user-finish': ['CLOSING', 'control_sequence_stale'],
  'provider-maintenance-leakage': ['ACTIVE', 'PRESPEND_REJECTED/provider_readiness'],
  'closure-ratio': ['CLOSING', 'resource_ratio:tool_calls'],
  'invalid-review-authority': ['ACTIVE', 'review_authority_invalid'],
  'identity-preserves-remaining': ['ACTIVE', null],
  'real-progress-resets-stagnation': ['ACTIVE', null],
  'current-control-sequence': ['CLOSING', 'finish_requested'],
  'known-axis-below-ratio': ['ACTIVE', null],
};
let evaluate = null;
try {
  ({ evaluateMissionIntegrationFixture: evaluate } = require(
    path.join(root, 'src', 'engine', 'mission-convergence'),
  ));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function same(left, right) {
  return JSON.stringify(stable(left)) === JSON.stringify(stable(right));
}

for (const fixture of [...corpus.fixtures, ...corpus.healthy_controls]) {
  const ceiling = frozen[fixture.id];
  if (!ceiling
      || fixture.expected.state !== ceiling[0]
      || (fixture.expected.reason || null) !== ceiling[1]) {
    console.log(`${fixture.id}\tINVALID_FIXTURE\t${JSON.stringify(ceiling)}\t${JSON.stringify(fixture.expected)}`);
    continue;
  }
  const actual = evaluate
    ? evaluate(fixture)
    : {
        state: 'UNSUPERVISED',
        reason: 'mission_convergence_unavailable',
        effect_count: null,
      };
  console.log([
    fixture.id,
    same(actual, fixture.expected) ? 'PASS' : 'FAIL',
    JSON.stringify(fixture.expected),
    JSON.stringify(actual),
  ].join('\t'));
}
NODE
)"
EXIT=$?

assert_exit_code "$EXIT" "0" "Mission fixture runner itself executes"
for fixture in \
  successor-model-branch-reset \
  direct-no-agent-stagnation \
  ignored-user-finish \
  provider-maintenance-leakage \
  closure-ratio \
  invalid-review-authority
do
  assert_contains "$OUT" "$fixture	FAIL	" \
    "RED: $fixture exposes a Mission-level behavior gap"
done

for control in \
  identity-preserves-remaining \
  real-progress-resets-stagnation \
  current-control-sequence \
  known-axis-below-ratio
do
  assert_contains "$OUT" "$control	FAIL	" \
    "RED: healthy control $control awaits the same Mission reducer"
done

assert_contains "$OUT" '"state":"UNSUPERVISED"' \
  "RED is current unsupervised behavior, not a fixture setup failure"
assert_not_contains "$OUT" "INVALID_FIXTURE" \
  "Incident reasons and terminal ceilings match the independent frozen oracle"

finalize_test
