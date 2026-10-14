#!/usr/bin/env bash
# KR3 (docs/plans/_archive/2026/10/2026-10-12-tmp-residue-containment.md): the engine's DEFAULT diffProvider and
# repairPromptWriter dirs are deleted by their owner. Every other engine suite injects its own
# diffProvider and would pass with the delete code removed, so this one uses the defaults.
#
# Scenarios (legacy loop: L-*, managed campaign + real final panel: C-*):
#   L-success, L-gitfail, L-reviewer-throws, C-success, C-reviewer-throws, C-prepare-throws.
# Per scenario it asserts (1) dir existed while the reviewer ran (diff bytes recorded), (2) 0 owned
# autopilot-review-loop-* / autopilot-repair-prompt-* dirs remain, (3) the repair-prompt scenario
# created one (non-vacuous), (4) an injected diffProvider's file survives finish(), (5) the diff
# digest equals the value pinned from the pre-change code (82488bc8) on the same fixture.
. "$(dirname "$0")/lib.sh"
unset AUTOPILOT_LEVEL AUTOPILOT_ROOT_RUN_ID AUTOPILOT_MISSION_ROOT_RUN_ID \
  AUTOPILOT_PARENT_RUN_ID AUTOPILOT_RECONCILE_RECEIPT AUTOPILOT_WORKTREE_ROOT_RUN_ID \
  AUTOPILOT_DISPATCH_DEPTH 2>/dev/null || true

STUB="$TEST_TMP/panel-stub"
cat > "$STUB" <<'STUBEOF'
#!/usr/bin/env bash
prompt="$(cat)"
begin="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-REVIEW-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
end="$(printf '%s\n' "$prompt" | sed -n 's/^\(<<<AUTOPILOT-END-[0-9a-f]\{32\}>>>\)$/\1/p' | sed -n '1p')"
echo "$begin"
echo "VERDICT: SHIP-AS-IS"
echo "FINDINGS: none"
echo "NO-FINDING-PROOF: checked=dist/out.txt one-line hunk against the panel spec; evidence=the hunk adds a single fixture line and touches no code path; conclusion=nothing to fix in a one-line fixture change"
echo "$end"
STUBEOF
chmod +x "$STUB"

GOV="$TEST_TMP/governance.json"
write_mission_governance "$GOV" shadow
SUITE="$TEST_TMP/diff-lifetime-suite.js"
cat > "$SUITE" <<'NODE'
'use strict';
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const [root, tmp, stub, gov] = process.argv.slice(2);
const { AutopilotEngine, runCampaignIntake } = require(path.join(root, 'src', 'engine'));
const rp = require(path.join(root, 'src', 'runners', 'review-packet'));
const PRINT = process.env.KR3_PRINT_DIGESTS === '1';

// ---- deterministic fixture repo (fixed identity + dates => stable SHAs and diff bytes) ----
const FIXED = {
  GIT_AUTHOR_NAME: 'kr3', GIT_AUTHOR_EMAIL: 'kr3@example.invalid',
  GIT_COMMITTER_NAME: 'kr3', GIT_COMMITTER_EMAIL: 'kr3@example.invalid',
  GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
};
const genv = { ...process.env, ...FIXED };
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: genv }).trim();
const repo = path.join(tmp, 'repo');
fs.mkdirSync(path.join(repo, 'dist'), { recursive: true });
sh(repo, 'init', '-q', '-b', 'develop');
fs.writeFileSync(path.join(repo, 'dist', 'source.txt'), 'base\n');
fs.writeFileSync(path.join(repo, 'prompt.txt'), 'implement the fixture\n');
fs.mkdirSync(path.join(repo, '.claude'));
fs.copyFileSync(gov, path.join(repo, '.claude', 'owner-kernel-governance.json'));
sh(repo, 'add', '.');
sh(repo, 'commit', '-qm', 'base');
const base = sh(repo, 'rev-parse', 'HEAD');
fs.writeFileSync(path.join(repo, 'dist', 'out.txt'), 'candidate\n');
sh(repo, 'add', '.');
sh(repo, 'commit', '-qm', 'candidate');
const candidate = sh(repo, 'rev-parse', 'HEAD');
const tree = sh(repo, 'rev-parse', 'HEAD^{tree}');
const promptFile = path.join(repo, 'prompt.txt');
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const rangeDiffBytes = execFileSync('git', ['diff', '--no-ext-diff', '--no-textconv', `${base}..${candidate}`], { cwd: repo });
const observedDigest = sha256(rangeDiffBytes);

