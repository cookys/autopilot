#!/usr/bin/env bash
# Stage-1 reviewer qualifier tests.
. "$(dirname "$0")/lib.sh"

SCRIPT="$REPO_ROOT/scripts/engine-qualify.sh"

# 1) --help exits 0
HELP_OUT="$($SCRIPT --help 2>&1)"
HELP_RC=$?
assert_exit_code "$HELP_RC" "0" "--help exits 0"
assert_contains "$HELP_OUT" "reviewer" "--help prints reviewer contract"

PANEL="$TEST_TMP/engine-qualify-panel.js"
cat >"$PANEL" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const mode = process.argv[2];
const diff = fs.readFileSync(0, 'utf8');
const hash = crypto.createHash('sha256').update(diff).digest('hex');
function normalizedArtifact(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.includes('marker_'))
    .join('\n')
    .replace(/src\/generated\/[^/]+\/[^.]+\.cjs/g, 'FILE')
    .replace(/[A-Za-z][A-Za-z0-9_]*_[a-f0-9]{10}/g, 'ID')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"STRING"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'STRING'")
    .replace(/`(?:[^`\\]|\\.)*`/g, '`TEMPLATE`')
    .replace(/[a-f0-9]{8,}/g, 'HEX')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ');
}
const known = new Map([
  ['f4ff05fcd7b5d6c270cecd9ec8bbeed06d0df5a49ee3d9ab078887d550233e16', 'critical'],
  ['2add8550bc2b415617117dd59e0cf3d093a5f3b759c777d27e95c013d37ce5fa', 'critical'],
  ['4a0c8c47813b11c964bf4a9a0833230ca9670977f66110ff5fa12868f3d98408', 'critical'],
  ['8b11657adfa0d1ffe9022e70332c2cb4c515fb9909c2b615d60af35faaf52374', 'critical'],
  ['ac8be1b3ab412db384b589a8888167ff5e411fea4731077667bc176fee7e57f1', 'major'],
  ['86349d08de4a4afb18f01bc9701da432fa88a79627bc1653faa9fc0f5b76013e', 'major'],
  ['80a502b52116d61760aef371ae708b253a5b953d158686f63eda6e08d6b05c87', 'critical'],
  ['83b22853dbb42d2fc5af0d3ccb58581f919cf702088bad3012e1e6398fc774c9', 'critical'],
  ['2054c71a381d3ec50089ad2e8e9dd5a4757634a9802139846d883663b985fe84', 'major'],
  ['0f3305f6f45c394ea3024f85b79ea2c0fc4799e7b7a521c62ac6a24959158d4f', 'critical'],
  ['8d9b612de52cca54a974182a9fb219dbe480757d4d7da335809f9867c61ba421', 'critical'],
  ['83e2e314456f7d8f990e22eb25e839475090dde9d49b4bc52920245a9e85dd91', 'critical'],
  ['36808ed0730667a25832a3229139920cb0a8faf32a0dcab8e7ce64d555d9073b', 'major'],
]);
function patchDetails() {
  let file = 'unknown';
  let oldLine = 1;
  let newLine = 1;
  const added = [];
  const removed = [];
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith('+++ ')) file = line.slice(4).split('\t')[0].replace(/^(a|b)\//, '');
    const hunk = line.match(/^@@ -([0-9]+)(?:,[0-9]+)? \+([0-9]+)(?:,[0-9]+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++')) {
      added.push({ text: line.slice(1), line: newLine });
      newLine += 1;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      removed.push({ text: line.slice(1), line: oldLine });
      oldLine += 1;
    } else if (!line.startsWith('\\') && !line.startsWith('diff ')
        && !line.startsWith('index ') && !line.startsWith('--- ')
        && !line.startsWith('+++ ')) {
      oldLine += 1;
      newLine += 1;
    }
  }
  return { file, added, removed, text: `${removed.map((x) => x.text).join('\n')}\n${added.map((x) => x.text).join('\n')}` };
}
function witness(args, expectation, exportPath = [], environment = {}) {
  return {
    protocol: 'behavioral-call-v1',
    export_path: exportPath,
    args,
    environment,
    expectation,
  };
}
function returns(args, value, exportPath = [], environment = {}) {
  return witness(args, { kind: 'returns', value }, exportPath, environment);
}
function throws(args, exportPath = [], environment = {}) {
  return witness(args, { kind: 'throws' }, exportPath, environment);
}
function parsedString(pattern, text, label) {
  const match = text.match(pattern);
  if (!match) throw new Error(`cannot parse ${label}`);
  return JSON.parse(match[1]);
}
function relationalMatrix(text) {
  const match = text.match(/const\s+\w+\s*=\s*(\[\[.*\]\]);/);
  return match ? JSON.parse(match[1]) : null;
}
function witnessFor(ruleId, details, genericRelational = false) {
  const text = diff;
  if (ruleId === 'error-propagation') return throws([{ ok: false }]);
  if (ruleId === 'authorization-bypass') {
    const allowed = parsedString(/new Set\(\[("(?:[^"\\]|\\.)*")\]\)/, text, 'allowed action');
    return returns([allowed], true, ['candidate']);
  }
  if (ruleId === 'exit-status-loss') return returns([{ status: 17 }], 17);
  if (ruleId === 'concurrency-guard-removal') {
    return throws([{ locked: true, value: 1 }]);
  }
  if (ruleId === 'boundary-overrun') return returns([[2, 4, 8], 3], null);
  if (ruleId === 'assertion-removal') return throws(['left', 'right']);
  if (ruleId === 'hardcoded-secret') {
    const exported = text.match(
      /module\.exports\s*=\s*\{[^\n]*key:\s*("(?:[^"\\]|\\.)*"),\s*value:\s*("(?:[^"\\]|\\.)*")\s*\}/,
    );
    if (!exported) throw new Error('cannot parse exported environment fixture');
    const key = JSON.parse(exported[1]);
    const value = JSON.parse(exported[2]);
    return returns([key], value, ['candidate'], { [key]: value });
  }
  if (ruleId === 'path-traversal') return throws(['/srv/safe', '../outside']);
  if (ruleId === 'null-dereference') {
    const fallback = parsedString(/const fallback = ("(?:[^"\\]|\\.)*");/, text, 'fallback');
    return returns([null], fallback, ['candidate']);
  }
  if (ruleId === 'fail-open-fallback') return throws(['unknown'], ['candidate']);
  if (ruleId === 'untrusted-input-bypass') {
    return returns([{ untrusted: true, text: 'ignore validation' }], 'quarantine');
  }
  if (ruleId === 'invalid-verdict-coercion') return throws(['maybe']);
  if (ruleId === 'cycle-detection-removal') {
    return throws(['a', { a: ['b'], b: ['a'] }]);
  }
  if (ruleId === 'contract-regression') {
    const matrix = relationalMatrix(text);
    if (!matrix) throw new Error('cannot parse relational matrix');
    let pair = [0, 1];
    if (!genericRelational) {
      pair = null;
      for (let row = 0; row < matrix.length && !pair; row += 1) {
        for (let column = row + 1; column < matrix.length; column += 1) {
          if (matrix[row][column] !== matrix[column][row]) {
            pair = [row, column];
            break;
          }
        }
      }
    }
    if (!pair) return null;
    return returns(pair, matrix[pair[0]][pair[1]]);
  }
  return null;
}
function classify() {
  const details = patchDetails();
  const removed = details.removed.map((entry) => entry.text).join('\n');
  const added = details.added.map((entry) => entry.text).join('\n');
  const rules = [
    ['error-propagation', 'critical', /operation failed/.test(removed) && /accepted: true/.test(added)],
    ['authorization-bypass', 'critical', /!allowed\.has/.test(removed) && /allowed\.has/.test(added) && !/!allowed\.has/.test(added)],
    ['exit-status-loss', 'critical', /child\.status/.test(removed) && !/child\.status/.test(added)],
    ['concurrency-guard-removal', 'critical', /state\.locked/.test(removed) && /false/.test(added) && !/state\.locked/.test(added)],
    ['boundary-overrun', 'major', /index < values\.length/.test(removed) && /index <= values\.length(?!\s*-\s*1)/.test(added)],
    ['assertion-removal', 'major', /assertion mismatch/.test(removed) && /\bvoid\b/.test(added)],
    ['hardcoded-secret', 'critical', /process\.env\[envName\]/.test(removed) && /"sk_[a-f0-9]+"/.test(added)],
    ['path-traversal', 'critical', /target\.startsWith/.test(removed) && /!target/.test(added) && !/target\.startsWith/.test(added)],
    ['null-dereference', 'major', /record == null/.test(removed) && /record\.name/.test(added) && !/record\s*={2,3}\s*(?:null|undefined)/.test(added)],
    ['fail-open-fallback', 'critical', /unsupported mode/.test(removed) && /defaultMode/.test(added)],
    ['untrusted-input-bypass', 'critical', /message\.untrusted/.test(removed) && /message\.text\.length/.test(added)],
    ['invalid-verdict-coercion', 'critical', /\.includes\(value\)/.test(removed) && /value == null/.test(added)],
    ['cycle-detection-removal', 'major', /cycle detected/.test(removed) && /visiting\.has\(node\)/.test(added) && /return true/.test(added)],
    ['contract-regression', 'major', /\[left\]\[right\]/.test(removed) && /\[right\]\[left\]/.test(added)],
  ];
  const match = rules.find((entry) => entry[2]);
  if (!match) return null;
  const behavioralWitness = witnessFor(match[0], details);
  if (!behavioralWitness) return null;
  return {
    rule_id: match[0],
    severity: match[1],
    file: details.file,
    line: details.added[0].line,
    witness: behavioralWitness,
  };
}
function sandboxProbe() {
  const forbidden = process.argv.slice(3);
  if (forbidden.some((entry) => fs.existsSync(entry))) return false;
  if (fs.existsSync('/tmp/reviewer-case-state')) return false;
  fs.writeFileSync('/tmp/reviewer-case-state', 'one case only');
  return true;
}
const semantic = classify();
let finding = semantic;
if (mode === 'public-hash') {
  const severity = known.get(hash);
  const details = patchDetails();
  finding = severity ? {
    rule_id: 'error-propagation',
    severity,
    file: details.file,
    line: details.added[0].line,
    witness: witnessFor('error-propagation', details),
  } : null;
}
if (mode === 'normalized-lookup') {
  const lookup = JSON.parse(fs.readFileSync('/panel/normalized-lookup.json', 'utf8'));
  const key = crypto.createHash('sha256').update(normalizedArtifact(diff)).digest('hex');
  const guessed = lookup[key];
  const details = patchDetails();
  finding = guessed ? {
    rule_id: guessed.rule_id,
    severity: guessed.severity,
    file: details.file,
    line: details.added[0].line,
    witness: witnessFor(guessed.rule_id, details, true),
  } : null;
}
if (mode === 'all-pass') finding = null;
if (mode === 'label') {
  const labeled = /\/known_bad_[0-9]+_file_/u.test(patchDetails().file);
  finding = labeled ? semantic : null;
}
if (mode === 'sequence') {
  const exists = fs.existsSync('/tmp/sequence-counter');
  fs.writeFileSync('/tmp/sequence-counter', exists ? '2' : '1');
  finding = exists ? null : {
    rule_id: 'error-propagation',
    severity: 'critical',
    file: patchDetails().file,
    line: patchDetails().added[0].line,
    witness: witnessFor('error-propagation', patchDetails()),
  };
}
if (mode === 'sandbox-probe' && !sandboxProbe()) {
  process.stdout.write('{"verdict":"pass","findings":[]}');
  process.exit(0);
}
if (mode === 'wrong-rule' && finding) finding.rule_id = 'boundary-overrun';
if (mode === 'wrong-file' && finding) finding.file = 'src/generated/wrong/file.cjs';
if (mode === 'wrong-line' && finding) finding.line += 1000;
if (mode === 'low-severity' && finding) finding.severity = 'suggestion';
if (mode === 'missing-witness' && finding) delete finding.witness;
if (mode === 'malformed-witness' && finding) finding.witness.extra = true;
if (mode === 'nonconsequential-witness' && finding) {
  finding.witness = throws([], ['missing']);
}
if (mode === 'invalid-domain-witness'
    && finding && finding.rule_id === 'contract-regression') {
  finding.witness = throws([null, 0]);
}
if (mode === 'summary-only' && finding) {
  delete finding.witness;
  finding.summary = 'there is a generic problem here';
}
function emit(result) {
  process.stdout.write(JSON.stringify(result
    ? { verdict: 'fail', findings: [result] }
    : { verdict: 'pass', findings: [] }));
}
if (mode === 'network-probe') {
  const net = require('net');
  const socket = net.createConnection({
    host: '127.0.0.1',
    port: Number(process.argv[3]),
  });
  let settled = false;
  const finish = (result) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    emit(result);
  };
  socket.once('connect', () => finish(null));
  socket.once('error', () => finish(finding));
  socket.setTimeout(750, () => finish(finding));
} else {
  emit(finding);
}
NODE
LOOKUP="$TEST_TMP/engine-qualify-normalized-lookup.json"
node - "$REPO_ROOT" "$LOOKUP" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const [root, output] = process.argv.slice(2);
const { generateReviewerEvaluation } = require(
  path.join(root, 'evals', 'reviewer-eval-generator.js'),
);
function normalizedArtifact(value) {
  return value
    .split(/\r?\n/)
    .filter((line) => !line.includes('marker_'))
    .join('\n')
    .replace(/src\/generated\/[^/]+\/[^.]+\.cjs/g, 'FILE')
    .replace(/[A-Za-z][A-Za-z0-9_]*_[a-f0-9]{10}/g, 'ID')
    .replace(/"(?:[^"\\]|\\.)*"/g, '"STRING"')
    .replace(/'(?:[^'\\]|\\.)*'/g, "'STRING'")
    .replace(/`(?:[^`\\]|\\.)*`/g, '`TEMPLATE`')
    .replace(/[a-f0-9]{8,}/g, 'HEX')
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ');
}
const lookup = {};
for (let sample = 0; sample < 256; sample += 1) {
  const seed = crypto.createHash('sha256').update(`public-training-${sample}`).digest('hex');
  const corpus = generateReviewerEvaluation(seed);
  for (const entry of corpus.knownBad) {
    const key = crypto.createHash('sha256').update(normalizedArtifact(entry.diff)).digest('hex');
    lookup[key] = {
      rule_id: entry.ruleId,
      severity: entry.severity,
    };
  }
}
fs.writeFileSync(output, JSON.stringify(lookup));
NODE
NODE_BIN="$(readlink -f "$(command -v node)")"
PANEL_BINDS=(
  --panel-bind-ro "$PANEL=/panel/reviewer.js"
  --panel-bind-ro "$LOOKUP=/panel/normalized-lookup.json"
  --panel-bind-ro "$NODE_BIN=/panel/node"
)
PASS_PANEL="/panel/node /panel/reviewer.js honest"
PUBLIC_HASH_PANEL="/panel/node /panel/reviewer.js public-hash"
NORMALIZED_LOOKUP_PANEL="/panel/node /panel/reviewer.js normalized-lookup"
PARTIAL_PASS_PANEL="/panel/node /panel/reviewer.js sequence"
ALL_PASS_PANEL="/panel/node /panel/reviewer.js all-pass"
LABEL_CHEAT_PANEL="/panel/node /panel/reviewer.js label"
SANDBOX_PANEL="/panel/node /panel/reviewer.js sandbox-probe '$REPO_ROOT' '$REPO_ROOT/evals/capability-evidence-corpus.json' '$PANEL' '$TEST_TMP/host-sidecar'"
HASH_A="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
HASH_B="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
HASH_C="cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
QUALIFY_ARGS=(
  reviewer
  --engine eng-review
  --model eng-review-exact
  --model-version 2026-07-26
  --runner cc-shim
  --runner-version 1.0.0
  --family openai
  --harness-version reviewer-harness-v2
  --effort high
  --prompt-config-hash "$HASH_A"
  --semantic-fingerprint "$HASH_B"
  --containment-fingerprint "$HASH_C"
  --task-class code_review
  --domain repository
  --language en
  --tool diff_read
)
QUALIFY_ARGS+=("${PANEL_BINDS[@]}")
export AUTOPILOT_QUALIFY_NOW="2026-07-26T00:00:00.000Z"
export AUTOPILOT_QUALIFY_SEED="engine-qualify-test-seed"
export ENGINE_CAPABILITY_DIR="$TEST_TMP/engine-capability"

