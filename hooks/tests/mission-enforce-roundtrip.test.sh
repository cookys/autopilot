#!/usr/bin/env bash
# Mission P2 — constructible enforce identity roundtrip oracle (RED).
. "$(dirname "$0")/lib.sh"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/.claude" "$REPO/src"
git -C "$REPO" init -q
git -C "$REPO" config user.email "mission-roundtrip@example.invalid"
git -C "$REPO" config user.name "Mission Roundtrip Oracle"
printf '%s\n' '{"mission_convergence":{"enforcement_mode":"enforce"}}' \
  > "$REPO/.claude/owner-kernel-governance.json"
printf 'base\n' > "$REPO/src/value.txt"
git -C "$REPO" add .
git -C "$REPO" commit -qm "base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
COMMON_RAW="$(git -C "$REPO" rev-parse --git-common-dir)"
COMMON="$(realpath "$REPO/$COMMON_RAW")"
CONTRACT="$TEST_TMP/campaign.json"
STATE="$TEST_TMP/mission-state.json"
SEAL="$TEST_TMP/campaign.seal.json"
PROMPT="$TEST_TMP/prompt.txt"
printf 'mission enforce roundtrip\n' > "$PROMPT"

OUT="$(node - "$REPO_ROOT" "$REPO" "$COMMON" "$BASE" "$CONTRACT" "$STATE" "$SEAL" "$PROMPT" <<'NODE'
'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const [root, repo, common, base, contractPath, statePath, sealPath, promptPath] =
  process.argv.slice(2);
const engine = require(path.join(root, 'src', 'engine'));
const m = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { runCampaignIntake } = require(path.join(root, 'src', 'engine', 'campaign-intake'));

