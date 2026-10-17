'use strict';
// One cell of the BL-0146 D5 experiment, one process.
//   node run-cell.js <ctx.json>
// ctx: { root, out, tag, scenario: s1..s5, arm: 'inc'|'full', stub?: path (stub dispatch-review, no model
//        calls), seats?: [...], budgetFile?, budgetCapUsd?, pricesFile }
//   arm 'inc'  : sealed contract adoption.return_review = incremental. Round 1 reviews base..H0 (full), the
//                branch then advances to H1 and the run resumes with continuation `return`.
//   arm 'full' : the same H1 range seen as a first round, sealed at H1 (a return under return_review full is
//                that same blind full-range review: same diff bytes, same spec, no addendum).
// Writes <out>/<tag>.json (the record) and prints its path. Real seat calls happen unless ctx.stub is set.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ctx = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const root = ctx.root;
const here = __dirname;
const { SCENARIOS } = require(path.join(here, 'fixtures.js'));
const prices = ctx.pricesFile ? JSON.parse(fs.readFileSync(ctx.pricesFile, 'utf8')) : {};

const work = fs.mkdtempSync(path.join(ctx.workParent || os.tmpdir(), `d5-${ctx.tag}-`));
const sbx = path.join(work, 'repo');
const worktree = path.join(work, 'ext-wt');
fs.mkdirSync(sbx, { recursive: true });
fs.mkdirSync(ctx.out, { recursive: true });

