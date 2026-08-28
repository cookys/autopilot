#!/usr/bin/env node
'use strict';

// qualification-consult-discuss-transport.test.js — D3 transport-extension
// identity-binding suite (plan: docs/plans/2026-08-28-consult-discuss-
// qualification.md, D3 "Plus transport acceptance"). Proves, for EACH of
// the two new qualification-seat roles (consult, discuss):
//
//   PART A ("local" stub-provider, role/broker layer): the case-only broker
//     (scripts/qualification-case-broker.js) accepts the role, its returned
//     provider/model identity is bound to the requested pair, a deliberate
//     identity mismatch lands on `provider_identity_mismatch`, and an
//     unknown role is still rejected.
//
//   PART B ("remote" real-adapter, prompt-mode layer): the REAL
//     scripts/qualification-review-provider.js binary — run as the broker's
//     `--provider-cmd` under a stub CLI transport (same convention as
//     qualification-review-provider.test.js) — carries the role end to end:
//     QRP_PROMPT_MODE=consult|discuss builds the dedicated system prompt and
//     case intro (never the reviewer prompt), validates the envelope shape,
//     and echoes back the exact provider/model identity. An unset/unknown
//     QRP_PROMPT_MODE for a consult/discuss-role case FAILS rather than
//     silently grading as a reviewer case.
//
//   PART C (end-to-end "mock-socket"): the broker's Unix-socket sandbox
//     bridge invoking the REAL provider.js binary as `--provider-cmd`,
//     proving the role travels broker -> sandboxed client -> socket ->
//     broker -> provider adapter -> back, unmodified, for both roles.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// AF_UNIX sun_path is capped at ~108 bytes on Linux. The broker's own
// internal tempdir (scripts/qualification-case-broker.js runBrokerCase)
// nests a socket path several segments deep under os.tmpdir(); a long test
// harness TMPDIR (hooks/tests/lib.sh derives one from this file's basename)
// can push the full socket path over that cap and fail with EINVAL — an
// environment artifact, not a broker bug. Pin a short, real TMPDIR before
// requiring the broker module so every mkdtempSync in this suite (this
// file's own and the broker's) stays well under the limit.
process.env.TMPDIR = fs.realpathSync('/tmp');

const {
  BrokerError,
  normalizeOptions,
  runBrokerCase,
} = require('./qualification-case-broker');

const PROVIDER = path.join(__dirname, 'qualification-review-provider.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ap-cd-transport-'));

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}
function equal(actual, expected, message) {
  assertions += 1;
  assert.deepStrictEqual(actual, expected, message);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/gu, `'\\''`)}'`;
}

// ── PART A: broker role/identity-binding, "local" stub provider ───────────

const localStub = path.join(tempRoot, 'local-stub-provider.js');
fs.writeFileSync(localStub, [
  "'use strict';",
  "const fs = require('fs');",
  "let source = '';",
  "process.stdin.setEncoding('utf8');",
  "process.stdin.on('data', (chunk) => { source += chunk; });",
  "process.stdin.on('end', () => {",
  '  process.stdout.write(JSON.stringify({',
  '    schema_version: 1,',
  '    provider: process.env.FAKE_PROVIDER,',
  '    model: process.env.FAKE_MODEL,',
  "    output: JSON.stringify({ ok: true }),",
  '  }));',
  '});',
  '',
].join('\n'), { mode: 0o755 });

function localBrokerOptions(role, overrides = {}) {
  return {
    role,
    provider: 'fake-provider',
    model: 'fake-model-exact',
    providerCmd: `${shellQuote(process.execPath)} ${shellQuote(localStub)}`,
    providerEnvironment: ['FAKE_PROVIDER', 'FAKE_MODEL'],
    timeoutMs: 5_000,
    ...overrides,
  };
}

process.env.FAKE_PROVIDER = 'fake-provider';
process.env.FAKE_MODEL = 'fake-model-exact';

const sampleDiff = [
  'diff --git a/a.js b/a.js',
  '--- a/a.js',
  '+++ b/a.js',
  '@@ -1 +1 @@',
  '-const value = 1;',
  '+const value = 2;',
  '',
].join('\n');

