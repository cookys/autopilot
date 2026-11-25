'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { check } = require('./lib/cn-model-dispatch-gate');

function fixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cn-gate-'));
  try { return fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function repo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  require('node:child_process').execFileSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'tracked.txt'), 'private checkout fixture\n');
}
function brief(dir, contents = 'Implement a small standalone utility.\n') {
  const file = path.join(dir, 'brief.md'); fs.writeFileSync(file, contents); return file;
}
function endpointEnv(name, url) { return { [`AUTOPILOT_ENDPOINT_${name.toUpperCase()}_URL`]: url, [`AUTOPILOT_ENDPOINT_${name.toUpperCase()}_TOKEN`]: 'fixture-token' }; }

test('(a) local qwen with cwd inside a private git checkout is allowed', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const config = path.join(root, 'config.json'); fs.writeFileSync(config, '{}');
  const got = check({ runner: 'cc-shim', model: 'qwen', endpoint: 'qwen_local', cwd, files: [prompt], env: { ...endpointEnv('qwen_local', 'http://localhost:8000/v1'), AUTOPILOT_CONFIG: config } });
  assert.equal(got.allowed, true);
}));
test('(b) Kimi in a fresh sandbox containing only the brief is allowed', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], env: { ...endpointEnv('kimi', 'https://api.moonshot.cn/v1'), AUTOPILOT_CN_WORK_TIER: 'T0' } });
  assert.equal(got.allowed, true);
}));
test('(b2) Kimi broker endpoint name is allowed without a resolvable URL', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi-code/kimi-for-coding', endpoint: 'kimi', cwd, files: [prompt], env: { AUTOPILOT_CN_WORK_TIER: 'T0' } });
  assert.equal(got.allowed, true);
}));
test('(c) Kimi in a git checkout is refused as private workdir', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], env: { ...endpointEnv('kimi', 'https://api.moonshot.cn/v1'), AUTOPILOT_CN_WORK_TIER: 'T0' } });
  assert.equal(got.cls, 'restricted_operator_private_workdir');
}));
test('(d) inventory host and credential-shaped brief content are refused', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd);
  for (const contents of ['Contact testhost-a for access.\n', 'Authorization: Bearer sk-123456789012345678901234\n']) {
    const prompt = brief(cwd, contents);
    const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], env: { ...endpointEnv('kimi', 'https://api.moonshot.cn/v1'), AUTOPILOT_CN_WORK_TIER: 'T0' } });
    assert.equal(got.cls, 'restricted_operator_brief_scan'); fs.unlinkSync(prompt);
  }
}));
test('(e) Qwen on a non-Chinese operator cloud is allowed', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'cc-shim', model: 'qwen', endpoint: 'openrouter', cwd, files: [prompt], env: endpointEnv('openrouter', 'https://openrouter.ai/api/v1') });
  assert.equal(got.allowed, true);
}));
test('(f) a local endpoint name resolving to an external host is refused', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const config = path.join(root, 'config.json'); fs.writeFileSync(config, '{}');
  const got = check({ runner: 'cc-shim', model: 'qwen', endpoint: 'qwen_local', cwd, files: [prompt], env: { ...endpointEnv('qwen_local', 'https://external.example/v1'), AUTOPILOT_CONFIG: config } });
  assert.equal(got.cls, 'local_name_external_host');
}));
test('(g) an unresolved operator for a Chinese model fails closed', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'mystery', cwd, files: [prompt], env: endpointEnv('mystery', 'https://unlisted.example/v1') });
  assert.equal(got.cls, 'restricted_operator_unknown_endpoint');
}));
test('(h) a raw local URL is allowed for a Chinese model', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'http://localhost:9876/anthropic', cwd, files: [prompt], env: { AUTOPILOT_LOCAL_GATEWAY_HOSTS: 'localhost' } });
  assert.equal(got.allowed, true);
}));
test('(j) a restricted-looking endpoint name that resolves to a local gateway host is allowed (hangar on-prem GLM v4 review)', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm', cwd, files: [prompt], env: { ...endpointEnv('glm', 'http://10.1.2.3:9876/anthropic'), AUTOPILOT_LOCAL_GATEWAY_HOSTS: '10.1.2.3' } });
  assert.equal(got.allowed, true);
}));
test('(k) the same endpoint name resolving to a private address not listed as local, or to the cloud, stays barred', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const unlisted = check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm', cwd, files: [prompt], env: endpointEnv('glm', 'http://10.1.2.3:9876/anthropic') });
  assert.equal(unlisted.allowed, false);
  const cloud = check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'glm', cwd, files: [prompt], env: endpointEnv('glm', 'https://open.bigmodel.cn/api') });
  assert.equal(cloud.allowed, false);
}));
test('(i) a raw Chinese cloud URL remains barred', () => fixture((root) => {
  const cwd = path.join(root, 'repo'); repo(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'cc-shim', model: 'GLM-5.3', endpoint: 'https://api.bigmodel.cn/anthropic', cwd, files: [prompt], env: { AUTOPILOT_CN_WORK_TIER: 'T0' } });
  assert.equal(got.allowed, false);
  assert.equal(got.cls, 'restricted_operator_private_workdir');
}));
test('(l) restricted operator without declared work tier is barred as restricted_operator_not_public_source', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], env: endpointEnv('kimi', 'https://api.moonshot.cn/v1') });
  assert.equal(got.allowed, false);
  assert.equal(got.cls, 'restricted_operator_not_public_source');
}));
test('(m) restricted operator with T0, clean sandbox, and clean brief is allowed', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], opts: { tier: 'T0' }, tier: 'T0', env: { ...endpointEnv('kimi', 'https://api.moonshot.cn/v1'), AUTOPILOT_CN_WORK_TIER: 'T0' } });
  assert.equal(got.allowed, true);
}));
test('(n) restricted operator minimax with T1 is barred', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'cc-shim', model: 'minimax', endpoint: 'minimax', cwd, files: [prompt], tier: 'T1', env: { ...endpointEnv('minimax', 'https://api.minimax.chat/v1'), AUTOPILOT_CN_WORK_TIER: 'T1' } });
  assert.equal(got.allowed, false);
}));
test('(o) restricted operator kimi with T1 is allowed', () => fixture((root) => {
  const cwd = path.join(root, 'sandbox'); fs.mkdirSync(cwd); const prompt = brief(cwd);
  const got = check({ runner: 'kimi', model: 'kimi', endpoint: 'kimi', cwd, files: [prompt], tier: 'T1', env: { ...endpointEnv('kimi', 'https://api.moonshot.cn/v1'), AUTOPILOT_CN_WORK_TIER: 'T1' } });
  assert.equal(got.allowed, true);
}));