// Values computed on 82488bc8 (the commit before this change) with this same fixture:
//   KR3_PRINT_DIGESTS=1 bash hooks/tests/engine-diff-lifetime.test.sh
const PINNED = {
  base, candidate, tree,
  diff_digest: process.env.KR3_PIN_DIFF_DIGEST || 'a77196e186961decd36afe143dea2afe8ecffc114ff92cf1c1e933eb98ac9f56',
};

// ---- per-scenario private TMPDIR so the count is exact ----
function scenarioTmp(name) {
  const dir = path.join(tmp, `scn-${name}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.TMPDIR = dir;
  return dir;
}
const OWNED = /^autopilot-(review-loop|repair-prompt)-/;
const ownedDirs = (dir) => fs.readdirSync(dir).filter((n) => OWNED.test(n));

// Spy on engine.reviewDiff: record whether the diff existed and its bytes at review time.
function spyReviewer(engine, { throwOn = 0 } = {}) {
  const seen = [];
  const original = engine.reviewDiff.bind(engine);
  engine.reviewDiff = (input) => {
    const exists = fs.existsSync(input.diffFile);
    const bytes = exists ? fs.readFileSync(input.diffFile) : null;
    const live = fs.readdirSync(process.env.TMPDIR).filter((n) => /^autopilot-review-loop-/.test(n)).length;
    seen.push({ exists, digest: bytes ? sha256(bytes) : null, file: input.diffFile, live });
    if (throwOn && seen.length === throwOn) throw new Error('reviewer exploded (fixture)');
    return original(input);
  };
  return seen;
}

const resolverResult = {
  reviewer_engine: 'test-review-model', reviewer_effort: 'xhigh', reviewer_runner: 'test-review-runner',
  reviewer_qualified: true, implementer_engine: 'test-impl-model', implementer_effort: 'high',
  implementer_runner: 'test-impl-runner', loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS',
  spec_review: 'off', independent_harness: 'off', qc_panel: ['test-review-model'],
  qc_panel_aggregation: 'majority', review_risk: 'low', required_review_families: 1, l1_required: false,
  cross_family_required: false, cross_family_satisfied: true, review_diff_scope: 'full', source: 'test',
  work_domain: 'mixed', domain_source: 'none',
};
const okEnvelope = (result) => ({
  error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null, result,
});

function legacyEngine({ commits, verdicts, diffProvider }) {
  let impl = 0;
  let rev = 0;
  return new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-07-01T00:00:00.000Z',
    reviewLoopResolver: () => okEnvelope(resolverResult),
    implementationDispatcher(args) {
      impl += 1;
      return okEnvelope({
        status: 'committed', runner: 'test-impl-runner', model: 'test-impl-model',
        branch: args[args.indexOf('--branch') + 1], base: args[args.indexOf('--base') + 1],
        commit: commits[Math.min(impl, commits.length) - 1],
        files_changed: 1, insertions: 1, deletions: 0, worktree: repo, agent_log: '/dev/null', error: null,
      });
    },
    reviewDispatcher() {
      rev += 1;
      return okEnvelope({
        runner: 'test-review-runner', model: 'test-review-model', status: 'reviewed',
        verdict: verdicts[Math.min(rev, verdicts.length) - 1], findings: 'stub finding',
        raw_log: '/dev/null', error: null,
      });
    },
    ...(diffProvider ? { diffProvider } : {}),
  });
}
const legacyInput = { promptFile, branch: 'impl-loop', base, maxRounds: 3 };

// ---- L-success: default providers; repair prompt created (non-vacuous); everything removed ----
if (!PRINT) {
  const t = scenarioTmp('l-success');
  const engine = legacyEngine({
    commits: [candidate, candidate], verdicts: ['FIX-THEN-SHIP', 'SHIP-AS-IS'],
  });
  const seen = spyReviewer(engine);
  let repairDirsMid = 0;
  const origWriter = engine.repairPromptWriter;
  engine.repairPromptWriter = (args) => {
    const file = origWriter(args);
    repairDirsMid = fs.readdirSync(t).filter((n) => /^autopilot-repair-prompt-/.test(n)).length;
    assert.ok(fs.existsSync(path.join(path.dirname(file), '.autopilot-owner')), 'owner file written');
    return file;
  };
  const result = engine.runLegacyImplementationReviewLoop(legacyInput);
  assert.strictEqual(result.status, 'converged', JSON.stringify(result).slice(0, 600));
  assert.strictEqual(seen.length, 2);
  assert.ok(seen.every((s) => s.exists), '(1) diff existed while the reviewer ran');
  assert.ok(seen.every((s) => s.digest === observedDigest), '(1) reviewer saw the real diff bytes');
  assert.ok(seen.every((s) => s.live === 1),
    `(2) a reviewed diff is disposed before the next prepare, not only at finish(): live=${seen.map((s) => s.live)}`);
  assert.strictEqual(repairDirsMid, 1, '(3) the repair-prompt scenario really created a dir');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) 0 owned dirs remain after success');
  assert.ok(seen.every((s) => !fs.existsSync(s.file)), '(2) each diff file is gone');
  console.log('ok L-success');
}

// ---- L-success with an INJECTED provider: its file survives finish() (4) ----
if (!PRINT) {
  const t = scenarioTmp('l-injected');
  const injDir = fs.mkdtempSync(path.join(t, 'injected-'));
  const injFile = path.join(injDir, 'mine.diff');
  fs.writeFileSync(injFile, rangeDiffBytes);
  const engine = legacyEngine({
    commits: [candidate], verdicts: ['SHIP-AS-IS'], diffProvider: () => injFile,
  });
  const result = engine.runLegacyImplementationReviewLoop(legacyInput);
  assert.strictEqual(result.status, 'converged');
  assert.ok(fs.existsSync(injFile), '(4) injected diffProvider file still exists after finish()');
  assert.deepStrictEqual(ownedDirs(t), [], 'no owned dirs for an injected provider');
  console.log('ok L-injected');
}

// ---- L-gitfail: git diff fails => no leftover dir, blocked prepare_review ----
if (!PRINT) {
  const t = scenarioTmp('l-gitfail');
  const missing = 'f'.repeat(40);
  const engine = legacyEngine({ commits: [missing], verdicts: ['SHIP-AS-IS'] });
  const seen = spyReviewer(engine);
  const result = engine.runLegacyImplementationReviewLoop(legacyInput);
  assert.strictEqual(result.status, 'blocked');
  assert.strictEqual(result.phase, 'prepare_review');
  assert.strictEqual(seen.length, 0, 'reviewer never ran');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) git diff failure leaves 0 owned dirs');
  console.log('ok L-gitfail');
}

// ---- L-reviewer-throws on round 2 (a repair prompt is still owned) ----
if (!PRINT) {
  const t = scenarioTmp('l-throws');
  const engine = legacyEngine({
    commits: [candidate, candidate], verdicts: ['FIX-THEN-SHIP', 'SHIP-AS-IS'],
  });
  const seen = spyReviewer(engine, { throwOn: 2 });
  let repairSeen = false;
  const origWriter = engine.repairPromptWriter;
  engine.repairPromptWriter = (args) => {
    const file = origWriter(args);
    repairSeen = fs.existsSync(file);
    return file;
  };
  assert.throws(() => engine.runLegacyImplementationReviewLoop(legacyInput), /reviewer exploded/);
  assert.strictEqual(seen.length, 2);
  assert.ok(seen[1].exists, '(1) diff existed when the throwing reviewer ran');
  assert.ok(repairSeen, '(3) a repair prompt was created before the throw');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) reviewer throw leaves 0 owned dirs (diff + repair prompt)');
  console.log('ok L-reviewer-throws');
}

// ---- Managed campaign with the REAL final panel (default dispatcher + default providers) ----
const common = fs.realpathSync(path.resolve(repo, sh(repo, 'rev-parse', '--git-common-dir')));
const seats = [
  { role: 'qc', runner: 'qoderclicn', model: 'seat-a', effort: 'high', endpoint: null, family: 'fa' },
  { role: 'qc', runner: 'qoderclicn', model: 'seat-b', effort: 'high', endpoint: null, family: 'fb' },
  { role: 'qc', runner: 'qoderclicn', model: 'seat-c', effort: 'high', endpoint: null, family: 'fc' },
];
const roster = {
  reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'qoderclicn',
  reviewer_qualified: true, implementer_engine: 'fixture-implementer', implementer_effort: 'high',
  implementer_runner: 'fixture', loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS',
  min_panel_size: 3, in_rail_review: 'single', qc_panel_seats_complete: true, qc_panel_seats: seats,
  override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
};
let campaignSeq = 0;
function runCampaign({ scenario, mutateEngine, mutateRp }) {
  const t = scenarioTmp(scenario);
  campaignSeq += 1;
  const ticket = `kr3-${campaignSeq}`;
  const branch = `feat/${ticket}`;
  const worktree = path.join(tmp, `${ticket}-wt`);
  sh(repo, 'worktree', 'add', '-q', '-b', branch, worktree, candidate);
  const dir = path.join(tmp, `${ticket}-campaign`);
  fs.mkdirSync(dir, { recursive: true });
  const contractPath = path.join(dir, 'campaign.json');
  const sealPath = path.join(dir, 'campaign.seal.json');
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1, ticket, profile: 'poc', mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`, base_sha: base, branch,
    vertical_acceptance: ['diff lifetime'], allowed_path_prefixes: ['dist/'], max_changed_files: 5,
    baseline_churn: 10, max_growth_ratio: 1.5, max_extra_churn: 5, max_repair_generations: 2,
    max_wall_seconds: 120, verify_cmd: 'true', rubric_ids: ['ICC-KILL-057'],
    final_panel_reserve_seconds: 0,
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', repo, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: repo, encoding: 'utf8' });
  const engine = new AutopilotEngine({
    cwd: repo,
    clock: () => '2026-09-18T00:00:05.000Z',
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
      return okEnvelope({
        status: 'committed', runner: 'fixture', model: 'fixture-implementer', branch, base,
        commit: candidate, files_changed: 1, insertions: 1, deletions: 0, worktree,
        agent_log: '/dev/null', error: null,
      });
    },
    gitWorktreeAdd() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', worktree, parent: null,
        commit: candidate, observed_commit: candidate, observed_tree_sha: tree, detached: true,
      };
    },
    gitWorktreeRemove: () => ({ error: null, status: 0, signal: null, stdout: '', stderr: '' }),
    repairLineageCleanupTransaction: () => ({ error: null, status: 0, signal: null, stdout: '', stderr: '' }),
    verifyCommandRunner: () => ({
      error: null, status: 0, signal: null, stdout: '', stderr: '', executed_argv: ['/bin/sh', '-c', 'true'],
    }),
  });
  engine.implementTask = () => ({
    status: 'committed', dispatcher_called: true,
    implementation: {
      commit: candidate, worktree, run_id: `run-${ticket}`, dispatch_id: `d-${ticket}`, provider: 'fixture',
      runner: 'fixture', model: 'fixture-implementer', provider_session_id: null,
      provider_session_reused: false, worktree_reused: false, insertions: 1, deletions: 0,
    },
    implementationResult: { error: null, signal: null, status: 0 },
    ledger: [],
  });
  const seen = spyReviewer(engine, mutateEngine ? mutateEngine(engine) : {});
  const restore = mutateRp ? mutateRp() : () => {};
  let result;
  let thrown = null;
  try {
    result = engine.runImplementationReviewLoop({
      promptFile, branch, base, roster, campaignContract: contractPath, campaignSeal: sealPath,
      campaignDispositionPolicy: 'acceptance-bound',
      verificationEnv: { PATH: process.env.PATH || '', CI: ticket },
      verificationEnvAllowlist: ['CI'],
      extraReviewArgs: ['--bin', stub],
    });
  } catch (error) {
    thrown = error;
  } finally {
    restore();
  }
  return { t, seen, result, thrown };
}
const findKey = (value, key) => {
  if (!value || typeof value !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

// ---- C-success ----
{
  const { t, seen, result, thrown } = runCampaign({ scenario: 'c-success' });
  assert.strictEqual(thrown, null, thrown && thrown.stack);
  const dd = findKey(result, 'diff_digest');
  const rid = findKey(result, 'review_input_digest');
  if (PRINT) {
    console.log(`PIN diff_digest=${observedDigest} result.diff_digest=${dd} review_input_digest=${rid}`);
    console.log(`PIN base=${base} candidate=${candidate} tree=${tree}`);
    console.log(`PIN keys=${JSON.stringify(Object.keys(result))}`);
    console.log('engine_diff_lifetime=true');
    process.exit(0);
  }
  const receipts = findKey(result, 'final_panel_seat_receipts');
  assert.ok(Array.isArray(receipts) && receipts.length === 3
    && receipts.every((r) => r.status === 'reviewed'),
  `three panel seats reviewed: ${JSON.stringify(result).slice(0, 700)}`);
  assert.ok(seen.length >= 1 && seen.every((s) => s.exists), '(1) diff existed while every reviewDiff ran');
  assert.strictEqual(seen[0].live, 1, '(2) the in-rail review runs with exactly its own diff dir live');
  assert.ok(seen.every((s) => s.digest === observedDigest), '(1) reviewer saw the real diff bytes');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) campaign success leaves 0 owned dirs');
  // (5) digests: the authority the controller bound at prepare time.
  assert.strictEqual(observedDigest, PINNED.diff_digest, '(5) diff digest equals the pre-change value');
  if (dd !== undefined) assert.strictEqual(dd, PINNED.diff_digest);
  // review_input_digest embeds the verification receipt (worktree path, run id), which differs per
  // run even on the pre-change code (observed three distinct values), so it cannot be pinned to a
  // constant; assert it is bound and well-formed, and that the pinned diff digest above did not move.
  assert.ok(/^[0-9a-f]{64}$/.test(String(rid)), '(5) review_input_digest is a bound sha256');
  console.log('ok C-success');
}

// ---- C-reviewer-throws: the in-rail reviewer throws after the diff was prepared ----
{
  const { t, seen, result, thrown } = runCampaign({
    scenario: 'c-throws', mutateEngine: () => ({ throwOn: 1 }),
  });
  // The campaign layer may surface the throw or convert it to a blocked outcome; either way the
  // reviewer ran once and the run did not converge.
  assert.ok(thrown ? /reviewer exploded/.test(thrown.message)
    : (result && result.status !== 'converged'), `reviewer throw not swallowed into success: ${thrown}`);
  assert.strictEqual(seen.length, 1);
  assert.ok(seen[0].exists, '(1) diff existed when the throwing reviewer ran');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) reviewer throw leaves 0 owned dirs');
  console.log('ok C-reviewer-throws');
}