async function partA() {
  for (const role of ['consult', 'discuss']) {
    // normalizeOptions accepts the role (the whitelist widened, D3 finding [2]).
    const normalized = normalizeOptions({
      role,
      provider: 'fake-provider',
      model: 'fake-model-exact',
      providerCmd: `${shellQuote(process.execPath)} ${shellQuote(localStub)}`,
    });
    equal(normalized.role, role, `broker normalizeOptions accepts role=${role}`);

    // eslint-disable-next-line no-await-in-loop
    const result = await runBrokerCase(localBrokerOptions(role), sampleDiff);
    equal(result.status, 'ok', `${role}: a matching identity completes ok`);
    equal(
      result.receipt.expected_identity_hash,
      result.receipt.returned_identity_hash,
      `${role}: the exact returned provider/model identity is bound to the requested pair`,
    );

    // Deliberate mismatch: the stub returns a DIFFERENT model than requested.
    process.env.FAKE_MODEL = 'wrong-model';
    // eslint-disable-next-line no-await-in-loop
    const mismatch = await runBrokerCase(localBrokerOptions(role), sampleDiff);
    process.env.FAKE_MODEL = 'fake-model-exact';
    equal(mismatch.status, 'failed', `${role}: identity mismatch fails closed`);
    equal(
      mismatch.error.code,
      'provider_identity_mismatch',
      `${role}: identity mismatch has the stable provider_identity_mismatch error name`,
    );
  }

  // Unknown role is still rejected (the whitelist widened, it did not open).
  check(
    (() => {
      try {
        normalizeOptions({
          role: 'consultant',
          provider: 'fake-provider',
          model: 'fake-model-exact',
          providerCmd: `${shellQuote(process.execPath)} ${shellQuote(localStub)}`,
        });
        return false;
      } catch (error) {
        return error instanceof BrokerError && error.code === 'invalid_argument';
      }
    })(),
    'broker still rejects an unknown role (consultant is not consult)',
  );
}

// ── PART B: the REAL provider.js binary, "remote" adapter (CLI-stub transport) ──

const stubCli = path.join(tempRoot, 'stub-cli');
fs.writeFileSync(stubCli, `#!/usr/bin/env node
'use strict';
const fs = require('fs');
const stdin = fs.readFileSync(0, 'utf8');
fs.writeFileSync(process.env.STUB_CAPTURE, JSON.stringify({ argv: process.argv.slice(2), stdin }));
if (process.env.STUB_OUTPUT !== undefined) fs.writeSync(1, process.env.STUB_OUTPUT);
process.exit(Number(process.env.STUB_EXIT || 0));
`, { mode: 0o755 });

function consultRequest(overrides = {}) {
  return {
    schema_version: 1,
    request_id: 'a'.repeat(48),
    role: 'consult',
    payload: {
      format: 'unified_diff',
      content: JSON.stringify({
        question: 'Does this diff introduce a null-deref on the empty-input path?',
        bundle: { artifacts: [{ id: 'artifact:diff-1', kind: 'diff', text: sampleDiff }] },
      }),
    },
    ...overrides,
  };
}

function discussRequest(overrides = {}) {
  return {
    schema_version: 1,
    request_id: 'b'.repeat(48),
    role: 'discuss',
    payload: {
      format: 'unified_diff',
      content: JSON.stringify({
        transcript: [
          { round: 1, role: 'product', axis_id: 'axis:scope', position: 'Ship it.', risk_tags: ['minor'], anchors: [] },
        ],
        bundle: { artifacts: [{ id: 'artifact:base', kind: 'evidence', text: 'baseline' }] },
      }),
    },
    ...overrides,
  };
}

const CONSULT_STUB_OUTPUT = JSON.stringify({
  answer: { label: 'insufficient_evidence', artifact_ref: null },
  aside: [],
  authority: { refused: false, reference: null },
});
const DISCUSS_STUB_OUTPUT = JSON.stringify({
  round_id: 'r2',
  axis_id: 'axis:risk',
  claim_vector: ['token-a'],
  position: 'Holding position on token-a given the new evidence.',
  risk_tags: ['important'],
  anchors: ['artifact:base'],
});

