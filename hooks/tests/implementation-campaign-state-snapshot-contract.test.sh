#!/usr/bin/env bash
# RED at base df26dbe8: snapshot written before Mission claim; EEXIST identity-only;
# live roster flip is invisible in the journal; held claim without a file re-seals
# silently. 2-D D2: write after claim; digest is a contract; crash-window + live flip.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

SBX="$TEST_TMP/snap-contract-repo"
mkdir -p "$SBX/.claude" "$SBX/src"
git -C "$SBX" init -q -b develop
git -C "$SBX" config user.email snap@example.invalid
git -C "$SBX" config user.name "Snap Contract"
write_mission_governance "$SBX/.claude/owner-kernel-governance.json" shadow
printf 'module.exports = 1;\n' >"$SBX/src/fixture.js"
git -C "$SBX" add .
git -C "$SBX" commit -qm "snap-contract base"
BASE_SHA="$(git -C "$SBX" rev-parse HEAD)"

OUT="$(node - "$REPO_ROOT" "$SBX" "$BASE_SHA" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, repo, base, tmp] = process.argv.slice(2);
const {
  runCampaignIntake,
  buildQcPanelSnapshot,
  qcPanelSnapshotIdentityBody,
  AutopilotEngine,
} = require(path.join(root, 'src', 'engine'));
const { canonicalDigest } = require(path.join(root, 'src', 'engine', 'campaign-verification'));
const { campaignIdFor } = require(path.join(root, 'src', 'engine', 'implementation-campaign'));
const { canonicalRepoIdentity } = require(path.join(root, 'scripts', 'implementation-campaign-check'));
const { loadRows, projectCampaign, defaultCampaignLedgerPath } = require(path.join(root, 'src', 'campaign', 'cli'));

const ccSeat = {
  role: 'qc', runner: 'cc-shim', model: 'GLM-5.2', effort: 'high', endpoint: null, family: 'other',
};

function spies(extra) {
  const counts = { missionClaim: 0, claimGeneration: 0 };
  const adapters = {
    now: () => '2026-07-26T00:00:00.000Z',
    missionClaim() {
      counts.missionClaim += 1;
      return { owner: 'mission', status: 'claimed', claim_id: 'claim-1' };
    },
    releaseMission() { return { owner: 'mission_release', status: 'released' }; },
    claimGeneration() {
      counts.claimGeneration += 1;
      return {
        owner: 'campaign_generation',
        status: 'claimed',
        generation: 1,
        nonce: 'n',
        ledger: path.join(repo, '.git', 'autopilot', 'implementation-campaign.jsonl'),
        stage_identity: 'run-ledger:1:n',
      };
    },
    readiness() { return { owner: 'provider_readiness', status: 'ready' }; },
    contextGate() { return { owner: 'context_window', status: 'ready' }; },
    occupancy() { return { owner: 'worktree_lifecycle', status: 'ready' }; },
    ...(extra || {}),
  };
  return { counts, adapters };
}

function baseRoster(seats, extra) {
  return {
    reviewer_engine: 'fixture-reviewer',
    reviewer_effort: 'high',
    reviewer_runner: 'cc-shim',
    reviewer_qualified: true,
    min_panel_size: 1,
    qc_panel_seats_complete: true,
    qc_panel_seats: seats,
    implementer_engine: 'fixture-implementer',
    implementer_effort: 'high',
    implementer_runner: 'fixture',
    ...extra,
  };
}

