'use strict';
// Driver for hooks/tests/review-candidate.test.sh: ONE scenario per process, in a throwaway repo
// under ctx.tmp (the ledger lives in that repo's own git common dir, never the real one).
//   node review-candidate-driver.js <ctx.json>
// ctx: { root, tmp, tag, stub, scenario, seats?, verdict?, stubAdmission?, authorFamily?, preset?,
//        steps? }   steps: [{ env?: {RC_VERDICT, RC_FAIL_MODEL}, move?: 'forward'|'sideways'|'same',
//        continuation?: 'end'|'return'|..., resume?: true (default) }] run after the first run, each
//        with a fresh engine over the same options (a new process in production).
// Prints ONE json line of observations (last stdout line).
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ctx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = ctx.root;
const scenario = ctx.scenario;
const reviewRunner = require(path.join(root, 'src', 'runners', 'review'));
const realBatch = reviewRunner.dispatchReviewJsonBatch;
reviewRunner.dispatchReviewJsonBatch = (list, opts) => realBatch(
  list.map((item) => ({ ...item, scriptPath: ctx.stub })), opts,
);
const sbx = path.join(ctx.tmp, ctx.tag, 'repo');
const outDir = path.join(ctx.tmp, ctx.tag);
const logFile = path.join(outDir, 'review.log');
const diffDir = path.join(outDir, 'seat-diffs');
fs.mkdirSync(sbx, { recursive: true });
fs.mkdirSync(diffDir, { recursive: true });
fs.writeFileSync(logFile, '');
process.env.RC_LOG = logFile;
process.env.RC_DIFF_DIR = diffDir;
const packetDir = path.join(outDir, 'seat-packets');
process.env.RC_PACKET_DIR = packetDir;
process.env.RC_VERDICT = ctx.verdict || 'ship';
process.env.RC_FAIL_MODEL = ctx.failModel || '';
const {
  AutopilotEngine, runCampaignIntake, compileCampaignDispositionPolicy, runCampaignComposition,
} = require(path.join(root, 'src', 'engine'));
const intake = require(path.join(root, 'src', 'engine', 'campaign-intake'));

const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const branch = `ext/${ctx.tag}`;
const worktree = path.join(outDir, 'ext-wt');
const contractPath = path.join(outDir, 'campaign.json');
const sealPath = path.join(outDir, 'campaign.seal.json');
const promptFile = path.join(outDir, 'spec.md');
const isImplControl = scenario === 'implement_control';