let captureCounter = 0;
function runProvider({ env = {}, request, stubOutput, stubExit }) {
  captureCounter += 1;
  const capture = path.join(tempRoot, `capture-${captureCounter}.json`);
  const child = spawnSync(process.execPath, [PROVIDER], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      HOME: tempRoot,
      TMPDIR: tempRoot,
      QRP_TRANSPORT: 'cli',
      QRP_CLI_KIND: 'claude',
      QRP_CLI_BIN: stubCli,
      QRP_PROVIDER: 'fake-provider',
      QRP_MODEL: 'fake-model-exact',
      STUB_CAPTURE: capture,
      ...(stubOutput !== undefined ? { STUB_OUTPUT: stubOutput } : {}),
      ...(stubExit !== undefined ? { STUB_EXIT: String(stubExit) } : {}),
      ...env,
    },
  });
  let captured = null;
  if (fs.existsSync(capture)) {
    try { captured = JSON.parse(fs.readFileSync(capture, 'utf8')); } catch { captured = null; }
  }
  return { child, captured };
}

function partB() {
  // consult happy path: dedicated system prompt, own closed contract, role echoed.
  {
    const { child, captured } = runProvider({
      env: { QRP_PROMPT_MODE: 'consult' },
      request: consultRequest(),
      stubOutput: CONSULT_STUB_OUTPUT,
    });
    equal(child.status, 0, `consult provider run succeeds (stderr: ${child.stderr})`);
    check(captured.stdin.includes('consult seat'), 'the DEDICATED consult system prompt travels on stdin');
    check(!captured.stdin.includes('precision code reviewer'),
      'consult mode never sends the reviewer system prompt (D3: no reviewer-mode reuse)');
    check(captured.stdin.includes('null-deref'), 'the consult question travels on stdin');
    const parsed = JSON.parse(child.stdout);
    equal(parsed.provider, 'fake-provider', 'consult: provider identity echoed');
    equal(parsed.model, 'fake-model-exact', 'consult: model identity echoed');
    const output = JSON.parse(parsed.output);
    equal(output.answer.label, 'insufficient_evidence', 'consult: closed response contract passes through');
  }

  // discuss happy path: dedicated system prompt, own closed contract, role echoed.
  {
    const { child, captured } = runProvider({
      env: { QRP_PROMPT_MODE: 'discuss' },
      request: discussRequest(),
      stubOutput: DISCUSS_STUB_OUTPUT,
    });
    equal(child.status, 0, `discuss provider run succeeds (stderr: ${child.stderr})`);
    check(captured.stdin.includes('one seat in a multi-role debate'),
      'the DEDICATED discuss system prompt travels on stdin');
    check(!captured.stdin.includes('precision code reviewer'),
      'discuss mode never sends the reviewer system prompt (D3: no reviewer-mode reuse)');
    check(captured.stdin.includes('axis:scope'), 'the discuss transcript travels on stdin');
    const parsed = JSON.parse(child.stdout);
    equal(parsed.provider, 'fake-provider', 'discuss: provider identity echoed');
    equal(parsed.model, 'fake-model-exact', 'discuss: model identity echoed');
    const output = JSON.parse(parsed.output);
    equal(output.axis_id, 'axis:risk', 'discuss: closed response contract passes through');
  }

  // Negative: QRP_PROMPT_MODE UNSET for a consult-role case does not silently
  // fall back to reviewer mode and succeed — it fails on the role mismatch
  // (reviewer mode expects role "reviewer", the case carries role "consult").
  {
    const { child } = runProvider({ env: {}, request: consultRequest(), stubOutput: CONSULT_STUB_OUTPUT });
    equal(child.status, 1, 'unset QRP_PROMPT_MODE on a consult-role case FAILS, never silently reviewer-grades it');
    check(/not a reviewer-role case/.test(child.stderr),
      'the failure names the role mismatch, not a silent fallback');
  }

  // Negative: an UNKNOWN QRP_PROMPT_MODE is refused outright.
  {
    const { child } = runProvider({
      env: { QRP_PROMPT_MODE: 'sonnet-dreams' },
      request: consultRequest(),
      stubOutput: CONSULT_STUB_OUTPUT,
    });
    equal(child.status, 1, 'unknown QRP_PROMPT_MODE exits 1');
    check(/QRP_PROMPT_MODE must be/.test(child.stderr), 'the failure names the valid mode set');
  }

  // Negative: role/mode cross-binding. A discuss-role case run under
  // QRP_PROMPT_MODE=consult must fail — the two roles are not interchangeable.
  {
    const { child } = runProvider({
      env: { QRP_PROMPT_MODE: 'consult' },
      request: discussRequest(),
      stubOutput: CONSULT_STUB_OUTPUT,
    });
    equal(child.status, 1, 'a discuss-role case under QRP_PROMPT_MODE=consult fails (roles do not cross-bind)');
  }

  // Negative: malformed consult envelope (missing question) fails closed.
  {
    const { child } = runProvider({
      env: { QRP_PROMPT_MODE: 'consult' },
      request: consultRequest({
        payload: { format: 'unified_diff', content: JSON.stringify({ bundle: {} }) },
      }),
      stubOutput: CONSULT_STUB_OUTPUT,
    });
    equal(child.status, 1, 'consult envelope missing question fails closed');
    check(/requires a case envelope/.test(child.stderr), 'the failure names the envelope contract');
  }

  // Negative: malformed discuss envelope (missing transcript) fails closed.
  {
    const { child } = runProvider({
      env: { QRP_PROMPT_MODE: 'discuss' },
      request: discussRequest({
        payload: { format: 'unified_diff', content: JSON.stringify({ bundle: {} }) },
      }),
      stubOutput: DISCUSS_STUB_OUTPUT,
    });
    equal(child.status, 1, 'discuss envelope missing transcript fails closed');
    check(/requires a case envelope/.test(child.stderr), 'the failure names the envelope contract');
  }
}

