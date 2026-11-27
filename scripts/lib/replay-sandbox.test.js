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

test('runNegativeControls blocks all 7 probes inside bwrap (or SKIPs if bwrap/userns unavailable)', () => {
  const res = runNegativeControls();
  if (res.skipped) {
    console.log(`SKIP: ${res.reason}`);
    process.exit(0);
  }
  assert.equal(res.probes.length, 7, 'expected 7 negative control probes');
  for (const probe of res.probes) {
    assert.equal(probe.blocked, true, `probe ${probe.name} was not blocked: ${probe.evidence}`);
  }
  assert.equal(res.passed, true, 'all negative control probes must pass');
});

test('f is red when the unshare-net guard is removed, then the real probe is green', () => {
  const srcPath = require('node:path').join(__dirname, 'replay-sandbox.js');
  const src = require('node:fs').readFileSync(srcPath, 'utf8');
  const needle = "args.push('--unshare-net');";
  const mutated = src.replace(needle, '/* egress guard removed */');
  assert.notEqual(mutated, src, 'negative control must remove the egress guard');
  const tmp = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'replay-red-f-'));
  const file = require('node:path').join(tmp, 'replay-sandbox-red.js');
  require('node:fs').writeFileSync(file, mutated);
  const redMod = require(file);
  const red = redMod.runNegativeControls({ proxyModulePath: require('node:path').join(__dirname, 'replay-api-proxy.js') });
  if (red.skipped) {
    console.log(`SKIP red f: ${red.reason}`);
    return;
  }
  const probe = red.probes.find((p) => p.name === 'f_no_egress_except_proxy');
  assert.equal(probe.blocked, false, `expected red f, evidence=${probe.evidence}`);
  console.log(`RED f: blocked=${probe.blocked} ${probe.evidence}`);
  const green = runNegativeControls();
  const again = green.probes.find((p) => p.name === 'f_no_egress_except_proxy');
  assert.equal(again.blocked, true, again.evidence);
  console.log(`GREEN f: blocked=${again.blocked} ${again.evidence}`);
});

test('g is red when the proxy path guard is removed, then the real probe is green', () => {
  const proxyPath = require('node:path').join(__dirname, 'replay-api-proxy.js');
  const src = require('node:fs').readFileSync(proxyPath, 'utf8');
  const needle = 'if (!isModelMessagesPath(req.url))';
  const mutated = src.replace(needle, 'if (false)').replace("require('./replay-budget.js')", `require(${JSON.stringify(require.resolve('./replay-budget.js'))})`);
  assert.notEqual(mutated, src, 'negative control must remove the path guard');
  const tmp = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'replay-red-g-'));
  const file = require('node:path').join(tmp, 'replay-api-proxy-red.js');
  require('node:fs').writeFileSync(file, mutated);
  const red = runNegativeControls({ proxyModulePath: file });
  if (red.skipped) {
    console.log(`SKIP red g: ${red.reason}`);
    return;
  }
  const probe = red.probes.find((p) => p.name === 'g_proxy_refuses_non_model_paths');
  assert.equal(probe.blocked, false, `expected red g, evidence=${probe.evidence}`);
  assert.match(probe.evidence, /stdout=\[(?!403,)\d+,\d+\]/, 'mutated proxy must actually answer both requests');
  console.log(`RED g: blocked=${probe.blocked} ${probe.evidence}`);
  const green = runNegativeControls();
  const again = green.probes.find((p) => p.name === 'g_proxy_refuses_non_model_paths');
  assert.equal(again.blocked, true, again.evidence);
  console.log(`GREEN g: blocked=${again.blocked} ${again.evidence}`);
});

console.log(`\n${passedCount} tests passed.`);
