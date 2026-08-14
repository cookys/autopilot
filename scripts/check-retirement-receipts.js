#!/usr/bin/env node
'use strict';

/**
 * check-retirement-receipts.js — every removal from a governed path must carry an
 * executable receipt.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Owner Kernel project's own 2026-07-20 Decision Log recorded the root cause of its
 * KR10 failure in one line: "the plan's deletions are prose, its additions are executed
 * modules". Additions arrive with tests, gates and receipts. Removals arrived as intent —
 * a sentence in a plan saying something would be retired, with nothing mechanical to
 * check whether it was, or whether the thing replacing it worked.
 *
 * That asymmetry is what let a project accumulate ~31,000 lines while deleting nothing,
 * then fail a gate that counted executed modules. This script closes it: a removal is a
 * claim, and a claim needs evidence.
 *
 * WHAT IT IS NOT
 * --------------
 * It is not a ban on deleting things. It asks one question — what replaced this, and what
 * proves the replacement works — and refuses to let the answer be silence.
 *
 * REGIME START
 * ------------
 * Receipts are required for removals made AFTER the regime start below. History is not
 * backfilled: demanding receipts for deletions made before the rule existed would produce
 * a wall of retroactive paperwork with no evidentiary value, and the usual response to
 * that is to disable the check.
 *
 * USAGE
 *   node scripts/check-retirement-receipts.js [--base <ref>] [--head <ref>]
 *                                             [--check] [--run-evidence] [--json]
 *
 *   --base <ref>      commit to diff from (default: the regime start)
 *   --head <ref>      commit to diff to (default: HEAD)
 *   --check           exit non-zero when any removal is unreceipted or a receipt is invalid
 *   --run-evidence    actually execute each receipt's named evidence, not just check it exists
 *   --json            machine-readable report on stdout
 *
 * EXIT CODES
 *   0  all governed removals in range are receipted (or --check not given)
 *   1  --check and at least one removal is unreceipted / a receipt is invalid
 *   2  usage or git error
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RECEIPTS_DIR = path.join(REPO_ROOT, 'docs', 'retirement-receipts');

/**
 * Removals before this commit predate the rule and need no receipt.
 * Set once, when the regime was introduced; moving it forward would silently forgive
 * everything in between, so treat a change here as a policy change, not a fix.
 */
const REGIME_START = '8dd70f0e15a35d6a846ea9cc362fe2cfa490876f';

/** Paths where a removal is load-bearing enough to need an answer. */
const GOVERNED_PREFIXES = Object.freeze(['src/engine/', 'skills/', 'scripts/']);

/** Generated mirrors follow their canonical source; receipting both is noise. */
const EXEMPT_PREFIXES = Object.freeze(['platforms/codex/plugin/']);

const REQUIRED_FIELDS = Object.freeze(['removed', 'replaced_by', 'evidence', 'commit', 'reason']);

function fail(message, code = 2) {
  process.stderr.write(`check-retirement-receipts: ${message}\n`);
  process.exit(code);
}

function git(args) {
  const result = spawnSync('git', ['-C', REPO_ROOT, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) fail(`git ${args[0]} failed: ${result.error.message}`);
  return result;
}

function parseArgs(argv) {
  const options = {
    base: REGIME_START, head: 'HEAD', check: false, runEvidence: false, json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(`${fs.readFileSync(__filename, 'utf8').split('\n').slice(4, 47).join('\n')}\n`);
      process.exit(0);
    } else if (arg === '--check') options.check = true;
    else if (arg === '--run-evidence') options.runEvidence = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--base' || arg === '--head') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) fail(`missing value for ${arg}`);
      options[arg === '--base' ? 'base' : 'head'] = value;
      i += 1;
    } else fail(`unknown argument: ${arg}`);
  }
  return options;
}

function isGoverned(relPath) {
  const p = relPath.replace(/\\/g, '/');
  if (EXEMPT_PREFIXES.some((prefix) => p.startsWith(prefix))) return false;
  return GOVERNED_PREFIXES.some((prefix) => p.startsWith(prefix));
}

/**
 * Removals in range, with renames resolved.
 *
 * `-M` matters: a rename is a move, not a retirement. Without it, every file that changed
 * directory would demand a receipt explaining its own disappearance, which is paperwork
 * rather than evidence — and the resulting noise is what gets a gate switched off.
 */
