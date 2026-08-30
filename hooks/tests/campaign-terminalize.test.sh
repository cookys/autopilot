#!/usr/bin/env bash
# campaign-terminalize.test.sh — evidence-gated terminalization for a dead
# managed campaign (BACKLOG "Killed/dead managed campaign stuck at
# IMPLEMENTING ... has no operator remedy" + "No operator-level release for a
# claim whose campaign died without a terminal receipt").
#
# Section 1: pure unit coverage of campaignTerminalizeEligibility /
# buildTerminalizeMutationFailedEvent / writeCampaignTerminalizeSummary
# against hand-built projection objects — exercises every named rejection
# code without needing a real run-ledger.sh fixture.
#
# Section 2: end-to-end CLI wiring against a REAL ledger built with
# run-ledger.sh (a genuinely alive-then-killed leaf pid), proving
# `campaign terminalize` and `mission withdraw` actually plumb through the
# canonical journal/reducer paths, second-call idempotent refusal, and the
# withdraw-before-terminalize refusal.
. "$(dirname "$0")/lib.sh"

# ---------------------------------------------------------------------------
# Section 1: pure eligibility + event-build + summary-write
# ---------------------------------------------------------------------------
PURE_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const tmp = process.argv[3];

const {
  CAMPAIGN_STATES,
  campaignIdFor,
  createCampaignState,
} = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const {
  buildTerminalizeMutationFailedEvent,
  campaignTerminalizeEligibility,
  writeCampaignTerminalizeSummary,
} = require(path.join(root, 'src', 'campaign', 'cli'));

const D = 'a'.repeat(64);
const contract = {
  ticket: 'icc-terminalize',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 3600,
  max_changed_files: 4,
  baseline_churn: 10,
  max_extra_churn: 5,
};
const repoIdentity = 'git-common-dir:/fixture-terminalize';
const campaignId = campaignIdFor(repoIdentity, contract.ticket, D);

function baseState(overrides = {}) {
  const state = createCampaignState({
    contract,
    contractDigest: D,
    repoIdentity,
    startedAt: '2026-08-29T00:00:00.000Z',
  });
  return {
    ...state,
    phase: CAMPAIGN_STATES.IMPLEMENTING,
    generation: 1,
    live_lease: { stage_identity: 'impl-1', generation: 1, acquired_at: '2026-08-29T00:00:01.000Z' },
    ...overrides,
  };
}

function projectionFor({
  statePhase = CAMPAIGN_STATES.IMPLEMENTING,
  liveLease = { stage_identity: 'impl-1', generation: 1, acquired_at: '2026-08-29T00:00:01.000Z' },
  leaseRow,
  worktree = null,
} = {}) {
  return {
    campaign_id: campaignId,
    state: baseState({ phase: statePhase, live_lease: liveLease }),
    latest_lease: leaseRow,
    candidate_reference: worktree ? { repair_lineage: { worktree } } : null,
  };
}

const NOW = '2026-08-31T00:00:00.000Z';

// 1. Alive lease is refused.
{
  // Replicates campaign/cli.js's processStartTime exactly (unexported) so the
  // fabricated lease row's start_time matches what the SUT independently
  // recomputes for this real, currently-alive process — a fabricated
  // "N seconds ago" guess would not match and would misclassify as dead.
  const { spawnSync: spawnSyncLocal } = require('child_process');
  function realStartTime(pid) {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const close = stat.lastIndexOf(')');
    const fields = stat.slice(close + 2).trim().split(/\s+/);
    const startTicks = Number(fields[19]);
    const btimeLine = fs.readFileSync('/proc/stat', 'utf8')
      .split('\n').find((line) => line.startsWith('btime '));
    const ticksResult = spawnSyncLocal('getconf', ['CLK_TCK'], { encoding: 'utf8' });
    const bootTime = Number(btimeLine && btimeLine.split(/\s+/)[1]);
    const ticks = Number(String(ticksResult.stdout || '').trim());
    assert.ok(Number.isFinite(startTicks) && Number.isFinite(bootTime) && ticks > 0,
      'fixture requires /proc-based start time on this platform');
    return Math.floor(bootTime + (startTicks / ticks));
  }
  const projection = projectionFor({
    leaseRow: { state: 'leased', pid: process.pid, start_time: realStartTime(process.pid) },
  });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: { ended_at: NOW } }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_lease_live');
}

