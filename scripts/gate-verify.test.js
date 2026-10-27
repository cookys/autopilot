'use strict';
// node --test scripts/gate-verify.test.js
//
// Controls of plan docs/plans/2026-10-26-depth0-per-turn-gate.md section 3.2 (P1).
// Every case below is a function of the verifier script path. The suite runs
// each case against the real script (green), then re-runs the cases that guard
// a defence against a copy of the script with that one defence removed
// (mutation) and requires the case to FAIL (red). The red assertion message is
// printed as "RED(<defence>) <case>: <message>" so the red run is on record.
// A mutation whose `from` text no longer matches exactly once fails the suite,
// so a refactor cannot leave a control pointing at nothing.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const REAL = path.join(__dirname, 'gate-verify.js');
const SCHEMA = path.join(__dirname, '..', 'schemas', 'gate-rules.schema.json');
const GV = require('./gate-verify.js');

// ---------------------------------------------------------------- fixtures

const dirs = [];
function mk(prefix) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}
test.after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

function cleanEnv(extra) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('GIT_')) delete env[k];
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.AUTOPILOT_GATE_FILE;
  return Object.assign(env, extra || {});
}

function git(dir, ...a) {
  return cp.execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a],
    { cwd: dir, env: cleanEnv(), stdio: 'pipe' }).toString().trim();
}

const HELPER = "exports.bad = (f) => require('fs').readFileSync(f, 'utf8').includes('BAD');\n";
const XTEST = "const path = require('path');\nconst { bad } = require('./helper.js');\n"
  + "if (bad(path.join(process.env.AUTOPILOT_GATE_REPO, 'src/app.js'))) { process.stderr.write('app.js is BAD'); process.exit(1); }\n";
const ENVPROBE = "if (process.env.GATE_SECRET !== undefined) { process.stderr.write('secret leaked'); process.exit(1); }\n"
  + "const repo = process.env.AUTOPILOT_GATE_REPO;\n"
  + "if (!repo) { process.stderr.write('no repo env'); process.exit(1); }\n"
  + "if (process.cwd().startsWith(repo)) { process.stderr.write('cwd in worker tree'); process.exit(1); }\n";
const SLOW = 'setTimeout(() => process.exit(0), 4000);\n';
const SMOKE = "const fs = require('fs'); const path = require('path');\n"
  + "if (!fs.existsSync(path.join(process.env.AUTOPILOT_GATE_REPO, 'src/login.txt'))) { process.stderr.write('no login'); process.exit(1); }\n";

const REGISTRY = {
  v: 1,
  checks: {
    'unit-tests': { argv: ['node', 'x.test.js'], files: ['x.test.js', 'helper.js'], timeout_s: 20 },
    envprobe: { argv: ['node', 'envprobe.js'], files: ['envprobe.js'], timeout_s: 20 },
    slow: { argv: ['node', 'slow.js'], files: ['slow.js'], timeout_s: 1 },
    'login-smoke': { argv: ['node', 'smoke.js'], files: ['smoke.js'], timeout_s: 20 },
  },
};

