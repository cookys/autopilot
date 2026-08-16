'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findJsonObjectCandidates } = require('../lib/common');
const {
  createRunnerTransportEnvelope,
} = require('../transport/runner-envelope');
const {
  normalizeProviderTuple,
} = require('./provider-readiness');
const {
  LIVE_PROBE_REQUEST,
} = require('./probe');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCH_AUTHOR = path.join(REPO_ROOT, 'scripts', 'dispatch-author.sh');
const MAX_PRIVATE_RESPONSE_BYTES = 4096;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function parseDispatchResult(value) {
  const text = String(value || '');
  const { candidates } = findJsonObjectCandidates(text);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(candidates[index].source);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          && typeof parsed.status === 'string') {
        return parsed;
      }
    } catch (_error) {
      // Continue to the previous complete JSON candidate.
    }
  }
  return null;
}

function classifyFailure(child, result) {
  if (child.error && child.error.code === 'ETIMEDOUT') {
    return { code: 'ETIMEDOUT', timedOut: true, quota: false, unavailable: false };
  }
  const diagnostic = [
    result && result.status,
    result && result.error,
    child.stderr,
  ].map((value) => String(value || '').toLowerCase()).join('\n');
  if (/(quota|credit|insufficient[_ -]?balance|exhausted)/.test(diagnostic)) {
    return { code: 'quota_exhausted', timedOut: false, quota: true, unavailable: false };
  }
  if (/(rate[_ -]?limit|too many requests|(^|[^0-9])429([^0-9]|$))/.test(diagnostic)) {
    return { code: '429', timedOut: false, quota: false, unavailable: true };
  }
  if (/(unauthori[sz]ed|forbidden|auth[_ -]?failed|(^|[^0-9])(401|403)([^0-9]|$))/.test(diagnostic)) {
    return { code: 'auth_failed', timedOut: false, quota: false, unavailable: true };
  }
  return {
    code: child.error && typeof child.error.code === 'string'
      ? child.error.code
      : 'dispatch_failed',
    timedOut: false,
    quota: false,
    unavailable: Boolean(child.error) || (result && result.status === 'precondition_failed'),
  };
}

/**
 * Remove the `script(1)` transcript framing from a captured raw log.
 *
 * The agy transport in `scripts/dispatch-author.sh` runs the model under
 * `script -qec ... "$RAW_LOG"` because agy drops raw stdout on a non-TTY pipe
 * (agy #76/#408). That capture is faithful but it is not the model's answer: it
 * always carries `Script started on ...` / `Script done on ...` frames and CRs.
 * Reading it verbatim makes the live probe compare `Script started on ...\r\nOK`
 * against the expected `OK`, so the agy seat reported `malformed_response`
 * forever regardless of model or credentials (measured 2026-08-14).
 *
 * The strip is byte-identical to the one `dispatch-author.sh` already applies
 * for its own empty-output check (`tr -d '\r' | sed '/^Script started on /d;
 * /^Script done on /d'`) — the canonical definition of "model content, not
 * pseudo-TTY chrome" — kept here rather than in the dispatcher so `raw_log`
 * stays a faithful transcript for every other consumer. Transports that do not
 * use `script(1)` have no such lines and are unaffected.
 */
function stripPseudoTtyChrome(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return Buffer.alloc(0);
  const text = buffer.toString('utf8').replace(/\r/g, '');
  const kept = text
    .split('\n')
    .filter((line) => !line.startsWith('Script started on ') && !line.startsWith('Script done on '));
  return Buffer.from(kept.join('\n'), 'utf8');
}

function readPrivateResponse(rawLog) {
  if (typeof rawLog !== 'string' || rawLog.length === 0) return Buffer.alloc(0);
  let stat;
  try {
    stat = fs.lstatSync(rawLog);
  } catch (_error) {
    return Buffer.alloc(0);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_PRIVATE_RESPONSE_BYTES) {
    return Buffer.alloc(0);
  }
  try {
    return stripPseudoTtyChrome(fs.readFileSync(rawLog));
  } catch (_error) {
    return Buffer.alloc(0);
  }
}

