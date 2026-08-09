'use strict';

// Builds an implementation-campaign JSONL ledger that projects to
// TERMINAL_READY, by driving the SHIPPED writers and reducer rather than
// hand-authoring rows.
//
// next-touch-validation.test.sh used to read the campaign ledger that one real
// historical run had left in this machine's .git/autopilot. That file is not
// versioned, so a clean clone had nothing to read and the suite crashed on
// ENOENT — permanently red in CI, green only where the residue happened to sit.
// Hand-authoring a replacement JSONL would have swapped one unverified artifact
// for another: it would prove the projector can parse bytes someone typed, not
// that production can produce them. So every row here comes out of a shipped
// writer:
//
//   * scripts/run-ledger.sh init / stage-acquire / journal-add  — the ledger
//     itself and the campaign_intake root, exactly as
//     campaign-intake.js defaultGenerationClaim writes them;
//   * src/engine/campaign-intake.js appendCampaignEvent          — every
//     campaign_event row, which builds the event, runs the real
//     reduceCampaignState, and journals the wrapper the projector validates;
//   * scripts/reap-dispatch-worktrees.sh + scripts/lifecycle-residue-receipt.js
//     — the LifecycleResidueReceipt whose digest the terminal event pins.
//
// Two suites share it. next-touch-validation.test.sh needs a whole
// terminal-ready campaign; implementation-campaign-dogfood.test.sh's
// rotation-aware block needs only the intake root before it starts forcing
// segment rollover, so openCampaignLedger is a separate export from
// driveCampaignToTerminalReady.
//
// Shape notes that are not obvious from the call sites:
//   * The candidate has to be a real commit in the repository under test —
//     normalizeCampaignArtifactReference only accepts 40/64-hex object ids, and
//     the consumer compares tree_sha against git truth.
//   * writer_fence and repair_lineage are closed key sets (see
//     implementation-campaign.js normalizeCampaignArtifactReference /
//     validateRepairLineage). Adding a field is as fatal as omitting one.
//   * lifecycle_receipt_ref must carry exactly {path, root_run_id,
//     receipt_digest}; src/campaign/cli.js rejects any other shape at the
//     terminal event, and next-touch-validation.js then re-reads the file at
//     that path and re-checks the digest.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_TICKET = 'ntv-ledger-fixture';
const DEFAULT_STARTED_AT = '2026-08-05T00:00:00.000Z';

function requireModules(root) {
  return {
    icc: require(path.join(root, 'src', 'engine', 'implementation-campaign')),
    intake: require(path.join(root, 'src', 'engine', 'campaign-intake')),
    verification: require(path.join(root, 'src', 'engine', 'campaign-verification')),
    lineage: require(path.join(root, 'src', 'engine', 'repair-lineage-cleanup')),
    campaignCli: require(path.join(root, 'src', 'campaign', 'cli')),
    runtime: require(path.join(root, 'src', 'mission', 'runtime')),
    lifecycle: require(path.join(root, 'scripts', 'lifecycle-residue-receipt')),
  };
}

function runLedgerScript(root, repo, args, env) {
  return execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, ...(env || {}) },
  }).trim();
}

function git(repo, args) {
  return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
}

/**
 * A schema-valid implementation campaign contract. Mirrors the shape
 * implementation-campaign-routing.test.sh seals, so the identity the fixture
 * produces is the identity production would.
 */
