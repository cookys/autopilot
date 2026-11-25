#!/usr/bin/env node
'use strict';
process.env.AUTOPILOT_ALLOW_SCRATCH_CARD = '1'; // this suite opens cards in temp repos on purpose (scratch-card guard, scripts/open-decision.js)
const assert = require('assert');
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const script = path.resolve(__dirname, '../scripts/open-decision.js');
let count = 0;
function run(category, extra = [], kind = 'decide') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opstep-'));
  const home = path.join(root, 'home'); const repo = path.join(root, 'repo');
  fs.mkdirSync(home); fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
  fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: repo });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
  const env = { ...process.env, HOME: home, AUTOPILOT_RUNS_WATCH_AUTOSTART: '0', AUTOPILOT_CARD_NOTIFY: 'off', CLAUDE_CODE_SESSION_ID: '', AUTOPILOT_SESSION_ID: '', AUTOPILOT_ROOT_RUN_ID: '' };
  const args = ['open', '--category', category, '--kind', kind, '--title', '要處理嗎？', '--question', '要處理這件事情嗎？', '--executor', 'ns/courier/pm', '--cwd', repo, '--json'];
  if (!['remind', 'step', 'look'].includes(kind)) args.push('--option', 'yes::同意', '--option', 'no::拒絕', '--recommendation', 'yes');
  if (!['step', 'look'].includes(kind)) args.push('--not-authorized', 'goal-change:owner only');
  const result = spawnSync(process.execPath, [script, ...args, ...extra], { cwd: repo, env, encoding: 'utf8' });
  const shown = spawnSync(process.execPath, [script, 'show', '--all', '--json', '--cwd', repo], { cwd: repo, env, encoding: 'utf8' });
  const cards = shown.stdout.trim() ? JSON.parse(shown.stdout).decisions : [];
  return { ...result, cards };
}
function test(name, fn) { try { fn(); console.log(`PASS ${name}`); count++; } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } }
for (const cat of ['identity', 'presence']) test(`${cat} missing`, () => { const r = run(cat); assert.strictEqual(r.status, 2, r.stderr); assert.strictEqual(r.cards.length, 0); assert.match(r.stderr, /位置|網址/); assert.match(r.stderr, /operator-step-none/); });
test('vague', () => { const r = run('identity', ['--operator-step', '請設定密碼']); assert.strictEqual(r.status, 2); assert.match(r.stderr, /位置/); assert.match(r.stderr, /驗證/); assert.strictEqual(r.cards.length, 0); });
test('valid URL and stored steps', () => { const step = '打開 https://10.0.0.5/ 執行 `設定密碼` 並確認結果'; const r = run('identity', ['--operator-step', step]); assert.strictEqual(r.status, 0, r.stderr); assert.deepStrictEqual(r.cards[0].operator_steps, [step]); });
test('valid path', () => { const r = run('presence', ['--operator-step', '在 ~/.config/x 執行 `cat x` 並驗證結果']); assert.strictEqual(r.status, 0, r.stderr); });
test('other category', () => { const r = run('authority'); assert.strictEqual(r.status, 0, r.stderr); });
test('exception', () => { const r = run('identity', ['--operator-step-none', '無須操作']); assert.strictEqual(r.status, 0, r.stderr); assert.strictEqual(r.cards[0].operator_step_none, '無須操作'); });
test('blank exception', () => { const r = run('identity', ['--operator-step-none', '   ']); assert.strictEqual(r.status, 2); assert.strictEqual(r.cards.length, 0); });
for (const kind of ['go', 'remind', 'step', 'look']) test(`${kind} missing`, () => { const r = run('identity', [], kind); assert.strictEqual(r.status, 2, r.stderr); assert.strictEqual(r.cards.length, 0); });
test('short individual step', () => { const r = run('identity', ['--operator-step', '短步驟', '--operator-step', '在 https://example.com 執行 `run` 並驗證結果']); assert.strictEqual(r.status, 2); assert.match(r.stderr, /12/); });
// Library route (hooks call openDecision() directly, no CLI): the same guard must refuse there (task 01M88ASYJ7).
const { openDecision } = require('../scripts/open-decision.js');
function lib(extra) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'opstep-lib-'));
  const repo = path.join(root, 'repo'); fs.mkdirSync(repo);
  execFileSync('git', ['init', '-q'], { cwd: repo });
  process.env.HOME = path.join(root, 'home'); fs.mkdirSync(process.env.HOME);
  return openDecision({ cwd: repo, root: null, session: 'synthetic', question: '要處理這件事情嗎？', options: null, category: 'identity', ...extra });
}
for (const cat of ['identity', 'presence']) test(`library ${cat} missing steps refused`, () => { const r = lib({ category: cat }); assert.strictEqual(r.status, 'operator_step_refused'); assert.ok(r.reasons.length >= 1); });
test('library vague step refused', () => { const r = lib({ operator_steps: ['請設定密碼'] }); assert.strictEqual(r.status, 'operator_step_refused'); });
test('library complete steps accepted', () => { const r = lib({ operator_steps: ['打開 https://10.0.0.5/ 執行 `設定密碼` 並確認結果'] }); assert.strictEqual(r.status, 'ok', JSON.stringify(r)); });
test('library no category (hook cards) unchanged', () => { const r = lib({ category: undefined }); assert.strictEqual(r.status, 'ok', JSON.stringify(r)); });
test('library exception reason accepted', () => { const r = lib({ operator_step_none: '無須操作' }); assert.strictEqual(r.status, 'ok', JSON.stringify(r)); });
console.log(`${count} cases passed`);