function makeRepo(over) {
  const dir = mk('gv-repo-');
  const aux = mk('gv-aux-');
  const files = Object.assign({
    'src/api.js': 'export function listUsers() {}\n',
    'src/app.js': 'module.exports = 1;\n',
    'src/legacy/old.js': '// legacy\n',
    'x.test.js': XTEST,
    'helper.js': HELPER,
    'envprobe.js': ENVPROBE,
    'slow.js': SLOW,
    'smoke.js': SMOKE,
    'evil.js': 'process.exit(0);\n',
    '.claude/gate-checks.json': JSON.stringify(REGISTRY),
  }, over || {});
  git(dir, 'init', '-q');
  for (const [rel, text] of Object.entries(files)) {
    if (text === null) continue;
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return { dir, aux, base: git(dir, 'rev-parse', 'HEAD') };
}

function write(ctx, rel, text) {
  fs.mkdirSync(path.dirname(path.join(ctx.dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(ctx.dir, rel), text);
}

let seq = 0;
// Runs the verifier. rules: object (written to a file outside the repo).
function run(S, ctx, rules, o) {
  o = o || {};
  const rf = path.join(ctx.aux, 'rules-' + (seq++) + '.json');
  fs.writeFileSync(rf, typeof rules === 'string' ? rules : JSON.stringify(rules));
  const args = [S];
  if (o.check) args.push('--check');
  else args.push('--turn', '1');
  args.push('--repo', ctx.dir, '--rules', rf, '--base', o.base || ctx.base, '--json');
  if (o.mode) args.push('--mode', o.mode);
  const r = cp.spawnSync(process.execPath, args, { env: cleanEnv(o.env), encoding: 'utf8', timeout: 60000 });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch (e) { /* keep null */ }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}

const L = (rules) => Object.assign({ v: 1 }, rules);
const CLEAN_RULES = L({
  forbid_paths: [{ id: 'R1', glob: 'src/legacy/**', why: 'frozen module' }],
  require_files: [{ id: 'R2', path: 'src/api.js' }],
  require_text: [{ id: 'R3', path: 'src/api.js', text: 'export function listUsers' }],
  forbid_text: [{ id: 'R4', glob: 'src/**/*.js', text: 'console.log' }],
  must_pass: [{ id: 'R5', check: 'unit-tests' }],
  features: [{ id: 'F1', check: 'js-syntax', label: 'syntax ok' }],
});

function viol(res, id) { return (res.out && res.out.violations || []).filter((v) => v.constraint === id); }
function expectViolation(res, id, evidenceRe) {
  assert.strictEqual(res.status, 1, 'exit 1 expected, got ' + res.status + ' stderr=' + res.stderr + ' out=' + res.stdout);
  const v = viol(res, id);
  assert.ok(v.length >= 1, 'violation ' + id + ' expected in ' + res.stdout);
  if (evidenceRe) assert.match(v[0].evidence, evidenceRe);
  assert.ok(v[0].rule && typeof v[0].rule === 'string');
}
function expectTwo(res, why) {
  assert.strictEqual(res.status, 2, (why || '') + ' exit 2 expected, got ' + res.status + ' out=' + res.stdout + ' err=' + res.stderr);
}
function expectClean(res) {
  assert.strictEqual(res.status, 0, 'exit 0 expected, got ' + res.status + ' out=' + res.stdout + ' err=' + res.stderr);
  assert.deepStrictEqual(res.out, { violations: [], feature_gaps: [] });
}

// ---------------------------------------------------------------- cases

const C = {};

C.clean_fixture_exits_0 = (S) => { expectClean(run(S, makeRepo(), CLEAN_RULES)); };

C.forbid_paths_modified = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /^src\/legacy\/old\.js$/);
};
C.forbid_paths_committed_after_base = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'worker');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /legacy/);
};
C.forbid_paths_untracked = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/new.js', '// new\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R1', /^src\/legacy\/new\.js$/);
};
C.require_files_absent_until_created = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: [{ id: 'R2', path: 'docs/NOTES.md' }] });
  assert.strictEqual(run(S, ctx, rules, { check: true }).status, 0, '--check must accept a target that does not exist yet');
  expectViolation(run(S, ctx, rules), 'R2', /docs\/NOTES\.md/);
  write(ctx, 'docs/NOTES.md', 'notes\n');
  expectClean(run(S, ctx, rules));
};
C.require_text_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/api.js', 'export function other() {}\n');
  const rules = L({ require_text: [{ id: 'R3', path: 'src/api.js', text: 'export function listUsers' }] });
  expectViolation(run(S, ctx, rules), 'R3', /text not found/);
  fs.rmSync(path.join(ctx.dir, 'src/api.js'));
  expectViolation(run(S, ctx, rules), 'R3', /file missing/);
};
C.forbid_text_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'a\nconsole.log(1)\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R4', /^src\/app\.js:2$/);
};
C.must_pass_violation = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, CLEAN_RULES), 'R5', /^exit 1: app\.js is BAD/);
};
C.feature_gap_not_violation = (S) => {
  const ctx = makeRepo();
  const rules = L({ features: [{ id: 'F1', check: 'login-smoke', label: 'login works' }] });
  const r = run(S, ctx, rules);
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.out, { violations: [], feature_gaps: ['F1: login works'] });
  const r2 = run(S, ctx, rules, { mode: 'violations' });
  assert.deepStrictEqual(r2.out, { violations: [], feature_gaps: [] });
  write(ctx, 'src/login.txt', 'x');
  assert.deepStrictEqual(run(S, ctx, rules).out, { violations: [], feature_gaps: [] });
};
C.builtin_conflict_markers = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'a\n<<<<<<< HEAD\nb\n');
  const rules = L({ must_pass: [{ id: 'R5', check: 'no-conflict-markers' }] });
  expectViolation(run(S, ctx, rules), 'R5', /^src\/app\.js:2$/);
};
C.builtin_js_syntax = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'function (\n');
  const rules = L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] });
  expectViolation(run(S, ctx, rules), 'R5', /src\/app\.js/);
};

