#!/usr/bin/env node
'use strict';
require('./lib/test-git-env'); // drop ambient GIT_DIR & co so fixture git cannot write into the launching repo
/**
 * G37 W5 (plan 8 W5, N9, N20): the eval runners and the shell wrappers go through the account layer.
 * One table; every row runs the REAL runner against the Node claude shim in a tempdir world (fake home with a DECOY credentials
 * file, FAKE- tokens). Per row:
 *   legacy  - no registry: the runner behaves as before (claude sees no alias token; the credentials copy still happens).
 *   active  - registry present: every claude call carries the alias token fingerprint, no ambient credential is reachable,
 *             and no credentials file is copied (a `cp` / fs.copyFileSync logger records every copy of a .credentials.json).
 *   broken  - registry exists but is unusable: non-zero exit and the shim spawn counter is 0 (N9).
 *   mutate  - the row's own account-layer call removed, and (shell rows) the credentials-copy guard removed: the active
 *             assertions must then FAIL (red first, then the real file is green).
 * N20: the run-eval-batch path with a 401 from the shim exits 6; the same path with the auth-stop wiring removed does not.
 * Nothing here reads or writes the real ~/.claude, ~/.config/autopilot or any real credential.
 */
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { makeFixture, R401 } = require('./lib/account-fixtures/shim-install.js');

const REPO = path.resolve(__dirname, '..');
const OK_LINE = '{"type":"result","subtype":"success","is_error":false,"result":"OK"}';

// ---------------------------------------------------------------- layout: a tempdir copy of the repo with symlinks, runners copied (and mutated)
function symlinkSiblings(srcDir, dstDir, skip) {
  for (const name of fs.readdirSync(srcDir)) {
    if (skip.has(name)) continue;
    fs.symlinkSync(path.join(srcDir, name), path.join(dstDir, name));
  }
}
/** files: repo-relative paths to COPY (mutate(rel, text) -> text). Everything else is a symlink into the repo. */
function mkLayout(root, files, mutate) {
  const layout = path.join(root, 'layout');
  fs.mkdirSync(layout);
  const copyTree = new Map(); // dir (relative) -> Set of children that are real
  copyTree.set('', new Set());
  for (const rel of files) {
    const parts = rel.split('/');
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (!copyTree.has(dir)) copyTree.set(dir, new Set());
      copyTree.get(dir).add(parts[i]);
    }
  }
  const build = (rel) => {
    const real = copyTree.get(rel);
    const dst = path.join(layout, rel);
    fs.mkdirSync(dst, { recursive: true });
    symlinkSiblings(path.join(REPO, rel), dst, real);
    for (const child of real) {
      const childRel = rel ? `${rel}/${child}` : child;
      if (copyTree.has(childRel)) build(childRel);
      else {
        let text = fs.readFileSync(path.join(REPO, childRel), 'utf8');
        if (mutate) text = mutate(childRel, text);
        fs.writeFileSync(path.join(layout, childRel), text, { mode: fs.statSync(path.join(REPO, childRel)).mode & 0o777 });
      }
    }
  };
  build('');
  return layout;
}

// ---------------------------------------------------------------- worlds
const PRELOAD = `const fs=require('fs');const o=fs.copyFileSync;fs.copyFileSync=function(s,...r){try{if(String(s).endsWith('.credentials.json'))fs.appendFileSync(process.env.CPLOG,String(s)+'\\n');}catch(_){}return o.call(fs,s,...r);};`;

