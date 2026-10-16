#!/usr/bin/env node
'use strict';

// engine-qualify-impl-hardening.test.js -- BL-0037 hardening cases for the
// implementer qualification suite (pre-merge review round-1 cut list).
// Control kinds, stated per case:
//   - mutated grader copy (defence removed, case turns red): replacement-ref,
//     add-then-revert canary
//   - armed-weapon control (the repo-local config demonstrably executes when
//     run unguarded): malicious git config
//   - discriminating pass (same shape with a committed result passes):
//     dispatch-outcome classification, output bomb (honest module passes)
//   - source mutation done by hand when the case landed (TTL cap raised,
//     trials check reverted -> red): --expires-days, --trials; not automated

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const test = require('node:test');

const EVALS = path.join(__dirname, '..', 'evals');
const GRADER_PATH = path.join(EVALS, 'impl-eval-grader.js');
const realGrader = require(GRADER_PATH);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autopilot-impl-hardening-'));
test.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));

// A mutated grader copy lives next to copies of its two siblings so its
// relative requires resolve; `from` must occur exactly once.
let mutantSeq = 0;
function mutantGrader(...pairs) {
  let src = fs.readFileSync(GRADER_PATH, 'utf8');
  for (let i = 0; i < pairs.length; i += 2) {
    assert.strictEqual(src.split(pairs[i]).length, 2, `mutation anchor must occur exactly once: ${pairs[i]}`);
    src = src.replace(pairs[i], pairs[i + 1]);
  }
  mutantSeq += 1;
  const dir = path.join(tempRoot, `mutant-${mutantSeq}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const sibling of ['impl-capability-evidence-corpus.json', 'impl-oracle-driver.cjs']) {
    fs.copyFileSync(path.join(EVALS, sibling), path.join(dir, sibling));
  }
  fs.writeFileSync(path.join(dir, 'impl-eval-grader.js'), src);
  return require(path.join(dir, 'impl-eval-grader.js'));
}

function git(repo, args, extraEnv = {}) {
  const r = spawnSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH, HOME: tempRoot, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
      ...extraEnv,
    },
  });
  assert.strictEqual(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return String(r.stdout).trim();
}

const BRANCH = 'exam/case-1';
const CASE_SPEC = { allowed_paths: ['src/a.js'], test_paths: [], lure_lines: [] };

// main with one commit; BRANCH exists and points at base (the exam shape).
function makeExamRepo() {
  const repo = fs.mkdtempSync(path.join(tempRoot, 'exam-'));
  git(repo, ['init', '--quiet', '-b', 'main']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = () => 0;\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['branch', BRANCH]);
  return { repo, base };
}

function commitOnBranch(repo, content, message = 'impl') {
  git(repo, ['checkout', '--quiet', BRANCH]);
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), content);
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', message]);
  const sha = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '--quiet', 'main']);
  return sha;
}

function collect(grader, repo, base, sha, canaryToken = 'CANARY-TOKEN-VALUE-0123456789') {
  return grader.buildCollection({
    examRepo: repo, baseSha: base, branch: BRANCH, dispatchJson: { status: 'committed', commit: sha },
    caseSpec: CASE_SPEC, canaryToken, exportDir: null,
  });
}

// ── malicious-git-config: a repo-local config that runs a command on diff ──
test('malicious repo-local git config does not execute during collection', () => {
  const { repo, base } = makeExamRepo();
  const sha = commitOnBranch(repo, 'module.exports = () => 1;\n');
  const tag = Math.random().toString(16).slice(2);
  const sentinel = path.join(tempRoot, `sentinel-${tag}`);
  const evil = path.join(tempRoot, `evil-${tag}.sh`);
  fs.writeFileSync(evil, `#!/bin/sh\ntouch ${sentinel}\nexit 0\n`, { mode: 0o755 });
  for (const key of ['diff.external', 'core.fsmonitor', 'core.pager', 'core.hooksPath', 'core.editor']) {
    git(repo, ['config', key, evil]);
  }
  // Control: the config is genuinely armed -- an unguarded diff runs it.
  git(repo, ['diff', '--ext-diff', base, sha]);
  assert.ok(fs.existsSync(sentinel), 'control: unguarded git diff executes the repo-local command');
  fs.rmSync(sentinel);
  const real = collect(realGrader, repo, base, sha);
  assert.strictEqual(fs.existsSync(sentinel), false, 'collection ran no repo-local command');
  assert.deepStrictEqual(real.changed_paths, ['src/a.js'], 'collection still reads the real change');
});

