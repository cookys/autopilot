#!/usr/bin/env bash
# Mission P2 — fail-closed regression oracle.
# Asserts security invariants that are expected RED on base a6a9933.
. "$(dirname "$0")/lib.sh"

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/.claude" "$REPO/src"
git -C "$REPO" init -q
git -C "$REPO" config user.email "failclosed@example.invalid"
git -C "$REPO" config user.name "Fail-Closed Oracle"
write_mission_governance "$REPO/.claude/owner-kernel-governance.json" enforce
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
printf 'failclosed oracle\n' > "$PROMPT"

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
const identity = require(path.join(root, 'src', 'engine', 'mission-campaign-identity'));
const { runCampaignIntake } = require(path.join(root, 'src', 'engine', 'campaign-intake'));

const lines = [];
const check = (id, value) => lines.push(`${id}\t${value ? 'PASS' : 'FAIL'}`);
const repoIdentity = `git-common-dir:${common}`;
const missionLineageId = 'lineage-v1-' + m.sha256('fc-lineage');
const missionPolicyDigest = m.sha256('fc-mission-policy');
const rootRunId = 'fc-root';
const graphNode = {
  id: 'failclosed-node',
  source_plan_ids: ['MISSION'],
  source_rubric_ids: ['FC-P2-1'],
  dependencies: [],
  acceptance_ids: ['fail-closed regression'],
  verification_commands: ['node fixture.js'],
  gate_attempt_budget: 2,
  reservation: {
    campaigns: 1,
    wall_seconds: 0,
    tool_calls: 1,
    engine_attempts: 0,
    external_wait_seconds: 0,
    canonical_changed_files: 0,
    output_bytes: 0,
  },
  campaign: {
    profile: 'poc',
    allowed_path_prefixes: ['src/'],
    spec: { path: 'src/value.txt', section: 'Fail closed' },
    required_paths: ['src/value.txt'],
    output_paths: ['src/value.txt'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 120,
  },
};
const executionGraph = {
  schema_version: 1,
  artifact_type: 'mission_execution_graph',
  nodes: [graphNode],
};
const missionGraphDigest = m.sha256(m.canonicalJson(executionGraph));
const acceptanceHash = m.sha256(m.canonicalJson({
  schema_version: 1,
  acceptance_id: graphNode.acceptance_ids[0],
}));

const draft = {
  schema_version: 1,
  ticket: 'failclosed-p2',
  profile: 'poc',
  mission_grant_ref: null,
  repo_identity: repoIdentity,
  base_sha: base,
  branch: 'main',
  vertical_acceptance: ['fail-closed regression'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: 4,
  baseline_churn: 10,
  max_growth_ratio: 1.5,
  max_extra_churn: 5,
  max_repair_generations: 2,
  max_wall_seconds: 120,
  verify_cmd: 'node fixture.js',
  rubric_ids: ['FC-P2-1'],
  mission_runtime: {
    schema_version: 1,
    root_run_id: rootRunId,
    mission_lineage_id: missionLineageId,
    mission_policy_digest: missionPolicyDigest,
    mission_graph_digest: missionGraphDigest,
    graph_node_id: graphNode.id,
    graph_node_digest: m.sha256(m.canonicalJson(graphNode)),
  },
  strict_dispatch: {
    schema_version: 1,
    spec: graphNode.campaign.spec,
    required_paths: graphNode.campaign.required_paths,
    output_paths: graphNode.campaign.output_paths,
    allowed_path_prefixes: graphNode.campaign.allowed_path_prefixes,
    budget: {
      max_changed_files: graphNode.campaign.max_changed_files,
      max_wall_seconds: graphNode.campaign.max_wall_seconds,
      max_output_bytes: graphNode.reservation.output_bytes,
      max_tool_calls: graphNode.reservation.tool_calls,
      max_engine_attempts: graphNode.reservation.engine_attempts,
    },
    verification_commands: graphNode.verification_commands,
  },
};

const subject = engine.missionSubjectDigest(draft);
const campaignId = engine.missionCampaignIdFor(repoIdentity, draft.ticket, subject);
const graphClaimFields = {
  acceptance_ids: draft.vertical_acceptance,
  acceptance_hashes: [acceptanceHash],
  graph_node_id: graphNode.id,
  graph_attempt: 1,
  campaign_contract_draft: draft,
};

function buildMissionContract(authoritySeed) {
  return {
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: 'mission-v1-' + m.sha256('fc-' + authoritySeed),
    repo_identity: repoIdentity,
    mission_lineage_id: missionLineageId,
    task_authority_id: m.sha256('fc-authority-' + authoritySeed),
    policy_hash: m.sha256('fc-policy'),
    mission_policy_digest: missionPolicyDigest,
    mission_graph_digest: missionGraphDigest,
    initial_required_acceptance_hashes: [m.sha256('fc-initial-acceptance')],
    required_acceptance_hashes: [acceptanceHash],
    execution_graph: executionGraph,
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
      task_authority_id: m.sha256('fc-authority-' + authoritySeed),
      root_run_id: rootRunId,
      policy_hash: m.sha256('fc-policy'),
      successor_inherits_durable_consumed: true,
    },
  };
}

function buildReservation(s0) {
  return {
    per_axis: m.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: s0.axes[axis].authorized_ceiling,
      reserved_active: axis === 'campaigns' || axis === 'tool_calls' ? 1 : 0,
      durable_consumed: 0,
      known: true,
    })),
  };
}