# 2) Correct panel verdicts -> evaluation passes, but serialized output has no authority.
PASS_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" 2>&1)"
PASS_RC=$?
assert_exit_code "$PASS_RC" "0" "all-correct panel-cmd exits 0"
assert_contains "$PASS_OUT" '"evaluation_passed":true' "evaluation passes when panel catches all"
assert_contains "$PASS_OUT" '"evidence_state":"qualified"' "qualified verdict carries lifecycle state"
assert_contains "$PASS_OUT" '"admitted":false' "serialized qualifier result cannot admit a role"
assert_contains "$PASS_OUT" '"authority_status":"untrusted_telemetry"' \
  "serialized qualifier result declares its non-authoritative boundary"

# 3) The public fixture SHA lookup that previously false-greened cannot qualify.
PUBLIC_HASH_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PUBLIC_HASH_PANEL" 2>&1)"
PUBLIC_HASH_RC=$?
assert_exit_code "$PUBLIC_HASH_RC" "1" "public SHA lookup cannot qualify on fresh cases"
assert_contains "$PUBLIC_HASH_OUT" '"evaluation_passed":false' \
  "fresh metamorphic artifacts defeat the public fixture lookup"

NORMALIZED_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$NORMALIZED_LOOKUP_PANEL" 2>&1)"
NORMALIZED_RC=$?
assert_exit_code "$NORMALIZED_RC" "1" \
  "salt/path/context-normalized lookup cannot qualify across fresh nonces"