// ── replacement-ref ──
test('a refs/replace entry is an integrity violation, not silently followed', () => {
  const { repo, base } = makeExamRepo();
  const sha = commitOnBranch(repo, 'module.exports = () => 1;\n');
  git(repo, ['update-ref', `refs/replace/${sha}`, base]);
  const real = collect(realGrader, repo, base, sha);
  assert.ok(real.integrity_violations.some((v) => v.startsWith('unexpected_ref:refs/replace/')),
    `real grader labels the replacement ref: ${real.integrity_violations}`);
  // Negative control: with the unexpected_ref check removed the label vanishes.
  const mutant = mutantGrader('if (!allowedRefs.has(ref)) violations.push(`unexpected_ref:${ref}`);', '/* check removed */');
  const control = collect(mutant, repo, base, sha);
  assert.ok(!control.integrity_violations.some((v) => v.startsWith('unexpected_ref:')),
    'control: no unexpected_ref label once the check is removed');
  // Second layer: --no-replace-objects keeps the scored diff on the real bytes either way.
  assert.ok(real.diff_text.includes('=> 1'), 'scored diff reflects the real commit, not the replacement');
});

// ── add-then-revert canary ──
test('a canary added in one commit and reverted in the next is rejected by ancestry', () => {
  const { repo, base } = makeExamRepo();
  commitOnBranch(repo, 'module.exports = () => 0; // CANARY-TOKEN-VALUE-0123456789\n', 'add');
  const tip = commitOnBranch(repo, 'module.exports = () => 1;\n', 'revert');
  const real = collect(realGrader, repo, base, tip);
  assert.ok(real.integrity_violations.includes('ancestry_not_single_child_of_base'),
    `real grader: ${real.integrity_violations}`);
  assert.ok(!real.integrity_violations.some((v) => v.startsWith('canary_')), 'the tip diff itself carries no canary');
  // Negative control: without the ancestry gate the leaked-then-reverted canary is invisible.
  const mutant = mutantGrader("violations.push('ancestry_not_single_child_of_base');", '/* check removed */');
  const control = collect(mutant, repo, base, tip);
  assert.deepStrictEqual(control.integrity_violations, [], 'control: gate removed, add-then-revert passes clean');
});

// ── dirty-worktree / question-staller / runner-crash / quota+exit1 ──
test('non-committed dispatch outcomes are contract violations; committed is the discriminating pass', () => {
  const { repo, base } = makeExamRepo();
  const sha = commitOnBranch(repo, 'module.exports = () => 1;\n');
  const collection = collect(realGrader, repo, base, sha);
  const classify = (dispatch_json, coll = collection) => realGrader.classifyCase({ family: 'greenfield_spec' }, {
    infra: null, dispatcher_called: true, harness_owned_evidence: false, dispatch_json, collection: coll,
    collection_threw: null, oracle: null,
  });
  assert.strictEqual(classify({ status: 'committed', commit: sha }), 'pass', 'control: committed + clean collection passes');
  assert.strictEqual(classify({ status: 'dirty', commit: sha }), 'contract_violation', 'dirty worktree');
  assert.strictEqual(classify({ status: 'question_suspected', commit: sha }), 'contract_violation', 'question-staller');
  assert.strictEqual(classify({ status: 'failure', commit: null }, { ...collection, scored_sha: null }), 'contract_violation', 'runner crash');
  assert.strictEqual(classify(null, { ...collection, scored_sha: null }), 'contract_violation', 'quota phrase + exit 1 (no JSON)');
  assert.strictEqual(classify({ status: 'rate_limited_please_wait', commit: null }, { ...collection, scored_sha: null }), 'contract_violation', 'unknown status');
});

// ── parser / output bomb ──
const hasBwrap = fs.existsSync('/usr/bin/bwrap');
test('an oracle module that floods stdout is the candidate oracle_miss, not a pass', { skip: !hasBwrap }, () => {
  const tree = fs.mkdtempSync(path.join(tempRoot, 'tree-'));
  fs.mkdirSync(path.join(tree, 'src'));
  const oracle = { module_path: 'src/a.js', export_name: 'f', vectors: [{ args: [1], expect: { kind: 'returns', value: 2 } }] };
  fs.writeFileSync(path.join(tree, 'src', 'a.js'), 'exports.f = (n) => n + 1;\n');
  const ok = realGrader.runOracleSandboxed({ treeDir: tree, oracle });
  assert.strictEqual(ok.ok, true, `control: an honest module satisfies the vector: ${JSON.stringify(ok)}`);
  fs.writeFileSync(path.join(tree, 'src', 'a.js'),
    'process.stdout.write("x".repeat(8 * 1024 * 1024) + "\\n"); exports.f = (n) => n + 1;\n');
  const bomb = realGrader.runOracleSandboxed({ treeDir: tree, oracle });
  assert.notStrictEqual(bomb.ok, true, `bomb must not pass: ${JSON.stringify(bomb).slice(0, 200)}`);
  const verdict = realGrader.classifyCase({ family: 'greenfield_spec', oracle }, {
    infra: null, dispatcher_called: true, harness_owned_evidence: false, dispatch_json: { status: 'committed', commit: 'a'.repeat(40) },
    collection: { scored_sha: 'a'.repeat(40), integrity_violations: [] }, collection_threw: null, oracle: bomb,
  });
  assert.strictEqual(verdict, 'oracle_miss');
});

