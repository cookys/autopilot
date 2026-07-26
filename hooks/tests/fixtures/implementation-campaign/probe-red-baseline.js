#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const [baselineRoot, promptFile] = process.argv.slice(2);
if (!baselineRoot || !promptFile) {
  process.stderr.write('usage: probe-red-baseline.js <baseline-root> <prompt-file>\n');
  process.exit(2);
}

const { AutopilotEngine } = require(path.join(baselineRoot, 'src', 'engine'));
fs.writeFileSync(promptFile, 'bounded baseline exploit replay\n');

const BASE = '1111111111111111111111111111111111111111';
const roster = {
  reviewer_engine: 'fixture-reviewer',
  reviewer_effort: 'high',
  reviewer_runner: 'fixture',
  reviewer_qualified: true,
  implementer_engine: 'fixture-implementer',
  implementer_effort: 'high',
  implementer_runner: 'fixture',
  loop_max_rounds: 5,
  loop_convergence_verdict: 'SHIP-AS-IS',
};

function makeEngine(verdicts) {
  const counters = { implementation: 0, review: 0, repair: 0, verify: 0 };
  const engine = new AutopilotEngine({
    clock: () => '2026-07-26T00:00:00.000Z',
    implementationDispatcher(args) {
      counters.implementation += 1;
      const digit = String(Math.min(9, counters.implementation + 1));
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
          model: 'fixture',
          branch: args[args.indexOf('--branch') + 1],
          base: args[args.indexOf('--base') + 1],
          commit: digit.repeat(40),
          files_changed: 1,
          insertions: 1,
          deletions: 0,
          worktree: null,
          agent_log: null,
          error: null,
        },
      };
    },
    reviewDispatcher() {
      counters.review += 1;
      const verdict = verdicts[Math.min(counters.review - 1, verdicts.length - 1)];
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        parseError: null,
        result: {
          runner: 'fixture',
          model: 'fixture',
          status: 'reviewed',
          verdict,
          findings: verdict === 'FIX-THEN-SHIP'
            ? 'unrelated publication hardening'
            : 'none',
          raw_log: '/tmp/fixture-review.log',
          error: null,
        },
      };
    },
    diffProvider({ round }) {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-red-diff-'));
      const target = path.join(directory, `round-${round}.diff`);
      fs.writeFileSync(target, `round ${round}\n`);
      return target;
    },
    repairPromptWriter() {
      counters.repair += 1;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-red-prompt-'));
      const target = path.join(directory, `repair-${counters.repair}.txt`);
      fs.writeFileSync(target, 'repair without a disposition receipt\n');
      return target;
    },
    gitWorktreeAdd() {
      const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'campaign-red-verify-'));
      const worktree = path.join(parent, 'worktree');
      fs.mkdirSync(worktree);
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: '',
        stderr: '',
        worktree,
        parent,
      };
    },
    verifyCommandRunner() {
      counters.verify += 1;
      return {
        error: null,
        status: 0,
        signal: null,
        stdout: 'pass\n',
        stderr: '',
      };
    },
    gitWorktreeRemove({ worktree }) {
      fs.rmSync(worktree, { recursive: true, force: true });
      return { error: null, status: 0, signal: null, stdout: '', stderr: '' };
    },
    verifyWorktreeCleanup({ targetPath }) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    },
  });
  return { engine, counters };
}

function run(verdicts, input = {}) {
  const fixture = makeEngine(verdicts);
  const result = fixture.engine.runImplementationReviewLoop({
    promptFile,
    branch: input.branch || 'impl/red-baseline',
    base: BASE,
    roster,
    maxRounds: input.maxRounds || verdicts.length,
    verifyCmd: input.verifyCmd,
  });
  return { result, counters: fixture.counters };
}

const missing = run(['SHIP-AS-IS']);
const cap = run(['FIX-THEN-SHIP', 'FIX-THEN-SHIP', 'SHIP-AS-IS'], { maxRounds: 3 });
const disposition = run(['FIX-THEN-SHIP', 'SHIP-AS-IS'], { maxRounds: 2 });
const resetA = run(['SHIP-AS-IS'], { branch: 'impl/reset-a' });
const resetB = run(['SHIP-AS-IS'], { branch: 'impl/reset-b' });
const receipt = run(['SHIP-AS-IS'], { verifyCmd: 'node fixture-verify.js' });
const receiptJson = JSON.stringify(receipt.result);

const exploits = {
  missing_contract: missing.result.status === 'converged'
    && missing.counters.implementation === 1,
  repair_cap_reset: cap.result.status === 'converged'
    && cap.counters.implementation === 3,
  missing_finding_disposition: disposition.result.status === 'converged'
    && disposition.counters.repair === 1
    && !disposition.result.ledger.some((entry) => String(entry.unit).includes('adjudicat')),
  session_resume_reset: resetA.result.status === 'converged'
    && resetB.result.status === 'converged'
    && resetA.counters.implementation + resetB.counters.implementation === 2,
  verification_receipt_reuse: receipt.result.status === 'converged'
    && receipt.counters.verify === 1
    && !receiptJson.includes('tree_sha')
    && !receiptJson.includes('argv_hash')
    && !receiptJson.includes('env_fingerprint'),
};

process.stdout.write(`${JSON.stringify({
  baseline_runtime_probe: true,
  exploits,
}, null, 2)}\n`);
process.exit(Object.values(exploits).every(Boolean) ? 0 : 1);
