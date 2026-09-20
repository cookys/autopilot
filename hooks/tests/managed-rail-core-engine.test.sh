#!/usr/bin/env bash
. "$(dirname "$0")/lib.sh"
# Mission harness injects root-run / reconcile receipts that must not poison unit tests.
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

REPO="$TEST_TMP/repo"
mkdir -p "$REPO/docs/plans" "$REPO/.claude" "$REPO/src"
git -C "$REPO" init -q -b main
git -C "$REPO" config user.email "managed-rail@example.invalid"
git -C "$REPO" config user.name "Managed Rail Test"
write_mission_governance "$REPO/.claude/owner-kernel-governance.json" shadow
printf '## Strict bridge\nFrozen authority.\n' > "$REPO/docs/plans/spec.md"
printf 'seed\n' > "$REPO/src/fixture.js"
printf '.autopilot/\n' > "$REPO/.gitignore"
git -C "$REPO" add .
git -C "$REPO" commit -qm "base"
BASE="$(git -C "$REPO" rev-parse HEAD)"
PROMPT="$TEST_TMP/prompt.txt"
printf 'Implement the managed-rail repair-scope fixture.\n' > "$PROMPT"

SUITE="$TEST_TMP/managed-rail-core-engine.js"
cat > "$SUITE" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const [root, repo, base, promptFile, tmp] = process.argv.slice(2);
const {
  AutopilotEngine,
  runCampaignIntake,
  campaignIdFor,
} = require(path.join(root, 'src', 'engine'));

const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const common = fs.realpathSync(path.resolve(repo, git('rev-parse', '--git-common-dir')));
const seats = [{
  role: 'qc', runner: 'cc-shim', model: 'fixture-reviewer', effort: 'high',
  endpoint: null, family: 'fixture',
}];
const roster = {
  reviewer_engine: seats[0].model,
  reviewer_effort: 'high',
  reviewer_runner: 'cc-shim',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 3,
  loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 1,
  qc_panel_seats_complete: true,
  qc_panel_seats: seats,
};

