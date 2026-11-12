'use strict';
require('./lib/test-git-env.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RD = path.join(__dirname, 'request-decision.js');
const OD = path.join(__dirname, 'open-decision.js');
const SECRET = ['sk', 'ant', 'abcdefghijklmnopqrst'].join('-'); // synthetic; split so leak-guard does not match the fixture
const TO = 'ns/courier/pm';

function scratch() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'req-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'req-repo-'));
  const log = path.join(home, 'fleet.log');
  const bin = path.join(home, 'fleet');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FLEET_LOG"\nexit 0\n');
  fs.chmodSync(bin, 0o755);
  const g = spawnSync('git', ['init', '-q'], { cwd: repo, env: process.env });
  if (g.status !== 0) throw new Error(`git init failed: ${g.stderr}`);
  return {
    home, repo, log, bin,
    cleanup() {
      fs.rmSync(home, { recursive: true, force: true });
      fs.rmSync(repo, { recursive: true, force: true });
    },
  };
}

function envOf(s, extra = {}) {
  const env = {
    ...process.env,
    HOME: s.home,
    AUTOPILOT_FLEET_BIN: s.bin,
    FLEET_LOG: s.log,
    AUTOPILOT_CARD_NOTIFY: 'off',
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    ...extra,
  };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.CODEX_THREAD_ID;
  delete env.AUTOPILOT_PM_ADDRESS;
  delete env.AUTOPILOT_FLEET_TASK;
  delete env.FLEET_FYI;
  delete env.FLEET_AS_CLI;
  delete env.XDG_CONFIG_HOME;
  return env;
}

function run(s, args, extra) {
  return spawnSync(process.execPath, [RD, ...args], { env: envOf(s, extra), encoding: 'utf8' });
}

function logOf(s) {
  return fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8') : '';
}

function record(s, id) {
  return JSON.parse(fs.readFileSync(path.join(s.home, '.autopilot', 'requests', `${id}.json`), 'utf8'));
}

const base = ['send', '--question', '要刪嗎？', '--option', '刪::刪掉', '--option', '留::留下', '--recommendation', '留', '--to', TO];

test('one line carries the question, options, recommendation and r- id', () => {
  const s = scratch();
  try {
    const r = run(s, [...base, '--boundary', 'external']);
    assert.equal(r.status, 0, r.stderr);
    const id = r.stdout.trim();
    assert.match(id, /^r-[0-9a-f]{8}$/);
    const lines = logOf(s).trim().split('\n');
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^send ns\/courier\/pm AUTOPILOT-REQ\/1 /);
    assert.match(lines[0], /要刪嗎？/);
    assert.match(lines[0], /刪掉/);
    assert.match(lines[0], /"recommendation":"留"/);
    assert.match(lines[0], new RegExp(id));
    const rec = record(s, id);
    assert.equal(rec.status, `waiting_on_operator ${id}`);
    assert.equal(rec.line.includes('\n'), false);
    assert.equal(fs.statSync(path.join(s.home, '.autopilot', 'requests', `${id}.json`)).mode & 0o777, 0o600);
  } finally { s.cleanup(); }
});

test('read_only and reversible send to the PM and exit 3', () => {
  for (const boundary of ['read_only', 'reversible']) {
    const s = scratch();
    try {
      const r = run(s, [...base, '--boundary', boundary]);
      assert.equal(r.status, 3, `${boundary}: ${r.stderr}`);
      assert.match(logOf(s), /send ns\/courier\/pm AUTOPILOT-REQ\/1 /);
    } finally { s.cleanup(); }
  }
});

test('irreversible without snapshot or blast radius does not send', () => {
  const s = scratch();
  try {
    const none = run(s, [...base, '--boundary', 'irreversible']);
    assert.equal(none.status, 2, none.stderr);
    const snap = run(s, [...base, '--boundary', 'irreversible', '--snapshot', 'copy kept']);
    assert.equal(snap.status, 2, snap.stderr);
    const blast = run(s, [...base, '--boundary', 'irreversible:reason', '--blast-radius', 'one file']);
    assert.equal(blast.status, 2, blast.stderr);
    assert.equal(logOf(s), '');
    assert.equal(fs.existsSync(path.join(s.home, '.autopilot', 'requests')), false);
  } finally { s.cleanup(); }
});

test('a credential is redacted before the wire', () => {
  const s = scratch();
  try {
    const r = run(s, ['send', '--question', `token ${SECRET} here`, '--option', '刪::刪掉', '--option', '留::留下', '--recommendation', '留', '--boundary', 'external', '--to', TO]);
    assert.equal(r.status, 0, r.stderr);
    const log = logOf(s);
    assert.equal(log.includes(SECRET), false, `credential leaked: ${SECRET}`);
    assert.ok(log.includes('［內容疑似含憑證，已隱藏；請到 pane 查看］') || log.includes('<REDACTED>'));
  } finally { s.cleanup(); }
});