function world(mode, opts) {
  const fx = makeFixture({ aliases: [{ alias: 'a' }, { alias: 'b' }] });
  const o = opts || {};
  const cpbin = path.join(fx.root, 'cpbin');
  fs.mkdirSync(cpbin);
  const cplog = path.join(fx.root, 'cp.log');
  fs.writeFileSync(cplog, '');
  fs.writeFileSync(path.join(cpbin, 'cp'), '#!/bin/sh\nfor a; do case "$a" in *.credentials.json) echo "$a" >> "$CPLOG";; esac; done\nexec /bin/cp "$@"\n', { mode: 0o755 });
  const preload = path.join(fx.root, 'preload.js');
  fs.writeFileSync(preload, PRELOAD);
  const env = Object.assign({}, fx.env, {
    PATH: `${cpbin}:${fx.env.PATH}`, CPLOG: cplog, NODE_OPTIONS: `--require ${preload}`,
    SKIP_SLASH_PROBE: '1', AUTOPILOT_EVAL_INTEGRATION: '1',
  }, o.env || {});
  if (mode === 'legacy') {
    env.AUTOPILOT_ACCOUNTS_DIR = path.join(fx.root, 'no-such-accounts');
  } else if (mode === 'broken') {
    fs.writeFileSync(fx.regFile, '{ not json', { mode: 0o600 });
  }
  return {
    fx, env, cplog,
    copies() { return fs.readFileSync(cplog, 'utf8').split('\n').filter(Boolean); },
    spawns() { return fx.shim.spawns(); },
    calls() { return fx.shim.calls(); },
    cleanup() { fx.cleanup(); },
  };
}

/** Assertions as data: returns the list of failed expectations (empty = all hold). */
function judge(mode, w, res, spec) {
  const bad = [];
  const calls = w.calls();
  if (mode === 'broken') {
    if (res.status === 0) bad.push('broken registry: runner exited 0');
    if (w.spawns() !== 0) bad.push(`broken registry: ${w.spawns()} spawns`);
    if (w.copies().length) bad.push('broken registry: a credentials file was copied');
    return bad;
  }
  if (mode === 'active') {
    if (calls.length < 1) bad.push('active: the shim saw no call');
    for (const c of calls) {
      if (!c.fp) bad.push('active: a call without the alias token');
      if (!c.account) bad.push('active: a call without AUTOPILOT_ACCOUNT');
      if (c.decoy_read) bad.push('active: an ambient credential was reachable');
    }
    if (w.copies().length) bad.push(`active: credentials copied (${w.copies().length})`);
    return bad;
  }
  // legacy
  if (calls.length < 1) bad.push('legacy: the shim saw no call');
  for (const c of calls) if (c.fp) bad.push('legacy: a call carried an alias token');
  if (spec.legacyCopies && w.copies().length < 1) bad.push('legacy: the credentials copy is gone');
  return bad;
}

// ---------------------------------------------------------------- rows
function runShell(layout, rel, args, w, extra) {
  return spawnSync('bash', [path.join(layout, rel), ...args], Object.assign({ env: w.env, cwd: layout, encoding: 'utf8', timeout: 150000, input: '' }, extra || {}));
}
function runNode(layout, rel, args, w, extra) {
  return spawnSync(process.execPath, [path.join(layout, rel), ...args], Object.assign({ env: w.env, cwd: layout, encoding: 'utf8', timeout: 150000 }, extra || {}));
}

