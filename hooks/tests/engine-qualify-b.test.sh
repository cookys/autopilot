#!/usr/bin/env bash
# Stage-1 reviewer qualifier tests, shard b (sections 6-8, 10-13).
. "$(dirname "$0")/lib.sh"
SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"
. "$(dirname "$0")/lib/engine-qualify-setup.sh"

# 6) The harness does not leak expected-outcome labels to the panel.
LABEL_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$LABEL_CHEAT_PANEL" 2>&1)"
LABEL_RC=$?
assert_exit_code "$LABEL_RC" "1" "fixture label-dependent panel cannot qualify"
assert_not_contains "$LABEL_OUT" '"evaluation_passed":true' "blind qualification exposes no outcome label"

# 7) Critical false-pass -> qualified false, emits failed row with --emit-row
FAIL_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$ALL_PASS_PANEL" --emit-row 2>&1)"
FAIL_RC=$?
assert_exit_code "$FAIL_RC" "1" "all-true panel-cmd exits 1 (qualification failed)"
assert_contains "$FAIL_OUT" '"status":"failed"' "emit-row status failed on false positive critical"
assert_not_contains "$FAIL_OUT" '"false_pass_critical":0' "critical false-pass present"

# 7b) A dead transport aborts with NO verdict — it is not the panel's answer.
# Regression for 2026-09-21: runPanelCase used to substitute {verdict:'fail',
# findings:[]} when the transport died, which scores every clean case as a false
# positive against a zero-tolerance bar — a host-side outage recorded as a specific
# accusation against the engine. Sibling of the brain-seat bug fixed in v2.36.82.
DEAD_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "/panel/node /panel/does-not-exist.js" --emit-row 2>&1)"
DEAD_RC=$?
assert_exit_code "$DEAD_RC" "1" "a dead panel-cmd exits 1"
assert_contains "$DEAD_OUT" '"outcome":"transport_fail"' \
  "a dead transport is reported as transport_fail, not as a graded verdict"
assert_contains "$DEAD_OUT" '"cases_attempted":1' \
  "the trial stops at the FIRST dead case instead of driving the whole corpus"
assert_contains "$DEAD_OUT" 'administration aborted, no verdict recorded' \
  "the abort reason states that no verdict was recorded"
assert_not_contains "$DEAD_OUT" '"clean_false_positives"' \
  "a dead transport is never reported as a clean false positive"
assert_not_contains "$DEAD_OUT" '"status":"failed"' \
  "transport_fail emits no failed row for the seat"

# 8) Fixed-order or cross-case-state guessing cannot pass.
SENS_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PARTIAL_PASS_PANEL" 2>&1)"
SENS_RC=$?
assert_exit_code "$SENS_RC" "1" "fixed-order panel-cmd exits 1"
assert_contains "$SENS_OUT" '"evaluation_passed":false' "shuffling rejects order-based answer guessing"

# 10) --emit-row emits engine-scorecard row accepted by record
# ENGINE_SCORECARD_DIR must point at test tmp: without it, record appends the
# fixture row to the operator's real ~/.autopilot/engine-scorecard store
# (2026-08-17: 289 leaked eng-review rows poisoned every roster query).
ROW_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" --emit-row)"
RECORD_RC=0
ROW_OUT_FILE="$(mktemp "$TEST_TMP/engine-qualify-row.out.XXXXXX")"
ROW_ERR_FILE="$(mktemp "$TEST_TMP/engine-qualify-row.err.XXXXXX")"
printf '%s\n' "$ROW_OUT" | ENGINE_SCORECARD_DIR="$TEST_TMP/engine-scorecard" \
  node "$REPO_ROOT/scripts/engine-scorecard.js" record >"$ROW_OUT_FILE" 2>"$ROW_ERR_FILE" || RECORD_RC=$?
assert_exit_code "$RECORD_RC" "0" "emit-row output is accepted by engine-scorecard record"
assert_file_exists "$TEST_TMP/engine-scorecard/scorecard.jsonl" \
  "recorded row landed in the isolated test store"
