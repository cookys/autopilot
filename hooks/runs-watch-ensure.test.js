'use strict';
// runs-watch-ensure.test.js -- runWriter makes the runs directory BEFORE its first tick and ends with the reason when it
// cannot (BL-0336 U1, plan F6 row "boot end-to-end": the unit half that the end-to-end test cannot isolate, because a
// reader's own ensure would cover a missing call in the writer). Negative control: a copy of the plugin whose runWriter
// no longer calls ensureRunsDir must fail the same checks.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { copyPlugin, mutate } = require('./tests/lib/plugin-copy');

const REPO = path.resolve(__dirname, '..');

const DRIVER = `
const root = process.argv[1];
const rp = require(root + '/scripts/lib/runtime-paths');
const rw = require(root + '/src/status/runs-watch');
const order = [];
const err = [];
const mode = process.env.ENSURE_MODE;
rp.ensureRunsDir = () => { order.push('ensure'); return mode === 'refuse' ? { ok: false, path: '/x/runs', reason: 'boom: not ours' } : { ok: true, path: '/x/runs', reason: null }; };
const rc = rw.runWriter({
  key: '0123456789abcdef', interval: 1, idleExit: 1, enrichCap: 1, render: null, cwd: process.cwd(), env: process.env,
  collect: () => { order.push('collect'); throw new Error('stop after the first collect'); },
  stderr: { write: (s) => err.push(String(s)) },
});
process.stdout.write(JSON.stringify({ rc, order, err }));
process.exit(0);
`;

function drive(root, mode) {
  const sb = fs.mkdtempSync(path.join(os.tmpdir(), 'rwe-'));
  const live = fs.mkdtempSync(path.join('/dev/shm', 'rwe-live-'));
  fs.chmodSync(live, 0o700);
  const home = path.join(sb, 'home');
  fs.mkdirSync(home);
  const r = spawnSync(process.execPath, ['-e', DRIVER, root], {
    encoding: 'utf8', cwd: sb, timeout: 60000,
    env: {
      PATH: process.env.PATH, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, '.claude'), AUTOPILOT_LIVE_DIR: live,
      AUTOPILOT_REVIEW_SERVER_AUTOSTART: '0', ENSURE_MODE: mode, TMPDIR: sb,
    },
  });
  fs.rmSync(sb, { recursive: true, force: true });
  fs.rmSync(live, { recursive: true, force: true });
  assert.strictEqual(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}

function checkOrder(root) {
  const ok = drive(root, 'ok');
  assert.deepStrictEqual(ok.order.slice(0, 2), ['ensure', 'collect'], `ensure must come before the first tick, got ${JSON.stringify(ok.order)}`);
  const refused = drive(root, 'refuse');
  assert.strictEqual(refused.rc, 1);
  assert.deepStrictEqual(refused.order, ['ensure'], 'a refused directory ends the start before any tick');
  assert.ok(refused.err.join('').includes('boom: not ours'), `the reason reaches stderr: ${JSON.stringify(refused.err)}`);
}

test('runWriter calls ensureRunsDir before the first tick, and a refusal ends the start with the reason', () => checkOrder(REPO));

test('negative control: a runWriter without the ensure call fails the same checks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwe-copy-'));
  copyPlugin(REPO, root);
  mutate(root, 'src/status/runs-watch.js', /const ensuredRuns = runtimePaths\.ensureRunsDir\(env\);\n\s*if \(!ensuredRuns\.ok\) return fail\([^\n]*\n/, '');
  assert.throws(() => checkOrder(root), assert.AssertionError);
  fs.rmSync(root, { recursive: true, force: true });
});

// ---- flockProbe makes a missing TMPDIR first; a TMPDIR that cannot be used is tmpdir_unavailable, not flock_unavailable ----
function probe(root, tmpdirKind) {
  const sb = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rwe-probe-')));
  const target = tmpdirKind === 'missing' ? path.join(sb, 'a', 'b', 'tmp') : tmpdirKind === 'file' ? path.join(sb, 'file') : path.join(sb, 'tmp');
  if (tmpdirKind === 'exists') fs.mkdirSync(target);
  if (tmpdirKind === 'file') fs.writeFileSync(target, 'x');
  const code = `const rw = require(process.argv[1] + '/src/status/runs-watch'); process.stdout.write(JSON.stringify(rw.flockProbe(process.env)));`;
  const r = spawnSync(process.execPath, ['-e', code, root], { encoding: 'utf8', env: { PATH: process.env.PATH, HOME: sb, TMPDIR: target } });
  const out = r.status === 0 ? JSON.parse(r.stdout) : { crashed: r.stderr };
  out.exists = fs.existsSync(target) && fs.statSync(target).isDirectory();
  out.mode = out.exists ? fs.statSync(target).mode & 0o777 : null;
  fs.rmSync(sb, { recursive: true, force: true });
  return out;
}
function checkProbe(root) {
  const empty = probe(root, 'exists');
  assert.strictEqual(empty.ok, true, `an existing empty TMPDIR: ${JSON.stringify(empty)}`);
  const missing = probe(root, 'missing');
  assert.strictEqual(missing.ok, true, `a TMPDIR that does not exist yet is made first: ${JSON.stringify(missing)}`);
  assert.strictEqual(missing.mode, 0o700);
  const file = probe(root, 'file');
  assert.strictEqual(file.ok, false);
  assert.strictEqual(file.status, 'tmpdir_unavailable', `named for what it is: ${JSON.stringify(file)}`);
}
test('flockProbe: existing empty TMPDIR ok; missing TMPDIR is made (0700); an unusable one is tmpdir_unavailable', () => checkProbe(REPO));
test('negative control: a flockProbe that does not ensure the temp directory fails the missing-TMPDIR row', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rwe-copy2-'));
  copyPlugin(REPO, root);
  mutate(root, 'src/status/runs-watch.js', /const tmp = runtimePaths\.ensureTmpdir\(env\);/, "const tmp = { ok: true, path: runtimePaths.tmpdirOf(env) };");
  assert.throws(() => checkProbe(root), assert.AssertionError);
  fs.rmSync(root, { recursive: true, force: true });
});
