'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { bufferToString } = require('../lib/common');
const { createRunnerTransportEnvelope } = require('../transport/runner-envelope');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DISPATCH_REVIEW = path.join(REPO_ROOT, 'scripts', 'dispatch-review.sh');
const REVIEW_RESULT_FIELDS = [
  'runner',
  'model',
  'status',
  'verdict',
  'findings',
  'no_finding_proof',
  'raw_log',
  'error',
  'usage',
];
// Optional, non-authoritative columns. `unratified_verdict` (verdict-bytes
// preservation, v2.34.33) records a transport-destroyed but content-verified
// verdict for HUMAN adjudication only — it is never copied into `verdict` or
// `status`, and non-null is admitted only on status:no_verdict. Consumers deriving
// authority from it are rejected by the check-canonical-invariants reader guard.
const REVIEW_RESULT_OPTIONAL_FIELDS = ['unratified_verdict'];
const REVIEW_STATUSES = ['reviewed', 'no_verdict', 'precondition_failed'];
const REVIEW_VERDICTS = ['SHIP-AS-IS', 'FIX-THEN-SHIP', null];
const NO_FINDING_TAUTOLOGIES = new Set([
  '',
  'none',
  'no finding',
  'no findings',
  'no must-fix',
  'no must-fix remains',
  'n/a',
  'na',
  'checked',
  'all passed',
  'looks good',
  'diff',
  'tests',
  'spec',
  'code',
  'acceptance criteria',
  'requirements satisfied',
]);

function normalizeNoFindingProofField(part) {
  return String(part).toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
}

// Classifier: 'ok' | 'shape' | 'tautology'. Keep the export name; callers that
// need a boolean use `=== 'ok'`. Grammar matches the bash battery (v2.36.57).
function isValidNoFindingProof(value) {
  if (typeof value !== 'string') return 'shape';
  const match = /^checked=(.+)[\s;,.]+evidence=(.+)[\s;,.]+conclusion=(.+)$/u.exec(value);
  if (!match) return 'shape';
  const normalized = match.slice(1).map(normalizeNoFindingProofField);
  if (normalized.some((part) => part.length === 0)) return 'shape';
  if (normalized.some((part) => NO_FINDING_TAUTOLOGIES.has(part))) return 'tautology';
  return 'ok';
}

const NO_FINDING_PROOF_SHAPE_ERROR =
  'review output JSON no_finding_proof must contain the ordered checked, evidence, and conclusion fields separated by space, \';\', \',\' or \'.\'';
const NO_FINDING_PROOF_TAUTOLOGY_ERROR =
  'review output JSON no_finding_proof contains a tautological checked, evidence, or conclusion value';

function validateUsage(value) {
  if (value === null) return;
  const fields = [
    'total_tokens',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'source',
  ];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review output JSON field usage must be null or an object');
  }
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...fields].sort())) {
    throw new Error('review output JSON field usage has invalid closed shape');
  }
  for (const field of fields.slice(0, 4)) {
    if (value[field] !== null
        && (!Number.isSafeInteger(value[field]) || value[field] < 0)) {
      throw new Error(`review output JSON field usage.${field} must be null or a nonnegative safe integer`);
    }
  }
  if (typeof value.source !== 'string' || value.source.length === 0) {
    throw new Error('review output JSON field usage.source must be a non-empty string');
  }
}

function validateReviewResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('review output JSON is not an object');
  }
  for (const field of REVIEW_RESULT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`review output JSON missing field: ${field}`);
    }
  }
  for (const field of Object.keys(value)) {
    if (!REVIEW_RESULT_FIELDS.includes(field) && !REVIEW_RESULT_OPTIONAL_FIELDS.includes(field)) {
      throw new Error(`review output JSON has unknown field: ${field}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'unratified_verdict')) {
    if (value.unratified_verdict !== null
      && !['SHIP-AS-IS', 'FIX-THEN-SHIP'].includes(value.unratified_verdict)) {
      throw new Error('review output JSON unratified_verdict must be SHIP-AS-IS, FIX-THEN-SHIP, or null');
    }
    if (value.unratified_verdict !== null && value.status !== 'no_verdict') {
      throw new Error('review output JSON unratified_verdict must be null unless status is no_verdict');
    }
  }
  if (typeof value.runner !== 'string' || value.runner.length === 0) {
    throw new Error('review output JSON field runner must be a non-empty string');
  }
  if (typeof value.model !== 'string' || value.model.length === 0) {
    throw new Error('review output JSON field model must be a non-empty string');
  }
  if (!REVIEW_STATUSES.includes(value.status)) {
    throw new Error(`review output JSON status must be one of: ${REVIEW_STATUSES.join(', ')}`);
  }
  if (!REVIEW_VERDICTS.includes(value.verdict)) {
    throw new Error('review output JSON verdict must be one of: SHIP-AS-IS, FIX-THEN-SHIP, null');
  }
  if (typeof value.findings !== 'string') {
    throw new Error('review output JSON field findings must be a string');
  }
  if (value.no_finding_proof !== null
    && (typeof value.no_finding_proof !== 'string' || value.no_finding_proof.length === 0)) {
    throw new Error('review output JSON field no_finding_proof must be null or non-empty string');
  }
  if (value.verdict === 'SHIP-AS-IS' && value.no_finding_proof === null) {
    throw new Error('review output JSON SHIP-AS-IS requires no_finding_proof');
  }
  if (value.verdict === 'SHIP-AS-IS') {
    const proofClass = isValidNoFindingProof(value.no_finding_proof);
    if (proofClass === 'shape') {
      throw new Error(NO_FINDING_PROOF_SHAPE_ERROR);
    }
    if (proofClass === 'tautology') {
      throw new Error(NO_FINDING_PROOF_TAUTOLOGY_ERROR);
    }
  }
  if (value.verdict !== 'SHIP-AS-IS' && value.no_finding_proof !== null) {
    throw new Error('review output JSON no_finding_proof must be null unless verdict is SHIP-AS-IS');
  }
  if (value.raw_log !== null && (typeof value.raw_log !== 'string' || value.raw_log.length === 0)) {
    throw new Error('review output JSON field raw_log must be null or non-empty string');
  }
  if (value.error !== null && (typeof value.error !== 'string' || value.error.length === 0)) {
    throw new Error('review output JSON field error must be null or non-empty string');
  }
  validateUsage(value.usage);
  return value;
}

function parseReviewOutput(stdout) {
  const text = bufferToString(stdout);
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return validateReviewResult(JSON.parse(trimmed));
    } catch (_err) {
      // Fall through to line-oriented parsing; stdout may include non-JSON preface text.
    }
  }

  let lastParseError = null;
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i];
    if (!line.startsWith('{') || !line.endsWith('}')) continue;
    try {
      return validateReviewResult(JSON.parse(line));
    } catch (error) {
      lastParseError = error;
    }
  }

  if (lastParseError) {
    throw lastParseError;
  }
  throw new Error('no JSON object found in review stdout');
}

function dispatchReview(args, options = {}) {
  const scriptPath = options.scriptPath || DISPATCH_REVIEW;
  if (!fs.existsSync(scriptPath)) {
    return {
      error: new Error(`dispatch-review.sh not found: ${scriptPath}`),
      status: null,
      signal: null,
      packet: null,
    };
  }
  let launchArgs = args;
  let launchCwd = options.cwd || REPO_ROOT;
  let blindCwd = null;
  let autopilotPacket = null;
  const launchEnv = { ...(options.env || process.env) };
  delete launchEnv.AUTOPILOT_REVIEW_PACKET_DIR;
  delete launchEnv.AUTOPILOT_REVIEW_PACKET_HASH;
  try {
    if (options.blindDiscovery === true) {
      blindCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-review-blind-'));
      fs.chmodSync(blindCwd, 0o700);
      launchArgs = [...args];
      if (options.packet && typeof options.packet === 'object') {
        const { buildReviewPacket, DEFAULT_PACKET_DENY_LIST } = require('./review-packet');
        const diffIndex = launchArgs.indexOf('--diff-file');
        const specIndex = launchArgs.indexOf('--spec-file');
        const diffFile = diffIndex >= 0 && typeof launchArgs[diffIndex + 1] === 'string'
          ? launchArgs[diffIndex + 1]
          : undefined;
        const specFile = specIndex >= 0 && typeof launchArgs[specIndex + 1] === 'string'
          ? launchArgs[specIndex + 1]
          : undefined;
        const packetDir = path.join(blindCwd, 'packet');
        const denyExtra = options.packet.denyExtra === undefined ? [] : options.packet.denyExtra;
        autopilotPacket = buildReviewPacket({
          repo: options.packet.repo,
          baseSha: options.packet.baseSha,
          candidateSha: options.packet.candidateSha,
          diffFile,
          specFile: specFile === undefined ? null : specFile,
          outDir: packetDir,
          denyList: [...DEFAULT_PACKET_DENY_LIST, ...denyExtra],
        });
        if (diffIndex >= 0) {
          launchArgs[diffIndex + 1] = path.join(packetDir, 'diff.patch');
        }
        if (specIndex >= 0) {
          launchArgs[specIndex + 1] = path.join(packetDir, 'spec.md');
        }
        launchEnv.AUTOPILOT_REVIEW_PACKET_DIR = packetDir;
        launchEnv.AUTOPILOT_REVIEW_PACKET_HASH = autopilotPacket.packet_hash;
      } else {
        for (const flag of ['--diff-file', '--spec-file']) {
          const index = launchArgs.indexOf(flag);
          if (index < 0 || typeof launchArgs[index + 1] !== 'string') continue;
          const source = launchArgs[index + 1];
          const target = path.join(blindCwd, flag.slice(2, -5).replace(/-/g, '.') + '.input');
          fs.copyFileSync(source, target);
          fs.chmodSync(target, 0o600);
          launchArgs[index + 1] = target;
        }
      }
      launchCwd = blindCwd;
      launchEnv.AUTOPILOT_BLIND_DISCOVERY = '1';
    }
    const child = spawnSync(scriptPath, launchArgs, {
      cwd: launchCwd,
      env: launchEnv,
      shell: false,
      stdio: options.stdio || 'inherit',
    });
    child.autopilotLaunchCwd = launchCwd;
    child.autopilotPacket = autopilotPacket;
    return child;
  } catch (error) {
    return { error, status: null, signal: null };
  } finally {
    if (blindCwd) fs.rmSync(blindCwd, { recursive: true, force: true });
  }
}

function dispatchReviewJson(args, options = {}) {
  const child = dispatchReview(args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = bufferToString(child.stdout);
  const stderr = bufferToString(child.stderr);
  const argValue = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && typeof args[index + 1] === 'string' ? args[index + 1] : null;
  };
  const transportEnvelope = createRunnerTransportEnvelope({
    runner: argValue('--runner') || 'unknown',
    model: argValue('--model') || 'unknown',
    operation: 'review',
    argv: args,
    cwd: child.autopilotLaunchCwd || options.cwd || REPO_ROOT,
    child: { ...child, stdout, stderr },
    outcomeHints: options.transportOutcomeHints,
    privateRawReference: options.privateRawReference,
  });

  if (child.error) {
    return {
      error: child.error,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: null,
      parseError: null,
      transportEnvelope,
      packet: null,
    };
  }

  try {
    const built = child.autopilotPacket;
    return {
      error: child.error || null,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: parseReviewOutput(stdout),
      parseError: null,
      transportEnvelope,
      packet: built
        ? {
          packet_hash: built.packet_hash,
          entries_count: built.entries_count,
          denied_paths: built.denied_paths,
        }
        : null,
    };
  } catch (error) {
    const payload = {
      error: child.error || null,
      status: child.status,
      signal: child.signal,
      stdout,
      stderr,
      result: null,
      parseError: error,
      transportEnvelope,
      packet: null,
    };
    try {
      const parsed = JSON.parse(stdout.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          && typeof parsed.raw_log === 'string' && parsed.raw_log.length > 0) {
        payload.salvaged = {
          runner: argValue('--runner'),
          model: argValue('--model'),
          raw_log: parsed.raw_log,
        };
      }
    } catch (_salvageError) {
      // Malformed JSON or a non-object: no salvaged key.
    }
    return payload;
  }
}

module.exports = {
  dispatchReview,
  dispatchReviewJson,
  parseReviewOutput,
  isValidNoFindingProof,
  DISPATCH_REVIEW,
};
