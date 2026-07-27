#!/usr/bin/env bash
# Mission P1 pure reducer oracle. Intentionally RED until the P1 module exists.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const path = require('path');
const root = process.argv[2];
let evaluate;
try {
  ({ evaluateMissionReducerFixture: evaluate } = require(
    path.join(root, 'src', 'engine', 'mission-convergence'),
  ));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const cases = [
  ['legacy-config-off', { kind: 'config', section: null }, { mode: 'off' }],
  ['partial-config-rejected', { kind: 'config', section: { enforcement_mode: 'shadow' } }, { error: 'mission_config_invalid' }],
  ['identity-cannot-reset', { kind: 'identity_reset', consumed: 99, ceiling: 100 }, { remaining: 1 }],
  ['single-use-claim', { kind: 'double_claim' }, { second: 'grant_already_claimed' }],
  ['resume-reuses-claim', { kind: 'resume_claim' }, { reservations: 1, same_claim: true }],
  ['no-effect-release', { kind: 'no_effect_release', reserved: 10 }, { reserved_active: 0, durable_consumed: 0 }],
  ['terminal-reconcile-once', { kind: 'reconcile', reserved: 10, actual: 4 }, { consumed: 4, freed: 6, replay: 'idempotent' }],
  ['overspend-blocks', { kind: 'reconcile', reserved: 10, actual: 11 }, { state: 'BLOCKED', reason: 'accounting_breach', consumed: 11 }],
  ['agent-cannot-loosen', { kind: 'ceiling_adjust', authority: 'agent', old: 10, next: 11 }, { error: 'ceiling_loosen_unauthorized' }],
  ['stale-control-blocks', { kind: 'control', current_sequence: 7, effect_sequence: 6 }, { state: 'CLOSING', reason: 'control_sequence_stale' }],
  ['shadow-never-blocks-effect', { kind: 'shadow_would_block' }, { effect_allowed: true, would_block: true }],
  ['projection-roundtrip', { kind: 'projection_roundtrip' }, { state_hash_equal: true, raw_transcript_present: false }],
];

for (const [id, input, expected] of cases) {
  const actual = evaluate ? evaluate(input) : { error: 'mission_reducer_absent' };
  const pass = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${id}\t${pass ? 'PASS' : 'FAIL'}\t${JSON.stringify(expected)}\t${JSON.stringify(actual)}`);
}
NODE
)"
EXIT=$?
assert_exit_code "$EXIT" "0" "P1 fixture runner executes"

for id in \
  legacy-config-off partial-config-rejected identity-cannot-reset single-use-claim \
  resume-reuses-claim no-effect-release terminal-reconcile-once overspend-blocks \
  agent-cannot-loosen stale-control-blocks shadow-never-blocks-effect projection-roundtrip
do
  assert_contains "$OUT" "$id	PASS	" "RED: $id"
done

finalize_test