function campaignLedgerContract({ repoIdentity, ticket, baseSha, branch } = {}) {
  if (!repoIdentity) throw new TypeError('campaignLedgerContract requires repoIdentity');
  if (!baseSha) throw new TypeError('campaignLedgerContract requires baseSha');
  if (!branch) throw new TypeError('campaignLedgerContract requires branch');
  return {
    schema_version: 1,
    ticket: ticket || DEFAULT_TICKET,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: repoIdentity,
    base_sha: baseSha,
    branch,
    vertical_acceptance: ['the campaign ledger fixture reaches a terminal-ready projection'],
    allowed_path_prefixes: ['src/'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 600,
    verify_cmd: 'node fixture.js',
    rubric_ids: ['NTV-LEDGER1'],
  };
}

/**
 * init + stage-acquire + the campaign_intake journal root, through
 * scripts/run-ledger.sh. Returns the campaign control object appendCampaignEvent
 * consumes, so a caller can keep appending without rebuilding identity.
 *
 * @param {object} options
 * @param {string} options.root      repository providing the modules and scripts
 * @param {string} options.repo      repository the ledger belongs to (cwd for run-ledger)
 * @param {string} options.ledger    absolute ledger path
 * @param {object} [options.contract] campaign contract; built from repoIdentity when absent
 * @param {string} [options.startedAt] ISO timestamp for the initial state
 * @param {object} [options.env]     extra environment for run-ledger.sh (rotation knobs)
 */
function openCampaignLedger({ root, repo, ledger, contract, startedAt, env } = {}) {
  if (!root) throw new TypeError('openCampaignLedger requires root');
  if (!repo) throw new TypeError('openCampaignLedger requires repo');
  if (!ledger) throw new TypeError('openCampaignLedger requires ledger');
  if (!contract) throw new TypeError('openCampaignLedger requires contract');
  const { icc } = requireModules(root);

  const contractDigest = icc.canonicalDigest(contract);
  const initialState = icc.createCampaignState({
    contract,
    contractDigest,
    repoIdentity: contract.repo_identity,
    startedAt: startedAt || DEFAULT_STARTED_AT,
  });
  const campaignId = icc.campaignIdFor(contract.repo_identity, contract.ticket, contractDigest);
  if (initialState.campaign_id !== campaignId) {
    throw new Error('campaign ledger fixture identity does not match its contract');
  }

  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  runLedgerScript(root, repo, ['init', '--ledger', ledger], env);
  const acquired = JSON.parse(runLedgerScript(root, repo, [
    'stage-acquire', '--ledger', ledger,
    '--run-id', campaignId, '--stage', 'campaign',
    '--pid', String(process.pid),
    '--resources', `campaign:${campaignId}`,
  ], env));

  const intakePayload = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_intake',
    campaign_id: campaignId,
    contract_digest: initialState.contract_digest,
    initial_state: initialState,
    initial_state_digest: icc.canonicalDigest(initialState),
  };
  runLedgerScript(root, repo, [
    'journal-add', '--ledger', ledger,
    '--run-id', campaignId, '--stage', 'campaign',
    '--generation', String(acquired.generation), '--nonce', acquired.nonce,
    '--idempotency-key', `intake:${campaignId}`,
    '--op', 'campaign_intake',
    '--payload', JSON.stringify(intakePayload),
  ], env);

  return {
    campaignId,
    contract,
    contractDigest,
    initialState,
    // The exact bytes journaled as the intake root; a caller replaying them
    // under a second idempotency key is testing duplicate-intake rejection.
    intakePayload,
    ledger,
    generation: acquired.generation,
    nonce: acquired.nonce,
    control: {
      status: 'admitted',
      campaign_id: campaignId,
      contract_digest: contractDigest,
      contract,
      initial_state: initialState,
      generation_claim: {
        ledger,
        generation: acquired.generation,
        nonce: acquired.nonce,
        durable_journal: true,
      },
    },
  };
}

// The closed repair-lineage key set validateRepairLineage enforces. Only the
// identity fields vary per fixture; the rest describe a first-generation,
// full-diff, no-findings implementation, which is the simplest lineage the
// validator accepts.
function repairLineageFor({ icc, campaignId, branch, worktree, worktreeInstanceId, candidate }) {
  return {
    lineage_id: campaignId,
    branch,
    worktree,
    provider_session_id: null,
    provider_session_reused: false,
    provider_session_non_reuse_reason: 'fixture_never_dispatched_a_provider',
    worktree_reused: false,
    worktree_instance_id: worktreeInstanceId,
    cleanup_epoch: 1,
    cleanup_receipt_id: null,
    generation: 0,
    inherited_churn: 0,
    delta_churn: 2,
    retention_owner: campaignId,
    retention_reason: 'implementation-campaign-repair-lineage',
    retention_expires_at: 2000000000,
    terminal_worktree_disposition: 'active',
    transcript_reused: false,
    transcript_source_digest: icc.canonicalDigest({ fixture: 'transcript-source' }),
    review_input_mode: 'full_diff_generation',
    new_input_bytes: 17,
    new_input_tokens: 23,
    input_token_measurement: 'provider_reported',
    finding_occurrences: [],
    accepted_invariant_ids: [`acceptance:${icc.canonicalDigest({ fixture: 'acceptance' })}`],
    accepted_invariants: ['the campaign ledger projects to a terminal-ready phase'],
    accepted_invariants_source_commit: candidate,
    accepted_invariants_digest: icc.canonicalDigest({
      schema: 1,
      assertions: ['the campaign ledger projects to a terminal-ready phase'],
      source_commit: candidate,
    }),
    prior_review_finding_ids: [],
    previous_repair_finding_count: null,
    non_reduction_rounds: 0,
    repair_scope_paths: ['src/value.txt'],
    repair_scope_seal: null,
  };
}

