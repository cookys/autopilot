#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"

DIFF="$TEST_TMP/d.diff"
printf '+def f(): return x[::1]\n' > "$DIFF"

STUB_VERDICT="$TEST_TMP/eng-verdict"
cat > "$STUB_VERDICT" <<'EOF'
#!/usr/bin/env bash
read_prompt_arg() {
  local prompt=""
  local i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1))
      next_arg="${!next_index}"
      if [ -n "$next_arg" ] && [ -f "$next_arg" ]; then
        prompt="$(cat "$next_arg")"
      else
        prompt="$next_arg"
      fi
      break
    fi
    i=$((i + 1))
  done
  if [ -z "$prompt" ]; then
    prompt="$(cat)"
  fi
  printf '%s' "$prompt"
}
extract_markers() {
  local prompt="$1"
  if [ -z "$prompt" ]; then
    return 1
  fi
  local begin end
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  if [ -z "$begin" ] || [ -z "$end" ]; then
    return 1
  fi
  printf '%s\n%s\n' "$begin" "$end"
}
PROMPT="$(read_prompt_arg "$@")"
if ! MARKERS="$(extract_markers "$PROMPT" 2>/dev/null)"; then
  exit 1
fi
BEGIN="$(printf '%s\n' "$MARKERS" | sed -n '1p')"
END="$(printf '%s\n' "$MARKERS" | sed -n '2p')"

echo "$BEGIN"
echo "VERDICT: FIX-THEN-SHIP"
echo "FINDINGS: parsed by JS runner"
echo "$END"
EOF
chmod +x "$STUB_VERDICT"

STUB_EMPTY="$TEST_TMP/eng-empty"
printf '#!/usr/bin/env bash\ncat >/dev/null 2>&1 || true\nexit 0\n' > "$STUB_EMPTY"
chmod +x "$STUB_EMPTY"

