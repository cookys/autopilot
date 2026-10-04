'use strict';

// A managed campaign that really reached TERMINAL_READY, built with the shipped
// writers (run-ledger.sh, appendCampaignEvent, runCampaignComposition,
// campaign-verification, lifecycle-residue-receipt) in a scratch git repo.
// Unlike buildTerminalReadyCampaignLedger, the terminal event pins the digest of
// a REAL implementation_campaign_terminal receipt, which is what the task-status
// reader replays. Returned `terminal` is the in-memory receipt the engine holds
// at the terminal site (the only copy; the ledger keeps its digest).

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

// A COMPLETE Mission whose single claim is bound to the campaign contract, via the
// shipped reducer (same recipe status-task.test.sh uses for its real-artifact oracle).
function writeMissionState({ root, authority, repoIdentity, rootRunId, contractDigest, base }) {
  const mission = require(path.join(root, 'src/engine/mission-convergence'));
  const policyHash = mission.sha256('tsi-policy');
  const authorityId = mission.sha256('tsi-authority');
  let state = mission.createMissionState({
    schema_version: 1,
    artifact_type: 'mission_convergence_contract',
    contract_id: `mission-v1-${mission.sha256('tsi-contract')}`,
    repo_identity: repoIdentity,
    mission_lineage_id: `lineage-v1-${mission.sha256('tsi-lineage')}`,
    task_authority_id: authorityId,
    policy_hash: policyHash,
    enforcement_mode: 'shadow',
    state: 'DRAFT',
    closure_ratio: 0.75,
    max_stagnant_campaigns: 2,
    axes: Object.fromEntries(mission.SUPPORTED_AXES.map((axis) => [axis, {
      authorized_ceiling: axis === 'output_bytes' ? 4096 : 1000,
      reserved_active: 0,
      durable_consumed: 0,
      known: true,
      enforced: true,
    }])),
    grant_contract: {
      idempotency_key_required: true,
      single_use: true,
      expiry_seconds: 3600,
      bindings: [
        'mission_lineage_id', 'task_authority_id', 'campaign_id',
        'campaign_contract_digest', 'base_sha', 'acceptance_ids',
      ],
    },
    control_contract: {
      actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
      allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
      ceiling_loosen_authority: 'authenticated_user',
    },
    lineage_binding: {
      task_authority_id: authorityId,
      root_run_id: rootRunId,
      policy_hash: policyHash,
      successor_inherits_durable_consumed: true,
    },
  });
  const reservation = (toolCalls) => ({
    per_axis: mission.SUPPORTED_AXES.map((axis) => ({
      axis,
      authorized_ceiling: state.axes[axis].authorized_ceiling,
      reserved_active: axis === 'tool_calls' ? toolCalls : (axis === 'campaigns' ? 1 : 0),
      durable_consumed: state.axes[axis].durable_consumed,
      known: true,
    })),
  });
  const reduce = (event_type, payload) => {
    const out = mission.reduceMissionState(state, {
      event_type,
      sequence: state.events.length + 1,
      mission_lineage_id: state.mission_lineage_id,
      payload,
    });
    state = out.state;
    return out.receipt;
  };
  const claimed = reduce('grant_claimed', {
    idempotency_key: 'tsi-claim',
    mission_lineage_id: state.mission_lineage_id,
    task_authority_id: state.task_authority_id,
    campaign_id: 'mission-campaign-v2-tsi',
    campaign_contract_digest: contractDigest,
    base_sha: base,
    acceptance_ids: ['acceptance-tsi'],
    reservation: reservation(5),
    issued_at: '2026-08-05T00:00:00.000Z',
    expires_at: '2026-08-05T01:00:00.000Z',
  });
  reduce('acceptance_satisfied', { acceptance_hash: mission.sha256('acceptance-tsi') });
  reduce('reconciliation', { claim_id: claimed.claim_id, actual_usage: reservation(5) });
  reduce('closure_evaluated', { ratio: 0.9, other_axes_below_ratio: false, unknown_required_axis: false });
  if (state.state !== 'COMPLETE') throw new Error(`mission fixture ended ${state.state}`);
  const dir = path.join(authority, 'mission', 'states');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${mission.sha256('tsi-state')}.json`), JSON.stringify(state));
  return state;
}

function buildFixture({ root, scratch, rootRunId }) {
  const icc = require(path.join(root, 'src/engine/implementation-campaign'));
  const intake = require(path.join(root, 'src/engine/campaign-intake'));
  const verification = require(path.join(root, 'src/engine/campaign-verification'));
  const { runCampaignComposition } = require(path.join(root, 'src/engine/campaign-composition'));
  const runtime = require(path.join(root, 'src/mission/runtime'));
  const mission = require(path.join(root, 'src/engine/mission-convergence'));
  const lifecycle = require(path.join(root, 'scripts/lifecycle-residue-receipt'));
  const {
    openCampaignLedger,
  } = require(path.join(root, 'hooks/tests/lib/implementation-campaign-ledger-fixture'));

  const repo = path.join(scratch, 'repo');
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ['init', '-q', '-b', 'main']);
  git(repo, ['config', 'user.email', 'fixture@example.invalid']);
  git(repo, ['config', 'user.name', 'fixture']);
  fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);

  git(repo, ['checkout', '-q', '-b', 'feat/tsi']);
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'value.txt'), 'candidate\n');
  git(repo, ['add', '.']);
  git(repo, ['commit', '-qm', 'candidate']);
  const candidate = git(repo, ['rev-parse', 'HEAD']);
  const candidateTree = git(repo, ['rev-parse', 'HEAD^{tree}']);
  git(repo, ['checkout', '-q', 'main']);

  const repoInfo = runtime.canonicalRepository(repo);
  const repoIdentity = `git-common-dir:${repoInfo.common}`;
  const authority = path.join(repoInfo.common, 'autopilot');
  fs.mkdirSync(authority, { recursive: true });
  const ledger = path.join(authority, 'implementation-campaign.jsonl');

  const contract = {
    schema_version: 1,
    ticket: 'tsi-fixture',
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: repoIdentity,
    base_sha: base,
    branch: 'feat/tsi',
    vertical_acceptance: ['the task-status input producer has a campaign to read'],
    allowed_path_prefixes: ['src/'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 600,
    verify_cmd: 'node fixture.js',
    rubric_ids: ['TSI1'],
    mission_runtime: { schema_version: 1, root_run_id: rootRunId, graph_node_id: 'tsi-node' },
  };
  const opened = openCampaignLedger({
    root, repo, ledger, contract, startedAt: '2026-08-05T00:00:00.000Z',
  });
  const campaignId = opened.campaignId;

  // The contract the ledger digest names, where mission admission leaves it.
  const contractDir = path.join(authority, 'mission', 'artifacts', 'a'.repeat(64), 'tsi-node', 'attempt-1');
  fs.mkdirSync(contractDir, { recursive: true });
  fs.writeFileSync(path.join(contractDir, 'campaign.json'), JSON.stringify(contract));

  // Lifecycle receipt through the shipped rail, under the authority store.
  const scanPath = path.join(authority, 'tsi-scan.json');
  fs.writeFileSync(scanPath, execFileSync('bash', [
    path.join(root, 'scripts/reap-dispatch-worktrees.sh'), 'scan',
    '--repo', repo, '--root-run-id', campaignId,
  ], { encoding: 'utf8' }));
  const lifecyclePath = path.join(authority, 'tsi-lifecycle.json');
  execFileSync('node', [
    path.join(root, 'scripts/lifecycle-residue-receipt.js'), 'issue',
    '--repo', repo, '--root-run-id', campaignId,
    '--worktree-result', scanPath, '--out', lifecyclePath,
  ], { encoding: 'utf8' });
  const inspected = lifecycle.inspectLifecycleReceipt({
    repo, rootRunId: campaignId, receipt: lifecyclePath,
  });
  if (inspected.status !== 'valid') throw new Error(`lifecycle receipt ${inspected.status}`);
  const lifecycleRef = {
    path: lifecyclePath, root_run_id: campaignId, receipt_digest: inspected.receipt_digest,
  };

  const writerFence = verification.createWriterFence({
    campaignId,
    stageIdentity: 'tsi-implementer',
    candidateCommit: candidate,
    candidateTreeSha: candidateTree,
    implementationResult: {
      status: 'committed',
      implementation: { commit: candidate },
      implementationResult: { status: 0, signal: null, error: null },
    },
  });
  const repairLineage = {
    lineage_id: campaignId,
    branch: 'feat/tsi',
    worktree: path.join(scratch, 'gone-worktree'),
    provider_session_id: null,
    provider_session_reused: false,
    provider_session_non_reuse_reason: 'fixture',
    worktree_reused: false,
    worktree_instance_id: 'b'.repeat(64),
    cleanup_epoch: 1,
    cleanup_receipt_id: null,
    generation: 0,
    inherited_churn: 0,
    delta_churn: 1,
    retention_owner: campaignId,
    retention_reason: 'implementation-campaign-repair-lineage',
    retention_expires_at: 2000000000,
    terminal_worktree_disposition: 'active',
    transcript_reused: false,
    transcript_source_digest: 'a'.repeat(64),
    review_input_mode: 'full_diff_generation',
    new_input_bytes: 0,
    new_input_tokens: null,
    input_token_measurement: 'unavailable',
    finding_occurrences: [],
    accepted_invariant_ids: [],
    accepted_invariants: [],
    accepted_invariants_source_commit: null,
    accepted_invariants_digest: null,
    prior_review_finding_ids: [],
    previous_repair_finding_count: null,
    non_reduction_rounds: 0,
    repair_scope_paths: ['src/value.txt'],
    repair_scope_seal: null,
  };
  const candidateRef = icc.normalizeCampaignArtifactReference({
    kind: 'git_candidate',
    commit: candidate,
    tree_sha: candidateTree,
    branch: 'feat/tsi',
    base,
    writer_fence: writerFence,
    repair_lineage: repairLineage,
  });

  const verifyCmd = 'node fixture.js';
  const request = verification.createVerificationRequest({
    treeSha: candidateTree,
    verifyCmd,
    env: { PATH: '/usr/bin', CI: '1' },
    envAllowlist: ['CI'],
  });
  const attestation = verification.createDetachedCheckoutAttestation({
    candidateCommit: candidate,
    candidateTreeSha: candidateTree,
    worktreeResult: {
      error: null, signal: null, status: 0, detached: true, commit: candidate,
      observed_commit: candidate, observed_tree_sha: candidateTree,
      worktree: path.join(scratch, 'gone-verify'),
    },
  });
  const verificationReceipt = verification.createVerificationReceipt({
    campaignId,
    request,
    exitStatus: 0,
    startedAt: '2026-08-05T00:00:02.000Z',
    endedAt: '2026-08-05T00:00:03.000Z',
    writerFence,
    checkoutAttestation: attestation,
    executedArgv: verification.verificationArgv(verifyCmd),
    stdout: 'ok\n',
  });

  const seat = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_final_panel_seat',
    seat_index: 1,
    runner: 'fixture', model: 'fixture-reviewer', effort: 'high', endpoint: null, family: 'fixture',
    status: 'reviewed', verdict: 'SHIP-AS-IS',
    review_digest: mission.sha256('tsi-final-seat'), reason: null,
  };
  seat.receipt_digest = icc.canonicalDigest(seat);
  const terminal = runCampaignComposition({
    promptBytes: 0,
    maxRepairGenerations: 0,
    minPanelSize: 1,
    lifecycleReceiptRef: lifecycleRef,
  }, {
    preflight: () => ({ passed: true }),
    implement: () => ({ ...candidateRef, committed: true }),
    scopeCheck: () => ({ passed: true }),
    verify: () => ({ ...verificationReceipt, passed: true }),
    review: () => ({
      reviewed: true, verdict: 'SHIP-AS-IS', findings: '[]', review_digest: mission.sha256('tsi-review'),
    }),
    adjudicate: ({ final }) => ({
      registry_complete: true,
      repair_gate_passed: true,
      registry_digest: mission.sha256(final ? 'final-registry' : 'registry'),
      must_fix_now: [],
      follow_up: [],
      rejected: [],
    }),
    convergence: () => ({ passed: true }),
    finalPanel: () => ({
      reviewed: true,
      verdict: 'SHIP-AS-IS',
      findings: '[]',
      review_digest: mission.sha256('tsi-final-review'),
      sealed_min_panel_size: 1,
      final_panel_count: 1,
      final_panel_seat_receipts: [seat],
    }),
  });
  if (terminal.status !== 'ready') throw new Error(`composition ended ${terminal.status}`);

  let control = opened.control;
  const append = (input) => {
    const appended = intake.appendCampaignEvent({ repo, campaignControl: control, ...input });
    control = { ...control, initial_state: appended.state };
    return appended;
  };
  append({
    observedAt: '2026-08-05T00:00:01.000Z',
    eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
    generation: 0,
    stageIdentity: 'campaign-mutation:0',
    payload: { sealed_contract: true },
  });
  append({
    observedAt: '2026-08-05T00:00:02.000Z',
    eventType: icc.CAMPAIGN_EVENTS.IMPLEMENTATION_COMPLETED,
    generation: 0,
    stageIdentity: 'campaign-mutation:0',
    usage: { changed_files: 1, churn: 2 },
    payload: {
      scope_check_passed: true,
      scope_check_digest: icc.canonicalDigest({ fixture: 'scope-check' }),
    },
    artifactReference: candidateRef,
  });
  append({
    observedAt: '2026-08-05T00:00:03.000Z',
    eventType: icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
    generation: 0,
    stageIdentity: 'campaign-verification:0',
    payload: { passed: true, evidence_digest: verificationReceipt.receipt_digest },
    artifactReference: { kind: 'verification_receipt', digest: verificationReceipt.receipt_digest },
  });
  const reviewDigest = icc.canonicalDigest({ fixture: 'product-review' });
  append({
    observedAt: '2026-08-05T00:00:04.000Z',
    eventType: icc.CAMPAIGN_EVENTS.REVIEW_COMPLETED,
    generation: 0,
    stageIdentity: 'campaign-review:0',
    payload: { review_digest: reviewDigest },
    artifactReference: { kind: 'product_review', digest: reviewDigest },
  });
  append({
    observedAt: '2026-08-05T00:00:05.000Z',
    eventType: icc.CAMPAIGN_EVENTS.TERMINAL_READY,
    generation: 0,
    stageIdentity: 'campaign-terminal:0',
    payload: {
      reason: 'campaign acceptance verified',
      registry_complete: true,
      registry_digest: mission.sha256('final-registry'),
      convergence_digest: terminal.receipt_digest,
      lifecycle_receipt_ref: lifecycleRef,
    },
    artifactReference: {
      kind: 'campaign_terminal',
      digest: terminal.receipt_digest,
      repair_lineage: { ...repairLineage },
    },
  });

  // The controller work order the engine persists before the terminal event.
  const orderDir = path.join(authority, 'work-orders', rootRunId);
  fs.mkdirSync(orderDir, { recursive: true });
  fs.writeFileSync(
    path.join(orderDir, 'tsi-node-a1.json'),
    JSON.stringify({ controller: { verification_receipt: verificationReceipt } }),
  );

  const missionState = writeMissionState({
    root,
    authority,
    repoIdentity,
    rootRunId,
    contractDigest: icc.canonicalDigest(contract),
    base,
  });

  return {
    missionState,
    repo, authority, ledger, campaignId, rootRunId, contract, candidate, candidateTree, base,
    terminal: JSON.parse(JSON.stringify(terminal)),
    verificationReceipt, lifecycleRef,
  };
}

module.exports = { buildFixture };