// ---- throwaway repo ----------------------------------------------------------------------------
spawnSync('git', ['-C', sbx, 'init', '-q']);
git(sbx, 'config', 'user.email', 'rc@example.invalid');
git(sbx, 'config', 'user.name', 'RC');
fs.mkdirSync(path.join(sbx, '.claude'), { recursive: true });
fs.mkdirSync(path.join(sbx, 'src'), { recursive: true });
const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'));
gov.mission_convergence = {
  schema_version: 1, enforcement_mode: scenario === 'enforce_seal' ? 'enforce' : 'shadow', max_campaigns: 8, max_wall_seconds: 7200,
  max_tool_calls: 1000, max_engine_attempts: 100, max_external_wait_seconds: 600,
  max_canonical_changed_files: 100, max_output_bytes: 1000000, max_deliverables: 8,
  max_parallel: 3, max_batches: 4, max_graph_depth: 4, max_gate_attempts: 16, closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(path.join(sbx, '.claude', 'owner-kernel-governance.json'), `${JSON.stringify(gov, null, 2)}\n`);
fs.writeFileSync(path.join(sbx, 'src', 'value.txt'), 'base\n');
fs.writeFileSync(path.join(sbx, '.gitignore'), 'marker.txt\n');
git(sbx, 'add', '.');
git(sbx, 'commit', '-qm', 'base');
const base = git(sbx, 'rev-parse', 'HEAD');
const mainBranch = git(sbx, 'rev-parse', '--abbrev-ref', 'HEAD');
const commonDir = fs.realpathSync(path.resolve(sbx, git(sbx, 'rev-parse', '--git-common-dir')));
const ledgerPath = path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl');

// ---- the externally produced range (built in a side worktree; the operator checkout stays on base) ----
const range = {
  ok: () => { fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), 'external\n'); },
  out_of_scope: () => {
    fs.mkdirSync(path.join(worktree, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'docs', 'leak.md'), 'outside the allowed prefixes\n');
  },
  file_cap: () => {
    fs.writeFileSync(path.join(worktree, 'src', 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(worktree, 'src', 'b.txt'), 'b\n');
  },
  // BL-0154: two changed files, under the cap, so a later step can fully revert one of them.
  two_files: () => {
    fs.writeFileSync(path.join(worktree, 'src', 'a.txt'), 'a\n');
    fs.writeFileSync(path.join(worktree, 'src', 'b.txt'), 'b\n');
  },
  // BL-0146 D4: five files (the file cap), so a one-file fix is a small share of the range.
  multi: () => {
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), 'external\n');
    for (const name of ['a', 'b', 'c', 'd']) fs.writeFileSync(path.join(worktree, 'src', `${name}.txt`), `${name} payload\n`);
  },
  churn_warn: () => {
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `${'line\n'.repeat(60)}`);
  },
  marker_committed: () => {
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), 'external\n');
    fs.writeFileSync(path.join(worktree, 'src', 'marker.txt'), 'present\n');
    git(worktree, 'add', '-f', 'src/marker.txt');
  },
};
const rangeKind = {
  out_of_scope: 'out_of_scope', file_cap: 'file_cap', churn_warn: 'churn_warn',
  marker_committed: 'marker_committed', two_files: 'two_files', multi: 'multi',
}[scenario] || 'ok';
let head = null;
if (!isImplControl) {
  git(sbx, 'worktree', 'add', '-q', '-b', branch, worktree, base);
  if (scenario === 'not_ancestor') {
    git(worktree, 'checkout', '-q', '--orphan', `orphan-${ctx.tag}`);
    git(worktree, 'rm', '-rfq', '.');
    fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), 'unrelated\n');
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-qm', 'unrelated history');
    head = git(worktree, 'rev-parse', 'HEAD');
    git(sbx, 'update-ref', `refs/heads/${branch}`, head);
  } else {
    range[rangeKind]();
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-qm', 'external change');
    head = git(worktree, 'rev-parse', 'HEAD');
  }
}

