#!/usr/bin/env bash
# PRO P3 U1: hermetic native Kimi transport adapter.
. "$(dirname "$0")/lib.sh"

FAKE_KIMI="$TEST_TMP/kimi"
CAPTURE_DIR="$TEST_TMP/capture"
mkdir -p "$CAPTURE_DIR"
cat >"$FAKE_KIMI" <<'FAKE'
#!/usr/bin/env bash
set -u
if [ "${1:-}" = "--version" ]; then
  printf '0.28.0\n'
  exit 0
fi
if [ "${1:-}" = "--help" ]; then
  if [ "${KIMI_FAKE_SURFACE:-complete}" = "incomplete" ]; then
    printf '%s\n' 'Usage: kimi --model <model> --prompt <prompt>'
  elif [ "${KIMI_FAKE_SURFACE:-complete}" = "prompt-only" ]; then
    printf '%s\n' 'Usage: kimi --model=<model>, --prompt <prompt>; --output-format=text'
  elif [ "${KIMI_FAKE_SURFACE:-complete}" = "adversarial" ]; then
    printf '%s\n' \
      'Usage: kimi --modelish --prompt-injection --output-formatting --planning'
  else
    printf '%s\n' 'Usage: kimi --model=<model>, --prompt <prompt>; --output-format=text [--plan]'
  fi
  exit 0
fi
printf '%s\n' "$PWD" >"$KIMI_CAPTURE_DIR/cwd"
node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify(process.argv.slice(2)))' \
  "$KIMI_CAPTURE_DIR/argv.json" "$@"
has_prompt=0
has_plan=0
for arg in "$@"; do
  [ "$arg" = "--prompt" ] && has_prompt=1
  [ "$arg" = "--plan" ] && has_plan=1
done
if [ "$has_prompt" -eq 1 ] && [ "$has_plan" -eq 1 ]; then
  printf '%s\n' 'Cannot combine --prompt with --plan.' >&2
  exit 2
fi
case "${KIMI_FAKE_SCENARIO:-success}" in
  success) printf 'bounded authored response\n' ;;
  nonzero) printf 'private failure bytes\n' >&2; exit 7 ;;
  timeout) sleep 2 ;;
  empty) : ;;
  malformed) printf '\377' ;;
  *) exit 9 ;;
esac
FAKE
chmod +x "$FAKE_KIMI"

OUT="$(KIMI_CAPTURE_DIR="$CAPTURE_DIR" node - "$REPO_ROOT" "$FAKE_KIMI" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const [root, fake, tmp] = process.argv.slice(2);
const adapterPath = path.join(root, 'src', 'runners', 'kimi');
let adapter;
try {
  adapter = require(adapterPath);
} catch (error) {
  if (error && error.code === 'MODULE_NOT_FOUND' && error.message.includes(adapterPath)) {
    assert.fail(`Kimi adapter contract unavailable: ${adapterPath}`);
  }
  throw error;
}
const { MODEL, REQUIRED_HELP_TOKENS, inspectKimiSurface, runKimiAuthor } = adapter;
const capture = path.join(tmp, 'capture');
const marker = path.join(tmp, 'shell-injection-marker');
const prompt = `literal $(touch ${marker}) ; "quotes" \n second line`;
const base = {
  bin: fake,
  model: MODEL,
  prompt,
  timeoutMs: 1000,
  env: { ...process.env, KIMI_CAPTURE_DIR: capture },
};

const surface = inspectKimiSurface({
  bin: fake,
  env: base.env,
  cwd: tmp,
});
assert.deepStrictEqual(surface, { ready: true, version: '0.28.0', reason: null });
const incomplete = inspectKimiSurface({
  bin: fake,
  env: { ...base.env, KIMI_FAKE_SURFACE: 'incomplete' },
  cwd: tmp,
});
assert.strictEqual(incomplete.ready, false);
assert.strictEqual(incomplete.reason, 'kimi_required_surface_missing');
const adversarial = inspectKimiSurface({
  bin: fake,
  env: { ...base.env, KIMI_FAKE_SURFACE: 'adversarial' },
  cwd: tmp,
});
assert.strictEqual(adversarial.ready, false);
assert.strictEqual(adversarial.reason, 'kimi_required_surface_missing');

const success = runKimiAuthor(base, { scratchRoot: tmp, rawRoot: tmp });
assert.strictEqual(success.status, 'authored');
assert.strictEqual(success.runner, 'kimi');
assert.strictEqual(success.model, 'kimi-code/k3');
assert.strictEqual(success.error, null);
assert.strictEqual(success.transport_envelope.artifact_type, 'runner_transport_envelope');
assert.strictEqual(success.transport_envelope.outcome.classification, 'success');
assert.strictEqual(success.transport_envelope.private_raw_reference.locator,
  success.private_raw_reference.locator);