function dispatchAuthorLiveProbe(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('provider live adapter input must be an object');
  }
  const tuple = normalizeProviderTuple(input.tuple);
  const request = input.request;
  if (!request
      || typeof request !== 'object'
      || Array.isArray(request)
      || Object.keys(request).length !== Object.keys(LIVE_PROBE_REQUEST).length
      || Object.keys(request).some(
        (key) => !Object.prototype.hasOwnProperty.call(LIVE_PROBE_REQUEST, key),
      )
      || Object.keys(LIVE_PROBE_REQUEST).some(
        (key) => request[key] !== LIVE_PROBE_REQUEST[key],
      )) {
    throw new TypeError('provider live adapter received a non-canonical request');
  }

  const scriptPath = options.scriptPath || DISPATCH_AUTHOR;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-readiness-'));
  fs.chmodSync(scratch, 0o700);
  const promptFile = path.join(scratch, 'prompt.txt');
  fs.writeFileSync(promptFile, request.prompt, { mode: 0o600, flag: 'wx' });
  // Codex refuses to run outside a trusted Git checkout. The probe is still
  // private and disposable; initialize only this scratch directory so the
  // trust check can run without exposing the consuming repository or its
  // active managed-session marker.
  const gitInit = spawnSync('git', ['init', '--quiet', scratch], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 1024 * 1024,
  });
  if (gitInit.error || gitInit.status !== 0) {
    fs.rmSync(scratch, { recursive: true, force: true });
    throw new Error(`provider readiness scratch git init failed: ${gitInit.stderr || gitInit.error || 'unknown error'}`);
  }
  const args = [
    scriptPath,
    '--runner', tuple.runner,
    '--model', tuple.model,
    '--effort', tuple.effort,
    '--prompt-file', promptFile,
    '--context-window', 'off',
    // 1m was too tight and produced a WRONG diagnosis, not just a flaky one.
    // Measured 2026-08-14 on `cc-shim --endpoint glm` (GLM-5.2): roughly one run
    // in five exceeded 60s, `timeout` killed the CLI (exit 124), and the CLI's
    // dying words — the literal text `Execution error` — flowed on as if they
    // were the model's answer. The seat then reported `transport_failure` /
    // `malformed_response`, which reads as "the provider is broken" when the
    // truth was "we did not wait long enough".
    //
    // The gate is unchanged: the reply must still normalise to exactly `OK`.
    // This only stops a slow-but-healthy endpoint from being recorded as a
    // broken one. The spawn guard below stays comfortably above it so the shell
    // deadline, not the Node one, is what fires first and stays attributable.
    '--timeout', '3m',
  ];
  if (tuple.endpoint !== null) args.push('--endpoint', tuple.endpoint);

  let child;
  try {
    // The readiness request is deliberately repo-independent and read-only. Run
    // the adapter from its private scratch cwd so an active managed L5/L6 marker
    // cannot mistake this pre-spend probe for an unmanaged repository dispatch.
    // The adapter receives its absolute script path and resolves credentials
    // independently; no repository trust or mutation surface is needed here.
    child = spawnSync('bash', args, {
      cwd: scratch,
      env: {
        ...process.env,
        // Must track LIVE_PROBE_REQUEST_BODY.max_output_tokens in probe.js —
        // this is the same budget expressed to the dispatcher.
        AUTOPILOT_AUTHOR_MAX_TOKENS: '32',
        DISPATCH_QUIET: '1',
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 200000,
      maxBuffer: 1024 * 1024,
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const result = parseDispatchResult(child.stdout);
  const success = child.status === 0 && result && result.status === 'authored';
  const response = success ? readPrivateResponse(result.raw_log) : Buffer.alloc(0);
  const failure = success
    ? { code: null, timedOut: false, quota: false, unavailable: false }
    : classifyFailure(child, result);
  const envelopeChild = {
    status: success ? 0 : (Number.isInteger(child.status) ? child.status : null),
    signal: typeof child.signal === 'string' ? child.signal : null,
    error: failure.code !== null
      && (failure.unavailable || failure.timedOut || failure.quota)
      ? { code: failure.code }
      : null,
    stdout: response,
    stderr: Buffer.alloc(0),
  };
  const privateRawReference = success && result && typeof result.raw_log === 'string'
    ? {
      kind: 'private-file',
      locator: result.raw_log,
      digest: sha256(response),
    }
    : null;
  return {
    transport_envelope: createRunnerTransportEnvelope({
      runner: tuple.runner,
      model: tuple.model,
      operation: request.operation,
      argv: ['bash', ...args],
      cwd: REPO_ROOT,
      child: envelopeChild,
      outcomeHints: {
        quota: failure.quota,
        timedOut: failure.timedOut,
        unavailable: failure.unavailable,
      },
      privateRawReference,
    }),
    response_text: response,
  };
}

module.exports = {
  MAX_PRIVATE_RESPONSE_BYTES,
  dispatchAuthorLiveProbe,
};