function writeCampaign(ticket) {
  const dir = path.join(tmp, `${ticket}-campaign`);
  fs.mkdirSync(dir, { recursive: true });
  const campaignPath = path.join(dir, 'campaign.json');
  const sealPath = path.join(dir, 'campaign.seal.json');
  const campaign = {
    schema_version: 1,
    ticket,
    profile: 'poc',
    mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`,
    base_sha: base,
    branch: `impl/${ticket}`,
    vertical_acceptance: ['managed rail repair scope'],
    allowed_path_prefixes: ['src/'],
    max_changed_files: 4,
    baseline_churn: 10,
    max_growth_ratio: 1.5,
    max_extra_churn: 5,
    max_repair_generations: 2,
    max_wall_seconds: 7200,
    verify_cmd: 'test -f src/fixture.js',
    rubric_ids: ['R1'],
  };
  fs.writeFileSync(campaignPath, `${JSON.stringify(campaign, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', campaignPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  return { campaignPath, sealPath, campaign };
}

function dispatchOk(args, reused) {
  return {
    error: null,
    status: 0,
    signal: null,
    stdout: '',
    stderr: '',
    parseError: null,
    result: {
      status: 'committed',
      runner: 'fixture',
      model: 'fixture-implementer',
      branch: args[args.indexOf('--branch') + 1],
      base: args[args.indexOf('--base') + 1],
      commit: base,
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      worktree: repo,
      provider_session_id: null,
      provider_session_reused: false,
      worktree_reused: reused,
      agent_log: null,
      error: null,
      containment: 'plain',
      contained: true,
    },
  };
}

function runCase({ ticket, changedFiles, finding, afterInitialScope }) {
  const autopilot = path.join(repo, '.autopilot');
  if (fs.existsSync(autopilot)) {
    fs.rmSync(autopilot, { recursive: true, force: true });
  }
  execFileSync('git', ['-C', repo, 'checkout', '--', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'clean', '-fd', '-e', '.autopilot'], { stdio: 'ignore' });
  const { campaignPath, sealPath, campaign } = writeCampaign(ticket);
  const admitted = runCampaignIntake({
    repo,
    contractPath: campaignPath,
    sealPath,
    promptFile,
    base,
    branch: campaign.branch,
    roster,
  }, {
    now: () => '2026-07-26T00:00:00.000Z',
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    claimGeneration: () => ({
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: ticket,
      ledger: path.join(repo, '.autopilot', 'injected-ledger.jsonl'),
      stage_identity: `run-ledger:1:${ticket}`,
    }),
  });
  assert.strictEqual(admitted.status, 'admitted', JSON.stringify(admitted).slice(0, 800));
  const campaignId = campaignIdFor(
    admitted.initial_state.repo_identity,
    admitted.contract.ticket,
    admitted.contract_digest,
  );
  let repairResult = null;
  let dispatchCount = 0;
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-26T00:00:01.000Z',
    campaignIntake() {
      return {
        ...admitted,
        campaign_id: campaignId,
        contract: {
          ...admitted.contract,
          verify_cmd: 'test -f src/fixture.js',
          max_repair_generations: 2,
        },
        generation_claim: {
          ledger: path.join(repo, '.autopilot', 'identity-ledger.jsonl'),
          generation: 1,
          nonce: ticket,
          stage_identity: `run-ledger:1:${ticket}`,
        },
      };
    },
    campaignScopeChecker() {
      return {
        passed: true,
        verdict: 'PASS',
        changed_files: changedFiles,
        total_churn: 0,
        receipt_digest: 'a'.repeat(64),
      };
    },
    campaignComposer(_input, adapters) {
      const initial = adapters.implement({
        kind: 'initial',
        repair_generation: 0,
        repair_finding_ids: [],
        repair_findings: [],
      });
      if (!initial.committed) return { status: 'blocked', ...initial };
      if (afterInitialScope) {
        const initialScope = adapters.scopeCheck({
          checkpoint: 'after_initial_mutation',
          candidate: initial,
        });
        if (!initialScope.passed) return { status: 'blocked', ...initialScope };
      }
      repairResult = adapters.implement({
        kind: 'review_repair',
        repair_generation: 1,
        repair_finding_ids: [finding.id],
        repair_findings: [finding],
      });
      return {
        status: repairResult.committed ? 'ready' : 'blocked',
        phase: repairResult.phase || null,
        reason: repairResult.reason || null,
      };
    },
    implementationDispatcher(args) {
      dispatchCount += 1;
      return dispatchOk(args, dispatchCount > 1);
    },
    repairPromptWriter() {
      return promptFile;
    },
    campaignTreeResolver() {
      return spawnSync(
        'git',
        ['rev-parse', `${base}^{tree}`],
        { cwd: repo, encoding: 'utf8' },
      ).stdout.trim();
    },
  }).runImplementationReviewLoop({
    promptFile,
    branch: campaign.branch,
    base,
    roster,
    campaignManaged: true,
    campaignContract: campaignPath,
    implementationOptions: {
      env: {
        AUTOPILOT_ROOT_RUN_ID: campaignId,
        AUTOPILOT_DISPATCH_DEPTH: '1',
      },
    },
  });
  return { engine, repairResult, dispatchCount };
}

const pathlessWithSurface = {
  id: 'spurious-live-flip-single-station',
  claim: 'Engine `snapshotStation` flipped live without naming a file',
  source: 'product_review',
  disposition: {
    disposition: 'must-fix-now',
    task_surface: 'src/fixture.js',
    deferral_harm: 'unfixed acceptance remains',
  },
};

const surfaceCase = runCase({
  ticket: 'rail-surface',
  changedFiles: ['src/fixture.js'],
  finding: pathlessWithSurface,
  afterInitialScope: true,
});
console.log(`surface_committed=${surfaceCase.repairResult && surfaceCase.repairResult.committed}`);
console.log(`surface_phase=${surfaceCase.repairResult && surfaceCase.repairResult.phase}`);
console.log(`surface_reason=${surfaceCase.repairResult && surfaceCase.repairResult.reason}`);
console.log(`surface_seal=${JSON.stringify(
  surfaceCase.engine.repair_lineage && surfaceCase.engine.repair_lineage.repair_scope_seal,
)}`);
console.log(`surface_dispatches=${surfaceCase.dispatchCount}`);

const parkCase = runCase({
  ticket: 'rail-park',
  changedFiles: [],
  finding: {
    id: 'pathless-no-surface',
    claim: 'Engine `snapshotStation` with no file and no surface',
    source: 'product_review',
  },
  afterInitialScope: false,
});
console.log(`park_committed=${parkCase.repairResult && parkCase.repairResult.committed}`);
console.log(`park_phase=${parkCase.repairResult && parkCase.repairResult.phase}`);
console.log(`park_reason=${parkCase.repairResult && parkCase.repairResult.reason}`);
console.log(`park_engine_phase=${parkCase.engine.phase}`);
console.log(`park_engine_status=${parkCase.engine.status}`);
console.log(`park_dispatches=${parkCase.dispatchCount}`);

function runVerifyLedgerCase({ ticket, stdout, stderr }) {
  const autopilot = path.join(repo, '.autopilot');
  if (fs.existsSync(autopilot)) {
    fs.rmSync(autopilot, { recursive: true, force: true });
  }
  execFileSync('git', ['-C', repo, 'checkout', '--', '.'], { stdio: 'ignore' });
  execFileSync('git', ['-C', repo, 'clean', '-fd', '-e', '.autopilot'], { stdio: 'ignore' });
  const { campaignPath, sealPath, campaign } = writeCampaign(ticket);
  const admitted = runCampaignIntake({
    repo,
    contractPath: campaignPath,
    sealPath,
    promptFile,
    base,
    branch: campaign.branch,
    roster,
  }, {
    now: () => '2026-07-26T00:00:00.000Z',
    readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
    contextGate: () => ({ owner: 'context_window', status: 'ready' }),
    occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
    claimGeneration: () => ({
      owner: 'campaign_generation',
      status: 'claimed',
      generation: 1,
      nonce: ticket,
      ledger: path.join(repo, '.autopilot', 'injected-ledger.jsonl'),
      stage_identity: `run-ledger:1:${ticket}`,
    }),
  });
  assert.strictEqual(admitted.status, 'admitted', JSON.stringify(admitted).slice(0, 800));
  const campaignId = campaignIdFor(
    admitted.initial_state.repo_identity,
    admitted.contract.ticket,
    admitted.contract_digest,
  );
  const treeSha = spawnSync(
    'git',
    ['rev-parse', `${base}^{tree}`],
    { cwd: repo, encoding: 'utf8' },
  ).stdout.trim();
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-26T00:00:01.000Z',
    campaignIntake() {
      return {
        ...admitted,
        campaign_id: campaignId,
        contract: {
          ...admitted.contract,
          verify_cmd: 'test -f src/fixture.js',
          max_repair_generations: 2,
        },
        generation_claim: {
          ledger: path.join(repo, '.autopilot', 'identity-ledger.jsonl'),
          generation: 1,
          nonce: ticket,
          stage_identity: `run-ledger:1:${ticket}`,
        },
      };
    },
    campaignScopeChecker() {
      return {
        passed: true,
        verdict: 'PASS',
        changed_files: ['src/fixture.js'],
        total_churn: 0,
        receipt_digest: 'a'.repeat(64),
      };
    },
    campaignComposer(_input, adapters) {
      const initial = adapters.implement({
        kind: 'initial',
        repair_generation: 0,
        repair_finding_ids: [],
        repair_findings: [],
      });
      if (!initial.committed) return { status: 'blocked', ...initial };
      const verified = adapters.verify({
        candidate: initial,
        repair_generation: 0,
      });
      return {
        status: verified && verified.passed ? 'ready' : 'blocked',
        phase: verified && verified.phase ? verified.phase : 'campaign_verification',
        reason: verified && verified.reason ? verified.reason : null,
      };
    },
    implementationDispatcher(args) {
      return dispatchOk(args, false);
    },
    repairPromptWriter() {
      return promptFile;
    },
    campaignTreeResolver() {
      return treeSha;
    },
    gitWorktreeAdd({ commit }) {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree: path.join(tmp, `${ticket}-wt`),
        parent: path.join(tmp, `${ticket}-parent`),
        commit,
        observed_commit: commit,
        observed_tree_sha: treeSha,
        detached: true,
      };
    },
    gitWorktreeRemove() {
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
      };
    },
    verifyWorktreeCleanup() {},
    verifyCommandRunner({ verifyCmd }) {
      return {
        error: null,
        status: 1,
        signal: null,
        stdout,
        stderr,
        executed_argv: ['/bin/sh', '-c', verifyCmd],
      };
    },
  }).runImplementationReviewLoop({
    promptFile,
    branch: campaign.branch,
    base,
    roster,
    campaignManaged: true,
    campaignContract: campaignPath,
    implementationOptions: {
      env: {
        AUTOPILOT_ROOT_RUN_ID: campaignId,
        AUTOPILOT_DISPATCH_DEPTH: '1',
      },
    },
  });
  const entries = (engine.ledger || []).filter((row) => row.unit === 'campaign_verification');
  assert.strictEqual(entries.length, 1, JSON.stringify(engine.ledger).slice(0, 2000));
  return entries[0];
}

