'use strict';
require('./lib/test-git-env');
// node --test scripts/post-merge-suite.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SH = path.join(__dirname, 'post-merge-suite.sh');
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-home-'));

function envWithFleet(log) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-bin-'));
  fs.writeFileSync(path.join(bin, 'fleet'), `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(log)}\n`);
  fs.chmodSync(path.join(bin, 'fleet'), 0o755);
  const e = { ...process.env, HOME, PATH: `${bin}:${process.env.PATH}`, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
  delete e.NODE_TEST_CONTEXT;
  delete e.NODE_TEST_WORKER_ID;
  delete e.AUTOPILOT_TOKEN_SEAT;
  delete e.AUTOPILOT_SESSION_ID;
  return e;
}

function git(dir, e, args) {
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, env: e, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr + r.stdout);
  return r.stdout.trim();
}

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-repo-'));
  for (const [p, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), body);
  }
  return dir;
}

test('new_red lists only the suite that is green on base; fleet is called once', () => {
  const dir = repo({
    'scripts/seed.js': 'v1\n',
    'hooks/tests/old.test.sh': '#!/usr/bin/env bash\n: scripts/seed.js\nexit 1\n',
    'hooks/tests/new.test.sh': '#!/usr/bin/env bash\n: scripts/seed.js\nexit 0\n',
  });
  const log = path.join(dir, 'fleet.log');
  const e = envWithFleet(log);
  const out = path.join(dir, 'out');
  try {
    git(dir, e, ['init', '-q']);
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'base']);
    const base = git(dir, e, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'scripts/seed.js'), 'v2\n');
    fs.writeFileSync(path.join(dir, 'hooks/tests/new.test.sh'), '#!/usr/bin/env bash\n: scripts/seed.js\nexit 1\n');
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'merged']);
    const merged = git(dir, e, ['rev-parse', 'HEAD']);
    const r = spawnSync('bash', [SH, '--merged', merged, '--base', base, '--notify', 'ns/courier/member', '--out', out], { cwd: dir, env: e, encoding: 'utf8' });
    assert.strictEqual(r.status, 1, r.stdout + r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'post-merge.json'), 'utf8'));
    assert.strictEqual(doc.merged, merged);
    assert.strictEqual(doc.base, base);
    assert.deepStrictEqual(doc.new_red, ['hooks/tests/new.test.sh']);
    assert.ok(doc.red.includes('hooks/tests/old.test.sh'));
    assert.ok(doc.red.includes('hooks/tests/new.test.sh'));
    assert.strictEqual(doc.red.filter((p) => doc.new_red.includes(p) && p.endsWith('old.test.sh')).length, 0);
    const sent = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0], /^send ns\/courier\/member post-merge NEW red on [0-9a-f]+: hooks\/tests\/new\.test\.sh; revert with git revert -m 1 [0-9a-f]+$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('all green: exit 0 and the fleet stub is not called', () => {
  const dir = repo({
    'scripts/seed.js': 'v1\n',
    'hooks/tests/ok.test.sh': '#!/usr/bin/env bash\n: scripts/seed.js\nexit 0\n',
  });
  const log = path.join(dir, 'fleet.log');
  const e = envWithFleet(log);
  const out = path.join(dir, 'out');
  try {
    git(dir, e, ['init', '-q']);
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'base']);
    const base = git(dir, e, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'scripts/seed.js'), 'v2\n');
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'merged']);
    const merged = git(dir, e, ['rev-parse', 'HEAD']);
    const r = spawnSync('bash', [SH, '--merged', merged, '--base', base, '--notify', 'ns/courier/member', '--out', out], { cwd: dir, env: e, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const doc = JSON.parse(fs.readFileSync(path.join(out, 'post-merge.json'), 'utf8'));
    assert.deepStrictEqual(doc.new_red, []);
    assert.deepStrictEqual(doc.red, []);
    assert.strictEqual(fs.existsSync(log), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('wall over 5400s asks the fleet stub for the over-90 line (clock injected)', () => {
  const dir = repo({
    'scripts/seed.js': 'v1\n',
    'hooks/tests/ok.test.sh': '#!/usr/bin/env bash\n: scripts/seed.js\nexit 0\n',
  });
  const log = path.join(dir, 'fleet.log');
  const e = envWithFleet(log);
  e.AUTOPILOT_TEST_POST_MERGE_WALL_S = '5460';
  const out = path.join(dir, 'out');
  try {
    git(dir, e, ['init', '-q']);
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'base']);
    const base = git(dir, e, ['rev-parse', 'HEAD']);
    fs.writeFileSync(path.join(dir, 'scripts/seed.js'), 'v2\n');
    git(dir, e, ['add', '-A']);
    git(dir, e, ['commit', '-qm', 'merged']);
    const merged = git(dir, e, ['rev-parse', 'HEAD']);
    const r = spawnSync('bash', [SH, '--merged', merged, '--base', base, '--notify', 'ns/courier/member', '--out', out], { cwd: dir, env: e, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stdout + r.stderr);
    const sent = fs.readFileSync(log, 'utf8').trim().split('\n');
    assert.strictEqual(sent.length, 1);
    assert.match(sent[0], /^send ns\/courier\/member post-merge suite took 91 min on [0-9a-f]+, over 90$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