// 2. Unknown liveness (missing pid/start_time) is refused.
{
  const projection = projectionFor({ leaseRow: { state: 'leased', pid: process.pid, start_time: 0 } });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: { ended_at: NOW } }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_lease_unknown');
}

// A genuinely dead pid used from here on: a process that has already exited.
function deadPid() {
  const { spawnSync } = require('child_process');
  // A short-lived shell child; by the time spawnSync returns it has exited.
  const child = require('child_process').spawnSync(process.execPath, ['-e', 'process.exit(0)']);
  return child.pid;
}
const DEAD_PID = deadPid();
const deadLeaseRow = { state: 'leased', pid: DEAD_PID, start_time: 1 };

// 3. Missing/absent manifest ended_at is refused.
{
  const projection = projectionFor({ leaseRow: deadLeaseRow });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: null }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_leaf_manifest_open');
}
{
  const projection = projectionFor({ leaseRow: deadLeaseRow });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: { status: 'running' } }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_leaf_manifest_open');
}

// 4. Worktree still present is refused.
{
  const worktreeDir = path.join(tmp, 'still-here-worktree');
  fs.mkdirSync(worktreeDir, { recursive: true });
  const projection = projectionFor({ leaseRow: deadLeaseRow, worktree: worktreeDir });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: { ended_at: NOW } }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_worktree_present');
}

// 5. Dead + manifest ended + worktree absent -> eligible, and the event
//    builder produces a reducer-valid MUTATION_FAILED that lands on
//    TERMINAL_STOP with the lease released, carrying the live lease identity.
let successBuilt;
let successProjection;
{
  const worktreeDir = path.join(tmp, 'gone-worktree');
  successProjection = projectionFor({ leaseRow: deadLeaseRow, worktree: worktreeDir });
  const eligibility = campaignTerminalizeEligibility(successProjection, { manifest: { ended_at: NOW } }, NOW);
  assert.strictEqual(eligibility.status, 'eligible');
  successBuilt = buildTerminalizeMutationFailedEvent(successProjection, NOW, 'fixture terminalize');
  assert.strictEqual(successBuilt.event.stage_identity, successProjection.state.live_lease.stage_identity);
  assert.strictEqual(successBuilt.event.generation, successProjection.state.live_lease.generation);
  assert.strictEqual(successBuilt.nextState.phase, CAMPAIGN_STATES.TERMINAL_STOP);
  assert.strictEqual(successBuilt.nextState.live_lease, null);
}

// 6. Already-terminal campaign is refused with campaign_already_terminal —
//    never a silent no-op on a second call.
{
  const projection = projectionFor({ statePhase: CAMPAIGN_STATES.TERMINAL_STOP, liveLease: null, leaseRow: deadLeaseRow });
  const eligibility = campaignTerminalizeEligibility(projection, { manifest: { ended_at: NOW } }, NOW);
  assert.strictEqual(eligibility.status, 'blocked');
  assert.strictEqual(eligibility.reason_code, 'campaign_already_terminal');
}

// 7. Summary JSON is written once, and a second write is a no-op that does
//    not clobber the first receipt.
const ledgerPath = path.join(tmp, 'pure-campaign.jsonl');
fs.writeFileSync(ledgerPath, '');
const firstWrite = writeCampaignTerminalizeSummary(ledgerPath, successProjection, successBuilt);
assert.strictEqual(firstWrite.written, true);
assert.ok(fs.existsSync(firstWrite.path));
const firstBody = JSON.parse(fs.readFileSync(firstWrite.path, 'utf8'));
assert.strictEqual(firstBody.artifact_type, 'campaign_terminalize_summary');
assert.strictEqual(firstBody.campaign_id, campaignId);
const secondWrite = writeCampaignTerminalizeSummary(ledgerPath, successProjection, successBuilt);
assert.strictEqual(secondWrite.written, false);
assert.strictEqual(secondWrite.path, firstWrite.path);

console.log(JSON.stringify({ pure_suite: 'ok' }));
NODE
)"
assert_exit_code "$?" "0" "pure eligibility/event-build/summary suite exits zero: $PURE_OUT"
assert_contains "$PURE_OUT" '"pure_suite":"ok"' "pure suite reports ok"