const distinctive = runVerifyLedgerCase({
  ticket: 'rail-verify-fail',
  stdout: 'R10_DISTINCT_STDOUT',
  stderr: 'R10_DISTINCT_STDERR',
});
assert.strictEqual(distinctive.status, 'failed');
assert.strictEqual(distinctive.verify_stdout_tail, 'R10_DISTINCT_STDOUT');
assert.strictEqual(distinctive.verify_stderr_tail, 'R10_DISTINCT_STDERR');
console.log(`r10_verify_status=${distinctive.status}`);
console.log(`r10_stdout_tail=${distinctive.verify_stdout_tail}`);
console.log(`r10_stderr_tail=${distinctive.verify_stderr_tail}`);

const hugeStdout = `HEAD_MARKER_R10${'x'.repeat(12000)}TAIL_MARKER_R10`;
const hugeStderr = `HEAD_ERR_R10${'y'.repeat(12000)}TAIL_ERR_R10`;
const capped = runVerifyLedgerCase({
  ticket: 'rail-verify-huge',
  stdout: hugeStdout,
  stderr: hugeStderr,
});
const ledgerJson = JSON.stringify(capped);
assert.ok(capped.verify_stdout_tail.includes('TAIL_MARKER_R10'), capped.verify_stdout_tail.slice(-80));
assert.ok(capped.verify_stderr_tail.includes('TAIL_ERR_R10'), capped.verify_stderr_tail.slice(-80));
assert.ok(!capped.verify_stdout_tail.includes('HEAD_MARKER_R10'), 'stdout tail must drop the head');
assert.ok(!capped.verify_stderr_tail.includes('HEAD_ERR_R10'), 'stderr tail must drop the head');
assert.ok(Buffer.byteLength(capped.verify_stdout_tail, 'utf8') <= 4096);
assert.ok(Buffer.byteLength(capped.verify_stderr_tail, 'utf8') <= 4096);
assert.ok(ledgerJson.length < 20000, `ledger entry too large: ${ledgerJson.length}`);
console.log(`r10_stdout_tail_bytes=${Buffer.byteLength(capped.verify_stdout_tail, 'utf8')}`);
console.log(`r10_stderr_tail_bytes=${Buffer.byteLength(capped.verify_stderr_tail, 'utf8')}`);
console.log(`r10_ledger_json_len=${ledgerJson.length}`);
console.log('managed_rail_core_engine=true');
NODE
# RED at 88c7189721b7b63224624935efb9c322a1e7d65f:
#   surface_committed=false
#   surface_phase=campaign_repair_scope_seal
#   surface_reason=finding spurious-live-flip-single-station has no explicit allowed repair path
#   park_phase=campaign_repair_scope_seal
#   park_reason=repair scope cannot be sealed without initial changed paths
#   park_engine_status=blocked
# GREEN park_engine_* (engine honors durable_wait / terminalize:false / awaiting_disposition):
#   park_engine_phase=awaiting_disposition
#   park_engine_status=blocked