function writeUnsignedContract(dir, ticket) {
  fs.mkdirSync(dir, { recursive: true });
  const contractPath = path.join(dir, 'campaign.json');
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1,
    ticket,
    profile: 'poc',
  })}\n`);
  return contractPath;
}

function ownerOrder(result) {
  return (result.steps || []).map((s) => s && s.owner).filter(Boolean).join(',');
}

// (a) rejected claim — GREEN: no file; mission before snapshot
{
  const dir = path.join(tmp, 'a-rejected');
  const contractPath = writeUnsignedContract(dir, 'qc-snap-reject');
  const snapFile = path.join(dir, 'qc_panel_snapshot.json');
  const result = runCampaignIntake({
    repo,
    contractPath,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      in_rail_review: 'panel',
    }),
  }, {
    now: () => '2026-07-26T00:00:00.000Z',
    missionClaim() {
      return { owner: 'mission', status: 'rejected', code: 'mission_grant_unavailable', reason: 'no grant' };
    },
    releaseMission() { return { owner: 'mission_release', status: 'released' }; },
  });
  // RED at base df26dbe8: file existed; step_order=qc_panel_snapshot,mission,…
  assert.strictEqual(fs.existsSync(snapFile), false, 'rejected claim must not leave qc_panel_snapshot.json');
  assert.ok(ownerOrder(result).startsWith('mission'), ownerOrder(result));
  assert.ok(!ownerOrder(result).startsWith('qc_panel_snapshot,'), ownerOrder(result));
  assert.strictEqual(result.status, 'blocked');
}

// happy write after claim: mission,qc_panel_snapshot,…
{
  const dir = path.join(tmp, 'a-claimed');
  const contractPath = writeUnsignedContract(dir, 'qc-snap-claimed');
  const snapFile = path.join(dir, 'qc_panel_snapshot.json');
  const s = spies();
  const result = runCampaignIntake({
    repo,
    contractPath,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      in_rail_review: 'panel',
    }),
  }, s.adapters);
  assert.ok(fs.existsSync(snapFile), 'successful claim writes the snapshot');
  const order = ownerOrder(result);
  assert.ok(order.includes('mission,qc_panel_snapshot'), order);
  const snapStep = (result.steps || []).find((st) => st && st.owner === 'qc_panel_snapshot');
  assert.ok(snapStep && snapStep.status === 'ready');
}

// (b) EEXIST mutated min_panel_size, stored digest unchanged
{
  const dir = path.join(tmp, 'b-drift');
  const contractPath = writeUnsignedContract(dir, 'qc-snap-digest');
  const snapFile = path.join(dir, 'qc_panel_snapshot.json');
  const first = runCampaignIntake({
    repo,
    contractPath,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      min_panel_size: 1,
      in_rail_review: 'panel',
    }),
  }, spies().adapters);
  assert.ok(fs.existsSync(snapFile));
  const stored = JSON.parse(fs.readFileSync(snapFile, 'utf8'));
  const storedDigest = stored.digest;
  stored.min_panel_size = 99;
  fs.writeFileSync(snapFile, `${JSON.stringify(stored)}\n`);
  const ledgerPath = defaultCampaignLedgerPath(repo);
  const beforeLedger = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath) : Buffer.from('');
  let beforePhase = null;
  let beforeLease = null;
  if (fs.existsSync(ledgerPath)) {
    const rows = loadRows(ledgerPath);
    const proj = projectCampaign(rows, first.campaign_id || campaignIdFor(
      canonicalRepoIdentity(repo),
      'qc-snap-digest',
      crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex'),
    ));
    beforePhase = proj && proj.state && proj.state.phase;
    beforeLease = proj && proj.latest_lease;
  }
  const second = runCampaignIntake({
    repo,
    contractPath,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      min_panel_size: 1,
      in_rail_review: 'panel',
    }),
  }, spies().adapters);
  // RED at base df26dbe8: accepted with only step.live_drift
  assert.strictEqual(second.status, 'blocked');
  assert.strictEqual(second.rejection && second.rejection.code, 'qc_panel_snapshot_drift');
  assert.ok(Array.isArray(second.rejection.fields) && second.rejection.fields.includes('min_panel_size'),
    JSON.stringify(second.rejection));
  assert.strictEqual(second.rejection.stored_digest, storedDigest);
  assert.ok(typeof second.rejection.recomputed_digest === 'string'
    && /^[0-9a-f]{64}$/.test(second.rejection.recomputed_digest));
  assert.notStrictEqual(second.rejection.recomputed_digest, storedDigest);
  const afterLedger = fs.existsSync(ledgerPath) ? fs.readFileSync(ledgerPath) : Buffer.from('');
  assert.ok(Buffer.compare(beforeLedger, afterLedger) === 0, 'lease/journal unchanged');
  if (fs.existsSync(ledgerPath) && first.campaign_id) {
    const proj = projectCampaign(loadRows(ledgerPath), first.campaign_id);
    assert.strictEqual(proj && proj.state && proj.state.phase, beforePhase);
    assert.deepStrictEqual(proj && proj.latest_lease, beforeLease);
  }
  const terminalish = JSON.stringify(second).includes('TERMINAL')
    || (second.steps || []).some((st) => st && /terminal/i.test(st.owner || ''));
  assert.strictEqual(terminalish, false);
}

// (d) held claim, no file
{
  const emptyDir = path.join(tmp, 'd-empty-journal');
  const emptyContract = writeUnsignedContract(emptyDir, 'qc-snap-resume-empty');
  const emptySnap = path.join(emptyDir, 'qc_panel_snapshot.json');
  const emptyResult = runCampaignIntake({
    repo,
    contractPath: emptyContract,
    resume: true,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      in_rail_review: 'panel',
    }),
  }, spies().adapters);
  // RED at base df26dbe8: silently re-sealed (ready qc_panel_snapshot, no sealed_on_resume)
  assert.ok(fs.existsSync(emptySnap));
  assert.ok((emptyResult.steps || []).some((st) => st && st.owner === 'qc_panel_snapshot_sealed_on_resume'),
    JSON.stringify(emptyResult.steps));
}

{
  const missDir = path.join(tmp, 'd-missing');
  const missContract = writeUnsignedContract(missDir, 'qc-snap-resume-events');
  const missSnap = path.join(missDir, 'qc_panel_snapshot.json');
  const digest = crypto.createHash('sha256').update(fs.readFileSync(missContract)).digest('hex');
  const campaignId = campaignIdFor(canonicalRepoIdentity(repo), 'qc-snap-resume-events', digest);
  const ledgerPath = defaultCampaignLedgerPath(repo);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify({
    schema_version: 1,
    event_type: 'generation_claimed',
    campaign_id: campaignId,
    contract_digest: digest,
    generation: 1,
    timestamp: '2026-07-26T00:00:01.000Z',
  })}\n`);
  const missResult = runCampaignIntake({
    repo,
    contractPath: missContract,
    resume: true,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      in_rail_review: 'panel',
    }),
  }, spies().adapters);
  assert.strictEqual(fs.existsSync(missSnap), false);
  assert.ok(missResult.rejection && missResult.rejection.code === 'qc_panel_snapshot_missing_after_claim',
    JSON.stringify(missResult));
  assert.ok(!(missResult.steps || []).some((st) => st && /terminal/i.test(st.owner || '')));
}