# ---------------------------------------------------------------------------
# Section 2: end-to-end CLI wiring against a real run-ledger.sh fixture.
# ---------------------------------------------------------------------------
BIN="$REPO_ROOT/bin/autopilot.js"

# 2a. No-args usage: exits non-zero.
set +e
node "$BIN" campaign terminalize >"$TEST_TMP/noargs.out" 2>"$TEST_TMP/noargs.err"
NOARGS_RC=$?
set -e 2>/dev/null || true
assert_exit_code "$NOARGS_RC" "2" "campaign terminalize with no args exits non-zero"
assert_contains "$(cat "$TEST_TMP/noargs.err")" "leaf-manifest" "usage error names the missing flag"

E2E_OUT="$(node - "$REPO_ROOT" "$TEST_TMP" "$BIN" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync, spawn } = require('child_process');
const [root, tmp, bin] = process.argv.slice(2);

function sleepMs(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

// SIGKILL + a real async wait for the child to be reaped. A busy-loop wait
// via spawnSync blocks the event loop, which prevents Node from ever
// processing the child's exit/SIGCHLD — the pid would stay a zombie (still
// visible to kill(pid,0)) forever. Reaping requires yielding to the loop.
async function killAndWait(pid) {
  try { process.kill(pid, 'SIGKILL'); } catch (_error) { /* already gone */ }
  for (let i = 0; i < 100; i += 1) {
    try {
      process.kill(pid, 0);
    } catch (_error) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleepMs(50);
  }
  throw new Error(`pid ${pid} did not exit in time`);
}

async function main() {

const {
  CAMPAIGN_EVENTS,
  campaignIdFor,
  canonicalDigest,
  createCampaignState,
} = require(path.join(root, 'src', 'engine', 'implementation-campaign'));

const RUN_LEDGER = path.join(root, 'scripts', 'run-ledger.sh');
const contract = {
  ticket: 'icc-e2e-terminalize',
  profile: 'poc',
  max_repair_generations: 2,
  max_wall_seconds: 3600,
  max_changed_files: 4,
  baseline_churn: 10,
  max_extra_churn: 5,
};
const repoIdentity = 'git-common-dir:/fixture-e2e-terminalize';
const contractDigest = 'b'.repeat(64);
const campaignId = campaignIdFor(repoIdentity, contract.ticket, contractDigest);

function runLedger(args) {
  const result = spawnSync('bash', [RUN_LEDGER, ...args], { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`run-ledger.sh ${args.join(' ')} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

// Build a ledger with one campaign leased by a real pid, then acquire and
// journal the intake + IMPLEMENTATION_STARTED so the durable state lands in
// IMPLEMENTING with a live lease — mirroring a real dead campaign.
function buildLedger({ ledgerPath, pid, manifest, extraWorktree }) {
  runLedger(['init', '--ledger', ledgerPath]);
  const acquire = runLedger([
    'stage-acquire', '--ledger', ledgerPath, '--run-id', campaignId, '--stage', 'campaign',
    '--pid', String(pid), '--resources', `campaign:${campaignId}`,
  ]);
  const gen = acquire.generation;
  const nonce = acquire.nonce;

  const initialState = createCampaignState({
    contract, contractDigest, repoIdentity, startedAt: '2026-08-29T00:00:00.000Z',
  });
  const initialStateDigest = canonicalDigest(initialState);
  const intakeWrapper = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_intake',
    campaign_id: campaignId,
    contract_digest: contractDigest,
    initial_state: initialState,
    initial_state_digest: initialStateDigest,
  };
  runLedger([
    'journal-add', '--ledger', ledgerPath, '--run-id', campaignId, '--stage', 'campaign',
    '--generation', String(gen), '--nonce', nonce,
    '--idempotency-key', `intake:${campaignId}`, '--op', 'campaign_intake',
    '--payload', JSON.stringify(intakeWrapper),
  ]);

  const startEvent = {
    schema_version: 1,
    event_type: CAMPAIGN_EVENTS.IMPLEMENTATION_STARTED,
    campaign_id: campaignId,
    contract_digest: contractDigest,
    generation: initialState.generation,
    idempotency_key: `impl-start:${campaignId}`,
    input_artifact_digest: initialState.last_output_artifact_digest,
    output_artifact_digest: initialState.last_output_artifact_digest,
    timestamp: '2026-08-29T00:00:01.000Z',
    stage_identity: 'impl-1',
    usage: {
      repair_generations: initialState.generation, elapsed_wall_seconds: 1, changed_files: 0, churn: 0,
    },
    payload: { sealed_contract: true },
  };
  const startWrapper = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_event',
    campaign_id: campaignId,
    contract_digest: contractDigest,
    event: startEvent,
    artifact_reference: extraWorktree
      ? {
        kind: 'git_candidate',
        campaign_contract_sha256: contractDigest,
        writer_fence: { campaign_id: campaignId, stage_identity: 'impl-1', generation: initialState.generation },
        branch: 'impl/e2e-terminalize',
        base_sha: '0'.repeat(40),
        commit_sha: '1'.repeat(40),
        repair_lineage: {
          lineage_id: campaignId,
          branch: 'impl/e2e-terminalize',
          worktree: extraWorktree,
          worktree_instance_id: 'wt-1',
          terminal_worktree_disposition: 'unknown',
        },
      }
      : null,
  };
  runLedger([
    'journal-add', '--ledger', ledgerPath, '--run-id', campaignId, '--stage', 'campaign',
    '--generation', String(gen), '--nonce', nonce,
    '--idempotency-key', startEvent.idempotency_key, '--op', 'campaign_event',
    '--payload', JSON.stringify(startWrapper),
  ]);

  if (manifest !== undefined) {
    const manifestPath = path.join(path.dirname(ledgerPath), 'leaf-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    return manifestPath;
  }
  return null;
}

function runCli(args) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// --- Dead leaf: acquire the lease against a REAL alive pid (stage-acquire
// records its actual start_time), then kill it and wait for exit — this is
// what a genuinely dead leaf's ledger row looks like, unlike a pid that was
// already gone before acquire (which cannot record a valid start_time).
const leafChild = spawn('sleep', ['30']);
const leafPid = leafChild.pid;

const ledgerPath = path.join(tmp, 'e2e-campaign.jsonl');
const manifestPath = buildLedger({
  ledgerPath, pid: leafPid, manifest: { ended_at: '2026-08-31T00:00:00.000Z' },
});
await killAndWait(leafPid);

// First terminalize call: eligible -> terminalized.
const first = runCli([
  'campaign', 'terminalize', '--campaign-id', campaignId, '--ledger', ledgerPath,
  '--leaf-manifest', manifestPath, '--now', '2026-08-31T00:05:00.000Z',
]);
assert.strictEqual(first.status, 0, `first terminalize failed: ${first.stdout} ${first.stderr}`);
const firstBody = JSON.parse(first.stdout);
assert.strictEqual(firstBody.status, 'terminalized');
assert.strictEqual(firstBody.lease_released, true);
assert.strictEqual(firstBody.summary_written, true);
assert.ok(fs.existsSync(firstBody.summary_path));

// Second call on the same (now terminal) campaign: refused, never a silent
// no-op.
const second = runCli([
  'campaign', 'terminalize', '--campaign-id', campaignId, '--ledger', ledgerPath,
  '--leaf-manifest', manifestPath, '--now', '2026-08-31T00:06:00.000Z',
]);
assert.strictEqual(second.status, 1);
const secondBody = JSON.parse(second.stdout);
assert.strictEqual(secondBody.status, 'rejected');
assert.strictEqual(secondBody.reason_code, 'campaign_already_terminal');

// --- Alive lease: refused with campaign_lease_live. ---
const aliveChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
const aliveLedgerPath = path.join(tmp, 'alive-campaign.jsonl');
// Distinct campaign identity for the alive-lease fixture.
const aliveContract = { ...contract, ticket: 'icc-e2e-alive' };
function buildAliveLedger(pid) {
  runLedger(['init', '--ledger', aliveLedgerPath]);
  const aliveCampaignId = campaignIdFor(repoIdentity, aliveContract.ticket, contractDigest);
  const acquire = runLedger([
    'stage-acquire', '--ledger', aliveLedgerPath, '--run-id', aliveCampaignId, '--stage', 'campaign',
    '--pid', String(pid), '--resources', `campaign:${aliveCampaignId}`,
  ]);
  const initialState = createCampaignState({
    contract: aliveContract, contractDigest, repoIdentity, startedAt: '2026-08-29T00:00:00.000Z',
  });
  const intakeWrapper = {
    schema_version: 1,
    artifact_type: 'implementation_campaign_intake',
    campaign_id: aliveCampaignId,
    contract_digest: contractDigest,
    initial_state: initialState,
    initial_state_digest: canonicalDigest(initialState),
  };
  runLedger([
    'journal-add', '--ledger', aliveLedgerPath, '--run-id', aliveCampaignId, '--stage', 'campaign',
    '--generation', String(acquire.generation), '--nonce', acquire.nonce,
    '--idempotency-key', `intake:${aliveCampaignId}`, '--op', 'campaign_intake',
    '--payload', JSON.stringify(intakeWrapper),
  ]);
  return aliveCampaignId;
}
const aliveCampaignId = buildAliveLedger(aliveChild.pid);
const aliveManifestPath = path.join(tmp, 'alive-leaf-manifest.json');
fs.writeFileSync(aliveManifestPath, JSON.stringify({ ended_at: '2026-08-31T00:00:00.000Z' }));
const aliveResult = runCli([
  'campaign', 'terminalize', '--campaign-id', aliveCampaignId, '--ledger', aliveLedgerPath,
  '--leaf-manifest', aliveManifestPath, '--now', '2026-08-31T00:05:00.000Z',
]);
assert.strictEqual(aliveResult.status, 1);
const aliveBody = JSON.parse(aliveResult.stdout);
assert.strictEqual(aliveBody.reason_code, 'campaign_lease_live');
aliveChild.kill();

// --- mission withdraw: refused before terminalize, succeeds after. ---
const mission = require(path.join(root, 'src', 'engine', 'mission-convergence'));
const { buildReservation } = require(path.join(root, 'src', 'mission', 'cli'));
const missionContract = {
  schema_version: 1,
  artifact_type: 'mission_convergence_contract',
  contract_id: `mission-v1-${'0'.repeat(64)}`,
  repo_identity: 'test-repo',
  mission_lineage_id: `lineage-v1-${'0'.repeat(64)}`,
  task_authority_id: '0'.repeat(64),
  policy_hash: '0'.repeat(64),
  enforcement_mode: 'shadow',
  state: 'DRAFT',
  closure_ratio: 0.75,
  max_stagnant_campaigns: 2,
  axes: Object.fromEntries(['campaigns', 'wall_seconds', 'tool_calls', 'engine_attempts',
    'external_wait_seconds', 'canonical_changed_files', 'output_bytes'].map((axis) => [axis, {
    authorized_ceiling: 100, reserved_active: 0, durable_consumed: 0, known: true, enforced: true,
  }])),
  grant_contract: {
    idempotency_key_required: true,
    single_use: true,
    expiry_seconds: 3600,
    bindings: ['mission_lineage_id', 'task_authority_id', 'campaign_id', 'campaign_contract_digest', 'base_sha', 'acceptance_ids'],
  },
  control_contract: {
    actions: ['ceiling_adjust', 'scope_frozen', 'finish_requested', 'abort_requested'],
    allowed_authorities: ['authenticated_user', 'authenticated_doa', 'agent', 'owner_kernel'],
    ceiling_loosen_authority: 'authenticated_user',
  },
  lineage_binding: {
    task_authority_id: '0'.repeat(64),
    root_run_id: 'test-root',
    policy_hash: '0'.repeat(64),
    successor_inherits_durable_consumed: false,
  },
};
const missionState0 = mission.createMissionState(missionContract);
const grantEvent = {
  event_type: 'grant_claimed',
  sequence: 1,
  mission_lineage_id: missionState0.mission_lineage_id,
  payload: {
    idempotency_key: 'withdraw-fixture',
    mission_lineage_id: missionState0.mission_lineage_id,
    task_authority_id: missionState0.task_authority_id,
    campaign_id: campaignId,
    campaign_contract_digest: contractDigest,
    base_sha: '0'.repeat(40),
    acceptance_ids: ['acc-1'],
    reservation: buildReservation(missionState0, 1),
    issued_at: '2026-08-29T00:00:00.000Z',
    expires_at: '2026-08-31T01:00:00.000Z',
  },
};
const granted = mission.reduceMissionState(missionState0, grantEvent);
assert.strictEqual(granted.receipt.artifact_type, 'mission_campaign_grant_claimed');
const claimId = granted.receipt.claim_id;
const missionStatePath = path.join(tmp, 'mission-state.json');
fs.writeFileSync(missionStatePath, JSON.stringify(granted.state));

// Rebuild a NOT-YET-terminal ledger for the pre-terminalize withdraw refusal.
const preLedgerPath = path.join(tmp, 'pre-withdraw-campaign.jsonl');
// Liveness is irrelevant here (withdraw only checks campaign terminality),
// but stage-acquire still needs a real pid to record a valid start_time.
const preLeafChild = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 5000)']);
buildLedgerFor(preLedgerPath, campaignId, preLeafChild.pid);
function buildLedgerFor(lp, cid, pid) {
  runLedger(['init', '--ledger', lp]);
  const acquire = runLedger([
    'stage-acquire', '--ledger', lp, '--run-id', cid, '--stage', 'campaign',
    '--pid', String(pid), '--resources', `campaign:${cid}`,
  ]);
  const initialState = createCampaignState({
    contract, contractDigest, repoIdentity, startedAt: '2026-08-29T00:00:00.000Z',
  });
  const intakeWrapper = {
    schema_version: 1, artifact_type: 'implementation_campaign_intake', campaign_id: cid,
    contract_digest: contractDigest, initial_state: initialState,
    initial_state_digest: canonicalDigest(initialState),
  };
  runLedger([
    'journal-add', '--ledger', lp, '--run-id', cid, '--stage', 'campaign',
    '--generation', String(acquire.generation), '--nonce', acquire.nonce,
    '--idempotency-key', `intake:${cid}:pre`, '--op', 'campaign_intake',
    '--payload', JSON.stringify(intakeWrapper),
  ]);
}

const withdrawBefore = runCli([
  'mission', 'withdraw', '--state', missionStatePath, '--out', path.join(tmp, 'mission-state-out.json'),
  '--claim-id', claimId, '--campaign-ledger', preLedgerPath,
]);
assert.strictEqual(withdrawBefore.status, 1, `withdraw-before-terminal should refuse: ${withdrawBefore.stdout}`);
const withdrawBeforeBody = JSON.parse(withdrawBefore.stdout);
assert.strictEqual(withdrawBeforeBody.code, 'mission_withdraw_campaign_not_terminal');
// qc 2026-08-31 (MiniMax-M3 🟠 verified): the refusal must carry the claim id and
// the campaign phase so an operator can correlate it without reloading the ledger.
assert.strictEqual(withdrawBeforeBody.claim_id, claimId, `refusal must carry claim_id: ${withdrawBefore.stdout}`);
assert.strictEqual(typeof withdrawBeforeBody.phase, 'string', `refusal must carry campaign phase: ${withdrawBefore.stdout}`);
assert.ok(withdrawBeforeBody.reason.includes(claimId) && withdrawBeforeBody.reason.includes(withdrawBeforeBody.phase), `reason must name claim + phase: ${withdrawBeforeBody.reason}`);

// Now use the ALREADY-terminalized ledger from above (`ledgerPath`) — its
// campaign_id is the SAME campaignId the claim is bound to.
const withdrawAfter = runCli([
  'mission', 'withdraw', '--state', missionStatePath, '--out', path.join(tmp, 'mission-state-out2.json'),
  '--claim-id', claimId, '--campaign-ledger', ledgerPath,
]);
assert.strictEqual(withdrawAfter.status, 0, `withdraw-after-terminal should succeed: ${withdrawAfter.stdout} ${withdrawAfter.stderr}`);
const withdrawAfterBody = JSON.parse(withdrawAfter.stdout);
assert.strictEqual(withdrawAfterBody.status, 'withdrawn');
assert.strictEqual(withdrawAfterBody.claim_id, claimId);
const outState = JSON.parse(fs.readFileSync(path.join(tmp, 'mission-state-out2.json'), 'utf8'));
assert.strictEqual(outState.claims[claimId].released, true);

preLeafChild.kill();
console.log(JSON.stringify({ e2e_suite: 'ok' }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
)"
E2E_RC=$?
assert_exit_code "$E2E_RC" "0" "e2e CLI suite exits zero: $E2E_OUT"
assert_contains "$E2E_OUT" '"e2e_suite":"ok"' "e2e suite reports ok"

finalize_test