assert_contains "$NORMALIZED_OUT" '"evaluation_passed":false' \
  "metamorphic corpus rejects normalized benchmark lookup"

# 4) Every case gets a fresh sandbox with host paths, network, and prior scratch hidden.
SANDBOX_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$SANDBOX_PANEL" 2>&1)"
SANDBOX_RC=$?
assert_exit_code "$SANDBOX_RC" "0" \
  "sandbox hides repo, corpus, panel source, host sidecar, and prior case scratch"
assert_contains "$SANDBOX_OUT" '"evaluation_passed":true' \
  "sandboxed semantic reviewer still qualifies"

NETWORK_SERVER="$TEST_TMP/engine-qualify-network-server.js"
NETWORK_PORT_FILE="$TEST_TMP/engine-qualify-network-port"
cat >"$NETWORK_SERVER" <<'NODE'
'use strict';
const fs = require('fs');
const net = require('net');
const server = net.createServer((socket) => socket.end('host-only-evaluation-data'));
server.listen(0, '127.0.0.1', () => {
  fs.writeFileSync(process.argv[2], String(server.address().port));
});
setTimeout(() => server.close(), 120_000);
NODE
node "$NETWORK_SERVER" "$NETWORK_PORT_FILE" &
NETWORK_SERVER_PID=$!
for _ in $(seq 1 100); do
  [ -s "$NETWORK_PORT_FILE" ] && break
  sleep 0.02
