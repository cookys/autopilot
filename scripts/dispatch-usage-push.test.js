'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('configured host uploads and sends its snapshot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-push-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'fleet');
  const log = path.join(dir, 'calls');
  fs.writeFileSync(fake, `#!/usr/bin/env node\nconst fs=require('fs');\nfs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(process.argv.slice(2))+'\\n');\nif(process.argv[2]==='upload') { fs.writeFileSync(process.env.FAKE_MODE, (fs.statSync(process.argv[3]).mode & 0o777).toString(8)); console.log('${'a'.repeat(64)}'); }\n`, { mode: 0o755 });
  const env = { ...process.env, FLEET_BIN: fake, FAKE_LOG: log, FAKE_MODE: path.join(dir, 'mode'), XDG_RUNTIME_DIR: dir, AUTOPILOT_DISPATCH_RUNS_DIR: path.join(dir, 'runs'), AUTOPILOT_USAGE_PUSH_TO: 'example/host/hangar' };
  const r = spawnSync('bash', [path.join(__dirname, 'dispatch-usage-push.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2, 'expected one upload and one send');
  assert.equal(calls[0][0], 'upload');
  assert.equal(calls[0][2], '--summary');
  assert.match(calls[0][3], /^dispatch-usage \S+ \d{4}-\d\d-\d\d$/);
  assert.deepEqual(calls[1], ['send', env.AUTOPILOT_USAGE_PUSH_TO, `${calls[0][3]} ref=${'a'.repeat(64)}`]);
  assert.equal(fs.readFileSync(env.FAKE_MODE, 'utf8'), '600');
  assert.equal(fs.existsSync(calls[0][1]), false, 'snapshot removed');
});

test('unconfigured host exits with one line and no fleet call', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-push-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const log = path.join(dir, 'calls');
  const env = { ...process.env, FLEET_BIN: path.join(dir, 'no-fleet'), XDG_RUNTIME_DIR: dir };
  delete env.AUTOPILOT_USAGE_PUSH_TO;
  const r = spawnSync('bash', [path.join(__dirname, 'dispatch-usage-push.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^dispatch-usage-push: AUTOPILOT_USAGE_PUSH_TO is unset; skipping\n$/);
  assert.equal(r.stderr, '');
  assert.equal(fs.existsSync(log), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('report failure exits 1 without calling fleet and removes snapshot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-push-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bad = path.join(dir, 'not-a-directory');
  fs.writeFileSync(bad, '');
  const env = { ...process.env, FLEET_BIN: path.join(dir, 'no-fleet'), XDG_RUNTIME_DIR: dir, AUTOPILOT_DISPATCH_RUNS_DIR: bad, AUTOPILOT_USAGE_PUSH_TO: 'example/host/hangar' };
  const r = spawnSync('bash', [path.join(__dirname, 'dispatch-usage-push.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'dispatch-usage-push: report failed\n');
  assert.deepEqual(fs.readdirSync(dir), ['not-a-directory']);
});

test('send failure exits 1 with a safe single line and removes snapshot', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-push-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fake = path.join(dir, 'fleet');
  fs.writeFileSync(fake, `#!/bin/bash\nif [[ $1 == upload ]]; then echo ${'b'.repeat(64)}; else echo secret >&2; exit 1; fi\n`, { mode: 0o755 });
  const env = { ...process.env, FLEET_BIN: fake, XDG_RUNTIME_DIR: dir, AUTOPILOT_DISPATCH_RUNS_DIR: path.join(dir, 'runs'), AUTOPILOT_USAGE_PUSH_TO: 'example/host/hangar' };
  const r = spawnSync('bash', [path.join(__dirname, 'dispatch-usage-push.sh')], { env, encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(r.stderr, 'dispatch-usage-push: send failed\n');
  assert.deepEqual(fs.readdirSync(dir), ['fleet']);
});

test('user timer and service templates schedule the sender daily', () => {
  const service = fs.readFileSync(path.join(__dirname, 'systemd/dispatch-usage-push.service'), 'utf8');
  const timer = fs.readFileSync(path.join(__dirname, 'systemd/dispatch-usage-push.timer'), 'utf8');
  assert.match(service, /ExecStart=\/usr\/bin\/env bash @REPO_PATH@\/scripts\/dispatch-usage-push\.sh/);
  assert.match(timer, /^Unit=dispatch-usage-push\.service$/m);
  assert.match(timer, /^OnCalendar=daily$/m);
  assert.match(timer, /^Persistent=true$/m);
});
