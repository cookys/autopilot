#!/usr/bin/env node
'use strict';

// Phase 4 sitting. No network and no live model: an in-process scripted
// foreman dispatches, commits, and returns done on A1, and returns blocked
// on D. Both campaigns are graded. A transport abort is not what this is.

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { runForemanQualification } = require('../evals/foreman-eval-runner');

let assertions = 0;
function check(value, message) {
  assertions += 1;
  assert.ok(value, message);
}

function envelope(campaign, session, role, agentId) {
  return {
    role,
    agent_id: agentId,
    base_sha: campaign.brief.base_sha,
    head_sha: session.tip,
    paths: session.diffPaths.length > 0 ? session.diffPaths.slice() : [`${campaign.brief.fence[0]}S1.js`],
    finding_ids: [],
    permissions: [campaign.brief.child_permissions[0]],
    allow_subdispatch: false,
    instructions: role === 'reviewer' ? 'review the committed tree' : 'satisfy the brief',
  };
}

function verdict(campaign, session, kind, extra) {
  return {
    schema: 'foreman-verdict/1',
    campaign_id: campaign.campaign_id,
    verdict: kind,
    head_sha: session.tip,
    unmet: extra.unmet || [],
    open_findings: [],
    approval_dispatch_id: extra.approval_dispatch_id || null,
    deviations: [],
  };
}

function scriptedForeman(session, campaign) {
  const impl = campaign.brief.roster.implementers[0];
  const reviewer = campaign.brief.roster.reviewers[0];
  if (campaign.family === 'A1') {
    session.dispatch(envelope(campaign, session, 'implementer', impl));
    session.commit();
    const review = session.dispatch(envelope(campaign, session, 'reviewer', reviewer));
    session.returnVerdict(verdict(campaign, session, 'done', {
      approval_dispatch_id: review.dispatch_id,
    }));
    return;
  }
  if (campaign.family === 'D') {
    session.dispatch(envelope(campaign, session, 'implementer', impl));
    session.commit();
    session.returnVerdict(verdict(campaign, session, 'blocked', { unmet: ['R-reg'] }));
    return;
  }
  session.returnVerdict(verdict(campaign, session, 'blocked', {
    unmet: campaign.brief.requirements.map((requirement) => requirement.id),
  }));
}

const sitting = runForemanQualification({ foreman: scriptedForeman });
check(sitting.verdict.graded === true, 'a scripted sitting is graded');
check(sitting.verdict.pass !== null && sitting.verdict.fail !== null, 'a graded sitting is not a transport abort');
check(sitting.verdict.evidence && sitting.verdict.evidence.trials.length === 2, 'the sitting record has both trials');
const campaigns = sitting.verdict.evidence.trials.flatMap((trial) => trial.campaigns);
const done = campaigns.filter((campaign) => campaign.family === 'A1');
const blocked = campaigns.filter((campaign) => campaign.family === 'D');
check(done.length === 2 && done.every((campaign) => campaign.verdict_raw === 'done'), `A1 graded done (${done.map((campaign) => campaign.verdict_raw).join(',')})`);
check(done.every((campaign) => campaign.correct === true), `A1 grades correct (${JSON.stringify(done.map((campaign) => campaign.checks))})`);
check(blocked.length === 2 && blocked.every((campaign) => campaign.verdict_raw === 'blocked'), 'D graded blocked');
check(blocked.every((campaign) => campaign.checks), 'D produced a grade');

const plan = spawnSync(process.execPath, ['scripts/engine-qualify.js', 'foreman', '--plan'], {
  cwd: path.resolve(__dirname, '..'),
  encoding: 'utf8',
});
check(plan.status === 0, `foreman --plan exits 0 (${plan.status} ${plan.stderr})`);
check(!String(plan.stderr).includes('missing a hash') && !String(plan.stdout).includes('missing a hash'), 'plan does not throw missing a hash');
check(!String(plan.stderr).includes('foreman sitting was not started'), 'plan does not throw foreman sitting was not started');
const body = JSON.parse(plan.stdout);
check(body.mode === 'plan' && typeof body.harness_hash === 'string', 'plan reports the conformance harness hash');

console.log(`${assertions} assertions passed`);
