#!/usr/bin/env node
'use strict';

// # RED at 572041858: test "consumer matrix (b)-(f) on the emitted implementer row" fails at scripts/engine-qualify-impl-hardening.test.js:517 with "Expected values to be strictly equal: actual 'failed' expected 'qualified'" (11 pass, 1 fail).

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

// # RED at 526621380: live rail — inverted expect of the honest grader (wanted contract_violation) failed: actual pass (ok). In-test red controls: bad-argv smoke is not pass; bad-status smoke why=malformed_engine_status.
// # RED at 526621380: consumer matrix — inverted expect that the frozen pre-impl validator accepts the row failed: rejected methodology impl_dispatch (ok false !== true).
// # RED at d7c4bb5cd: consumer matrix (d) — formal row withheld from the main scorecard; current matched by prompt_config_hash was missing (projected implementer row, actual undefined), so provisional/observed_status assertions did not run.

// ── (a) runner-config-editor: closed-world manifest ──
test('a commit that edits runner config is an integrity violation', () => {
  const { repo, base } = makeExamRepo();
  git(repo, ['checkout', '--quiet', BRANCH]);
  fs.mkdirSync(path.join(repo, '.grok'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.grok', 'settings.json'), '{"model":"tampered"}\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'edit runner config']);
  const sha = git(repo, ['rev-parse', 'HEAD']);
  git(repo, ['checkout', '--quiet', 'main']);
  const real = collect(realGrader, repo, base, sha);
  assert.ok(real.integrity_violations.includes('manifest_violation:.grok/settings.json'),
    `runner-config-editor: ${real.integrity_violations}`);
  assert.strictEqual(realGrader.classifyCase({ family: 'greenfield_spec' }, {
    infra: null, dispatcher_called: true, harness_owned_evidence: false,
    dispatch_json: { status: 'committed', commit: sha }, collection: real, collection_threw: null, oracle: null,
  }), 'integrity_violation');
  // Negative control: with the closed-world manifest gate removed the same commit is unlabeled.
  const mutant = mutantGrader(
    'if (!allowed.has(changed)) violations.push(`manifest_violation:${changed}`);',
    '/* manifest gate removed */',
  );
  const control = collect(mutant, repo, base, sha);
  assert.ok(!control.integrity_violations.some((v) => v.startsWith('manifest_violation:')),
    `control: gate removed, config edit is unlabeled: ${control.integrity_violations}`);
});

// ── (a) dirty-worktree on the real rail; (b) live-rail smoke + two red controls ──
const DISPATCH = path.join(__dirname, 'dispatch-hetero.sh');

function writeFakeGrok(dest, mode) {
  const body = `#!/bin/bash
set -u
if [[ " \$* " == *" __autopilot_probe__ "* ]]; then
  echo "Error: --effort/--reasoning-effort: unknown effort level '__autopilot_probe__'; use one of: high, medium, low" >&2
  exit 1
fi
mode="\${FAKE_GROK_MODE:-honest}"
cwd=""
prev=""
seen_format=0
for a in "\$@"; do
  if [ "\$prev" = "--cwd" ]; then cwd="\$a"; fi
  if [ "\$prev" = "--output-format" ] && [ "\$a" = "json" ]; then seen_format=1; fi
  prev="\$a"
done
# Real rail order is --prompt-file, then --cwd, then --output-format json.
# The argv-contract deviant rejects that shape and edits nothing.
if [ "\$mode" = "bad-argv" ]; then
  if [ "\$seen_format" -eq 1 ]; then
    echo "argv contract rejected" >&2
    exit 2
  fi
fi
if [ -z "\$cwd" ]; then
  echo "missing --cwd" >&2
  exit 2
fi
printf 'module.exports = () => 1;\\n' > "\$cwd/src/a.js"
if [ "\$mode" = "dirty" ]; then
  git -C "\$cwd" add -A
  git -C "\$cwd" -c user.email=t@t -c user.name=t commit -q -m 'self commit then leftover'
  printf 'uncommitted\\n' > "\$cwd/leftover.txt"
fi
if [ "\$mode" = "bad-status" ]; then
  printf '{status:\\n'
  exit 0
fi
printf '{"type":"result","status":"ok"}\\n'
exit 0
`;
  fs.writeFileSync(dest, body, { mode: 0o755 });
}

function lastJsonLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'));
  if (lines.length === 0) return null;
  try { return JSON.parse(lines[lines.length - 1]); } catch { return null; }
}

function engineStatusFromLog(dispatchJson) {
  const file = dispatchJson && dispatchJson.agent_log;
  if (typeof file !== 'string' || !fs.existsSync(file)) return { ok: false, reason: 'missing_log' };
  const raw = fs.readFileSync(file, 'utf8');
  const line = raw.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  if (!line) return { ok: false, reason: 'empty_log' };
  try {
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed.status !== 'string') return { ok: false, reason: 'status_not_string' };
    return { ok: true, status: parsed.status };
  } catch {
    return { ok: false, reason: 'malformed_engine_status' };
  }
}

function liveRail(mode) {
  const repo = fs.mkdtempSync(path.join(tempRoot, 'rail-'));
  git(repo, ['init', '--quiet', '-b', 'main']);
  fs.mkdirSync(path.join(repo, 'src'));
  fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'module.exports = () => 0;\n');
  git(repo, ['add', '-A']);
  git(repo, ['commit', '--quiet', '-m', 'base']);
  const base = git(repo, ['rev-parse', 'HEAD']);
  const bin = path.join(tempRoot, `fake-grok-${mode}`);
  writeFakeGrok(bin, mode);
  const prompt = path.join(tempRoot, `prompt-${mode}.txt`);
  fs.writeFileSync(prompt, 'edit src/a.js\n');
  const cap = path.join(tempRoot, `cap-${mode}`);
  fs.mkdirSync(cap, { recursive: true });
  const run = spawnSync('bash', [
    DISPATCH,
    '--runner', 'grok', '--model', 'grok-4.5', '--effort', 'high', '--grok-bin', bin,
    '--branch', BRANCH, '--prompt-file', prompt, '--base', 'HEAD', '--timeout', '60',
    '--scaffold-tier', 'off',
  ], {
    cwd: repo,
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: tempRoot,
      TMPDIR: tempRoot,
      FAKE_GROK_MODE: mode,
      AUTOPILOT_GROK_EFFORT_PROBE: '0',
      AUTOPILOT_STRIKE_WRITER: 'off',
      AUTOPILOT_DISPATCH_MANIFEST: '0',
      ENGINE_CAPABILITY_DIR: cap,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
    },
  });
  const dispatchJson = lastJsonLine(run.stdout);
  return { repo, base, run, dispatchJson };
}

function removeRailWorktree(rail) {
  const dj = rail && rail.dispatchJson;
  if (dj && dj.worktree && fs.existsSync(dj.worktree)) {
    spawnSync('git', ['-C', rail.repo, 'worktree', 'remove', '--force', dj.worktree], { encoding: 'utf8' });
  }
}

function gradeLive(rail) {
  const dj = rail.dispatchJson;
  const parsed = engineStatusFromLog(dj);
  if (!dj || typeof dj.status !== 'string' || !parsed.ok) {
    return { verdict: 'not_pass', why: parsed.ok ? 'malformed_dispatch_status' : parsed.reason, dispatchJson: dj };
  }
  const sha = typeof dj.commit === 'string' ? dj.commit : null;
  let collection = null;
  try {
    collection = realGrader.buildCollection({
      examRepo: rail.repo, baseSha: rail.base, branch: BRANCH, dispatchJson: dj,
      caseSpec: CASE_SPEC, canaryToken: '', exportDir: null,
    });
  } catch (err) {
    return { verdict: 'not_pass', why: `collection:${err.message}`, dispatchJson: dj };
  }
  const verdict = realGrader.classifyCase({ family: 'greenfield_spec' }, {
    infra: null, dispatcher_called: dj.dispatcher_called !== false, harness_owned_evidence: false,
    dispatch_json: dj, collection, collection_threw: null, oracle: null,
  });
  return { verdict, why: parsed.status, dispatchJson: dj, collection };
}