OUT="$(node "$SUITE" "$REPO_ROOT" "$REPO" "$BASE" "$PROMPT" "$TEST_TMP" < /dev/null)"
EXIT=$?
echo "$OUT"
assert_exit_code "$EXIT" "0" "managed-rail core engine suite process exits 0: $OUT"

assert_r1_managed_rail_repair() {
  assert_contains "$OUT" "surface_committed=true" \
    "pathless must-fix finding seals repair scope from disposition task_surface"
  assert_not_contains "$OUT" "has no explicit allowed repair path" \
    "findingBoundRepairPaths must not throw when task_surface binds a path"
  assert_contains "$OUT" "src/fixture.js" \
    "repair scope seal includes task_surface path"
  assert_eq "$(printf '%s\n' "$OUT" | sed -n 's/^park_phase=//p' | head -n 1)" \
    "awaiting_disposition" \
    "empty task_surface and empty changed files PARK awaiting_disposition"
  assert_not_contains "$(printf '%s\n' "$OUT" | sed -n '/^park_/p')" \
    "campaign_repair_scope_seal" \
    "park case must not terminalize via campaign_repair_scope_seal"
  assert_not_contains "$OUT" "park_engine_status=terminal_stop" \
    "park case engine status must not be terminal_stop"
  assert_eq "$(printf '%s\n' "$OUT" | sed -n 's/^park_engine_status=//p' | head -n 1)" \
    "blocked" \
    "park case engine status is blocked (awaiting disposition)"
  assert_eq "$(printf '%s\n' "$OUT" | sed -n 's/^park_engine_phase=//p' | head -n 1)" \
    "awaiting_disposition" \
    "park case engine phase is awaiting_disposition"
}