// ── PART C: end-to-end "mock-socket" — broker's real sandbox bridge, real
// provider.js binary as --provider-cmd, CLI-stub transport underneath ─────

async function partC() {
  for (const [role, request, stubOutput, promptNeedle] of [
    ['consult', consultRequest(), CONSULT_STUB_OUTPUT, 'consult seat'],
    ['discuss', discussRequest(), DISCUSS_STUB_OUTPUT, 'one seat in a multi-role debate'],
  ]) {
    const capture = path.join(tempRoot, `e2e-capture-${role}.json`);
    const providerCmd = `${shellQuote(process.execPath)} ${shellQuote(PROVIDER)}`;
    const options = {
      role,
      provider: 'fake-provider',
      model: 'fake-model-exact',
      providerCmd,
      providerEnvironment: [
        'QRP_TRANSPORT', 'QRP_CLI_KIND', 'QRP_CLI_BIN', 'QRP_PROVIDER', 'QRP_MODEL',
        'QRP_PROMPT_MODE', 'STUB_CAPTURE', 'STUB_OUTPUT',
      ],
      timeoutMs: 10_000,
    };
    process.env.QRP_TRANSPORT = 'cli';
    process.env.QRP_CLI_KIND = 'claude';
    process.env.QRP_CLI_BIN = stubCli;
    process.env.QRP_PROVIDER = 'fake-provider';
    process.env.QRP_MODEL = 'fake-model-exact';
    process.env.QRP_PROMPT_MODE = role;
    process.env.STUB_CAPTURE = capture;
    process.env.STUB_OUTPUT = stubOutput;

    // eslint-disable-next-line no-await-in-loop
    const result = await runBrokerCase(options, request.payload.content);
    delete process.env.QRP_PROMPT_MODE;

    equal(result.status, 'ok', `${role}: end-to-end broker -> sandbox -> socket -> real provider.js succeeds`);
    equal(
      result.receipt.expected_identity_hash,
      result.receipt.returned_identity_hash,
      `${role}: end-to-end identity binding holds through the full mock-socket path`,
    );
    check(fs.existsSync(capture), `${role}: the real provider.js binary was actually invoked`);
    const captured = JSON.parse(fs.readFileSync(capture, 'utf8'));
    check(captured.stdin.includes(promptNeedle), `${role}: the dedicated system prompt travelled the full path`);
  }
}

(async () => {
  await partA();
  partB();
  await partC();
  console.log(`${assertions} assertions passed`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