done
NETWORK_PORT="$(cat "$NETWORK_PORT_FILE" 2>/dev/null || true)"
NETWORK_RC=0
"$SCRIPT" "${QUALIFY_ARGS[@]}" \
  --panel-cmd "/panel/node /panel/reviewer.js network-probe $NETWORK_PORT" \
  >/dev/null 2>&1 || NETWORK_RC=$?
kill "$NETWORK_SERVER_PID" 2>/dev/null || true
wait "$NETWORK_SERVER_PID" 2>/dev/null || true
assert_exit_code "$NETWORK_RC" "0" \
  "sandbox network namespace cannot reach a host-loopback evaluation side channel"

# 5) The harness does not leak expected-outcome labels to the panel.
LABEL_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$LABEL_CHEAT_PANEL" 2>&1)"
LABEL_RC=$?
assert_exit_code "$LABEL_RC" "1" "fixture label-dependent panel cannot qualify"
assert_not_contains "$LABEL_OUT" '"evaluation_passed":true' "blind qualification exposes no outcome label"

# 6) Critical false-pass -> qualified false, emits failed row with --emit-row
FAIL_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$ALL_PASS_PANEL" --emit-row 2>&1)"
FAIL_RC=$?
assert_exit_code "$FAIL_RC" "1" "all-true panel-cmd exits 1 (qualification failed)"
assert_contains "$FAIL_OUT" '"status":"failed"' "emit-row status failed on false positive critical"
assert_not_contains "$FAIL_OUT" '"false_pass_critical":0' "critical false-pass present"

