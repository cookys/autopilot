'use strict';
// PM 01M7975S: each fixed Node spawn path. Parent token test-token-A -> child sha256
// equals sha256 of that value. A declared token seat with no token exits non-zero and
// the stub is not invoked. An ordinary seat (flag unset) is unchanged.
// The stub writes only the sha256. It never writes the token. No real home path.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { spawnSync } = require('node:child_process');

const REPO = path.resolve(__dirname, '../..');
const TOKEN = 'test-token-A';
const EXPECT = crypto.createHash('sha256').update(TOKEN).digest('hex');
const EMPTY = crypto.createHash('sha256').update('').digest('hex');
const REFUSAL = require('./token-seat').REFUSAL;

function scratch() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tokseat-'));
  const bin = path.join(root, 'bin');
  const cfg = path.join(root, 'cfg');
  const home = path.join(root, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(cfg);
  fs.mkdirSync(home);
  fs.mkdirSync(path.join(root, 'tmp'));
  const sha = path.join(root, 'sha');
  const invoked = path.join(root, 'invoked');
  const stub = path.join(bin, 'claude');
  fs.writeFileSync(stub, `#!/usr/bin/env bash
printf '%s' "\${CLAUDE_CODE_OAUTH_TOKEN-}" | sha256sum | awk '{print $1}' > ${JSON.stringify(sha)}
printf '%s' "\${AUTOPILOT_TOKEN_SEAT-}" > ${JSON.stringify(path.join(root, 'flag'))}
: > ${JSON.stringify(invoked)}
printf '%s\\n' "\${STUB_STDOUT-ok}"
`, { mode: 0o755 });
  return { root, bin, cfg, home, sha, invoked, stub, flag: path.join(root, 'flag') };
}