OUT="$(node - "$REPO_ROOT" "$DIFF" "$STUB_VERDICT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const stub = process.argv[4];
const { dispatchReviewJson } = require(path.join(root, 'src', 'runners', 'review'));
const run = dispatchReviewJson([
  '--runner', 'codex',
  '--model', 'gpt-5.5',
  '--diff-file', diff,
  '--bin', stub,
]);
console.log(`status=${run.status}`);
console.log(`parse=${run.parseError ? 'error' : 'ok'}`);
console.log(`result_status=${run.result && run.result.status}`);
console.log(`verdict=${run.result && run.result.verdict}`);
console.log(`findings=${run.result && run.result.findings}`);
console.log(`transport_artifact=${run.transportEnvelope.artifact_type}`);
console.log(`transport_outcome=${run.transportEnvelope.outcome.classification}`);
console.log(`transport_has_verdict=${Object.prototype.hasOwnProperty.call(
  run.transportEnvelope,
  'verdict',
)}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review runner JS capture process exits 0"
assert_contains "$OUT" "status=0" "review runner preserves child exit 0"
assert_contains "$OUT" "parse=ok" "review runner parses JSON"
assert_contains "$OUT" "result_status=reviewed" "review runner captures reviewed status"
assert_contains "$OUT" "verdict=FIX-THEN-SHIP" "review runner captures verdict"
assert_contains "$OUT" "findings=parsed by JS runner" "review runner captures findings"
assert_contains "$OUT" "transport_artifact=runner_transport_envelope" \
  "review runner returns the shared mechanical transport envelope"
assert_contains "$OUT" "transport_outcome=success" \
  "review runner transport records the mechanical child outcome"
assert_contains "$OUT" "transport_has_verdict=false" \
  "review runner transport does not extract semantic verdict authority"

OUT="$(node - "$REPO_ROOT" "$DIFF" "$STUB_EMPTY" <<'NODE'
const path = require('path');
const root = process.argv[2];
const diff = process.argv[3];
const stub = process.argv[4];
const { dispatchReviewJson } = require(path.join(root, 'src', 'runners', 'review'));
const run = dispatchReviewJson([
  '--runner', 'codex',
  '--model', 'gpt-5.5',
  '--diff-file', diff,
  '--bin', stub,
]);
console.log(`status=${run.status}`);
console.log(`parse=${run.parseError ? 'error' : 'ok'}`);
console.log(`result_status=${run.result && run.result.status}`);
console.log(`verdict=${run.result && run.result.verdict}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review runner no_verdict capture process exits 0"
assert_contains "$OUT" "status=1" "review runner preserves child exit 1"
assert_contains "$OUT" "parse=ok" "review runner parses fail-closed JSON"
assert_contains "$OUT" "result_status=no_verdict" "review runner captures no_verdict status"
assert_contains "$OUT" "verdict=null" "review runner captures null verdict"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
try {
  parseReviewOutput('not json\n');
  console.log('unexpected-ok');
} catch (err) {
  console.log('parse-error');
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parse-error process exits 0"
assert_contains "$OUT" "parse-error" "review output parser fails loud on missing JSON"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
const parsed = parseReviewOutput([
  '{not valid json}',
  '{"foo":1}',
  '{"runner":"codex","model":"gpt-5.5","status":"reviewed","verdict":"SHIP-AS-IS","findings":"none","no_finding_proof":"checked=fixture diff and acceptance contract; evidence=changed behavior is covered by the supplied regression test; conclusion=no concrete acceptance discrepancy remains","raw_log":"/tmp/log","error":null,"usage":null}',
].join('\n'));
console.log(parsed.status);
console.log(parsed.verdict);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parser skips invalid candidates"
assert_contains "$OUT" "reviewed" "review output parser finds valid later JSON"
assert_contains "$OUT" "SHIP-AS-IS" "review output parser preserves later verdict"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
const parsed = parseReviewOutput(JSON.stringify({
  runner: 'codex',
  model: 'gpt-5.5',
  status: 'reviewed',
  verdict: 'SHIP-AS-IS',
  findings: 'none',
  no_finding_proof: 'checked=fixture diff and acceptance contract; evidence=changed behavior is covered by the supplied regression test; conclusion=no concrete acceptance discrepancy remains',
  raw_log: '/tmp/log',
  error: null,
  usage: {
    total_tokens: 142,
    input_tokens: 101,
    output_tokens: 23,
    cache_read_tokens: 7,
    source: 'agy-json',
  },
}, null, 2));
console.log(parsed.status);
console.log(parsed.verdict);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parser accepts pretty JSON stdout"
assert_contains "$OUT" "reviewed" "review output parser pretty JSON status"
assert_contains "$OUT" "SHIP-AS-IS" "review output parser pretty JSON verdict"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
try {
  parseReviewOutput(JSON.stringify({
    runner: 'codex',
    model: 'gpt-5.5',
    status: 'reviewed',
    verdict: 'SHIP-AS-IS',
    findings: 'none',
    no_finding_proof: null,
    raw_log: '/tmp/log',
    error: null,
    usage: null,
  }));
  console.log('unexpected-ok');
} catch (err) {
  console.log('proof-required');
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output proof-validation process exits 0"
assert_contains "$OUT" "proof-required" "review runner rejects SHIP-AS-IS without proof"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
try {
  parseReviewOutput(JSON.stringify({
    runner: 'codex',
    model: 'gpt-5.5',
    status: 'done',
    verdict: 'SHIP-AS-IS',
    findings: 'none',
    no_finding_proof: 'checked=fixture diff and acceptance contract; evidence=changed behavior is covered by the supplied regression test; conclusion=no concrete acceptance discrepancy remains',
    raw_log: '/tmp/log',
    error: null,
    usage: null,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parser rejects invalid status process exits 0"
assert_contains "$OUT" "status must be one of" "review output parser rejects invalid status enum"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
try {
  parseReviewOutput(JSON.stringify({
    runner: 'codex',
    model: 'gpt-5.5',
    status: 'reviewed',
    verdict: 'PASS',
    findings: 'none',
    no_finding_proof: null,
    raw_log: '/tmp/log',
    error: null,
    usage: null,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parser rejects invalid verdict process exits 0"
assert_contains "$OUT" "verdict must be one of" "review output parser rejects invalid verdict enum"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
try {
  parseReviewOutput(JSON.stringify({
    runner: 'codex',
    model: 'gpt-5.5',
    status: 'reviewed',
    verdict: 'SHIP-AS-IS',
    findings: 'none',
    no_finding_proof: 'checked=fixture diff and acceptance contract; evidence=changed behavior is covered by the supplied regression test; conclusion=no concrete acceptance discrepancy remains',
    raw_log: '/tmp/log',
    error: null,
    usage: null,
    extra: true,
  }));
  console.log('unexpected-ok');
} catch (error) {
  console.log(error.message);
}
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review output parser rejects unknown field process exits 0"
assert_contains "$OUT" "unknown field: extra" "review output parser rejects additionalProperties drift"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const root = process.argv[2];
const { parseReviewOutput } = require(path.join(root, 'src', 'runners', 'review'));
const base = {
  runner: 'agy',
  model: 'Gemini 3.6 Flash (High)',
  status: 'reviewed',
  verdict: 'FIX-THEN-SHIP',
  findings: 'fixture',
  no_finding_proof: null,
  raw_log: '/tmp/log',
  error: null,
  usage: {
    total_tokens: 142,
    input_tokens: 101,
    output_tokens: 23,
    cache_read_tokens: 7,
    source: 'agy-json',
  },
};
const valid = parseReviewOutput(JSON.stringify(base));
const invalid = [
  { ...base, usage: { ...base.usage, input_tokens: -1 } },
  { ...base, usage: { ...base.usage, output_tokens: 1.5 } },
  { ...base, usage: { ...base.usage, total_tokens: Number.MAX_SAFE_INTEGER + 1 } },
  { ...base, usage: { ...base.usage, extra: 1 } },
  { ...base, usage: { ...base.usage, source: '' } },
];
let rejected = 0;
for (const value of invalid) {
  try { parseReviewOutput(JSON.stringify(value)); } catch (_error) { rejected += 1; }
}
console.log(`source=${valid.usage.source}`);
console.log(`total=${valid.usage.total_tokens}`);
console.log(`rejected=${rejected}`);
NODE
)"; EXIT=$?
assert_eq "0" "$EXIT" "review usage consumer matrix process exits 0"
assert_contains "$OUT" "source=agy-json" "review consumer accepts closed native usage source"
assert_contains "$OUT" "total=142" "review consumer preserves native usage total"
assert_contains "$OUT" "rejected=5" "review consumer rejects invalid, overflow, and open usage"

# Shared vector table: bash battery vs Node parseReviewOutput (v2.36.57).
# RED at base 0e3ea3cc: Node rejected `.`/`,`/space/mixed rows with
# "review output JSON no_finding_proof must contain non-tautological checked,
# evidence, and conclusion fields"; bash accepted those rows. Shape and
# tautology shared that one Node message.
PROOF_STUB="$TEST_TMP/proof-stub"
cat > "$PROOF_STUB" <<'EOF'
#!/usr/bin/env bash
read_prompt_arg() {
  local prompt="" i=1
  while [ "$i" -le "$#" ]; do
    arg="${!i}"
    if [ "$arg" = "--prompt-file" ] || [ "$arg" = "-p" ]; then
      next_index=$((i + 1)); next_arg="${!next_index}"
      if [ -n "$next_arg" ] && [ -f "$next_arg" ]; then prompt="$(cat "$next_arg")"
      else prompt="$next_arg"; fi
      break
    fi
    i=$((i + 1))
  done
  [ -z "$prompt" ] && prompt="$(cat)"
  printf '%s' "$prompt"
}
extract_markers() {
  local prompt="$1" begin end
  begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
  [ -n "$begin" ] && [ -n "$end" ] || return 1
  printf '%s\n%s\n' "$begin" "$end"
}
PROMPT="$(read_prompt_arg "$@")"
MARKERS="$(extract_markers "$PROMPT")" || exit 1
BEGIN="$(printf '%s\n' "$MARKERS" | sed -n '1p')"
END="$(printf '%s\n' "$MARKERS" | sed -n '2p')"
echo "$BEGIN"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: ${STUB_PROOF}"
echo "$END"
EOF
chmod +x "$PROOF_STUB"

VECTOR_TABLE="$TEST_TMP/proof-vectors.txt"
cat > "$VECTOR_TABLE" <<'EOF'
checked=diff lines 1-40; evidence=ran the regression; conclusion=nothing blocking remains|ok
checked=diff lines 1-40. evidence=ran the regression. conclusion=nothing blocking remains|ok
checked=diff lines 1-40, evidence=ran the regression, conclusion=nothing blocking remains|ok
checked=diff lines 1-40 evidence=ran the regression conclusion=nothing blocking remains|ok
checked=diff lines 1-40.; evidence=ran the regression, conclusion=nothing blocking remains|ok
checked=field;with semicolon inside; evidence=ran the regression; conclusion=nothing blocking remains|ok
checked=diff lines 1-40; evidence=ran the regression|shape
evidence=ran the regression; checked=diff lines 1-40; conclusion=nothing blocking remains|shape
checked=diff lines 1-40|evidence=ran the regression|conclusion=nothing blocking remains|shape
checked=; evidence=ran the regression; conclusion=nothing blocking remains|shape
checked=diff lines 1-40; evidence=; conclusion=nothing blocking remains|shape
checked=diff lines 1-40; evidence=ran the regression; conclusion=;|shape
checked=none; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=no finding; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=no findings; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=no must-fix; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=no must-fix remains; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=n/a; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=na; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=checked; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=all passed; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=looks good; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=diff; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=tests; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=spec; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=code; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=acceptance criteria; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=requirements satisfied; evidence=ran the regression; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=none; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=no finding; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=no findings; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=no must-fix; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=no must-fix remains; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=n/a; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=na; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=checked; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=all passed; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=looks good; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=diff; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=tests; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=spec; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=code; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=acceptance criteria; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=requirements satisfied; conclusion=nothing blocking remains|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=none|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=no finding|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=no findings|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=no must-fix|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=no must-fix remains|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=n/a|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=na|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=checked|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=all passed|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=looks good|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=diff|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=tests|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=spec|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=code|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=acceptance criteria|tautology
checked=diff lines 1-40; evidence=ran the regression; conclusion=requirements satisfied|tautology
EOF

VECTOR_OUT="$(node - "$REPO_ROOT" "$DIFF" "$PROOF_STUB" "$VECTOR_TABLE" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [root, diff, stub, tablePath, tmp] = process.argv.slice(2);
const { parseReviewOutput, isValidNoFindingProof } = require(path.join(root, 'src', 'runners', 'review'));
const script = path.join(root, 'scripts', 'dispatch-review.sh');
const SHAPE_MSG = 'review output JSON no_finding_proof must contain the ordered checked, evidence, and conclusion fields separated by space, \';\', \',\' or \'.\'';
const TAUT_MSG = 'review output JSON no_finding_proof contains a tautological checked, evidence, or conclusion value';
const BASE_MSG = 'review output JSON no_finding_proof must contain non-tautological checked, evidence, and conclusion fields';
const BASH_SHAPE = 'NO-FINDING-PROOF must contain non-empty checked, evidence, and conclusion fields';
const BASH_TAUT = 'NO-FINDING-PROOF contains a tautological checked, evidence, or conclusion value';

function bashClass(proof) {
  const run = spawnSync(script, [
    '--runner', 'codex', '--model', 'gpt-5.5', '--diff-file', diff, '--bin', stub,
  ], { encoding: 'utf8', env: { ...process.env, STUB_PROOF: proof } });
  let envelope;
  try { envelope = JSON.parse((run.stdout || '').trim().split('\n').filter(Boolean).at(-1)); }
  catch (_err) { throw new Error(`bash stdout not JSON for ${proof}: ${run.stdout}`); }
  if (envelope.status === 'reviewed') return { cls: 'ok', error: envelope.error };
  const err = String(envelope.error || '');
  if (err.includes(BASH_SHAPE)) return { cls: 'shape', error: err };
  if (err.includes(BASH_TAUT)) return { cls: 'tautology', error: err };
  throw new Error(`unclassified bash error for ${proof}: ${err}`);
}

function nodeClass(proof) {
  const envelope = JSON.stringify({
    runner: 'codex', model: 'gpt-5.5', status: 'reviewed', verdict: 'SHIP-AS-IS',
    findings: 'none', no_finding_proof: proof, raw_log: '/tmp/log', error: null, usage: null,
  });
  try {
    parseReviewOutput(envelope);
    return { cls: 'ok', error: null };
  } catch (error) {
    const msg = error.message || String(error);
    if (msg === SHAPE_MSG) return { cls: 'shape', error: msg };
    if (msg === TAUT_MSG) return { cls: 'tautology', error: msg };
    if (msg === BASE_MSG) return { cls: 'base-tautology-msg', error: msg };
    throw new Error(`unclassified node error for ${proof}: ${msg}`);
  }
}

const rows = fs.readFileSync(tablePath, 'utf8').split('\n').filter(Boolean).map((line) => {
  const cut = line.lastIndexOf('|');
  return { proof: line.slice(0, cut), expected: line.slice(cut + 1) };
});
for (const row of rows) {
  const bash = bashClass(row.proof);
  const node = nodeClass(row.proof);
  assert.strictEqual(bash.cls, row.expected, `bash ${row.proof}`);
  assert.strictEqual(node.cls, row.expected, `node ${row.proof}`);
  assert.strictEqual(isValidNoFindingProof(row.proof), row.expected, `classifier ${row.proof}`);
  // (preservation, green at base): a `;` inside a substantive field keeps the whole capture.
  if (row.proof.includes('field;with semicolon inside')) {
    const parsed = parseReviewOutput(JSON.stringify({
      runner: 'codex', model: 'gpt-5.5', status: 'reviewed', verdict: 'SHIP-AS-IS',
      findings: 'none', no_finding_proof: row.proof, raw_log: '/tmp/log', error: null, usage: null,
    }));
    assert.ok(parsed.no_finding_proof.includes('field;with semicolon inside'));
  }
}
console.log(`vector_rows=${rows.length}`);
console.log('vector_parity=true');

function dispatchLike(stdout, args) {
  const fake = path.join(tmp, 'fake-dispatch.sh');
  fs.writeFileSync(fake, `#!/usr/bin/env bash\nprintf '%s\\n' ${JSON.stringify(stdout)}\n`);
  fs.chmodSync(fake, 0o755);
  const { dispatchReviewJson } = require(path.join(root, 'src', 'runners', 'review'));
  return dispatchReviewJson(args, { scriptPath: fake });
}

// Salvage (plan §1.2, R3). RED at base 0e3ea3cc: dispatchReviewJson returned
// { result: null, parseError } with NO `salvaged` key — observed
// "salvaged.raw_log equals envelope path; runner/model from args: 'salvage_ok=true' not found",
// "malformed JSON salvages nothing … not found", "empty/non-string raw_log salvages nothing … not found".
const tautProof = 'checked=diff; evidence=tests; conclusion=looks good';
const goodEnvelope = {
  runner: 'liar-runner', model: 'liar-model', status: 'reviewed', verdict: 'SHIP-AS-IS',
  findings: 'none', no_finding_proof: tautProof, raw_log: '/tmp/salvaged.log',
  error: null, usage: null,
};
const salvaged = dispatchLike(JSON.stringify(goodEnvelope), [
  '--runner', 'arg-runner', '--model', 'arg-model', '--diff-file', diff,
]);
assert.strictEqual(salvaged.result, null);
assert.ok(salvaged.parseError);
assert.strictEqual(salvaged.salvaged.raw_log, '/tmp/salvaged.log');
assert.strictEqual(salvaged.salvaged.runner, 'arg-runner');
assert.strictEqual(salvaged.salvaged.model, 'arg-model');
assert.strictEqual(salvaged.result, null);
assert.ok(!Object.prototype.hasOwnProperty.call(salvaged, 'verdict'));
assert.ok(!JSON.stringify(salvaged.salvaged).includes('SHIP-AS-IS'));
assert.ok(!Object.prototype.hasOwnProperty.call(salvaged.salvaged, 'status'));
assert.ok(!Object.prototype.hasOwnProperty.call(salvaged.salvaged, 'findings'));
console.log('salvage_ok=true');

const malformed = dispatchLike('{not json', ['--runner', 'arg-runner', '--model', 'arg-model']);
assert.strictEqual(malformed.result, null);
assert.ok(malformed.parseError);
assert.ok(!Object.prototype.hasOwnProperty.call(malformed, 'salvaged'));
console.log('salvage_malformed=true');

const emptyLog = dispatchLike(JSON.stringify({ ...goodEnvelope, raw_log: '' }), [
  '--runner', 'arg-runner', '--model', 'arg-model',
]);
assert.ok(!Object.prototype.hasOwnProperty.call(emptyLog, 'salvaged'));
const nonString = dispatchLike(JSON.stringify({ ...goodEnvelope, raw_log: 12 }), [
  '--runner', 'arg-runner', '--model', 'arg-model',
]);
assert.ok(!Object.prototype.hasOwnProperty.call(nonString, 'salvaged'));
console.log('salvage_empty_nonstring=true');
NODE
)"
assert_eq "0" "$?" "proof vector + salvage process exits 0: $VECTOR_OUT"
assert_contains "$VECTOR_OUT" "vector_parity=true" "bash and Node agree on every vector row"
assert_contains "$VECTOR_OUT" "salvage_ok=true" "salvaged.raw_log equals envelope path; runner/model from args"
assert_contains "$VECTOR_OUT" "salvage_malformed=true" "malformed JSON salvages nothing"
assert_contains "$VECTOR_OUT" "salvage_empty_nonstring=true" "empty/non-string raw_log salvages nothing"

# Packet deny extras through the REAL builder (review.js spread is the only floor).
# RED at base 10c50297: dispatchReview does not pass denyList.
PKT_REPO="$TEST_TMP/pkt-repo"
git init --object-format=sha1 -q "$PKT_REPO"
git -C "$PKT_REPO" config user.email t@t.example
git -C "$PKT_REPO" config user.name t
printf 'keep\n' > "$PKT_REPO/keep.txt"
mkdir -p "$PKT_REPO/secret"
printf 'leak\n' > "$PKT_REPO/secret/leak.txt"
git -C "$PKT_REPO" add keep.txt secret/leak.txt
git -C "$PKT_REPO" commit -q -m b
printf 'keep2\n' > "$PKT_REPO/keep.txt"
git -C "$PKT_REPO" add keep.txt
git -C "$PKT_REPO" commit -q -m c
PKT_BASE="$(git -C "$PKT_REPO" rev-parse HEAD^)"
PKT_CAND="$(git -C "$PKT_REPO" rev-parse HEAD)"
PKT_DIFF="$TEST_TMP/pkt.diff"
git -C "$PKT_REPO" diff --no-ext-diff --no-textconv "$PKT_BASE..$PKT_CAND" > "$PKT_DIFF"
PKT_SPEC="$TEST_TMP/pkt.spec.md"
printf 'spec\n' > "$PKT_SPEC"
PKT_STUB="$TEST_TMP/pkt-dispatch.sh"
cat > "$PKT_STUB" <<EOF
#!/usr/bin/env bash
set -euo pipefail
dest="\${AUTOPILOT_PACKET_KEEP:?}"
cp "\$AUTOPILOT_REVIEW_PACKET_DIR/MANIFEST.json" "\$dest"
printf 'ok\n'
EOF
chmod +x "$PKT_STUB"

PKT_OUT="$(node - "$REPO_ROOT" "$PKT_REPO" "$PKT_BASE" "$PKT_CAND" "$PKT_DIFF" "$PKT_SPEC" "$PKT_STUB" "$TEST_TMP" <<'NODE'
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = process.argv[2];
const repo = process.argv[3];
const base = process.argv[4];
const cand = process.argv[5];
const diff = process.argv[6];
const spec = process.argv[7];
const stub = process.argv[8];
const tmp = process.argv[9];
const { dispatchReviewJson } = require(path.join(root, 'src', 'runners', 'review'));
const { DEFAULT_PACKET_DENY_LIST } = require(path.join(root, 'src', 'runners', 'review-packet'));

function run(keep, extra) {
  const env = { ...process.env, AUTOPILOT_PACKET_KEEP: keep };
  return dispatchReviewJson([
    '--runner', 'codex',
    '--model', 'gpt-5.5',
    '--diff-file', diff,
    '--spec-file', spec,
    '--bin', stub,
  ], {
    scriptPath: stub,
    blindDiscovery: true,
    packet: { repo, baseSha: base, candidateSha: cand, denyExtra: extra },
    env,
  });
}

const extraKeep = path.join(tmp, 'manifest-extra.json');
const defaultKeep = path.join(tmp, 'manifest-default.json');
const extraRun = run(extraKeep, ['secret/**']);
const defaultRun = run(defaultKeep, []);
const extraManifest = JSON.parse(fs.readFileSync(extraKeep, 'utf8'));
const defaultManifest = JSON.parse(fs.readFileSync(defaultKeep, 'utf8'));
const deny = extraManifest.deny_list;
const missingDefaults = DEFAULT_PACKET_DENY_LIST.filter((p) => !deny.includes(p));
console.log(`missing_defaults=${missingDefaults.length}`);
console.log(`has_extra=${deny.includes('secret/**')}`);
const extraPaths = (extraManifest.entries || []).map((e) => e.path);
const defaultPaths = (defaultManifest.entries || []).map((e) => e.path);
const extraHas = extraPaths.some((p) => p === 'secret/leak.txt' || p.endsWith('/secret/leak.txt'));
const defaultHas = defaultPaths.some((p) => p === 'secret/leak.txt' || p.endsWith('/secret/leak.txt'));
console.log(`denied_secret=${!extraHas && defaultHas}`);
console.log(`hash_differs=${extraManifest.packet_hash !== defaultManifest.packet_hash}`);
console.log(`extra_hash=${extraRun.packet && extraRun.packet.packet_hash === extraManifest.packet_hash}`);

// Portable walk (no rg dependency — a missing tool must not make this assertion vacuous):
// every `buildReviewPacket(` in src/**/*.js must be the definition or the review.js call.
const lines = [];
(function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) { walk(full); continue; }
    if (!ent.name.endsWith('.js')) continue;
    fs.readFileSync(full, 'utf8').split('\n').forEach((text, i) => {
      if (text.includes('buildReviewPacket(')) lines.push(`${full}:${i + 1}:${text}`);
    });
  }
}(path.join(root, 'src')));
const unexpected = lines.filter((line) => !line.includes(`${path.sep}runners${path.sep}review.js:`)
  && !line.includes(`${path.sep}runners${path.sep}review-packet.js:`));
console.log(`builder_callers=${lines.length}`);
console.log(`unexpected_callers=${unexpected.length}`);
if (unexpected.length) console.log(unexpected.join('\n'));
NODE
)"
assert_eq "0" "$?" "review-runner real-builder packet extras exit 0: $PKT_OUT"
assert_contains "$PKT_OUT" "missing_defaults=0" "MANIFEST deny_list contains all 8 defaults (RED at base 10c50297: denyList not passed)"
assert_contains "$PKT_OUT" "has_extra=true" "MANIFEST deny_list contains extras"
assert_contains "$PKT_OUT" "denied_secret=true" "extra pattern denies planted secret/leak.txt"
assert_contains "$PKT_OUT" "hash_differs=true" "packet_hash differs from default-list build"
assert_contains "$PKT_OUT" "unexpected_callers=0" "buildReviewPacket( is called only from review.js (definition in review-packet.js)"
assert_contains "$PKT_OUT" "builder_callers=2" "the walk saw both the definition and the review.js call (not vacuous)"

# RED at base 7f5d6ee8: no scripts/lib/review-fanout.js (ENOENT)
FANOUT="$REPO_ROOT/scripts/lib/review-fanout.js"
test -x "$FANOUT"
assert_eq "0" "$?" "review-fanout.js is executable"
STUB_DIR="$TEST_TMP/fanout-stubs"
mkdir -p "$STUB_DIR"
for pair in 2:a 3:b 4:c; do
  secs="${pair%%:*}"
  id="${pair##*:}"
  cat > "$STUB_DIR/dispatch-$id.sh" <<STUB
#!/usr/bin/env bash
sleep $secs
printf '{"runner":"stub","model":"%s","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"none","raw_log":"ok","error":null}\\n' "$id"
STUB
  chmod +x "$STUB_DIR/dispatch-$id.sh"
done
cat > "$STUB_DIR/hang.sh" <<'STUB'
#!/usr/bin/env bash
exec sleep 30
STUB
chmod +x "$STUB_DIR/hang.sh"
cat > "$STUB_DIR/ok.sh" <<'STUB'
#!/usr/bin/env bash
printf '{"runner":"stub","model":"ok","status":"reviewed","verdict":"SHIP-AS-IS","findings":"","no_finding_proof":"none","raw_log":"ok","error":null}\n'
STUB
chmod +x "$STUB_DIR/ok.sh"

FAN_OUT="$(FANOUT="$FANOUT" STUB_DIR="$STUB_DIR" python3 - <<'PY'
import json, os, subprocess, time
root = os.environ["FANOUT"]
stubs = os.environ["STUB_DIR"]
jobs = {
  "jobs": [
    {"id": "a", "argv": [os.path.join(stubs, "dispatch-a.sh")], "cwd": stubs, "env": dict(os.environ), "stdin_file": None, "timeout_seconds": 20},
    {"id": "b", "argv": [os.path.join(stubs, "dispatch-b.sh")], "cwd": stubs, "env": dict(os.environ), "stdin_file": None, "timeout_seconds": 20},
    {"id": "c", "argv": [os.path.join(stubs, "dispatch-c.sh")], "cwd": stubs, "env": dict(os.environ), "stdin_file": None, "timeout_seconds": 20},
  ]
}
t0 = time.time()
p = subprocess.run(["node", root], input=json.dumps(jobs), text=True, capture_output=True)
elapsed = time.time() - t0
rows = json.loads(p.stdout.strip())
print(f"exit={p.returncode}")
print(f"order={','.join(r['id'] for r in rows)}")
starts = [r['started_at'] for r in rows]
ends = [r['ended_at'] for r in rows]
print(f"overlap={'true' if max(starts) < min(ends) else 'false'}")
print(f"wall_lt_sum={'true' if elapsed < (2+3+4)-1 else 'false'}")
PY
)"
assert_contains "$FAN_OUT" "exit=0" "fanout three-job helper exits 0"
assert_contains "$FAN_OUT" "order=a,b,c" "fanout returns rows in job order"
assert_contains "$FAN_OUT" "overlap=true" "fanout jobs overlap in wall time"
assert_contains "$FAN_OUT" "wall_lt_sum=true" "fanout wall is less than sequential sum minus 1s"

TO_OUT="$(FANOUT="$FANOUT" STUB_DIR="$STUB_DIR" python3 - <<'PY'
import json, os, subprocess
root = os.environ["FANOUT"]
stubs = os.environ["STUB_DIR"]
jobs = {
  "jobs": [
    {"id": "hang", "argv": [os.path.join(stubs, "hang.sh")], "cwd": stubs, "env": dict(os.environ), "stdin_file": None, "timeout_seconds": 1},
    {"id": "ok", "argv": [os.path.join(stubs, "ok.sh")], "cwd": stubs, "env": dict(os.environ), "stdin_file": None, "timeout_seconds": 10},
  ]
}
p = subprocess.run(["node", root], input=json.dumps(jobs), text=True, capture_output=True)
rows = json.loads(p.stdout.strip())
print(f"exit={p.returncode}")
print(f"hang_signal={rows[0].get('signal')}")
print(f"ok_status={rows[1].get('status')}")
PY
)"
assert_contains "$TO_OUT" "exit=0" "timed-out job still yields an array at exit 0"
assert_contains "$TO_OUT" "hang_signal=SIG" "timed-out job reports a signal"
assert_contains "$TO_OUT" "ok_status=0" "sibling job still completes"

IDENT_OUT="$(node - "$REPO_ROOT" "$DIFF" "$STUB_VERDICT" <<'NODE'
const path = require('path');
const assert = require('assert');
const root = process.argv[2];
const diff = process.argv[3];
const stub = process.argv[4];
const { dispatchReviewJson, dispatchReviewJsonBatch } = require(path.join(root, 'src', 'runners', 'review'));
const args = ['--runner', 'codex', '--model', 'gpt-5.5', '--diff-file', diff, '--bin', stub];
const single = dispatchReviewJson(args);
const batch = dispatchReviewJsonBatch([{ args }])[0];
// Field-by-field identity of the WHOLE object (result JSON, envelope, packet fields): the
// batch of one and the single dispatch share one launch path, so nothing may differ.
// (second review 🟡 batch-identity-weak: the earlier check compared four fields only.)
// Per-run nonces (dispatch run id, mktemp raw-log suffix) differ by construction on every
// dispatch, and the envelope digests are functions of the text that carries them — those are
// normalized; every other field of the whole object must be strictly equal.
const norm = (o) => JSON.parse(JSON.stringify(o, (k, v) => {
  if (k === 'error' && v instanceof Error) return String(v);
  if (k === 'output_digests' || k === 'receipt_digest') return '<digest-of-normalized-text>';
  if (typeof v === 'string') {
    return v
      .replace(/dispatch-review-log-[A-Za-z0-9]{6}/g, 'dispatch-review-log-NONCE')
      .replace(/review-\d+-\d+-[0-9a-f]{4}/g, 'review-NONCE');
  }
  return v;
}));
assert.deepStrictEqual(norm(batch), norm(single));
console.log('batch_of_one_identity=true');
NODE
)"
assert_contains "$IDENT_OUT" "batch_of_one_identity=true" "batch of one matches dispatchReviewJson field-by-field"

finalize_test