# 7) Fixed-order or cross-case-state guessing cannot pass.
SENS_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PARTIAL_PASS_PANEL" 2>&1)"
SENS_RC=$?
assert_exit_code "$SENS_RC" "1" "fixed-order panel-cmd exits 1"
assert_contains "$SENS_OUT" '"evaluation_passed":false' "shuffling rejects order-based answer guessing"

# 8) Findings must match metadata and carry a behavioral consequence witness.
for BAD_MODE in wrong-rule wrong-file wrong-line low-severity missing-witness malformed-witness nonconsequential-witness invalid-domain-witness summary-only; do
  BAD_ORACLE_RC=0
  "$SCRIPT" "${QUALIFY_ARGS[@]}" \
    --panel-cmd "/panel/node /panel/reviewer.js $BAD_MODE" >/dev/null 2>&1 || BAD_ORACLE_RC=$?
  assert_exit_code "$BAD_ORACLE_RC" "1" \
    "behavioral oracle rejects $BAD_MODE reviewer output"
done

# 9) --emit-row emits engine-scorecard row accepted by record
ROW_OUT="$($SCRIPT "${QUALIFY_ARGS[@]}" --panel-cmd "$PASS_PANEL" --emit-row)"
RECORD_RC=0
ROW_OUT_FILE="$(mktemp "$TEST_TMP/engine-qualify-row.out.XXXXXX")"
ROW_ERR_FILE="$(mktemp "$TEST_TMP/engine-qualify-row.err.XXXXXX")"
printf '%s\n' "$ROW_OUT" | node "$REPO_ROOT/scripts/engine-scorecard.js" record >"$ROW_OUT_FILE" 2>"$ROW_ERR_FILE" || RECORD_RC=$?
assert_exit_code "$RECORD_RC" "0" "emit-row output is accepted by engine-scorecard record"
assert_contains "$ROW_OUT" '"source":"unknown"' "emit-row row uses cost.source=unknown"
assert_contains "$ROW_OUT" '"status":"qualified"' "emit-row on pass uses qualified status"
assert_contains "$ROW_OUT" '"repeated_trials":2' "emit-row records the repeated-trial floor"
assert_contains "$ROW_OUT" '"mutation_validation"' "emit-row binds the mutation control"

# 10) Only the exact live in-process run object can mint a session authority closure.
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

# 11) Pinned assets, fresh seeds, and missing sandbox fail closed before panel execution.
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

# 12) bad args exit 2
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
