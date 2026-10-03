#!/usr/bin/env bash
# Final-panel panel re-run (the resume path) re-dispatches only failed seats: verdicts are re-derived
# from per-seat artifacts bound to the same packet; negative controls and the attempt budget.
# RED at f197fc09: AssertionError: only the failed seat is re-dispatched:
#   ["claude-opus-4-6","gpt-5.4","glm-4.7"]   (actual: all three seats; expected: ["gpt-5.4"])
#   -> FAIL final-panel seat resume: expected exit 0, got 1
. "$(dirname "$0")/lib.sh"

OUT="$(node - "$REPO_ROOT" "$TEST_TMP" <<'NODE'
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const [root, tmp] = process.argv.slice(2);
const { AutopilotEngine, runCampaignIntake, compileCampaignDispositionPolicy } = require(path.join(root, 'src', 'engine'));
const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const sbx = path.join(tmp, 'station-repo');
fs.mkdirSync(path.join(sbx, '.claude'), { recursive: true });
fs.mkdirSync(path.join(sbx, 'src'), { recursive: true });
spawnSync('git', ['-C', sbx, 'init', '-q']);
spawnSync('git', ['-C', sbx, 'config', 'user.email', 'station@example.invalid']);
spawnSync('git', ['-C', sbx, 'config', 'user.name', 'Station']);
const gov = JSON.parse(fs.readFileSync(path.join(root, '.claude', 'owner-kernel-governance.json'), 'utf8'));
gov.mission_convergence = {
  schema_version: 1,
  enforcement_mode: 'shadow',
  max_campaigns: 8,
  max_wall_seconds: 7200,
  max_tool_calls: 1000,
  max_engine_attempts: 100,
  max_external_wait_seconds: 600,
  max_canonical_changed_files: 100,
  max_output_bytes: 1000000,
  max_deliverables: 8,
  max_parallel: 3,
  max_batches: 4,
  max_graph_depth: 4,
  max_gate_attempts: 16,
  closure_ratio: 1,
  max_stagnant_campaigns: 2,
};
fs.writeFileSync(
  path.join(sbx, '.claude', 'owner-kernel-governance.json'),
  `${JSON.stringify(gov, null, 2)}\n`,
);
fs.writeFileSync(path.join(sbx, 'src', 'value.txt'), 'base\n');
execFileSync('git', ['-C', sbx, 'add', '.']);
execFileSync('git', ['-C', sbx, 'commit', '-qm', 'base']);
const base = git(sbx, 'rev-parse', 'HEAD');
const common = fs.realpathSync(path.resolve(sbx, git(sbx, 'rev-parse', '--git-common-dir')));
const seats = [
  { role: 'qc', runner: 'cc-shim', model: 'claude-opus-4-6', effort: 'high', endpoint: null, family: 'anthropic' },
  { role: 'qc', runner: 'cc-shim', model: 'gpt-5.4', effort: 'high', endpoint: null, family: 'openai' },
  { role: 'qc', runner: 'cc-shim', model: 'glm-4.7', effort: 'high', endpoint: null, family: 'zai' },
];
const storeRoot = path.join(common, 'autopilot', 'final-panel-seats');
function allSeatFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.json')) out.push(p);
    }
  };
  walk(storeRoot);
  return out.sort();
}
const seatN = (written, n) => written.find((p) => p.endsWith(`seat-${n}.json`));
const editJson = (file, fn) => {
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, `${JSON.stringify(fn(body) || body)}\n`);
};
function runStation(tag, opts) {
  const branch = `feat/${tag}`;
  const worktree = path.join(tmp, `${tag}-wt`);
  try { execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' }); } catch (_e) {}
  git(sbx, 'worktree', 'add', '-q', '-b', branch, worktree, base);
  fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `${tag}\n`);
  execFileSync('git', ['-C', worktree, 'add', 'src/value.txt']);
  execFileSync('git', ['-C', worktree, 'commit', '-qm', tag]);
  const candidate = git(worktree, 'rev-parse', 'HEAD');
  const tree = git(worktree, 'rev-parse', 'HEAD^{tree}');
  const dir = path.join(tmp, `${tag}-campaign`);
  fs.mkdirSync(dir, { recursive: true });
  const contractPath = path.join(dir, 'campaign.json');
  const sealPath = path.join(dir, 'campaign.seal.json');
  const promptFile = path.join(tmp, `${tag}.prompt`);
  fs.writeFileSync(promptFile, `station\n${opts.promptSalt || ''}`);
  fs.writeFileSync(contractPath, `${JSON.stringify({
    schema_version: 1, ticket: tag, profile: 'poc', mission_grant_ref: null,
    repo_identity: `git-common-dir:${common}`, base_sha: base, branch,
    vertical_acceptance: opts.acceptance || ['src/value.txt must change'],
    allowed_path_prefixes: ['src/'], max_changed_files: 5, baseline_churn: 10,
    max_growth_ratio: 1.5, max_extra_churn: 5, max_repair_generations: 2,
    max_wall_seconds: opts.wall === undefined ? 600 : opts.wall,
    final_panel_reserve_seconds: opts.reserve === undefined ? 0 : opts.reserve,
    verify_cmd: 'true', rubric_ids: ['ICC-STATION1'],
  }, null, 2)}\n`);
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'implementation-campaign-check.js'),
    'seal', '--contract', contractPath, '--repo', sbx, '--mission-mode', 'shadow', '--out', sealPath,
  ], { cwd: sbx, encoding: 'utf8' });
  let impl = 0;
  let repaired = null;
  const reviewModels = [];
  let panelCalls = 0;
  let finalPanelCalls = 0;
  let replay = null;
  let reviewCalls = 0;
  let nowMs = Date.parse('2026-09-18T00:00:05.000Z');
  const engine = new AutopilotEngine({
    cwd: sbx,
    clock: opts.clock || (() => new Date(nowMs).toISOString()),
    ...(opts.policy === null ? {} : {
      campaignDispositionProvider: compileCampaignDispositionPolicy(opts.policy || 'acceptance-bound'),
    }),
    campaignIntake(input) {
      return runCampaignIntake(input, {
        readiness: () => ({ owner: 'provider_readiness', status: 'ready' }),
        contextGate: () => ({ owner: 'context_window', status: 'ready' }),
        occupancy: () => ({ owner: 'worktree_lifecycle', status: 'ready' }),
      });
    },
    campaignScopeChecker() {
      return { passed: true, changed_files: ['src/value.txt'], total_churn: 1, receipt_digest: 'd'.repeat(64) };
    },
    campaignComposer(input, adapters) {
      const innerPanel = adapters.reviewPanel;
      const innerReview = adapters.review;
      const innerFinalPanel = adapters.finalPanel;
      adapters.reviewPanel = (reviewInput) => {
        if (Number.isSafeInteger(opts.advanceMs)) nowMs += opts.advanceMs;
        panelCalls += 1;
        const filesBefore = new Set(allSeatFiles());
        const firstReceipt = innerPanel(reviewInput);
        if (!opts.replay) return firstReceipt;
        // The resume path re-runs the same panel for the same candidate/packet: replay it
        // in-process (admission of a REVIEWING campaign is the campaign CLI's concern).
        const written = allSeatFiles().filter((p) => !filesBefore.has(p));
        opts.afterFirst({ firstReceipt, written, modelsBefore: reviewModels.slice() });
        const mark = reviewModels.length;
        opts.failSeat = null;
        const secondReceipt = innerPanel(reviewInput);
        replay = { firstReceipt, secondReceipt, written, replayModels: reviewModels.slice(mark) };
        return secondReceipt;
      };
      adapters.finalPanel = (reviewInput) => {
        finalPanelCalls += 1;
        return innerFinalPanel(reviewInput);
      };
      adapters.review = (reviewInput) => {
        reviewCalls += 1;
        return innerReview(reviewInput);
      };
      return require(path.join(root, 'src', 'engine', 'campaign-composition')).runCampaignComposition(input, adapters);
    },
    implementationDispatcher() {
      impl += 1;
      if (impl > 1) {
        fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `${tag}-fixed\n`);
        execFileSync('git', ['-C', worktree, 'add', 'src/value.txt']);
        execFileSync('git', ['-C', worktree, 'commit', '-qm', `${tag}-fix`]);
        repaired = {
          commit: git(worktree, 'rev-parse', 'HEAD'),
          tree: git(worktree, 'rev-parse', 'HEAD^{tree}'),
        };
      }
      const commit = impl > 1 ? repaired.commit : candidate;
      const treeSha = impl > 1 ? repaired.tree : tree;
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          status: 'committed', runner: 'fixture', model: 'fixture-implementer',
          branch, base, commit, files_changed: 1, insertions: 1, deletions: 0, worktree,
        },
      };
    },
    reviewDispatcher(args) {
      const modelIdx = args.indexOf('--model');
      reviewModels.push(modelIdx >= 0 ? args[modelIdx + 1] : null);
      const isFirstCandidate = !repaired;
      const collide = opts.collide === true;
      const findings = collide
        ? JSON.stringify([{
          finding_id: 'dup-1',
          claim: opts.acceptance[0],
          severity: '🟠',
          source: `seat-${reviewModels.length}`,
        }])
        : (isFirstCandidate && opts.fixFirst
          ? JSON.stringify([{
            finding_id: 'src-value',
            claim: opts.acceptance[0],
            severity: '🟠',
            source: 'product-review',
          }])
          : '[]');
      const verdict = (isFirstCandidate && (opts.fixFirst || collide)) ? 'FIX-THEN-SHIP' : 'SHIP-AS-IS';
      if (opts.failSeat && reviewModels[reviewModels.length - 1] === opts.failSeat) {
        return {
          error: null, status: 124, signal: 'SIGTERM', stdout: '', stderr: 'timeout',
          parseError: null, result: { status: 'no_verdict', error: 'timeout' },
        };
      }
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '', parseError: null,
        result: {
          runner: 'cc-shim', model: reviewModels[reviewModels.length - 1],
          status: 'reviewed', verdict, findings, raw_log: null, error: null,
        },
        // packetHashOf (autopilot-engine.js) reads a sibling `packet: {packet_hash}`
        // object on the dispatcher result, not a field inside `result` (item D).
        ...(opts.withPacketHash ? { packet: { packet_hash: 'b'.repeat(64) } } : {}),
      };
    },
    diffProvider() { return promptFile; },
    gitWorktreeAdd({ commit } = {}) {
      const useCommit = commit || candidate;
      const verifyWt = path.join(tmp, `${tag}-verify-${String(useCommit).slice(0, 12)}`);
      try { execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', verifyWt], { stdio: 'ignore' }); } catch (_e) {}
      execFileSync('git', ['-C', sbx, 'worktree', 'add', '-q', '--detach', verifyWt, useCommit]);
      const useTree = git(verifyWt, 'rev-parse', 'HEAD^{tree}');
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        worktree: verifyWt, parent: null, commit: useCommit, observed_commit: useCommit,
        observed_tree_sha: useTree, detached: true,
      };
    },
    gitWorktreeRemove({ worktree: wt } = {}) {
      if (wt) {
        try { execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', wt], { stdio: 'ignore' }); } catch (_e) {}
      }
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    repairLineageCleanupTransaction({ record }) {
      if (record && record.worktree) {
        execFileSync('git', ['-C', sbx, 'worktree', 'remove', '--force', record.worktree], {
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyCommandRunner() {
      return {
        error: null, status: 0, signal: null, stdout: '', stderr: '',
        executed_argv: ['/bin/sh', '-c', 'true'],
      };
    },
  });
  engine.implementTask = () => {
    impl += 1;
    if (impl > 1) {
      fs.writeFileSync(path.join(worktree, 'src', 'value.txt'), `${tag}-fixed\n`);
      execFileSync('git', ['-C', worktree, 'add', 'src/value.txt']);
      execFileSync('git', ['-C', worktree, 'commit', '-qm', `${tag}-fix`]);
      repaired = {
        commit: git(worktree, 'rev-parse', 'HEAD'),
        tree: git(worktree, 'rev-parse', 'HEAD^{tree}'),
      };
    }
    return {
      status: 'committed', dispatcher_called: true,
      implementation: {
        commit: impl > 1 ? repaired.commit : candidate, worktree, run_id: `run-${tag}`,
        dispatch_id: `d-${tag}`, provider: 'fixture', runner: 'fixture',
        model: 'fixture-implementer', insertions: 1, deletions: 0,
      },
      implementationResult: { error: null, signal: null, status: 0 },
      ledger: [],
    };
  };
  const roster = {
    reviewer_engine: seats[0].model, reviewer_effort: 'high', reviewer_runner: 'cc-shim',
    reviewer_qualified: true, implementer_engine: 'fixture-implementer',
    implementer_effort: 'high', implementer_runner: 'fixture',
    loop_max_rounds: 3, loop_convergence_verdict: 'SHIP-AS-IS',
    min_panel_size: opts.minPanel === undefined ? 3 : opts.minPanel,
    qc_panel_seats_complete: true, qc_panel_seats: seats,
    in_rail_review: opts.station || 'panel',
    override_admitted_seats: ['qc_panel[0]', 'qc_panel[1]', 'qc_panel[2]'],
  };
  const result = engine.runImplementationReviewLoop({
    promptFile, branch, base, roster,
    campaignContract: contractPath, campaignSeal: sealPath,
    campaignDispositionPolicy: opts.policy || 'acceptance-bound',
    verificationEnv: { PATH: process.env.PATH || '', CI: tag },
    verificationEnvAllowlist: ['CI'],
  });
  return { result, panelCalls, finalPanelCalls, reviewCalls, reviewModels, impl, replay };
}

const names = seats.map((x) => x.model);
const traceOf = (receipt) => (receipt && receipt.trace) || [];
const run = (tag, extra) => {
  const out = runStation(tag, {
    station: 'panel', fixFirst: false, withPacketHash: true, failSeat: names[1], replay: true,
    afterFirst: () => {}, ...extra,
  });
  assert.ok(out.replay, `${tag}: the panel was replayed: ${JSON.stringify(out.result).slice(0, 500)}`);
  return out;
};

// 3 seats: 1 and 3 return valid bound verdicts, seat 2 has a transport failure. Replay the panel.
const reuse = run('seat-reuse', {});
assert.deepStrictEqual(reuse.replay.firstReceipt.final_panel_seat_receipts.map((r) => r.status),
  ['reviewed', 'transport_failed', 'reviewed']);
assert.deepStrictEqual(reuse.replay.replayModels, [names[1]],
  `only the failed seat is re-dispatched: ${JSON.stringify(reuse.replay.replayModels)}`);
const rr = reuse.replay.secondReceipt;
assert.strictEqual(reuse.replay.written.length, 3, 'one artifact per dispatched seat');
assert.deepStrictEqual(rr.final_panel_seat_receipts.map((r) => r.status), ['reviewed', 'reviewed', 'reviewed']);
assert.strictEqual(rr.reviewed, true);
assert.ok(traceOf(rr).includes('final_panel_seat_reused:1') && traceOf(rr).includes('final_panel_seat_reused:3'),
  JSON.stringify(traceOf(rr)));
assert.strictEqual(rr.final_panel_seat_receipts[0].review_digest, reuse.replay.firstReceipt.final_panel_seat_receipts[0].review_digest);
console.log('resume_dispatches_only_failed_seat=true');

// Negative controls: each unusable artifact is re-dispatched, never trusted.
const garbled = run('seat-garbled', { afterFirst: ({ written }) => fs.writeFileSync(seatN(written, 1), '{not json') });
assert.deepStrictEqual(garbled.replay.replayModels, [names[0], names[1]], JSON.stringify(garbled.replay.replayModels));
console.log('unparseable_artifact_redispatched=true');

const wrongId = run('seat-wrong-id', {
  afterFirst: ({ written }) => editJson(seatN(written, 3), (b) => { b.seat.model = 'some-other-model'; }),
});
assert.deepStrictEqual(wrongId.replay.replayModels, [names[1], names[2]], JSON.stringify(wrongId.replay.replayModels));
const wrongSwap = run('seat-swapped', {
  // seat 1's artifact content placed in seat 3's slot: seat id / tuple does not match the roster seat.
  afterFirst: ({ written }) => fs.copyFileSync(seatN(written, 1), seatN(written, 3)),
});
assert.deepStrictEqual(wrongSwap.replay.replayModels, [names[1], names[2]], JSON.stringify(wrongSwap.replay.replayModels));
console.log('wrong_seat_artifact_not_reused=true');

const forged = run('seat-forged', {
  afterFirst: ({ written }) => editJson(seatN(written, 1), (b) => { b.result.verdict = 'FIX-THEN-SHIP'; }),
});
assert.deepStrictEqual(forged.replay.replayModels, [names[0], names[1]], JSON.stringify(forged.replay.replayModels));
const flagOnly = run('seat-flag-only', {
  // a "reviewed" flag / summary field cannot stand in for the stored verdict
  afterFirst: ({ written }) => editJson(seatN(written, 3), (b) => { b.reviewed = true; b.result.review_digest = 'f'.repeat(64); }),
});
assert.deepStrictEqual(flagOnly.replay.replayModels, [names[1], names[2]], JSON.stringify(flagOnly.replay.replayModels));
console.log('forged_verdict_not_reused=true');

// Changed packet: the replayed panel sees a different diff/spec, so every seat re-runs.
const changed = run('seat-diff-changed', {
  afterFirst: () => fs.appendFileSync(path.join(tmp, 'seat-diff-changed.prompt'), 'the diff changed\n'),
});
assert.deepStrictEqual(changed.replay.replayModels, names, JSON.stringify(changed.replay.replayModels));
console.log('changed_packet_reruns_every_seat=true');

// Attempt budget: a seat that already used its budget is not dispatched again; terminal reason.
const over = run('seat-over-budget', {
  afterFirst: ({ written }) => editJson(seatN(written, 2), (b) => { b.attempts = 3; }),
});
assert.deepStrictEqual(over.replay.replayModels, [], JSON.stringify(over.replay.replayModels));
const orc = over.replay.secondReceipt;
assert.strictEqual(orc.reviewed, false);
assert.strictEqual(orc.reason, 'final_panel_seat_attempt_budget_exhausted', JSON.stringify(orc).slice(0, 600));
assert.strictEqual(orc.final_panel_seat_receipts[1].status, 'attempt_budget_exhausted');
assert.notStrictEqual(over.result.durable_wait, true, 'a seat over budget must not park for another retry');
assert.strictEqual(over.result.reason, 'final_panel_seat_attempt_budget_exhausted', JSON.stringify(over.result).slice(0, 600));
console.log('over_budget_seat_not_redispatched=true');
NODE
)"
assert_exit_code "$?" "0" "final-panel seat resume: $OUT"
for key in resume_dispatches_only_failed_seat unparseable_artifact_redispatched wrong_seat_artifact_not_reused \
  forged_verdict_not_reused changed_packet_reruns_every_seat over_budget_seat_not_redispatched; do
  assert_contains "$OUT" "$key=true" "seat resume proves $key"
done
finalize_test