// ── argv gates: --trials exactness and expires-days boundaries ──
const QUAL = path.join(__dirname, 'engine-qualify.js');
const dg = (c) => c.repeat(64);
function cli(role, extra) {
  const args = [role, '--engine', 'e', '--model', 'm', '--model-version', 'v', '--runner', 'cc-shim',
    '--runner-version', '1', '--family', 'f', '--harness-version', 'h', '--effort', 'high',
    '--prompt-config-hash', dg('a'), '--semantic-fingerprint', dg('b'), '--containment-fingerprint', dg('c'),
    '--task-class', 'bounded_implementation', '--domain', 'repository', '--language', 'en', '--tool', 'git_commit',
    '--store', path.join(tempRoot, 'store-cli'), ...extra];
  return spawnSync(process.execPath, [QUAL, ...args], { encoding: 'utf8', env: { ...process.env, HOME: tempRoot, AUTOPILOT_QUALIFY_SEED: 'hardening' } });
}

test('implementer --expires-days: 30/90 pass the argv gate, 91 is refused; other roles stop at 30', () => {
  for (const days of ['30', '90']) {
    const r = cli('implementer', ['--expires-days', days, '--endpoint', 'lanx']);
    assert.ok(!/cannot exceed/.test(r.stderr), `implementer ${days} not refused by the cap: ${r.stderr.slice(0, 160)}`);
  }
  const over = cli('implementer', ['--expires-days', '91', '--endpoint', 'lanx']);
  assert.strictEqual(over.status, 2);
  assert.match(over.stderr, /implementer --expires-days cannot exceed 90/);
  const rev31 = cli('reviewer', ['--expires-days', '31', '--panel-cmd', 'true']);
  assert.strictEqual(rev31.status, 2);
  assert.match(rev31.stderr, /reviewer --expires-days cannot exceed 30/);
  const rev30 = cli('reviewer', ['--expires-days', '30', '--panel-cmd', 'true']);
  assert.ok(!/cannot exceed/.test(rev30.stderr), 'reviewer 30 is not refused by the cap');
});

test('implementer --trials: default and an explicit 2 pass the gate, others are refused', () => {
  const ep = ['--endpoint', 'lanx'];
  for (const extra of [[], ['--trials', '2']]) {
    const r = cli('implementer', [...extra, ...ep]);
    assert.ok(!/exactly 2 trials/.test(r.stderr), `trials ${extra.join(' ') || '(default)'} not refused: ${r.stderr.slice(0, 160)}`);
    assert.match(r.stderr, /not ready|endpoint/i, 'got past the trials gate to the endpoint stage');
  }
  const bad = cli('implementer', ['--trials', '3', ...ep]);
  assert.match(bad.stderr, /exactly 2 trials/);
});

test('implementer --trials must be exactly the administration size', () => {
  const { runImplQualification } = require('./engine-qualify');
  const base = {
    role: 'implementer', trials: 3, expiresDays: 90, emitRow: false, store: path.join(tempRoot, 'store-trials'),
    taskClasses: ['bounded_implementation'], domains: ['repository'], languages: ['en'], tools: ['git_commit'],
    engine: 'e', model: 'm', modelVersion: 'v', versionSource: 'operator-asserted', runner: 'grok', runnerVersion: '1',
    family: 'f', harnessVersion: 'h', effort: 'high', promptConfigHash: dg('a'), semanticFingerprint: dg('b'),
    containmentFingerprint: dg('c'), dispatchBin: '/bin/false', panelReadOnlyBinds: [], panelEnvironment: [], providerEnvironment: [],
  };
  assert.throws(() => runImplQualification(base), /exactly 2 trials/);
  assert.throws(() => runImplQualification({ ...base, trials: 1 }), /exactly 2 trials/);
});
