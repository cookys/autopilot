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
  '{"runner":"codex","model":"gpt-5.5","status":"reviewed","verdict":"SHIP-AS-IS","findings":"none","raw_log":"/tmp/log","error":null}',
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
  raw_log: '/tmp/log',
  error: null,
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
    status: 'done',
    verdict: 'SHIP-AS-IS',
    findings: 'none',
    raw_log: '/tmp/log',
    error: null,
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
    raw_log: '/tmp/log',
    error: null,
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
    raw_log: '/tmp/log',
    error: null,
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

finalize_test
