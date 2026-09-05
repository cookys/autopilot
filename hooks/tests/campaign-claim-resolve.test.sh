#!/usr/bin/env bash
# campaign-claim-resolve.test.sh — resolveCampaignForClaim (src/campaign/cli.js, v2.36.6):
# what `mission withdraw` may conclude about a Mission claim from a campaign ledger's rows.
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" <<'NODE'
const path = require('path');
const assert = require('assert');
const root = process.argv[2];
const { resolveCampaignForClaim } = require(path.join(root, 'src', 'campaign', 'cli'));
const H = (c) => c.repeat(64);
const intake = (runId, ticket, extra = {}) => ({
  kind: 'journal', op: 'campaign_intake', run_id: runId,
  payload: { schema_version: 1, artifact_type: 'implementation_campaign_intake', campaign_id: runId,
    contract_digest: H('d'), initial_state: { campaign_id: runId, ticket, phase: 'running' },
    initial_state_digest: H('e') },
  ...extra,
});
const v2Claim = (ticket) => ({
  claim_id: `claim-v1-${H('1')}`, identity_scheme: 'mission-subject-v2', campaign_id: `campaign-v2-${H('2')}`,
  campaign_contract_digest: H('3'), campaign_contract_draft: { ticket },
});
const legacyClaim = { claim_id: `claim-v1-${H('4')}`, campaign_id: `campaign-v1-${H('5')}`, campaign_contract_digest: H('d') };

// 1. absent: empty ledger
assert.deepStrictEqual(resolveCampaignForClaim([], v2Claim('T-1')), { kind: 'absent' });
// 2. absent: only OTHER tickets present — a different campaign in the same ledger is not evidence
assert.deepStrictEqual(resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-other')], v2Claim('T-1')), { kind: 'absent' });
// 3. ticket_present: the claim's own ticket has an intake root ⇒ never bind, never release as never-started.
//    (projectCampaign needs a full ledger shape to compute a phase; with these synthetic rows the phase is
//    reported as null/unknown — the refusal must not depend on it.)
const tp = resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-1')], v2Claim('T-1'));
assert.strictEqual(tp.kind, 'ticket_present');
assert.deepStrictEqual(tp.roots.map((r) => r.campaign_id), [`campaign-v1-${H('a')}`]);
assert.strictEqual(tp.ticket, 'T-1');
// 4. rotation-carry rows COUNT (review 🔴: after segment GC they can be the only copy of a live campaign)
const tpCarry = resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-1', { _rotation_carry: true, _rotation_root: 'x' })], v2Claim('T-1'));
assert.strictEqual(tpCarry.kind, 'ticket_present', 'a carried intake root still blocks never-started');
// 5. duplicates collapse on run_id
const tpDup = resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-1'), intake(`campaign-v1-${H('a')}`, 'T-1', { _rotation_carry: true, _rotation_root: 'x' })], v2Claim('T-1'));
assert.strictEqual(tpDup.roots.length, 1);
// 6. two roots, same ticket ⇒ both listed (still a refusal upstream)
const tp2 = resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-1'), intake(`campaign-v1-${H('b')}`, 'T-1')], v2Claim('T-1'));
assert.strictEqual(tp2.roots.length, 2);
// 7. corrupt payload THROWS (review 🟠: unreadable must not read as absent)
assert.throws(() => resolveCampaignForClaim([{ kind: 'journal', op: 'campaign_intake', run_id: `campaign-v1-${H('a')}`, payload: '{not json' }], v2Claim('T-1')), /invalid JSON payload/);
// 8. legacy (v1) claim with no draft ticket: no ticket guard applies; absent when its id has no rows
assert.deepStrictEqual(resolveCampaignForClaim([intake(`campaign-v1-${H('a')}`, 'T-1')], legacyClaim), { kind: 'absent' });
// 9. string payloads are parsed like objects
const tpStr = resolveCampaignForClaim([{ ...intake(`campaign-v1-${H('a')}`, 'T-1'), payload: JSON.stringify(intake('x', 'T-1').payload) }], v2Claim('T-1'));
assert.strictEqual(tpStr.kind, 'ticket_present');
// 10. v2 claim with NO draft ticket ⇒ unknown_v2 (never absent — review 🟡)
assert.deepStrictEqual(resolveCampaignForClaim([], { claim_id: `claim-v1-${H('6')}`, identity_scheme: 'mission-subject-v2', campaign_id: `campaign-v2-${H('7')}`, campaign_contract_draft: null }), { kind: 'unknown_v2' });
console.log('resolve-suite ok');
NODE
)"
RC=$?
assert_exit_code "$RC" "0" "resolveCampaignForClaim unit suite exits 0: $OUT"
assert_contains "$OUT" "resolve-suite ok" "resolve suite reports ok"
finalize_test
