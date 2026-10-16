#!/usr/bin/env node
'use strict';

// Never touch the real ~/.autopilot: the durable evidence log goes to a temp dir.
const fs = require('fs');
const os = require('os');
process.env.AUTOPILOT_FOREMAN_EVIDENCE_DIR = fs.mkdtempSync(require('path').join(os.tmpdir(), 'foreman-evidence-test-'));

// Phase 4 sitting. No network and no live model: an in-process scripted
// foreman dispatches, commits, and returns done on A1, and returns blocked
// on D. Both campaigns are graded. A transport abort is not what this is.

const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const { runForemanQualification, createCampaignSession } = require('../evals/foreman-eval-runner');
const { generateForemanExam } = require('../evals/foreman-eval-generator');

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

// The ledger belongs to the candidate (spec A8). The scripted foreman writes it
// through the same shell tool a model would use.
function ledger(session, dispatchEnvelope, result) {
  const review = result.report && result.report.review;
  const row = JSON.stringify({
    dispatch_id: result.dispatch_id,
    role: dispatchEnvelope.role,
    agent_id: dispatchEnvelope.agent_id,
    head_sha: dispatchEnvelope.head_sha,
    outcome: result.status,
    decision: review ? review.decision : null,
    finding_ids: review ? review.findings.map((finding) => finding.id) : [],
  });
  session.shell(`printf '%s\\n' '${row}' >> .autopilot/ledger.jsonl`);
}

function scriptedForeman(session, campaign) {
  const impl = campaign.brief.roster.implementers[0];
  const reviewer = campaign.brief.roster.reviewers[0];
  if (campaign.family === 'A1') {
    const implEnvelope = envelope(campaign, session, 'implementer', impl);
    ledger(session, implEnvelope, session.dispatch(implEnvelope));
    session.commit();
    const reviewEnvelope = envelope(campaign, session, 'reviewer', reviewer);
    const review = session.dispatch(reviewEnvelope);
    ledger(session, reviewEnvelope, review);
    session.returnVerdict(verdict(campaign, session, 'done', {
      approval_dispatch_id: review.dispatch_id,
    }));
    return;
  }
  if (campaign.family === 'D') {
    const implEnvelope = envelope(campaign, session, 'implementer', impl);
    ledger(session, implEnvelope, session.dispatch(implEnvelope));
    session.commit();
    session.returnVerdict(verdict(campaign, session, 'blocked', { unmet: ['R-reg'] }));
    return;
  }
  session.returnVerdict(verdict(campaign, session, 'blocked', {
    unmet: campaign.brief.requirements.map((requirement) => requirement.id),
  }));
}

const sitting = runForemanQualification({ foreman: scriptedForeman, engine: 'engine-scripted' });
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

// Spec §9 anti-rerun: the sitting above wrote a commitment and a terminal row to the
// durable log, and a later sitting for the same identity reloads them.
const logFile = require('../evals/foreman-eval-runner').foremanEvidenceLogFile();
check(logFile.startsWith(process.env.AUTOPILOT_FOREMAN_EVIDENCE_DIR), 'the evidence log honours the temp-dir override');
const logRows = fs.readFileSync(logFile, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
check(logRows.some((row) => row.type === 'sitting_commitment'), 'the sitting appended its commitment to the durable log');
check(logRows.some((row) => row.type === 'sitting_terminal' && row.disposition === sitting.verdict.disposition),
  'the sitting appended its terminal disposition to the durable log');
assert.throws(() => runForemanQualification({ foreman: scriptedForeman, engine: 'engine-scripted' }),
  (error) => error.code === 'anti_rerun', 'a real failed sitting locks its own identity on the next attempt');
assertions += 1;
const { appendEvidenceRow, loadPriorRecords } = require('../evals/foreman-eval-runner');
const seatHash = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../evals/foreman-asset-pins.json'), 'utf8')).vocabulary_scan_sha256;
check(loadPriorRecords('engine-scripted', seatHash).length >= 2, 'prior records load by (engine_id, seat_config_hash)');
appendEvidenceRow({ type: 'sitting_terminal', engine_id: 'engine-failed', seat_config_hash: seatHash, disposition: 'failed', resit_locked: false });
assert.throws(() => runForemanQualification({ foreman: scriptedForeman, engine: 'engine-failed' }),
  (error) => error.code === 'anti_rerun', 'a failed identity cannot sit again');
assertions += 1;
appendEvidenceRow({ type: 'sitting_terminal', engine_id: 'engine-passed', seat_config_hash: seatHash, disposition: 'passed', resit_locked: false });
const again = runForemanQualification({ foreman: scriptedForeman, engine: 'engine-passed' });
check(again.verdict.graded === true, 'a passed identity is never blocked (owner rule: a pass stands)');
const abortOnce = () => runForemanQualification({ foreman: () => { throw new Error('boom'); }, engine: 'engine-aborts' });
check(abortOnce().verdict.disposition === 'aborted_transport', 'a transport error aborts the sitting');
check(abortOnce().verdict.disposition === 'aborted_transport', 'the second abort still sits (two allowed)');
assert.throws(abortOnce, (error) => error.code === 'anti_rerun', 'two logged aborts refuse the third sitting');
assertions += 1;
appendEvidenceRow({ type: 'operator_signoff', engine_id: 'engine-aborts', seat_config_hash: seatHash });
check(abortOnce().verdict.disposition === 'aborted_transport', 'an operator sign-off in the log clears the abort count');

// Spec §5 wire contract: a malformed SHA or an unrostered agent is envelope_rejected.
let wire = null;
runForemanQualification({
  engine: 'engine-wire',
  foreman: (session, campaign) => {
    if (campaign.family !== 'A1' || wire) { scriptedForeman(session, campaign); return; }
    // A rejected envelope spends dispatch budget (spec section 6), and A1 has
    // 4, so the five wire probes run on a throwaway stub session of an E
    // campaign (budget 7) and the live session stays untouched.
    const probeCampaign = (generateForemanExam(require('crypto').createHash('sha256').update('wire-probe').digest('hex'))
      .trials[0].campaigns.find((entry) => entry.family === 'E'));
    const probe = createCampaignSession(probeCampaign);
    const good = envelope(probeCampaign, probe, 'implementer', probeCampaign.brief.roster.implementers[0]);
    wire = {
      tip40: /^[0-9a-f]{40}$/.test(probe.tip),
      shortSha: probe.dispatch({ ...good, head_sha: good.head_sha.slice(0, 39) }).status,
      badBase: probe.dispatch({ ...good, base_sha: 'zz' }).status,
      stranger: probe.dispatch({ ...good, agent_id: 'not-on-roster' }).status,
      reviewerAsImpl: probe.dispatch({ ...good, agent_id: probeCampaign.brief.roster.reviewers[0] }).status,
      badType: probe.dispatch({ ...good, allow_subdispatch: 'no' }).status,
    };
    scriptedForeman(session, campaign);
  },
});
check(wire.tip40, 'generated tree ids are 40-hex');
check(wire.shortSha === 'envelope_rejected' && wire.badBase === 'envelope_rejected', 'a malformed SHA is envelope_rejected');
check(wire.stranger === 'envelope_rejected' && wire.reviewerAsImpl === 'envelope_rejected', 'an agent outside the role roster is envelope_rejected');
check(wire.badType === 'envelope_rejected', 'a wrongly typed envelope field is envelope_rejected');

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
