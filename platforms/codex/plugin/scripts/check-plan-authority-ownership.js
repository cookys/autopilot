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

// Marker discovery follows the plan files wherever the archive layout put them:
// docs/plans/ (live), docs/plans/_archive/ (legacy flat) and
// docs/plans/_archive/YYYY/MM/ (dated layout, v2.36.80). Scanning only the live
// directory made every archived portfolio plan invisible, so each manifest claim
// reported a marker mismatch. A marker found in two locations is still a duplicate.
function listPortfolioPlans(repoRoot) {
  const plansRel = 'docs/plans';
  const dirs = [plansRel, `${plansRel}/_archive`];
  const archiveAbs = path.join(repoRoot, plansRel, '_archive');
  const isDir = (abs) => fs.existsSync(abs) && fs.statSync(abs).isDirectory();
  if (isDir(archiveAbs)) {
    for (const year of fs.readdirSync(archiveAbs).sort()) {
      if (!/^\d{4}$/.test(year) || !isDir(path.join(archiveAbs, year))) continue;
      for (const month of fs.readdirSync(path.join(archiveAbs, year)).sort()) {
        if (!/^\d{2}$/.test(month) || !isDir(path.join(archiveAbs, year, month))) continue;
        dirs.push(`${plansRel}/_archive/${year}/${month}`);
      }
    }
  }
  const plans = [];
  for (const dir of dirs) {
    const abs = path.join(repoRoot, dir);
    if (!isDir(abs)) continue;
    for (const basename of fs.readdirSync(abs).sort()) {
      if (!basename.startsWith('2026-07-26-') || !basename.endsWith('.md')) continue;
      plans.push(path.posix.join(dir, basename));
    }
  }
  return plans;
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const manifestPath = path.resolve(
    process.argv[2]
      || path.join(
        repoRoot,
        'docs/projects/_archive/2026/07/2026-07-26-mission-convergence-portfolio/authority-ownership.json',
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
  for (const plan of listPortfolioPlans(repoRoot)) {
    const body = fs.readFileSync(path.join(repoRoot, plan), 'utf8');
    const matches = [...body.matchAll(/<!-- autopilot-authority-claims: (\[[^\n]*\]) -->/g)];
    for (const match of matches) {
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
      for (const authority of declared) {
        if (!REQUIRED_AUTHORITIES.has(authority)) {
          fail(`active plan ${plan} marker names unknown "${authority}"`);
          continue;
        }
        if (markerOwners.has(authority)) {
          fail(`duplicate active-plan marker for "${authority}"`);
        } else {
          markerOwners.set(authority, plan);
        }
      }
    }
  }
  for (const [plan, expected] of claimsByPlan) {
    for (const authority of expected) {
      if (markerOwners.get(authority) !== plan) {
        fail(`active plan marker for "${authority}" does not match ${plan}`);
      }
    }
  }
  for (const [authority, plan] of markerOwners) {
    if (!claimsByPlan.get(plan)?.has(authority)) {
      fail(`active plan ${plan} marker is absent from the ownership manifest`);
    }
  }

  if (!process.exitCode) {
    process.stdout.write(
      `plan-authority-ownership: PASS (${seen.size} unique authorities)\n`,
    );
  }
}

main();