// exit 2 family
const TWO = {
  dotdot: [L({ require_files: [{ id: 'R2', path: '../x' }] }), L({ require_files: [{ id: 'R2', path: 'a/../b' }] })],
  absolute: [L({ require_files: [{ id: 'R2', path: '/etc/passwd' }] })],
  unknown_key: [L({ bogus: [] })],
  unknown_entry_key: [L({ require_files: [{ id: 'R2', path: 'a', cmd: 'rm -rf /' }] })],
  dup_id: [L({ require_files: [{ id: 'R2', path: 'a' }, { id: 'R2', path: 'b' }] })],
  rule_41: [L({ require_files: Array.from({ length: 41 }, (_, i) => ({ id: 'R' + i, path: 'f' + i })) })],
  glob_braces: [L({ forbid_paths: [{ id: 'R1', glob: 'src/{a,b}/x.js' }] })],
  glob_class: [L({ forbid_paths: [{ id: 'R1', glob: 'src/[ab].js' }] })],
  glob_partial_globstar: [L({ forbid_paths: [{ id: 'R1', glob: 'src/a**b' }] })],
  unregistered_check: [L({ must_pass: [{ id: 'R5', check: 'no-such-check' }] })],
  bad_version: [{ v: 2 }],
  not_json: ['{nope'],
};
for (const [name, list] of Object.entries(TWO)) {
  C['exit2_' + name] = (S) => {
    const ctx = makeRepo();
    for (const rules of list) {
      const v = run(S, ctx, rules);
      expectTwo(v, name + ' verify');
      assert.strictEqual(v.stdout, '', 'exit 2 prints no verdict on stdout');
      expectTwo(run(S, ctx, rules, { check: true }), name + ' --check');
    }
  };
}
C.exit2_symlink_escape = (S) => {
  const ctx = makeRepo(); const outside = mk('gv-out-');
  fs.symlinkSync(outside, path.join(ctx.dir, 'esc'));
  const rules = L({ require_files: [{ id: 'R2', path: 'esc/x' }] });
  expectTwo(run(S, ctx, rules), 'symlink verify');
  expectTwo(run(S, ctx, rules, { check: true }), 'symlink --check');
  expectTwo(run(S, ctx, L({ forbid_paths: [{ id: 'R1', glob: 'esc/**' }] })), 'symlink glob');
};
C.symlinked_file_outside_is_not_read = (S) => {
  const ctx = makeRepo(); const outside = mk('gv-out-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'console.log hidden\n');
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(ctx.dir, 'src/link.txt'));
  const rules = L({ forbid_text: [{ id: 'R4', glob: 'src/*.txt', text: 'console.log' }] });
  expectClean(run(S, ctx, rules));
};
C.exit2_missing_registry_with_must_pass = (S) => {
  const ctx = makeRepo({ '.claude/gate-checks.json': null });
  const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
  expectTwo(run(S, ctx, rules)); expectTwo(run(S, ctx, rules, { check: true }));
  // built-ins need no registry
  expectClean(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'js-syntax' }] })));
};
C.exit2_files_entry_missing_at_base = (S) => {
  const reg = { v: 1, checks: { 'unit-tests': { argv: ['node', 'x.test.js'], files: ['x.test.js', 'ghost.js'] } } };
  const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify(reg) });
  const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
  expectTwo(run(S, ctx, rules, { check: true }), '--check');
  // only at the working tree, not at base: still missing at base
  write(ctx, 'ghost.js', 'process.exit(0)\n');
  expectTwo(run(S, ctx, rules, { check: true }), '--check with ghost.js in the worker tree');
  expectTwo(run(S, ctx, rules), 'verify');
};
C.exit2_argv_outside_exported_files = (S) => {
  const bads = [
    { argv: ['node', 'evil.js'], files: ['x.test.js'] },
    { argv: ['node', '-e', 'process.exit(0)'], files: ['x.test.js'] },
    { argv: ['/bin/true'], files: ['x.test.js'] },
    { argv: ['node', '/etc/hostname'], files: ['x.test.js'] },
    { argv: ['node', '--eval=process.exit(0)', 'x.test.js'], files: ['x.test.js'] },
  ];
  for (const bad of bads) {
    const ctx = makeRepo({ '.claude/gate-checks.json': JSON.stringify({ v: 1, checks: { 'unit-tests': bad } }) });
    const rules = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
    expectTwo(run(S, ctx, rules, { check: true }), '--check ' + JSON.stringify(bad.argv));
    expectTwo(run(S, ctx, rules), 'verify ' + JSON.stringify(bad.argv));
  }
};
C.exit2_require_text_path_missing_at_base = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_text: [{ id: 'R3', path: 'src/later.js', text: 'x' }] });
  write(ctx, 'src/later.js', 'x');
  expectTwo(run(S, ctx, rules, { check: true }));
};
C.exit2_base_not_a_commit = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: [{ id: 'R2', path: 'src/api.js' }] });
  expectTwo(run(S, ctx, rules, { base: 'a'.repeat(40) }));
  expectTwo(run(S, ctx, rules, { base: 'HEAD' }));
};
C.rule_40_is_allowed = (S) => {
  const ctx = makeRepo();
  const rules = L({ require_files: Array.from({ length: 40 }, (_, i) => ({ id: 'R' + i, path: 'src/api.js' })) });
  expectClean(run(S, ctx, rules));
};