// ─── GAP 1: binding digest must change when task_authority_id changes ───
{
  const mcA = buildMissionContract('alpha');
  const mcB = buildMissionContract('beta');
  const sA = m.createMissionState(mcA);
  const sB = m.createMissionState(mcB);
  const reservationA = buildReservation(sA);
  const reservationB = buildReservation(sB);

  const claimA = m.reduceMissionState(sA, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: sA.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'fc-gap1-a',
      mission_lineage_id: sA.mission_lineage_id,
      task_authority_id: sA.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      ...graphClaimFields,
      reservation: reservationA,
      issued_at: '2026-07-28T00:00:00.000Z',
      expires_at: '2026-07-28T01:00:00.000Z',
    },
  });
  const claimB = m.reduceMissionState(sB, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: sB.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'fc-gap1-b',
      mission_lineage_id: sB.mission_lineage_id,
      task_authority_id: sB.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      ...graphClaimFields,
      reservation: reservationB,
      issued_at: '2026-07-28T00:00:00.000Z',
      expires_at: '2026-07-28T01:00:00.000Z',
    },
  });
  const digestA = claimA.receipt && claimA.receipt.binding_digest;
  const digestB = claimB.receipt && claimB.receipt.binding_digest;
  check('gap1-authority-change-alters-binding-digest',
    typeof digestA === 'string' && typeof digestB === 'string' && digestA !== digestB);
}