const ORCH = 'evals/orchestration/run-orchestration-eval.sh';
const ROWS = [
  { name: 'run-orchestration-eval', file: ORCH, legacyCopies: true,
    run: (L, w) => runShell(L, ORCH, ['--task', 't1-fix-with-decoy', '--arm', 'off', '--runner', 'cc', '--model', 'm', '--out', path.join(w.fx.root, 'out')], w) },
  { name: 'run-pipeline-bench', file: 'evals/pipeline-bench/run-pipeline-bench.sh', legacyCopies: true,
    run: (L, w) => runShell(L, 'evals/pipeline-bench/run-pipeline-bench.sh', ['--task', 't1-fix-with-decoy', '--arm', 'bare', '--model', 'm', '--out', path.join(w.fx.root, 'out')], w) },
  // NOT wired, on purpose: run-skill-onoff-eval{,-bpack,-fbatch,-fbatch-v2,-gdorm}.sh and run-d0gate-campaign.js are digest-frozen by
  // evals/skill-onoff/prereg/FROZEN.json (and tools/migrate/no-rewrite.json); editing them breaks the preregistered evidence. They
  // still copy the credentials file. The refreeze patch (evals/skill-onoff/prereg/refreeze) makes them fail closed with a registry (case D).
  ...['panel-cmd-claude.sh', 'panel-cmd-contract-claude.sh', 'panel-cmd-syscontract-claude.sh'].map((f) => ({
    name: `reviewer-bench/${f}`, file: `evals/reviewer-bench/${f}`, legacyCopies: false,
    run: (L, w) => {
      const dir = path.join(w.fx.root, 'panel');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'r.md'), '# reviewer\n');
      fs.writeFileSync(path.join(dir, 's.md'), '# spec\n');
      const args = f === 'panel-cmd-claude.sh' ? ['m'] : [path.join(dir, 'r.md'), path.join(dir, 's.md'), 'm'];
      return runShell(L, `evals/reviewer-bench/${f}`, args, Object.assign({}, w, { env: Object.assign({}, w.env, { SYSCONTRACT_REPO_CWD: dir }) }), { input: 'diff --git a b\n' });
    },
  })),
  { name: 'run-trigger-test', file: 'evals/run-trigger-test.sh', legacyCopies: false, prep: (L) => {
    fs.rmSync(path.join(L, 'evals', 'trigger-prompts'), { recursive: true, force: true });
    fs.mkdirSync(path.join(L, 'evals', 'trigger-prompts'));
    fs.writeFileSync(path.join(L, 'evals', 'trigger-prompts', 'should-trigger.txt'), 'dev-flow|start work on a feature\n');
    fs.writeFileSync(path.join(L, 'evals', 'trigger-prompts', 'should-not-trigger.txt'), 'what is the weather\n');
  }, run: (L, w) => runShell(L, 'evals/run-trigger-test.sh', [], Object.assign({}, w, { env: Object.assign({}, w.env, { AUTOPILOT_EVAL_RESULTS_DIR: path.join(w.fx.root, 'trig') }) })) },
  // evals/test-helpers.sh run_skill() is reached through evals/test-behavior.sh (three short claude -p calls, AUTOPILOT_EVAL_INTEGRATION=1).
  { name: 'test-helpers.sh (via test-behavior.sh)', file: 'evals/test-helpers.sh', legacyCopies: false,
    run: (L, w) => runShell(L, 'evals/test-behavior.sh', [], w) },
  { name: 'run-t2-eval', file: 'evals/context-budget-t2/run-t2-eval.js', legacyCopies: false,
    mutateNode: (t) => t.replace('accountActive ? evalAccount.wrap', 'false ? evalAccount.wrap'),
    run: (L, w) => runNode(L, 'evals/context-budget-t2/run-t2-eval.js', ['--runs-on', '1', '--runs-control', '1', '--out', path.join(w.fx.root, 'res.json')],
      Object.assign({}, w, { env: Object.assign({}, w.env, { CLAUDE_EVAL_CONFIG_DIR: path.join(w.fx.root, 'cfg') }) })) },
  { name: 'run-t14-gate-batch', file: 'evals/orchestration/run-t14-gate-batch.js', legacyCopies: true,
    mutateNode: (t) => t.replace('ACCOUNT_ACTIVE = g.state === "active";', 'ACCOUNT_ACTIVE = false;'),
    mutateCopy: (t) => t.replace('if (!ACCOUNT_ACTIVE && process.env.HOME', 'if (process.env.HOME'),
    // the pin is the first output line of `claude --version`; the shim answers OK, or OK-FROM-AMBIENT when an ambient credential is reachable
    run: (L, w) => runNode(L, 'evals/orchestration/run-t14-gate-batch.js', ['--out', path.join(w.fx.root, 'o'), '--pairs', '1', '--pin-version',
      w.env.AUTOPILOT_ACCOUNTS_DIR.endsWith('no-such-accounts') ? OK_LINE.replace('"OK"', '"OK-FROM-AMBIENT"') : OK_LINE], w) },
];