// ---- contract + seal -------------------------------------------------------------------------------
const verifyCmd = (scenario === 'ignored_marker' || scenario === 'marker_committed') ? 'test -f src/marker.txt' : 'true';
if (scenario === 'dirty_operator') fs.writeFileSync(path.join(sbx, 'untracked.txt'), 'operator-only\n');
if (scenario === 'ignored_marker') fs.writeFileSync(path.join(sbx, 'src', 'marker.txt'), 'operator-only\n');
let candidateForControl = null;
if (isImplControl) {
  git(sbx, 'worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), 'impl\n');
  git(worktree, 'add', '-A');
  git(worktree, 'commit', '-qm', 'impl');
  candidateForControl = git(worktree, 'rev-parse', 'HEAD');
}
const authorFamily = ctx.authorFamily || null;
const contractBody = {
  schema_version: 1, ticket: ctx.tag, profile: 'poc', mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`, base_sha: base, branch,
  vertical_acceptance: ['src/value.txt must change'],
  allowed_path_prefixes: ['src/'],
  max_changed_files: scenario === 'file_cap' ? 1 : 5,
  baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5,
  max_repair_generations: isImplControl || scenario === 'impl_under_candidate' ? 2 : 0,
  max_wall_seconds: 600, final_panel_reserve_seconds: 0,
  verify_cmd: verifyCmd, rubric_ids: ['ICC-RC1'],
};
const sealedHead = scenario === 'missing_head' ? 'e'.repeat(40) : head;
if (scenario === 'head_equals_base') contractBody.adoption = { head_sha: base };
else if (!isImplControl && scenario !== 'impl_under_candidate') {
  contractBody.adoption = { head_sha: sealedHead, ...(authorFamily ? { author_family: authorFamily } : {}) };
}
if (ctx.preset && contractBody.adoption) contractBody.adoption.disposition_preset = ctx.preset;
if (ctx.returnReview && contractBody.adoption) contractBody.adoption.return_review = ctx.returnReview;
if (scenario === 'adoption_with_strict_dispatch') contractBody.strict_dispatch = true;
fs.writeFileSync(promptFile, 'review the externally produced range\n');
fs.writeFileSync(contractPath, `${JSON.stringify(contractBody, null, 2)}\n`);
const seal = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'),
  'seal', '--contract', contractPath, '--repo', sbx, '--mission-mode', scenario === 'enforce_seal' ? 'enforce' : 'shadow', '--out', sealPath,
], { cwd: sbx, encoding: 'utf8' });
const emit = (obj) => fs.writeSync(1, `${JSON.stringify(obj)}\n`);
if (seal.status !== 0) {
  emit({ scenario, seal_status: seal.status, seal_error: `${seal.stderr || ''}${seal.stdout || ''}`.slice(0, 600) });
  process.exit(0);
}

// ---- engine --------------------------------------------------------------------------------------------
const seats = ctx.seats || [
  { role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic' },
  { role: 'qc', runner: 'cc-shim', model: 'gpt-5.4', effort: 'high', endpoint: null, family: 'openai' },
  { role: 'qc', runner: 'cc-shim', model: 'glm-4.7', effort: 'high', endpoint: null, family: 'zai' },
];
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim',
  reviewer_qualified: true, implementer_engine: 'fixture-implementer',
  implementer_effort: 'high', implementer_runner: 'fixture',
  loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: ctx.minPanel || 3,
  qc_panel_seats_complete: true, qc_panel_seats: seats, in_rail_review: 'panel',
  override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
};
if (scenario === 'strict_readiness' || scenario === 'strict_readiness_review_only') {
  // The strict l4 bootstrap digests the roster the host resolved, implementer_family included.
  // review-candidate overrides that field for the panel's family rule, so the override must
  // land AFTER the readiness check or the digest reads as drift ("roster changed after bootstrap").
  Object.assign(roster, {
    implementer_family: 'fixture', reviewer_family: 'anthropic', implementer_endpoint: null, reviewer_endpoint: null,
    verification_author_present: false, verification_author_engine: '', verification_author_runner: '',
    verification_author_effort: '', verification_author_endpoint: '', verification_author_family: 'unknown',
  });
  if (ctx.withVerificationAuthor) {
    Object.assign(roster, {
      verification_author_present: true, verification_author_engine: 'fixture-va', verification_author_runner: 'fixture',
      verification_author_effort: 'high', verification_author_endpoint: null, verification_author_family: 'fixture',
    });
  }
}
const probedSeatsRef = { value: [] };
let impl = 0;
let verifyRuns = 0;
let adopterAdmissionCalls = 0;
const verifyCwds = [];
const reviewBase = isImplControl ? candidateForControl : head;
const gitWt = ({ commit } = {}) => {
  const useCommit = commit || reviewBase;
  const verifyWt = path.join(outDir, `verify-${String(useCommit).slice(0, 12)}-${verifyRuns}`);
  execFileSync('git', ['-C', sbx, 'worktree', 'add', '-q', '--detach', verifyWt, useCommit]);
  return {
    error: null, status: 0, signal: null, stdout: '', stderr: '', worktree: verifyWt, parent: null,
    commit: useCommit, observed_commit: useCommit,
    observed_tree_sha: git(verifyWt, 'rev-parse', 'HEAD^{tree}'), detached: true,
  };
};
// A step's clockSkewSeconds moves the engine clock forward (a long interruption); it persists for later steps.
let clockSkewMs = 0;
// A step's mustFixAuthority sets the repair-round estimate the intake sees (the engine does not forward one).
let intakeEstimateSeconds = 0;
const options = {
  cwd: sbx,
  clock: () => new Date(Date.now() + clockSkewMs).toISOString(),
  campaignDispositionProvider: compileCampaignDispositionPolicy('acceptance-bound'),
  campaignIntake(input, engineAdapters) {
    return runCampaignIntake(intakeEstimateSeconds ? { ...input, repairRoundEstimateSeconds: intakeEstimateSeconds } : input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      ...(engineAdapters || {}),
    });
  },
  campaignScopeChecker({ session, head } = {}) {
    // The engine must hand the checker a scope session sealed to the adopted head; a missing one
    // is what made the live run trip "campaign scope seal drifted" while this stub stayed green.
    if (!session || !session.contract || session.contract.implementation_sha !== head) {
      return { passed: false, reason: 'campaign scope seal drifted', changed_files: [] };
    }
    return { passed: true, changed_files: ['src/value.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
  },
  implementationDispatcher() {
    impl += 1;
    const wt = path.join(outDir, 'unused-impl');
    return {
      error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
      result: {
        status: 'committed', runner: 'fixture', model: 'fixture-implementer',
        branch, base, commit: candidateForControl, files_changed: 1, insertions: 1, deletions: 0,
        worktree: wt,
      },
    };
  },
  gitWorktreeAdd: gitWt,
  gitWorktreeRemove({ worktree: wt } = {}) {
    if (wt) { try { git(sbx, 'worktree', 'remove', '--force', wt); } catch (_e) { /* gone */ } }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  repairLineageCleanupTransaction({ record }) {
    if (record && record.worktree) {
      try { git(sbx, 'worktree', 'remove', '--force', record.worktree); } catch (_e) { /* gone */ }
    }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
};
if (scenario === 'moved_after' || scenario === 'red_verify') {
  options.verifyCommandRunner = (args) => {
    verifyRuns += 1;
    verifyCwds.push(args && args.cwd ? String(args.cwd) : null);
    if (scenario === 'moved_after') {
      const tree = git(sbx, 'rev-parse', `${head}^{tree}`);
      const moved = execFileSync('git', ['-C', sbx, 'commit-tree', tree, '-p', head, '-m', 'moved after admission'], {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      git(sbx, 'update-ref', `refs/heads/${branch}`, moved);
    }
    return {
      error: null, status: scenario === 'red_verify' ? 1 : 0, signal: null,
      stdout: '', stderr: scenario === 'red_verify' ? 'red\n' : '', executed_argv: ['/bin/sh', '-c', verifyCmd],
    };
  };
}
if (ctx.stubAdmission) {
  // GATE MUTATION: the re-derivation is replaced by an always-ready stub (intake and pre-review).
  options.adoptionAdmission = ({ contract }) => {
    adopterAdmissionCalls += 1;
    const sealed = contract.adoption.head_sha;
    let tree = 'f'.repeat(40);
    try { tree = git(sbx, 'rev-parse', `${sealed}^{tree}`); } catch (_e) { /* keep placeholder */ }
    return {
      owner: 'adoption_admission', status: 'ready', head: sealed, base: contract.base_sha,
      branch: contract.branch, tree_sha: tree, changed_files: ['src/value.txt'], total_churn: 1,
      scope_receipt_digest: 'd'.repeat(64), warnings: [],
    };
  };
}
const forced = { called: false, result: null };
if (scenario === 'forced_writer') {
  options.campaignComposer = (composeInput, composeAdapters) => {
    // Plant the RO1 control: reach the implement adapter directly, as a regression would.
    try {
      forced.result = composeAdapters.implement({ generation: 0 });
    } catch (error) { forced.result = { thrown: String(error.message || error) }; }
    forced.called = true;
    return runCampaignComposition(composeInput, composeAdapters);
  };
}
if (scenario === 'strict_readiness' || scenario === 'strict_readiness_review_only') {
  const { createStrictL5ProviderBootstrap } = require(path.join(root, 'src', 'readiness', 'provider-bootstrap'));
  const { buildSelectedRoster } = require(path.join(root, 'src', 'readiness', 'status'));
  const { createProviderReadinessReceipt } = require(path.join(root, 'src', 'readiness', 'receipt'));
  const NOW = new Date().toISOString();
  const resolvedRoster = { ...roster, provider_readiness_receipt_ttl_seconds: 3600, provider_readiness_fallback_family_constraint: 'different' };
  const observation = (tuple, axis, ttl) => ({
    schema_version: 1, artifact_type: 'provider_axis_observation', tuple, axis, status: 'ready',
    observed_at: NOW, ttl_seconds: ttl,
    evidence_class: axis === 'qualification' ? 'host-injected-exact-role' : (axis === 'transport' ? 'safe-surface' : 'live-probe'),
    reason: null,
  });
  const probed = [];
  const readyCollector = (o) => {
    const ttl = o.resolvedRoster.provider_readiness_receipt_ttl_seconds;
    const selected = buildSelectedRoster(o.resolvedRoster, o.now, ttl);
    for (const seat of selected) {
      for (const candidate of [seat, ...seat.fallbacks]) {
        probed.push(seat.seat_id);
        // An exhausted implementer provider (the host's grok quota): its live probe is not ready.
        const exhausted = scenario === 'strict_readiness_review_only' && candidate.tuple.role === 'implementer';
        candidate.observations = {
          transport: observation(candidate.tuple, 'transport', ttl),
          live: exhausted
            ? { ...observation(candidate.tuple, 'live', ttl), status: 'unavailable', reason: 'quota exhausted' }
            : observation(candidate.tuple, 'live', ttl),
          qualification: observation(candidate.tuple, 'qualification', ttl),
        };
      }
    }
    const policy = { receipt_ttl_seconds: ttl, fallback_family_constraint: o.resolvedRoster.provider_readiness_fallback_family_constraint };
    return { receipt: createProviderReadinessReceipt({ roster: selected, policy, now: o.now }), roster: selected, policy };
  };
  const bootstrap = createStrictL5ProviderBootstrap({
    cwd: sbx,
    level: ctx.level || 'l4',
    ...(scenario === 'strict_readiness_review_only' && !ctx.omitReviewOnlyFlag ? { reviewOnly: true } : {}),
  }, {
    resolvedRoster, collectReadiness: readyCollector, now: () => NOW,
  });
  probedSeatsRef.value = probed;
  options.providerReadinessAuthority = bootstrap.providerReadinessAuthority;
  options.qualificationProvider = bootstrap.qualificationProvider;
  Object.assign(roster, resolvedRoster);
}
const engine = new AutopilotEngine(options);
const installImplControl = (eng) => {
  if (!isImplControl) return;
  eng.implementTask = () => {
    impl += 1;
    return {
      status: 'committed', dispatcher_called: true,
      implementation: {
        commit: candidateForControl, worktree, run_id: `run-${ctx.tag}`, dispatch_id: `d-${ctx.tag}`,
        provider: 'fixture', runner: 'fixture', model: 'fixture-implementer', insertions: 1, deletions: 0,
      },
      implementationResult: { error: null, signal: null, status: 0 },
      ledger: [],
    };
  };
};
installImplControl(engine);
const reviewMode = !(isImplControl || scenario === 'adopt_under_implement');
const input = {
  promptFile, branch, base, roster,
  campaignContract: contractPath, campaignSeal: sealPath,
  campaignDispositionPolicy: 'acceptance-bound',
  verificationEnv: { PATH: process.env.PATH || '' },
  ...(reviewMode ? { reviewCandidate: true, authorFamily } : {}),
};
if (scenario === 'moved_before') {
  // The branch tip moves between sealing and admission.
  const tree = git(sbx, 'rev-parse', `${head}^{tree}`);
  const moved = execFileSync('git', ['-C', sbx, 'commit-tree', tree, '-p', head, '-m', 'moved before admission'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(sbx, 'update-ref', `refs/heads/${branch}`, moved);
}
let result;
let thrown = null;
try { result = engine.runImplementationReviewLoop(input); } catch (error) { thrown = String(error && error.message || error); result = {}; }

// ---- resume steps (P2): move the branch, flip the stub env, run a fresh engine with --resume ----
const campaignPhaseNow = () => {
  try {
    const cli = require(path.join(root, 'src', 'campaign', 'cli'));
    const rows = cli.loadRows(ledgerPath);
    const intakeRow = rows.find((r) => r.op === 'campaign_intake');
    return intakeRow ? cli.projectCampaign(rows, intakeRow.run_id).state.phase : null;
  } catch (_e) { return null; }
};
// The first run's process "died": this driver stays in one process, so its own campaign lease would
// read as alive. Close it the way a real exit does (a run-ledger stage-transition to dead).
const killLease = () => {
  const cli = require(path.join(root, 'src', 'campaign', 'cli'));
  const rows = cli.loadRows(ledgerPath);
  const intakeRow = rows.find((r) => r.op === 'campaign_intake');
  if (!intakeRow) return;
  const lease = cli.projectCampaign(rows, intakeRow.run_id).latest_lease;
  if (!lease || lease.state !== 'leased') return;
  execFileSync('bash', [
    path.join(root, 'scripts', 'run-ledger.sh'), 'stage-transition',
    '--ledger', ledgerPath, '--run-id', intakeRow.run_id, '--stage', 'campaign',
    '--generation', String(lease.generation), '--nonce', lease.nonce, '--to-state', 'dead',
    '--idempotency-key', `rc-driver-park:${lease.generation}:${lease.nonce}`,
  ], { cwd: sbx, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
// P5: summarize a repair hand-off. The seeded contract is also run through the real checker (seal),
// exactly as a caller would, so "passes implementation-campaign-check.js" is observed and not assumed.
const handoffSummary = (r) => {
  const h = r && r.repair_handoff;
  if (!h) return null;
  let sealStatus = null;
  let sealError = null;
  let onDisk = null;
  try {
    if (h.contract_path) onDisk = JSON.parse(fs.readFileSync(h.contract_path, 'utf8'));
    const seedFile = path.join(outDir, `seed-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(seedFile, `${JSON.stringify(h.contract, null, 2)}\n`);
    const sealed = spawnSync(process.execPath, [
      path.join(root, 'scripts', 'implementation-campaign-check.js'),
      'seal', '--contract', seedFile, '--repo', sbx, '--mission-mode', 'shadow', '--out', `${seedFile}.seal`,
    ], { cwd: sbx, encoding: 'utf8' });
    sealStatus = sealed.status;
    sealError = `${sealed.stderr || ''}${sealed.stdout || ''}`.slice(0, 400);
  } catch (error) { sealError = String(error && error.message || error); }
  return {
    base_sha: h.base_sha, branch: h.branch, has_adoption: Object.prototype.hasOwnProperty.call(h.contract, 'adoption'),
    max_repair_generations: h.contract.max_repair_generations,
    verify_cmd: h.contract.verify_cmd, allowed_path_prefixes: h.contract.allowed_path_prefixes,
    task_has_findings: typeof h.task_prompt === 'string' && h.task_prompt.includes('## Findings'),
    task_prompt: h.task_prompt,
    task_file_matches: h.task_path ? fs.readFileSync(h.task_path, 'utf8') === h.task_prompt : null,
    contract_file_matches: onDisk ? JSON.stringify(onDisk) === JSON.stringify(h.contract) : null,
    write_error: h.write_error || null,
    seal_status: sealStatus, seal_error: sealError,
  };
};
const stepsOut = [];
let currentHead = head;
for (const stepSpec of (ctx.steps || [])) {
  // keepLease leaves the previous run's lease live, as a still-running owner would.
  if (stepSpec.keepLease !== true) {
    try { killLease(); } catch (_e) { /* surfaced by the step itself */ }
  }
  // dropEvents: simulate a crash by deleting journaled campaign events (e.g. the park) from the ledger.
  if (Array.isArray(stepSpec.dropEvents) && stepSpec.dropEvents.length > 0) {
    const kept = fs.readFileSync(ledgerPath, 'utf8').split('\n').filter((line) => {
      if (!line) return false;
      try {
        const row = JSON.parse(line);
        if (row.op !== 'campaign_event') return true;
        return !stepSpec.dropEvents.includes(JSON.parse(row.payload).event.event_type);
      } catch (_e) { return true; }
    });
    fs.writeFileSync(ledgerPath, `${kept.join('\n')}\n`);
  }
  if (Number.isFinite(stepSpec.clockSkewSeconds)) clockSkewMs = stepSpec.clockSkewSeconds * 1000;
  const stepEnv = stepSpec.env || {};
  process.env.RC_VERDICT = stepEnv.RC_VERDICT || 'ship';
  process.env.RC_FAIL_MODEL = stepEnv.RC_FAIL_MODEL || '';
  const beforeReviews = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean).length;
  const beforeVerify = verifyRuns;
  fs.rmSync(diffDir, { recursive: true, force: true }); fs.mkdirSync(diffDir, { recursive: true });
  fs.rmSync(packetDir, { recursive: true, force: true });
  if (stepSpec.move === 'forward') {
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `external-${stepsOut.length + 2}\n`);
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-qm', 'author follow-up');
    currentHead = git(worktree, 'rev-parse', 'HEAD');
  } else if (stepSpec.move === 'sideways') {
    git(worktree, 'reset', '-q', '--hard', base);
    fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `sideways-${stepsOut.length}\n`);
    git(worktree, 'add', '-A');
    git(worktree, 'commit', '-qm', 'rewritten history');
    currentHead = git(worktree, 'rev-parse', 'HEAD');
  } else if (stepSpec.move === 'revert_one') {
    // BL-0154: a follow-up that fully reverts one file of the range (the cumulative base..head
    // changed-file count shrinks) while keeping the other.
    git(worktree, 'rm', '-q', 'src/b.txt');
    git(worktree, 'commit', '-qm', 'revert b');
    currentHead = git(worktree, 'rev-parse', 'HEAD');
  } else if (stepSpec.move === 'noop_commit') {
    // A descendant commit that leaves the tree identical.
    git(worktree, 'commit', '-q', '--allow-empty', '-m', 'empty follow-up');
    currentHead = git(worktree, 'rev-parse', 'HEAD');
  }
  // BL-0155: branches a previous repair of the same ticket left behind (created at the base commit).
  for (const name of (stepSpec.preBranches || [])) git(sbx, 'branch', name, base);
  // A tag spelled like a branch makes `%(refname:short)` print `heads/<name>`.
  for (const name of (stepSpec.preTags || [])) git(sbx, 'tag', name, base);
  intakeEstimateSeconds = Number.isFinite(stepSpec.mustFixAuthority) ? stepSpec.mustFixAuthority : 0;
  const stepEngine = new AutopilotEngine(options);
  installImplControl(stepEngine);
  const stepInput = {
    ...input,
    resume: stepSpec.resume !== false,
    ...(stepSpec.continuation ? { campaignContinuation: stepSpec.continuation } : {}),
    // P5: a caller that authorizes a repair round (must-fix-now) with a long round estimate; closing
    // (end/repair) must not be refused by the "not enough wall left for a repair round" budget check.
    ...(stepSpec.mustFixAuthority ? {
      campaignDispositionAuthority: { reviews: [{ decisions: [{ disposition: { disposition: 'must-fix-now' } }] }] },
    } : {}),
  };
  let stepResult;
  let stepThrown = null;
  try { stepResult = stepEngine.runImplementationReviewLoop(stepInput); } catch (error) {
    stepThrown = String(error && error.message || error); stepResult = {};
  }
  const logNow = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
  stepsOut.push({
    status: stepResult.status || null, phase: stepResult.phase || null, code: stepResult.code || null,
    reason: stepResult.reason ? String(stepResult.reason).slice(0, 300) : null,
    verdict: stepResult.verdict || null, thrown: stepThrown,
    durable_wait: stepResult.durable_wait === true, resumable: stepResult.resumable === true,
    campaign_phase: campaignPhaseNow(), head: currentHead,
    review_calls_delta: logNow.length - beforeReviews, review_models_delta: logNow.slice(beforeReviews),
    verify_runs_delta: verifyRuns - beforeVerify,
    model_calls: stepResult.model_calls == null ? null : stepResult.model_calls,
    seed_files: (() => {
      const dir = path.join(commonDir, 'autopilot', 'review-candidate-repair');
      try { return fs.readdirSync(dir).flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => `${d}/${f}`)); } catch (_e) { return []; }
    })(),
    // BL-0146 D4: what each seat was handed this step (diff bytes, the packet's tree listing, delta.diff)
    // and what the receipt disclosed.
    seat_inputs: (() => {
      const out = {};
      try {
        for (const f of fs.readdirSync(diffDir)) {
          const model = f.replace(/\.diff$/, '');
          const read = (ext) => { try { return fs.readFileSync(path.join(packetDir, `${model}.${ext}`), 'utf8'); } catch (_e) { return null; } };
          out[model] = {
            diff: fs.readFileSync(path.join(diffDir, f), 'utf8'),
            tree: read('tree'), delta: read('delta'), spec: read('spec'),
          };
        }
      } catch (_e) { /* no seat ran */ }
      return out;
    })(),
    disclosure: (() => {
      const hit = (o, depth) => {
        if (!o || typeof o !== 'object' || depth > 6) return null;
        if (typeof o.review_scope === 'string') return o;
        for (const v of Object.values(o)) { const r = hit(v, depth + 1); if (r) return r; }
        return null;
      };
      const d = hit(stepResult, 0);
      return d ? { review_scope: d.review_scope, incremental: d.incremental || null, incremental_fallback_reason: d.incremental_fallback_reason || null } : null;
    })(),
    result_keys: Object.keys(stepResult), impl_after: impl, handoff: handoffSummary(stepResult), findings_count: Array.isArray(stepResult.findings) ? stepResult.findings.length : null,
  });
}

