'use strict';
require('./lib/test-git-env'); // fixture repos must not run the account's global git config
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const script = path.join(__dirname, 'pm-accept-check.js');
test('P5 intake evidence', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-check-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } }).trim();
  git('init', '-q'); git('config', 'user.name', 'Test'); git('config', 'user.email', 'test@example.invalid');
  const write = (name, value) => fs.writeFileSync(path.join(dir, name), value);
  write('threshold.json', '{"limit":1}'); write('work', 'base\n'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  write('work', 'base\nchange\n'); git('add', '.'); git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD');
  const check = { schema: 'autopilot.accept-checklist/1', repo: dir, base, threshold_paths: [], threshold_keys: [{ path: 'threshold.json', json_pointer: '/limit' }], required_checks: [{ name: 'suite', record_path: path.join(dir, 'record.json') }] };
  const run = (c = check, result = head, h = head, record = { schema: 1, head, rc: 0 }) => {
    write('check.json', JSON.stringify(c)); write('result', result); write('record.json', JSON.stringify(record));
    return spawnSync(process.execPath, [script, '--checklist', path.join(dir, 'check.json'), '--head', h, '--result', path.join(dir, 'result')], { encoding: 'utf8', env: { ...process.env, HOME: dir, GIT_CONFIG_NOSYSTEM: '1' } });
  };
  const expect = (r, code, text) => { assert.equal(r.status, code, r.stdout + r.stderr); assert.match(r.stdout + r.stderr, text); };
  expect(run(), 0, /ACCEPT/);
  expect(run({ ...check, threshold_paths: ['work'] }), 1, /\(a\)/);
  expect(run(check, 'done, all green'), 1, /\(b\)/);
  expect(run(check, head, base), 1, /\(b\)/);
  expect(run(check, head + ' ' + 'a'.repeat(64)), 0, /ACCEPT/);
  expect(run(check, head, head, { schema: 1, head, rc: 1 }), 1, /\(c\)/);
  expect(run({ ...check, exception_patterns: ['change'] }), 1, /\(d\)/);
  expect(run({ ...check, required_checks: [] }), 2, /.+/);
});
