#!/usr/bin/env node
'use strict';

/**
 * check-stall-fuse.js — the verification-spin circuit breaker
 * (autonomous-brain-integration P4; plan: docs/plans/_archive/2026/08/2026-08-17-autonomous-brain-integration.md).
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
 * Process-document class (BL-0309 gap 2, additive): a PROCESS path is planning
 * paper that moves no product — docs/plans/**, docs/projects/**, docs/backlog/**,
 * docs/BACKLOG.md, docs/adr/**. Process paths stay inside product_files (the
 * product/verification split above is unchanged); classify additionally emits
 * process_files (the subset of product_files that are process paths). A burst
 * is PROCESS-ONLY when product_files > 0, process_files >= product_files and it
 * did not land (integrated !== true: no merge, no push). check counts consecutive
 * process-only bursts; DEFAULT_PROCESS_THRESHOLD (3, same reasoning as the
 * verification threshold: one plan burst is normal, three in a row with nothing
 * landed is planning-without-shipping) trips process_only_tripped and exits 1.
 * Rows without a process_files field are never process-only, so every existing
 * bursts file keeps its verdict. Any burst with real product delta, or with
 * integrated:true, resets the process streak; a zero-product burst also resets it
 * (that shape belongs to the verification fuse).
 *
 * Scoped-reverify rule (KR4 third leg): re-verifying a FINDING re-runs the
 * finding's surface plus the frozen gate set — a burst declaring
 * reverify.mode="full-suite" for a finding is an IMMEDIATE violation
 * (`scoped_reverify_violation`), independent of the stall counter.
 *
 * Modes:
 *   classify --names <file>
 *     Reads newline-separated changed paths, emits {product_files, verification_files, process_files}.
 *     Mechanical row writing (BL-0309 gap 2): with --burst-id <id> --append <bursts.jsonl> classify itself appends
 *     the full row {burst_id, product_files, verification_files, process_files, integrated?} so no caller hand-copies
 *     fields. --burst-base <sha> [--integration-ref <ref>] decides `integrated`: the burst range is
 *     <burst-base>..HEAD; it is integrated when that range is non-empty and at least one of its commits is reachable
 *     from the integration ref (default origin/develop, else develop) — a merge or push of the burst makes its
 *     commits reachable there, while a burst of unmerged local commits stays false. An unresolvable ref or base
 *     yields integrated:false (the safe side: the process-only streak keeps counting). --append requires --burst-id
 *     and --burst-base (usage error, exit 2, nothing written), so every appended row carries integrated.
 *     Stdout gains `integrated` only when --burst-base is given; without it the field is absent.
 *   check --bursts <file> [--threshold N] [--process-threshold N]
 *     Bursts file: JSONL rows {burst_id, product_files, verification_files,
 *     reverify?: {mode:"scoped"|"full-suite", finding_id}}.
 *     Emits {tripped, consecutive_zero_product, threshold, violations[]};
 *     exit 1 when tripped or any violation, else 0.
 *
 * Exit: 0 healthy · 1 tripped/violation · 2 usage. Node >= 20.10 built-ins.
 */

const fs = require('fs');

const DEFAULT_THRESHOLD = 3;
const DEFAULT_PROCESS_THRESHOLD = 3;
const PROCESS_PATTERNS = [
  /^docs\/plans\//u,
  /^docs\/projects\//u,
  /^docs\/backlog\//u,
  /^docs\/BACKLOG\.md$/u,
  /^docs\/adr\//u,
];
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
  const opts = { mode, threshold: DEFAULT_THRESHOLD, processThreshold: DEFAULT_PROCESS_THRESHOLD };
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (value === undefined) usage(`${arg} needs a value`);
    if (arg === '--names') opts.names = value;
    else if (arg === '--bursts') opts.bursts = value;
    else if (arg === '--threshold') opts.threshold = Number(value);
    else if (arg === '--burst-id') opts.burstId = value;
    else if (arg === '--append') opts.append = value;
    else if (arg === '--burst-base') opts.burstBase = value;
    else if (arg === '--integration-ref') opts.integrationRef = value;
    else if (arg === '--process-threshold') opts.processThreshold = Number(value);
    else if (arg === '--strike-identity-file') opts.strikeIdentityFile = value;
    else if (arg === '--strike-store') opts.strikeStore = value;
    else usage(`unknown argument: ${arg}`);
    i += 1;
  }
  if (opts.append && !opts.burstId) usage('--append requires --burst-id');
  if (opts.append && !opts.burstBase) usage('--append requires --burst-base (every appended row carries integrated)');
  if (opts.integrationRef && !opts.burstBase) usage('--integration-ref requires --burst-base');
  if (mode !== 'classify' && (opts.append || opts.burstId || opts.burstBase)) usage('burst-row flags are classify-mode only');
  if (mode === 'classify' && !opts.names) usage('classify requires --names');
  if (mode === 'check' && !opts.bursts) usage('check requires --bursts');
  if (!Number.isInteger(opts.threshold) || opts.threshold < 1) usage('--threshold must be a positive integer');
  if (!Number.isInteger(opts.processThreshold) || opts.processThreshold < 1) usage('--process-threshold must be a positive integer');
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

function isProcessPath(candidate) {
  return !isVerificationPath(candidate) && PROCESS_PATTERNS.some((pattern) => pattern.test(candidate));
}

function git(args) {
  const r = require('child_process').spawnSync('git', args, { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function decideIntegrated(opts) {
  const ref = opts.integrationRef
    || (git(['rev-parse', '--verify', '--quiet', 'origin/develop']) !== null ? 'origin/develop' : 'develop');
  const all = git(['rev-list', `${opts.burstBase}..HEAD`]);
  const outside = git(['rev-list', `${opts.burstBase}..HEAD`, '--not', ref]);
  if (all === null || outside === null) return false;
  const total = all ? all.split('\n').length : 0;
  const notIn = outside ? outside.split('\n').length : 0;
  return total > 0 && notIn < total;
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
  const out = {
    schema_version: 1,
    product_files: names.length - verification,
    verification_files: verification,
    process_files: names.filter(isProcessPath).length,
  };
  const integrated = opts.burstBase ? decideIntegrated(opts) : undefined;
  if (integrated !== undefined) out.integrated = integrated;
  process.stdout.write(`${JSON.stringify(out)}\n`);
  if (opts.append) {
    const row = {
      burst_id: opts.burstId,
      product_files: out.product_files,
      verification_files: out.verification_files,
      process_files: out.process_files,
      integrated,
    };
    try {
      fs.appendFileSync(opts.append, `${JSON.stringify(row)}\n`);
    } catch (err) {
      usage(`--append not writable: ${opts.append}`);
    }
  }
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
  let processStreak = 0;
  let maxProcessStreak = 0;
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
    const processFiles = Number(burst.process_files) || 0;
    const processOnly = product > 0 && processFiles >= product && burst.integrated !== true;
    processStreak = processOnly ? processStreak + 1 : 0;
    if (processStreak > maxProcessStreak) maxProcessStreak = processStreak;
  }
  const tripped = maxConsecutive >= opts.threshold;
  const processOnlyTripped = maxProcessStreak >= opts.processThreshold;
  const result = {
    schema_version: 1,
    artifact_type: 'stall_fuse_result',
    tripped,
    consecutive_zero_product: maxConsecutive,
    threshold: opts.threshold,
    consecutive_process_only: maxProcessStreak,
    process_threshold: opts.processThreshold,
    process_only_tripped: processOnlyTripped,
    violations,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  const failing = tripped || processOnlyTripped || violations.length > 0;
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
