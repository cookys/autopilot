'use strict';
require('./lib/test-git-env.js');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const OD = path.join(__dirname, 'open-decision.js');
const EXEC = 'ns/courier/member';
const QUESTION = '要不要刪掉這個分支？';
const OPTS = [{ label: '刪', description: '刪掉' }, { label: '留', description: '留下' }];

function scratch() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'od-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'od-repo-'));
  const g = spawnSync('git', ['init', '-q'], { cwd: repo, env: process.env });
  if (g.status !== 0) throw new Error(`git init failed: ${g.stderr}`);
  return { home, repo, cleanup() { fs.rmSync(home, { recursive: true, force: true }); fs.rmSync(repo, { recursive: true, force: true }); } };
}

function writeRole(home, role) {
  const d = path.join(home, '.autopilot');
  fs.mkdirSync(d, { recursive: true });
  if (role) fs.writeFileSync(path.join(d, 'team.json'), `${JSON.stringify({ role })}\n`);
}

function childEnv(home) {
  const env = {
    ...process.env,
    HOME: home,
    AUTOPILOT_COURIER: '1',
    AUTOPILOT_RUNS_WATCH_AUTOSTART: '0',
    AUTOPILOT_CARD_NOTIFY: 'off',
  };
  delete env.AUTOPILOT_SESSION_ID;
  delete env.CLAUDE_CODE_SESSION_ID;
  delete env.CLAUDE_SESSION_ID;
  delete env.CODEX_THREAD_ID;
  delete env.XDG_CONFIG_HOME;
  return env;
}

function snapshot(repo) {
  const dir = path.join(repo, '.git', 'autopilot', 'decisions');
  if (!fs.existsSync(dir)) return '';
  return fs.readdirSync(dir).sort().map((n) => `${n}\n${fs.readFileSync(path.join(dir, n), 'utf8')}`).join('\n---\n');
}

function entries(repo) {
  const dir = path.join(repo, '.git', 'autopilot', 'decisions');
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith('.json')) continue;
    const body = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    if (Array.isArray(body.decisions)) out.push(...body.decisions);
  }
  return out;
}