// worker rewrites its own check
const MUST = L({ must_pass: [{ id: 'R5', check: 'unit-tests' }] });
C.worker_rewrites_test_to_pass = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  write(ctx, 'x.test.js', 'process.exit(0);\n'); // worker makes the check exit 0
  write(ctx, 'helper.js', 'exports.bad = () => false;\n');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_rewrites_test_to_fail = (S) => {
  const ctx = makeRepo(); // product is fine; worker makes the check exit 1
  write(ctx, 'x.test.js', 'process.exit(1);\n');
  expectClean(run(S, ctx, MUST));
};
C.worker_rewrites_test_and_commits = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n'); write(ctx, 'x.test.js', 'process.exit(0);\n');
  git(ctx.dir, 'add', '-A'); git(ctx.dir, 'commit', '-q', '-m', 'worker');
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_rewrites_registry = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/app.js', 'BAD\n');
  const evil = { v: 1, checks: { 'unit-tests': { argv: ['node', 'evil.js'], files: ['evil.js'] } } };
  write(ctx, '.claude/gate-checks.json', JSON.stringify(evil));
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
  fs.rmSync(path.join(ctx.dir, '.claude/gate-checks.json'));
  expectViolation(run(S, ctx, MUST), 'R5', /app\.js is BAD/);
};
C.worker_registry_cannot_add_check = (S) => {
  const ctx = makeRepo();
  const reg = JSON.parse(JSON.stringify(REGISTRY)); reg.checks.mine = { argv: ['node', 'evil.js'], files: ['evil.js'] };
  write(ctx, '.claude/gate-checks.json', JSON.stringify(reg));
  expectTwo(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'mine' }] })));
};