test('--task sets waiting_on_operator on the fleet task', () => {
  const s = scratch();
  try {
    const r = run(s, [...base, '--boundary', 'external', '--task', 't-1']);
    assert.equal(r.status, 0, r.stderr);
    const id = r.stdout.trim();
    const log = logOf(s);
    assert.match(log, /task progress t-1 blocked_human waiting_on_operator /);
    assert.match(log, new RegExp(`waiting_on_operator ${id}`));
    assert.equal(record(s, id).status, `waiting_on_operator ${id}`);
  } finally { s.cleanup(); }
});

test('team.json pm is used when --to is absent', () => {
  const s = scratch();
  try {
    fs.mkdirSync(path.join(s.home, '.autopilot'), { recursive: true });
    fs.writeFileSync(path.join(s.home, '.autopilot', 'team.json'), '{"role":"lane","pm":"ns/courier/pm"}\n');
    const r = run(s, ['send', '--question', '要刪嗎？', '--option', '刪::a', '--option', '留::b', '--recommendation', '留', '--boundary', 'external']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(logOf(s), /^send ns\/courier\/pm AUTOPILOT-REQ\/1 /);
  } finally { s.cleanup(); }
});

test('missing PM address does not send', () => {
  const s = scratch();
  try {
    const r = run(s, ['send', '--question', '要刪嗎？', '--option', '刪::a', '--option', '留::b', '--recommendation', '留', '--boundary', 'external']);
    assert.equal(r.status, 2, r.stderr);
    assert.equal(logOf(s), '');
    assert.equal(fs.existsSync(path.join(s.home, '.autopilot', 'requests')), false);
  } finally { s.cleanup(); }
});

test('a failed send does not claim waiting', () => {
  const s = scratch();
  try {
    fs.writeFileSync(s.bin, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$FLEET_LOG"\nexit 1\n');
    fs.chmodSync(s.bin, 0o755);
    const r = run(s, [...base, '--boundary', 'external']);
    assert.equal(r.status, 1, r.stderr);
    const dir = path.join(s.home, '.autopilot', 'requests');
    const name = fs.readdirSync(dir).find((n) => n.endsWith('.json'));
    const rec = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    assert.equal(rec.status, 'send_failed');
    assert.equal(String(rec.status).includes('waiting_on_operator'), false);
  } finally { s.cleanup(); }
});

test('forward resends the stored line', () => {
  const s = scratch();
  try {
    const r = run(s, [...base, '--boundary', 'external']);
    assert.equal(r.status, 0, r.stderr);
    const id = r.stdout.trim();
    fs.writeFileSync(s.log, '');
    const f = run(s, ['forward', '--id', id]);
    assert.equal(f.status, 0, f.stderr);
    assert.match(logOf(s), new RegExp(`send ns/courier/pm AUTOPILOT-REQ/1 .*${id}`));
    const missing = run(s, ['forward', '--id', 'r-00000000']);
    assert.equal(missing.status, 2);
  } finally { s.cleanup(); }
});

test('PM open --from-request stores the id', () => {
  const s = scratch();
  try {
    fs.mkdirSync(path.join(s.home, '.autopilot'), { recursive: true });
    fs.writeFileSync(path.join(s.home, '.autopilot', 'team.json'), '{"role":"pm"}\n');
    const env = envOf(s);
    const bad = spawnSync(process.execPath, [OD, 'open', '--cwd', s.repo, '--executor', 'ns/courier/member', '--question', '要刪嗎？', '--option', '刪::刪掉', '--option', '留::留下', '--not-authorized', 'read_only', '--from-request', 'nope'], { env, encoding: 'utf8' });
    assert.equal(bad.status, 2, bad.stderr);
    assert.equal(fs.existsSync(path.join(s.repo, '.git', 'autopilot', 'decisions')), false);
    const ok = spawnSync(process.execPath, [OD, 'open', '--cwd', s.repo, '--executor', 'ns/courier/member', '--question', '要刪嗎？', '--option', '刪::刪掉', '--option', '留::留下', '--not-authorized', 'read_only', '--from-request', 'r-abcdef01'], { env, encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    const dir = path.join(s.repo, '.git', 'autopilot', 'decisions');
    const file = fs.readdirSync(dir).find((n) => n.endsWith('.json'));
    const body = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.equal(body.decisions[0].from_request, 'r-abcdef01');
  } finally { s.cleanup(); }
});