const lines = [];
const check = (id, value) => lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
const shaBytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const repoIdentity = `git-common-dir:${common}`;
const draft = {
  schema_version: 1,
  ticket: 'mission-p2-roundtrip',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: repoIdentity,
  base_sha: base,
  branch: 'main',
  vertical_acceptance: ['constructible enforce identity roundtrip'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['MISSION-P2-SUBJECT1'],
};

const subjectFn = engine.missionSubjectDigest;
const campaignIdFn = engine.missionCampaignIdFor;
check('subject-api-present', typeof subjectFn === 'function');
check('campaign-v2-api-present', typeof campaignIdFn === 'function');

if (typeof subjectFn === 'function' && typeof campaignIdFn === 'function') {
  const subject = subjectFn(draft);
  const campaignId = campaignIdFn(repoIdentity, draft.ticket, subject);
  check('draft-subject-is-sha256', /^[0-9a-f]{64}$/.test(subject));
  check('draft-campaign-id-is-v2', /^campaign-v2-[0-9a-f]{64}$/.test(campaignId));

  const missionContract = {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: 'mission-v1-' + m.sha256('roundtrip'),
    repo_identity: repoIdentity,
    mission_lineage_id: 'lineage-v1-' + m.sha256('roundtrip-lineage'),
    task_authority_id: m.sha256('roundtrip-authority'),
    policy_hash: m.sha256('roundtrip-policy'),
    enforcement_mode: 'enforce',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: Object.fromEntries(m.SUPPORTED_AXES.map((axis) => [axis, {
      authorized_ceiling: axis === 'campaigns' ? 4 : 1000,
      reserved_active: 0, durable_consumed: 0, known: true, enforced: true,
    }])),
    grant_contract: {
      idempotency_key_required: true, single_use: true, expiry_seconds: 3600,
      bindings: ['mission_lineage_id', 'task_authority_id', 'campaign_id',
        'mission_subject_digest', 'base_sha', 'acceptance_ids'],
    },
    control_contract: {
      actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
      allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
      ceiling_loosen_authority: 'authenticated_user',
    },
    lineage_binding: {
      task_authority_id: m.sha256('roundtrip-authority'),
      root_run_id: 'roundtrip-root',
      policy_hash: m.sha256('roundtrip-policy'),
      successor_inherits_durable_consumed: true,
    },
  };
  const s0 = m.createMissionState(missionContract);
  const reservation = {
    per_axis: m.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: s0.axes[axis].authorized_ceiling,
      reserved_active: axis === 'campaigns' || axis === 'tool_calls' ? 1 : 0,
      durable_consumed: 0,
      known: true,
    })),
  };
  const claimed = m.reduceMissionState(s0, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'roundtrip-grant',
      mission_lineage_id: s0.mission_lineage_id,
      task_authority_id: s0.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      acceptance_ids: draft.rubric_ids,
      reservation,
      issued_at: '2026-07-27T00:00:00.000Z',
      expires_at: '2026-07-27T01:00:00.000Z',
    },
  });
  check('v2-claim-created', claimed.receipt.artifact_type === 'mission_campaign_grant_claimed'
    && /^[0-9a-f]{64}$/.test(claimed.receipt.binding_digest));

  const finalContract = { ...draft, mission_grant_ref: claimed.receipt.binding_digest };
  fs.writeFileSync(contractPath, `${JSON.stringify(finalContract, null, 2)}\n`);
  fs.writeFileSync(statePath, `${JSON.stringify(claimed.state, null, 2)}\n`, { mode: 0o600 });
  const finalRaw = shaBytes(fs.readFileSync(contractPath));
  check('final-raw-differs-from-subject', finalRaw !== subject);
  check('subject-stable-after-ref-insertion', subjectFn(finalContract) === subject);
  check('campaign-v2-stable-after-ref-insertion',
    campaignIdFn(repoIdentity, finalContract.ticket, subjectFn(finalContract)) === campaignId);

  const checker = path.join(root, 'scripts', 'implementation-campaign-check.js');
  const seal = spawnSync(process.execPath, [checker, 'seal',
    '--contract', contractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', statePath, '--out', sealPath], { encoding: 'utf8' });
  check('real-enforce-seal-succeeds', seal.status === 0
    && /"verdict"\s*:\s*"SEALED"/.test(seal.stdout));
  let sealed = null;
  try { sealed = JSON.parse(fs.readFileSync(sealPath, 'utf8')); } catch (_error) { sealed = null; }
  check('seal-binds-raw-and-v2-identity', sealed
    && sealed.contract_sha256 === finalRaw
    && sealed.identity_scheme === 'mission-subject-v2'
    && sealed.mission_subject_digest === subject
    && sealed.campaign_id === campaignId
    && sealed.claim_id === claimed.receipt.claim_id
    && sealed.mission_grant_ref === claimed.receipt.binding_digest);

  if (sealed) {
    let stored = claimed.state;
    const adapters = {
      ...engine.createMissionCampaignAdapters({
        store: {
          load: () => stored,
          save: (expected, next) => {
            if (stored !== expected) return false;
            stored = next;
            return true;
          },
        },
        grant_ref: claimed.receipt.binding_digest,
        mission_subject_digest: subject,
        campaign_id: campaignId,
      }),
      readiness: () => ({
        owner: 'provider_readiness', status: 'rejected',
        code: 'oracle_stop', reason: 'stop after trusted Mission claim',
      }),
    };
    const intake = runCampaignIntake({
      repo, contractPath, sealPath, promptFile: promptPath,
      branch: 'main', base, observedAt: '2026-07-27T00:00:01.000Z',
    }, adapters);
    check('canonical-intake-resumes-exact-v2-claim', intake.status === 'blocked'
      && intake.steps[0].owner === 'mission'
      && intake.steps[0].claim_id === claimed.receipt.claim_id
      && intake.steps[0].resumed === true);
    check('downstream-rejection-releases-once', intake.rejection.owner === 'provider_readiness'
      && intake.steps.filter((step) => step.owner === 'mission_release').length === 1);
  } else {
    lines.push('canonical-intake-resumes-exact-v2-claim\tFAIL');
    lines.push('downstream-rejection-releases-once\tFAIL');
  }

  const mutated = { ...finalContract, max_changed_files: finalContract.max_changed_files + 1 };
  const mutatedPath = `${contractPath}.mutated`;
  fs.writeFileSync(mutatedPath, `${JSON.stringify(mutated, null, 2)}\n`);
  const mutation = spawnSync(process.execPath, [checker, 'seal',
    '--contract', mutatedPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', statePath, '--out', `${sealPath}.mutated`], { encoding: 'utf8' });
  check('governed-field-mutation-rejected', mutation.status === 3
    && /subject|binding|grant/i.test(mutation.stdout));

  fs.appendFileSync(contractPath, ' ');
  const drift = spawnSync(process.execPath, [checker, 'check',
    '--contract', contractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--seal', sealPath], { encoding: 'utf8' });
  check('raw-whitespace-drift-rejected', drift.status === 3 && /DRIFT/.test(drift.stdout));
  check('subject-ignores-raw-whitespace', subjectFn(JSON.parse(fs.readFileSync(contractPath))) === subject);
}

for (const line of lines) console.log(line);
NODE
)"
assert_exit_code "$?" "0" "roundtrip oracle harness executes"

for id in \
  subject-api-present campaign-v2-api-present draft-subject-is-sha256 \
  draft-campaign-id-is-v2 v2-claim-created final-raw-differs-from-subject \
  subject-stable-after-ref-insertion campaign-v2-stable-after-ref-insertion \
  real-enforce-seal-succeeds seal-binds-raw-and-v2-identity \
  canonical-intake-resumes-exact-v2-claim downstream-rejection-releases-once \
  governed-field-mutation-rejected raw-whitespace-drift-rejected \
  subject-ignores-raw-whitespace
do
  assert_contains "$OUT" "$id	PASS" "Mission enforce roundtrip invariant $id"
done

finalize_test