// ---- observations ----------------------------------------------------------------------------------------
const reviewLog = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
let events = [];
let phase = null;
let campaignId = null;
try {
  const cli = require(path.join(root, 'src', 'campaign', 'cli'));
  const rows = cli.loadRows(ledgerPath);
  events = rows.filter((r) => r.op === 'campaign_event').map((r) => JSON.parse(r.payload).event.event_type);
  const intakeRow = rows.find((r) => r.op === 'campaign_intake');
  if (intakeRow) campaignId = intakeRow.run_id;
  if (intakeRow) phase = cli.projectCampaign(rows, intakeRow.run_id).state.phase;
} catch (_e) { /* no ledger */ }
const seatDiffs = fs.readdirSync(diffDir).map((f) => fs.readFileSync(path.join(diffDir, f)));
let independentDiff = null;
if (reviewBase) {
  independentDiff = execFileSync('git', ['-C', sbx, 'diff', '--no-ext-diff', '--no-textconv', `${base}..${reviewBase}`]);
}
let finalIndependentDiff = null;
if (reviewBase && currentHead) {
  finalIndependentDiff = execFileSync('git', ['-C', sbx, 'diff', '--no-ext-diff', '--no-textconv', `${base}..${currentHead}`]);
}
const mainStatus = git(sbx, 'status', '--porcelain');
emit({
  scenario, thrown, status: result.status, phase: result.phase || null, code: result.code || null,
  reason: result.reason ? String(result.reason).slice(0, 300) : null,
  verdict: result.verdict || null,
  strict_readiness_ready: Array.isArray(result.ledger) && result.ledger.some((e) => e.unit === 'strict_l5_provider_readiness' && e.status === 'ready'),
  probed_seats: probedSeatsRef.value,
  impl, review_calls: reviewLog.length, review_models: reviewLog,
  verify_runs: verifyRuns, verify_cwds: verifyCwds,
  events, campaign_phase: phase, campaign_id: campaignId, ledger_path: ledgerPath,
  main_branch: mainBranch,
  seat_diff_count: seatDiffs.length,
  seat_diff_parity: seatDiffs.length > 0 && independentDiff !== null
    && seatDiffs.every((d) => Buffer.compare(d, independentDiff) === 0),
  // P2: after a return the seats' last diff must be base..final head (the files are overwritten per model).
  seat_diff_final_parity: seatDiffs.length > 0 && finalIndependentDiff !== null
    && seatDiffs.every((d) => Buffer.compare(d, finalIndependentDiff) === 0),
  seat_diff_perturbed_parity: seatDiffs.length > 0 && independentDiff !== null
    && seatDiffs.every((d) => Buffer.compare(d, Buffer.concat([independentDiff, Buffer.from('x')])) === 0),
  forced_called: forced.called, forced_result: forced.result,
  admission_stub_calls: adopterAdmissionCalls,
  operator_status_clean: mainStatus === '' || /^\?\? /.test(mainStatus) === false,
  result_keys: Object.keys(result), handoff: handoffSummary(result), findings_count: Array.isArray(result.findings) ? result.findings.length : null,
  result_head: JSON.stringify(result).slice(0, 700),
  ledger_head: Array.isArray(result.ledger)
    ? result.ledger.map((e) => `${e.stage || e.name}:${e.status}`).join(',') : null,
  warnings_in_result: JSON.stringify(result).includes('review_candidate_churn_'),
  intake_exports: typeof intake.defaultAdoptionAdmission,
  steps: stepsOut,
  first_head: head, final_head: currentHead,
  durable_wait: result.durable_wait === true, resumable: result.resumable === true,
});