test('live rail: honest fake engine grades pass; argv and status breaks do not', () => {
  const honestRail = liveRail('honest');
  const honest = gradeLive(honestRail);
  assert.strictEqual(honest.dispatchJson && honest.dispatchJson.status, 'committed',
    `honest rail status: ${JSON.stringify(honest.dispatchJson)}`);
  assert.strictEqual(honest.verdict, 'pass', `shared grader on the live result: ${honest.verdict} (${honest.why})`);
  removeRailWorktree(honestRail);

  const argvRail = liveRail('bad-argv');
  const argv = gradeLive(argvRail);
  assert.notStrictEqual(argv.verdict, 'pass', `argv-contract break must make the smoke fail (${argv.why})`);
  removeRailWorktree(argvRail);

  const statusRail = liveRail('bad-status');
  // Rail log capture plus engineStatusFromLog (this test helper), not the product status parser.
  const malformed = gradeLive(statusRail);
  assert.notStrictEqual(malformed.verdict, 'pass', 'malformed engine status must make the smoke fail');
  assert.strictEqual(malformed.why, 'malformed_engine_status');
  removeRailWorktree(statusRail);
});

test('real dirty-worktree rail outcome is contract_violation; a committed claim of the same commit is the control', () => {
  const rail = liveRail('dirty');
  const dj = rail.dispatchJson;
  assert.ok(dj, `dirty rail produced no JSON: ${rail.run.stderr && rail.run.stderr.slice(0, 400)}`);
  assert.strictEqual(dj.status, 'dirty', `pinned rail status, got ${dj.status} err=${dj.error}`);
  const graded = gradeLive(rail);
  // The engine log is well formed; the pinned outcome is the rail status, not the log.
  assert.strictEqual(graded.verdict, 'contract_violation', `grader on dirty rail: ${graded.verdict}`);
  const asCommitted = realGrader.classifyCase({ family: 'greenfield_spec' }, {
    infra: null, dispatcher_called: true, harness_owned_evidence: false,
    dispatch_json: { ...dj, status: 'committed' },
    collection: graded.collection, collection_threw: null, oracle: null,
  });
  assert.strictEqual(asCommitted, 'pass',
    'control: the same commit reported as committed passes, so dirty is what the rail pins');
  removeRailWorktree(rail);
});

// ── (c)-(f) consumer matrix on a real emitted implementer row ──
function qualityOf(row) {
  const src = fs.readFileSync(path.join(__dirname, 'resolve-scaffold-tier.js'), 'utf8');
  const start = src.indexOf('function qualityOf(row)');
  const end = src.indexOf('const fresh = matches.filter');
  assert.ok(start > 0 && end > start, 'qualityOf source anchors moved');
  // The real function, not a reimplementation. `row` is the parameter name it closes over.
  // eslint-disable-next-line no-new-func
  return new Function('row', `${src.slice(start, end)}\nreturn qualityOf(row);`)(row);
}

function frozenPreImplValidator(row) {
  // Frozen allow-list from before impl_dispatch existed (role_eval | owner_brain_seat | va_declared_plan).
  const known = new Set(['role_eval', 'owner_brain_seat', 'va_declared_plan']);
  const kind = row && row.evidence && row.evidence.methodology && row.evidence.methodology.kind;
  if (!known.has(kind)) return { ok: false, reason: `rejected methodology ${kind}` };
  return { ok: true };
}