assert_contains "$ROW_OUT" '"source":"unknown"' "emit-row row uses cost.source=unknown"
assert_contains "$ROW_OUT" '"status":"qualified"' "emit-row on pass uses qualified status"
assert_contains "$ROW_OUT" '"repeated_trials":2' "emit-row records the repeated-trial floor"
assert_contains "$ROW_OUT" '"mutation_validation"' "emit-row binds the mutation control"

# 11) Only the exact live in-process run object can mint a session authority closure.
SESSION_OUT="$(node - "$REPO_ROOT" "$PANEL" "$TEST_TMP/session-capability" <<'NODE'
'use strict';
const path = require('path');
const [root, panel, store] = process.argv.slice(2);
const {
  createSessionRoleCapabilityVerifier,
  runQualification,
} = require(path.join(root, 'scripts', 'engine-qualify.js'));
const digest = (char) => char.repeat(64);
const options = {
  trials: 2,
  expiresDays: 30,
  store,
  emitRow: false,
  taskClasses: ['code_review'],
  domains: ['repository'],
  languages: ['en'],
  tools: ['diff_read'],
  engine: 'eng-review',
  model: 'eng-review-exact',
  modelVersion: '2026-07-26',
  runner: 'cc-shim',
  runnerVersion: '1.0.0',
  family: 'openai',
  harnessVersion: 'reviewer-harness-v2',
  effort: 'high',
  promptConfigHash: digest('a'),
  semanticFingerprint: digest('b'),
  containmentFingerprint: digest('c'),
  panelCmd: '/panel/node /panel/reviewer.js honest',
  panelReadOnlyBinds: [
    `${panel}=/panel/reviewer.js`,
    `${process.execPath}=/panel/node`,
  ],
  panelEnvironment: [],
};
const run = runQualification(options);
const request = {
  run_id: 'run-1',
  policy_hash: digest('d'),
  task_authority_id: digest('e'),
  dispatch_id: 'dispatch-1',
  role: 'reviewer',
  capability_scope: run.evidence.scope,
  risk: 'low',
  evaluation_time: '2026-07-26T00:00:00.000Z',
};
const verifier = createSessionRoleCapabilityVerifier(run, request);
const response = verifier(request);
let serializedRejected = false;
try {
  createSessionRoleCapabilityVerifier(JSON.parse(JSON.stringify(run)), request);
} catch {
  serializedRejected = true;
}
let changedRequestRejected = false;
try {
  verifier({ ...request, dispatch_id: 'dispatch-2' });
} catch {
  changedRequestRejected = true;
}
const degraded = runQualification({
  ...options,
  panelCmd: '/panel/node /panel/reviewer.js all-pass',
});
let supersededVerifierRejected = false;
try {
  verifier(request);
} catch {
  supersededVerifierRejected = true;
}
let supersededRunRejected = false;
try {
  createSessionRoleCapabilityVerifier(run, request);
} catch {
  supersededRunRejected = true;
}
process.stdout.write(JSON.stringify({
  state: response.capability_state,
  authority: response.evidence_store_anchor.authority_kind,
  nonce_bound: /^[a-f0-9]{64}$/.test(response.evidence_store_anchor.run_nonce_hash),
  serialized_rejected: serializedRejected,
  changed_request_rejected: changedRequestRejected,
  degraded_state: degraded.evidence.state,
  superseded_verifier_rejected: supersededVerifierRejected,
  superseded_run_rejected: supersededRunRejected,
}));
NODE
)"
SESSION_RC=$?
assert_exit_code "$SESSION_RC" "0" "live in-process qualifier creates a verifier"
assert_contains "$SESSION_OUT" '"state":"qualified"' \
  "session verifier returns the host-observed qualified state"
assert_contains "$SESSION_OUT" '"authority":"session_local"' \
  "session verifier declares the non-persistent authority kind"
assert_contains "$SESSION_OUT" '"nonce_bound":true' \
  "session verifier binds a host-generated run nonce"