function baseEnv(s, extra) {
  const env = { ...process.env, HOME: s.home, TMPDIR: path.join(s.root, 'tmp'), CLAUDE_CONFIG_DIR: s.cfg,
    AUTOPILOT_ACCOUNTS_DIR: path.join(s.root, 'no-accounts'), AUTOPILOT_CODEFORGE_COLLECT: 'off',
    PATH: `${s.bin}${path.delimiter}${process.env.PATH}` };
  delete env.CLAUDE_CODE_OAUTH_TOKEN;
  delete env.AUTOPILOT_TOKEN_SEAT;
  delete env.BENCH_CREDENTIALS;
  delete env.SEED_TEST_PAUSE_AFTER_WRITE_MS;
  for (const [k, v] of Object.entries(extra || {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

function reset(s) {
  fs.rmSync(s.sha, { force: true });
  fs.rmSync(s.invoked, { force: true });
  fs.rmSync(s.flag, { force: true });
}

function shaOf(s) {
  return fs.readFileSync(s.sha, 'utf8').trim();
}

function loadExtra(rel, names) {
  const abs = path.join(REPO, rel);
  let src = fs.readFileSync(abs, 'utf8');
  const at = src.lastIndexOf('module.exports = {');
  assert.ok(at >= 0, `no exports in ${rel}`);
  src = src.slice(0, at) + `module.exports = { ${names}, ` + src.slice(at + 'module.exports = {'.length);
  const m = new Module(abs);
  m.filename = abs;
  m.paths = Module._nodeModulePaths(path.dirname(abs));
  m._compile(src, abs);
  return m.exports;
}

function withProcessEnv(patch, fn) {
  const prev = new Map(Object.keys(patch).map((k) => [k, Object.prototype.hasOwnProperty.call(process.env, k) ? process.env[k] : undefined]));
  try {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    return fn();
  } finally {
    for (const [k, v] of prev) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test('tokenSeatError refuses only a declared seat with an empty token', () => {
  const { tokenSeatError } = require('./token-seat');
  assert.equal(tokenSeatError({}), null);
  assert.equal(tokenSeatError({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN }), null);
  assert.equal(tokenSeatError({ AUTOPILOT_TOKEN_SEAT: '1', CLAUDE_CODE_OAUTH_TOKEN: TOKEN }), null);
  assert.equal(tokenSeatError({ AUTOPILOT_TOKEN_SEAT: '1' }), REFUSAL);
  assert.equal(tokenSeatError({ AUTOPILOT_TOKEN_SEAT: '1', CLAUDE_CODE_OAUTH_TOKEN: '' }), REFUSAL);
});

test('seed-claude-config --exec passes the parent token and refuses a declared seat', () => {
  const s = scratch();
  const seed = path.join(REPO, 'scripts/lib/seed-claude-config.js');
  const parent = path.join(s.root, 'seeds');
  fs.mkdirSync(parent);
  const cred = path.join(s.cfg, '.credentials.json');
  fs.writeFileSync(cred, '{"claudeAiOauth":{"accessToken":"stub"}}\n');
  const run = (extra) => spawnSync(process.execPath, [seed, '--exec', '--parent', parent, '--', s.stub], { env: baseEnv(s, extra), encoding: 'utf8' });

  reset(s);
  const inherit = run({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  assert.equal(inherit.status, 0, inherit.stderr);
  assert.equal(shaOf(s), EXPECT);
  assert.ok(fs.existsSync(s.invoked));

  reset(s);
  fs.rmSync(cred, { force: true });
  const missing = run({ AUTOPILOT_TOKEN_SEAT: '1' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /token seat refused/);
  assert.ok(!fs.existsSync(s.invoked));
  assert.ok(!/source credentials missing/.test(missing.stderr));

  fs.writeFileSync(cred, '{"claudeAiOauth":{"accessToken":"stub"}}\n');
  reset(s);
  const ordinary = run({});
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(shaOf(s), EMPTY);
  assert.ok(fs.existsSync(s.invoked));
});

test('lane-token-resume --exec puts the file token in the child and dry-run does not print it', () => {
  const s = scratch();
  const mod = require('../lane-token-resume.js');
  const file = path.join(s.root, 'seat.tok');
  fs.writeFileSync(file, TOKEN + '\n', { mode: 0o600 });
  const cmd = mod.buildCommand({ tokenFile: file, cmd: [s.stub, '--version'] });
  assert.ok(!cmd.includes(TOKEN));
  const printed = [];
  const dry = mod.main(['--token-file', file, '--cwd', s.root, '--dry-run', '--', s.stub], {
    out: (line) => printed.push(line),
    err: (line) => printed.push(line),
    spawnSync: () => { throw new Error('tmux must not run'); },
  });
  assert.equal(dry, 0);
  assert.ok(!printed.join('\n').includes(TOKEN));

  reset(s);
  const inherit = spawnSync(process.execPath, [path.join(REPO, 'scripts/lane-token-resume.js'), '--exec', '--token-file', file, '--', s.stub], {
    env: baseEnv(s, {}), encoding: 'utf8',
  });
  assert.equal(inherit.status, 0, inherit.stderr);
  assert.equal(shaOf(s), EXPECT);
  assert.equal(fs.readFileSync(s.flag, 'utf8'), '1');

  reset(s);
  const gone = spawnSync(process.execPath, [path.join(REPO, 'scripts/lane-token-resume.js'), '--exec', '--token-file', path.join(s.root, 'missing.tok'), '--', s.stub], {
    env: baseEnv(s, {}), encoding: 'utf8',
  });
  assert.equal(gone.status, 2);
  assert.ok(!fs.existsSync(s.invoked));
  fs.writeFileSync(file, '\n');
  const empty = spawnSync(process.execPath, [path.join(REPO, 'scripts/lane-token-resume.js'), '--exec', '--token-file', file, '--', s.stub], {
    env: baseEnv(s, {}), encoding: 'utf8',
  });
  assert.equal(empty.status, 2);
  assert.ok(!fs.existsSync(s.invoked));
});

test('probe-todo-tools-pin passes the token and refuses a declared seat before spawn', () => {
  const s = scratch();
  const probe = path.join(REPO, 'scripts/probe-todo-tools-pin.js');
  const args = [probe, '--claude-bin', s.stub, '--timeout-seconds', '10', '--cwd', s.root, '--expect-absent'];
  reset(s);
  const probeOut = '{"type":"result","result":"NO_TASK_TOOL"}';
  const inherit = spawnSync(process.execPath, args, { env: baseEnv(s, { CLAUDE_CODE_OAUTH_TOKEN: TOKEN, STUB_STDOUT: probeOut }), encoding: 'utf8' });
  assert.equal(inherit.status, 0, inherit.stderr);
  assert.equal(shaOf(s), EXPECT);
  reset(s);
  const missing = spawnSync(process.execPath, args, { env: baseEnv(s, { AUTOPILOT_TOKEN_SEAT: '1', STUB_STDOUT: probeOut }), encoding: 'utf8' });
  assert.equal(missing.status, 78);
  assert.match(missing.stderr, /token seat refused/);
  assert.ok(!fs.existsSync(s.invoked));
  reset(s);
  const ordinary = spawnSync(process.execPath, args, { env: baseEnv(s, { STUB_STDOUT: probeOut }), encoding: 'utf8' });
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(shaOf(s), EMPTY);
});

test('qualification-review-provider claude kind passes the token and refuses before spawn', () => {
  const s = scratch();
  const qrp = path.join(REPO, 'scripts/qualification-review-provider.js');
  const req = JSON.stringify({ role: 'reviewer', payload: { format: 'case_content', content: 'diff --git a/f b/f\n+x\n' } });
  const envOf = (extra) => baseEnv(s, Object.assign({
    QRP_TRANSPORT: 'cli', QRP_CLI_KIND: 'claude', QRP_CLI_BIN: s.stub, QRP_PROVIDER: 't', QRP_MODEL: 'claude-sonnet-5-5',
    STUB_STDOUT: '{"type":"result","is_error":false,"result":"{\\"findings\\":[]}","modelUsage":{"claude-sonnet-5-5":{"inputTokens":1}}}',
  }, extra));
  const run = (extra) => spawnSync(process.execPath, [qrp], { env: envOf(extra), input: req, encoding: 'utf8' });
  reset(s);
  const inherit = run({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN });
  assert.equal(inherit.status, 0, inherit.stderr);
  assert.equal(shaOf(s), EXPECT);
  reset(s);
  const missing = run({ AUTOPILOT_TOKEN_SEAT: '1' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /token seat refused/);
  assert.ok(!fs.existsSync(s.invoked));
  reset(s);
  const ordinary = run({});
  assert.equal(ordinary.status, 0, ordinary.stderr);
  assert.equal(shaOf(s), EMPTY);
});

test('benchmark runOnce passes the token; a declared seat returns 78 before spawn', () => {
  const s = scratch();
  const bench = loadExtra('scripts/benchmark-hook-latency.js', 'runOnce');
  const cred = path.join(s.root, 'cred.json');
  fs.writeFileSync(cred, '{"claudeAiOauth":{"accessToken":"stub"}}\n');
  const ctx = { root: s.root, checkout: s.root, workDir: s.root, credentials: cred, account: false, claudeBin: s.stub, model: 'claude-sonnet-5-5' };
  reset(s);
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, AUTOPILOT_TOKEN_SEAT: undefined, HOME: s.home, CLAUDE_CONFIG_DIR: s.cfg, AUTOPILOT_ACCOUNTS_DIR: path.join(s.root, 'no-accounts') }, () => {
    const r = bench.runOnce(ctx, 'zero', 0.05);
    assert.equal(r.ok, true);
  });
  assert.equal(shaOf(s), EXPECT);

  reset(s);
  const missingCred = path.join(s.root, 'no-such-cred.json');
  const ctxMissing = { ...ctx, credentials: missingCred };
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, AUTOPILOT_TOKEN_SEAT: '1', HOME: s.home, CLAUDE_CONFIG_DIR: s.cfg }, () => {
    assert.throws(() => bench.runOnce(ctxMissing, 'zero', 0.05), (e) => e.code === 'TOKEN_SEAT_MISSING' && /token seat refused/.test(e.message));
  });
  assert.ok(!fs.existsSync(s.invoked));
  assert.ok(!fs.existsSync(missingCred));

  const cli = spawnSync(process.execPath, [path.join(REPO, 'scripts/benchmark-hook-latency.js')], {
    env: baseEnv(s, { AUTOPILOT_TOKEN_SEAT: '1' }), encoding: 'utf8',
  });
  assert.equal(cli.status, 78);
  assert.match(cli.stderr, /token seat refused/);

  reset(s);
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, AUTOPILOT_TOKEN_SEAT: undefined, HOME: s.home, CLAUDE_CONFIG_DIR: s.cfg }, () => {
    bench.runOnce(ctx, 'zero', 0.05);
  });
  assert.equal(shaOf(s), EMPTY);
});

test('measure-streamjson claudeVersion and profile-runtime invokeClaude pass the token or refuse', () => {
  const s = scratch();
  const measure = loadExtra('scripts/measure-streamjson-equivalence.js', 'claudeVersion');
  const profile = loadExtra('src/engine/profile-runtime.js', 'invokeClaude');
  reset(s);
  assert.equal(typeof measure.claudeVersion(baseEnv(s, { CLAUDE_CODE_OAUTH_TOKEN: TOKEN })), 'string');
  assert.equal(shaOf(s), EXPECT);
  reset(s);
  assert.throws(() => measure.claudeVersion(baseEnv(s, { AUTOPILOT_TOKEN_SEAT: '1' })), (e) => e.code === 'TOKEN_SEAT_MISSING');
  assert.ok(!fs.existsSync(s.invoked));
  reset(s);
  measure.claudeVersion(baseEnv(s, {}));
  assert.equal(shaOf(s), EMPTY);

  reset(s);
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: TOKEN, AUTOPILOT_TOKEN_SEAT: undefined, HOME: s.home, PATH: `${s.bin}${path.delimiter}${process.env.PATH}` }, () => {
    const r = profile.invokeClaude(s.stub, ['--version'], '', s.root, 5000);
    assert.equal(r.status, 0);
  });
  assert.equal(shaOf(s), EXPECT);
  reset(s);
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, AUTOPILOT_TOKEN_SEAT: '1', HOME: s.home }, () => {
    assert.throws(() => profile.invokeClaude(s.stub, ['--version'], '', s.root, 5000), (e) => e.code === 'TOKEN_SEAT_MISSING');
  });
  assert.ok(!fs.existsSync(s.invoked));
  reset(s);
  withProcessEnv({ CLAUDE_CODE_OAUTH_TOKEN: undefined, AUTOPILOT_TOKEN_SEAT: undefined, HOME: s.home }, () => {
    profile.invokeClaude(s.stub, ['--version'], '', s.root, 5000);
  });
  assert.equal(shaOf(s), EMPTY);
});