// ─── GAP 2: legacy claim (no identity_scheme) must not be promoted to v2 ───
{
  const mc = buildMissionContract('legacy');
  const s0 = m.createMissionState(mc);
  const reservation = buildReservation(s0);
  const claimed = m.reduceMissionState(s0, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'fc-gap2-setup',
      mission_lineage_id: s0.mission_lineage_id,
      task_authority_id: s0.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      ...graphClaimFields,
      reservation,
      issued_at: '2026-07-28T00:00:00.000Z',
      expires_at: '2026-07-28T01:00:00.000Z',
    },
  });
  // Forge a legacy claim: strip identity_scheme, keep campaign_id and digest
  // so isMissionSubjectV2Claim heuristic would promote it.
  const claimId = claimed.receipt.claim_id;
  const forgedState = JSON.parse(JSON.stringify(claimed.state));
  forgedState.claims[claimId].identity_scheme = null;
  // campaign_id still matches /^campaign-v2-.../ and campaign_contract_digest
  // equals subject — the heuristic promotion vector.

  const legacyContract = { ...draft, mission_grant_ref: claimed.receipt.binding_digest };
  const legacyContractPath = contractPath + '.legacy';
  const legacyStatePath = statePath + '.legacy';
  const legacySealPath = sealPath + '.legacy';
  fs.writeFileSync(legacyContractPath, JSON.stringify(legacyContract, null, 2) + '\n');
  fs.writeFileSync(legacyStatePath, JSON.stringify(forgedState, null, 2) + '\n', { mode: 0o600 });

  const checker = path.join(root, 'scripts', 'implementation-campaign-check.js');
  const sealResult = spawnSync(process.execPath, [checker, 'seal',
    '--contract', legacyContractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', legacyStatePath, '--out', legacySealPath], { encoding: 'utf8' });
  // Must reject: a claim without explicit identity_scheme is legacy, not v2.
  const rejected = sealResult.status !== 0;
  const semanticRejection = rejected
    && /identity|scheme|legacy|not.*v2|mismatch|campaign_contract_digest does not match the sealed contract/i.test(sealResult.stdout + sealResult.stderr);
  check('gap2-legacy-claim-not-promoted-to-v2', semanticRejection);
}

// ─── GAP 3: intake must reject claimed result with missing/empty campaign_id ───
{
  const mc = buildMissionContract('intake');
  const s0 = m.createMissionState(mc);
  const reservation = buildReservation(s0);
  const claimed = m.reduceMissionState(s0, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'fc-gap3-setup',
      mission_lineage_id: s0.mission_lineage_id,
      task_authority_id: s0.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      ...graphClaimFields,
      reservation,
      issued_at: '2026-07-28T00:00:00.000Z',
      expires_at: '2026-07-28T01:00:00.000Z',
    },
  });
  const finalContract = { ...draft, mission_grant_ref: claimed.receipt.binding_digest };
  const gap3ContractPath = contractPath + '.gap3';
  const gap3StatePath = statePath + '.gap3';
  const gap3SealPath = sealPath + '.gap3';
  fs.writeFileSync(gap3ContractPath, JSON.stringify(finalContract, null, 2) + '\n');
  fs.writeFileSync(gap3StatePath, JSON.stringify(claimed.state, null, 2) + '\n', { mode: 0o600 });

  const checker = path.join(root, 'scripts', 'implementation-campaign-check.js');
  const sealRes = spawnSync(process.execPath, [checker, 'seal',
    '--contract', gap3ContractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', gap3StatePath, '--out', gap3SealPath], { encoding: 'utf8' });

  if (sealRes.status === 0) {
    // Adapter returns claimed with EMPTY campaign_id — must not reach readiness.
    let stored = claimed.state;
    const adapters = {
      missionClaim: () => ({
        owner: 'mission', status: 'claimed', resumed: true,
        claim_id: claimed.receipt.claim_id,
        campaign_id: '',
      }),
      releaseMission: () => ({ owner: 'mission_release', status: 'released' }),
      readiness: () => ({
        owner: 'provider_readiness', status: 'ready',
      }),
    };
    const intake = runCampaignIntake({
      repo, contractPath: gap3ContractPath, sealPath: gap3SealPath,
      promptFile: promptPath, branch: 'main', base,
      observedAt: '2026-07-28T00:00:01.000Z',
    }, adapters);
    // Must be blocked before readiness with a semantic campaign_id rejection.
    const blockedBeforeReadiness = intake.status === 'blocked'
      && intake.rejection
      && /campaign_id/i.test(intake.rejection.code || intake.rejection.reason || '');
    check('gap3-empty-campaign-id-rejected-before-readiness', blockedBeforeReadiness);
  } else {
    check('gap3-empty-campaign-id-rejected-before-readiness', false);
  }
}

// ─── GAP 4: seal must fail closed on missing/mismatched lineage or authority ───
{
  const mc = buildMissionContract('seal');
  const s0 = m.createMissionState(mc);
  const reservation = buildReservation(s0);
  const claimed = m.reduceMissionState(s0, {
    event_type: 'grant_claimed',
    sequence: 1,
    mission_lineage_id: s0.mission_lineage_id,
    payload: {
      identity_scheme: 'mission-subject-v2',
      idempotency_key: 'fc-gap4-setup',
      mission_lineage_id: s0.mission_lineage_id,
      task_authority_id: s0.task_authority_id,
      campaign_id: campaignId,
      mission_subject_digest: subject,
      campaign_contract_digest: subject,
      base_sha: base,
      ...graphClaimFields,
      reservation,
      issued_at: '2026-07-28T00:00:00.000Z',
      expires_at: '2026-07-28T01:00:00.000Z',
    },
  });

  // 4a: legitimate v2 claims must durably store mission_lineage_id and task_authority_id
  const claimId = claimed.receipt.claim_id;
  const storedClaim = claimed.state.claims[claimId];
  check('gap4a-claim-stores-mission-lineage-id',
    storedClaim && storedClaim.mission_lineage_id === s0.mission_lineage_id);
  check('gap4a-claim-stores-task-authority-id',
    storedClaim && storedClaim.task_authority_id === s0.task_authority_id);

  // 4b: seal must reject when claim lacks mission_lineage_id
  const noLineageState = JSON.parse(JSON.stringify(claimed.state));
  delete noLineageState.claims[claimId].mission_lineage_id;
  const gap4Contract = { ...draft, mission_grant_ref: claimed.receipt.binding_digest };
  const gap4ContractPath = contractPath + '.gap4';
  const gap4StateNoLineage = statePath + '.gap4-nolineage';
  const gap4SealNoLineage = sealPath + '.gap4-nolineage';
  fs.writeFileSync(gap4ContractPath, JSON.stringify(gap4Contract, null, 2) + '\n');
  fs.writeFileSync(gap4StateNoLineage, JSON.stringify(noLineageState, null, 2) + '\n', { mode: 0o600 });

  const checker = path.join(root, 'scripts', 'implementation-campaign-check.js');
  const sealNoLineage = spawnSync(process.execPath, [checker, 'seal',
    '--contract', gap4ContractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', gap4StateNoLineage, '--out', gap4SealNoLineage], { encoding: 'utf8' });
  const noLineageRejected = sealNoLineage.status !== 0
    && /lineage|mismatch|missing|identity/i.test(sealNoLineage.stdout + sealNoLineage.stderr);
  check('gap4b-seal-rejects-missing-lineage-in-claim', noLineageRejected);

  // 4c: seal must reject when claim has mismatched task_authority_id
  const badAuthState = JSON.parse(JSON.stringify(claimed.state));
  badAuthState.claims[claimId].task_authority_id = m.sha256('wrong-authority');
  const gap4StateBadAuth = statePath + '.gap4-badauth';
  const gap4SealBadAuth = sealPath + '.gap4-badauth';
  fs.writeFileSync(gap4StateBadAuth, JSON.stringify(badAuthState, null, 2) + '\n', { mode: 0o600 });

  const sealBadAuth = spawnSync(process.execPath, [checker, 'seal',
    '--contract', gap4ContractPath, '--repo', repo, '--mission-mode', 'enforce',
    '--mission-state', gap4StateBadAuth, '--out', gap4SealBadAuth], { encoding: 'utf8' });
  const badAuthRejected = sealBadAuth.status !== 0
    && /authority|mismatch|binding/i.test(sealBadAuth.stdout + sealBadAuth.stderr);
  check('gap4c-seal-rejects-mismatched-authority-in-claim', badAuthRejected);
}

for (const line of lines) console.log(line);
NODE
)"
assert_exit_code "$?" "0" "fail-closed oracle harness executes"

for id in \
  gap1-authority-change-alters-binding-digest \
  gap2-legacy-claim-not-promoted-to-v2 \
  gap3-empty-campaign-id-rejected-before-readiness \
  gap4a-claim-stores-mission-lineage-id \
  gap4a-claim-stores-task-authority-id \
  gap4b-seal-rejects-missing-lineage-in-claim \
  gap4c-seal-rejects-mismatched-authority-in-claim
do
  assert_contains "$OUT" "$id	PASS" "Mission P2 fail-closed invariant $id"
done

finalize_test