function withRole(role, fn) {
  const s = scratch();
  writeRole(s.home, role);
  const prev = {
    HOME: process.env.HOME,
    AUTOPILOT_COURIER: process.env.AUTOPILOT_COURIER,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
  process.env.HOME = s.home;
  process.env.AUTOPILOT_COURIER = '1';
  delete process.env.XDG_CONFIG_HOME;
  try { return fn(s); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    s.cleanup();
  }
}

function libOpen(fields) {
  const od = require('./open-decision.js');
  return od.openDecision({
    cwd: fields.cwd,
    question: QUESTION,
    options: OPTS,
    recommendation: '留',
    executor: EXEC,
    not_authorized: fields.not_authorized,
    origin: fields.origin,
  });
}

function cli(home, repo, args) {
  return spawnSync(process.execPath, [OD, 'open', '--cwd', repo, '--executor', EXEC, '--question', QUESTION, '--option', '刪::刪掉', '--option', '留::留下', '--recommendation', '留', ...args], {
    env: childEnv(home), encoding: 'utf8',
  });
}

function shape(entry) {
  return {
    question: entry.question,
    options: entry.options,
    recommendation: entry.recommendation,
    not_authorized: entry.not_authorized,
    executor: entry.executor,
  };
}

test('lane and lead: library and CLI refuse and write nothing', () => {
  for (const role of ['lane', 'lead']) {
    withRole(role, (s) => {
      const before = snapshot(s.repo);
      const lib = libOpen({ cwd: s.repo, not_authorized: 'read_only' });
      assert.equal(lib.status, 'error');
      assert.equal(lib.code, 4);
      assert.match(lib.message, /request-decision\.js/);
      assert.equal(snapshot(s.repo), before);
      const run = cli(s.home, s.repo, ['--not-authorized', 'external']);
      assert.equal(run.status, 4, run.stderr);
      assert.match(run.stderr, /request-decision\.js/);
      assert.equal(run.stdout, '');
      assert.equal(snapshot(s.repo), before);
      const board = cli(s.home, s.repo, ['--not-authorized', 'goal-change']);
      assert.equal(board.status, 4, board.stderr);
      assert.equal(snapshot(s.repo), before);
    });
  }
});

test('PM and solo still write', () => {
  for (const role of ['pm', 'solo']) {
    withRole(role, (s) => {
      const lib = libOpen({ cwd: s.repo, not_authorized: 'read_only' });
      assert.equal(lib.status, 'ok', lib.message);
      assert.match(lib.id, /^d-[0-9a-f]{8}$/);
      const run = cli(s.home, s.repo, ['--not-authorized', 'reversible']);
      assert.equal(run.status, 0, run.stderr);
      assert.match(run.stdout, /^d-[0-9a-f]{8}\n$/);
      assert.equal(run.stderr.includes('送給 PM'), false);
    });
  }
});

test('--irreversible stores the same card as the long form', () => {
  const a = scratch();
  const b = scratch();
  try {
    writeRole(a.home, 'pm');
    writeRole(b.home, 'pm');
    const long = cli(a.home, a.repo, ['--not-authorized', 'irreversible']);
    const alias = cli(b.home, b.repo, ['--irreversible']);
    assert.equal(long.status, 0, long.stderr);
    assert.equal(alias.status, 0, alias.stderr);
    assert.deepEqual(shape(entries(a.repo)[0]), shape(entries(b.repo)[0]));
    assert.equal(entries(b.repo)[0].not_authorized, 'irreversible');
  } finally { a.cleanup(); b.cleanup(); }
});

test('both flags keep one irreversible reason', () => {
  const s = scratch();
  try {
    writeRole(s.home, 'solo');
    const run = cli(s.home, s.repo, ['--irreversible', '--not-authorized', 'irreversible:because']);
    assert.equal(run.status, 0, run.stderr);
    const entry = entries(s.repo)[0];
    assert.equal(entry.not_authorized, 'irreversible:because');
    assert.equal(JSON.stringify(entry).split('irreversible:because').length, 2);
  } finally { s.cleanup(); }
});

test('alias plus a different boundary writes nothing', () => {
  const s = scratch();
  try {
    writeRole(s.home, 'lane');
    const before = snapshot(s.repo);
    const run = cli(s.home, s.repo, ['--irreversible', '--not-authorized', 'read_only']);
    assert.equal(run.status, 2, run.stderr);
    assert.equal(snapshot(s.repo), before);
  } finally { s.cleanup(); }
});

test('lane and lead irreversible passes and names the card for the PM', () => {
  for (const role of ['lane', 'lead']) {
    withRole(role, (s) => {
      const lib = libOpen({ cwd: s.repo, not_authorized: 'irreversible' });
      assert.equal(lib.status, 'ok', lib.message);
      const run = cli(s.home, s.repo, ['--irreversible']);
      assert.equal(run.status, 0, run.stderr);
      const id = run.stdout.trim();
      assert.match(id, /^d-[0-9a-f]{8}$/);
      assert.match(run.stderr, new RegExp(id));
      assert.match(run.stderr, /送給 PM/);
      assert.equal(run.stdout.includes('PM'), false);
    });
  }
});

test('lane permission-block card still opens', () => {
  withRole('lane', (s) => {
    const direct = libOpen({ cwd: s.repo, not_authorized: 'read_only', origin: 'permission_prompt' });
    assert.equal(direct.status, 'ok', direct.message);
    assert.equal(direct.code, undefined);
    const { openBlockedCard } = require('../hooks/permission-block-lib.js');
    const card = openBlockedCard({ cwd: s.repo, sessionId: 's', paneId: '%9', socket: '', summary: 'rm x' });
    assert.ok(card && /^d-[0-9a-f]{8}$/.test(card.id));
    const hit = entries(s.repo).find((e) => e.id === card.id);
    assert.equal(hit.origin, 'permission_prompt');
  });
});
