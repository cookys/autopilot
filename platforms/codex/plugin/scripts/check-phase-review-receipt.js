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
    node scripts/check-phase-review-receipt.js --ledger <dir> --phase <id> --branch <b> [--repo-root <r>]

  Mode B (Plan-artifact / dispositions validation):
    node scripts/check-phase-review-receipt.js --plan-artifact <gN.json> --dispositions <gN-disposition.json>

Flags:
  --ledger <dir>                    Ledger directory containing receipts
  --phase <id>                      Phase identifier
  --branch <b>                      Git branch name
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

  const dispMap = new Map();
  if (Array.isArray(dispositions.findings)) {
    for (const f of dispositions.findings) {
      if (f && f.id !== undefined) {
        dispMap.set(f.id, f);
      }
    }
  }

  const planFindings = Array.isArray(planArtifact.findings) ? planArtifact.findings : [];
  const failingFindings = [];

  for (const finding of planFindings) {
    if (!finding || finding.candidate_blocker !== true) {
      continue;
    }
    const id = finding.id;
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
    // (1) verdict === "SHIP-AS-IS"
    if (receipt.verdict !== 'SHIP-AS-IS') {
      console.error(`Invalid receipt verdict: expected 'SHIP-AS-IS', got '${receipt.verdict}'`);
      process.exit(1);
    }

    // (2) sort chain entries by generation ascending
    const chain = Array.isArray(receipt.chain) ? [...receipt.chain] : [];
    if (chain.length === 0) {
      console.error('Receipt chain is empty');
      process.exit(1);
    }

    chain.sort((a, b) => (a.generation || 0) - (b.generation || 0));

    for (let i = 0; i < chain.length; i++) {
      const entry = chain[i];
      if (entry.generation !== i + 1) {
        console.error(`Invalid generation order or gap in chain: expected generation ${i + 1}, got ${entry.generation}`);
        process.exit(1);
      }

      // first entry's base must equal phase_base_sha, each later entry's base must equal previous entry's head
      if (i === 0) {
        if (entry.base !== receipt.phase_base_sha) {
          console.error(`First chain entry base '${entry.base}' does not match phase_base_sha '${receipt.phase_base_sha}'`);
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

      // (4) read <ledger>/review-<phase>/g<generation>/range.json
      const rangePath = path.join(ledgerDir, `review-${phase}`, `g${entry.generation}`, 'range.json');
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

      // git diff <base> <head>
      const diffRes = spawnSync('git', ['diff', entry.base, entry.head], {
        cwd: repoRoot,
        encoding: 'utf8',
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
    if (!knob) {
      console.error('Opt-out receipt missing knob property');
      process.exit(1);
    }

    const resolvedKnob = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', knob);
    const resolvedFrom = runResolverField(resolverPath, flags['repo-root'] ? repoRoot : '', `${knob}_resolved_from`);

    if (resolvedKnob !== 'off') {
      console.error(`Resolver field '${knob}' returned '${resolvedKnob}' (expected 'off')`);
      process.exit(1);
    }
    if (resolvedFrom !== 'off') {
      console.error(`Resolver field '${knob}_resolved_from' returned '${resolvedFrom}' (expected 'off')`);
      process.exit(1);
    }

    // (3) recompute sha256 of the bytes at config_source.path
    if (!receipt.config_source || typeof receipt.config_source.path !== 'string') {
      console.error('Opt-out receipt missing or invalid config_source.path');
      process.exit(1);
    }

    let configBytes = Buffer.alloc(0);
    if (fs.existsSync(receipt.config_source.path)) {
      try {
        configBytes = fs.readFileSync(receipt.config_source.path);
      } catch (_e) {
        configBytes = Buffer.alloc(0);
      }
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