assert.strictEqual(fs.statSync(success.private_raw_reference.locator).mode & 0o777, 0o600);
assert.strictEqual(
  fs.statSync(path.dirname(success.private_raw_reference.locator)).mode & 0o777,
  0o700,
);
const argv = JSON.parse(fs.readFileSync(path.join(capture, 'argv.json'), 'utf8'));
assert.deepStrictEqual(argv, [
  '--model', 'kimi-code/k3',
  '--prompt', prompt,
  '--output-format', 'text',
]);
assert(!fs.existsSync(marker));
const observedCwd = fs.readFileSync(path.join(capture, 'cwd'), 'utf8').trim();
assert(observedCwd.startsWith(tmp));
assert.notStrictEqual(observedCwd, root);
assert(!fs.existsSync(observedCwd));
const publicSuccess = JSON.stringify(success);
assert(!publicSuccess.includes(prompt));
assert(!publicSuccess.includes('bounded authored response'));
assert(!Object.prototype.hasOwnProperty.call(success, 'argv'));
const publicKeys = [];
const collectKeys = (value) => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    publicKeys.push(key);
    collectKeys(child);
  }
};
collectKeys(success);
for (const claim of ['qualified', 'qualification', 'read_only', 'no_effect']) {
  assert(!publicKeys.includes(claim));
}

assert.deepStrictEqual(REQUIRED_HELP_TOKENS, [
  '--model',
  '--prompt',
  '--output-format',
]);
const promptOnly = inspectKimiSurface({
  bin: fake,
  env: { ...base.env, KIMI_FAKE_SURFACE: 'prompt-only' },
  cwd: tmp,
});
assert.deepStrictEqual(promptOnly, { ready: true, version: '0.28.0', reason: null });

const scenario = (name, timeoutMs = 1000) => runKimiAuthor({
  ...base,
  timeoutMs,
  env: { ...base.env, KIMI_FAKE_SCENARIO: name },
}, { scratchRoot: tmp, rawRoot: tmp });
const nonzero = scenario('nonzero');
assert.strictEqual(nonzero.status, 'runner_failed');
assert.strictEqual(nonzero.transport_envelope.outcome.classification, 'exit_failure');
assert(!JSON.stringify(nonzero).includes('private failure bytes'));
const timedOut = scenario('timeout', 50);
assert.strictEqual(timedOut.status, 'runner_failed');
assert.strictEqual(timedOut.error, 'kimi_timeout');
assert.strictEqual(timedOut.transport_envelope.outcome.classification, 'timeout');
const empty = scenario('empty');
assert.strictEqual(empty.status, 'empty_output');
assert.strictEqual(empty.transport_envelope.outcome.classification, 'success');
const malformed = scenario('malformed');
assert.strictEqual(malformed.status, 'malformed_output');
assert.strictEqual(malformed.error, 'kimi_output_not_utf8');
assert.strictEqual(malformed.transport_envelope.outcome.classification, 'success');

const missing = runKimiAuthor({
  ...base,
  bin: path.join(tmp, 'missing-kimi'),
}, { scratchRoot: tmp, rawRoot: tmp });
assert.strictEqual(missing.status, 'precondition_failed');
assert.strictEqual(missing.error, 'kimi_binary_missing');
assert.strictEqual(missing.transport_envelope, null);
const wrongModel = runKimiAuthor({ ...base, model: 'k3' }, {
  scratchRoot: tmp,
  rawRoot: tmp,
});
assert.strictEqual(wrongModel.status, 'precondition_failed');
assert.strictEqual(wrongModel.error, 'kimi_model_must_be_kimi-code_k3');

console.log('surface_detection=true');
console.log('argv_vector_and_isolation=true');
console.log('public_redaction=true');
console.log('shared_transport_envelope=true');
console.log('failure_matrix=true');
NODE
)"
assert_exit_code "$?" "0" "Kimi hermetic transport oracle exits zero"
for key in surface_detection argv_vector_and_isolation public_redaction \
  shared_transport_envelope failure_matrix; do
  assert_contains "$OUT" "$key=true" "Kimi transport proves $key"
done

if [ "${AUTOPILOT_KIMI_LIVE:-0}" = "1" ]; then
  LIVE_OUT="$(node - "$REPO_ROOT" <<'NODE'
'use strict';
const { spawnSync } = require('child_process');
const path = require('path');
const { runKimiAuthor } = require(path.join(process.argv[2], 'src', 'runners', 'kimi'));
const repoRoot = path.resolve(process.argv[2]);
let authorCwd = null;
const execute = (bin, argv, options) => {
  if (argv.includes('--prompt')) authorCwd = path.resolve(options.cwd);
  return spawnSync(bin, argv, options);
};
const result = runKimiAuthor({
  model: 'kimi-code/k3',
  prompt: 'Return one short sentence confirming this native Kimi author transport smoke.',
  timeoutMs: 120000,
}, { spawnSync: execute });
const repositoryUnexposed = authorCwd !== null
  && authorCwd !== repoRoot
  && !authorCwd.startsWith(`${repoRoot}${path.sep}`);