function removalsInRange(base, head) {
  const result = git(['diff', '--diff-filter=D', '--name-only', '-M', '--find-renames=40%', `${base}..${head}`]);
  if (result.status !== 0) {
    fail(`git diff ${base}..${head} failed: ${(result.stderr || '').trim()}`);
  }
  return (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(isGoverned);
}

function loadReceipts() {
  const receipts = [];
  const problems = [];
  if (!fs.existsSync(RECEIPTS_DIR)) return { receipts, problems };
  for (const entry of fs.readdirSync(RECEIPTS_DIR).sort()) {
    if (!entry.endsWith('.json')) continue;
    const filePath = path.join(RECEIPTS_DIR, entry);
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      problems.push({ receipt: entry, problem: `unparseable JSON: ${error.message}` });
      continue;
    }
    const missing = REQUIRED_FIELDS.filter((field) => !(field in parsed));
    if (missing.length > 0) {
      problems.push({ receipt: entry, problem: `missing required field(s): ${missing.join(', ')}` });
      continue;
    }
    if (typeof parsed.removed !== 'string' || parsed.removed.length === 0) {
      problems.push({ receipt: entry, problem: 'removed must be a non-empty path' });
      continue;
    }
    // `replaced_by` may be null (a genuine deletion with nothing taking its place), but
    // `evidence` may never be: something must still prove the removal was safe.
    if (typeof parsed.evidence !== 'string' || parsed.evidence.length === 0) {
      problems.push({ receipt: entry, problem: 'evidence must name a test or gate' });
      continue;
    }
    receipts.push({ ...parsed, receipt_file: `docs/retirement-receipts/${entry}` });
  }
  return { receipts, problems };
}

function evidenceStatus(receipt, runEvidence) {
  const evidencePath = path.join(REPO_ROOT, receipt.evidence.split(/\s+/)[0]);
  if (!fs.existsSync(evidencePath)) {
    return { ok: false, detail: `named evidence does not exist: ${receipt.evidence}` };
  }
  if (!runEvidence) return { ok: true, detail: 'exists (not executed; pass --run-evidence)' };

  const isShell = receipt.evidence.endsWith('.sh');
  const command = isShell ? 'bash' : 'node';
  const result = spawnSync(command, receipt.evidence.split(/\s+/), {
    cwd: REPO_ROOT, encoding: 'utf8', timeout: 900_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    return { ok: false, detail: `evidence failed (exit ${result.status}): ${receipt.evidence}` };
  }
  return { ok: true, detail: 'executed and passed' };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const removals = removalsInRange(options.base, options.head);
  const { receipts, problems } = loadReceipts();

  const byRemoved = new Map();
  for (const receipt of receipts) byRemoved.set(receipt.removed.replace(/\\/g, '/'), receipt);

  const findings = [];
  for (const removed of removals) {
    const receipt = byRemoved.get(removed);
    if (!receipt) {
      findings.push({
        removed,
        status: 'UNRECEIPTED',
        detail: 'a governed path was removed with no retirement receipt; '
          + 'add one under docs/retirement-receipts/ naming what replaced it and what proves it',
      });
      continue;
    }
    const evidence = evidenceStatus(receipt, options.runEvidence);
    findings.push({
      removed,
      status: evidence.ok ? 'RECEIPTED' : 'INVALID_EVIDENCE',
      receipt_file: receipt.receipt_file,
      replaced_by: receipt.replaced_by,
      evidence: receipt.evidence,
      detail: evidence.detail,
    });
  }

  const blocking = findings.filter((f) => f.status !== 'RECEIPTED');
  const report = {
    schema_version: 1,
    base: options.base,
    head: options.head,
    regime_start: REGIME_START,
    governed_prefixes: GOVERNED_PREFIXES,
    removals_examined: removals.length,
    receipts_loaded: receipts.length,
    receipt_problems: problems,
    findings,
    ok: blocking.length === 0 && problems.length === 0,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`retirement receipts — ${options.base.slice(0, 8)}..${options.head}\n`);
    process.stdout.write(`  governed removals examined: ${removals.length}\n`);
    process.stdout.write(`  receipts on file: ${receipts.length}\n`);
    for (const problem of problems) {
      process.stdout.write(`  ✗ ${problem.receipt}: ${problem.problem}\n`);
    }
    for (const finding of findings) {
      const mark = finding.status === 'RECEIPTED' ? '✓' : '✗';
      process.stdout.write(`  ${mark} ${finding.removed} — ${finding.status}\n`);
      if (finding.status !== 'RECEIPTED') process.stdout.write(`      ${finding.detail}\n`);
    }
    process.stdout.write(report.ok ? '  all governed removals are receipted\n' : '  UNRECEIPTED REMOVALS PRESENT\n');
  }

  if (options.check && !report.ok) process.exitCode = 1;
}

main();