// execution environment of a registered check
C.check_runs_scrubbed_in_temp_dir = (S) => {
  const ctx = makeRepo();
  const r = run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'envprobe' }] }), { env: { GATE_SECRET: 'hunter2' } });
  expectClean(r);
};
C.temp_dir_removed = (S) => {
  const ctx = makeRepo(); const t = mk('gv-tmp-');
  expectClean(run(S, ctx, MUST, { env: { TMPDIR: t } }));
  assert.deepStrictEqual(fs.readdirSync(t), [], 'temp dir left behind after a clean run');
  write(ctx, 'src/app.js', 'BAD\n');
  expectViolation(run(S, ctx, MUST, { env: { TMPDIR: t } }), 'R5');
  assert.deepStrictEqual(fs.readdirSync(t), [], 'temp dir left behind after a failing run');
};
C.check_hard_timeout = (S) => {
  const ctx = makeRepo();
  const t0 = Date.now();
  expectViolation(run(S, ctx, L({ must_pass: [{ id: 'R5', check: 'slow' }] })), 'R5', /^timeout after 1s/);
  assert.ok(Date.now() - t0 < 3500, 'timeout did not cut the run short');
};

// gate-file envelope (hook passes it through AUTOPILOT_GATE_FILE)
function gateFile(ctx, over) {
  const g = Object.assign({
    v: 1, repo: ctx.dir, base: ctx.base, mode: 'violations+features', max_blocks: 2,
    expires_at: new Date(Date.now() + 3600e3).toISOString(), rules: CLEAN_RULES,
  }, over || {});
  const f = path.join(ctx.aux, 'gate-' + (seq++) + '.json');
  fs.writeFileSync(f, JSON.stringify(g));
  return f;
}
function runGate(S, ctx, gf, viaEnv) {
  const args = [S, '--turn', '2', '--repo', ctx.dir, '--json'];
  const env = cleanEnv(viaEnv ? { AUTOPILOT_GATE_FILE: gf } : {});
  if (!viaEnv) args.push('--gate-file', gf);
  const r = cp.spawnSync(process.execPath, args, { env, encoding: 'utf8', timeout: 60000 });
  let out = null; try { out = JSON.parse(r.stdout); } catch (e) { /* null */ }
  return { status: r.status, out, stdout: r.stdout, stderr: r.stderr };
}
C.gate_file_valid_and_env_var = (S) => {
  const ctx = makeRepo(); write(ctx, 'src/legacy/old.js', '// touched\n');
  const gf = gateFile(ctx);
  expectViolation(runGate(S, ctx, gf, false), 'R1');
  expectViolation(runGate(S, ctx, gf, true), 'R1');
  const clean = makeRepo();
  expectClean(runGate(S, clean, gateFile(clean), true));
};
C.gate_file_repo_mismatch = (S) => {
  const ctx = makeRepo(); const other = makeRepo();
  expectTwo(runGate(S, ctx, gateFile(ctx, { repo: other.dir }), false));
};
C.gate_file_bad_fields = (S) => {
  const ctx = makeRepo();
  for (const over of [{ max_blocks: 3 }, { mode: 'all' }, { base: 'abc' }, { v: 2 }, { extra: 1 }, { expires_at: 'soon' }]) {
    expectTwo(runGate(S, ctx, gateFile(ctx, over), false), JSON.stringify(over));
  }
};
C.gate_file_mode_violations_hides_features = (S) => {
  const ctx = makeRepo();
  const rules = L({ features: [{ id: 'F1', check: 'login-smoke', label: 'login works' }] });
  const a = runGate(S, ctx, gateFile(ctx, { rules, mode: 'violations' }), false);
  assert.deepStrictEqual(a.out.feature_gaps, []);
  const b = runGate(S, ctx, gateFile(ctx, { rules, mode: 'violations+features' }), false);
  assert.deepStrictEqual(b.out.feature_gaps, ['F1: login works']);
};