// (e) no-snapshot campaign projection bytes
{
  const dir = path.join(tmp, 'e-nosnap');
  const contractPath = writeUnsignedContract(dir, 'qc-snap-none');
  const roster = {
    reviewer_engine: 'fixture-reviewer',
    reviewer_effort: 'high',
    reviewer_runner: 'fixture',
    implementer_engine: 'fixture-implementer',
    implementer_effort: 'high',
    implementer_runner: 'fixture',
  };
  const result = runCampaignIntake({ repo, contractPath, roster }, spies().adapters);
  const snapOwners = (result.steps || []).filter((st) => st && st.owner === 'qc_panel_snapshot');
  assert.strictEqual(snapOwners.length, 0);
  assert.ok(!result.qc_panel_snapshot);
  const identity = canonicalRepoIdentity(repo);
  const digest = crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex');
  const campaignId = campaignIdFor(identity, 'qc-snap-none', digest);
  const projection = JSON.stringify(projectCampaign([], campaignId));
  assert.ok(typeof projection === 'string');
  console.log(`e_nosnap_projection=${projection}`);
}

// (e) pre-2-C file without review_station
{
  const fixtureSnapDir = path.join(tmp, 'e-legacy');
  const fixtureContract = writeUnsignedContract(fixtureSnapDir, 'qc-snap-2b-legacy');
  const fixtureDigest = crypto.createHash('sha256').update(fs.readFileSync(fixtureContract)).digest('hex');
  const fixtureId = campaignIdFor(canonicalRepoIdentity(repo), 'qc-snap-2b-legacy', fixtureDigest);
  const legacyBody = {
    schema_version: 1,
    campaign_id: fixtureId,
    contract_digest: fixtureDigest,
    seats: [ {
      role: ccSeat.role, runner: ccSeat.runner, model: ccSeat.model,
      effort: ccSeat.effort, endpoint: ccSeat.endpoint === undefined ? null : ccSeat.endpoint,
      family: ccSeat.family,
    } ],
    seats_complete: true,
    min_panel_size: 1,
    required_review_families: 1,
    implementer_family: 'unknown',
  };
  const legacySnap = { ...legacyBody, digest: canonicalDigest(legacyBody) };
  assert.ok(!Object.prototype.hasOwnProperty.call(legacySnap, 'review_station'));
  const onDiskPath = path.join(fixtureSnapDir, 'qc_panel_snapshot.json');
  fs.writeFileSync(onDiskPath, `${JSON.stringify(legacySnap)}\n`, { flag: 'wx' });
  const beforeBytes = fs.readFileSync(onDiskPath);
  const fixtureResult = runCampaignIntake({
    repo,
    contractPath: fixtureContract,
    roster: baseRoster([ccSeat], {
      fallback_ladder: [{ runner: ccSeat.runner, model: ccSeat.model, effort: ccSeat.effort, family: ccSeat.family }],
      min_panel_size: 1,
      in_rail_review: 'panel',
    }),
  }, spies().adapters);
  const fixtureStep = (fixtureResult.steps || []).find((st) => st && st.owner === 'qc_panel_snapshot');
  assert.ok(fixtureStep);
  assert.strictEqual(fixtureStep.status, 'ready');
  assert.strictEqual(fixtureStep.review_station, 'single');
  assert.ok(!Object.prototype.hasOwnProperty.call(fixtureStep, 'live_drift'), JSON.stringify(fixtureStep));
  const afterBytes = fs.readFileSync(onDiskPath);
  assert.ok(Buffer.compare(beforeBytes, afterBytes) === 0, 'pre-2-C snapshot bytes unchanged');
  const fixtureOnDisk = JSON.parse(afterBytes);
  assert.strictEqual(fixtureOnDisk.digest, legacySnap.digest);
  assert.ok(!Object.prototype.hasOwnProperty.call(fixtureOnDisk, 'review_station'));
  const identityBody = qcPanelSnapshotIdentityBody(fixtureOnDisk);
  assert.ok(!Object.prototype.hasOwnProperty.call(identityBody, 'review_station'));
}

