'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const BIN = path.join(__dirname, 'login-checklist.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lc-'));
function run(hosts, extra = []) {
  const f = path.join(dir, `h${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(f, typeof hosts === 'string' ? hosts : JSON.stringify(hosts));
  return spawnSync('node', [BIN, '--hosts', f, ...extra], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
const TWO = [
  { host: 'h1', os_account: 'team', profiles: ['alpha', 'home'] },
  { host: 'h2', os_account: 'lead', profiles: ['beta'] },
];

test('every step starts with host and OS account; only login/status/link/health commands', () => {
  const r = run(TWO);
  assert.strictEqual(r.status, 0);
  const steps = r.stdout.split('\n').filter((l) => /^\d+\. /.test(l));
  assert.strictEqual(steps.length, 12);
  for (const s of steps) {
    assert.match(s, /^\d+\. 在 (h1、OS 帳號 team|h2、OS 帳號 lead)：/);
    assert.doesNotMatch(s, /cwd|信任|trust|cd /);
  }
  assert.match(r.stdout, /CLAUDE_CONFIG_DIR="\$HOME\/\.claude-profiles\/alpha" claude auth login --claudeai/);
  assert.match(r.stdout, /profile-link\.js apply --profile alpha/);
  assert.match(r.stdout, /claude auth status --text/);
  assert.match(r.stdout, /profile-health\.js check/);
});

test('home yields a note and no step; every listed host appears', () => {
  const j = JSON.parse(run(TWO, ['--json']).stdout);
  assert.strictEqual(j.length, 3);
  const home = j.find((x) => x.profile === 'home');
  assert.deepStrictEqual(home.steps, []);
  assert.ok(home.note);
  assert.deepStrictEqual([...new Set(j.map((x) => x.host))], ['h1', 'h2']);
});

test('strict validation rejects bad input', () => {
  const bad = [
    [{ host: 'h', os_account: 'u', profiles: ['a'], extra: 1 }],
    [{ host: 'h', os_account: 'u', profiles: ['a/b'] }],
    [{ host: 'h', os_account: 'u', profiles: ['a', 'a'] }],
    [{ host: 'h', os_account: 'u', profiles: ['a'] }, { host: 'h', os_account: 'u', profiles: ['b'] }],
    [{ host: 'h', os_account: 'u', profiles: [] }],
    [{ host: 'bad host', os_account: 'u', profiles: ['a'] }],
    [{ host: 'h', os_account: 'u' }],
    {},
    '{not json',
  ];
  for (const b of bad) { const r = run(b); assert.strictEqual(r.status, 2, JSON.stringify(b)); assert.strictEqual(r.stdout, ''); }
});

test('usage error without --hosts', () => {
  assert.strictEqual(spawnSync('node', [BIN], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).status, 2);
});

test('script never spawns claude or reads credentials', () => {
  const src = fs.readFileSync(BIN, 'utf8');
  assert.doesNotMatch(src, /child_process|spawn|exec\(|\.credentials|\.claude\.json|homedir/);
});