for (const row of ROWS) {
  const isNode = row.file.endsWith('.js');
  const build = (w, mutation) => {
    const L = mkLayout(w.fx.root, [row.file], (rel, text) => {
      if (!mutation) return text;
      if (isNode) return mutation === 'copy-guard' ? row.mutateCopy(text) : (row.mutateNode ? row.mutateNode(text) : text);
      if (mutation === 'no-call') return text.replace(/eval_account_use_path_wrapper "[^"]*"/g, ':').replace('CC_BIN="$EA_WRAP_DIR/claude"', ':');
      if (mutation === 'copy-guard') return text.split('[ "${EVAL_ACCOUNT_ACTIVE:-0}" != "1" ] && ').join('');
      return text;
    });
    if (row.prep) row.prep(L);
    return L;
  };

  test(`N9 ${row.name}: legacy (no registry) is unchanged`, () => {
    const w = world('legacy');
    try {
      const res = row.run(build(w, null), w);
      assert.deepStrictEqual(judge('legacy', w, res, row), [], `${res.stdout}\n${res.stderr}`.slice(-600));
    } finally { w.cleanup(); }
  });

  test(`N9 good: ${row.name}: registry present -> alias token, no credentials copy, no ambient credential`, () => {
    const w = world('active');
    try {
      const res = row.run(build(w, null), w);
      assert.deepStrictEqual(judge('active', w, res, row), [], `${res.stdout}\n${res.stderr}`.slice(-600));
    } finally { w.cleanup(); }
  });

  test(`N9 broken: ${row.name}: registry -> non-zero, spawn counter 0`, () => {
    const w = world('broken');
    try {
      const res = row.run(build(w, null), w);
      assert.deepStrictEqual(judge('broken', w, res, row), [], `${res.stdout}\n${res.stderr}`.slice(-600));
    } finally { w.cleanup(); }
  });

  test(`N9 ${row.name}: helper missing -> exit 2, spawn counter 0, nothing copied (fail closed)`, () => {
    const w = world('active');
    try {
      const helper = isNode ? 'scripts/lib/eval-account.js' : 'scripts/lib/eval-account.sh';
      const L = mkLayout(w.fx.root, [row.file, helper], null);
      fs.unlinkSync(path.join(L, helper));
      if (row.prep) row.prep(L);
      const res = row.run(L, w);
      assert.strictEqual(res.status, 2, `${res.stdout}\n${res.stderr}`.slice(-400));
      assert.strictEqual(w.spawns(), 0);
      assert.deepStrictEqual(w.copies(), []);
      assert.match(res.stderr, /missing/);
    } finally { w.cleanup(); }
  });

  const mutations = isNode ? [...(row.mutateNode ? ['no-call'] : []), ...(row.mutateCopy ? ['copy-guard'] : [])] : (row.legacyCopies ? ['no-call', 'copy-guard'] : ['no-call']);
  for (const m of mutations) {
    test(`N9 mutation: ${row.name}: ${m} turns the active assertions red`, () => {
      const w = world('active');
      try {
        const res = row.run(build(w, m), w);
        const bad = judge('active', w, res, row);
        assert.ok(bad.length > 0, `mutation ${m} was not caught`);
      } finally { w.cleanup(); }
    });
  }
}