// ---------------------------------------------------------------- green run

for (const [name, fn] of Object.entries(C)) {
  test('green: ' + name, () => fn(REAL));
}

test('green: --check writes nothing and uses no temp dir', () => {
  const ctx = makeRepo(); const t = mk('gv-tmp-');
  const r = run(REAL, ctx, CLEAN_RULES, { check: true, env: { TMPDIR: t } });
  assert.strictEqual(r.status, 0);
  assert.deepStrictEqual(r.out, { ok: true, errors: [] });
  assert.strictEqual(git(ctx.dir, 'status', '--porcelain'), '');
  assert.deepStrictEqual(fs.readdirSync(t), []);
});

test('green: cli errors exit 2', () => {
  const ctx = makeRepo();
  const sp = (...a) => cp.spawnSync(process.execPath, [REAL, ...a], { env: cleanEnv(), encoding: 'utf8' });
  assert.strictEqual(sp('--bogus').status, 2);
  assert.strictEqual(sp('--repo', ctx.dir, '--json').status, 2); // no rule list
  assert.strictEqual(sp('--turn', 'x', '--repo', ctx.dir, '--rules', '/nonexistent', '--base', ctx.base).status, 2);
  assert.strictEqual(sp('--repo', mk('gv-nogit-'), '--rules', '/nonexistent', '--base', ctx.base).status, 2);
});

test('green: glob matcher subset', () => {
  const m = GV.matchGlob;
  assert.ok(m('src/legacy/**', 'src/legacy/a/b.js'));
  assert.ok(m('src/legacy/**', 'src/legacy'));
  assert.ok(!m('src/legacy/**', 'src/legacyx/a.js'));
  assert.ok(m('src/**/*.js', 'src/a.js'));
  assert.ok(m('src/**/*.js', 'src/a/b/c.js'));
  assert.ok(!m('src/*.js', 'src/a/b.js'));
  assert.ok(m('a?c', 'abc'));
  assert.ok(!m('a?c', 'ac'));
  assert.ok(!m('a?c', 'a/c'));
  assert.ok(!m('SRC/*.js', 'src/a.js'), 'case-sensitive');
  assert.ok(m('*', 'x') && !m('*', 'x/y'));
});

test('green: schema file matches the validator vocabulary', () => {
  assert.doesNotThrow(() => compareSchema(JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))));
});

function compareSchema(schema) {
  assert.deepStrictEqual(Object.keys(schema.properties).sort(), GV.RULE_KEYS.slice().sort());
  const defFor = { forbid_paths: 'forbidPath', require_files: 'requireFile', require_text: 'requireText', forbid_text: 'forbidText', must_pass: 'mustPass', features: 'feature' };
  for (const [kind, spec] of Object.entries(GV.KIND_FIELDS)) {
    const def = schema.$defs[defFor[kind]];
    assert.deepStrictEqual(Object.keys(def.properties).sort(), spec.req.concat(spec.opt).sort(), kind);
    assert.deepStrictEqual(def.required.slice().sort(), spec.req.slice().sort(), kind + ' required');
    assert.strictEqual(def.additionalProperties, false);
  }
}

// ---------------------------------------------------------------- red run (mutations)