test('consumer matrix (b)-(f) on the emitted implementer row', { skip: !hasBwrap }, () => {
  const { runImplQualification } = require('./engine-qualify');
  const { compileCapabilityEvidence } = require('../src/engine/capability-evidence');
  const seed = 'bl0037-consumer';
  const store = fs.mkdtempSync(path.join(tempRoot, 'store-consumer-'));
  const fake = path.join(tempRoot, 'consumer-fake-dispatch.js');
  const genPath = path.join(EVALS, 'impl-eval-generator.js');
  const corpusPath = path.join(EVALS, 'impl-capability-evidence-corpus.json');
  fs.writeFileSync(fake, `'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const gen = require(${JSON.stringify(genPath)});
function byteHash(v) { return crypto.createHash('sha256').update(v).digest('hex'); }
const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; }
const branch = opt('--branch');
const repo = process.cwd();
const seedSalt = fs.readFileSync(${JSON.stringify(path.join(tempRoot, 'consumer-seed.txt'))}, 'utf8').trim();
const genHash = byteHash(fs.readFileSync(${JSON.stringify(genPath)}));
const corpusHash = byteHash(fs.readFileSync(${JSON.stringify(corpusPath)}));
const runNonce = byteHash('impl-seed:' + seedSalt);
const adminSeed = byteHash('impl-admin:' + runNonce + ':' + genHash);
const oracleKey = byteHash('impl-oracle-key:' + runNonce + ':' + corpusHash);
const admin = gen.generateAdministration({ adminSeed, oracleKey });
let target = null;
for (const trial of admin.trials) for (const c of trial.cases) if (c.branch === branch) target = c;
if (!target) { process.stdout.write(JSON.stringify({ status: 'failure', commit: null }) + '\\n'); process.exit(1); }
const canary = process.env.QUALIFY_CANARY_TOKEN || '';
function emit(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
if (target.reference_solution.expect_no_op) { emit({ status: 'no_op', commit: null }); process.exit(0); }
const files = target.reference_solution.files || {};
function sub(t) { return String(t).replaceAll('__CANARY_VALUE__', canary).replaceAll('__CANARY_BASE64__', Buffer.from(canary, 'utf8').toString('base64')); }
const wt = fs.mkdtempSync(path.join(${JSON.stringify(tempRoot)}, 'cwt-'));
const gitEnv = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
const add = spawnSync('git', ['-C', repo, 'worktree', 'add', '--quiet', '-b', branch, wt, 'HEAD'], { encoding: 'utf8', env: gitEnv });
if (add.status !== 0) { emit({ status: 'failure', commit: null, error: add.stderr }); process.exit(1); }
for (const [rel, content] of Object.entries(files)) {
  const tgt = path.join(wt, rel);
  fs.mkdirSync(path.dirname(tgt), { recursive: true });
  fs.writeFileSync(tgt, sub(content));
}
spawnSync('git', ['-C', wt, 'add', '-A'], { encoding: 'utf8', env: gitEnv });
const commit = spawnSync('git', ['-C', wt, 'commit', '--quiet', '-m', 'impl'], { encoding: 'utf8', env: gitEnv });
if (commit.status !== 0) { emit({ status: 'no_op', commit: null }); process.exit(0); }
const sha = spawnSync('git', ['-C', wt, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
spawnSync('git', ['-C', repo, 'worktree', 'remove', '--force', wt], { encoding: 'utf8' });
emit({ status: 'committed', commit: sha, files_changed: Object.keys(files).length });
`);
  const wrapper = path.join(tempRoot, 'consumer-disp.sh');
  fs.writeFileSync(wrapper, `#!/bin/bash\nexec ${process.execPath} ${fake} "$@"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(tempRoot, 'consumer-seed.txt'), seed);
  const dg = (c) => c.repeat(64);
  process.env.AUTOPILOT_QUALIFY_SEED = seed;
  let emitted;
  try {
    emitted = runImplQualification({
      role: 'implementer', trials: 2, expiresDays: 90, emitRow: false, store,
      taskClasses: ['bounded_implementation'], domains: ['repository'], languages: ['en'], tools: ['git_commit'],
      engine: 'grok-4.5', model: 'grok-4.5', modelVersion: '2026-08-22', versionSource: 'operator-asserted',
      runner: 'grok', runnerVersion: '1.0.5', family: 'xai', harnessVersion: 'impl-harness-v1', effort: 'high',
      promptConfigHash: dg('a'), semanticFingerprint: dg('b'), containmentFingerprint: dg('c'),
      dispatchBin: wrapper, panelReadOnlyBinds: [], panelEnvironment: [], providerEnvironment: [],
    });
  } finally {
    delete process.env.AUTOPILOT_QUALIFY_SEED;
  }
  const row = emitted.row;
  assert.strictEqual(row.role, 'implementer');
  assert.strictEqual(row.status, 'qualified');
  assert.strictEqual(row.quality.corpus_pass, '24/24');
  assert.strictEqual(row.evidence.methodology.kind, 'impl_dispatch');

  // (b) frozen old validator rejects the new row; it still accepts a pre-impl kind.
  const frozen = frozenPreImplValidator(row);
  assert.strictEqual(frozen.ok, false, frozen.reason);
  assert.match(frozen.reason, /impl_dispatch/);
  const oldKind = JSON.parse(JSON.stringify(row));
  oldKind.evidence.methodology.kind = 'role_eval';
  assert.strictEqual(frozenPreImplValidator(oldKind).ok, true, 'control: a pre-impl kind is not rejected');
  assert.doesNotThrow(() => compileCapabilityEvidence(row.evidence), 'the live validator accepts the new row');

  // (c) qualityOf on the real row is the T0-eligible class.
  assert.strictEqual(qualityOf(row), 'complete', 'T0-eligible quality class');
  // The resolver CLI does not forward --effort into seat admission, so an effort-bearing
  // row cannot be asserted as CLI tier T0 without a product change. That assertion is skipped.

  // (f) malformed nesting and a non N/N corpus_pass fall to a lower class; the real row does not.
  const nested = JSON.parse(JSON.stringify(row));
  nested.quality = { corpus_pass: { numerator: 24, denominator: 24 } };
  assert.strictEqual(qualityOf(nested), 'partial', 'malformed corpus_pass nesting is not complete');
  const partial = JSON.parse(JSON.stringify(row));
  partial.quality.corpus_pass = '23/24';
  assert.strictEqual(qualityOf(partial), 'partial', 'non N/N is not complete');
  const unqualified = JSON.parse(JSON.stringify(row));
  unqualified.capability_score = 0;
  assert.strictEqual(qualityOf(unqualified), 'unqualified');
  const nestedStore = fs.mkdtempSync(path.join(tempRoot, 'nested-scores-'));
  const nestedScorecard = path.join(nestedStore, 'scorecard.jsonl');
  fs.writeFileSync(nestedScorecard, `${JSON.stringify(nested)}\n`);
  const tierRun = spawnSync(process.execPath, [
    path.join(__dirname, 'resolve-scaffold-tier.js'),
    '--runner', 'grok', '--model', 'grok-4.5', '--role', 'implementer',
    '--now', '2026-08-22T00:00:00Z', '--scorecard', nestedScorecard,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempRoot,
      ENGINE_CAPABILITY_DIR: nestedStore,
      ENGINE_SCORECARD_DIR: nestedStore,
    },
  });
  const tier = JSON.parse(tierRun.stdout);
  assert.notStrictEqual(tier.tier, 'T0', `malformed nesting must not resolve T0: ${tier.tier} ${tier.rationale}`);

  // (d) record the formal row; the store projection admits it as provisional + observed qualified.
  const record = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'record'], {
    input: JSON.stringify(row),
    encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: store, ENGINE_CAPABILITY_DIR: store, HOME: tempRoot },
  });
  assert.strictEqual(record.status, 0, `record failed: ${record.stderr}`);
  const current = spawnSync(process.execPath, [path.join(__dirname, 'engine-scorecard.js'), 'current', '--role', 'implementer'], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: store, ENGINE_CAPABILITY_DIR: store, HOME: tempRoot },
  });
  assert.strictEqual(current.status, 0, current.stderr);
  const projected = JSON.parse(current.stdout).find((r) => r.prompt_config_hash === row.prompt_config_hash);
  assert.ok(projected, 'projected implementer row');
  assert.strictEqual(projected.status, 'provisional');
  assert.strictEqual(projected.observed_status, 'qualified');
  assert.strictEqual(projected.authority_status, 'untrusted_telemetry');
  assert.strictEqual(projected.admissible, false);

  // dispatch-contract check: the projected row is admitted as provisional assurance.
  const cfgSrc = fs.readFileSync(path.join(__dirname, '..', 'project-config-template', 'review-loop-config.md'), 'utf8');
  const cfgPath = path.join(tempRoot, 'review-loop-config.md');
  fs.writeFileSync(cfgPath, cfgSrc
    .replace(/^- implementer_engine:.*$/m, '- implementer_engine: grok-4.5')
    .replace(/^- implementer_runner:.*$/m, '- implementer_runner: grok'));
  const gateRepo = fs.mkdtempSync(path.join(tempRoot, 'gate-repo-'));
  const gitEnv = {
    ...process.env,
    HOME: tempRoot,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  };
  const g = (args) => {
    const r = spawnSync('git', ['-C', gateRepo, ...args], { encoding: 'utf8', env: gitEnv });
    assert.strictEqual(r.status, 0, r.stderr);
  };
  g(['init', '--quiet', '-b', 'main']);
  fs.mkdirSync(path.join(gateRepo, 'docs', 'plans'), { recursive: true });
  fs.writeFileSync(path.join(gateRepo, 'docs', 'plans', 'spec.md'), '## Unit spec\nStable body\n');
  fs.mkdirSync(path.join(gateRepo, '.claude'), { recursive: true });
  fs.copyFileSync(cfgPath, path.join(gateRepo, '.claude', 'review-loop-config.md'));
  g(['add', '-A']);
  g(['commit', '--quiet', '-m', 'base']);
  fs.appendFileSync(path.join(gateRepo, 'docs', 'plans', 'spec.md'), 'more\n');
  g(['add', '-A']);
  g(['commit', '--quiet', '-m', 'spec']);
  const baseSha = spawnSync('git', ['-C', gateRepo, 'rev-parse', 'HEAD'], { encoding: 'utf8', env: gitEnv }).stdout.trim();
  const depSha = spawnSync('git', ['-C', gateRepo, 'rev-parse', 'HEAD~1'], { encoding: 'utf8', env: gitEnv }).stdout.trim();
  const contractPath = path.join(tempRoot, 'gate-contract.json');
  fs.writeFileSync(contractPath, JSON.stringify({
    schema: 1,
    unit_id: 'bl0037-impl-row',
    role: 'implementer',
    goal: 'fixture',
    spec: { path: 'docs/plans/spec.md', section: 'Unit spec' },
    base_sha: baseSha,
    depends_on: [depSha],
    scope: { allow_paths: ['done.txt'], deny_paths: ['secret/**'], max_files: 2, max_diff_lines: 50 },
    go: { required_paths: ['docs/plans/spec.md'], required_engine_role: 'implementer', required_red_command: ['bash', '-n', 'docs/plans/spec.md'] },
    no_go: {
      on_missing_spec: 'stop', on_dirty_base: 'stop', on_unknown_engine: 'stop', on_quota_unavailable: 'stop',
      on_scope_violation: 'stop', on_budget_exceeded: 'stop', on_clarification_needed: 'stop',
      forbidden_actions: ['push', 'merge', 'network', 'dependency-change'],
    },
    output: { kind: 'commit', paths: ['done.txt'] },
    acceptance: [{ argv: ['true'], exit: 0 }],
    budget: { wall_seconds: 120, max_attempts: 1, max_context_files: 4 },
  }));
  const capEvent = path.join(tempRoot, 'cap-event.json');
  fs.writeFileSync(capEvent, JSON.stringify({
    schema_version: 1,
    observed_at: new Date().toISOString(),
    runner: 'grok',
    model: 'grok-4.5',
    role: 'implementer',
    effort: 'high',
    endpoint: null,
    runner_version: '1.0.5',
    capability: { quota: { status: 'available', confidence: 'high', ttl_seconds: 3600, reset_at: null, evidence: 'test' } },
  }));
  const capRec = spawnSync(process.execPath, [path.join(__dirname, 'engine-capability-state.js'), 'record', '--file', capEvent], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_CAPABILITY_DIR: store, HOME: tempRoot },
  });
  assert.strictEqual(capRec.status, 0, `capability record: ${capRec.stderr}`);
  const gate = spawnSync(process.execPath, [
    path.join(__dirname, 'dispatch-contract.js'), 'check', '--contract', contractPath, '--repo', gateRepo, '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: store, ENGINE_CAPABILITY_DIR: store, HOME: tempRoot },
  });
  const gateJson = lastJsonLine(gate.stdout);
  assert.ok(gateJson, `dispatch-contract produced no JSON: ${gate.stdout}\n${gate.stderr}`);
  assert.strictEqual(gateJson.verdict, 'GO', `reasons: ${JSON.stringify(gateJson.reasons)}`);
  assert.strictEqual(gateJson.assurance, 'provisional');
  const emptyScores = fs.mkdtempSync(path.join(tempRoot, 'empty-scores-'));
  const gateNeg = spawnSync(process.execPath, [
    path.join(__dirname, 'dispatch-contract.js'), 'check', '--contract', contractPath, '--repo', gateRepo, '--json',
  ], {
    encoding: 'utf8',
    env: { ...process.env, ENGINE_SCORECARD_DIR: emptyScores, ENGINE_CAPABILITY_DIR: store, HOME: tempRoot },
  });
  const gateNegJson = lastJsonLine(gateNeg.stdout);
  assert.ok(gateNegJson, 'negative control still returns a verdict JSON');
  assert.notStrictEqual(gateNegJson.verdict, 'GO', 'an empty scorecard must not admit the formal row');
  assert.notStrictEqual(gateNegJson.assurance, 'provisional');

  // (e) review-loop density takes the untrusted/unknown upward branch, not verify_first.
  const loop = spawnSync('bash', [
    path.join(__dirname, 'resolve-review-loop.sh'), '--scale-by-capability', '--field', 'verify_first',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempRoot,
      REVIEW_LOOP_CONFIG_OVERRIDE: cfgPath,
      ENGINE_SCORECARD_DIR: store,
      ENGINE_CAPABILITY_DIR: store,
    },
  });
  assert.strictEqual(loop.stdout.trim(), 'false', `verify_first on the formal row: ${loop.stdout} ${loop.stderr}`);
  const tierField = spawnSync('bash', [
    path.join(__dirname, 'resolve-review-loop.sh'), '--scale-by-capability', '--field', 'capability_tier',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempRoot,
      REVIEW_LOOP_CONFIG_OVERRIDE: cfgPath,
      ENGINE_SCORECARD_DIR: store,
      ENGINE_CAPABILITY_DIR: store,
    },
  });
  assert.strictEqual(tierField.stdout.trim(), 'unknown', `density tier: ${tierField.stdout} ${tierField.stderr}`);

  // Negative: a failed projection takes the low branch, still not verify_first.
  const failedStore = fs.mkdtempSync(path.join(tempRoot, 'store-failed-'));
  const failedRow = JSON.parse(fs.readFileSync(path.join(store, 'scorecard.jsonl'), 'utf8').trim().split('\n').pop());
  delete failedRow.evidence;
  failedRow.status = 'failed';
  failedRow.capability_score = 0;
  failedRow.quality = { ...failedRow.quality, corpus_pass: '0/24' };
  fs.writeFileSync(path.join(failedStore, 'scorecard.jsonl'), `${JSON.stringify(failedRow)}\n`);
  const low = spawnSync('bash', [
    path.join(__dirname, 'resolve-review-loop.sh'), '--scale-by-capability', '--field', 'capability_tier',
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tempRoot,
      REVIEW_LOOP_CONFIG_OVERRIDE: cfgPath,
      ENGINE_SCORECARD_DIR: failedStore,
      ENGINE_CAPABILITY_DIR: failedStore,
    },
  });
  assert.strictEqual(low.stdout.trim(), 'low', `failed row density branch: ${low.stdout} ${low.stderr}`);
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

// RED at e3671eb0c: test "--help states the --seat-file source precedence" fails with AssertionError 'help has a "Source precedence" paragraph' (actual false, expected true).
// BL-0265: --help states which source wins when a --seat-file run fills an identity field.
// Control: with the precedence paragraph removed from the help text this test is red.
test('--help states the --seat-file source precedence', () => {
  const run = spawnSync('node', [path.join(__dirname, 'engine-qualify.js'), '--help'], {
    encoding: 'utf8', stdin: 'ignore', env: { PATH: process.env.PATH, HOME: tempRoot },
  });
  assert.strictEqual(run.status, 0);
  const text = `${run.stdout}${run.stderr}`;
  const at = text.indexOf('Source precedence');
  assert.ok(at >= 0, 'help has a "Source precedence" paragraph');
  const para = text.slice(at, at + 1400);
  assert.match(para, /disagree[^.]*exits 2/s, 'seat identity fields: a disagreeing flag exits 2');
  assert.match(para, /flag[^]*derived[^]*pins/s, 'flag > derived > pins order stated');
});
