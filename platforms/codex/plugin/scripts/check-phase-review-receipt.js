#!/usr/bin/env node
/**
 * check-phase-review-receipt.js — validate review phase receipts or plan-artifact dispositions.
 *
 * Mode A: receipt validation
 *   Flags: --ledger <dir> --phase <id> --branch <b> [--repo-root <r>]
 *   Validates <ledger>/receipt-<phase>.json against git history and review artifacts.
 *
 * Mode B: plan-artifact / dispositions validation
 *   Flags: --plan-artifact <gN.json> --dispositions <gN-disposition.json>
 *   Validates that all candidate blockers have valid accepted/rejected dispositions.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const deriveReceiptState = require('./lib/review-chain-derive');

const EXCLUDE_ALLOWLIST = [
  'platforms/**',
  'profiles/*.json',
  'docs/projects/**',
  'docs/plans/evidence/**',
  'docs/BACKLOG.md',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Gemfile.lock',
  'Cargo.lock',
  'composer.lock',
  'poetry.lock',
  'flake.lock',
  '*.lock',
  '**/*.lock',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',
  'lockfiles',
  'generated/**',
];

function isPathspecAllowed(pathspec) {
  const normalized = pathspec.trim();
  if (EXCLUDE_ALLOWLIST.includes(normalized)) {
    return true;
  }
  for (const pattern of EXCLUDE_ALLOWLIST) {
    if (pattern === normalized) return true;
    if (pattern.endsWith('/**')) {
      const prefix = pattern.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(prefix + '/')) return true;
    }
  }
  return false;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

function printUsage() {
  console.log(`Usage:
  Mode A (Receipt validation):
    node scripts/check-phase-review-receipt.js --ledger <dir> --phase <id> --branch <b> --phase-base <sha> [--repo-root <r>]

  Mode B (Plan-artifact / dispositions validation):
    node scripts/check-phase-review-receipt.js --plan-artifact <gN.json> --dispositions <gN-disp.json> [--plan-file <p>] [--rubric-file <r>]

Flags:
  --ledger <dir>                    Ledger directory containing receipts
  --phase <id>                      Phase identifier
  --branch <b>                      Git branch name
  --phase-base <sha>                Expected phase base commit sha (mandatory for review mode)
  --repo-root <r>                   Path to repository root (defaults to cwd)
  --plan-artifact <gN.json>         Plan artifact JSON file
  --dispositions <gN-disp.json>     Dispositions JSON file
  --plan-file <file>                Plan markdown file (optional, resolved automatically if omitted)
  --rubric-file <file>              Rubric markdown file (optional, resolved automatically if omitted)
  --min-reviewed-seats <n>          Minimum reviewed seats required per generation
  --help, -h                        Show this help message and exit 0

Chain rules (Mode A): every chain entry must be 'finalized' except an 'aborted' one (hetero-review-loop
wrote it when the branch moved during collection or a seat's findings failed to parse). An aborted entry
is accepted only as a recorded non-review: it must not be the last entry, it carries no head, the next
generation continues from its base, and its range.json (if present) names that base. It contributes no
findings and closes none (review-chain-derive skips it). v2.36.3.
`);
}

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      flags.help = true;
    } else if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        flags[key] = argv[i + 1];
        i++;
      } else {
        flags[key] = true;
      }
    }
  }
  return flags;
}

function runResolverField(resolverPath, repoRoot, fieldName) {
  try {
    const args = ['--field', fieldName];
    if (repoRoot) {
      args.push('--repo-root', repoRoot);
    }
    const res = spawnSync(resolverPath, args, {
      encoding: 'utf8',
      cwd: repoRoot || process.cwd(),
      env: { ...process.env },
    });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim();
    }
    return '';
  } catch (_e) {
    return '';
  }
}

function resolvePlanFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, repoRoot) {
  const explicit = flags['plan-file'] || flags['plan_file'] || flags.plan || flags['plan-path'] || flags['plan_path']
    || planArtifact.plan_path || planArtifact.plan_file || planArtifact.planFile
    || dispositions.plan_path || dispositions.plan_file || dispositions.planFile;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }
  const id = planArtifact.logical_plan_id;
  if (id) {
    const candidates = [
      path.join(repoRoot, 'docs', 'plans', `${id}.md`),
      path.join(repoRoot, `${id}.md`),
      path.join(path.dirname(planArtifactPath), `${id}.md`),
      path.join(path.dirname(planArtifactPath), 'plan.md'),
      path.join(path.dirname(dispositionsPath), `${id}.md`),
      path.join(path.dirname(dispositionsPath), 'plan.md'),
    ];
    const mSuff = id.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (mSuff) {
      candidates.push(path.join(repoRoot, 'docs', 'plans', `${mSuff[2]}-${mSuff[1]}.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mSuff[2]}-${mSuff[1]}.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mSuff[2]}-${mSuff[1]}.md`));
    }
    const mPref = id.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (mPref) {
      candidates.push(path.join(repoRoot, 'docs', 'plans', `${mPref[2]}-${mPref[1]}.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mPref[2]}-${mPref[1]}.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mPref[2]}-${mPref[1]}.md`));
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  if (planArtifact.plan_sha256) {
    const searchDirs = [path.dirname(planArtifactPath), path.dirname(dispositionsPath), path.join(repoRoot, 'docs', 'plans')];
    for (const d of searchDirs) {
      try {
        if (!fs.existsSync(d)) continue;
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (file.endsWith('.md') && !file.endsWith('.rubric.md')) {
            const full = path.join(d, file);
            const bytes = fs.readFileSync(full);
            if (crypto.createHash('sha256').update(bytes).digest('hex') === planArtifact.plan_sha256) {
              return full;
            }
          }
        }
      } catch (_e) {}
    }
  }
  return null;
}

function resolveRubricFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, planFilePath, repoRoot) {
  const explicit = flags['rubric-file'] || flags['rubric_file'] || flags.rubric || flags['rubric-path'] || flags['rubric_path']
    || planArtifact.rubric_path || planArtifact.rubric_file || planArtifact.rubricFile
    || dispositions.rubric_path || dispositions.rubric_file || dispositions.rubricFile;
  if (explicit) {
    const resolved = path.isAbsolute(explicit) ? explicit : path.resolve(repoRoot, explicit);
    if (fs.existsSync(resolved)) return resolved;
  }
  if (planFilePath) {
    const parsed = path.parse(planFilePath);
    const cand = path.join(parsed.dir, `${parsed.name}.rubric.md`);
    if (fs.existsSync(cand)) return cand;
  }
  const id = planArtifact.logical_plan_id;
  if (id) {
    const candidates = [
      path.join(repoRoot, 'docs', 'plans', `${id}.rubric.md`),
      path.join(repoRoot, `${id}.rubric.md`),
      path.join(path.dirname(planArtifactPath), `${id}.rubric.md`),
      path.join(path.dirname(planArtifactPath), 'rubric.md'),
      path.join(path.dirname(dispositionsPath), `${id}.rubric.md`),
      path.join(path.dirname(dispositionsPath), 'rubric.md'),
    ];
    const mSuff = id.match(/^(.+)-(\d{4}-\d{2}-\d{2})$/);
    if (mSuff) {
      candidates.push(path.join(repoRoot, 'docs', 'plans', `${mSuff[2]}-${mSuff[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mSuff[2]}-${mSuff[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mSuff[2]}-${mSuff[1]}.rubric.md`));
    }
    const mPref = id.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
    if (mPref) {
      candidates.push(path.join(repoRoot, 'docs', 'plans', `${mPref[2]}-${mPref[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(planArtifactPath), `${mPref[2]}-${mPref[1]}.rubric.md`));
      candidates.push(path.join(path.dirname(dispositionsPath), `${mPref[2]}-${mPref[1]}.rubric.md`));
    }
    for (const cand of candidates) {
      if (fs.existsSync(cand)) return cand;
    }
  }
  if (planArtifact.rubric_sha256) {
    const searchDirs = [path.dirname(planArtifactPath), path.dirname(dispositionsPath), path.join(repoRoot, 'docs', 'plans'), path.join(repoRoot, 'evals')];
    for (const d of searchDirs) {
      try {
        if (!fs.existsSync(d)) continue;
        const files = fs.readdirSync(d);
        for (const file of files) {
          if (file.endsWith('.md')) {
            const full = path.join(d, file);
            const bytes = fs.readFileSync(full);
            if (crypto.createHash('sha256').update(bytes).digest('hex') === planArtifact.rubric_sha256) {
              return full;
            }
          }
        }
      } catch (_e) {}
    }
  }
  return null;
}

function validateModeB(flags) {
  const planArtifactPath = flags['plan-artifact'];
  const dispositionsPath = flags.dispositions;
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();

  let planArtifact;
  try {
    const content = fs.readFileSync(planArtifactPath, 'utf8');
    planArtifact = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read or parse plan-artifact: ${err.message}`);
    process.exit(1);
  }

  let dispositions;
  try {
    const content = fs.readFileSync(dispositionsPath, 'utf8');
    dispositions = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read or parse dispositions: ${err.message}`);
    process.exit(1);
  }

  if (!planArtifact || typeof planArtifact !== 'object' || Array.isArray(planArtifact)) {
    console.error('Plan artifact must parse as a JSON object');
    process.exit(1);
  }

  if (!dispositions || typeof dispositions !== 'object' || Array.isArray(dispositions)) {
    console.error('Dispositions must parse as a JSON object');
    process.exit(1);
  }

  // Canonical plan_review_artifact shape:
  // artifact_type, logical_plan_id, generation, plan_sha256, rubric_sha256
  if (planArtifact.artifact_type !== 'plan_review_artifact') {
    console.error(`Invalid or missing artifact_type in plan-artifact: expected 'plan_review_artifact', got '${planArtifact.artifact_type}'`);
    process.exit(1);
  }

  if (typeof planArtifact.logical_plan_id !== 'string' || planArtifact.logical_plan_id.trim().length === 0) {
    console.error('Missing or invalid logical_plan_id in plan-artifact');
    process.exit(1);
  }

  if (typeof planArtifact.generation !== 'number' || !Number.isInteger(planArtifact.generation)) {
    console.error('Missing or invalid generation in plan-artifact');
    process.exit(1);
  }

  const sha256Regex = /^[0-9a-f]{64}$/i;
  if (typeof planArtifact.plan_sha256 !== 'string' || !sha256Regex.test(planArtifact.plan_sha256)) {
    console.error('Missing or invalid plan_sha256 in plan-artifact');
    process.exit(1);
  }

  if (typeof planArtifact.rubric_sha256 !== 'string' || !sha256Regex.test(planArtifact.rubric_sha256)) {
    console.error('Missing or invalid rubric_sha256 in plan-artifact');
    process.exit(1);
  }

  if (!Array.isArray(planArtifact.findings)) {
    console.error('Plan artifact must contain a findings array');
    process.exit(1);
  }

  // Dispositions file identity match:
  // logical_plan_id and generation must match artifact
  if (typeof dispositions.logical_plan_id !== 'string' || dispositions.logical_plan_id !== planArtifact.logical_plan_id) {
    console.error(`Dispositions logical_plan_id mismatch: expected '${planArtifact.logical_plan_id}', got '${dispositions.logical_plan_id}'`);
    process.exit(1);
  }

  if (dispositions.generation !== planArtifact.generation) {
    console.error(`Dispositions generation mismatch: expected ${planArtifact.generation}, got ${dispositions.generation}`);
    process.exit(1);
  }

  if (!Array.isArray(dispositions.findings)) {
    console.error('Dispositions must contain a findings array');
    process.exit(1);
  }

  // Verify actual plan file and rubric file on disk
  const planFile = resolvePlanFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, repoRoot);
  if (!planFile || !fs.existsSync(planFile)) {
    console.error(`Cannot find plan file on disk for logical_plan_id '${planArtifact.logical_plan_id}'`);
    process.exit(1);
  }

  let planBytes;
  try {
    planBytes = fs.readFileSync(planFile);
  } catch (err) {
    console.error(`Failed to read plan file at ${planFile}: ${err.message}`);
    process.exit(1);
  }
  const computedPlanSha = crypto.createHash('sha256').update(planBytes).digest('hex');
  if (computedPlanSha !== planArtifact.plan_sha256) {
    console.error(`Plan file sha256 mismatch: expected '${planArtifact.plan_sha256}', computed '${computedPlanSha}'`);
    process.exit(1);
  }

  const rubricFile = resolveRubricFile(flags, planArtifact, dispositions, planArtifactPath, dispositionsPath, planFile, repoRoot);
  if (!rubricFile || !fs.existsSync(rubricFile)) {
    console.error(`Cannot find rubric file on disk for logical_plan_id '${planArtifact.logical_plan_id}'`);
    process.exit(1);
  }

  let rubricBytes;
  try {
    rubricBytes = fs.readFileSync(rubricFile);
  } catch (err) {
    console.error(`Failed to read rubric file at ${rubricFile}: ${err.message}`);
    process.exit(1);
  }
  const computedRubricSha = crypto.createHash('sha256').update(rubricBytes).digest('hex');
  if (computedRubricSha !== planArtifact.rubric_sha256) {
    console.error(`Rubric file sha256 mismatch: expected '${planArtifact.rubric_sha256}', computed '${computedRubricSha}'`);
    process.exit(1);
  }

  const allowedDispositions = new Set([
    'accepted_blocker',
    'accepted_nonblocking',
    'rejected',
    'duplicate',
    'deferred',
    'verified',
    'refuted',
  ]);

  function validateFindingObj(f, sourceName) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) {
      console.error(`Finding in ${sourceName} is not an object`);
      process.exit(1);
    }
    const idVal = f.fingerprint !== undefined ? f.fingerprint : f.id;
    if (typeof idVal !== 'string' || idVal.trim().length === 0) {
      console.error(`Finding in ${sourceName} missing valid string id/fingerprint`);
      process.exit(1);
    }
    if (typeof f.candidate_blocker !== 'boolean') {
      console.error(`Finding '${idVal}' in ${sourceName} candidate_blocker is mandatory and must be a boolean`);
      process.exit(1);
    }
    if (typeof f.disposition !== 'string' || !allowedDispositions.has(f.disposition)) {
      console.error(`Finding '${idVal}' in ${sourceName} invalid disposition '${f.disposition}'`);
      process.exit(1);
    }
    return idVal;
  }

  // Validate each finding object in planArtifact & check duplicates
  const artifactFindingMap = new Map();
  for (const f of planArtifact.findings) {
    const id = validateFindingObj(f, 'plan artifact');
    if (artifactFindingMap.has(id)) {
      console.error(`Duplicate finding id in plan-artifact: '${id}'`);
      process.exit(1);
    }
    artifactFindingMap.set(id, f);
  }

  // Validate each finding object in dispositions & check duplicates
  const dispMap = new Map();
  for (const f of dispositions.findings) {
    const id = validateFindingObj(f, 'dispositions');
    if (dispMap.has(id)) {
      console.error(`Duplicate finding id in dispositions: '${id}'`);
      process.exit(1);
    }
    dispMap.set(id, f);
  }

  // Require exact one-to-one disposition coverage: every finding id in the artifact
  // has exactly one disposition, no extras, no duplicates
  for (const id of artifactFindingMap.keys()) {
    if (!dispMap.has(id)) {
      console.error(`Finding '${id}' in plan-artifact missing in dispositions`);
      process.exit(1);
    }
  }

  for (const id of dispMap.keys()) {
    if (!artifactFindingMap.has(id)) {
      console.error(`Dispositions contains unexpected finding id '${id}' not in plan-artifact`);
      process.exit(1);
    }
  }

  // 'rejected' is a valid disposition for both blocker and non-blocker findings — only
  // 'accepted_blocker' is exclusive to candidate_blocker=true findings.
  const blockerValidDispositions = new Set(['accepted_blocker', 'rejected']);
  const blockerExclusiveDispositions = new Set(['accepted_blocker']);
  const rationaleRequiredDispositions = new Set(['accepted_blocker', 'rejected']);
  const failingFindings = [];

  for (const finding of planArtifact.findings) {
    if (!finding) {
      continue;
    }
    const id = finding.fingerprint !== undefined ? finding.fingerprint : finding.id;
    const disp = dispMap.get(id);
    if (!disp) {
      failingFindings.push(`Finding '${id}': missing in dispositions`);
      continue;
    }
    const disposition = disp.disposition;

    if (finding.candidate_blocker === true) {
      if (!blockerValidDispositions.has(disposition)) {
        failingFindings.push(
          `Finding '${id}': invalid disposition '${disposition}' (candidate_blocker=true requires 'accepted_blocker' or 'rejected')`
        );
        continue;
      }
    } else {
      // d2-plan-candidate-blocker-fail-open: a non-blocker finding's disposition class must
      // match — it must NOT be disposed with a blocker-exclusive disposition, which would let a
      // finding evade the blocker-specific checks above by simply mislabelling itself.
      // 'rejected' is NOT blocker-exclusive: a non-blocker finding may legitimately be rejected.
      if (blockerExclusiveDispositions.has(disposition)) {
        failingFindings.push(
          `Finding '${id}': disposition '${disposition}' is blocker-exclusive but candidate_blocker=false`
        );
        continue;
      }
    }

    if (rationaleRequiredDispositions.has(disposition)) {
      const rationale = typeof disp.rationale === 'string' ? disp.rationale.trim() : '';
      if (!rationale) {
        failingFindings.push(`Finding '${id}': rationale must be a non-empty string`);
        continue;
      }
    }
  }

  if (failingFindings.length > 0) {
    for (const failMsg of failingFindings) {
      console.error(failMsg);
    }
    process.exit(1);
  }

  process.exit(0);
}

const CANONICAL_POSITIVE_INT_RE = /^[1-9][0-9]*$/;

// Item 2 / d2-seat-receipt-forgery: the minimum reviewed-seat count is taken ONLY from
// trusted configuration (a CLI flag or an environment variable) — never from the receipt
// under test, which would otherwise let a forger ship its own passing threshold alongside
// the forged evidence. With no configuration supplied, the default is "all seats".
// The configured value, when present, must be a canonical positive integer string
// (no leading zeros, no sign, no trailing junk) — parseInt() alone would silently accept
// '3x' as 3 or '-1' as -1, so this is validated up front, before any generation validation.
function resolveConfiguredMinSeats(flags) {
  let raw;
  let source;
  if (flags['min-reviewed-seats'] !== undefined) {
    raw = flags['min-reviewed-seats'];
    source = '--min-reviewed-seats';
  } else if (flags['min-seats'] !== undefined) {
    raw = flags['min-seats'];
    source = '--min-seats';
  } else if (flags['min_reviewed_seats'] !== undefined) {
    raw = flags['min_reviewed_seats'];
    source = '--min_reviewed_seats';
  } else if (process.env.AUTOPILOT_MIN_REVIEWED_SEATS !== undefined) {
    raw = process.env.AUTOPILOT_MIN_REVIEWED_SEATS;
    source = 'AUTOPILOT_MIN_REVIEWED_SEATS';
  } else {
    return null;
  }

  const str = typeof raw === 'string' ? raw : String(raw);
  if (!CANONICAL_POSITIVE_INT_RE.test(str)) {
    console.error(`Invalid ${source} value '${raw}': must be a canonical positive integer (e.g. '1', '2', '3'; no zero, negatives, signs, decimals, or trailing characters)`);
    process.exit(1);
  }
  return parseInt(str, 10);
}

function validateModeA(flags) {
  // Validated first, before any generation/chain validation runs — see resolveConfiguredMinSeats.
  const configuredMinSeats = resolveConfiguredMinSeats(flags);

  const ledgerDir = flags.ledger;
  const phase = flags.phase;
  const branch = flags.branch;
  const repoRoot = flags['repo-root'] ? path.resolve(flags['repo-root']) : process.cwd();

  if (!ledgerDir || !phase || !branch) {
    console.error('Mode A requires --ledger, --phase, and --branch');
    process.exit(1);
  }

  const receiptPath = path.join(ledgerDir, `receipt-${phase}.json`);
  let receipt;
  try {
    if (!fs.existsSync(receiptPath)) {
      console.error(`Receipt file not found: ${receiptPath}`);
      process.exit(1);
    }
    const content = fs.readFileSync(receiptPath, 'utf8');
    receipt = JSON.parse(content);
  } catch (err) {
    console.error(`Failed to read or parse receipt file: ${err.message}`);
    process.exit(1);
  }

  if (!receipt || typeof receipt !== 'object') {
    console.error('Receipt content is not a valid object');
    process.exit(1);
  }

  if (receipt.kind === 'review') {
    const expectedBaseSha = flags['phase-base'];
    if (!expectedBaseSha || typeof expectedBaseSha !== 'string') {
      console.error('Review mode requires mandatory --phase-base <sha>');
      process.exit(1);
    }

    const reviewPhaseDir = path.join(ledgerDir, `review-${phase}`);
    const chainPath = path.join(reviewPhaseDir, 'chain.json');
    let chainOnDisk = [];
    try {
      if (!fs.existsSync(chainPath)) {
        console.error(`Chain file not found at ${chainPath}`);
        process.exit(1);
      }
      chainOnDisk = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
    } catch (err) {
      console.error(`Failed to read or parse ledger chain at ${chainPath}: ${err.message}`);
      process.exit(1);
    }

    if (!Array.isArray(chainOnDisk) || chainOnDisk.length === 0) {
      console.error('Ledger chain.json is empty or not an array');
      process.exit(1);
    }

    // Item 5: Deep chain equality with disk
    if (!Array.isArray(receipt.chain) || !deepEqual(receipt.chain, chainOnDisk)) {
      console.error('Receipt chain diverges from on-disk chain.json (different generations, dropped/reordered entries, or differing fields)');
      process.exit(1);
    }

    // Drive validation from disk: use chainOnDisk
    const chain = [...chainOnDisk];
    chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));

    // Require ledger chain first entry base to equal expectedBaseSha
    const firstEntryDisk = chain[0];
    if (!firstEntryDisk || firstEntryDisk.base !== expectedBaseSha) {
      console.error(`Ledger chain first entry base '${firstEntryDisk && firstEntryDisk.base}' does not match expected phase-base '${expectedBaseSha}'`);
      process.exit(1);
    }

    const findingsByGeneration = new Map();
    const dispositionsByGeneration = new Map();

    // Continuity is tracked against the last FINALIZED head, not the previous entry: an aborted
    // generation has no head (nothing advanced) and the loop continues the next generation from
    // the aborted one's base (hetero-review-loop.js collect, prevEntry.status === 'aborted').
    let expectedEntryBase = expectedBaseSha;

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.generation !== i + 1) {
        console.error(`Invalid generation order or gap in chain: expected generation ${i + 1}, got ${entry.generation}`);
        process.exit(1);
      }

      // first entry's base must equal expectedBaseSha, each later entry's base must equal the
      // last finalized head (== the aborted predecessor's base when the predecessor aborted)
      if (entry.base !== expectedEntryBase) {
        if (i === 0) {
          console.error(`First chain entry base '${entry.base}' does not match expected phase-base '${expectedBaseSha}'`);
        } else {
          console.error(`Chain broken at generation ${entry.generation}: base '${entry.base}' does not match previous head '${expectedEntryBase}'`);
        }
        process.exit(1);
      }

      // (3a) v2.36.3: an aborted generation is a recorded, non-reviewing attempt (7840hs report:
      // a branch that moved during collection left the phase permanently un-receiptable). It is
      // accepted ONLY as evidence that nothing was reviewed: it must not be the last entry (the
      // phase needs a finalized generation after it — an abort can never stand in for a review),
      // it carries no head (checked above: the successor continues from the same base), and its
      // range.json, when present, must name the same base. No findings/dispositions/seats are
      // required or read, and review-chain-derive skips it (it closes nothing).
      if (entry.status === 'aborted') {
        if (i === chain.length - 1) {
          console.error(`Chain entry generation ${entry.generation} is 'aborted' and is the last entry: the phase has no finalized review after the abort`);
          process.exit(1);
        }
        if (Object.prototype.hasOwnProperty.call(entry, 'head')) { // any own head, even "" (review 🔵)
          console.error(`Chain entry generation ${entry.generation} is 'aborted' but carries a head '${entry.head}' (an aborted generation advances nothing)`);
          process.exit(1);
        }
        const abortedRangePath = path.join(reviewPhaseDir, `g${entry.generation}`, 'range.json');
        if (fs.existsSync(abortedRangePath)) {
          let abortedRange;
          try {
            abortedRange = JSON.parse(fs.readFileSync(abortedRangePath, 'utf8'));
          } catch (err) {
            console.error(`Failed to read or parse range.json for aborted generation ${entry.generation}: ${err.message}`);
            process.exit(1);
          }
          if (abortedRange.base !== entry.base) {
            console.error(`range.json base mismatch for aborted generation ${entry.generation}`);
            process.exit(1);
          }
        }
        continue; // expectedEntryBase unchanged: the next generation continues from this base
      }

      // (3) every other entry's status must be "finalized"
      if (entry.status !== 'finalized') {
        console.error(`Chain entry generation ${entry.generation} status is '${entry.status}' (expected 'finalized')`);
        process.exit(1);
      }
      expectedEntryBase = entry.head;

      // Item 2 / d2-seat-receipt-forgery: seat coverage and the reviewed-seat count are
      // resolved further below, once the per-generation directory (gDir) is known and each
      // seat artifact can be read and sha-verified from disk — never trusted from chain-level
      // counts (reviewed_seats/total_seats) or from the receipt.

      const gDir = path.join(reviewPhaseDir, `g${entry.generation}`);

      // (4) read <ledger>/review-<phase>/g<generation>/range.json
      const rangePath = path.join(gDir, 'range.json');
      let rangeObj;
      try {
        if (!fs.existsSync(rangePath)) {
          console.error(`Missing range.json for generation ${entry.generation} at ${rangePath}`);
          process.exit(1);
        }
        rangeObj = JSON.parse(fs.readFileSync(rangePath, 'utf8'));
      } catch (err) {
        console.error(`Failed to read or parse range.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (rangeObj.base !== entry.base || rangeObj.head !== entry.head) {
        console.error(`range.json base/head mismatch for generation ${entry.generation}`);
        process.exit(1);
      }

      // Item 7: Exclusion allowlist enforcement
      const hasExclusions = Array.isArray(rangeObj.excluded) && rangeObj.excluded.length > 0;
      if (hasExclusions) {
        for (const pattern of rangeObj.excluded) {
          if (!isPathspecAllowed(pattern)) {
            console.error(`ERROR: Exclude pathspec '${pattern}' is not permitted by allowlist`);
            process.exit(1);
          }
        }
        if (!rangeObj.full_range_sha256 || typeof rangeObj.full_range_sha256 !== 'string') {
          console.error(`Missing full_range_sha256 in range.json for generation ${entry.generation} with exclusions`);
          process.exit(1);
        }
        const fullDiffRes = spawnSync('git', ['diff', `${entry.base}..${entry.head}`], {
          cwd: repoRoot,
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
        });
        if (fullDiffRes.status !== 0) {
          console.error(`git diff (full range) failed for generation ${entry.generation}: ${fullDiffRes.stderr || 'unknown error'}`);
          process.exit(1);
        }
        const computedFullSha = crypto.createHash('sha256').update(fullDiffRes.stdout, 'utf8').digest('hex');
        if (computedFullSha !== rangeObj.full_range_sha256) {
          console.error(`full_range_sha256 mismatch for generation ${entry.generation}: expected '${rangeObj.full_range_sha256}', computed '${computedFullSha}'`);
          process.exit(1);
        }
        if (entry.full_range_sha256 && entry.full_range_sha256 !== rangeObj.full_range_sha256) {
          console.error(`Chain entry full_range_sha256 mismatch for generation ${entry.generation}`);
          process.exit(1);
        }
      }

      // git diff <base>..<head> with maxBuffer 64MB and negative pathspecs if rangeObj.excluded exists
      const diffArgs = ['diff', `${entry.base}..${entry.head}`];
      if (hasExclusions) {
        diffArgs.push('--');
        for (const pattern of rangeObj.excluded) {
          diffArgs.push(`:!${pattern}`);
        }
      }
      const diffRes = spawnSync('git', diffArgs, {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      if (diffRes.status !== 0) {
        console.error(`git diff failed for generation ${entry.generation}: ${diffRes.stderr || 'unknown error'}`);
        process.exit(1);
      }

      const computedDiffSha = crypto.createHash('sha256').update(diffRes.stdout, 'utf8').digest('hex');
      if (computedDiffSha !== rangeObj.diff_sha256) {
        console.error(`diff_sha256 mismatch for generation ${entry.generation}: expected '${rangeObj.diff_sha256}', computed '${computedDiffSha}'`);
        process.exit(1);
      }

      // Item 6: findings/seat sha verification
      const findingsPath = path.join(gDir, 'findings.json');
      const dispositionsPath = path.join(gDir, 'dispositions.json');

      if (!fs.existsSync(findingsPath)) {
        console.error(`Missing findings.json for finalized generation ${entry.generation} at ${findingsPath}`);
        process.exit(1);
      }
      if (!fs.existsSync(dispositionsPath)) {
        console.error(`Missing snapshotted dispositions.json for finalized generation ${entry.generation} at ${dispositionsPath}`);
        process.exit(1);
      }

      let findingsRaw;
      try {
        findingsRaw = fs.readFileSync(findingsPath);
      } catch (err) {
        console.error(`Failed to read findings.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      const computedFindingsSha = crypto.createHash('sha256').update(findingsRaw).digest('hex');
      if (!entry.findings_sha256 || computedFindingsSha !== entry.findings_sha256) {
        console.error(`findings_sha256 mismatch or missing for generation ${entry.generation}: expected '${entry.findings_sha256}', computed '${computedFindingsSha}'`);
        process.exit(1);
      }

      // Seat artifacts verification
      // Item 2 / d2-seat-receipt-forgery: exact seat-to-hash coverage for every seat listed in
      // this chain entry, reviewed status derived from each validated (sha-verified) seat
      // artifact on disk — never from chain-level counts or the receipt — and the minimum
      // reviewed-seat count enforced from trusted configuration only (default: all seats).
      if (!Array.isArray(entry.seats) || entry.seats.length === 0) {
        console.error(`Chain entry generation ${entry.generation} is missing a non-empty 'seats' array; cannot verify review coverage`);
        process.exit(1);
      }
      const entrySeatIds = entry.seats.map((s) => (s && typeof s === 'object' ? s.id : s));
      if (entrySeatIds.some((id) => typeof id !== 'string' || id.length === 0)) {
        console.error(`Chain entry generation ${entry.generation} has a seat with a missing or invalid id`);
        process.exit(1);
      }

      if (!entry.seat_artifact_sha256 || typeof entry.seat_artifact_sha256 !== 'object' || Array.isArray(entry.seat_artifact_sha256)) {
        console.error(`seat_artifact_sha256 missing or not an object for generation ${entry.generation}`);
        process.exit(1);
      }
      const shaKeys = Object.keys(entry.seat_artifact_sha256);
      if (shaKeys.length === 0) {
        console.error(`seat_artifact_sha256 is empty for generation ${entry.generation}; no seat evidence provided (forged empty-seat receipt)`);
        process.exit(1);
      }
      const sortedEntrySeatIds = [...entrySeatIds].sort();
      const sortedShaKeys = [...shaKeys].sort();
      const exactSeatCoverage = sortedEntrySeatIds.length === sortedShaKeys.length
        && sortedEntrySeatIds.every((id, idx) => id === sortedShaKeys[idx]);
      if (!exactSeatCoverage) {
        console.error(`seat_artifact_sha256 keys [${sortedShaKeys.join(', ')}] do not exactly match the seats [${sortedEntrySeatIds.join(', ')}] listed for generation ${entry.generation}`);
        process.exit(1);
      }

      let reviewedCount = 0;
      for (const seatId of entrySeatIds) {
        const expectedSha = entry.seat_artifact_sha256[seatId];
        const seatFile = path.join(gDir, `seat-${seatId}.json`);
        if (!fs.existsSync(seatFile)) {
          console.error(`Missing seat artifact at ${seatFile} for generation ${entry.generation}`);
          process.exit(1);
        }
        const seatRaw = fs.readFileSync(seatFile);
        const computedSeatSha = crypto.createHash('sha256').update(seatRaw).digest('hex');
        if (computedSeatSha !== expectedSha) {
          console.error(`seat_artifact_sha256 mismatch for seat '${seatId}' in generation ${entry.generation}: expected '${expectedSha}', computed '${computedSeatSha}'`);
          process.exit(1);
        }
        let seatContent;
        try {
          seatContent = JSON.parse(seatRaw.toString('utf8'));
        } catch (err) {
          console.error(`Failed to parse seat artifact ${seatFile} for generation ${entry.generation}: ${err.message}`);
          process.exit(1);
        }
        if (seatContent && seatContent.status === 'reviewed') {
          reviewedCount++;
        }
      }

      const requiredMinSeats = (configuredMinSeats !== null && !isNaN(configuredMinSeats))
        ? configuredMinSeats
        : entrySeatIds.length;
      if (reviewedCount < requiredMinSeats) {
        console.error(`Generation ${entry.generation} reviewed seats (${reviewedCount}) below minimum required (${requiredMinSeats})`);
        process.exit(1);
      }

      let dispBytes;
      try {
        dispBytes = fs.readFileSync(dispositionsPath);
      } catch (err) {
        console.error(`Failed to read dispositions.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      const dispSha256 = crypto.createHash('sha256').update(dispBytes).digest('hex');
      if (!entry.dispositions_sha256 || dispSha256 !== entry.dispositions_sha256) {
        console.error(`dispositions_sha256 mismatch for generation ${entry.generation}: expected '${entry.dispositions_sha256}', computed '${dispSha256}'`);
        process.exit(1);
      }

      // Item 4: Strict validation of findings.json and dispositions.json
      let findingsData;
      try {
        findingsData = JSON.parse(findingsRaw.toString('utf8'));
      } catch (err) {
        console.error(`Failed to parse findings.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (!findingsData || typeof findingsData !== 'object' || Array.isArray(findingsData) || !Array.isArray(findingsData.findings)) {
        console.error(`findings.json for generation ${entry.generation} must be a JSON object with a findings array`);
        process.exit(1);
      }

      const SEVERITY_WORDS = new Set(['Critical', 'Major', 'Minor', 'Suggestion']);
      const findingsList = findingsData.findings;
      const findingsMap = new Map();
      for (let j = 0; j < findingsList.length; j++) {
        const f = findingsList[j];
        if (!f || typeof f !== 'object' || Array.isArray(f)) {
          console.error(`Finding at index ${j} in generation ${entry.generation} is not an object`);
          process.exit(1);
        }
        if (typeof f.id !== 'string' || f.id.trim().length === 0) {
          console.error(`Finding at index ${j} in generation ${entry.generation} missing valid string id`);
          process.exit(1);
        }
        if (findingsMap.has(f.id)) {
          console.error(`Duplicate finding id '${f.id}' in generation ${entry.generation} findings.json`);
          process.exit(1);
        }
        if (!SEVERITY_WORDS.has(f.severity)) {
          console.error(`Finding '${f.id}' has invalid severity '${f.severity}' in generation ${entry.generation}`);
          process.exit(1);
        }
        findingsMap.set(f.id, f);
      }

      let dispData;
      try {
        dispData = JSON.parse(dispBytes.toString('utf8'));
      } catch (err) {
        console.error(`Failed to parse dispositions.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      if (!dispData || typeof dispData !== 'object' || Array.isArray(dispData) || !Array.isArray(dispData.findings)) {
        console.error(`dispositions.json for generation ${entry.generation} must be a JSON object with a findings array`);
        process.exit(1);
      }

      const allowedDispositions = new Set(['verified', 'refuted', 'deferred']);
      const dispList = dispData.findings;
      const dispMap = new Map();
      for (let j = 0; j < dispList.length; j++) {
        const d = dispList[j];
        if (!d || typeof d !== 'object' || Array.isArray(d)) {
          console.error(`Disposition at index ${j} in generation ${entry.generation} is not an object`);
          process.exit(1);
        }
        if (typeof d.id !== 'string' || d.id.trim().length === 0) {
          console.error(`Disposition at index ${j} in generation ${entry.generation} missing valid string id`);
          process.exit(1);
        }
        if (dispMap.has(d.id)) {
          console.error(`Duplicate disposition id '${d.id}' in generation ${entry.generation} dispositions.json`);
          process.exit(1);
        }
        if (!allowedDispositions.has(d.disposition)) {
          console.error(`Disposition '${d.id}' has invalid disposition '${d.disposition}' in generation ${entry.generation}`);
          process.exit(1);
        }
        if (typeof d.rationale !== 'string' || d.rationale.trim().length === 0) {
          console.error(`Disposition '${d.id}' missing non-empty rationale string in generation ${entry.generation}`);
          process.exit(1);
        }
        dispMap.set(d.id, d);
      }

      // Check matching IDs: one entry per finding id, no extras, none missing
      for (const fid of findingsMap.keys()) {
        if (!dispMap.has(fid)) {
          console.error(`Dispositions missing finding id '${fid}' in generation ${entry.generation}`);
          process.exit(1);
        }
      }
      for (const did of dispMap.keys()) {
        if (!findingsMap.has(did)) {
          console.error(`Dispositions contains unexpected finding id '${did}' in generation ${entry.generation}`);
          process.exit(1);
        }
      }

      findingsByGeneration.set(entry.generation, findingsList);
      dispositionsByGeneration.set(entry.generation, dispList);
    }

    // Item 4: Call shared review-chain-derive routine
    const derivedState = deriveReceiptState(chain, findingsByGeneration, dispositionsByGeneration);

    // v2.36.3 (7840hs): no closure may be attributed to an aborted generation — it produced no
    // findings, so "closed by absence in generation N" is meaningless for an aborted N. Checked
    // on the receipt's own closed_findings BEFORE the equality comparison below so a receipt
    // written by the pre-v2.36.3 finalize (which did exactly this) is refused with a named
    // reason and the remedy, not a bare mismatch. The re-derived state is asserted too, as a
    // self-check on the derive routine.
    const abortedGens = new Set(chain.filter((e) => e.status === 'aborted').map((e) => e.generation));
    const namesAborted = (list) => (Array.isArray(list) ? list : [])
      .find((cf) => cf && abortedGens.has(cf.closed_by_generation));
    // The loop's finalize writes the stamps onto chain ENTRIES (chain[i].closed_findings), not a
    // top-level receipt field — the 7840hs ledger carries `{id, closed_by_generation: 3}` on its
    // g2 entry with g3 aborted — so the on-disk chain entries are scanned as well.
    const badReceiptClosure = namesAborted(receipt.closed_findings)
      || chainOnDisk.map((e) => namesAborted(e && e.closed_findings)).find(Boolean);
    if (badReceiptClosure) {
      console.error(`Receipt/chain closed_findings attributes '${badReceiptClosure.id}' to generation ${badReceiptClosure.closed_by_generation}, which is aborted — an aborted generation reviewed nothing and can close nothing (stamp written before v2.36.3; collect + finalize one more generation to re-derive)`);
      process.exit(1);
    }
    const badDerivedClosure = namesAborted(derivedState.closed_findings);
    if (badDerivedClosure) {
      console.error(`Re-derived closed_findings attributes '${badDerivedClosure.id}' to aborted generation ${badDerivedClosure.closed_by_generation} (derive routine defect)`);
      process.exit(1);
    }

    // Item 1: Require both recorded and re-derived SHIP-AS-IS
    if (receipt.verdict !== 'SHIP-AS-IS' || derivedState.verdict !== 'SHIP-AS-IS') {
      console.error(`Receipt verdict is not SHIP-AS-IS or re-derived verdict mismatch (receipt: '${receipt.verdict}', re-derived: '${derivedState.verdict}')`);
      process.exit(1);
    }

    // Item 8 / d2-open-findings-drift: the shared format requires verified Major/Minor findings
    // to populate the canonical open_findings array — a numeric count (or an absent field) would
    // let a forged receipt omit their actionable details while still passing. open_findings is
    // therefore mandatory whenever the chain re-derives to a non-empty set, and must deep-equal
    // the re-derived entries (id, severity, disposition) exactly, in order.
    if (!Array.isArray(receipt.open_findings)) {
      console.error(`Receipt open_findings must be the canonical array of re-derived open findings (got ${typeof receipt.open_findings})`);
      process.exit(1);
    }
    if (receipt.open_findings.length !== derivedState.open_findings.length) {
      console.error(`Receipt open_findings length mismatch: expected ${derivedState.open_findings.length}, got ${receipt.open_findings.length}`);
      process.exit(1);
    }
    for (let i = 0; i < derivedState.open_findings.length; i++) {
      const recF = receipt.open_findings[i];
      const derF = derivedState.open_findings[i];
      if (!recF || recF.id !== derF.id || recF.severity !== derF.severity || recF.disposition !== derF.disposition) {
        console.error(`Receipt open_findings mismatch at index ${i}: expected {id: '${derF.id}', severity: '${derF.severity}', disposition: '${derF.disposition}'}, got ${JSON.stringify(recF)}`);
        process.exit(1);
      }
    }

    // Check closed_findings if present on receipt
    if (receipt.closed_findings !== undefined) {
      if (Array.isArray(receipt.closed_findings)) {
        if (receipt.closed_findings.length !== derivedState.closed_findings.length) {
          console.error(`Receipt closed_findings length mismatch: expected ${derivedState.closed_findings.length}, got ${receipt.closed_findings.length}`);
          process.exit(1);
        }
        for (let i = 0; i < derivedState.closed_findings.length; i++) {
          const recF = receipt.closed_findings[i];
          const derF = derivedState.closed_findings[i];
          if (!recF || recF.id !== derF.id || recF.closed_by_generation !== derF.closed_by_generation) {
            console.error(`Receipt closed_findings mismatch at index ${i}`);
            process.exit(1);
          }
        }
      } else if (typeof receipt.closed_findings === 'number') {
        if (receipt.closed_findings !== derivedState.closed_findings.length) {
          console.error(`Receipt closed_findings count mismatch: expected ${derivedState.closed_findings.length}, got ${receipt.closed_findings}`);
          process.exit(1);
        }
      } else {
        console.error(`Receipt closed_findings is neither an array nor a number (got ${typeof receipt.closed_findings})`);
        process.exit(1);
      }
    }

    // (5) the last chain entry's head must equal current git rev-parse <branch> in repoRoot
    const lastEntry = chain[chain.length - 1];
    const revParseRes = spawnSync('git', ['rev-parse', branch], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    if (revParseRes.status !== 0) {
      console.error(`Failed to rev-parse branch '${branch}': ${revParseRes.stderr || 'unknown error'}`);
      process.exit(1);
    }
    const currentBranchHead = revParseRes.stdout.trim();
    if (currentBranchHead !== lastEntry.head) {
      console.error(`Branch '${branch}' head has moved: expected '${lastEntry.head}', got '${currentBranchHead}'`);
      process.exit(1);
    }

    process.exit(0);
  } else if (receipt.kind === 'opt-out') {
    // (1) configured_value === "off"
    if (receipt.configured_value !== 'off') {
      console.error(`Invalid opt-out configured_value: expected 'off', got '${receipt.configured_value}'`);
      process.exit(1);
    }

    // (2) re-run resolver for --field <knob> and --field <knob>_resolved_from
    let resolverPath = process.env.AUTOPILOT_REVIEW_LOOP_RESOLVER;
    if (!resolverPath) {
      resolverPath = flags['repo-root']
        ? path.join(repoRoot, 'scripts', 'resolve-review-loop.sh')
        : path.join('scripts', 'resolve-review-loop.sh');
    }

    const knob = receipt.knob;
    const allowedKnobs = new Set(['plan_review', 'hetero_review']);
    if (!knob || !allowedKnobs.has(knob)) {
      console.error(`Invalid or missing knob '${knob}' (must be 'plan_review' or 'hetero_review')`);
      process.exit(1);
    }

    const resolvedKnob = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', knob);
    const resolvedFrom = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', `${knob}_resolved_from`);

    if (resolvedKnob !== 'off') {
      console.error(`Resolver field '${knob}' returned '${resolvedKnob}' (expected 'off')`);
      process.exit(1);
    }
    if (resolvedFrom !== receipt.resolved_from) {
      console.error(`Resolver field '${knob}_resolved_from' returned '${resolvedFrom}' (expected '${receipt.resolved_from}')`);
      process.exit(1);
    }

    // (3) recompute sha256 of the bytes at config_source.path
    if (!receipt.config_source || typeof receipt.config_source.path !== 'string') {
      console.error('Opt-out receipt missing or invalid config_source.path');
      process.exit(1);
    }

    if (!fs.existsSync(receipt.config_source.path)) {
      console.error(`Config source path does not exist: ${receipt.config_source.path}`);
      process.exit(1);
    }

    let configBytes;
    try {
      configBytes = fs.readFileSync(receipt.config_source.path);
    } catch (err) {
      console.error(`Failed to read config source file: ${err.message}`);
      process.exit(1);
    }

    const computedSha = crypto.createHash('sha256').update(configBytes).digest('hex');
    if (computedSha !== receipt.config_source.sha256) {
      console.error(`Config source sha256 mismatch: expected '${receipt.config_source.sha256}', computed '${computedSha}'`);
      process.exit(1);
    }

    process.exit(0);
  } else {
    console.error(`Unsupported or unknown receipt kind: '${receipt.kind}'`);
    process.exit(1);
  }
}

function main() {
  const flags = parseArgs(process.argv.slice(2));

  if (flags.help) {
    printUsage();
    process.exit(0);
  }

  if (flags['plan-artifact'] && flags.dispositions) {
    validateModeB(flags);
  } else if (flags.ledger || flags.phase || flags.branch) {
    validateModeA(flags);
  } else {
    console.error('Invalid arguments: must provide Mode A (--ledger, --phase, --branch) or Mode B (--plan-artifact, --dispositions) flags');
    process.exit(1);
  }
}

main();
