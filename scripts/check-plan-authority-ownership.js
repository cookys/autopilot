#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const REQUIRED_AUTHORITIES = new Set([
  'campaign_generation',
  'provider_readiness',
  'worktree_lifecycle',
  'task_can_close',
  'plan_review',
  'transcript_adapter',
  'runner_transport_envelope',
]);

function fail(message) {
  process.stderr.write(`plan-authority-ownership: ${message}\n`);
  process.exitCode = 1;
}

function loadManifest(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
    return null;
  }
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const manifestPath = path.resolve(
    process.argv[2]
      || path.join(
        repoRoot,
        'docs/projects/2026-07-26-mission-convergence-portfolio/authority-ownership.json',
      ),
  );
  const manifest = loadManifest(manifestPath);
  if (!manifest) return;
  if (manifest.schema_version !== 1
      || manifest.artifact_type !== 'portfolio_authority_ownership'
      || !Array.isArray(manifest.claims)) {
    fail('manifest identity or claims array is invalid');
    return;
  }

  const seen = new Map();
  for (const [index, claim] of manifest.claims.entries()) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)
        || typeof claim.authority !== 'string'
        || typeof claim.owner !== 'string'
        || typeof claim.plan !== 'string') {
      fail(`claim ${index} is malformed`);
      continue;
    }
    if (!REQUIRED_AUTHORITIES.has(claim.authority)) {
      fail(`claim ${index} names unknown authority "${claim.authority}"`);
    }
    if (seen.has(claim.authority)) {
      fail(
        `duplicate authority "${claim.authority}" claimed by `
        + `"${seen.get(claim.authority)}" and "${claim.owner}"`,
      );
    } else {
      seen.set(claim.authority, claim.owner);
    }

    const planPath = path.resolve(repoRoot, claim.plan);
    const relative = path.relative(path.join(repoRoot, 'docs', 'plans'), planPath);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !relative.endsWith('.md')) {
      fail(`claim ${index} plan is outside docs/plans`);
    } else if (!fs.existsSync(planPath)) {
      fail(`claim ${index} plan does not exist: ${claim.plan}`);
    }
  }

  for (const authority of REQUIRED_AUTHORITIES) {
    if (!seen.has(authority)) fail(`required authority "${authority}" has no owner`);
  }

  if (!process.exitCode) {
    process.stdout.write(
      `plan-authority-ownership: PASS (${seen.size} unique authorities)\n`,
    );
  }
}

main();