// ---- instrumented batch dispatch ------------------------------------------------------------------------------
const reviewRunner = require(path.join(root, 'src', 'runners', 'review'));
const realBatch = reviewRunner.dispatchReviewJsonBatch;
const batches = [];
let roundLabel = 'r1';
const dirBytes = (dir) => {
  let total = 0; const files = {};
  const walk = (d, rel) => {
    let names = [];
    try { names = fs.readdirSync(d); } catch (_e) { return; }
    for (const n of names) {
      const full = path.join(d, n);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full, `${rel}${n}/`);
      else if (st.isFile()) { total += st.size; files[`${rel}${n}`] = st.size; }
    }
  };
  walk(dir, '');
  return { total, files };
};
const argv = (args, flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : null; };
const spendFile = ctx.budgetFile;
const readSpend = () => { try { return JSON.parse(fs.readFileSync(spendFile, 'utf8')); } catch (_e) { return { usd: 0, calls: 0 }; } };
const priceFor = (model) => prices[model] || prices._default || { in: 1, out: 4, cache_read: 0.1 };
const costOf = (model, usage, packetBytes) => {
  const p = priceFor(model);
  if (usage && usage.input_tokens != null && usage.output_tokens != null) {
    const cr = usage.cache_read_tokens || 0;
    return { usd: ((usage.input_tokens - cr) * p.in + cr * p.cache_read + usage.output_tokens * p.out) / 1e6, basis: 'reported_tokens' };
  }
  // no usage reported: bytes/4 for the packet plus a fixed protocol overhead and an assumed 3000 output tokens
  const inTok = Math.round((packetBytes + 9000) / 4);
  return { usd: (inTok * p.in + 3000 * p.out) / 1e6, basis: 'estimated_from_bytes' };
};
reviewRunner.dispatchReviewJsonBatch = (list, opts) => {
  if (spendFile) {
    const s = readSpend();
    if (s.usd >= (ctx.budgetCapUsd || 40) || fs.existsSync(`${spendFile}.STOP`)) {
      throw Object.assign(new Error('budget_stop: cumulative spend reached the cap'), { code: 'budget_stop' });
    }
  }
  const t0 = Date.now();
  const sharedBytes = opts && opts.sharedPacket && opts.sharedPacket.packet_dir ? dirBytes(opts.sharedPacket.packet_dir) : null;
  const items = ctx.stub ? list.map((item) => ({ ...item, scriptPath: ctx.stub })) : list;
  const rows = realBatch(items, opts);
  const rec = { round: roundLabel, wall_ms: Date.now() - t0, shared_packet: sharedBytes, seats: [] };
  rows.forEach((row, i) => {
    const args = (list[i] && (list[i].args || list[i].argv)) || [];
    const model = argv(args, '--model');
    const diffFile = argv(args, '--diff-file');
    const specFile = argv(args, '--spec-file');
    let argBytes = 0;
    for (const p of [diffFile, specFile]) { try { if (p && fs.existsSync(p)) argBytes += fs.statSync(p).size; } catch (_e) { /* gone */ } }
    let addendum = null;
    try {
      const text = specFile && fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8') : '';
      const a = text.indexOf('== Prior round');
      const z = text.indexOf('== end prior round ==');
      if (a >= 0 && z > a) {
        const block = text.slice(a, z);
        addendum = { bytes: Buffer.byteLength(block), rows: block.split('\n').filter((l) => /^- \[/.test(l)), spec_bytes: Buffer.byteLength(text) };
      }
    } catch (_e) { /* no addendum */ }
    const result = row && row.result ? row.result : null;
    const packetBytes = sharedBytes ? sharedBytes.total : argBytes;
    const cost = costOf(model, result ? result.usage : null, packetBytes);
    rec.seats.push({
      runner: argv(args, '--runner'), model, status: result ? result.status : null, verdict: result ? result.verdict : null,
      findings: result ? result.findings : null, no_finding_proof: result ? result.no_finding_proof : null,
      usage: result ? result.usage : null, raw_log: result ? result.raw_log : null, error: result ? result.error : (row && row.error ? String(row.error.message || row.error) : null),
      parse_error: row && row.parseError ? String(row.parseError.message || row.parseError) : null,
      exit_status: row ? row.status : null, addendum, packet_bytes: packetBytes, arg_bytes: argBytes, cost_usd: cost.usd, cost_basis: cost.basis,
    });
  });
  batches.push(rec);
  if (spendFile) {
    const s = readSpend();
    s.usd += rec.seats.reduce((a, x) => a + x.cost_usd, 0);
    s.calls += rec.seats.length;
    fs.writeFileSync(spendFile, JSON.stringify(s));
  }
  return rows;
};

const { AutopilotEngine, runCampaignIntake, compileCampaignDispositionPolicy } = require(path.join(root, 'src', 'engine'));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// ---- fixture repo --------------------------------------------------------------------------------------------
const sc = SCENARIOS[ctx.scenario]({ loc: ctx.specVariant === 'raw' ? false : (ctx.specVariant === 'locjson' ? 'json' : true) });
const writeMap = (dir, map) => {
  // remove tracked src files not in map, then write
  const srcDir = path.join(dir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  for (const n of fs.readdirSync(srcDir)) if (!map[`src/${n}`]) fs.rmSync(path.join(srcDir, n));
  for (const [p, text] of Object.entries(map)) fs.writeFileSync(path.join(dir, p), text);
};
spawnSync('git', ['-C', sbx, 'init', '-q']);
git(sbx, 'config', 'user.email', 'd5@example.invalid');
git(sbx, 'config', 'user.name', 'D5');
fs.mkdirSync(path.join(sbx, '.claude'), { recursive: true });
const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'));
gov.mission_convergence = {
  schema_version: 1, enforcement_mode: 'shadow', max_campaigns: 8, max_wall_seconds: 7200, max_tool_calls: 1000,
  max_engine_attempts: 100, max_external_wait_seconds: 600, max_canonical_changed_files: 100, max_output_bytes: 1000000,
  max_deliverables: 8, max_parallel: 3, max_batches: 4, max_graph_depth: 4, max_gate_attempts: 16, closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(path.join(sbx, '.claude', 'owner-kernel-governance.json'), `${JSON.stringify(gov, null, 2)}\n`);
writeMap(sbx, sc.base);
git(sbx, 'add', '-A');
git(sbx, 'commit', '-qm', 'base');
const base = git(sbx, 'rev-parse', 'HEAD');
const commonDir = fs.realpathSync(path.resolve(sbx, git(sbx, 'rev-parse', '--git-common-dir')));
const ledgerPath = path.join(commonDir, 'autopilot', 'implementation-campaign.jsonl');
const branch = `ext/${ctx.tag}`;
git(sbx, 'worktree', 'add', '-q', '-b', branch, worktree, base);
// H0 then H1 are both built on the branch now; the branch is parked at H0 (or H1 for arm full) until needed.
writeMap(worktree, sc.h0);
git(worktree, 'add', '-A');
git(worktree, 'commit', '-qm', 'external change');
const h0 = git(worktree, 'rev-parse', 'HEAD');
writeMap(worktree, sc.h1);
git(worktree, 'add', '-A');
git(worktree, 'commit', '-qm', 'follow-up');
const h1 = git(worktree, 'rev-parse', 'HEAD');
const sealed = ctx.arm === 'full' ? h1 : h0;
if (ctx.arm !== 'full') git(worktree, 'reset', '-q', '--hard', h0);
const deltaFiles = git(sbx, 'diff', '--name-only', h0, h1).split('\n').filter(Boolean);
const rangeFiles = git(sbx, 'diff', '--name-only', base, h1).split('\n').filter(Boolean);

const verifyCmd = 'node check.js';
const contractPath = path.join(work, 'campaign.json');
const sealPath = path.join(work, 'campaign.seal.json');
const promptFile = path.join(work, 'spec.md');
const contractBody = {
  schema_version: 1, ticket: ctx.tag, profile: 'poc', mission_grant_ref: null,
  repo_identity: `git-common-dir:${commonDir}`, base_sha: base, branch,
  vertical_acceptance: ['src/ pricing modules implement the contracts in the review specification'],
  allowed_path_prefixes: ['src/'], max_changed_files: 30, baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5,
  max_repair_generations: 0, max_wall_seconds: 3600, final_panel_reserve_seconds: 0, verify_cmd: verifyCmd, rubric_ids: ['ICC-RC1'],
  adoption: { head_sha: sealed, ...(ctx.arm === 'inc' ? { return_review: 'incremental' } : {}) },
};
fs.writeFileSync(promptFile, sc.spec);
fs.writeFileSync(contractPath, `${JSON.stringify(contractBody, null, 2)}\n`);
const seal = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'implementation-campaign-check.js'), 'seal', '--contract', contractPath, '--repo', sbx,
  '--mission-mode', 'shadow', '--out', sealPath,
], { cwd: sbx, encoding: 'utf8' });
const record = {
  tag: ctx.tag, scenario: ctx.scenario, arm: ctx.arm, spec_variant: ctx.specVariant || 'loc', base, h0, h1, sealed_head: sealed, delta_files: deltaFiles, range_files: rangeFiles,
  truth: sc.truth, started_at: new Date().toISOString(),
};
const finish = (extra) => {
  Object.assign(record, extra, { batches, finished_at: new Date().toISOString() });
  record.total_cost_usd = batches.reduce((a, b) => a + b.seats.reduce((x, s) => x + s.cost_usd, 0), 0);
  const file = path.join(ctx.out, `${ctx.tag}.json`);
  fs.writeFileSync(file, `${JSON.stringify(record, (k, v) => (v instanceof RegExp ? v.source : v), 2)}\n`);
  fs.writeSync(1, `${file}\n`);
  try { git(sbx, 'worktree', 'remove', '--force', worktree); } catch (_e) { /* ok */ }
  if (!ctx.keepWork) fs.rmSync(work, { recursive: true, force: true });
};
if (seal.status !== 0) { finish({ error: `seal failed: ${(seal.stderr || seal.stdout || '').slice(0, 600)}` }); process.exit(0); }