assert_r1_managed_rail_repair
assert_contains "$OUT" "managed_rail_core_engine=true" "managed-rail suite completed"

assert_r10_managed_rail_verifyc() {
  assert_contains "$OUT" "r10_verify_status=failed" \
    "failing verify_cmd records campaign_verification as failed"
  assert_contains "$OUT" "r10_stdout_tail=R10_DISTINCT_STDOUT" \
    "ledger campaign_verification carries bounded verify stdout"
  assert_contains "$OUT" "r10_stderr_tail=R10_DISTINCT_STDERR" \
    "ledger campaign_verification carries bounded verify stderr"
  local stdout_bytes stderr_bytes
  stdout_bytes="$(printf '%s\n' "$OUT" | sed -n 's/^r10_stdout_tail_bytes=//p' | head -n 1)"
  stderr_bytes="$(printf '%s\n' "$OUT" | sed -n 's/^r10_stderr_tail_bytes=//p' | head -n 1)"
  assert_eq "$stdout_bytes" "4096" "huge stdout is capped at 4 KiB"
  assert_eq "$stderr_bytes" "4096" "huge stderr is capped at 4 KiB"
  local engine="$REPO_ROOT/src/engine/autopilot-engine.js"
  if ! grep -q 'verify_stdout_tail' "$engine"; then
    fail "ledger call site must set verify_stdout_tail"
  fi
  if ! grep -q 'verify_stderr_tail' "$engine"; then
    fail "ledger call site must set verify_stderr_tail"
  fi
  if ! grep -n "autopilot-verify-wt-" "$engine" | grep -q .; then
    fail "defaultGitWorktreeAdd still uses detached verify worktree prefix"
  fi
  awk '
    /autopilot-verify-wt-/ {
      for (i = 1; i <= n; i++) print buf[i]
      print
      exit
    }
    {
      if (n < 4) { n++; buf[n] = $0; next }
      for (i = 1; i < 4; i++) buf[i] = buf[i + 1]
      buf[4] = $0
    }
  ' "$engine" | grep -q 'self-bootstrap' \
    || fail "detached verify worktree comment must say verify_cmd self-bootstraps deps"
}

assert_r10_managed_rail_verifyc
finalize_test
