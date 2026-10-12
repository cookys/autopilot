#!/usr/bin/env bash
# campaign-intake-mission-binding.test.sh — the ICC intake journals which Mission claim a
# campaign was admitted for (op campaign_mission_binding, same lease as the intake root), so
# `mission withdraw` can bind a mission-subject-v2 claim to its campaign-v1 ledger id.
# Without a missionBinding (legacy admission) no row is written.
TEST_NAME="campaign-intake-mission-binding"
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const path = require('path');
const [root, tmp] = process.argv.slice(2);
const icc = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));
const cli = require(path.join(root, 'src', 'campaign', 'cli'));
const H = (c) => c.repeat(64);
const contract = {
  ticket: 'icc-binding', profile: 'poc', max_repair_generations: 2, max_wall_seconds: 3600,
  max_changed_files: 4, baseline_churn: 10, max_extra_churn: 5,
};
const repoIdentity = 'git-common-dir:/fixture-binding';
const digest = H('d');
const campaignId = icc.campaignIdFor(repoIdentity, contract.ticket, digest);
const initialState = icc.createCampaignState({ contract, contractDigest: digest, repoIdentity, startedAt: '2026-08-29T00:00:00.000Z' });
const claimId = `claim-v1-${H('1')}`;
const v2Id = `campaign-v2-${H('2')}`;
const v2Claim = { claim_id: claimId, identity_scheme: 'mission-subject-v2', campaign_id: v2Id, campaign_contract_draft: { ticket: contract.ticket } };

function admit(name, missionBinding) {
  const ledger = path.join(tmp, `${name}.jsonl`);
  const res = intake.claimCampaignGeneration({
    campaignId, contractDigest: digest, initialState, ledgerPath: ledger, repo: tmp,
    resume: false, observedAt: '2026-08-29T00:00:01.000Z', base: 'b'.repeat(40), missionBinding,
  });
  assert.strictEqual(res.status, 'claimed', JSON.stringify(res));
  return cli.loadRows(ledger);
}

const bound = admit('bound', { claim_id: claimId, campaign_id: v2Id });
const bindRows = bound.filter((r) => r.kind === 'journal' && r.op === 'campaign_mission_binding');
assert.strictEqual(bindRows.length, 1, 'one binding row journaled');
assert.strictEqual(bindRows[0].run_id, campaignId);
const intakeRow = bound.find((r) => r.kind === 'journal' && r.op === 'campaign_intake');
assert.strictEqual(bindRows[0].generation, intakeRow.generation, 'same lease as the intake root');
assert.strictEqual(bindRows[0].nonce, intakeRow.nonce);
// the campaign still projects (unknown op is ignored by the reducer) and the claim resolves by exact id
assert.ok(cli.projectCampaign(bound, campaignId), 'campaign projects with the binding row present');
const r = cli.resolveCampaignForClaim(bound, v2Claim, claimId);
assert.deepStrictEqual({ kind: r.kind, campaign_id: r.campaign_id, via: r.via }, { kind: 'direct', campaign_id: campaignId, via: 'mission_binding' });
// another claim id never binds to it: still the ticket guard
assert.strictEqual(cli.resolveCampaignForClaim(bound, v2Claim, `claim-v1-${H('9')}`).kind, 'ticket_present');

const legacy = admit('legacy', null);
assert.strictEqual(legacy.filter((x) => x.op === 'campaign_mission_binding').length, 0, 'no binding without a Mission claim');
assert.strictEqual(cli.resolveCampaignForClaim(legacy, v2Claim, claimId).kind, 'ticket_present');
console.log('binding-suite ok');
NODE
)"
RC=$?
assert_exit_code "$RC" "0" "intake mission-binding suite exits 0: $OUT"
assert_contains "$OUT" "binding-suite ok" "binding suite reports ok"
finalize_test
