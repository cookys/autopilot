#!/usr/bin/env node
'use strict';

/**
 * check-stall-fuse.js — the verification-spin circuit breaker
 * (autonomous-brain-integration P4; plan: docs/plans/2026-08-17-autonomous-brain-integration.md).
 *
 * Kills sol shapes F5/F10 (verification consumed the run: 5 rounds of whole
 * regeneration, 99.9% of wall time spent re-testing, zero product movement).
 * The accounting unit is the BURST: a bounded stretch of work ending at a round
 * boundary. A burst whose delta contains verification artifacts but ZERO product
 * artifacts is a stall; 3 consecutive stalls trip the fuse — halt and surface in
 * the round-end report. Note the F2 boundary: a mega-batch HAS product delta and
 * is invisible here by design — it is refused pre-spend by the conformance
 * preflight's churn budget, not by this fuse.
 *
 * Product-vs-verification classification (documented heuristic, owned here —
 * diff-scope-report.sh classifies scope-creep, not delta kind):
 *   verification: hooks/tests/**, test/ tests/ __tests__/ segments, *.test.*,
 *                 *.spec.*, evals/**
 *   product:      everything else
 *
 * Scoped-reverify rule (KR4 third leg): re-verifying a FINDING re-runs the
 * finding's surface plus the frozen gate set — a burst declaring
 * reverify.mode="full-suite" for a finding is an IMMEDIATE violation
 * (`scoped_reverify_violation`), independent of the stall counter.
 *
 * Modes:
 *   classify --names <file>
 *     Reads newline-separated changed paths, emits {product_files, verification_files}.
 *   check --bursts <file> [--threshold N]
 *     Bursts file: JSONL rows {burst_id, product_files, verification_files,
 *     reverify?: {mode:"scoped"|"full-suite", finding_id}}.
 *     Emits {tripped, consecutive_zero_product, threshold, violations[]};
 *     exit 1 when tripped or any violation, else 0.
 *
 * Exit: 0 healthy · 1 tripped/violation · 2 usage. Node >= 20.10 built-ins.
 */

const fs = require('fs');

const DEFAULT_THRESHOLD = 3;
const VERIFICATION_PATTERNS = [
  /^hooks\/tests\//u,
  /(^|\/)tests?\//u,
  /(^|\/)__tests__\//u,
  /\.test\.[^/]+$/u,
  /\.spec\.[^/]+$/u,
  /^evals\//u,
];

function usage(message) {
  process.stderr.write(`check-stall-fuse: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const mode = argv[0];
  if (!['classify', 'check'].includes(mode)) usage('mode must be classify|check');
  const opts = { mode, threshold: DEFAULT_THRESHOLD };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--names') opts.names = value;
    else if (arg === '--bursts') opts.bursts = value;
    else if (arg === '--threshold') opts.threshold = Number(value);
    else if (arg === '--strike-identity-file') opts.strikeIdentityFile = value;
    else if (arg === '--strike-store') opts.strikeStore = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (mode === 'classify' && !opts.names) usage('classify requires --names');
  if (mode === 'check' && !opts.bursts) usage('check requires --bursts');
  if (!Number.isInteger(opts.threshold) || opts.threshold < 1) usage('--threshold must be a positive integer');
  // Strike emission (plan 2026-08-17-brain-seat-exam-suite KR3b): check-mode only,
  // both flags or neither — a half-wired emitter is a dead gate, refuse it loudly.
  if ((opts.strikeIdentityFile != null) !== (opts.strikeStore != null)) {
    usage('--strike-identity-file and --strike-store must be given together');
  }
  if (mode !== 'check' && opts.strikeIdentityFile != null) {
    usage('strike flags are check-mode only');
  }
  return opts;
}

function isVerificationPath(candidate) {
  return VERIFICATION_PATTERNS.some((pattern) => pattern.test(candidate));
}

function classify(opts) {
  let raw;
  try {
    raw = fs.readFileSync(opts.names, 'utf8');
  } catch (err) {
    usage(`--names unreadable: ${opts.names}`);
  }
  const names = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const verification = names.filter(isVerificationPath).length;
  process.stdout.write(`${JSON.stringify({
    schema_version: 1,
    product_files: names.length - verification,
    verification_files: verification,
  })}\n`);
}

function check(opts) {
  let raw;
  try {
    raw = fs.readFileSync(opts.bursts, 'utf8');
  } catch (err) {
    usage(`--bursts unreadable: ${opts.bursts}`);
  }
  const bursts = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      bursts.push(JSON.parse(line));
    } catch (err) { /* malformed telemetry rows are skipped, never counted healthy */ }
  }
  const violations = [];
  let consecutive = 0;
  let maxConsecutive = 0;
  for (const burst of bursts) {
    if (burst.reverify && burst.reverify.mode === 'full-suite') {
      violations.push({
        code: 'scoped_reverify_violation',
        burst_id: burst.burst_id,
        detail: `finding re-verify ran full-suite (finding ${burst.reverify.finding_id || '?'}) — re-verify is scoped to the finding's surface + frozen gate set`,
      });
    }
    const product = Number(burst.product_files) || 0;
    const verification = Number(burst.verification_files) || 0;
    if (product === 0 && verification >= 0) consecutive += 1;
    else consecutive = 0;
    if (consecutive > maxConsecutive) maxConsecutive = consecutive;
  }
  const tripped = maxConsecutive >= opts.threshold;
  const result = {
    schema_version: 1,
    artifact_type: 'stall_fuse_result',
    tripped,
    consecutive_zero_product: maxConsecutive,
    threshold: opts.threshold,
    violations,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const failing = tripped || violations.length > 0;
  if (failing && opts.strikeIdentityFile) {
    // Fail closed: a trip that cannot be recorded as a strike must not exit as a
    // plain trip — the revocation ledger is load-bearing (KR3b).
    try {
      const crypto = require('crypto');
      const state = require('./engine-capability-state');
      const identity = JSON.parse(fs.readFileSync(opts.strikeIdentityFile, 'utf8'));
      const receiptRef = `fuse-${crypto.createHash('sha256')
        .update(JSON.stringify(result)).digest('hex').slice(0, 16)}`;
      const row = state.appendStrikeRecord(
        state.resolveStoreConfig({ store: opts.strikeStore }),
        { identity, source: 'fuse', receiptRef },
      );
      process.stderr.write(`check-stall-fuse: strike ${row.event_id} appended for ${row.identity_hash.slice(0, 12)}\n`);
    } catch (err) {
      process.stderr.write(`check-stall-fuse: strike append failed closed: ${err.message}\n`);
      process.exit(2);
    }
  }
  process.exit(failing ? 1 : 0);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.mode === 'classify') classify(opts);
  else check(opts);
}

main();