const DEAD_CASES = ['forbid_paths_modified', 'require_files_absent_until_created', 'require_text_violation',
  'forbid_text_violation', 'must_pass_violation'];

const MUTATIONS = [
  { defence: 'dead-verifier-exit-code', from: 'return result.violations.length > 0 ? 1 : 0;', to: 'return 0;', cases: DEAD_CASES },
  { defence: 'dead-verifier-no-evaluation', from: 'const result = evaluate(prep, input, repoReal, repoReal);', to: 'const result = { violations: [], feature_gaps: [] };', cases: DEAD_CASES },
  { defence: 'forbid_paths-base-fixed', from: "'--relative', base, '--']", to: "'--relative', 'HEAD', '--']", cases: ['forbid_paths_committed_after_base'] },
  { defence: 'forbid_paths-untracked-union', from: 'return Array.from(new Set(diff.concat(untracked)));', to: 'return Array.from(new Set(diff.concat([])));', cases: ['forbid_paths_untracked'] },
  { defence: 'path-dotdot', from: "if (p.split('/').includes('..')) return { error: 'contains a .. segment' };", to: '', cases: ['exit2_dotdot'] },
  { defence: 'path-absolute', from: "if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) return { error: 'absolute path' };", to: '', cases: ['exit2_absolute'] },
  { defence: 'path-symlink-containment', from: 'if (!containedInRepo(literalPrefix(n.norm, isGlob), repoReal)) {', to: 'if (false) {', cases: ['exit2_symlink_escape'] },
  { defence: 'read-symlink-containment', from: 'if (!inside(real, repoReal)) return null;', to: '', cases: ['symlinked_file_outside_is_not_read'] },
  { defence: 'rule-unknown-key', from: "if (!RULE_KEYS.includes(k)) errs.push('unknown key: ' + k);", to: '', cases: ['exit2_unknown_key'] },
  { defence: 'rule-unknown-entry-key', from: 'if (!spec.req.includes(k) && !spec.opt.includes(k)) errs.push(', to: 'if (false) errs.push(', cases: ['exit2_unknown_entry_key'] },
  { defence: 'rule-duplicate-id', from: 'else if (ids.has(entry.id))', to: 'else if (false)', cases: ['exit2_dup_id'] },
  { defence: 'rule-cap-40', from: 'if (flat.length > MAX_RULES)', to: 'if (false)', cases: ['exit2_rule_41'] },
  { defence: 'rule-version', from: "if (rules.v !== 1) errs.push('v must be the integer 1');", to: '', cases: ['exit2_bad_version'] },
  { defence: 'glob-subset-metachars', from: 'if (GLOB_BAD.test(norm))', to: 'if (false)', cases: ['exit2_glob_braces', 'exit2_glob_class'] },
  { defence: 'glob-globstar-whole-segment', from: "if (seg.includes('**') && seg !== '**')", to: 'if (false)', cases: ['exit2_glob_partial_globstar'] },
  { defence: 'check-name-registered', from: "else errs.push('unregistered check name: ' + name + (reg ? '' : ' (no registry at base)'));", to: "else out.set(name, { kind: 'builtin', name });", cases: ['exit2_unregistered_check', 'exit2_missing_registry_with_must_pass'] },
  { defence: 'files-exist-at-base', from: 'if (!blobAtBase(repo, base, n.norm)) { errs.push(', to: 'if (false) { errs.push(', cases: ['exit2_files_entry_missing_at_base'] },
  { defence: 'argv-only-exported-files', from: 'if (n.error || !fileSet.has(n.norm)) errs.push(', to: 'if (n.error) errs.push(', cases: ['exit2_argv_outside_exported_files'] },
  { defence: 'argv-no-code-flags', from: 'if (CODE_FLAGS.has(bare) || CODE_FLAG_PREFIXES.some((p) => bare === p))', to: 'if (false)', cases: ['exit2_argv_outside_exported_files'] },
  { defence: 'require_text-exists-at-base', from: "if (f.kind === 'require_text' && f.norm && !blobAtBase(", to: "if (false && !blobAtBase(", cases: ['exit2_require_text_path_missing_at_base'] },
  { defence: 'base-must-be-commit', from: "if (!baseResolves(repo, input.base)) fail('base does not resolve to a commit');", to: '', cases: ['exit2_base_not_a_commit'] },
  { defence: 'registry-from-base', from: "const r = git(repo, ['show', base + ':./.claude/gate-checks.json']);\n  let reg;\n  try { reg = JSON.parse(String(r.stdout)); }",
    to: "let reg;\n  try { reg = JSON.parse(fs.readFileSync(path.join(repo, '.claude/gate-checks.json'), 'utf8')); }",
    cases: ['worker_rewrites_registry', 'worker_registry_cannot_add_check'] },
  { defence: 'base-bytes-execution', from: "const blob = git(repo, ['show', base + ':./' + rel]).stdout;", to: 'const blob = fs.readFileSync(path.join(repoReal, rel));',
    cases: ['worker_rewrites_test_to_pass', 'worker_rewrites_test_to_fail', 'worker_rewrites_test_and_commits'] },
  { defence: 'scrubbed-env', from: 'cwd: tmp, env, stdio', to: 'cwd: tmp, env: process.env, stdio', cases: ['check_runs_scrubbed_in_temp_dir'] },
  { defence: 'run-outside-worker-tree', from: 'cwd: tmp, env, stdio', to: 'cwd: repoReal, env, stdio', cases: ['check_runs_scrubbed_in_temp_dir'] },
  { defence: 'temp-dir-removed', from: 'if (tmp) fs.rmSync(tmp, { recursive: true, force: true });', to: 'void 0;', cases: ['temp_dir_removed'] },
  { defence: 'hard-timeout', from: 'timeout: res.timeoutS * 1000,', to: 'timeout: 60000,', cases: ['check_hard_timeout'] },
  { defence: 'gate-file-repo-binding', from: 'if (real !== repoReal)', to: 'if (false)', cases: ['gate_file_repo_mismatch'] },
  { defence: 'gate-file-max-blocks-cap', from: 'g.max_blocks > 2', to: 'g.max_blocks > 200', cases: ['gate_file_bad_fields'] },
  { defence: 'gate-file-unknown-field', from: "if (!GATE_KEYS.includes(k)) errs.push('unknown gate-file key: ' + k);", to: '', cases: ['gate_file_bad_fields'] },
  { defence: 'mode-violations-skips-features', from: "if (input.mode === 'violations+features') {", to: 'if (true) {', cases: ['gate_file_mode_violations_hides_features', 'feature_gap_not_violation'] },
];

const SRC = fs.readFileSync(REAL, 'utf8');

for (const m of MUTATIONS) {
  test('red: removing ' + m.defence + ' turns ' + m.cases.join(', ') + ' red', () => {
    const occurrences = SRC.split(m.from).length - 1;
    assert.strictEqual(occurrences, 1, 'mutation anchor must appear exactly once, found ' + occurrences);
    const dir = mk('gv-mut-');
    const mutated = path.join(dir, 'gate-verify.js');
    fs.writeFileSync(mutated, SRC.replace(m.from, () => m.to));
    for (const name of m.cases) {
      let msg = null;
      try { C[name](mutated); } catch (e) { msg = String(e.message || e).split('\n')[0].slice(0, 200); }
      assert.ok(msg !== null, 'case ' + name + ' stayed green with ' + m.defence + ' removed: the control guards nothing');
      console.log('RED(' + m.defence + ') ' + name + ': ' + msg);
    }
  });
}

test('red: a schema file that drifts from the validator fails the pin', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  schema.properties.exec = { type: 'array' };
  assert.throws(() => compareSchema(schema));
  const s2 = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  delete s2.$defs.mustPass.properties.check;
  assert.throws(() => compareSchema(s2));
});