// ---- engine ---------------------------------------------------------------------------------------------------
const seats = ctx.seats;
const roster = {
  ...(ctx.rosterBase || {}),
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: seats[0].runner,
  reviewer_qualified: true, implementer_engine: 'fixture-implementer', implementer_effort: 'high', implementer_runner: 'fixture',
  loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS', min_panel_size: Math.min(3, seats.length),
  qc_panel_seats_complete: true, qc_panel_seats: seats, in_rail_review: 'panel',
  override_admitted_seats: seats.map((_s, i) => `qc_panel[${i}]`),
};
let verifyRuns = 0;
const gitWt = ({ commit } = {}) => {
  const useCommit = commit || sealed;
  const verifyWt = path.join(work, `verify-${String(useCommit).slice(0, 12)}-${verifyRuns}`);
  verifyRuns += 1;
  execFileSync('git', ['-C', sbx, 'worktree', 'add', '-q', '--detach', verifyWt, useCommit]);
  return {
    error: null, status: 0, signal: null, stdout: '', stderr: '', worktree: verifyWt, parent: null, commit: useCommit,
    observed_commit: useCommit, observed_tree_sha: git(verifyWt, 'rev-parse', 'HEAD^{tree}'), detached: true,
  };
};
const options = {
  cwd: sbx,
  clock: () => new Date().toISOString(),
  campaignDispositionProvider: compileCampaignDispositionPolicy('acceptance-bound'),
  campaignIntake(input, engineAdapters) {
    return runCampaignIntake(input, {
      readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
      contextGate: () => ({ owner: 'context_window', status: 'ready' }),
      occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      ...(engineAdapters || {}),
    });
  },
  campaignScopeChecker({ session, head } = {}) {
    if (!session || !session.contract || session.contract.implementation_sha !== head) {
      return { passed: false, reason: 'campaign scope seal drifted', changed_files: [] };
    }
    return { passed: true, changed_files: rangeFiles, total_churn: 1, receipt_digest: 'd'.repeat(64) };
  },
  implementationDispatcher() { throw new Error('review-only run: the implementation dispatcher must not be called'); },
  gitWorktreeAdd: gitWt,
  gitWorktreeRemove({ worktree: wt } = {}) {
    if (wt) { try { git(sbx, 'worktree', 'remove', '--force', wt); } catch (_e) { /* gone */ } }
    return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
  },
  repairLineageCleanupTransaction() { return { error: null, status: 0, signal: null, stdout: '', stderr: '' }; },
};
const engine = new AutopilotEngine(options);
const input = {
  promptFile, branch, base, roster, campaignContract: contractPath, campaignSeal: sealPath,
  campaignDispositionPolicy: 'acceptance-bound', verificationEnv: { PATH: process.env.PATH || '' },
  reviewCandidate: true, authorFamily: null,
};
const slim = (r) => JSON.parse(JSON.stringify(r, (k, v) => (typeof v === 'string' && v.length > 6000 ? `${v.slice(0, 6000)}...[cut]` : v)));
const brief = (r) => ({
  status: r.status || null, phase: r.phase || null, code: r.code || null, reason: r.reason ? String(r.reason).slice(0, 400) : null,
  verdict: r.verdict || null, findings: r.findings === undefined ? null : r.findings,
  model_calls: r.model_calls === undefined ? null : r.model_calls, keys: Object.keys(r),
});
const disclosureOf = (r) => {
  const hit = (o, depth) => {
    if (!o || typeof o !== 'object' || depth > 7) return null;
    if (typeof o.review_scope === 'string') return o;
    for (const v of Object.values(o)) { const x = hit(v, depth + 1); if (x) return x; }
    return null;
  };
  const d = hit(r, 0);
  return d ? { review_scope: d.review_scope, incremental: d.incremental || null, incremental_fallback_reason: d.incremental_fallback_reason || null } : null;
};
const killLease = () => {
  const cli = require(path.join(root, 'src', 'campaign', 'cli'));
  const rows = cli.loadRows(ledgerPath);
  const intakeRow = rows.find((r) => r.op === 'campaign_intake');
  if (!intakeRow) return;
  const lease = cli.projectCampaign(rows, intakeRow.run_id).latest_lease;
  if (!lease || lease.state !== 'leased') return;
  execFileSync('bash', [path.join(root, 'scripts', 'run-ledger.sh'), 'stage-transition', '--ledger', ledgerPath, '--run-id', intakeRow.run_id,
    '--stage', 'campaign', '--generation', String(lease.generation), '--nonce', lease.nonce, '--to-state', 'dead',
    '--idempotency-key', `d5-park:${lease.generation}:${lease.nonce}`], { cwd: sbx, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
};
const phaseNow = () => {
  try {
    const cli = require(path.join(root, 'src', 'campaign', 'cli'));
    const rows = cli.loadRows(ledgerPath);
    const intakeRow = rows.find((r) => r.op === 'campaign_intake');
    return intakeRow ? cli.projectCampaign(rows, intakeRow.run_id).state.phase : null;
  } catch (_e) { return null; }
};

let thrown = null;
let r1 = {};
try { r1 = engine.runImplementationReviewLoop(input); } catch (error) { thrown = String(error && error.message || error); }
record.round1 = { ...brief(r1), thrown, phase_after: phaseNow(), batches_so_far: batches.length, full: slim(r1) };
let ret = null;
if (ctx.arm === 'inc' && !thrown && !fs.existsSync(`${spendFile}.STOP`)) {
  const parked = r1.status === 'awaiting_disposition';
  record.round1.parked = parked;
  if (parked) {
    roundLabel = 'return';
    try { killLease(); } catch (_e) { /* surfaced by the step */ }
    git(worktree, 'reset', '-q', '--hard', h1);
    const stepEngine = new AutopilotEngine(options);
    let stepThrown = null; let stepResult = {};
    try {
      stepResult = stepEngine.runImplementationReviewLoop({ ...input, resume: true, campaignContinuation: 'return' });
    } catch (error) { stepThrown = String(error && error.message || error); }
    ret = { ...brief(stepResult), thrown: stepThrown, phase_after: phaseNow(), disclosure: disclosureOf(stepResult), full: slim(stepResult) };
  }
}
finish({ return: ret, round1_disclosure: disclosureOf(r1), thrown });