// ---- C-prepare-throws: the panel's identity prepare (buildPacketOnce -> buildReviewPacket) throws.
// Call #1 is the in-rail review; call #2 is the panel's shared build, inside the identity try.
{
  let injected = false;
  const { t, result, thrown } = runCampaign({
    scenario: 'c-prepare-throws',
    mutateRp: () => {
      const original = rp.buildReviewPacket;
      let calls = 0;
      rp.buildReviewPacket = function throwOnSecond(...args) {
        calls += 1;
        if (calls === 2) { injected = true; throw new Error('injected shared-build failure (fixture)'); }
        return original.apply(this, args);
      };
      return () => { rp.buildReviewPacket = original; };
    },
  });
  assert.strictEqual(thrown, null, thrown && thrown.stack);
  assert.ok(injected, 'the identity prepare really threw (non-vacuous)');
  assert.ok(result, 'campaign returned a result');
  assert.deepStrictEqual(ownedDirs(t), [], '(2) identity/binding prepare failure leaves 0 owned dirs');
  console.log('ok C-prepare-throws');
}
console.log('engine_diff_lifetime=true');
NODE
OUT="$(node "$SUITE" "$REPO_ROOT" "$TEST_TMP" "$STUB" "$GOV" 2>&1 < /dev/null)"
EXIT=$?
echo "$OUT"
assert_exit_code "$EXIT" "0" "engine diff-lifetime suite exits 0"
assert_contains "$OUT" "engine_diff_lifetime=true" "engine diff-lifetime suite completed"
for s in L-success L-injected L-gitfail L-reviewer-throws C-success C-reviewer-throws C-prepare-throws; do
  assert_contains "$OUT" "ok $s" "scenario $s passed"
done
finalize_test