assert_contains "$SESSION_OUT" '"serialized_rejected":true' \
  "serialized telemetry cannot reconstruct the verifier capability"
assert_contains "$SESSION_OUT" '"changed_request_rejected":true' \
  "session verifier cannot be reused for another Kernel query"
assert_contains "$SESSION_OUT" '"degraded_state":"degraded"' \
  "later exact-scope regression records degraded evidence"
assert_contains "$SESSION_OUT" '"superseded_verifier_rejected":true' \
  "later exact-scope regression revokes an already-created verifier"
assert_contains "$SESSION_OUT" '"superseded_run_rejected":true' \
  "superseded qualification cannot mint another verifier"

# 12) Pinned assets, fresh seeds, and missing sandbox fail closed before panel execution.
PIN_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const {
  verifyPinnedEvaluationAssets,
  verifySandboxRuntime,
} = require(path.join(root, 'scripts', 'engine-qualify.js'));
const { generateReviewerEvaluation } = require(
  path.join(root, 'evals', 'reviewer-eval-generator.js'),
);
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const first = generateReviewerEvaluation('a'.repeat(64));
const second = generateReviewerEvaluation('b'.repeat(64));
const firstCases = [...first.knownBad, ...first.clean, first.mutation];
const secondCases = [...second.knownBad, ...second.clean, second.mutation];
const freshArtifacts = firstCases.every((entry, index) => (
  hashValue(entry.diff) !== hashValue(secondCases[index].diff)
));
const labelsHidden = firstCases.every((entry) => (
  !/(?:known[_-]?bad|(?:^|[^A-Za-z])clean(?:[^A-Za-z]|$))/iu.test(entry.diff)
));
const locationVectorChanged = firstCases.some((entry, index) => (
  entry.changedLine !== secondCases[index].changedLine
));
let generatorRejected = false;
try {
  verifyPinnedEvaluationAssets({ expectedGeneratorHash: '0'.repeat(64) });
} catch {
  generatorRejected = true;
}
let manifestRejected = false;
try {
  verifyPinnedEvaluationAssets({ expectedManifestHash: '0'.repeat(64) });
} catch {
  manifestRejected = true;
}
let oracleRejected = false;
try {
  verifyPinnedEvaluationAssets({ expectedArtifactOracleHash: '0'.repeat(64) });
} catch {
  oracleRejected = true;
}
let sandboxRejected = false;
try {
  verifySandboxRuntime(path.join(os.tmpdir(), 'missing-autopilot-bwrap'));
} catch {
  sandboxRejected = true;
}
const trusted = verifyPinnedEvaluationAssets();
const copiedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-eval-pin-'));
fs.cpSync(path.join(root, 'evals'), path.join(copiedRoot, 'evals'), { recursive: true });
const copiedGenerator = path.join(copiedRoot, 'evals', 'reviewer-eval-generator.js');
const copiedManifest = path.join(copiedRoot, 'evals', 'capability-evidence-corpus.json');
const copiedOptions = {
  root: copiedRoot,
  generatorPath: copiedGenerator,
  manifestPath: copiedManifest,
  expectedGeneratorHash: hash(path.join(root, 'evals', 'reviewer-eval-generator.js')),
  expectedManifestHash: trusted.corpus_manifest_hash,
  expectedArtifactOracleHash: trusted.artifact_oracle_hash,
};
function mutationRejected(file, mutate) {
  const original = fs.readFileSync(file);
  mutate(file);
  let rejected = false;
  try {
    verifyPinnedEvaluationAssets(copiedOptions);
  } catch {
    rejected = true;
  }
  fs.writeFileSync(file, original);
  return rejected;
}
const actualGeneratorMutationRejected = mutationRejected(
  copiedGenerator,
  (file) => fs.appendFileSync(file, '\n// changed\n'),
);
const actualManifestMutationRejected = mutationRejected(copiedManifest, (file) => {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  value.methodology_version = 'reviewer-known-bad-clean-mutated';
  fs.writeFileSync(file, JSON.stringify(value));
});
const manifest = JSON.parse(fs.readFileSync(copiedManifest, 'utf8'));
const actualBaseMutationRejected = mutationRejected(
  path.join(copiedRoot, manifest.known_bad[0].diff_path),
  (file) => fs.appendFileSync(file, '\n'),
);
const actualOracleMutationRejected = mutationRejected(
  path.join(copiedRoot, manifest.known_bad[0].oracle_path),
  (file) => fs.appendFileSync(file, '\n'),
);
fs.rmSync(copiedRoot, { recursive: true, force: true });
function hashValue(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
process.stdout.write(JSON.stringify({
  generator_rejected: generatorRejected,
  manifest_rejected: manifestRejected,
  oracle_rejected: oracleRejected,
  sandbox_rejected: sandboxRejected,
  actual_generator_mutation_rejected: actualGeneratorMutationRejected,
  actual_manifest_mutation_rejected: actualManifestMutationRejected,
  actual_base_mutation_rejected: actualBaseMutationRejected,
  actual_oracle_mutation_rejected: actualOracleMutationRejected,
  fresh_artifacts: freshArtifacts,
  outcome_labels_hidden: labelsHidden,
  location_vector_changed: locationVectorChanged,
  generator_hash_shape: /^[a-f0-9]{64}$/.test(
    hash(path.join(root, 'evals', 'reviewer-eval-generator.js')),
  ),
}));
NODE
)"
assert_contains "$PIN_OUT" '"generator_rejected":true' "generator pin mismatch fails closed"
assert_contains "$PIN_OUT" '"manifest_rejected":true' "manifest pin mismatch fails closed"
assert_contains "$PIN_OUT" '"oracle_rejected":true' "artifact oracle pin mismatch fails closed"
assert_contains "$PIN_OUT" '"sandbox_rejected":true' "missing bubblewrap fails closed"
assert_contains "$PIN_OUT" '"actual_generator_mutation_rejected":true' \
  "mutated generator bytes fail closed"