process.stdout.write(JSON.stringify({
  status: result.status,
  output_digest: result.output_digest,
  nonempty_output_digest: typeof result.output_digest === 'string'
    && /^[0-9a-f]{64}$/.test(result.output_digest),
  repository_unexposed: repositoryUnexposed,
  error: result.error,
}));
NODE
)"
  assert_contains "$LIVE_OUT" '"status":"authored"' \
    "opt-in live Kimi smoke returns non-empty authored output"
  assert_contains "$LIVE_OUT" '"nonempty_output_digest":true' \
    "opt-in live Kimi smoke returns a non-empty output digest"
  assert_contains "$LIVE_OUT" '"repository_unexposed":true' \
    "opt-in live Kimi smoke executes outside the repository"
fi

# --- timeout forwarding (backlog: dispatch-author-kimi-timeout-not-forwarded) ---
# dispatch-author.sh wraps dispatch-author-kimi.js in shell `timeout "$TIMEOUT"`, but the
# adapter used to be called without timeoutMs and so capped every run at 300000 ms. A
# sleeping stub past 300 s is too slow, so a --require preload records the `timeout`
# option the adapter hands to spawnSync for the real (--prompt) kimi invocation.
# Margin contract: effective = max(1000, N*1000 - 5000) ms, i.e. the adapter reports
# kimi_timeout 5 s before the shell kill. No flag = adapter default 300000.
# RED at 53ddc02f: 4 FAIL (8 passed) --
#   kimi shim --timeout-seconds 600 forwards 595000 ms: expected '595000', got ''
#   kimi shim tiny --timeout-seconds floors at 1000 ms: expected '1000', got ''
#   dispatch-author.sh --timeout 10m ... 595000 ms: expected '595000', got '300000'
#   dispatch-author.sh default 5m timeout ... 295000 ms: expected '295000', got '300000'
TF_PRELOAD="$TEST_TMP/record-timeout.js"
cat >"$TF_PRELOAD" <<'PRELOAD'
'use strict';
const cp = require('child_process');
const fs = require('fs');
const orig = cp.spawnSync;
cp.spawnSync = function (bin, argv, options) {
  if (Array.isArray(argv) && argv.includes('--prompt')) {
    fs.appendFileSync(process.env.TF_RECORD, `${options && options.timeout}\n`);
  }
  return orig.apply(this, arguments);
};
PRELOAD
TF_PROMPT="$TEST_TMP/tf-prompt.txt"
printf 'say hi\n' >"$TF_PROMPT"
TF_BINDIR="$TEST_TMP/tf-bin"
mkdir -p "$TF_BINDIR"
cp "$FAKE_KIMI" "$TF_BINDIR/kimi"

tf_recorded() { # args: label, then command via env; prints recorded timeout
  rm -f "$TEST_TMP/tf-record"
  "$@" >/dev/null 2>&1
  tr -d '\n' <"$TEST_TMP/tf-record" 2>/dev/null
}
tf_env() {
  env -u AUTOPILOT_SESSION_ID -u CLAUDE_CODE_SESSION_ID \
    PATH="$TF_BINDIR:$PATH" KIMI_CAPTURE_DIR="$CAPTURE_DIR" TF_RECORD="$TEST_TMP/tf-record" \
    NODE_OPTIONS="--require $TF_PRELOAD" "$@" </dev/null
}
JS="$REPO_ROOT/scripts/dispatch-author-kimi.js"
assert_eq "$(tf_recorded tf_env node "$JS" --model kimi-code/k3 --prompt-file "$TF_PROMPT")" "300000" \
  "kimi shim without --timeout-seconds keeps the adapter default 300000 ms"
assert_eq "$(tf_recorded tf_env node "$JS" --model kimi-code/k3 --prompt-file "$TF_PROMPT" --timeout-seconds 600)" "595000" \
  "kimi shim --timeout-seconds 600 forwards 595000 ms (5 s margin)"
assert_eq "$(tf_recorded tf_env node "$JS" --model kimi-code/k3 --prompt-file "$TF_PROMPT" --timeout-seconds 3)" "1000" \
  "kimi shim tiny --timeout-seconds floors at 1000 ms"
tf_env node "$JS" --model kimi-code/k3 --prompt-file "$TF_PROMPT" --timeout-seconds abc >/dev/null 2>&1
assert_exit_code "$?" "2" "kimi shim rejects a non-numeric --timeout-seconds"

AUTHOR="$REPO_ROOT/scripts/dispatch-author.sh"
assert_eq "$(tf_recorded tf_env env DISPATCH_DETACH=0 DISPATCH_QUIET=1 bash "$AUTHOR" --runner kimi --model kimi-code/k3 --prompt-file "$TF_PROMPT" --timeout 10m)" "595000" \
  "dispatch-author.sh --timeout 10m reaches the kimi adapter as 595000 ms"
assert_eq "$(tf_recorded tf_env env DISPATCH_DETACH=0 DISPATCH_QUIET=1 bash "$AUTHOR" --runner kimi --model kimi-code/k3 --prompt-file "$TF_PROMPT")" "295000" \
  "dispatch-author.sh default 5m timeout reaches the kimi adapter as 295000 ms"

finalize_test