/**
 * Append PREPARED -> TERMINAL_READY through appendCampaignEvent, re-seating the
 * control on each reduced state. Returns the projection the shipped CLI reads
 * back, and throws if it is not terminal-ready — a fixture that quietly builds
 * the wrong phase is worse than one that fails.
 */
function driveCampaignToTerminalReady({
  root, repo, opened, candidate, candidateTree, branch, base, worktree, lifecycleReceiptRef,
} = {}) {
  if (!root) throw new TypeError('driveCampaignToTerminalReady requires root');
  if (!repo) throw new TypeError('driveCampaignToTerminalReady requires repo');
  if (!opened) throw new TypeError('driveCampaignToTerminalReady requires opened');
  if (!lifecycleReceiptRef) {
    throw new TypeError('driveCampaignToTerminalReady requires lifecycleReceiptRef');
  }
  const {
    icc, intake, verification, lineage, campaignCli,
  } = requireModules(root);
  const campaignId = opened.campaignId;

  const writerFence = verification.createWriterFence({
    campaignId,
    stageIdentity: 'campaign-implementation',
    candidateCommit: candidate,
    candidateTreeSha: candidateTree,
    implementationResult: {
      status: 'committed',
      implementation: { commit: candidate },
      implementationResult: { error: null, signal: null, status: 0 },
    },
  });
  const repairLineage = repairLineageFor({
    icc,
    campaignId,
    branch,
    worktree,
    worktreeInstanceId: lineage.worktreeInstanceId(worktree),
    candidate,
  });

  let control = opened.control;
  const events = [];
  const append = (input) => {
    const appended = intake.appendCampaignEvent({ repo, campaignControl: control, ...input });
    control = { ...control, initial_state: appended.state };
    events.push(appended.event);
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
    artifactReference: {
      kind: 'git_candidate',
      commit: candidate,
      tree_sha: candidateTree,
      branch,
      base,
      writer_fence: writerFence,
      repair_lineage: repairLineage,
    },
  });
  const evidenceDigest = icc.canonicalDigest({ fixture: 'vertical-evidence' });
  append({
    observedAt: '2026-08-05T00:00:03.000Z',
    eventType: icc.CAMPAIGN_EVENTS.VERTICAL_VERIFIED,
    generation: 0,
    stageIdentity: 'campaign-verification:0',
    payload: { passed: true, evidence_digest: evidenceDigest },
    artifactReference: { kind: 'verification_receipt', digest: evidenceDigest },
  });
  const reviewDigest = icc.canonicalDigest({ fixture: 'product-review', verdict: 'SHIP-AS-IS' });
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
    stageIdentity: 'campaign-adjudication:0',
    payload: {
      reason: 'campaign ledger fixture acceptance satisfied',
      registry_complete: true,
      registry_digest: icc.canonicalDigest({ fixture: 'finding-registry', findings: [] }),
      convergence_digest: icc.canonicalDigest({ fixture: 'convergence', passed: true }),
      lifecycle_receipt_ref: lifecycleReceiptRef,
    },
  });

  const projection = campaignCli.projectCampaign(
    campaignCli.loadRows(opened.ledger),
    campaignId,
  );
  if (!projection || projection.state.phase !== 'TERMINAL_READY') {
    throw new Error(
      `campaign ledger fixture is not terminal-ready: ${projection && projection.state.phase}`,
    );
  }
  if (!projection.candidate_reference || projection.candidate_reference.kind !== 'git_candidate') {
    throw new Error('campaign ledger fixture lost its git candidate reference');
  }
  return { campaignId, projection, control, events };
}

