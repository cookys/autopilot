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

function printUsage() {
  console.log(`Usage:
  Mode A (Receipt validation):
    node scripts/check-phase-review-receipt.js --ledger <dir> --phase <id> --branch <b> --phase-base <sha> [--repo-root <r>]

  Mode B (Plan-artifact / dispositions validation):
    node scripts/check-phase-review-receipt.js --plan-artifact <gN.json> --dispositions <gN-disposition.json>

Flags:
  --ledger <dir>                    Ledger directory containing receipts
  --phase <id>                      Phase identifier
  --branch <b>                      Git branch name
  --phase-base <sha>                Expected phase base commit sha (mandatory for review mode)
  --repo-root <r>                   Path to repository root (defaults to cwd)
  --plan-artifact <gN.json>         Plan artifact JSON file
  --dispositions <gN-disp.json>     Dispositions JSON file
  --help, -h                        Show this help message and exit 0
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

function validateModeB(flags) {
  const planArtifactPath = flags['plan-artifact'];
  const dispositionsPath = flags.dispositions;

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

  if (!planArtifact || typeof planArtifact !== 'object' || Array.isArray(planArtifact) || !Array.isArray(planArtifact.findings)) {
    console.error('Plan artifact must parse as a JSON object with a findings array');
    process.exit(1);
  }

  if (!dispositions || typeof dispositions !== 'object' || Array.isArray(dispositions) || !Array.isArray(dispositions.findings)) {
    console.error('Dispositions must parse as a JSON object with a findings array');
    process.exit(1);
  }

  // Enum values already used elsewhere in this file:
  // - Mode B dispositions: accepted_blocker, rejected
  // - hetero-review dispositions: verified, refuted, deferred
  // - plan-review DISPOSITIONS: accepted_blocker, accepted_nonblocking, rejected, duplicate, deferred
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
    if (typeof idVal !== 'string') {
      console.error(`Finding in ${sourceName} missing valid string id/fingerprint`);
      process.exit(1);
    }
    if (typeof f.candidate_blocker !== 'boolean') {
      console.error(`Finding '${idVal}' in ${sourceName} candidate_blocker must be a boolean`);
      process.exit(1);
    }
    if (typeof f.disposition !== 'string' || !allowedDispositions.has(f.disposition)) {
      console.error(`Finding '${idVal}' in ${sourceName} invalid disposition '${f.disposition}'`);
      process.exit(1);
    }
    return idVal;
  }

  // Validate each finding object in planArtifact
  for (const f of planArtifact.findings) {
    validateFindingObj(f, 'plan artifact');
  }

  // Validate each finding object in dispositions and build map
  const dispMap = new Map();
  for (const f of dispositions.findings) {
    const id = validateFindingObj(f, 'dispositions');
    dispMap.set(id, f);
  }

  const failingFindings = [];

  for (const finding of planArtifact.findings) {
    if (!finding || finding.candidate_blocker !== true) {
      continue;
    }
    const id = finding.fingerprint !== undefined ? finding.fingerprint : finding.id;
    const disp = dispMap.get(id);
    if (!disp) {
      failingFindings.push(`Finding '${id}': missing in dispositions`);
      continue;
    }

    const disposition = disp.disposition;
    if (disposition !== 'accepted_blocker' && disposition !== 'rejected') {
      failingFindings.push(
        `Finding '${id}': invalid disposition '${disposition}' (must be 'accepted_blocker' or 'rejected')`
      );
      continue;
    }

    const rationale = typeof disp.rationale === 'string' ? disp.rationale.trim() : '';
    if (!rationale) {
      failingFindings.push(`Finding '${id}': rationale must be a non-empty string`);
      continue;
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

function validateModeA(flags) {
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

    // Require ledger chain first entry base to equal expectedBaseSha
    const firstEntryDisk = chainOnDisk[0];
    if (!firstEntryDisk || firstEntryDisk.base !== expectedBaseSha) {
      console.error(`Ledger chain first entry base '${firstEntryDisk && firstEntryDisk.base}' does not match expected phase-base '${expectedBaseSha}'`);
      process.exit(1);
    }

    // sort chain entries by generation ascending
    const chain = Array.isArray(receipt.chain) ? [...receipt.chain] : [];
    if (chain.length === 0) {
      console.error('Receipt chain is empty');
      process.exit(1);
    }

    chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));

    let recomputedHasVerifiedCritical = false;
    const recomputedOpenFindings = [];

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.generation !== i + 1) {
        console.error(`Invalid generation order or gap in chain: expected generation ${i + 1}, got ${entry.generation}`);
        process.exit(1);
      }

      // first entry's base must equal expectedBaseSha, each later entry's base must equal previous entry's head
      if (i === 0) {
        if (entry.base !== expectedBaseSha) {
          console.error(`First chain entry base '${entry.base}' does not match expected phase-base '${expectedBaseSha}'`);
          process.exit(1);
        }
      } else {
        const prevEntry = chain[i - 1];
        if (entry.base !== prevEntry.head) {
          console.error(`Chain broken at generation ${entry.generation}: base '${entry.base}' does not match previous head '${prevEntry.head}'`);
          process.exit(1);
        }
      }

      // (3) every entry's status must be "finalized"
      if (entry.status !== 'finalized') {
        console.error(`Chain entry generation ${entry.generation} status is '${entry.status}' (expected 'finalized')`);
        process.exit(1);
      }

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

      // git diff <base> <head> with maxBuffer 64MB
      const diffRes = spawnSync('git', ['diff', entry.base, entry.head], {
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

      // For every finalized generation, read findings.json and snapshotted dispositions.json
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

      let findingsData;
      try {
        findingsData = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
      } catch (err) {
        console.error(`Failed to read or parse findings.json for generation ${entry.generation}: ${err.message}`);
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

      let dispData;
      try {
        dispData = JSON.parse(dispBytes.toString('utf8'));
      } catch (err) {
        console.error(`Failed to parse dispositions.json for generation ${entry.generation}: ${err.message}`);
        process.exit(1);
      }

      const genFindings = (findingsData && Array.isArray(findingsData.findings)) ? findingsData.findings : [];
      const genDispFindings = (dispData && Array.isArray(dispData.findings)) ? dispData.findings : [];
      const dispMap = new Map();
      for (const df of genDispFindings) {
        if (df && df.id !== undefined) {
          dispMap.set(df.id, df);
        }
      }

      for (const f of genFindings) {
        const disp = dispMap.get(f.id);
        const disposition = disp ? disp.disposition : undefined;

        if (f.severity === 'Critical' && disposition === 'verified') {
          recomputedHasVerifiedCritical = true;
        }

        if ((f.severity === 'Major' || f.severity === 'Minor') && disposition === 'verified') {
          recomputedOpenFindings.push({
            id: f.id,
            severity: f.severity,
            seat: f.seat,
            text: f.text,
            disposition: 'verified',
          });
        }
      }
    }

    const recomputedVerdict = recomputedHasVerifiedCritical ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS';

    // Check receipt's verdict equals recomputedVerdict
    if (receipt.verdict !== recomputedVerdict) {
      console.error(`Receipt verdict mismatch: expected '${recomputedVerdict}', got '${receipt.verdict}'`);
      process.exit(1);
    }

    // Check open_findings matches receipt
    if (Array.isArray(receipt.open_findings)) {
      if (receipt.open_findings.length !== recomputedOpenFindings.length) {
        console.error(`Receipt open_findings length mismatch: expected ${recomputedOpenFindings.length}, got ${receipt.open_findings.length}`);
        process.exit(1);
      }
      for (let i = 0; i < recomputedOpenFindings.length; i++) {
        const recF = receipt.open_findings[i];
        const reF = recomputedOpenFindings[i];
        if (!recF || recF.id !== reF.id || recF.disposition !== reF.disposition) {
          console.error(`Receipt open_findings mismatch at index ${i}`);
          process.exit(1);
        }
      }
    } else if (typeof receipt.open_findings === 'number') {
      if (receipt.open_findings !== recomputedOpenFindings.length) {
        console.error(`Receipt open_findings count mismatch: expected ${recomputedOpenFindings.length}, got ${receipt.open_findings}`);
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
