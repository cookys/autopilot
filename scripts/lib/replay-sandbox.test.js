'use strict';

const assert = require('node:assert/strict');
const {
  buildSandboxArgs,
  resolveAllowedEnv,
  runNegativeControls,
} = require('./replay-sandbox.js');

let passedCount = 0;
function test(name, fn) {
  fn();
  passedCount++;
  console.log(`PASS: ${name}`);
}

test('buildSandboxArgs includes --unshare-net by default and omits when allowNet=true', () => {
  const defaultArgs = buildSandboxArgs({ pluginDir: '/tmp/plug', workDir: '/tmp/work' });
  assert.ok(defaultArgs.includes('--unshare-net'), 'should include --unshare-net by default');
  assert.ok(defaultArgs.includes('--ro-bind'), 'should mount plugin read-only');
  assert.ok(defaultArgs.includes('/plugin'), 'should mount plugin at /plugin');
  assert.ok(defaultArgs.includes('/work'), 'should mount workDir at /work');

  const netArgs = buildSandboxArgs({ allowNet: true });
  assert.ok(!netArgs.includes('--unshare-net'), 'should omit --unshare-net when allowNet=true');
});

test('resolveAllowedEnv strips fleet, git, SSH, token, and CLAUDE_CONFIG_DIR', () => {
  const env = resolveAllowedEnv({
    SAFE_VAR: 'ok',
    FLEET_TOKEN: 'secret',
    GIT_DIR: '/real/repo/.git',
    SSH_AUTH_SOCK: '/tmp/ssh.sock',
    CLAUDE_CONFIG_DIR: '/home/user/.claude',
    ANTHROPIC_API_KEY: 'sk-ant-123',
    MY_SECRET: 'nope',
  });
  assert.equal(env.SAFE_VAR, 'ok');
  assert.equal(env.HOME, '/home/sandbox');
  assert.equal(env.FLEET_TOKEN, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.SSH_AUTH_SOCK, undefined);
  assert.equal(env.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.MY_SECRET, undefined);
});

test('a node install outside /usr is bound read-only so the probes can exec it (never HOME)', () => {
  const args = buildSandboxArgs({ command: [process.execPath, '-e', '1'] });
  if (/^\/(usr|bin|lib|lib64)(\/|$)/.test(process.execPath)) return;
  const root = require('path').dirname(require('path').dirname(process.execPath));
  const i = args.findIndex((a, k) => a === '--ro-bind' && args[k + 1] === root && args[k + 2] === root);
  assert.ok(i >= 0, 'node install root must be --ro-bind mounted');
  assert.ok(!args.includes(process.env.HOME), 'HOME itself must never be mounted');
});

test('runNegativeControls blocks all 5 probes inside bwrap (or SKIPs if bwrap/userns unavailable)', () => {
  const res = runNegativeControls();
  if (res.skipped) {
    console.log(`SKIP: ${res.reason}`);
    process.exit(0);
  }
  assert.equal(res.probes.length, 5, 'expected 5 negative control probes');
  for (const probe of res.probes) {
    assert.equal(probe.blocked, true, `probe ${probe.name} was not blocked: ${probe.evidence}`);
  }
  assert.equal(res.passed, true, 'all negative control probes must pass');
});

console.log(`\n${passedCount} tests passed.`);
