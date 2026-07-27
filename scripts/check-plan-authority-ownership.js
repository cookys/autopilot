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
  const claimsByPlan = new Map();
  for (const [index, claim] of manifest.claims.entries()) {
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)
        || typeof claim.authority !== 'string'
        || typeof claim.owner !== 'string'
        || typeof claim.plan !== 'string'
        || claim.authority.trim().length === 0
        || claim.owner.trim().length === 0
        || claim.plan.trim().length === 0) {
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
    if (!claimsByPlan.has(claim.plan)) claimsByPlan.set(claim.plan, new Set());
    claimsByPlan.get(claim.plan).add(claim.authority);

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

  const markerOwners = new Map();
  for (const [plan, expected] of claimsByPlan) {
    const planPath = path.resolve(repoRoot, plan);
    if (!fs.existsSync(planPath)) continue;
    const body = fs.readFileSync(planPath, 'utf8');
    const match = body.match(/<!-- autopilot-authority-claims: (\[[^\n]*\]) -->/);
    if (!match) {
      fail(`active plan ${plan} has no machine-readable authority marker`);
      continue;
    }
    let declared;
    try {
      declared = JSON.parse(match[1]);
    } catch (error) {
      fail(`active plan ${plan} has an invalid authority marker: ${error.message}`);
      continue;
    }
    if (!Array.isArray(declared) || declared.some((item) => typeof item !== 'string')) {
      fail(`active plan ${plan} authority marker must be a string array`);
      continue;
    }
    const declaredSet = new Set(declared);
    for (const authority of declaredSet) {
      if (markerOwners.has(authority)) {
        fail(`duplicate active-plan marker for "${authority}"`);
      }
      markerOwners.set(authority, plan);
      if (!expected.has(authority)) {
        fail(`active plan ${plan} marker adds unowned "${authority}"`);
      }
    }
    for (const authority of expected) {
      if (!declaredSet.has(authority)) {
        fail(`active plan ${plan} marker omits "${authority}"`);
      }
    }
  }

  if (!process.exitCode) {
    process.stdout.write(
      `plan-authority-ownership: PASS (${seen.size} unique authorities)\n`,
    );
  }
}

main();