/**
 * One call: a terminal-ready campaign ledger at the canonical path
 * campaignLedgerPathFor() computes for the given repository, with a real
 * candidate commit and a shipped LifecycleResidueReceipt behind its terminal
 * event.
 *
 * @param {object} options
 * @param {string} options.root  repository providing the modules and scripts
 * @param {string} options.repo  repository that receives the ledger
 */
function buildTerminalReadyCampaignLedger({ root, repo, ticket, startedAt } = {}) {
  if (!root) throw new TypeError('buildTerminalReadyCampaignLedger requires root');
  if (!repo) throw new TypeError('buildTerminalReadyCampaignLedger requires repo');
  const { runtime, lifecycle } = requireModules(root);
  const repoInfo = runtime.canonicalRepository(repo);
  const repoIdentity = `git-common-dir:${repoInfo.common}`;
  const authorityRoot = path.join(repoInfo.common, 'autopilot');
  fs.mkdirSync(authorityRoot, { recursive: true });
  const ledger = path.join(authorityRoot, 'implementation-campaign.jsonl');

  const base = git(repo, ['rev-parse', 'HEAD']);
  const branch = 'campaign/ntv-ledger-fixture';
  const contract = campaignLedgerContract({
    repoIdentity, ticket, baseSha: base, branch,
  });
  const opened = openCampaignLedger({ root, repo, ledger, contract, startedAt });

  // A real commit, in a real registered worktree: the candidate reference is
  // checked against git truth downstream, and repair_lineage wants a worktree
  // whose filesystem instance id can be computed.
  const worktree = path.join(path.dirname(repoInfo.repo), 'ntv-ledger-fixture-candidate');
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-q', '-b', branch, worktree, base]);
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), '## Next touch\ncandidate\n');
  execFileSync('git', ['-C', worktree, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', 'campaign ledger fixture candidate']);
  const candidate = git(worktree, ['rev-parse', 'HEAD']);
  const candidateTree = git(worktree, ['rev-parse', 'HEAD^{tree}']);

  // The LifecycleResidueReceipt comes out of the shipped rail, and has to live
  // under the Git common-dir authority store: next-touch-validation.js resolves
  // lifecycle_receipt_ref.path through assertAuthorityPath.
  const scanPath = path.join(authorityRoot, 'ntv-ledger-fixture-worktree-scan.json');
  const scan = execFileSync('bash', [
    path.join(root, 'scripts', 'reap-dispatch-worktrees.sh'), 'scan',
    '--repo', repo, '--root-run-id', opened.campaignId,
  ], { encoding: 'utf8' });
  fs.writeFileSync(scanPath, scan.endsWith('\n') ? scan : `${scan}\n`);
  const lifecycleReceiptPath = path.join(authorityRoot, 'ntv-ledger-fixture-lifecycle.json');
  execFileSync('node', [
    path.join(root, 'scripts', 'lifecycle-residue-receipt.js'), 'issue',
    '--repo', repo, '--root-run-id', opened.campaignId,
    '--worktree-result', scanPath, '--out', lifecycleReceiptPath,
  ], { encoding: 'utf8' });
  const inspected = lifecycle.inspectLifecycleReceipt({
    repo, rootRunId: opened.campaignId, receipt: lifecycleReceiptPath,
  });
  if (inspected.status !== 'valid') {
    throw new Error(`campaign ledger fixture lifecycle receipt is ${inspected.status}`);
  }
  const lifecycleReceiptRef = {
    path: lifecycleReceiptPath,
    root_run_id: opened.campaignId,
    receipt_digest: inspected.receipt_digest,
  };

  const driven = driveCampaignToTerminalReady({
    root,
    repo,
    opened,
    candidate,
    candidateTree,
    branch,
    base,
    worktree,
    lifecycleReceiptRef,
  });

  return {
    campaignId: driven.campaignId,
    ledger,
    projection: driven.projection,
    repoInfo,
    contract,
    base,
    branch,
    candidate,
    candidateTree,
    worktree,
    lifecycleReceiptPath,
    lifecycleReceiptRef,
  };
}

module.exports = {
  campaignLedgerContract,
  openCampaignLedger,
  driveCampaignToTerminalReady,
  buildTerminalReadyCampaignLedger,
};