assert_contains "$PIN_OUT" '"actual_manifest_mutation_rejected":true' \
  "mutated manifest fails closed"
assert_contains "$PIN_OUT" '"actual_base_mutation_rejected":true' \
  "mutated base fixture fails closed"
assert_contains "$PIN_OUT" '"actual_oracle_mutation_rejected":true' \
  "mutated fixture oracle fails closed"
assert_contains "$PIN_OUT" '"fresh_artifacts":true' "fresh seeds change every artifact hash"
assert_contains "$PIN_OUT" '"outcome_labels_hidden":true' \
  "panel-visible generated diffs contain no known-bad or clean labels"
assert_contains "$PIN_OUT" '"location_vector_changed":true' \
  "fresh seeds change generated finding locations"
assert_contains "$PIN_OUT" '"generator_hash_shape":true' "generator bytes have a stable SHA-256 pin"

# 13) bad args exit 2
$SCRIPT "${QUALIFY_ARGS[@]}" 2>/dev/null
BAD_RC=$?
assert_exit_code "$BAD_RC" "2" "missing --panel-cmd is exit 2"

$SCRIPT unknown 2>/dev/null
BAD_SUBRC=$?
assert_exit_code "$BAD_SUBRC" "2" "unknown subcommand is exit 2"

$SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
  --corpus-manifest "$REPO_ROOT/evals/capability-evidence-corpus.json" 2>/dev/null
BAD_CORPUS_RC=$?
assert_exit_code "$BAD_CORPUS_RC" "2" "caller cannot replace the pinned qualification corpus"

$SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" \
  --panel-bind-ro "$REPO_ROOT/scripts/engine-qualify.js=/panel/repo-leak.js" 2>/dev/null
BAD_REPO_BIND_RC=$?
assert_exit_code "$BAD_REPO_BIND_RC" "2" "panel bind cannot expose a repository file"

$SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" --panel-env HOME 2>/dev/null
BAD_CONTROL_ENV_RC=$?
assert_exit_code "$BAD_CONTROL_ENV_RC" "2" "panel env cannot override sandbox control variables"

finalize_test