// ---------------------------------------------------------------- D: the refreeze patch applies cleanly and fails closed
test('D the refreeze patch applies cleanly to the frozen runners (git apply --check)', () => {
  const patch = path.join(REPO, 'evals', 'skill-onoff', 'prereg', 'refreeze', 'g37-account-wiring.patch');
  const r = spawnSync('git', ['apply', '--check', patch], { cwd: REPO, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const txt = fs.readFileSync(patch, 'utf8');
  assert.ok(!/\[ -r "\$_EA_LIB" \] && \./.test(txt), 'a fail-open "[ -r lib ] && . lib" line is back in the patch');
});

// ---------------------------------------------------------------- C: a forged AUTOPILOT_ACCOUNT never skips the account layer
// The marker alone used to make the shell front skip its wrap, so any exported value let a runner spawn claude on ambient credentials.
const FORGED = 'forged-alias';
const SH_ROWS = ROWS.filter((r) => !r.file.endsWith('.js') && r.name !== 'run-trigger-test' && !r.name.startsWith('test-helpers'));
for (const row of SH_ROWS) {
  test(`C ${row.name}: a forged AUTOPILOT_ACCOUNT still goes through the account layer (alias token, decoy unread)`, () => {
    const w = world('active', { env: { AUTOPILOT_ACCOUNT: FORGED } });
    try {
      const L = mkLayout(w.fx.root, [row.file], null);
      if (row.prep) row.prep(L);
      const res = row.run(L, w);
      assert.deepStrictEqual(judge('active', w, res, row), [], `${res.stdout}\n${res.stderr}`.slice(-600));
      for (const c of w.calls()) assert.notStrictEqual(c.account, FORGED, 'the shim saw the forged alias, not a registry alias');
    } finally { w.cleanup(); }
  });
}
test('C negative control: with the marker-only exemption put back, a forged AUTOPILOT_ACCOUNT is caught (judge red)', () => {
  const row = SH_ROWS[0];
  const helper = 'scripts/lib/eval-account.sh';
  const w = world('active', { env: { AUTOPILOT_ACCOUNT: FORGED } });
  try {
    const L = mkLayout(w.fx.root, [row.file, helper], (rel, text) => (rel === helper
      ? text.replace('if [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ]; then\n    EXTRA_ARGS', 'if [ "${EVAL_ACCOUNT_ACTIVE:-0}" = 1 ] && [ -z "${AUTOPILOT_ACCOUNT:-}" ]; then\n    EXTRA_ARGS') : text));
    assert.match(fs.readFileSync(path.join(L, helper), 'utf8'), /-z "\$\{AUTOPILOT_ACCOUNT:-\}"/, 'the mutation did not apply');
    const res = row.run(L, w);
    assert.ok(judge('active', w, res, row).length > 0, 'the exemption was not caught');
  } finally { w.cleanup(); }
});
test('C the installed wrapper refuses to start when EVAL_ACCOUNT_SH is empty or unreadable (nothing spawned)', () => {
  const w = world('active');
  try {
    const helper = path.join(REPO, 'scripts', 'lib', 'eval-account.sh');
    for (const sh of ['', path.join(w.fx.root, 'no-such-helper.sh')]) {
      const dir = path.join(w.fx.root, 'wrapdir');
      const inst = spawnSync('bash', ['-c', `. "${helper}" && eval_account_install_wrapper "$1"`, '_', dir], { env: w.env, encoding: 'utf8' });
      assert.strictEqual(inst.status, 0, inst.stderr);
      const res = spawnSync(path.join(dir, 'claude'), ['-p', 'x'], { env: Object.assign({}, w.env, { EVAL_ACCOUNT_SH: sh }), encoding: 'utf8' });
      assert.strictEqual(res.status, 2, `${res.stdout}${res.stderr}`);
      assert.strictEqual(w.spawns(), 0);
    }
  } finally { w.cleanup(); }
});

// ---------------------------------------------------------------- F: the reviewer-bench panels keep the claude they resolved
// The panel resolves claude to an absolute path, then cd's to a scratch dir. A wrapper that searched PATH again lost a relative PATH
// entry (or picked another claude). The wrapper now carries the resolved binary.
const PANEL_ROWS = ROWS.filter((r) => r.name.startsWith('reviewer-bench/'));
function panelWithRelativePath(row, mutate) {
  const w = world('active');
  try {
    const L = mkLayout(w.fx.root, [row.file, 'scripts/lib/eval-account.sh'], mutate || null);
    fs.mkdirSync(path.join(L, 'relbin'));
    fs.symlinkSync(w.fx.shim.shimPath, path.join(L, 'relbin', 'claude'));
    const w2 = Object.assign({}, w, { env: Object.assign({}, w.env, { PATH: `relbin:${path.dirname(process.execPath)}:/usr/bin:/bin` }) });
    const res = row.run(L, w2);
    return { bad: judge('active', w, res, row), res, spawns: w.spawns() };
  } finally { w.cleanup(); }
}
for (const row of PANEL_ROWS) {
  test(`F ${row.name}: active mode runs the resolved claude even when it is only on a relative PATH entry`, () => {
    const r = panelWithRelativePath(row);
    assert.deepStrictEqual(r.bad, [], `${r.res.stdout}\n${r.res.stderr}`.slice(-600));
    assert.ok(r.spawns >= 1);
  });
  test(`F negative control ${row.name}: without the resolved binary handed to the wrapper the fake is not reached`, () => {
    const r = panelWithRelativePath(row, (rel, text) => text.replace('"$EA_WRAP_DIR" "$CC_BIN" || exit $?', '"$EA_WRAP_DIR"'));
    assert.ok(r.bad.length > 0, 'the mutation was not caught');
  });
}

// ---------------------------------------------------------------- run-eval-batch (A9) and N20
const EB = 'scripts/run-eval-batch.sh';
function ebWorld(mode, shimCtl) {
  const w = world(mode);
  const home = w.fx.realHome;
  fs.mkdirSync(path.join(home, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'skill-creator', 'skills', 'skill-creator'), { recursive: true });
  if (shimCtl) w.fx.shim.setControl(shimCtl(w.fx));
  return w;
}
function ebLayout(w, mutate, extra) {
  const L = mkLayout(w.fx.root, [EB, ...(extra || [])], mutate);
  for (const d of ['skills', 'skill-creator-workspace']) { try { fs.unlinkSync(path.join(L, d)); } catch (_) { /* absent */ } }
  fs.mkdirSync(path.join(L, 'skills', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(L, 'skills', 'beta'), { recursive: true });
  fs.mkdirSync(path.join(L, 'skill-creator-workspace', 'evals'), { recursive: true });
  for (const s of ['alpha', 'beta']) fs.writeFileSync(path.join(L, 'skill-creator-workspace', 'evals', `${s}-evals.json`), '[]');
  const fake = path.join(L, 'fake-run-eval');
  fs.writeFileSync(fake, `#!/bin/sh\nclaude -p q --model m >/dev/null 2>&1\necho '{"summary":{"passed":1,"total":1}}'\n`, { mode: 0o755 });
  return L;
}
function ebRun(L, w) {
  return spawnSync('bash', [path.join(L, EB)], { env: Object.assign({}, w.env, { RUN_EVAL_CMD: `sh ${path.join(L, 'fake-run-eval')}` }), cwd: L, encoding: 'utf8', timeout: 150000, input: '' });
}

test('N9 run-eval-batch: legacy / registry / broken / mutation', () => {
  let w = ebWorld('legacy');
  try {
    const res = ebRun(ebLayout(w), w);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(judge('legacy', w, res, {}), [], res.stderr);
  } finally { w.cleanup(); }
  w = ebWorld('active');
  try {
    const res = ebRun(ebLayout(w), w);
    assert.strictEqual(res.status, 0, res.stderr);
    assert.deepStrictEqual(judge('active', w, res, {}), [], res.stderr);
    assert.strictEqual(w.calls().length, 2, 'one claude call per skill');
  } finally { w.cleanup(); }
  w = ebWorld('broken');
  try {
    const res = ebRun(ebLayout(w), w);
    assert.deepStrictEqual(judge('broken', w, res, {}), [], res.stderr);
  } finally { w.cleanup(); }
  w = ebWorld('active');
  try {
    const res = ebRun(ebLayout(w, (rel, t) => t.replace('eval_account_wrap_claude', ':')), w);
    assert.ok(judge('active', w, res, {}).length > 0, 'removing the wrapper wiring was not caught');
  } finally { w.cleanup(); }
});

test('N9 run-eval-batch / run-skill-opt: helper missing -> exit 2, spawn counter 0', () => {
  let w = ebWorld('active');
  try {
    const L = ebLayout(w, null, ['scripts/lib/eval-account.sh']);
    fs.unlinkSync(path.join(L, 'scripts', 'lib', 'eval-account.sh'));
    const res = ebRun(L, w);
    assert.strictEqual(res.status, 2, res.stderr);
    assert.strictEqual(w.spawns(), 0);
  } finally { w.cleanup(); }
  const so = soWorld('active');
  try {
    const L = soLayout(so.w, null, ['scripts/lib/eval-account.sh']);
    fs.unlinkSync(path.join(L, 'scripts', 'lib', 'eval-account.sh'));
    const res = soRun(L, so.w);
    assert.strictEqual(res.status, 2, res.stderr);
    assert.strictEqual(so.w.spawns(), 0);
  } finally { so.w.cleanup(); }
});

test('N20 run-eval-batch via the shim with a 401 exits 6 (registry present); wiring removed -> not 6', () => {
  const ctl = (fx) => ({ default: R401, tokens: {} });
  let w = ebWorld('active', ctl);
  try {
    const res = ebRun(ebLayout(w), w);
    assert.strictEqual(res.status, 6, `${res.stdout}\n${res.stderr}`.slice(-500));
    assert.match(res.stderr + res.stdout, /STOP_AUTH/);
    assert.strictEqual(w.calls().length, 1, 'the batch stops at the first authentication failure');
  } finally { w.cleanup(); }
  w = ebWorld('active', ctl);
  try {
    const mutated = (rel, t) => t.replace('claude_capture_judge "$skill/" --final || auth_hit=1', 'true').replace('auth_stop_check "$skill"', ': "$skill"');
    const res = ebRun(ebLayout(w, mutated), w);
    assert.notStrictEqual(res.status, 6, 'with the auth-stop wiring removed the batch must not exit 6');
  } finally { w.cleanup(); }
});

// ---------------------------------------------------------------- run-skill-opt (A10)
const SO = 'scripts/run-skill-opt.sh';
const FAKE_SC = {
  'scripts/__init__.py': '',
  'scripts/improve_description.py': 'def improve_description(*a, **k):\n    open("improve.fp", "w").write(__import__("hashlib").sha256(k["client"].api_key.encode()).hexdigest()[:8])\n',
  'scripts/run_loop.py': 'import subprocess, os\nfrom scripts.improve_description import improve_description\ndef main():\n    subprocess.Popen(["claude", "-p", "q"], env=os.environ).wait()\n    improve_description(client=None, model="x")\n    open("model.txt", "w").write("ok")\n',
  'anthropic.py': 'class Anthropic:\n    def __init__(self, api_key=None):\n        self.api_key = api_key\n',
};
function soWorld(mode) {
  const w = world(mode);
  const sc = path.join(w.fx.realHome, '.claude', 'plugins', 'marketplaces', 'claude-plugins-official', 'plugins', 'skill-creator', 'skills', 'skill-creator');
  for (const [rel, text] of Object.entries(FAKE_SC)) {
    fs.mkdirSync(path.dirname(path.join(sc, rel)), { recursive: true });
    fs.writeFileSync(path.join(sc, rel), text);
  }
  // legacy reads a real-shaped credentials file; the FAKE token below is not a credential
  fs.writeFileSync(w.fx.decoy, JSON.stringify({ claudeAiOauth: { accessToken: 'FAKE-legacy-access-token', expiresAt: Date.now() + 3600 * 1000 } }));
  return { w, sc };
}
function soLayout(w, mutate, extra) {
  const L = mkLayout(w.fx.root, [SO, ...(extra || [])], mutate);
  for (const d of ['skills', 'skill-creator-workspace']) { try { fs.unlinkSync(path.join(L, d)); } catch (_) { /* absent */ } }
  fs.mkdirSync(path.join(L, 'skills', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(L, 'skill-creator-workspace', 'evals'), { recursive: true });
  fs.writeFileSync(path.join(L, 'skill-creator-workspace', 'evals', 'alpha-evals.json'), '[]');
  return L;
}
function soRun(L, w) {
  return spawnSync('bash', [path.join(L, SO), 'alpha'], { env: w.env, cwd: L, encoding: 'utf8', timeout: 150000, input: '' });
}
const sha8 = require('crypto');
const fp8 = (s) => sha8.createHash('sha256').update(s).digest('hex').slice(0, 8);

test('N9 run-skill-opt: legacy reads the credentials file; registry uses the alias token; broken spawns nothing', () => {
  let { w, sc } = soWorld('legacy');
  try {
    const res = soRun(soLayout(w), w);
    assert.match(res.stderr, /Token valid for/, res.stderr.slice(-400));
    assert.strictEqual(fs.readFileSync(path.join(sc, 'improve.fp'), 'utf8'), fp8('FAKE-legacy-access-token'));
  } finally { w.cleanup(); }
  ({ w, sc } = soWorld('active'));
  try {
    const res = soRun(soLayout(w), w);
    assert.doesNotMatch(res.stderr, /Token valid for/);
    assert.strictEqual(res.status, 0, res.stderr.slice(-500));
    assert.deepStrictEqual(judge('active', w, res, {}), []);
    assert.strictEqual(fs.readFileSync(path.join(sc, 'improve.fp'), 'utf8'), w.calls()[0].fp, 'the SDK path and the claude child use the same alias token');
  } finally { w.cleanup(); }
  ({ w, sc } = soWorld('broken'));
  try {
    const res = soRun(soLayout(w), w);
    assert.deepStrictEqual(judge('broken', w, res, {}), []);
    assert.ok(!fs.existsSync(path.join(sc, 'improve.fp')), 'the python run never started');
  } finally { w.cleanup(); }
  ({ w, sc } = soWorld('active'));
  try {
    // mutation: the account layer call removed -> the python run uses the legacy credentials file
    const res = soRun(soLayout(w, (rel, t) => t.replace('node "$EVAL_ACCOUNT_JS" exec --pick --purpose skill-opt -- python3', 'python3')), w);
    assert.ok(judge('active', w, res, {}).length > 0 || !fs.existsSync(path.join(sc, 'improve.fp')) || fs.readFileSync(path.join(sc, 'improve.fp'), 'utf8') !== w.calls()[0].fp, 'removing the exec call was not caught');
  } finally { w.cleanup(); }
});

// run-p2-batch.js / run-p2-batch-loop.js are NOT wired: the completed P2 campaigns are audited against the live wrapper bytes
// (hooks/tests/p2-batch-loop.test.sh 4.5 / 5.5), so editing them breaks that evidence. depth-0 decides; the patch exists.

// ---------------------------------------------------------------- static: no unguarded credentials copy remains in the wired shell runners
test('static: every credentials copy in the wired shell runners sits behind the registry guard', () => {
  const files = [ORCH, 'evals/pipeline-bench/run-pipeline-bench.sh'];
  for (const f of files) {
    const lines = fs.readFileSync(path.join(REPO, f), 'utf8').split('\n');
    lines.forEach((l, i) => {
      if (/^\s*cp\s+.*\.credentials\.json/.test(l)) {
        const ctx = lines.slice(Math.max(0, i - 3), i).join('\n');
        assert.match(ctx, /EVAL_ACCOUNT_ACTIVE:-0\}" != "1"/, `${f}:${i + 1} copies credentials outside the registry guard`);
      }
    });
    assert.match(fs.readFileSync(path.join(REPO, f), 'utf8'), /eval_account_probe /, `${f} never probes the registry`);
  }
});