// (c) live flip after sealing — engine journals qc_panel_snapshot_live_flip and runs sealed station
{
  const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
  const common = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-common-dir')));
  const seats = [
    { role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic' },
    { role: 'qc', runner: 'cc-shim', model: 'gpt-5.4', effort: 'high', endpoint: null, family: 'openai' },
    { role: 'qc', runner: 'cc-shim', model: 'glm-4.7', effort: 'high', endpoint: null, family: 'zai' },
  ];
  const ticket = 'panel-live-flip';
  const branch = `feat/${ticket}`;
  const worktree = path.join(tmp, `${ticket}-wt`);
  try { execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' }); } catch (_e) {}
  git('worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.mkdirSync(path.join(worktree, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(worktree, 'dist', 'out.txt'), `${ticket}\n`);
  execFileSync('git', ['-C', worktree, 'add', 'dist/out.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', ticket]);
  const candidate = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const tree = execFileSync('git', ['-C', worktree, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const contractDir = path.join(tmp, `${ticket}-campaign`);
  fs.mkdirSync(contractDir, { recursive: true });
  const contractPath = path.join(contractDir, 'campaign.json');
  const sealPath = path.join(contractDir, 'campaign.seal.json');
  const promptFile = path.join(tmp, `${ticket}.prompt`);
  fs.writeFileSync(promptFile, 'panel\n');
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch,
    vertical_acceptance: ['panel parallel'],
    allowed_path_prefixes: ['dist/'],
    max_changed_files: 5,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 120,
    verify_cmd: 'true',
    rubric_ids: ['ICC-KILL-057'],
    final_panel_reserve_seconds: 0,
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  const rawDigest = crypto.createHash('sha256').update(fs.readFileSync(contractPath)).digest('hex');
  const planted = buildQcPanelSnapshot({
    campaignId: campaignIdFor(canonicalRepoIdentity(repo), ticket, rawDigest),
    contractDigest: rawDigest,
    seats,
    minPanelSize: 3,
    requiredReviewFamilies: 1,
    implementerFamily: 'unknown',
    reviewStation: 'panel',
  });
  fs.writeFileSync(path.join(contractDir, 'qc_panel_snapshot.json'), `${JSON.stringify(planted)}\n`, { flag: 'wx' });
  const liveRoster = {
    reviewer_engine: seats[0].model,
    reviewer_effort: 'high',
    reviewer_runner: 'cc-shim',
    reviewer_qualified: true,
    implementer_engine: 'fixture-implementer',
    implementer_effort: 'high',
    implementer_runner: 'fixture',
    loop_max_rounds: 3,
    loop_convergence_verdict: 'SHIP-AS-IS',
    min_panel_size: 3,
    in_rail_review: 'panel',
    qc_panel_seats_complete: false,
    qc_panel_seats: seats,
    override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
  };
  const reviewModels = [];
  let clock = 0;
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => { clock += 1; return new Date(Date.UTC(2026, 8, 18, 0, 0, clock)).toISOString(); },
    campaignIntake(input) {
      return runCampaignIntake(input, {
        readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
        contextGate: () => ({ owner: 'context_window', status: 'ready' }),
        occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      });
    },
    campaignScopeChecker() {
      return { passed: true, changed_files: ['dist/out.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
    },
    implementationDispatcher() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          status: 'committed', runner: 'fixture', model: 'fixture-implementer',
          branch, base, commit: candidate, files_changed: 1, insertions: 1, deletions: 0,
          worktree, agent_log: '/tmp/impl-log', error: null,
        },
      };
    },
    reviewDispatcher(args) {
      const modelIdx = args.indexOf('--model');
      reviewModels.push(modelIdx >= 0 ? args[modelIdx + 1] : null);
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          runner: 'cc-shim', model: 'fixture', status: 'reviewed', verdict: 'SHIP-AS-IS',
          findings: '[]', raw_log: null, error: null,
        },
        packet: { packet_hash: 'b'.repeat(64) },
      };
    },
    diffProvider() { return promptFile; },
    gitWorktreeAdd() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        worktree, parent: null, commit: candidate, observed_commit: candidate,
        observed_tree_sha: tree, detached: true,
      };
    },
    gitWorktreeRemove() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
    repairLineageCleanupTransaction() {
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        executed_argv: ['/bin/sh', '-c', 'true'],
      };
    },
  });
  engine.implementTask = () => ({
    status: 'committed',
    dispatcher_called: true,
    implementation: {
      commit: candidate, worktree, run_id: 'run-flip', dispatch_id: 'd-flip',
      provider: 'fixture', runner: 'fixture', model: 'fixture-implementer',
      provider_session_id: null, provider_session_reused: false, worktree_reused: false,
      insertions: 1, deletions: 0,
    },
    implementationResult: { error: null, signal: null, status: 0 },
    ledger: [],
  });
  const result = engine.runImplementationReviewLoop({
    promptFile,
    branch,
    base,
    roster: liveRoster,
    campaignManaged: true,
    campaignContract: contractPath,
    campaignSeal: sealPath,
    campaignDispositionPolicy: 'acceptance-bound',
    verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
    verificationEnvAllowlist: ['CI'],
    verifyCmd: 'true',
  });
  console.log(`live_flip_status=${result.status}`);
  console.log(`live_flip_phase=${result.phase}`);
  console.log(`live_flip_reason=${result.reason}`);
  console.log(`live_flip_units=${JSON.stringify(result.ledger && result.ledger.map((row) => row.unit))}`);
  const flip = (result.ledger || []).find((row) => row && row.unit === 'qc_panel_snapshot_live_flip');
  // RED at base df26dbe8: no qc_panel_snapshot_live_flip journal row
  assert.ok(flip, `missing live_flip status=${result.status} phase=${result.phase} reason=${result.reason}`);
  assert.strictEqual(flip.sealed_station, 'panel');
  assert.strictEqual(flip.live_seats_complete, false);
  const stationRow = (result.ledger || []).find((row) => row.unit === 'full_diff_review' && row.station === 'panel');
  assert.ok(stationRow || reviewModels.length >= 3,
    `station missing models=${reviewModels.length} status=${result.status}`);
}

console.log('snapshot-contract assertions passed');
NODE
)"
assert_exit_code "$?" "0" "snapshot-contract node assertions exit zero"
assert_contains "$OUT" "snapshot-contract assertions passed" "D2 snapshot-contract cases pass"

finalize_test
